# Changelog

All notable changes to this project are documented here.

## 0.1.1

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
