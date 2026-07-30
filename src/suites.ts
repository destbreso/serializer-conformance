// The four suites. Each answers one question and refuses to answer any other.

import { CASES, CASES_BY_ID, COLLISION_PROBES } from "./cases.js";
import { RFC8785_VECTORS } from "./vectors.js";
import type {
  CollisionResult,
  ConformanceResult,
  CoverageResult,
  DepthResult,
  Outcome,
  Subject,
} from "./types.js";

/** Run a subject once, converting a throw into a recorded outcome. */
export function attempt(subject: Subject, value: unknown): Outcome {
  try {
    const output = subject.run(value);
    if (typeof output !== "string") {
      return { status: "threw", message: `returned ${typeof output}, expected string` };
    }
    return { status: "ok", output };
  } catch (err) {
    return { status: "threw", message: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------- conformance

/**
 * Byte-exact RFC 8785 conformance against the official vectors.
 *
 * Only `kind: "jcs"` subjects are *held* to this, but any serializer can be
 * run through it, and several that make no JCS claim pass anyway. That is a
 * finding, not a formality: it means conformance alone does not distinguish
 * these libraries, and a package selling itself on conformance is selling
 * something the field already has.
 */
export function runConformance(subject: Subject): ConformanceResult {
  const vectors = RFC8785_VECTORS.map((vec) => {
    const value = JSON.parse(vec.input);
    const outcome = attempt(subject, value);

    if (outcome.status === "threw") {
      return { name: vec.name, pass: false, threw: outcome.message };
    }
    if (outcome.output === vec.expected) {
      return { name: vec.name, pass: true };
    }
    let i = 0;
    while (i < vec.expected.length && vec.expected[i] === outcome.output[i]) i++;
    return {
      name: vec.name,
      pass: false,
      divergedAt: i,
      expected: vec.expected,
      actual: outcome.output,
    };
  });

  return {
    subject: subject.name,
    vectors,
    passed: vectors.filter((v) => v.pass).length,
    total: vectors.length,
  };
}

// --------------------------------------------------------------- collisions

/**
 * The sharpest instrument here: distinct inputs that produce identical output.
 *
 * Verdicts, and why each is what it is:
 *
 *   distinct    the two values map to two strings. Correct.
 *   collides    the two values map to one string. This is the failure the
 *               suite exists for, and it is silent at the call site: nothing
 *               throws, nothing warns, the cache simply returns the wrong
 *               entry or the signature verifies over data that was not signed.
 *   both-threw  refused both. Acceptable: a library entitled to say "I do not
 *               model this type" has said so, loudly, which is the honest
 *               alternative to guessing.
 *   one-threw   accepted one and refused the other. Not a collision, and not
 *               a defect: the two are still told apart.
 */
export function runCollisions(subject: Subject): CollisionResult {
  const findings = COLLISION_PROBES.map((probe) => {
    const caseA = CASES_BY_ID.get(probe.a);
    const caseB = CASES_BY_ID.get(probe.b);
    if (!caseA || !caseB) {
      throw new Error(`collision probe ${probe.id} references an unknown case`);
    }

    // Fresh allocations for both sides: a subject that memoizes on object
    // identity must not be handed the same reference twice.
    const outA = attempt(subject, caseA.make());
    const outB = attempt(subject, caseB.make());

    if (outA.status === "threw" && outB.status === "threw") {
      return { probe: probe.id, verdict: "both-threw" as const, expectedToDiffer: probe.expectedToDiffer };
    }
    if (outA.status === "threw" || outB.status === "threw") {
      return { probe: probe.id, verdict: "one-threw" as const, expectedToDiffer: probe.expectedToDiffer };
    }
    if (outA.output === outB.output) {
      return {
        probe: probe.id,
        verdict: "collides" as const,
        expectedToDiffer: probe.expectedToDiffer,
        output: outA.output,
      };
    }
    return { probe: probe.id, verdict: "distinct" as const, expectedToDiffer: probe.expectedToDiffer };
  });

  return {
    subject: subject.name,
    findings,
    collisions: findings.filter((f) => f.verdict === "collides").length,
  };
}

/**
 * The other identity failure, and the one nobody looks for: two *structurally
 * identical* values that produce *different* output.
 *
 * A content hash promises that equal values hash equally. An implementation
 * that falls back to object identity breaks that promise without ever
 * colliding, so the collision suite cannot see it. Here it is caught by
 * building the same value twice and requiring the same answer.
 */
export function runDeterminism(subject: Subject): {
  subject: string;
  findings: ReadonlyArray<{ case: string; stable: boolean; first?: string; second?: string }>;
  unstable: number;
} {
  const findings = CASES.map((c) => {
    const first = attempt(subject, c.make());
    const second = attempt(subject, c.make());

    if (first.status === "threw" && second.status === "threw") {
      return { case: c.id, stable: true };
    }
    if (first.status === "threw" || second.status === "threw") {
      return { case: c.id, stable: false };
    }
    if (first.output === second.output) return { case: c.id, stable: true };
    return { case: c.id, stable: false, first: first.output, second: second.output };
  });

  return {
    subject: subject.name,
    findings,
    unstable: findings.filter((f) => !f.stable).length,
  };
}

// ----------------------------------------------------------------- coverage

/** What each subject does with each case: the matrix, unjudged. */
export function runCoverage(subject: Subject): CoverageResult {
  return {
    subject: subject.name,
    cells: CASES.map((c) => ({ case: c.id, outcome: attempt(subject, c.make()) })),
  };
}

// ----------------------------------------------------------------- robustness

function nest(depth: number): unknown {
  let o: unknown = { leaf: 1 };
  for (let i = 0; i < depth; i++) o = { a: o };
  return o;
}

/**
 * How deep the input can nest before the subject fails.
 *
 * Every implementation measured so far is recursive and dies with a
 * `RangeError` somewhere in the low thousands. That is an availability
 * problem, not a curiosity: content-addressing and cache-key pipelines eat
 * untrusted input by definition, and "the attacker sends a deeply nested
 * document" is the cheapest denial of service there is.
 *
 * Engine stack limits move between runs and machines, so the number is an
 * order of magnitude and reported as such. `ceiling` caps the probe; a subject
 * that reaches it is iterative and effectively unbounded.
 */
export function runDepth(subject: Subject, ceiling = 200_000): DepthResult {
  const works = (d: number): boolean => {
    try {
      subject.run(nest(d));
      return true;
    } catch {
      return false;
    }
  };

  if (!works(1)) {
    return { subject: subject.name, maxDepth: 0, failureMode: "failed at depth 1" };
  }

  // Exponential probe up to the ceiling, then binary search. `hi` is clamped
  // rather than allowed to overshoot: doubling past the ceiling and calling
  // that "unbounded" would report success for a depth never actually tried.
  // Unbounded means one thing only, that the ceiling itself was handled.
  let lo = 1;
  let hi = 2;
  while (hi < ceiling && works(hi)) {
    lo = hi;
    hi = Math.min(hi * 2, ceiling);
    if (lo === hi) break;
  }
  if (hi >= ceiling && works(ceiling)) {
    return { subject: subject.name, maxDepth: Infinity };
  }

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (works(mid)) lo = mid;
    else hi = mid;
  }

  let failureMode: string | undefined;
  try {
    subject.run(nest(hi));
  } catch (err) {
    failureMode = err instanceof Error ? `${err.constructor.name}: ${err.message.slice(0, 60)}` : String(err);
  }

  return { subject: subject.name, maxDepth: lo, ...(failureMode ? { failureMode } : {}) };
}
