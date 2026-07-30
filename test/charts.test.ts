// A chart is a claim in a picture, so it gets the same scrutiny as a number.
// The two that matter most here are that it never invents a magnitude it did
// not measure (the unbounded case) and that a hostile subject name cannot
// escape into markup, since names arrive from `defineSubject` and end up in a
// file people commit to a README.

import { describe, expect, it } from "vitest";
import { collisionChart, depthChart } from "../src/charts.js";
import { COLLISION_PROBES } from "../src/cases.js";
import type { CollisionResult, DepthResult } from "../src/types.js";

function collisionsFor(subject: string, colliding: ReadonlyArray<string>): CollisionResult {
  const findings = COLLISION_PROBES.map((p) => ({
    probe: p.id,
    verdict: (colliding.includes(p.id) ? "collides" : "distinct") as "collides" | "distinct",
    expectedToDiffer: p.expectedToDiffer,
  }));
  return { subject, findings, collisions: colliding.length };
}

/** Both charts must be usable offline, in a README, forever. */
function assertSelfContained(out: string): void {
  expect(out.startsWith("<svg")).toBe(true);
  expect(out.trimEnd().endsWith("</svg>")).toBe(true);
  expect(out).not.toMatch(/<script/i);
  expect(out).not.toMatch(/xlink:href|<image/i);
  // The SVG namespace is an identifier, not a fetch, so it is the one URL
  // allowed to appear. Anything else would make the chart depend on a network.
  const withoutNamespace = out.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, "");
  expect(withoutNamespace).not.toMatch(/https?:\/\//);

  // No CSS custom properties. An earlier version painted everything with
  // var(--fg) and rendered as a solid black rectangle under librsvg, which has
  // no support for them and sits under many markdown-to-image pipelines. Every
  // colour must survive a renderer that ignores the stylesheet entirely.
  expect(out).not.toMatch(/var\(--/);

  // Which means every painted element carries a literal colour of its own.
  for (const m of out.matchAll(/<(?:rect|path|line|text)\s([^>]*)>/g)) {
    const attrs = m[1] ?? "";
    const painted = /fill="(?!none)/.test(attrs) || /stroke="(?!none)/.test(attrs);
    expect(painted, `unpainted element: <${attrs.slice(0, 70)}>`).toBe(true);
  }
  // Balanced enough to parse: every element opened is closed.
  expect((out.match(/<svg/g) ?? []).length).toBe((out.match(/<\/svg>/g) ?? []).length);
}

/**
 * Every themed class an element uses must have a dark-mode rule, or that
 * element keeps its light colour on a dark background and becomes invisible.
 * Checked structurally so adding a class later cannot quietly skip the theme.
 */
function assertDarkThemeIsComplete(out: string): void {
  const dark = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n  \}/.exec(out);
  expect(dark, "no dark-scheme block").not.toBeNull();

  const used = new Set<string>();
  for (const m of out.matchAll(/class="([^"]+)"/g)) {
    for (const c of (m[1] ?? "").split(/\s+/)) if (c) used.add(c);
  }
  expect(used.size).toBeGreaterThan(0);

  for (const cls of used) {
    expect(dark![1], `class ${cls} has no dark-mode rule`).toContain(`.${cls} {`);
  }
}

describe("collisionChart", () => {
  const results = [
    collisionsFor("collides-a-lot", COLLISION_PROBES.slice(0, 7).map((p) => p.id)),
    collisionsFor("clean", []),
  ];

  it("is a self-contained svg", () => {
    assertSelfContained(collisionChart(results));
  });

  it("themes every class it uses for dark mode", () => {
    assertDarkThemeIsComplete(collisionChart(results));
  });

  it("draws one cell per probe per subject", () => {
    const out = collisionChart(results);
    const cells = (out.match(/<rect x="\d+(\.\d+)?" y="\d+(\.\d+)?" width="\d+"/g) ?? []).length;
    expect(cells).toBe(COLLISION_PROBES.length * results.length);
  });

  it("labels every probe", () => {
    const out = collisionChart(results);
    for (const p of COLLISION_PROBES) expect(out).toContain(p.id);
  });

  it("reports each subject's collision total", () => {
    const out = collisionChart(results);
    expect(out).toContain(">7<");
    expect(out).toContain(">0<");
  });

  it("marks verdicts with a glyph, not colour alone", () => {
    // A reader with no colour perception, or a greyscale print, must still be
    // able to tell a collision from a clean cell.
    const out = collisionChart(results);
    expect(out).toContain("×");
    expect(out).toContain("·");
  });

  it("escapes a hostile subject name", () => {
    const out = collisionChart([collisionsFor('<script>"&x', [])]);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    assertSelfContained(out);
  });

  it("grows the canvas to fit rotated headers instead of clipping them", () => {
    // Fixed header space clipped the rightmost column and pushed the longest
    // label up through the title. Both dimensions must track the longest name.
    const dims = (out: string) => ({
      w: Number(/width="(\d+)"/.exec(out)![1]),
      h: Number(/height="(\d+)"/.exec(out)![1]),
    });
    const short = dims(collisionChart([collisionsFor("ab", [])]));
    const long = dims(collisionChart([collisionsFor("a".repeat(40), [])]));

    expect(long.w).toBeGreaterThan(short.w);
    expect(long.h).toBeGreaterThan(short.h);
  });
});

describe("depthChart", () => {
  const results: DepthResult[] = [
    { subject: "shallow", maxDepth: 1_800, failureMode: "RangeError" },
    { subject: "deeper", maxDepth: 7_600, failureMode: "RangeError" },
    { subject: "iterative", maxDepth: Infinity },
  ];

  it("is a self-contained svg", () => {
    assertSelfContained(depthChart(results));
  });

  it("themes every class it uses for dark mode", () => {
    assertDarkThemeIsComplete(depthChart(results));
  });

  it("labels finite results with the measured number", () => {
    const out = depthChart(results);
    expect(out).toContain("1,800");
    expect(out).toContain("7,600");
  });

  it("says unbounded rather than inventing a magnitude", () => {
    const out = depthChart(results);
    expect(out).toContain("unbounded");
    expect(out).not.toContain("Infinity");
    expect(out).not.toContain("NaN");
  });

  it("scales bars against the largest finite result, not the infinite one", () => {
    // Infinity must never reach the scale computation: one NaN width and the
    // whole chart silently renders as nothing.
    const out = depthChart(results);
    const widths = [...out.matchAll(/<rect [^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths.every((w) => Number.isFinite(w) && w > 0)).toBe(true);
  });

  it("survives every subject being unbounded", () => {
    // No finite results at all means no scale maximum, which is exactly the
    // division-by-zero shape that produces an invisible chart.
    const out = depthChart([{ subject: "a", maxDepth: Infinity }]);
    assertSelfContained(out);
    expect(out).not.toContain("NaN");
  });

  it("escapes a hostile subject name", () => {
    const out = depthChart([{ subject: "<b>&", maxDepth: 10 }]);
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;b&gt;");
  });
});
