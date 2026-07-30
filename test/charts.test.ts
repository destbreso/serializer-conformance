// A chart is a claim in a picture, so it gets the same scrutiny as a number.
// The two that matter most here are that it never invents a magnitude it did
// not measure (the unbounded case) and that a hostile subject name cannot
// escape into markup, since names arrive from `defineSubject` and end up in a
// file people commit to a README.

import { describe, expect, it } from "vitest";
import { CHART_PALETTE, collisionChart, depthChart, scalingChart } from "../src/charts.js";
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

/** WCAG relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * The chart must paint its own surface before anything else. Without it the
 * figure inherits the host page's background, and a README image has no idea
 * what that is: npm is white, GitHub in dark mode is not, and a chart that
 * assumes either one is illegible on the other.
 */
function assertPaintsItsOwnSurface(out: string): void {
  const first = /<rect [^>]*>/.exec(out);
  expect(first, "no background rect").not.toBeNull();
  expect(first![0]).toContain(`fill="${CHART_PALETTE.bg}"`);

  // And it must come before any content, or it covers what it should sit under.
  expect(out.indexOf(first![0])).toBeLessThan(out.indexOf("<text"));
}

/**
 * No theme-conditional colour. A prefers-color-scheme query inside an SVG
 * embedded with <img> resolves against the viewer's OS rather than the page it
 * is on, which is how dark-palette labels ended up on npm's white README.
 */
