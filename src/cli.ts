#!/usr/bin/env node
// serializer-conformance CLI.
//
// Argument handling is citty's job, not ours. The first draft parsed argv by
// hand and silently swallowed the first positional whenever `--only` was
// absent, so `serializer-conformance conformance` quietly ran the default suites instead.
// That class of bug is exactly what a parser library is for.
//
// The report itself stays plain markdown. Colour is applied only when stdout is
// a TTY, so piping to a file or a pull request produces clean text with no
// escape codes in it.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defineCommand, runMain } from "citty";
import pc from "picocolors";

import { builtinSubjects } from "./adapters.js";
import { collisionChart, depthChart } from "./charts.js";
import {
  runCollisions,
  runConformance,
  runCoverage,
  runDepth,
  runDeterminism,
} from "./suites.js";
import {
  reportCollisions,
  reportConformance,
  reportCoverage,
  reportDepth,
  reportDeterminism,
  reportHeader,
} from "./report.js";
import type { Subject } from "./types.js";

const SUITES = ["conformance", "collisions", "determinism", "coverage", "depth"] as const;
type SuiteName = (typeof SUITES)[number];
const DEFAULT_SUITES: SuiteName[] = ["conformance", "collisions", "determinism"];

const isTTY = process.stdout.isTTY === true;
const note = (s: string) => (isTTY ? pc.dim(s) : s);
const bad = (s: string) => (isTTY ? pc.red(s) : s);

/** Colour the verdicts in a finished markdown report, for terminal reading only. */
function colourize(markdown: string): string {
  if (!isTTY) return markdown;
  return markdown
    .replace(/\bCOLLIDES\b/g, pc.red("COLLIDES"))
    .replace(/\bTHREW\b/g, pc.yellow("THREW"))
    .replace(/\bconformant\b/g, pc.green("conformant"))
    .replace(/\bunbounded\b/g, pc.green("unbounded"))
    .replace(/^(#{1,3} .*)$/gm, (m) => pc.bold(m));
}

/** Progress on stderr so it never contaminates a piped report. */
function progress(message: string): void {
  if (isTTY) process.stderr.write(note(`  ${message}\n`));
}

const main = defineCommand({
  meta: {
    name: "serializer-conformance",
    version: "0.2.0",
    description:
      "Conformance and collision harness for JavaScript value serializers: JSON canonicalizers and " +
      "structural hashers. Measures whatever supported packages are installed: nothing is bundled, " +
      "nothing is pinned.",
  },
  args: {
    suites: {
      type: "positional",
      required: false,
      description: `which suites to run (${SUITES.join(", ")}, or "all"). Default: ${DEFAULT_SUITES.join(", ")}`,
    },
    only: {
      type: "string",
      description: "comma-separated implementation names to restrict to",
    },
    list: {
      type: "boolean",
      description: "list the implementations found and exit",
    },
    svg: {
      type: "string",
      description:
        "also write SVG charts for the collision and depth suites into this directory",
    },
  },
  async run({ args }) {
    // citty binds only the first positional to `args.suites`, so multi-suite
    // invocations need the full list. It is `args._`, NOT a hand-filter over
    // rawArgs: an earlier version took every token not starting with "-", which
    // also swept up the *values* of string flags, so `--only impronta.jcs` and
    // `--svg ./charts` were both read as suite names and rejected. Twice now
    // this CLI has been bitten by parsing argv itself. It does not do that.
    const positional = (args._ ?? []) as string[];

    const known = new Set<string>(SUITES);
    const unknown = positional.filter((p) => p !== "all" && !known.has(p));
    if (unknown.length) {
      process.stderr.write(bad(`unknown suite: ${unknown.join(", ")}\n`));
      process.stderr.write(`available: ${SUITES.join(", ")}, all\n`);
      process.exitCode = 2;
      return;
    }

    const suites: SuiteName[] = positional.includes("all")
      ? [...SUITES]
      : positional.length
        ? [...new Set(positional as SuiteName[])]
        : DEFAULT_SUITES;

    const only = typeof args.only === "string"
      ? args.only.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    const { subjects: all, missing } = await builtinSubjects();
    const subjects: Subject[] = only ? all.filter((s) => only.includes(s.name)) : all;

    if (args.list) {
      for (const s of all) process.stdout.write(`${s.name}\t${s.kind}\t${s.source ?? ""}\n`);
      if (missing.length) process.stderr.write(note(`not installed: ${missing.join(", ")}\n`));
      return;
    }

    if (!subjects.length) {
      process.stderr.write(bad(
        only
          ? `no implementation matched --only ${only.join(",")}\n` +
            `available: ${all.map((s) => s.name).join(", ") || "(none installed)"}\n`
          : "no implementations found. Install at least one of:\n" +
            "  canonicalize, json-canonicalize, safe-stable-stringify,\n" +
            "  fast-json-stable-stringify, ohash, stable-hash, object-hash\n",
      ));
      process.exitCode = 1;
      return;
    }

    const svgDir = typeof args.svg === "string" && args.svg ? args.svg : null;
    // Charts go to stderr-announced files, never into the report, so a piped
    // report stays plain text.
    const writeChart = (file: string, contents: string) => {
      const path = join(svgDir!, file);
      writeFileSync(path, contents, "utf8");
      process.stderr.write(note(`  wrote ${path}\n`));
    };
    if (svgDir) mkdirSync(svgDir, { recursive: true });

    let out = reportHeader(subjects, missing);

    if (suites.includes("conformance")) {
      progress("running conformance against the official RFC 8785 vectors");
      // Digests are excluded: a hash cannot be byte-compared to a canonical
      // string, and scoring them 0/6 would misrepresent what they attempt.
      const eligible = subjects.filter((s) => s.kind !== "hash");
      out += eligible.length
        ? reportConformance(eligible.map(runConformance)) + "\n"
        : "## RFC 8785 conformance\n\nNo canonicalizers selected; conformance does not apply to digests.\n\n";
    }

    // Computed once and reused for the exit code, rather than running the
    // suite twice and risking two different answers in one report.
    let collisionCount = 0;
    if (suites.includes("collisions")) {
      progress("probing for collisions");
      const results = subjects.map(runCollisions);
      collisionCount = results.reduce((n, r) => n + r.collisions, 0);
      out += reportCollisions(results) + "\n";
      if (svgDir) writeChart("collisions.svg", collisionChart(results));
    }
    if (suites.includes("determinism")) {
      progress("checking determinism");
      out += reportDeterminism(subjects.map(runDeterminism)) + "\n";
    }
    if (suites.includes("coverage")) {
      progress("building the type-coverage matrix");
      out += reportCoverage(subjects.map(runCoverage)) + "\n";
    }
    if (suites.includes("depth")) {
      progress("probing nesting depth (allocates deep objects, this one is slow)");
      const results = subjects.map((s) => runDepth(s));
      out += reportDepth(results) + "\n";
      if (svgDir) writeChart("depth.svg", depthChart(results));
    }

    process.stdout.write(colourize(out));

    // Non-zero on any collision, so this works as a CI gate on your own
    // implementation and not only as a report to read.
    process.exitCode = collisionCount > 0 ? 1 : 0;
  },
});

runMain(main);
