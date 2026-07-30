# serializer-conformance

A conformance and collision harness for JavaScript JSON canonicalizers and
structural hashers.

"Serializer" is meant broadly: anything that maps a JavaScript value to a
string. A canonicalizer and a structural hasher are not interchangeable in use,
but they make the same promise about *identity*, and that promise is what gets
tested here. RFC 8785 conformance is one suite of five, and the least
discriminating of them, because every popular canonicalizer already passes it.

Every library in this space promises the same thing in different words: equal
values produce equal output, different values do not. The first half is easy and
everyone gets it right. The second half is where they quietly diverge, because
the JSON subset cannot express most of what a JavaScript program actually holds,
and each library invented its own answer for `Map`, `Set`, `TypedArray`,
`BigInt` and class instances.

Those answers collide. This harness finds the collisions.

```bash
npx serializer-conformance
```

It measures whatever supported packages are installed. Nothing is bundled,
nothing is pinned, and it is not the companion of any one implementation.

## What it measures

| Suite | Question |
|---|---|
| `conformance` | Does it match RFC 8785 byte for byte, on the official vectors? |
| `collisions` | Do two different values produce the same output? |
| `determinism` | Do two identical values produce different output? |
| `coverage` | What does it actually do with each type? (matrix, unjudged) |
| `depth` | How deep can the input nest before it fails? |

```bash
serializer-conformance                          # conformance, collisions, determinism
serializer-conformance all                      # everything
serializer-conformance coverage depth           # pick suites
serializer-conformance --only canonicalize,ohash.hash
serializer-conformance --list                   # what did it find installed
```

Output is markdown, so it pastes into an issue or a pull request and diffs
cleanly when you re-run it against new versions. Colour is applied only when
stdout is a TTY. The exit code is `1` if any collision was found, so it works as
a CI gate on your own implementation.

## Why collisions are the interesting axis

A collision is silent. Nothing throws, nothing warns. The cache key simply
matches when it should not, and the signature verifies over data that is not
what was signed.

Running the harness against the popular packages turns up, among others:

- `new Map([['a',1]])` and `{}` produce identical output in every JSON-subset
  canonicalizer. The entries are not mangled, they are **gone**.
- `new Uint8Array([1,2,3])` and `{0:1,1:2,2:3}` are indistinguishable.
- A class instance and its plain-object twin are indistinguishable. Defensible
  for JSON semantics, not for content addressing.

Refusing a value is **not** counted as a failure. A library entitled to say "I
do not model this type" and saying so loudly is doing the honest thing; the
harness reports `both-threw` and moves on. Only silence is penalized.

## Determinism, the failure no collision test can see

An implementation that falls back to object identity breaks the "equal values
hash equally" promise without ever colliding. The `determinism` suite builds
each value twice and requires the same answer.

This is not hypothetical. At the time of writing, one widely used package
assigns a per-process counter to anything whose constructor is not exactly
`Array` or `Object`, so two structurally identical `Map`s hash differently while
the same `Map` mutated hashes identically. That behaviour is deliberate for the
context it was written for (framework dependency keys inside one process, where
referential identity *is* the intended semantics) and a landmine anywhere near
content addressing. The harness reports it as a measurement and says so in the
notes, rather than calling it a bug.

## Bring your own

```ts
import { defineSubject, runCollisions, runConformance, reportCollisions } from "serializer-conformance";
import { canonicalize } from "./my-implementation.js";

const mine = defineSubject({
  name: "mine",
  kind: "jcs",                 // "jcs" | "serializer" | "hash"
  run: (value) => canonicalize(value),
});

console.log(runConformance(mine));           // 6 official vectors, byte-exact
console.log(reportCollisions([runCollisions(mine)]));
```

`run` may throw. A throw is recorded as its own outcome, because "loudly
refuses" and "silently mangles" are the two behaviours this whole tool exists
to tell apart.

## The vectors

`conformance` uses the official RFC 8785 test vectors from the reference
implementation repository accompanying the RFC
([cyberphone/json-canonicalization](https://github.com/cyberphone/json-canonicalization)),
embedded verbatim and generated from those files rather than transcribed.

The `weird` vector is the discriminating one: U+1F602 must sort **before**
U+FB33, which holds for UTF-16 code units (`0xD83D < 0xFB33`) and fails for code
points (`0x1F602 > 0xFB33`). An implementation that sorts by code point passes
every other vector and fails that one.

Passing all six is table stakes, not a distinction: several packages that make
no RFC 8785 claim pass anyway. That result is itself worth having, because it
means conformance alone does not tell these libraries apart.

## Supported implementations

Loaded dynamically, skipped if absent, never pinned:

`canonicalize`, `json-canonicalize`, `safe-stable-stringify`,
`fast-json-stable-stringify`, `ohash` (both `serialize` and `hash`),
`stable-hash`, `object-hash`.

Adapters are deliberately thin: call each library the way its README says and
record what comes back, with no normalization and no repair. A harness that
quietly fixes up a subject's answer is measuring itself.

## Install

```bash
npm i -D serializer-conformance
```

Node 18+. Two dependencies, both zero-dep themselves: `citty` for argument
parsing and `picocolors` for TTY colour.

## License

MIT