function assertNoConditionalTheming(out: string): void {
  expect(out).not.toMatch(/prefers-color-scheme/);
  expect(out).not.toMatch(/var\(--/);
}

describe("collisionChart", () => {
  const results = [
    collisionsFor("collides-a-lot", COLLISION_PROBES.slice(0, 7).map((p) => p.id)),
    collisionsFor("clean", []),
  ];

  it("is a self-contained svg", () => {
    assertSelfContained(collisionChart(results));
  });

  it("paints its own surface and uses no conditional theming", () => {
    assertPaintsItsOwnSurface(collisionChart(results));
    assertNoConditionalTheming(collisionChart(results));
  });

  it("draws one cell per probe per subject", () => {
    const out = collisionChart(results);
    // Cells are the rx="3" rects. The surface rect uses rx="6", so counting all
    // rects would silently include it.
    const cells = (out.match(/<rect [^>]*rx="3"/g) ?? []).length;
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

  it("is always wide enough for its own header text", () => {
    // With few subjects the grid is narrower than the subtitle, which used to
    // run off the right edge. The canvas is sized on whichever is wider.
    for (const n of [1, 2, 3, 8, 10]) {
      const out = collisionChart(
        Array.from({ length: n }, (_, i) => collisionsFor(`s${i}`, [])),
      );
      const width = Number(/width="(\d+)"/.exec(out)![1]);
      const longest = Math.max(
        ...[...out.matchAll(/font-size="(11|14)"[^>]*>([^<]+)</g)].map((m) =>
          (m[2] ?? "").length * Number(m[1]) * 0.6,
        ),
      );
      expect(width, `n=${n}`).toBeGreaterThanOrEqual(longest);
    }
  });

  it("grows the canvas to fit rotated headers instead of clipping them", () => {
    // Fixed header space clipped the rightmost column and pushed the longest
    // label up through the title. Both dimensions must track the longest name.
    const dims = (out: string) => ({
      w: Number(/width="(\d+)"/.exec(out)![1]),
      h: Number(/height="(\d+)"/.exec(out)![1]),
    });
    // Enough subjects that the grid, not the header text, sets the width.
    const grid = (name: string) =>
      dims(collisionChart(Array.from({ length: 10 }, () => collisionsFor(name, []))));
    const short = grid("ab");
    const long = grid("a".repeat(40));

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

  it("paints its own surface and uses no conditional theming", () => {
    assertPaintsItsOwnSurface(depthChart(results));
    assertNoConditionalTheming(depthChart(results));
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

describe("palette", () => {
  const P = CHART_PALETTE;

  it("clears WCAG AA for every colour that carries text", () => {
    // 4.5:1 is the AA threshold for normal-size text. These labels run down to
    // 10px, so anything below it is not a stylistic preference, it is a label
    // the reader cannot make out. The previous muted grey (#6b7280) sat at 4.8
    // and still read as washed out at that size.
    const onSurface: Array<[string, string]> = [
      ["fg", P.fg],
      ["muted", P.muted],
      ["ok", P.ok],
      ["bad", P.bad],
      ["refused", P.refused],
      ["bar", P.bar],
      ["accent", P.accent],
    ];
    for (const [name, colour] of onSurface) {
      expect(contrast(colour, P.bg), `${name} on bg`).toBeGreaterThanOrEqual(4.5);
    }

    // Cell glyphs sit on their own tinted backgrounds, not on the surface.
    const inCells: Array<[string, string, string]> = [
      ["ok", P.ok, P.okBg],
      ["bad", P.bad, P.badBg],
      ["refused", P.refused, P.refusedBg],
    ];
    for (const [name, fg, bg] of inCells) {
      expect(contrast(fg, bg), `${name} in cell`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the cell tints distinguishable from the surface", () => {
    // Too close to the background and the grid stops reading as a grid.
    for (const tint of [P.okBg, P.badBg, P.refusedBg]) {
      expect(contrast(tint, P.bg)).toBeGreaterThan(1.05);
    }
  });
});

describe("scalingChart", () => {
  const results = [
    {
      subject: "linear-ish",
      series: [
        { axis: "depth" as const, points: [{ n: 64, ms: 1, outputLength: 10 }], exponent: 1.02, rSquared: 0.99 },
        { axis: "width" as const, points: [{ n: 500, ms: 1, outputLength: 10 }], exponent: 1.05, rSquared: 0.98 },
      ],
    },
    {
      subject: "quadratic",
      series: [
        { axis: "depth" as const, points: [{ n: 64, ms: 4, outputLength: 10 }], exponent: 1.98, rSquared: 0.99 },
        { axis: "width" as const, points: [{ n: 500, ms: 4, outputLength: 10 }], exponent: 2.01, rSquared: 0.99 },
      ],
    },
    {
      subject: "noisy",
      series: [
        { axis: "depth" as const, points: [{ n: 64, ms: 1, outputLength: 10 }], exponent: 1.4, rSquared: 0.2 },
      ],
    },
    { subject: "unmeasured", series: [] },
  ];

  it("is a self-contained svg that paints its own surface", () => {
    const out = scalingChart(results);
    assertSelfContained(out);
    assertPaintsItsOwnSurface(out);
    assertNoConditionalTheming(out);
  });

  it("marks a poor fit as such instead of quoting it like a measurement", () => {
    const out = scalingChart(results);
    expect(out).toContain("poor fit");
    // A hollow bar: stroked, not filled.
    expect(out).toMatch(/<rect [^>]*fill="none"[^>]*stroke=/);
  });

  it("says so when an axis was never measured", () => {
    expect(scalingChart(results)).toContain("not measured");
  });

  it("colours quadratic growth as the finding and linear as ordinary", () => {
    const out = scalingChart(results);
    expect(out).toContain(CHART_PALETTE.bad);
    expect(out).toContain(CHART_PALETTE.bar);
  });

  it("renders either axis", () => {
    expect(scalingChart(results, "width")).toContain("by width");
    expect(scalingChart(results, "depth")).toContain("by depth");
  });

  it("clamps an off-scale exponent instead of drawing past the axis", () => {
    const wild = [
      {
        subject: "cubic",
        series: [
          { axis: "depth" as const, points: [{ n: 64, ms: 1, outputLength: 1 }], exponent: 3.4, rSquared: 0.99 },
        ],
      },
    ];
    const out = scalingChart(wild);
    const width = Number(/width="(\d+)"/.exec(out)![1]);
    for (const m of out.matchAll(/<rect [^>]*x="([\d.]+)"[^>]*width="([\d.]+)"/g)) {
      expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(width);
    }
    expect(out).toContain("3.40+");
  });
});
