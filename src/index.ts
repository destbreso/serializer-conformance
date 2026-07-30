// canon-arena: a conformance and collision harness for JavaScript JSON
// canonicalizers and structural hashers.
//
// The premise. Every library in this space promises the same thing in
// different words: equal values produce equal output, different values do not.
// The first half is easy and everyone gets it right. The second half is where
// they quietly diverge, because the JSON subset cannot express most of what a
// JavaScript program actually holds, and each library invented its own answer
// for Map, Set, TypedArray, BigInt and class instances. Those answers collide.
//
// This harness measures the promise rather than the marketing:
//
//   conformance   byte-exact RFC 8785 against the official vectors
//   collisions    distinct inputs that produce identical output
//   determinism   identical values that produce different output
//   coverage      the full matrix, unjudged
//   depth         how deep the input can nest before it fails
//
// It has no opinion about which library you should use, and it is not the
// companion of any one of them. Bring your own with `defineSubject`.

export { builtinSubjects, defineSubject } from "./adapters.js";
export { CASES, CASES_BY_ID, COLLISION_PROBES } from "./cases.js";
export { RFC8785_VECTORS } from "./vectors.js";
export type { Vector } from "./vectors.js";
export {
  attempt,
  runCollisions,
  runConformance,
  runCoverage,
  runDepth,
  runDeterminism,
} from "./suites.js";
export {
  reportCollisions,
  reportConformance,
  reportCoverage,
  reportDepth,
  reportDeterminism,
  reportHeader,
} from "./report.js";
export type {
  Case,
  CaseTag,
  CollisionProbe,
  CollisionResult,
  ConformanceResult,
  CoverageResult,
  DepthResult,
  Outcome,
  Subject,
  SubjectKind,
} from "./types.js";
