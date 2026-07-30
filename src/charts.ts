// SVG renderers for the two suites whose results are genuinely visual.
//
// Only two of the five suites earn a chart, and it is worth saying why the
// others do not. Conformance is six booleans per subject: a table already shows
// that perfectly and a bar chart of "6" repeated would be decoration.
// Determinism is one integer per subject, and coverage is a matrix of strings
// that has to be read, not scanned. Collisions and depth are different: one is
// a grid where the pattern across the whole field is the finding, and the other
// is a magnitude with an outlier. Those two are charts.
//
// Everything here returns a self-contained SVG string. No fonts are fetched, no
// scripts run, and nothing is written to disk: the CLI owns the filesystem so
// the library stays usable anywhere.
//
// On colour, and why it is done the long way. The first version used CSS custom
// properties (`fill="var(--fg)"`) with a prefers-color-scheme block, which is
// clean and renders beautifully in a browser. It also renders as a solid black
// rectangle in librsvg, which does not implement custom properties, and librsvg
// is what sits under a lot of markdown-to-PDF and thumbnailing pipelines. So
// every element now carries a literal colour as a presentation attribute and a
// class alongside it, and the stylesheet only overrides for dark mode. CSS beats
// presentation attributes, so a renderer that understands the stylesheet gets a
// theme-aware chart and one that ignores it still gets a correct light one. The
// failure mode is degraded, not broken.

import type { CollisionResult, DepthResult } from "./types.js";
import { COLLISION_PROBES } from "./cases.js";

/** XML-escape. Subject names can come from `defineSubject`, so they are not trusted. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/**
 * Advance width of monospace text. 0.6em per character is the standard for the
 * families in FONT, and being approximate is fine because every use of it adds
 * space rather than removing it.
 */
const textPx = (s: string, fontSize: number) => s.length * fontSize * 0.6;

/** Light values are the baseline, written directly onto every element. */
const LIGHT = {
  fg: "#1c1f26",
  muted: "#6b7280",
  grid: "#d8dbe0",
  ok: "#1a7f4b",
  okBg: "#dcf3e6",
  bad: "#c0341d",
  badBg: "#fadbd5",
  refused: "#5b6472",
  refusedBg: "#e6e8ec",
  bar: "#3b6ea8",
  accent: "#1a7f4b",
} as const;

const DARK = {
  fg: "#e6e8ec",
  muted: "#9aa3af",
  grid: "#333a45",
  ok: "#56d394",
  okBg: "#14301f",
  bad: "#ff7a63",
  badBg: "#3a1a14",
  refused: "#9aa3af",
  refusedBg: "#262b33",
  bar: "#6fa8dc",
  accent: "#56d394",
} as const;

/**
 * Class names carry the *role*, so the dark override is a single generated
 * block rather than a per-element edit. `f-` sets fill, `s-` sets stroke,
 * `p-` sets a gradient stop.
 */
const STYLE = `
  text { font-family: ${FONT}; }
  @media (prefers-color-scheme: dark) {
    .f-fg { fill: ${DARK.fg}; }
    .f-muted { fill: ${DARK.muted}; }
    .f-ok { fill: ${DARK.ok}; }
    .f-okbg { fill: ${DARK.okBg}; }
    .f-bad { fill: ${DARK.bad}; }
    .f-badbg { fill: ${DARK.badBg}; }
    .f-refused { fill: ${DARK.refused}; }
    .f-refusedbg { fill: ${DARK.refusedBg}; }
    .f-bar { fill: ${DARK.bar}; }
    .f-accent { fill: ${DARK.accent}; }
    .s-grid { stroke: ${DARK.grid}; }
    .p-accent { stop-color: ${DARK.accent}; }
  }
`;

function svg(width: number, height: number, label: string, body: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `,
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">`,
    `<title>${esc(label)}</title>`,
    `<style>${STYLE}</style>`,
    body,
    `</svg>`,
  ].join("");
}

// --------------------------------------------------------------- collisions

/**
 * The collision grid: probes down the side, implementations across the top.
 *
 * This is the chart that states the tool's whole thesis, because the finding is
 * not any single cell but the shape of the field: whole columns of red under
 * the JSON-subset canonicalizers, where a populated Map and an empty object are
 * the same string. A red cell is a silent wrong answer, not a crash.
 */
