# serializer-conformance

A conformance and collision harness for JavaScript JSON canonicalizers and
structural hashers.

## What this is

If you have not had to choose one of these before, here is the situation it
exists for.

You have a JavaScript value and you need a short string that stands for it: a
cache key, a deduplication key, an ETag, the id a document is stored under, the
bytes a signature is computed over. Two equal values must produce the same
string, or the cache never hits. Two different values must produce different
strings, or the cache hands back somebody else's answer and the signature
verifies over data that was not signed.

`JSON.stringify` cannot do that job. `{a:1,b:2}` and `{b:2,a:1}` are the same
value and stringify to different text, because the output follows insertion
order. So the field built **canonicalizers**: a fixed rule for key order, number
formatting and string escaping, so that one value has exactly one written form.
RFC 8785 (JCS) is that rule written down as a standard, with official vectors to
check an implementation against. A **structural hasher** makes the same promise
and hands back a fixed-length digest instead of a string, and usually accepts
more of JavaScript than JSON can express: a `Map`, a `Set`, a `Uint8Array`, a
`BigInt`, a class instance.

"Serializer" is meant broadly here: anything that maps a JavaScript value to a
string. A canonicalizer and a structural hasher are not interchangeable in use,
but they make the same promise about *identity*, and that promise is what gets
tested here.

Every library in this space states it in different words: equal values produce
equal output, different values do not. The first half is easy and everyone gets
it right. The second half is where they quietly diverge, because the JSON subset
cannot express most of what a JavaScript program actually holds, and each
library invented its own answer for `Map`, `Set`, `TypedArray`, `BigInt` and
class instances.

Those answers collide, and a collision is invisible from the outside. Nothing
throws. Every README states the promise and none of them states which values
break it, so the divergence surfaces much later, as a key that matched when it
should not have. Seven of these packages have adapters here, and there is no way
to choose between them by reading.

**A harness is the instrument, not the finding.** This package holds the inputs,
the probes, the official vectors and the rules about what counts as a failure,
and runs them against whichever implementations you have installed. It has no
opinion about which one should win: it produces the table and you read it.
Nothing is bundled and nothing is pinned, because the thing worth measuring is
the version you actually have.

It also has to stay neutral about one package in particular. `impronta` is a
canonical serializer I wrote, and it enters here the way everything else does:
same dynamic load, same skip-if-absent, same thin adapter, same suites, listed
last so the table does not read as a leaderboard with a favourite on top. It is
deliberately **not installed** when the charts and the report committed to this
repository are generated, because an instrument's reference output should
describe the field rather than the thing its author also publishes. Install it
and it is measured like any other subject, collisions included.

RFC 8785 conformance is one suite of six, and the least discriminating of them,
because every popular canonicalizer already passes it. The other five are where
these libraries come apart.

## Install

```bash
npm i -D serializer-conformance
```

Node 18+. Two dependencies, both zero-dep themselves: `citty` for argument
parsing and `picocolors` for TTY colour.

The implementations themselves are not dependencies of this package. Install the
ones you want measured, in any subset; an adapter whose package does not resolve
reports itself absent rather than failing the run.

```bash
npm i -D canonicalize json-canonicalize safe-stable-stringify \
  fast-json-stable-stringify ohash stable-hash object-hash
```

## Use

```bash
npx serializer-conformance
```

It measures whatever supported packages are installed. Nothing is bundled,
nothing is pinned, and it is not the companion of any one implementation.

Six suites, each answering one question and refusing to answer any other:

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
stdout is a TTY. The exit code is `1` if any collision was found, so a scripted
run fails rather than printing a table nobody reads.

## Where this earns its place

The shape to look for is always the same: **a value in memory becomes an
identifier, and the identifier outlives the value.** Once it has been written to
a cache, a store, a log line or a signature, nothing downstream can tell that two
different values were folded into one. The moment to find out is before the
library is chosen, and that is what each of these situations has in common.

