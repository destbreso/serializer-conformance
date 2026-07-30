// Reporters. Markdown, because the output of a comparison is meant to be
// pasted into an issue, a README or a post, and because a table diffs cleanly
// in version control when you re-run it against new versions.

import type {
  CollisionResult,
  ConformanceResult,
  CoverageResult,
  DepthResult,
  ScalingResult,
  ScalingSeries,
  Subject,
} from "./types.js";
import { COLLISION_PROBES } from "./cases.js";

const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => "| " + cells.map((c, i) => pad(c ?? "", widths[i]!)).join(" | ") + " |";
  const sep = "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

/** Truncate an output for display without pretending it is complete. */
function show(s: string, max = 46): string {
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}

export function reportConformance(results: ReadonlyArray<ConformanceResult>): string {
  const rows = results.map((r) => {
    const claims = r.kind === "jcs";
    const verdict = r.passed === r.total
      ? "conformant"
      : claims
        ? `FAILS: ${r.vectors.filter((v) => !v.pass).map((v) => v.name).join(", ")}`
        : "n/a, makes no JCS claim";
    return [r.subject, claims ? "yes" : "no", `${r.passed}/${r.total}`, verdict];
  });

  let out = "## RFC 8785 conformance\n\n";
  out += "Byte-exact, against the official vectors from the reference implementation.\n\n";
  out += "Only implementations that **claim** JCS are held to this. The others are run\n";
  out += "anyway and their score shown, because a deterministic serializer that passes\n";
  out += "all six without claiming to is worth knowing about, and a format that is\n";
  out += "deliberately not JCS scoring zero is a description of what it is, not a fault.\n\n";
  out += table(["implementation", "claims JCS", "vectors", "result"], rows) + "\n";

  // Divergences are only shown for implementations that claim conformance:
  // dumping six diffs for a format that never promised JCS is noise.
  const failures = results.filter((r) => r.kind === "jcs").flatMap((r) =>
    r.vectors.filter((v) => !v.pass).map((v) => ({ subject: r.subject, v })),
  );
  if (failures.length) {
    out += "\n### Divergences\n\n";
    for (const { subject, v } of failures) {
      out += `**${subject}** on \`${v.name}\`\n\n`;
      if (v.threw) {
        out += `- threw: ${v.threw}\n\n`;
        continue;
      }
      const i = v.divergedAt ?? 0;
      const from = Math.max(0, i - 20);
      out += `- first difference at index ${i}\n`;
      out += `- expected \`…${show(v.expected!.slice(from, i + 30), 60)}\`\n`;
      out += `- actual   \`…${show(v.actual!.slice(from, i + 30), 60)}\`\n\n`;
    }
  }
  return out;
}

export function reportCollisions(results: ReadonlyArray<CollisionResult>): string {
  const mark = (verdict: string) =>
    verdict === "collides" ? "COLLIDES" : verdict === "distinct" ? "ok" : verdict;

  const headers = ["probe", ...results.map((r) => r.subject)];
  const rows = COLLISION_PROBES.map((probe) => [
    probe.id,
    ...results.map((r) => mark(r.findings.find((f) => f.probe === probe.id)?.verdict ?? "?")),
  ]);

  let out = "## Collisions\n\n";
  out += "Distinct inputs that must not produce identical output. `COLLIDES` is a\n";
  out += "silent failure: nothing throws, the cache key simply matches when it should\n";
  out += "not. `both-threw` and `one-threw` are acceptable, the values are still told apart.\n\n";
  out += table(headers, rows) + "\n";

  const totals = results.map((r) => [r.subject, String(r.collisions)]);
  out += "\n" + table(["implementation", "collisions"], totals) + "\n";

  out += "\n### What each probe asserts\n\n";
  for (const p of COLLISION_PROBES) {
    out += `- \`${p.id}\`: ${p.expectedToDiffer}\n`;
  }
  return out + "\n";
}

export function reportDeterminism(
  results: ReadonlyArray<{ subject: string; unstable: number; findings: ReadonlyArray<{ case: string; stable: boolean }> }>,
): string {
  let out = "## Determinism\n\n";
  out += "The same value, built twice, must produce the same output. A failure here\n";
  out += "means the implementation is keyed on object identity rather than content,\n";
  out += "which no collision test can detect.\n\n";
  out += table(
    ["implementation", "unstable cases", "which"],
    results.map((r) => [
      r.subject,
      String(r.unstable),
      r.findings.filter((f) => !f.stable).map((f) => f.case).join(", ") || "none",
    ]),
  );
  return out + "\n";
}

export function reportDepth(results: ReadonlyArray<DepthResult>): string {
  let out = "## Nesting depth\n\n";
  out += "Deepest input handled before failure. Engine stack limits vary between runs,\n";
  out += "so these are orders of magnitude. `unbounded` means the probe ceiling was\n";
  out += "reached without failing, which is the signature of an iterative kernel.\n\n";
  out += table(
    ["implementation", "max depth", "failure"],
    results.map((r) => [
      r.subject,
      r.maxDepth === Infinity ? "unbounded" : r.maxDepth.toLocaleString("en-US"),
      r.failureMode ?? "",
    ]),
  );
  return out + "\n";
}

