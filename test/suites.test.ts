// The harness measures other people's correctness, so its own has to be
// beyond question. These tests use synthetic subjects with known behaviour:
// if the arena cannot catch a collision it was handed on a plate, nothing it
// reports about a real library is worth reading.

import { describe, expect, it } from "vitest";
import { CASES, CASES_BY_ID, COLLISION_PROBES } from "../src/cases.js";
import { RFC8785_VECTORS } from "../src/vectors.js";
import {
  attempt,
  runCollisions,
  runConformance,
  runCoverage,
  runDepth,
  runDeterminism,
  runScaling,
  DEPTH_SIZES,
} from "../src/suites.js";
import type { Subject } from "../src/types.js";

/** A deliberately naive JSON-subset canonicalizer, correct enough to pass. */
const naiveJcs: Subject = {
  name: "naive-jcs",
  kind: "jcs",
  run: function canon(value: unknown): string {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("not finite");
    if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
    if (Array.isArray(value)) {
      return "[" + value.map((v) => canon(v === undefined ? null : v)).join(",") + "]";
    }
    const o = value as Record<string, unknown>;
    if (typeof (o as { toJSON?: unknown }).toJSON === "function") {
      return canon((o as { toJSON: () => unknown }).toJSON());
    }
    const parts: string[] = [];
    for (const k of Object.keys(o).sort()) {
      if (o[k] === undefined || typeof o[k] === "symbol") continue;
      parts.push(JSON.stringify(k) + ":" + canon(o[k]));
    }
    return "{" + parts.join(",") + "}";
  },
};

/** Collapses everything to a constant: maximally colliding. */
const alwaysSame: Subject = { name: "always-same", kind: "hash", run: () => "X" };

/** Keyed on allocation order, never on content: maximally non-deterministic. */
const identityCounter: Subject = (() => {
  let n = 0;
  return { name: "identity-counter", kind: "hash", run: () => `${++n}~` };
})();

describe("vectors", () => {
  it("embeds the six official RFC 8785 vectors", () => {
    expect(RFC8785_VECTORS.map((v) => v.name).sort()).toEqual([
      "arrays", "french", "structures", "unicode", "values", "weird",
    ]);
  });

  it("every vector's input parses and its expected output is non-empty", () => {
    for (const v of RFC8785_VECTORS) {
      expect(() => JSON.parse(v.input)).not.toThrow();
      expect(v.expected.length).toBeGreaterThan(0);
      expect(v.expected).not.toMatch(/\n$/);
    }
  });

  it("the weird vector really is the code-unit discriminator", () => {
    // U+1F602 must appear BEFORE U+FB33 in the canonical output. That ordering
    // holds for UTF-16 code units and fails for code points, which is the
    // whole reason this vector exists. If the embedded bytes ever stopped
    // exhibiting it, the suite would silently lose its sharpest check.
    const weird = RFC8785_VECTORS.find((v) => v.name === "weird")!;
    const smiley = weird.expected.indexOf("\u{1f602}");
    const dalet = weird.expected.indexOf("דּ");
    expect(smiley).toBeGreaterThan(-1);
    expect(dalet).toBeGreaterThan(-1);
    expect(smiley).toBeLessThan(dalet);
    expect("\u{1f602}".codePointAt(0)!).toBeGreaterThan(0xfb33); // ...and by code point it is the other way round
  });
});

describe("cases", () => {
  it("has unique ids", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every collision probe references cases that exist", () => {
    for (const p of COLLISION_PROBES) {
      expect(CASES_BY_ID.has(p.a), `${p.id}.a=${p.a}`).toBe(true);
      expect(CASES_BY_ID.has(p.b), `${p.id}.b=${p.b}`).toBe(true);
    }
  });

  it("every probe pairs two genuinely different values", () => {
    // Guards against a probe that accidentally compares a value with itself,
    // which would report a collision that is actually correct behaviour.
    for (const p of COLLISION_PROBES) {
      expect(p.a).not.toBe(p.b);
      expect(p.expectedToDiffer.length).toBeGreaterThan(20);
    }
  });

  it("make() returns a fresh allocation each call", () => {
    // Subjects that memoize on identity must not be handed the same reference
    // twice, or the determinism suite silently passes them.
    for (const c of CASES) {
      const a = c.make();
      const b = c.make();
      if (a !== null && typeof a === "object") expect(a).not.toBe(b);
    }
  });
});

describe("attempt", () => {
  it("records a throw as an outcome rather than propagating it", () => {
    const boom: Subject = { name: "boom", kind: "hash", run: () => { throw new Error("nope"); } };
    expect(attempt(boom, 1)).toEqual({ status: "threw", message: "nope" });
  });

  it("treats a non-string return as a failure", () => {
    const bad = { name: "bad", kind: "hash", run: () => 42 as unknown as string } as Subject;
    const out = attempt(bad, 1);
    expect(out.status).toBe("threw");
  });
});

