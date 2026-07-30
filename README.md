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
| `scaling` | How does cost grow with size? (linear, or quadratic and an outage) |

```bash
serializer-conformance                          # conformance, collisions, determinism
serializer-conformance all                      # everything
serializer-conformance coverage depth           # pick suites
serializer-conformance --only canonicalize,ohash.hash
serializer-conformance --list                   # what did it find installed
serializer-conformance all --svg ./docs         # also write the charts below
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

![Collision grid: ten probes against eight adapters over seven packages](https://raw.githubusercontent.com/destbreso/serializer-conformance/main/docs/collisions.svg)

The finding is not any single cell, it is the shape of the field.

This chart, and the full run in [docs/REPORT.md](docs/REPORT.md), are measured
with **no implementation by this harness's author installed**. `impronta` has
adapters here and is deliberately absent from the harness's own documentation:
an instrument's reference output should describe the field, not the thing its
author also sells. Install it if you want it measured, exactly like any other
subject.

Regenerate all of it against whatever you have:

```bash
npx serializer-conformance all --svg ./docs > ./docs/REPORT.md
```

## Depth: everything in the field is recursive

Every implementation measured so far walks the value graph with the call stack,
so every one of them has a ceiling somewhere in the low thousands of levels.
That is a curiosity for most libraries and a denial of service for this kind,
because canonicalizing untrusted input is the job description: a webhook body, an
uploaded document, a message off a queue. A few dozen kilobytes of nested JSON
parses without complaint and then takes down the handler that fingerprints it.

![Nesting depth before failure, by implementation](https://raw.githubusercontent.com/destbreso/serializer-conformance/main/docs/depth.svg)

Stack limits move between runs and machines, so read those as orders of
magnitude. `unbounded` means the probe ceiling was reached without failing,
which is the signature of an iterative kernel; it is drawn running off the axis
rather than as a longer bar, because the absence of a limit is not a bigger
number.

## Scaling: crashing is not the only way to fail

The depth suite answers *does it crash*, which is half the availability
question. A canonicalizer that survives a deep document by taking thirty seconds
over it has moved the denial of service from the call stack to the clock. Same
outage, harder to diagnose, because nothing in the logs says the word "error".

`scaling` fits log(time) against log(size), so the number it reports is an
exponent: 1 is linear, 2 is quadratic. It travels with an r², because a
confident exponent from a bad fit is exactly the kind of number this tool exists
to distrust, and a bar whose fit is poor is drawn hollow rather than solid.

![Growth exponent by depth, one bar per implementation, with reference lines at linear and quadratic](https://raw.githubusercontent.com/destbreso/serializer-conformance/main/docs/scaling-depth.svg)

This measures the *shape*, deliberately, and not a winner. Absolute throughput
across these subjects would compare unlike things: a hasher does strictly more
work than a serializer because it also hashes, so an ops/sec ranking would look
authoritative and mean very little. The exponent is comparable in a way the
constant is not.

Two details that turned out to matter. Every timed repetition gets its own
freshly built input, because the first version reused one and reported
`stable-hash` at exponent 0.00 with a perfect fit: it memoizes on object
identity, so the warm-up call filled a `WeakMap` and the suite spent its time
measuring the cache. And output length is reported alongside the timings,
because it is exactly reproducible where a duration never is, and a canonical
form twice as long costs twice as much in whatever store it is written to.

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
`stable-hash`, `object-hash`, `impronta` (both `jcs` and `imprint`).

Adapters are deliberately thin: call each library the way its README says and
record what comes back, with no normalization and no repair. A harness that
quietly fixes up a subject's answer is measuring itself.

A disclosure worth making plainly: `impronta` is written by the author of this
harness. The harness was written first, against the seven packages that are not
his, to answer a question whose answer he did not yet know. It bundles no
versions and measures only what you have installed, so the way to check any
number in this README is to install the subjects you care about and run it.

For the same reason, nothing published here is measured with `impronta`
installed. The numbers and charts in this repository are the field on its own.
If you want to see how it places against the rest, install it and run the
harness, or read the comparison in that package's own documentation where the
conflict of interest is where it belongs.

## Install

```bash
npm i -D serializer-conformance
```

Node 18+. Two dependencies, both zero-dep themselves: `citty` for argument
parsing and `picocolors` for TTY colour.

## License

MIT
