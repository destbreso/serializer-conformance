// The differential battery: inputs chosen because implementations disagree
// about them, paired into probes that assert what must not collapse.
//
// The official RFC 8785 vectors only cover the JSON subset, and on that subset
// the popular implementations agree. Everything interesting happens outside it,
// where each library quietly invented its own answer. This file is that
// territory, written down.

import type { Case, CollisionProbe } from "./types.js";

class Point {
  constructor(public x: number, public y: number) {}
}

function cyclic(): unknown {
  const o: Record<string, unknown> = { a: 1 };
  o["self"] = o;
  return o;
}

function shared(): unknown {
  // A diamond, not a cycle: the same object reached by two paths. An
  // implementation that confuses "seen before" with "cycle" rejects this
  // perfectly serializable value.
  const leaf = { v: 1 };
  return { l: leaf, r: leaf };
}

export const CASES: ReadonlyArray<Case> = [
  // ------------------------------------------------------------- plain JSON
  { id: "key-order", about: "the baseline everyone agrees on", tags: ["json"], make: () => ({ b: 1, a: 2 }) },
  { id: "nested", about: "nested objects and arrays", tags: ["json"], make: () => ({ z: { b: 1, a: 2 }, a: [3, 2, 1] }) },
  { id: "empty-object", tags: ["json"], make: () => ({}) },
  { id: "empty-array", tags: ["json"], make: () => [] },

  // ---------------------------------------------------------------- numbers
  // RFC 8785 pins these to the ECMAScript Number::toString algorithm.
  { id: "minus-zero", about: "-0 and 0 are distinct doubles that JSON cannot tell apart", tags: ["number"], make: () => ({ v: -0 }) },
  { id: "plus-zero", tags: ["number"], make: () => ({ v: 0 }) },
  { id: "1e21", about: "the boundary where ES6 switches to exponential notation", tags: ["number"], make: () => ({ v: 1e21 }) },
  { id: "just-under-1e21", tags: ["number"], make: () => ({ v: 999999999999999900000 }) },
  { id: "denormal-min", about: "smallest positive double", tags: ["number"], make: () => ({ v: 5e-324 }) },
  { id: "max-double", tags: ["number"], make: () => ({ v: 1.7976931348623157e308 }) },
  { id: "integral-float", about: "100.0 and 100 are the same double", tags: ["number"], make: () => ({ v: 100.0 }) },
  { id: "float-error", about: "0.1 + 0.2, the classic", tags: ["number"], make: () => ({ v: 0.1 + 0.2 }) },
  { id: "nan", about: "JSON has no representation; refusing is the correct answer", tags: ["number", "adversarial"], make: () => ({ v: NaN }) },
  { id: "infinity", tags: ["number", "adversarial"], make: () => ({ v: Infinity }) },
  { id: "negative-infinity", tags: ["number", "adversarial"], make: () => ({ v: -Infinity }) },

  // ---------------------------------------------------------------- unicode
  {
    id: "unicode-key-order",
    about: "must sort by UTF-16 code unit: A < a < e-acute < euro < U+1F602 < U+FFFF",
    tags: ["unicode"],
    make: () => ({ "€": 1, "é": 2, a: 3, A: 4, "\u{1f600}": 5, "￿": 6 }),
  },
  { id: "lone-surrogate", about: "an unpaired surrogate is not valid UTF-8; behaviour must be deliberate", tags: ["unicode", "adversarial"], make: () => ({ v: "\ud800" }) },
  { id: "escapes", about: "quote, backslash, newline, tab", tags: ["unicode"], make: () => ({ v: '"\\\n\t' }) },
  { id: "unnormalized", about: "NFC must NOT be applied: A + combining ring stays two code points", tags: ["unicode"], make: () => ({ v: "Å" }) },
  { id: "precomposed", about: "the NFC-normalized twin of the above, a genuinely different string", tags: ["unicode"], make: () => ({ v: "Å" }) },

  // ------------------------------------------------------------ beyond JSON
  // The gap. Each of these is a value a JavaScript program routinely holds and
  // that the JSON subset cannot express.
  { id: "bigint", tags: ["beyond-json"], make: () => ({ v: 10n }) },
  { id: "number-ten", about: "the collision partner for bigint", tags: ["json"], make: () => ({ v: 10 }) },
  { id: "map", tags: ["beyond-json"], make: () => ({ v: new Map([["b", 1], ["a", 2]]) }) },
  { id: "map-empty", tags: ["beyond-json"], make: () => ({ v: new Map() }) },
  { id: "map-same-content", about: "structurally identical to `map`, freshly allocated", tags: ["beyond-json"], make: () => ({ v: new Map([["b", 1], ["a", 2]]) }) },
  { id: "map-mutated", about: "`map` plus one key: content differs, so output must differ", tags: ["beyond-json"], make: () => ({ v: new Map([["b", 1], ["a", 2], ["c", 3]]) }) },
  { id: "object-empty-in-v", about: "the collision partner for map-empty", tags: ["json"], make: () => ({ v: {} }) },
  { id: "set", tags: ["beyond-json"], make: () => ({ v: new Set([3, 1, 2]) }) },
  { id: "array-123", about: "the collision partner for set", tags: ["json"], make: () => ({ v: [3, 1, 2] }) },
  { id: "typed-array", tags: ["beyond-json"], make: () => ({ v: new Uint8Array([1, 2, 3]) }) },
  { id: "typed-array-other-type", about: "same bytes, different element type", tags: ["beyond-json"], make: () => ({ v: new Int8Array([1, 2, 3]) }) },
  { id: "index-object", about: "the collision partner for typed-array", tags: ["json"], make: () => ({ v: { 0: 1, 1: 2, 2: 3 } }) },
  { id: "date", tags: ["beyond-json"], make: () => ({ v: new Date(0) }) },
  { id: "date-as-string", about: "the collision partner for date", tags: ["json"], make: () => ({ v: "1970-01-01T00:00:00.000Z" }) },
  { id: "regexp", tags: ["beyond-json"], make: () => ({ v: /ab+c/gi }) },
  { id: "class-instance", tags: ["beyond-json"], make: () => ({ v: new Point(1, 2) }) },
  { id: "plain-twin-of-class", about: "the collision partner for class-instance", tags: ["json"], make: () => ({ v: { x: 1, y: 2 } }) },
  { id: "undefined-value", tags: ["beyond-json"], make: () => ({ v: undefined }) },

  // -------------------------------------------------------------- structure
  { id: "cycle", about: "self-reference; refusing is correct, but it must not hang", tags: ["structural", "adversarial"], make: cyclic },
  { id: "shared-reference", about: "a diamond, NOT a cycle: serializable, must not be rejected", tags: ["structural"], make: shared },
  { id: "undefined-in-object", tags: ["structural"], make: () => ({ a: undefined, b: 1 }) },
  { id: "undefined-in-array", tags: ["structural"], make: () => ({ v: [1, undefined, 3] }) },
  { id: "sparse-array", about: "a hole is not the same as an explicit undefined", tags: ["structural"], make: () => ({ v: [1, , 3] }) },
  { id: "symbol-key", tags: ["structural"], make: () => ({ [Symbol("s")]: 1, b: 2 }) },
  { id: "proto-key", about: 'a literal "__proto__" key from parsed JSON', tags: ["structural", "adversarial"], make: () => JSON.parse('{"__proto__":{"polluted":true},"a":1}') },
  { id: "getter", about: "a computed property, invoked or skipped", tags: ["structural"], make: () => ({ get a() { return 1; }, b: 2 }) },
  { id: "to-json", about: "toJSON hook takes precedence in JSON semantics", tags: ["structural"], make: () => ({ v: { toJSON: () => ({ z: 1 }) } }) },
  { id: "null-prototype", tags: ["structural"], make: () => Object.assign(Object.create(null), { b: 1, a: 2 }) },
];