describe("conformance", () => {
  it("passes a correct JSON-subset canonicalizer on all six vectors", () => {
    const r = runConformance(naiveJcs);
    expect(r.passed).toBe(r.total);
    expect(r.total).toBe(6);
  });

  it("catches a wrong sort order and reports where it diverged", () => {
    const reversed: Subject = {
      name: "reverse-sort",
      kind: "jcs",
      run: (v) => {
        const o = v as Record<string, unknown>;
        if (o === null || typeof o !== "object" || Array.isArray(o)) return JSON.stringify(v) as string;
        return "{" + Object.keys(o).sort().reverse()
          .map((k) => JSON.stringify(k) + ":" + JSON.stringify(o[k])).join(",") + "}";
      },
    };
    const r = runConformance(reversed);
    expect(r.passed).toBeLessThan(r.total);
    const failed = r.vectors.find((v) => !v.pass)!;
    expect(failed.divergedAt ?? failed.threw).toBeDefined();
  });

  it("records a thrown vector as a failure, not a crash", () => {
    const r = runConformance({ name: "x", kind: "jcs", run: () => { throw new Error("no"); } });
    expect(r.passed).toBe(0);
    expect(r.vectors.every((v) => v.threw === "no")).toBe(true);
  });
});

describe("collisions", () => {
  it("flags every probe for an implementation that collapses everything", () => {
    const r = runCollisions(alwaysSame);
    expect(r.collisions).toBe(COLLISION_PROBES.length);
    expect(r.findings.every((f) => f.verdict === "collides")).toBe(true);
  });

  it("finds the known Map-versus-object collision in a JSON-subset canonicalizer", () => {
    // This is the harness's headline finding, asserted against a subject whose
    // behaviour is fully known, so the assertion cannot drift with a dependency.
    const r = runCollisions(naiveJcs);
    const mapVsObject = r.findings.find((f) => f.probe === "map-vs-object")!;
    expect(mapVsObject.verdict).toBe("collides");
    expect(mapVsObject.output).toBe('{"v":{}}');
  });

  it("does not count a refusal as a collision", () => {
    const refuses: Subject = { name: "refuses", kind: "hash", run: () => { throw new Error("no"); } };
    const r = runCollisions(refuses);
    expect(r.collisions).toBe(0);
    expect(r.findings.every((f) => f.verdict === "both-threw")).toBe(true);
  });

  it("reports one-threw separately from a collision", () => {
    const onlyNumbers: Subject = {
      name: "only-numbers",
      kind: "hash",
      run: (v) => {
        const s = JSON.stringify(v);
        if (s === undefined) throw new Error("unsupported");
        return s;
      },
    };
    const r = runCollisions(onlyNumbers);
    expect(r.findings.some((f) => f.verdict === "one-threw" || f.verdict === "collides")).toBe(true);
  });
});

describe("determinism", () => {
  it("catches an identity-keyed implementation on every object case", () => {
    const r = runDeterminism(identityCounter);
    expect(r.unstable).toBeGreaterThan(0);
    // Every case is a fresh allocation, so a pure identity counter is unstable
    // on all of them.
    expect(r.unstable).toBe(CASES.length);
  });

  it("passes a content-addressed implementation", () => {
    const r = runDeterminism(naiveJcs);
    expect(r.unstable).toBe(0);
  });
});

describe("coverage", () => {
  it("produces one cell per case", () => {
    const r = runCoverage(naiveJcs);
    expect(r.cells).toHaveLength(CASES.length);
    expect(r.cells.map((c) => c.case)).toEqual(CASES.map((c) => c.id));
  });
});

