// SVG renderers for the suites whose results are genuinely visual.
//
// Three of the six earn a chart, and it is worth saying why the others do not.
// Conformance is six booleans per subject: a table shows that perfectly and a
// bar chart of "6" repeated would be decoration. Determinism is one integer per
// subject, and coverage is a matrix of strings that has to be read, not
// scanned. Collisions, depth and scaling are different: a grid where the
// pattern across the whole field is the finding, a magnitude with an outlier,
// and a growth rate that is the difference between a fast function and an
// outage. Those three are charts.
//
// Everything here returns a self-contained SVG string. No fonts are fetched, no
// scripts run, and nothing is written to disk: the CLI owns the filesystem so
// the library stays usable anywhere.
//
// On colour, which took two wrong turns to get right.
//
// The first version painted with CSS custom properties (`fill="var(--fg)"`).
// That renders beautifully in a browser and as a solid black rectangle in
// librsvg, which implements neither and sits under a lot of markdown-to-image
// pipelines.
//
// The second kept literal colours but added a `prefers-color-scheme` block to
// invert them. That is worse, and subtly so. An SVG embedded with `<img>` (which
// is what a README image is on GitHub and npm) resolves that query against the
// *viewer's operating system*, not against the page it sits on. npm renders
// READMEs on white. So a reader whose laptop is in dark mode got the dark
// palette painted onto a white page: pale grey labels on white, unreadable, and
// inconsistent with every other image on the page.
//
// So: one fixed palette, and an explicit background rectangle underneath it.
// The chart carries its own surface and therefore its own contrast, and looks
// identical on npm, on GitHub in either theme, in a PDF and in a thumbnail. A
// figure that always looks like a figure beats one that is occasionally
// theme-aware and occasionally illegible. Contrast ratios are asserted in the
// tests rather than eyeballed.

import type { CollisionResult, DepthResult, ScalingResult } from "./types.js";
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

/**
 * One palette, on a surface the chart paints itself. Text colours are chosen to
 * clear WCAG AA (4.5:1) against the surface they actually sit on, which the
 * tests verify rather than assume. `muted` in particular used to be #6b7280,
 * which is fine for body text at 16px and too thin for a 10px axis label.
 */
export const CHART_PALETTE = {
  bg: "#ffffff",
  border: "#e1e4e8",
  fg: "#1a1d23",
  muted: "#4a515b",
  grid: "#d0d4da",
  ok: "#136c3e",
  okBg: "#dcf3e6",
  bad: "#a82d18",
  badBg: "#fadbd5",
  refused: "#4a515b",
  refusedBg: "#e6e8ec",
  bar: "#2f5d90",
  accent: "#136c3e",
} as const;

/**
 * The stylesheet does no theming, only the font. Classes are kept on elements
 * so anyone embedding the SVG inline can restyle it, but nothing here depends
 * on them: every element carries its own literal colour.
 */
const STYLE = `text { font-family: ${FONT}; }`;