export const CASES_BY_ID: ReadonlyMap<string, Case> = new Map(CASES.map((c) => [c.id, c]));

/**
 * Pairs that must not produce the same output.
 *
 * Each one is a value a real program holds, next to the thing a JSON-subset
 * serializer flattens it into. When the two produce identical strings, the
 * flattening is invisible: the cache key matches when it should not, and the
 * signature verifies over data that is not what was signed.
 */
export const COLLISION_PROBES: ReadonlyArray<CollisionProbe> = [
  {
    id: "map-vs-object",
    a: "map-empty",
    b: "object-empty-in-v",
    expectedToDiffer: "an empty Map and an empty object are different values; a Map with entries must not serialize as {}",
  },
  {
    id: "map-content-changes",
    a: "map",
    b: "map-mutated",
    expectedToDiffer: "adding an entry to a Map changes the value, so it must change the output",
  },
  {
    id: "set-vs-array",
    a: "set",
    b: "array-123",
    expectedToDiffer: "a Set is unordered and deduplicating; an array is neither",
  },
  {
    id: "typed-array-vs-index-object",
    a: "typed-array",
    b: "index-object",
    expectedToDiffer: "a Uint8Array is a byte buffer, not an object with numeric keys",
  },
  {
    id: "typed-array-element-type",
    a: "typed-array",
    b: "typed-array-other-type",
    expectedToDiffer: "Uint8Array and Int8Array interpret the same bytes differently",
  },
  {
    id: "bigint-vs-number",
    a: "bigint",
    b: "number-ten",
    expectedToDiffer: "10n and 10 are different types with different arithmetic; some libraries collapse them on purpose, which is a documented choice and reported as such",
  },
  {
    id: "class-vs-plain",
    a: "class-instance",
    b: "plain-twin-of-class",
    expectedToDiffer: "a class instance carries a prototype the plain object does not; for JSON semantics collapsing them is defensible, for content addressing it is not",
  },
  {
    id: "date-vs-string",
    a: "date",
    b: "date-as-string",
    expectedToDiffer: "a Date and its ISO string are different values that JSON semantics deliberately conflate",
  },
  {
    id: "unicode-normalization",
    a: "unnormalized",
    b: "precomposed",
    expectedToDiffer: "RFC 8785 does not normalize, so A+U+030A and U+00C5 must stay distinct",
  },
  {
    id: "signed-zero",
    a: "minus-zero",
    b: "plus-zero",
    expectedToDiffer: "-0 and 0 are distinct IEEE-754 doubles; JSON has no way to say so, which is itself worth reporting",
  },
];