export function collisionChart(results: ReadonlyArray<CollisionResult>): string {
  const LABEL_W = 208;
  const CELL = 34;
  const ROW_H = 26;
  const PAD = 16;
  const TITLE_H = 56;

  const cols = results.length;
  const rows = COLLISION_PROBES.length;

  const TITLE = "Collisions: distinct inputs that produce identical output";
  const SUBTITLE =
    "Each cell is one probe against one implementation. Red is a silent wrong answer, not a crash.";

  // The column headers are rotated, so the space they need depends on how long
  // the subject names are. Fixed header space clipped the last column and drove
  // the longest label up through the title, so both are derived from the actual
  // names.
  const ANGLE_DEG = 55;
  const angle = (ANGLE_DEG * Math.PI) / 180;
  const labelPx = textPx("x".repeat(Math.max(0, ...results.map((r) => r.subject.length))), 11);
  const headerRise = Math.ceil(labelPx * Math.sin(angle));
  const headerRun = Math.ceil(labelPx * Math.cos(angle));

  const HEAD_H = TITLE_H + headerRise + 12;
  const rightPad = Math.max(PAD, headerRun + 10);
  // The canvas has to clear the header text as well as the grid. Sizing on the
  // grid alone clipped the subtitle whenever few subjects were installed.
  const gridWidth = PAD + LABEL_W + cols * CELL + rightPad;
  const textWidth = PAD + Math.max(textPx(TITLE, 14), textPx(SUBTITLE, 11)) + PAD;
  const width = Math.ceil(Math.max(gridWidth, textWidth));
  const height = HEAD_H + rows * ROW_H + 70;

  const parts: string[] = [];
  parts.push(
    `<text x="${PAD}" y="24" class="f-fg" fill="${LIGHT.fg}" font-size="14" font-weight="700">${TITLE}</text>`,
  );
  parts.push(
    `<text x="${PAD}" y="42" class="f-muted" fill="${LIGHT.muted}" font-size="11">${SUBTITLE}</text>`,
  );

  // Column headers, rotated so the grid stays narrow enough to read on a phone.
  results.forEach((r, c) => {
    const x = PAD + LABEL_W + c * CELL + CELL / 2;
    const y = HEAD_H - 8;
    parts.push(
      `<text x="${x}" y="${y}" class="f-fg" fill="${LIGHT.fg}" font-size="11" text-anchor="start" ` +
        `transform="rotate(-${ANGLE_DEG} ${x} ${y})">${esc(r.subject)}</text>`,
    );
  });

  COLLISION_PROBES.forEach((probe, i) => {
    const y = HEAD_H + i * ROW_H;
    parts.push(
      `<text x="${PAD + LABEL_W - 8}" y="${y + ROW_H / 2 + 4}" class="f-fg" fill="${LIGHT.fg}" font-size="11" text-anchor="end">${esc(probe.id)}</text>`,
    );

    results.forEach((r, c) => {
      const verdict = r.findings.find((f) => f.probe === probe.id)?.verdict;
      const x = PAD + LABEL_W + c * CELL;

      // A refusal is not a failure: the two values are still told apart, which
      // is the only thing this suite asks. Only "collides" is scored against.
      const cell =
        verdict === "collides"
          ? { bg: LIGHT.badBg, bgc: "f-badbg", fg: LIGHT.bad, fgc: "f-bad", glyph: "×" }
          : verdict === "distinct"
            ? { bg: LIGHT.okBg, bgc: "f-okbg", fg: LIGHT.ok, fgc: "f-ok", glyph: "·" }
            : { bg: LIGHT.refusedBg, bgc: "f-refusedbg", fg: LIGHT.refused, fgc: "f-refused", glyph: "–" };

      parts.push(
        `<rect x="${x + 1}" y="${y + 1}" width="${CELL - 2}" height="${ROW_H - 2}" rx="3" ` +
          `class="${cell.bgc} s-grid" fill="${cell.bg}" stroke="${LIGHT.grid}" stroke-width="0.5"/>`,
      );
      parts.push(
        `<text x="${x + CELL / 2}" y="${y + ROW_H / 2 + 4}" class="${cell.fgc}" fill="${cell.fg}" ` +
          `font-size="12" text-anchor="middle">${cell.glyph}</text>`,
      );
    });
  });

  // Totals row, so the chart answers "how bad" and not only "where".
  const totalsY = HEAD_H + rows * ROW_H + 18;
  parts.push(
    `<text x="${PAD + LABEL_W - 8}" y="${totalsY}" class="f-muted" fill="${LIGHT.muted}" font-size="11" text-anchor="end">total</text>`,
  );
  results.forEach((r, c) => {
    const x = PAD + LABEL_W + c * CELL + CELL / 2;
    const clean = r.collisions === 0;
    parts.push(
      `<text x="${x}" y="${totalsY}" class="${clean ? "f-ok" : "f-bad"}" fill="${clean ? LIGHT.ok : LIGHT.bad}" ` +
        `font-size="12" text-anchor="middle" font-weight="700">${r.collisions}</text>`,
    );
  });

  const legendY = totalsY + 26;
  const legend: Array<[string, string, string, string]> = [
    ["×", LIGHT.bad, "f-bad", "collides"],
    ["·", LIGHT.ok, "f-ok", "distinct"],
    ["–", LIGHT.refused, "f-refused", "refused (acceptable)"],
  ];
  let lx = PAD;
  for (const [glyph, colour, cls, text] of legend) {
    parts.push(`<text x="${lx}" y="${legendY}" class="${cls}" fill="${colour}" font-size="12">${glyph}</text>`);
    parts.push(
      `<text x="${lx + 14}" y="${legendY}" class="f-muted" fill="${LIGHT.muted}" font-size="11">${esc(text)}</text>`,
    );
    lx += 32 + text.length * 6.2;
  }

  return svg(width, height, "Collision grid: probes by implementation", parts.join(""));
}