function svg(width: number, height: number, label: string, body: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" `,
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">`,
    `<title>${esc(label)}</title>`,
    `<style>${STYLE}</style>`,
    // The surface comes first and covers everything. Without it the chart
    // inherits whatever the host page uses, which is how pale grey labels ended
    // up on npm's white README.
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" ` +
      `fill="${CHART_PALETTE.bg}" stroke="${CHART_PALETTE.border}" stroke-width="1"/>`,
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
    `<text x="${PAD}" y="24" class="f-fg" fill="${CHART_PALETTE.fg}" font-size="14" font-weight="700">${TITLE}</text>`,
  );
  parts.push(
    `<text x="${PAD}" y="42" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="11">${SUBTITLE}</text>`,
  );

  // Column headers, rotated so the grid stays narrow enough to read on a phone.
  results.forEach((r, c) => {
    const x = PAD + LABEL_W + c * CELL + CELL / 2;
    const y = HEAD_H - 8;
    parts.push(
      `<text x="${x}" y="${y}" class="f-fg" fill="${CHART_PALETTE.fg}" font-size="11" text-anchor="start" ` +
        `transform="rotate(-${ANGLE_DEG} ${x} ${y})">${esc(r.subject)}</text>`,
    );
  });

  COLLISION_PROBES.forEach((probe, i) => {
    const y = HEAD_H + i * ROW_H;
    parts.push(
      `<text x="${PAD + LABEL_W - 8}" y="${y + ROW_H / 2 + 4}" class="f-fg" fill="${CHART_PALETTE.fg}" font-size="11" text-anchor="end">${esc(probe.id)}</text>`,
    );

    results.forEach((r, c) => {
      const verdict = r.findings.find((f) => f.probe === probe.id)?.verdict;
      const x = PAD + LABEL_W + c * CELL;

      // A refusal is not a failure: the two values are still told apart, which
      // is the only thing this suite asks. Only "collides" is scored against.
      const cell =
        verdict === "collides"
          ? { bg: CHART_PALETTE.badBg, bgc: "f-badbg", fg: CHART_PALETTE.bad, fgc: "f-bad", glyph: "×" }
          : verdict === "distinct"
            ? { bg: CHART_PALETTE.okBg, bgc: "f-okbg", fg: CHART_PALETTE.ok, fgc: "f-ok", glyph: "·" }
            : { bg: CHART_PALETTE.refusedBg, bgc: "f-refusedbg", fg: CHART_PALETTE.refused, fgc: "f-refused", glyph: "–" };

      parts.push(
        `<rect x="${x + 1}" y="${y + 1}" width="${CELL - 2}" height="${ROW_H - 2}" rx="3" ` +
          `class="${cell.bgc} s-grid" fill="${cell.bg}" stroke="${CHART_PALETTE.grid}" stroke-width="0.5"/>`,
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
    `<text x="${PAD + LABEL_W - 8}" y="${totalsY}" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="11" text-anchor="end">total</text>`,
  );
  results.forEach((r, c) => {
    const x = PAD + LABEL_W + c * CELL + CELL / 2;
    const clean = r.collisions === 0;
    parts.push(
      `<text x="${x}" y="${totalsY}" class="${clean ? "f-ok" : "f-bad"}" fill="${clean ? CHART_PALETTE.ok : CHART_PALETTE.bad}" ` +
        `font-size="12" text-anchor="middle" font-weight="700">${r.collisions}</text>`,
    );
  });

  const legendY = totalsY + 26;
  const legend: Array<[string, string, string, string]> = [
    ["×", CHART_PALETTE.bad, "f-bad", "collides"],
    ["·", CHART_PALETTE.ok, "f-ok", "distinct"],
    ["–", CHART_PALETTE.refused, "f-refused", "refused (acceptable)"],
  ];
  let lx = PAD;
  for (const [glyph, colour, cls, text] of legend) {
    parts.push(`<text x="${lx}" y="${legendY}" class="${cls}" fill="${colour}" font-size="12">${glyph}</text>`);
    parts.push(
      `<text x="${lx + 14}" y="${legendY}" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="11">${esc(text)}</text>`,
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
    `<text x="${PAD}" y="24" class="f-fg" fill="${CHART_PALETTE.fg}" font-size="14" font-weight="700">${TITLE}</text>`,
  );
  parts.push(
    `<text x="${PAD}" y="42" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="11">${SUBTITLE}</text>`,
  );

  const axisBottom = HEAD_H + results.length * ROW_H;
  for (let v = 2000; v < scaleMax; v += 2000) {
    const x = PAD + LABEL_W + (v / scaleMax) * BAR_W;
    parts.push(
      `<line x1="${x}" y1="${HEAD_H - 8}" x2="${x}" y2="${axisBottom}" class="s-grid" ` +
        `stroke="${CHART_PALETTE.grid}" stroke-width="1" stroke-dasharray="2 3"/>`,
    );
    parts.push(
      `<text x="${x}" y="${axisBottom + 16}" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="10" text-anchor="middle">${v.toLocaleString("en-US")}</text>`,
    );
  }

  // One gradient for every unbounded bar rather than one per row.
  parts.push(
    `<defs><linearGradient id="sc-unbounded" x1="0" x2="1">` +
      `<stop offset="0" class="p-accent" stop-color="${CHART_PALETTE.accent}" stop-opacity="1"/>` +
      `<stop offset="1" class="p-accent" stop-color="${CHART_PALETTE.accent}" stop-opacity="0.2"/>` +
      `</linearGradient></defs>`,
  );

  results.forEach((r, i) => {
    const y = HEAD_H + i * ROW_H;
    const cy = y + ROW_H / 2;
    parts.push(
      `<text x="${PAD + LABEL_W - 8}" y="${cy + 4}" class="f-fg" fill="${CHART_PALETTE.fg}" font-size="11" text-anchor="end">${esc(r.subject)}</text>`,
    );

    if (Number.isFinite(r.maxDepth)) {
      const w = Math.max(2, (r.maxDepth / scaleMax) * BAR_W);
      parts.push(
        `<rect x="${PAD + LABEL_W}" y="${y + 6}" width="${w}" height="${ROW_H - 14}" rx="2" class="f-bar" fill="${CHART_PALETTE.bar}"/>`,
      );
      parts.push(
        `<text x="${PAD + LABEL_W + w + 8}" y="${cy + 4}" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="11">${r.maxDepth.toLocaleString("en-US")}</text>`,
      );
    } else {
      // Runs to the edge and fades, with an arrow: no limit was found, so no
      // length is claimed.
      const endX = PAD + LABEL_W + BAR_W;
      parts.push(
        `<rect x="${PAD + LABEL_W}" y="${y + 6}" width="${BAR_W}" height="${ROW_H - 14}" rx="2" fill="url(#sc-unbounded)"/>`,
      );
      parts.push(
        `<path d="M ${endX + 4} ${cy - 5} L ${endX + 13} ${cy} L ${endX + 4} ${cy + 5} Z" class="f-accent" fill="${CHART_PALETTE.accent}"/>`,
      );
      parts.push(
        `<text x="${endX + 18}" y="${cy + 4}" class="f-accent" fill="${CHART_PALETTE.accent}" font-size="11">unbounded</text>`,
      );
    }
  });

  return svg(width, height, "Nesting depth handled before failure, by implementation", parts.join(""));
}

// ------------------------------------------------------------------ scaling

/**
 * Fitted growth exponent per implementation, with reference lines at linear and
 * quadratic.
 *
 * A chart of the raw curves would be ten overlapping lines and unreadable; this
 * plots the one number each curve reduces to, and the report keeps every timing
 * so the reduction stays checkable. Bars whose fit is poor are drawn hollow,
 * because an exponent with a bad r-squared is not a measurement worth reading
 * as one, and hiding that behind a confident solid bar would be the exact sin
 * this harness was built to catch.
 */
export function scalingChart(
  results: ReadonlyArray<ScalingResult>,
  axis: "depth" | "width" = "depth",
): string {
  const LABEL_W = 208;
  const PAD = 16;
  const PLOT_W = 420;
  const ROW_H = 30;
  const HEAD_H = 66;

  const TITLE = `Growth exponent by ${axis}: 1 is linear, 2 is quadratic`;
  const SUBTITLE =
    "Slope of log(time) against log(size). Hollow bars are fits too poor to read as a measurement.";

  const rows = results.map((r) => ({
    subject: r.subject,
    series: r.series.find((s) => s.axis === axis),
  }));

  const barsWidth = PAD + LABEL_W + PLOT_W + 96;
  const textWidth = PAD + Math.max(textPx(TITLE, 14), textPx(SUBTITLE, 11)) + PAD;
  const width = Math.ceil(Math.max(barsWidth, textWidth));
  const height = HEAD_H + rows.length * ROW_H + 44;

  // Fixed 0..2.5 axis so the chart means the same thing between runs and
  // between subjects. An exponent past the axis is clamped and marked.
  const AXIS_MAX = 2.5;
  const x0 = PAD + LABEL_W;
  const at = (v: number) => x0 + (Math.min(v, AXIS_MAX) / AXIS_MAX) * PLOT_W;
  const axisBottom = HEAD_H + rows.length * ROW_H;

  const parts: string[] = [];
  parts.push(
    `<text x="${PAD}" y="24" class="f-fg" fill="${CHART_PALETTE.fg}" font-size="14" font-weight="700">${TITLE}</text>`,
  );
  parts.push(
    `<text x="${PAD}" y="42" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="11">${SUBTITLE}</text>`,
  );

  for (const [v, label] of [[1, "linear"], [2, "quadratic"]] as Array<[number, string]>) {
    const x = at(v);
    parts.push(
      `<line x1="${x}" y1="${HEAD_H - 8}" x2="${x}" y2="${axisBottom}" class="s-grid" ` +
        `stroke="${CHART_PALETTE.grid}" stroke-width="1" stroke-dasharray="3 3"/>`,
    );
    parts.push(
      `<text x="${x}" y="${axisBottom + 16}" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="10" text-anchor="middle">${label}</text>`,
    );
  }

  rows.forEach((row, i) => {
    const y = HEAD_H + i * ROW_H;
    const cy = y + ROW_H / 2;
    parts.push(
      `<text x="${x0 - 8}" y="${cy + 4}" class="f-fg" fill="${CHART_PALETTE.fg}" font-size="11" text-anchor="end">${esc(row.subject)}</text>`,
    );

    const s = row.series;
    if (!s || !Number.isFinite(s.exponent)) {
      parts.push(
        `<text x="${x0 + 4}" y="${cy + 4}" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="11">not measured</text>`,
      );
      return;
    }

    const solid = s.rSquared >= 0.85;
    // Quadratic-or-worse is the finding this chart exists to surface, so it is
    // the one that gets the alarming colour.
    const colour = s.exponent >= 1.6 ? CHART_PALETTE.bad : CHART_PALETTE.bar;
    const cls = s.exponent >= 1.6 ? "f-bad" : "f-bar";
    const w = Math.max(2, at(s.exponent) - x0);

    parts.push(
      solid
        ? `<rect x="${x0}" y="${y + 6}" width="${w}" height="${ROW_H - 14}" rx="2" class="${cls}" fill="${colour}"/>`
        : `<rect x="${x0}" y="${y + 6}" width="${w}" height="${ROW_H - 14}" rx="2" fill="none" ` +
          `class="s-grid" stroke="${colour}" stroke-width="1.5" stroke-dasharray="3 2"/>`,
    );
    const over = s.exponent > AXIS_MAX ? "+" : "";
    parts.push(
      `<text x="${x0 + w + 8}" y="${cy + 4}" class="f-muted" fill="${CHART_PALETTE.muted}" font-size="11">` +
        `${s.exponent.toFixed(2)}${over}${solid ? "" : " (poor fit)"}</text>`,
    );
  });

  return svg(width, height, `Growth exponent by ${axis}, by implementation`, parts.join(""));
}
