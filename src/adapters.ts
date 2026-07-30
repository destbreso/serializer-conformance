// Adapters for the popular npm implementations.
//
// Every one is loaded dynamically and skipped if it is not installed, so the
// harness runs with any subset present. That matters for a neutral tool: it
// must not force you to install seven packages to measure one, and it must not
// pin versions, because the thing being measured is whatever you actually have.
//
// Adapters are deliberately thin. The rule is to call each library the way its
// README tells you to and record what comes back, with no normalization, no
// "fixing up" of output, and no opinion. A harness that quietly repairs a
// subject's answer is measuring itself.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Subject } from "./types.js";

const require = createRequire(import.meta.url);

/**
 * Resolve an installed package's version.
 *
 * The obvious `require("<pkg>/package.json")` fails for any package whose
 * `exports` map does not expose it, which is most modern ones. So: try that
 * first, then fall back to resolving the entry point and walking up to the
 * nearest package.json whose name matches. Reporting "canonicalize" without a
 * version in a comparison table is a real loss, since the whole point is that
 * you can re-run this later and see what changed.
 */
function versionOf(pkg: string): string | undefined {
  try {
    return require(`${pkg}/package.json`).version as string;
  } catch {
    /* exports map hides it; fall through */
  }
  try {
    let dir = dirname(require.resolve(pkg));
    for (let i = 0; i < 12; i++) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string; version?: string };
        if (parsed.name === pkg) return parsed.version;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* not resolvable through require: pure-ESM packages land here */
  }
  // Last resort: walk up from the current directory looking for the package in
  // a node_modules tree. Pure-ESM packages are invisible to require.resolve,
  // and `canonicalize`, the reference JCS implementation, is exactly one of
  // those, so this branch is load-bearing rather than defensive.
  try {
    let dir = process.cwd();
    for (let i = 0; i < 12; i++) {
      const candidate = join(dir, "node_modules", pkg, "package.json");
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
        if (parsed.version) return parsed.version;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* give up: the table shows the name without a version */
  }
  return undefined;
}

function source(pkg: string): string {
  const v = versionOf(pkg);
  return v ? `${pkg}@${v}` : pkg;
}

interface AdapterSpec {
  pkg: string;
  name?: string;
  kind: Subject["kind"];
  note?: string;
  build: (mod: any) => (value: unknown) => string;
}

const SPECS: ReadonlyArray<AdapterSpec> = [
  {
    pkg: "canonicalize",
    kind: "jcs",
    note: "the reference JCS implementation for JavaScript; produces the string only, never a digest",
    build: (mod) => {
      const fn = mod.default ?? mod;
      return (v) => fn(v) as string;
    },
  },
  {
    pkg: "json-canonicalize",
    kind: "jcs",
    note: "also exposes canonicalizeEx with include/exclude and a circular-reference policy",
    build: (mod) => {
      const fn = mod.canonicalize ?? mod.default?.canonicalize;
      return (v) => fn(v) as string;
    },
  },
  {
    pkg: "safe-stable-stringify",
    kind: "serializer",
    note: "deterministic and circular-safe; does not claim RFC 8785",
    build: (mod) => {
      const fn = mod.default ?? mod;
      return (v) => fn(v) as string;
    },
  },
  {
    pkg: "fast-json-stable-stringify",
    kind: "serializer",
    note: "the most-downloaded deterministic stringifier; does not claim RFC 8785",
    build: (mod) => {
      const fn = mod.default ?? mod;
      return (v) => fn(v) as string;
    },
  },
  {
    pkg: "ohash",
    name: "ohash.serialize",
    kind: "serializer",
    note: "the serialization step behind ohash's digest, measured directly so its type handling is visible",
    build: (mod) => {
      const fn = mod.serialize ?? mod.default?.serialize;
      return (v) => fn(v) as string;
    },
  },
  {
    pkg: "ohash",
    name: "ohash.hash",
    kind: "hash",
    build: (mod) => {
      const fn = mod.hash ?? mod.default?.hash;
      return (v) => fn(v) as string;
    },
  },
  {
    pkg: "stable-hash",
    kind: "hash",
    note:
      "assigns a per-process identity token to anything whose constructor is not exactly Array or Object, " +
      "so Map/Set/TypedArray/class instances are compared by reference, not content. Its README also " +
      "documents hash(1) === hash(1n). Both are deliberate for its origin (SWR dependency keys), and both " +
      "make it unsuitable as a content hash.",
    build: (mod) => {
      const fn = mod.default ?? mod;
      return (v) => fn(v) as string;
    },
  },
  {
    pkg: "object-hash",
    kind: "hash",
    build: (mod) => {
      const fn = mod.default ?? mod;
      return (v) => fn(v) as string;
    },
  },
  // impronta is written by the author of this harness. It gets no special
  // treatment: same dynamic load, same skip-if-absent, same thin adapter, same
  // suites, listed last so the table does not read as a leaderboard with a
  // favourite on top. A good score here is only worth something because the
  // harness would report its collisions exactly as loudly as anyone else's.
  {
    pkg: "impronta",
    name: "impronta.imprint",
    kind: "serializer",
    note: "extended mode: the whole JavaScript value graph, type-tagged and length-prefixed",
    build: (mod) => {
      const fn = mod.imprint ?? mod.default?.imprint;
      return (v) => fn(v) as string;
    },
  },
  {
    pkg: "impronta",
    name: "impronta.jcs",
    kind: "jcs",
    note:
      "strict RFC 8785 mode: refuses what JSON cannot express, and inherits JSON's own conflations " +
      "(a Date and its ISO string are the same JSON document, so they must collide here)",
    build: (mod) => {
      const fn = mod.jcs ?? mod.default?.jcs;
      return (v) => fn(v) as string;
    },
  },
];

/**
 * Load every built-in adapter whose package resolves. Missing packages are
 * skipped silently; `missing` reports them so a CLI can say what it did not
 * measure, because a report that hides its own gaps is worse than no report.
 */
export async function builtinSubjects(): Promise<{ subjects: Subject[]; missing: string[] }> {
  const subjects: Subject[] = [];
  const missing: string[] = [];

  for (const spec of SPECS) {
    let mod: unknown;
    try {
      mod = await import(spec.pkg);
    } catch {
      if (!missing.includes(spec.pkg)) missing.push(spec.pkg);
      continue;
    }
    let run: (value: unknown) => string;
    try {
      run = spec.build(mod);
      if (typeof run !== "function") throw new Error("adapter did not resolve to a function");
    } catch {
      if (!missing.includes(spec.pkg)) missing.push(spec.pkg);
      continue;
    }
    subjects.push({
      name: spec.name ?? spec.pkg,
      kind: spec.kind,
      run,
      source: source(spec.pkg),
      ...(spec.note ? { note: spec.note } : {}),
    });
  }

  return { subjects, missing };
}

/** Wrap your own implementation to put it in the arena. */
export function defineSubject(subject: Subject): Subject {
  return subject;
}
