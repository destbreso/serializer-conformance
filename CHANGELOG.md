# Changelog

All notable changes to this project are documented here.

## 0.2.0

- **`--svg <dir>`**: writes SVG charts for the two suites whose results are
  genuinely visual, the collision grid and the depth comparison. Self-contained
  (no fetched fonts, no scripts), theme-aware via `prefers-color-scheme`, and
  degrading to a correct light rendering on any renderer that ignores the
  stylesheet. `collisionChart` and `depthChart` are also exported from the
  library, and return strings: the CLI owns the filesystem.
  The other three suites deliberately get no chart. Conformance is six booleans,
  determinism is one integer, and coverage has to be read rather than scanned.
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
