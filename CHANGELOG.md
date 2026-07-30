# Changelog

All notable changes to this project are documented here.

## 0.4.0

**Breaking:** `runDepth(subject, ceiling)` becomes
`runDepth(subject, { ceiling })`.

The positional form was a trap, and it sprang. `subjects.map(runDepth)` reads
perfectly and is wrong, because `Array.map` supplies `(element, index, array)`:
the array index arrives as the ceiling, so the first subject is probed to depth
0, succeeds, and is reported as unbounded. A consumer hit exactly this and
published a chart showing every implementation in the field as having no depth
limit, directly above a table giving their real ceilings.

An options object makes the mistake inert, because a number has no `ceiling`
property and the default applies. In TypeScript it is better than inert: the
call no longer compiles, since a number has no properties in common with the
options type. An explicitly bad ceiling now throws a `RangeError` instead of
quietly certifying a depth that was never tried.

Migration is mechanical: `runDepth(s, 4096)` becomes
`runDepth(s, { ceiling: 4096 })`. The common call, `runDepth(s)`, is unchanged.

## 0.3.0

- **New `scaling` suite.** Fits log(time) against log(size) on two axes, depth
  and width, and reports the exponent with its r²: 1 is linear, 2 is quadratic.
  The depth suite only answers whether a subject crashes, and a canonicalizer
  that survives deep input by taking thirty seconds over it has moved the denial
  of service from the call stack to the clock. Output length is reported too,
  because unlike a duration it is exactly reproducible. It reports the shape
  rather than a winner: absolute throughput would rank unlike things, since a
  hasher does strictly more work than a serializer.
- `scaling-depth.svg` and `scaling-width.svg` join the `--svg` output. Bars for
  a poor fit are hollow, so an exponent that should not be read as a
  measurement does not look like one.
- **Fixed: charts were unreadable on npm.** They carried a
  `prefers-color-scheme` block, and an SVG embedded with `<img>` resolves that
  against the viewer's operating system rather than the page it is on. npm
  renders READMEs on white, so anyone browsing with a dark OS got the dark
  palette on a white page: pale grey labels, no contrast, inconsistent with
  every other image around them. Charts now use one fixed palette and paint
  their own background, so they render identically everywhere. Text colours are
  asserted against WCAG AA in the tests instead of eyeballed.

## 0.2.0

- **`--svg <dir>`**: writes SVG charts for the two suites whose results are
  genuinely visual, the collision grid and the depth comparison. Self-contained
  (no fetched fonts, no scripts), theme-aware via `prefers-color-scheme`, and
  degrading to a correct light rendering on any renderer that ignores the
  stylesheet. `collisionChart` and `depthChart` are also exported from the
  library, and return strings: the CLI owns the filesystem.
  The other three suites deliberately get no chart. Conformance is six booleans,
  determinism is one integer, and coverage has to be read rather than scanned.
- **`docs/REPORT.md`**: a committed full run of every suite against the
  supported packages, with no implementation by this harness's author installed.
  The instrument's own reference output describes the field rather than the
  thing its author also publishes.
- **Fixed: `--only` and `--svg` values were parsed as suite names.** The CLI
  took every argv token not starting with `-` as a positional, which swept up
  the values of string flags, so `--only impronta.jcs` exited with "unknown
  suite". It now uses citty's parsed positionals instead of re-deriving them.
- Adapters for `impronta` (both `jcs` and `imprint` modes), loaded dynamically
  and skipped if absent like every other subject, and listed last so the table
  does not read as a leaderboard with the author's own package on top.
- Conformance is now reported against what a subject *claims*. A "claims JCS"
  column, `n/a` instead of a failure for subjects that never promised RFC 8785,
  and per-vector diffs printed only for those that did. Previously a deliberate
  non-JCS mode and a genuine conformance failure rendered as the same cell, and
  two popular stringifiers that pass all six vectors without claiming to were
  flattened the same way.

## 0.1.0

First release.

- Conformance suite: byte-exact RFC 8785 against the six official test vectors
  from the reference implementation, embedded verbatim.
- Collision suite: ten probes for distinct inputs that produce identical output,
  the silent failure mode that breaks cache keys and signatures.
- Determinism suite: catches implementations keyed on object identity rather
  than content, which no collision test can detect.
- Coverage matrix and nesting-depth probe.
- Adapters for canonicalize, json-canonicalize, safe-stable-stringify,
  fast-json-stable-stringify, ohash (serialize and hash), stable-hash and
  object-hash. Loaded dynamically, skipped if absent, never pinned.
- CLI with markdown output, TTY-only colour, and a non-zero exit on any
  collision so it can gate CI.