describe("depth", () => {
  /**
   * Depth is measured against a subject with an ARTIFICIAL limit rather than
   * against the engine's real call stack. The stack size differs between plain
   * node and a vitest worker (the first version of this test asserted a bound
   * that held in one and not the other), so testing the probe against a real
   * RangeError makes the test a measurement of the runner, not of the code.
   */
  function limitedTo(limit: number): Subject {
    return {
      name: `limited-${limit}`,
      kind: "serializer",
      run: (v) => {
        let depth = 0;
        let cur = v;
        while (cur !== null && typeof cur === "object" && "a" in (cur as object)) {
          depth++;
          if (depth > limit) throw new RangeError("Maximum call stack size exceeded");
          cur = (cur as { a: unknown }).a;
        }
        return String(depth);
      },
    };
  }

  it("finds an exact known limit", () => {
    expect(runDepth(limitedTo(1_234), 100_000).maxDepth).toBe(1_234);
  });

  it("finds a limit that is an exact power of two", () => {
    // The exponential phase lands directly on the answer here, which is the
    // case most likely to be off by one.
    expect(runDepth(limitedTo(1_024), 100_000).maxDepth).toBe(1_024);
  });

  it("reports the failure mode", () => {
    const r = runDepth(limitedTo(500), 100_000);
    expect(r.failureMode).toMatch(/RangeError/);
  });

  it("reports unbounded only when the ceiling itself was handled", () => {
    const constant: Subject = { name: "constant", kind: "hash", run: () => "c" };
    expect(runDepth(constant, 4_096).maxDepth).toBe(Infinity);
  });

  it("does not call a limit below the ceiling unbounded", () => {
    // Guards the overshoot bug: doubling past the ceiling must not be mistaken
    // for having survived it. 3000 is deliberately not a power of two and sits
    // between 2048 and 4096, so a clamping mistake surfaces here.
    expect(runDepth(limitedTo(3_000), 4_096).maxDepth).toBe(3_000);
  });

  it("reports 0 when the subject cannot handle even depth 1", () => {
    const useless: Subject = { name: "useless", kind: "hash", run: () => { throw new Error("no"); } };
    expect(runDepth(useless, 1_000).maxDepth).toBe(0);
  });
});

describe("scaling", () => {
  /** Cost proportional to the work actually present in the value. */
  const linear: Subject = {
    name: "linear",
    kind: "serializer",
    run: (v) => JSON.stringify(v) ?? "",
  };

  it("reports linear work as an exponent near 1", () => {
    const depth = runScaling(linear).series.find((s) => s.axis === "depth")!;
    expect(depth.points.length).toBe(DEPTH_SIZES.length);
    // Timing on a shared CI box is noisy, so the band is wide. It still
    // separates linear from quadratic, which is all the suite claims to do.
    expect(depth.exponent).toBeGreaterThan(0.5);
    expect(depth.exponent).toBeLessThan(1.5);
  });

  it("is not fooled by a subject that memoizes on object identity", () => {
    // The regression this exists for. Reusing one input per size let a WeakMap
    // memoizer answer every timed repetition from cache, and the suite reported
    // exponent 0.00 with a perfect fit: a confident-looking measurement of
    // nothing. Each repetition now gets its own freshly built value.
    const seen = new WeakMap<object, string>();
    const memoizing: Subject = {
      name: "memoizing",
      kind: "hash",
      run: (v) => {
        if (typeof v === "object" && v !== null) {
          const hit = seen.get(v);
          if (hit !== undefined) return hit;
          const out = JSON.stringify(v) ?? "";
          seen.set(v, out);
          return out;
        }
        return String(v);
      },
    };

    const depth = runScaling(memoizing).series.find((s) => s.axis === "depth")!;
    // A memoizer that never sees the same object twice does the full work every
    // time, so its curve must look like the un-memoized one, not like a flat
    // line at zero.
    expect(depth.exponent).toBeGreaterThan(0.5);
  });

  it("records where a subject failed and fits only what it completed", () => {
    const shallow: Subject = {
      name: "shallow",
      kind: "serializer",
      run: (v) => {
        let d = 0;
        let cur: unknown = v;
        while (cur && typeof cur === "object" && "a" in (cur as object)) {
          cur = (cur as { a: unknown }).a;
          if (++d > 200) throw new RangeError("too deep");
        }
        return String(d);
      },
    };

    const depth = runScaling(shallow).series.find((s) => s.axis === "depth")!;
    expect(depth.failedAt).toBeDefined();
    expect(depth.points.every((p) => p.n < depth.failedAt!)).toBe(true);
  });

  it("refuses to fit fewer than three points", () => {
    const brittle: Subject = {
      name: "brittle",
      kind: "serializer",
      run: (v) => {
        const s = JSON.stringify(v) ?? "";
        if (s.length > 2_000) throw new Error("nope");
        return s;
      },
    };
    const depth = runScaling(brittle).series.find((s) => s.axis === "depth")!;
    if (depth.points.length < 3) expect(Number.isNaN(depth.exponent)).toBe(true);
  });

  it("records output length, which is deterministic unlike the timings", () => {
    const width = runScaling(linear).series.find((s) => s.axis === "width")!;
    const lengths = width.points.map((p) => p.outputLength);
    expect(lengths.every((l) => l > 0)).toBe(true);
    // More keys, longer output. Monotone by construction for any real subject.
    expect([...lengths].sort((a, b) => a - b)).toEqual(lengths);
  });
});
