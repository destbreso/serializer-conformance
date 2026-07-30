// The suites. Each answers one question and refuses to answer any other.

import { CASES, CASES_BY_ID, COLLISION_PROBES } from "./cases.js";
import { RFC8785_VECTORS } from "./vectors.js";
import type {
  CollisionResult,
  ConformanceResult,
  CoverageResult,
  DepthResult,
  Outcome,
  ScalingPoint,
  ScalingResult,
  ScalingSeries,
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
    kind: subject.kind,
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
 *
 * The ceiling arrives in an options object rather than as a second positional
 * argument, and that is a scar. `subjects.map(runDepth)` passes the array index
 * as the second argument, so the first subject got a ceiling of 0, probed depth
 * 0, succeeded, and was reported as unbounded. Every subject in the field came
 * out "unbounded" in a published chart. An options object makes the mistake
 * inert: a stray number has no `ceiling` property, so the default applies.
 * An explicitly bad ceiling now throws rather than quietly certifying nothing.
 */
export function runDepth(subject: Subject, options: { ceiling?: number } = {}): DepthResult {
  const ceiling = options.ceiling ?? 200_000;
  if (!Number.isSafeInteger(ceiling) || ceiling < 2) {
    throw new RangeError(`runDepth ceiling must be an integer >= 2, got ${ceiling}`);
  }
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

// ------------------------------------------------------------------- scaling

/**
 * How cost grows with input size, along the two axes that matter.
 *
 * The depth suite next door answers "does it crash", and that is only half the
 * availability question. A canonicalizer that survives deep input by taking
 * thirty seconds over it has moved the denial of service from the call stack to
 * the clock, which is the same outage and harder to diagnose because nothing in
 * the logs says the word "error". This suite is the other half.
 *
 * It reports the *shape* rather than a winner. Absolute throughput across these
 * subjects would be misleading: a hasher does strictly more work than a
 * serializer because it also hashes, so ops/sec puts unlike things in one
 * ranking. The exponent is comparable in a way the constant is not.
 */

/** A chain of `depth` nested objects. Exercises recursion and buffering. */
function deepInput(depth: number): unknown {
  let o: unknown = { leaf: 1 };
  for (let i = 0; i < depth; i++) o = { a: o };
  return o;
}

/** A flat object with `width` keys. Exercises key sorting and concatenation. */
function wideInput(width: number): unknown {
  const o: Record<string, number> = {};
  // Keys are generated out of order so a subject that sorts actually sorts.
  for (let i = 0; i < width; i++) o[`k${(i * 7919) % width}`] = i;
  return o;
}

/**
 * Median time to process each of a set of distinct inputs.
 *
 * Every repetition gets its *own* freshly built value, and that is the whole
 * design. The first version reused one input and reported `stable-hash` as
 * exponent 0.00 with a perfect fit, which is nonsense that looks authoritative:
 * that library memoizes on object identity in a WeakMap, so the untimed warm-up
 * call populated the cache and every timed repetition read it back. The suite
 * was measuring the memo instead of the work.
 *
 * Inputs are built before the clock starts, so construction is never charged to
 * the subject. Median rather than mean, because one GC pause drags a mean
 * somewhere meaningless.
 */
function timeMedian(run: (value: unknown) => void, inputs: ReadonlyArray<unknown>): number {
  const samples: number[] = [];
  for (const value of inputs) {
    const t0 = performance.now();
    run(value);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

/** How many distinct inputs each size is timed over. */
const REPS = 7;

/**
 * Least-squares fit of log(time) against log(size).
 *
 * The slope is the exponent: 1 is linear, 2 is quadratic. r-squared travels
 * with it because a fit over five noisy points can produce a confident-looking
 * exponent for something that is not a power law at all, and an exponent quoted
 * without its fit quality is exactly the kind of number this harness exists to
 * distrust.
 */
function fitExponent(points: ReadonlyArray<ScalingPoint>): { exponent: number; rSquared: number } {
  const usable = points.filter((p) => p.ms > 0 && p.n > 0);
  if (usable.length < 3) return { exponent: NaN, rSquared: NaN };

  const xs = usable.map((p) => Math.log(p.n));
  const ys = usable.map((p) => Math.log(p.ms));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0) return { exponent: NaN, rSquared: NaN };

  const slope = sxy / sxx;
  // A perfectly flat series has no variance to explain; the fit is vacuously
  // exact rather than undefined.
  const rSquared = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { exponent: slope, rSquared };
}

function measureSeries(
  subject: Subject,
  axis: "depth" | "width",
  sizes: ReadonlyArray<number>,
  build: (n: number) => unknown,
): ScalingSeries {
  const points: ScalingPoint[] = [];
  let failedAt: number | undefined;

  for (const n of sizes) {
    let outputLength: number;
    try {
      // An untimed call on its own throwaway value: it warms the JIT for this
      // shape and confirms the subject can handle the size, without touching
      // any input that is about to be timed.
      outputLength = subject.run(build(n)).length;
    } catch {
      failedAt = n;
      break;
    }
    // Built up front, outside the clock, and distinct from each other so an
    // identity-memoizing subject cannot answer from cache.
    const inputs = Array.from({ length: REPS }, () => build(n));
    points.push({ n, ms: timeMedian((v) => void subject.run(v), inputs), outputLength });
  }

  return { axis, points, ...fitExponent(points), ...(failedAt ? { failedAt } : {}) };
}

/**
 * Sizes stay well below the depth at which recursive subjects die (the shallowest
 * measured is around 1,500), because a series that kills half the field measures
 * nothing comparable. A subject that fails anyway records `failedAt` and is
 * fitted on the points it did complete.
 */
export const DEPTH_SIZES = [64, 128, 256, 512, 1024] as const;
export const WIDTH_SIZES = [500, 1000, 2000, 4000, 8000] as const;

export function runScaling(subject: Subject): ScalingResult {
  return {
    subject: subject.name,
    series: [
      measureSeries(subject, "depth", DEPTH_SIZES, deepInput),
      measureSeries(subject, "width", WIDTH_SIZES, wideInput),
    ],
  };
}