// -------------------------------------------------------------------- depth

/**
 * Nesting depth before failure.
 *
 * Deliberately a linear scale. The finite results span roughly 1.5k to 7.6k, a
 * five-fold range that a log axis would flatten into visual sameness, and the
 * whole point of the chart is that they all sit in one narrow band while an
 * iterative kernel does not sit anywhere. An unbounded result is drawn running
 * off the axis rather than as a tall bar, because it is not a larger number: it
 * is the absence of a limit, and giving it a bar length would invent one.
 */
export function depthChart(results: ReadonlyArray<DepthResult>): string {
  const LABEL_W = 208;
  const PAD = 16;
  const BAR_W = 420;
  const ROW_H = 30;
  const HEAD_H = 66;

  const TITLE = "Nesting depth before failure";
  const SUBTITLE =
    "Recursive kernels die in the low thousands. Stack limits vary by run, so read these as orders of magnitude.";

  const barsWidth = PAD + LABEL_W + BAR_W + 100;
  const textWidth = PAD + Math.max(textPx(TITLE, 14), textPx(SUBTITLE, 11)) + PAD;
  const width = Math.ceil(Math.max(barsWidth, textWidth));
  const height = HEAD_H + results.length * ROW_H + 44;

  const finite = results.map((r) => r.maxDepth).filter((d) => Number.isFinite(d));
  // Guard the no-finite-results case: without it the scale is -Infinity and
  // every bar width comes out NaN, which renders as an empty chart rather than
  // an error. Any positive fallback works because nothing finite will be drawn.
  const max = finite.length ? Math.max(...finite) : 1;
  const scaleMax = max * 1.15; // headroom so the tallest bar clears the arrow

  const parts: string[] = [];
  parts.push(
    `<text x="${PAD}" y="24" class="f-fg" fill="${LIGHT.fg}" font-size="14" font-weight="700">${TITLE}</text>`,
  );
  parts.push(
    `<text x="${PAD}" y="42" class="f-muted" fill="${LIGHT.muted}" font-size="11">${SUBTITLE}</text>`,
  );

  const axisBottom = HEAD_H + results.length * ROW_H;
  for (let v = 2000; v < scaleMax; v += 2000) {
    const x = PAD + LABEL_W + (v / scaleMax) * BAR_W;
    parts.push(
      `<line x1="${x}" y1="${HEAD_H - 8}" x2="${x}" y2="${axisBottom}" class="s-grid" ` +
        `stroke="${LIGHT.grid}" stroke-width="1" stroke-dasharray="2 3"/>`,
    );
    parts.push(
      `<text x="${x}" y="${axisBottom + 16}" class="f-muted" fill="${LIGHT.muted}" font-size="10" text-anchor="middle">${v.toLocaleString("en-US")}</text>`,
    );
  }

  // One gradient for every unbounded bar rather than one per row.
  parts.push(
    `<defs><linearGradient id="sc-unbounded" x1="0" x2="1">` +
      `<stop offset="0" class="p-accent" stop-color="${LIGHT.accent}" stop-opacity="1"/>` +
      `<stop offset="1" class="p-accent" stop-color="${LIGHT.accent}" stop-opacity="0.2"/>` +
      `</linearGradient></defs>`,
  );

  results.forEach((r, i) => {
    const y = HEAD_H + i * ROW_H;
    const cy = y + ROW_H / 2;
    parts.push(
      `<text x="${PAD + LABEL_W - 8}" y="${cy + 4}" class="f-fg" fill="${LIGHT.fg}" font-size="11" text-anchor="end">${esc(r.subject)}</text>`,
    );

    if (Number.isFinite(r.maxDepth)) {
      const w = Math.max(2, (r.maxDepth / scaleMax) * BAR_W);
      parts.push(
        `<rect x="${PAD + LABEL_W}" y="${y + 6}" width="${w}" height="${ROW_H - 14}" rx="2" class="f-bar" fill="${LIGHT.bar}"/>`,
      );
      parts.push(
        `<text x="${PAD + LABEL_W + w + 8}" y="${cy + 4}" class="f-muted" fill="${LIGHT.muted}" font-size="11">${r.maxDepth.toLocaleString("en-US")}</text>`,
      );
    } else {
      // Runs to the edge and fades, with an arrow: no limit was found, so no
      // length is claimed.
      const endX = PAD + LABEL_W + BAR_W;
      parts.push(
        `<rect x="${PAD + LABEL_W}" y="${y + 6}" width="${BAR_W}" height="${ROW_H - 14}" rx="2" fill="url(#sc-unbounded)"/>`,
      );
      parts.push(
        `<path d="M ${endX + 4} ${cy - 5} L ${endX + 13} ${cy} L ${endX + 4} ${cy + 5} Z" class="f-accent" fill="${LIGHT.accent}"/>`,
      );
      parts.push(
        `<text x="${endX + 18}" y="${cy + 4}" class="f-accent" fill="${LIGHT.accent}" font-size="11">unbounded</text>`,
      );
    }
  });

  return svg(width, height, "Nesting depth handled before failure, by implementation", parts.join(""));
}