export function reportCoverage(results: ReadonlyArray<CoverageResult>): string {
  const caseIds = results[0]?.cells.map((c) => c.case) ?? [];
  const headers = ["case", ...results.map((r) => r.subject)];
  const rows = caseIds.map((id) => [
    id,
    ...results.map((r) => {
      const cell = r.cells.find((c) => c.case === id);
      if (!cell) return "?";
      return cell.outcome.status === "threw" ? "THREW" : show(cell.outcome.output, 30);
    }),
  ]);

  let out = "## Type coverage\n\n";
  out += "What each implementation actually produces, unjudged. `THREW` is not a\n";
  out += "failure: refusing a value the format cannot represent is often the correct\n";
  out += "answer, and always better than inventing one.\n\n";
  return out + table(headers, rows) + "\n";
}

export function reportHeader(subjects: ReadonlyArray<Subject>, missing: ReadonlyArray<string>): string {
  let out = "# serializer-conformance report\n\n";
  out += table(
    ["implementation", "kind", "source"],
    subjects.map((s) => [s.name, s.kind, s.source ?? ""]),
  ) + "\n";
  if (missing.length) {
    out += `\nNot measured (not installed): ${missing.join(", ")}\n`;
  }
  const noted = subjects.filter((s) => s.note);
  if (noted.length) {
    out += "\n### Notes\n\n";
    for (const s of noted) out += `- **${s.name}**: ${s.note}\n`;
  }
  return out + "\n";
}

/**
 * Classification, deliberately coarse.
 *
 * Over the size range measured (a 16x spread) an n log n curve fits at roughly
 * 1.1, which is not separable from linear given the noise in a handful of
 * timings. So the bands are wide and the middle one is named for the ambiguity
 * rather than pretending to resolve it. The exponent is printed alongside, so a
 * reader who wants the number is not stuck with the label.
 */
function describeExponent(exponent: number, rSquared: number): string {
  if (!Number.isFinite(exponent)) return "not measured";
  if (rSquared < 0.85) return "no clean power law";
  if (exponent < 1.2) return "linear";
  if (exponent < 1.6) return "superlinear";
  return "quadratic or worse";
}

export function reportScaling(results: ReadonlyArray<ScalingResult>): string {
  const cell = (s?: ScalingSeries) => {
    if (!s || !Number.isFinite(s.exponent)) return "n/a";
    return `${s.exponent.toFixed(2)} (r²${s.rSquared.toFixed(2)})`;
  };
  const verdict = (s?: ScalingSeries) =>
    s ? describeExponent(s.exponent, s.rSquared) : "not measured";

  const rows = results.map((r) => {
    const depth = r.series.find((s) => s.axis === "depth");
    const width = r.series.find((s) => s.axis === "width");
    const note = [depth, width]
      .filter((s): s is ScalingSeries => Boolean(s?.failedAt))
      .map((s) => `threw at ${s.axis} ${s.failedAt!.toLocaleString("en-US")}`)
      .join("; ");
    return [
      r.subject,
      cell(depth),
      verdict(depth),
      cell(width),
      verdict(width),
      note,
    ];
  });

  let out = "## Scaling\n\n";
  out += "How cost grows with input size. The exponent is the slope of log(time)\n";
  out += "against log(size), so 1 is linear and 2 is quadratic, and r² says how well\n";
  out += "the points actually fit a power law: a low r² means the exponent should not\n";
  out += "be quoted on its own.\n\n";
  out += "This measures the *shape*, not a winner. Absolute throughput across these\n";
  out += "subjects would compare unlike things, because a hasher does strictly more\n";
  out += "work than a serializer: it also hashes. The exponent is comparable in a way\n";
  out += "the constant is not.\n\n";
  out += "Surviving deep input by taking thirty seconds over it is not surviving it.\n";
  out += "A quadratic kernel is a denial of service that moved from the call stack to\n";
  out += "the clock, and this suite is where that shows up.\n\n";
  out += table(
    ["implementation", "depth exp.", "depth", "width exp.", "width", "notes"],
    rows,
  ) + "\n";

  // The raw timings, so the fit above is checkable rather than trusted.
  for (const axis of ["depth", "width"] as const) {
    const sizes = results
      .flatMap((r) => r.series.find((s) => s.axis === axis)?.points.map((p) => p.n) ?? [])
      .filter((n, i, a) => a.indexOf(n) === i)
      .sort((a, b) => a - b);
    if (!sizes.length) continue;

    out += `\n### Milliseconds by ${axis}\n\n`;
    out += table(
      ["implementation", ...sizes.map((n) => n.toLocaleString("en-US"))],
      results.map((r) => {
        const series = r.series.find((s) => s.axis === axis);
        return [
          r.subject,
          ...sizes.map((n) => {
            const p = series?.points.find((q) => q.n === n);
            return p ? p.ms.toFixed(2) : "-";
          }),
        ];
      }),
    ) + "\n";
  }

  // Output length is a cost too, and unlike time it is exactly reproducible.
  const widest = Math.max(
    0,
    ...results.flatMap((r) => r.series.find((s) => s.axis === "width")?.points.map((p) => p.n) ?? []),
  );
  if (widest > 0) {
    out += `\n### Output length at ${widest.toLocaleString("en-US")} keys\n\n`;
    out += "Deterministic, unlike the timings. A canonical form twice as long costs\n";
    out += "twice as much in the store it is written to and on the wire. A digest is\n";
    out += "constant-length by construction, which is a real advantage and not a\n";
    out += "better score at the same game.\n\n";
    out += table(
      ["implementation", "characters"],
      results.map((r) => {
        const p = r.series.find((s) => s.axis === "width")?.points.find((q) => q.n === widest);
        return [r.subject, p ? p.outputLength.toLocaleString("en-US") : "-"];
      }),
    ) + "\n";
  }
  return out;
}
