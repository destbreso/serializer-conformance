// Reporters. Markdown, because the output of a comparison is meant to be
// pasted into an issue, a README or a post, and because a table diffs cleanly
// in version control when you re-run it against new versions.

import type {
  CollisionResult,
  ConformanceResult,
  CoverageResult,
  DepthResult,
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
  const rows = results.map((r) => [
    r.subject,
    `${r.passed}/${r.total}`,
    r.passed === r.total ? "conformant" : r.vectors.filter((v) => !v.pass).map((v) => v.name).join(", "),
  ]);

  let out = "## RFC 8785 conformance\n\n";
  out += "Byte-exact, against the official vectors from the reference implementation.\n\n";
  out += table(["implementation", "vectors", "result"], rows) + "\n";

  const failures = results.flatMap((r) =>
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