**Choosing an implementation for content addressing or deduplication.** You are
storing documents under a key derived from their content, or collapsing
duplicates, or handing the key out as an ETag. Which library is right depends
entirely on which types your values actually contain, and the coverage matrix and
the collision grid answer exactly that question. If your documents carry binary,
`typed-array-vs-index-object` is the row that decides it. If they carry a `Date`,
`date-vs-string` is. If they carry neither, the field is much closer together
than its READMEs suggest.

**Auditing a scheme that says "canonicalize, then sign".** JCS exists so that two
parties serializing the same document independently produce the same bytes, and
that property is worth exactly as much as the byte-exactness of both
implementations. The conformance suite runs the official vectors rather than
trusting the claim, and one of the six separates implementations that sort keys
correctly from implementations that sort them plausibly.

**Canonicalizing input that arrived from outside.** A webhook body, an uploaded
document, a message off a queue. Here the question is not what the library
produces but whether the handler comes back, so the `depth` and `scaling` suites
are the ones to read: a recursive kernel has a ceiling an attacker can reach with
a few dozen kilobytes, and a superlinear one has a ceiling they can reach with
patience.

**A cache key built from an options bag.** Build tools, resolvers and memoized
loaders key on a config object, and config objects accumulate `Set`s, `Map`s,
`RegExp`s and class instances over time. Start with the `determinism` suite,
because a library keyed on object identity gives you a cache that never hits and
never says why.

**Reviewing a dependency upgrade.** The report is markdown, so a run committed
next to the lockfile diffs cleanly against the next one. A library that changes
how it treats one type has changed every key you have already stored, and that
is otherwise an invisible release note.

**Building one of these yourself.** `defineSubject` puts your implementation
through the same suites as everything else, from inside your own test file,
before anything is published. See [Bring your own](#bring-your-own).

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
with **no implementation by this harness's author installed**, for the reason
given above. Regenerate all of it against whatever you have:

```bash
npx serializer-conformance all --svg ./docs > ./docs/REPORT.md
```

## Depth: everything in the field is recursive

Every implementation measured so far walks the value graph with the call stack,
so every one of them has a ceiling somewhere in the thousands of levels. That is
a curiosity for most libraries and a denial of service for this kind, because
canonicalizing untrusted input is the job description: a webhook body, an
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

## When not to use this

Both ends, because a tool that only names where it wins is advertising.

**Your values are plain JSON and stay that way.** If everything you canonicalize
came out of `JSON.parse`, most of the probes here cannot fire: there is no `Map`
to lose, no `Uint8Array` to flatten, no class instance to strip. Conformance will
not separate the field for you either, since four of the five non-digest subjects
in the published run pass all six vectors and two of those never claimed to.
Pick on maintenance, size and API surface, and move on.

**You want to know which library is fastest.** The `scaling` suite reports an
exponent on purpose and refuses to rank absolute throughput, because a hasher
does strictly more work than a serializer and an ops/sec table across the two
would look authoritative and mean very little. If you need a throughput number,
you need it for your own payloads anyway, measured with a benchmark runner built
for that job.

**You need cross-language conformance.** This loads npm packages into Node. If
the question is whether your Go, Rust or Java implementation agrees with the
JavaScript one, take the vectors to their source
([cyberphone/json-canonicalization](https://github.com/cyberphone/json-canonicalization))
and run them there. The vectors embedded here are those same files; the harness
around them is not portable.

**Your worry is the digest and not the structure.** Every collision reported here
happens before hashing: two different values were already turned into the same
string, and no hash function can undo that. If instead the question is whether
the digest algorithm itself resists collisions, that is a question about the
algorithm, and this measures nothing about it.

**You want a general test suite for your own implementation.** This tests
identity behaviour and only that. Your API, your options, your error messages,
your streaming path and your memory use are all outside it, and a clean report
here says nothing about any of them.

**You want a recommendation.** There is not one. Several perfectly reasonable
libraries collide on purpose for documented reasons, "correct" depends on
whether you are doing JSON semantics or content addressing, and reading a row
still requires knowing which types your own values contain. The harness narrows
the question; it does not answer it.

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

## License

MIT
