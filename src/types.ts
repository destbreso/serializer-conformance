// Core types. An implementation under test is reduced to a tiny uniform surface
// (a `Subject`): given a JavaScript value it returns a string, and that string
// is the only thing the harness ever compares.
//
// That one-line contract covers both families deliberately. A canonicalizer
// returns the canonical serialization; a structural hasher returns a digest.
// They are not interchangeable in use, but they make the same promise about
// *identity*: equal values must map to equal strings, and, far more
// importantly, different values must not. That promise is what this harness
// tests, so both belong in the same arena.

/** What the subject produces, and how far it can be held to the JCS spec. */
export type SubjectKind =
  /** Claims byte-exact RFC 8785 output. Eligible for the conformance suite. */
  | "jcs"
  /** Deterministic serialization, but not claiming RFC 8785. */
  | "serializer"
  /** A digest. Conformance is not applicable; identity still is. */
  | "hash";

/**
 * One implementation under test.
 *
 * `run` may throw: refusing an input is a legitimate, and often the *correct*,
 * answer (RFC 8785 has no representation for NaN, so throwing beats inventing
 * one). The harness records a throw as its own outcome rather than an error,
 * because "loudly refuses" and "silently mangles" are the two behaviours this
 * whole tool exists to tell apart.
 */
export interface Subject {
  name: string;
  kind: SubjectKind;
  run: (value: unknown) => string;
  /** Package and version, for reporting (e.g. "canonicalize@3.0.0"). */
  source?: string;
  /** Free-text caveat surfaced in reports (e.g. documented intentional behaviour). */
  note?: string;
}

/** The result of running one subject on one input. */
export type Outcome =
  | { status: "ok"; output: string }
  | { status: "threw"; message: string };

// --------------------------------------------------------------- test inputs

/**
 * One probe input. `value` is built by a thunk rather than stored directly so
 * that every subject gets a structurally identical but freshly allocated value:
 * an implementation that memoizes on object identity (and at least one popular
 * one does) must not be handed the same reference twice and score better for it.
 */
export interface Case {
  id: string;
  about?: string;
  make: () => unknown;
  /** Which behaviours this case is designed to expose, for filtering/reporting. */
  tags?: ReadonlyArray<CaseTag>;
}

export type CaseTag =
  | "json"        // representable in plain JSON
  | "number"      // exercises IEEE-754 serialization
  | "unicode"     // exercises key ordering / escaping
  | "beyond-json" // BigInt, Map, Set, TypedArray, class instances, ...
  | "structural"  // cycles, sparse arrays, getters, prototype keys
  | "adversarial"; // deliberately shaped to collide or to blow up

/**
 * Two cases that MUST NOT produce the same output, and why.
 *
 * This is the harness's sharpest instrument. A subject that throws on both is
 * fine; a subject that returns the same string for both has a silent collision,
 * which in a cache key is a wrong answer served from cache and in a signature
 * is a forgery. `expectedToDiffer` states the claim being tested so a report
 * can explain the failure instead of just flagging it.
 */
export interface CollisionProbe {
  id: string;
  a: string;
  b: string;
  /** Why these two are genuinely different values, in one sentence. */
  expectedToDiffer: string;
}

// ------------------------------------------------------------- suite results

export interface ConformanceResult {
  subject: string;
  /** Whether the subject actually claims RFC 8785, which decides how to read a failure. */
  kind: SubjectKind;
  /** One entry per official RFC 8785 vector. */
  vectors: ReadonlyArray<{
    name: string;
    pass: boolean;
    /** Index of the first differing UTF-16 code unit, when it failed. */
    divergedAt?: number;
    expected?: string;
    actual?: string;
    threw?: string;
  }>;
  passed: number;
  total: number;
}

export interface CollisionResult {
  subject: string;
  findings: ReadonlyArray<{
    probe: string;
    /** "collides" is the failure; the rest are acceptable outcomes. */
    verdict: "distinct" | "collides" | "both-threw" | "one-threw";
    expectedToDiffer: string;
    output?: string;
  }>;
  collisions: number;
}

export interface CoverageResult {
  subject: string;
  cells: ReadonlyArray<{ case: string; outcome: Outcome }>;
}

export interface DepthResult {
  subject: string;
  /**
   * Deepest nesting the subject handled. Engine stack limits vary between runs
   * and between machines, so this is an order of magnitude, not a constant.
   * `Infinity` means it never failed within the probe ceiling: the mark of an
   * iterative implementation.
   */
  maxDepth: number;
  failureMode?: string;
}
