---
phase: 177-derived-line-re-derivation
plan: 08
subsystem: cli-verify
tags: [regex, cli, verify-derive-recheck, ingest-archive, gap-closure]

# Dependency graph
requires:
  - phase: 177-derived-line-re-derivation (plans 01-07)
    provides: CHECK-04's mechanical core — DERIVE_VERDICTS enum, createDeriveVerdictRecord choke
      point, quoteLinesOnly, enumerateDerivedLines, buildBlindDerivePayload, the ledger
provides:
  - annotationBody() — the single decoration-normalization site quoteLinesOnly and
    enumerateDerivedLines both route through, closing the leak/silent-drop defect CR-01 named
  - A construction-site backstop in buildBlindDerivePayload that throws on any assembled payload
    still matching an annotation family, independent of which prefix regex missed it
  - A shared DERIVED_LINE_RE (derived-line-pattern.ts) consumed identically by
    verify-derive-recheck.ts and ingest-archive.ts's relabeller (WR-01)
  - Symmetric, nesting-tolerant PRESENTATION_EXCLUSION_MARKERS (WR-09)
affects: [177-09, 177-10, 177-11, 177-12, 177-13, verify-derive-recheck, ingest-archive, verify-classify]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single decoration-normalization site (annotationBody) that every decoration-sensitive
      consumer routes through, mirroring createDeriveVerdictRecord's single-choke-point shape"
    - "Construction-site backstop throw as a structural invariant independent of the deny-list it
      backstops — a wider deny-list is still a deny-list; the throw is what makes the guarantee
      an invariant"
    - "Dependency-free leaf module (derived-line-pattern.ts) to share a regex across two modules
      that would otherwise close a circular import"

key-files:
  created:
    - src/cli/commands/derived-line-pattern.ts
  modified:
    - src/cli/commands/verify-derive-recheck.ts
    - src/cli/commands/verify-derive-recheck.test.ts
    - src/cli/commands/verify-classify.ts
    - src/cli/commands/verify-classify.test.ts
    - src/cli/commands/ingest-archive.ts

key-decisions:
  - "annotationBody strips leading blockquote/list/ordered-list decoration only, before every
    prefix test in quoteLinesOnly and enumerateDerivedLines — never applied to quoted-sentence
    content."
  - "The backstop lives in buildBlindDerivePayload, tests the ASSEMBLED string, and is
    independent of DERIVED_LINE_RE/VISUAL_LINE_RE/NAMED_BUT_UNDEFINED_LINE_RE/annotationBody so a
    decoration form none of those regexes anticipated still fails loudly."
  - "DERIVED_LINE_RE was NOT put directly on verify-derive-recheck.ts for ingest-archive.ts to
    import — that would close a real circular import (ingest-archive -> verify-derive-recheck ->
    verify-classify -> chunk-provenance -> ingest-archive), observed live as
    'Cannot read properties of undefined (reading source)' when first attempted. Extracted to a
    dependency-free leaf module (derived-line-pattern.ts) instead; verify-derive-recheck.ts
    re-exports the same binding so its own existing consumers are unaffected."
  - "WR-07 (inverting quoteLinesOnly's deny-list to an allow-list) is deliberately deferred, per
    plan instructions — not implemented here, and the filter remains a (now wider, backstopped)
    deny-list, not an allow-list."

requirements-completed: [CHECK-04]

duration: 45min
completed: 2026-07-30
---

# Phase 177 Plan 08: Structural decoration-tolerance for the blind-derive payload Summary

**Closed CR-01 (the blockquote/list-decoration leak+silent-drop defect the code reviewer proved by
execution) with a single shared `annotationBody` normalization site plus a construction-site
backstop throw in `buildBlindDerivePayload` — the leak-proof guarantee is now structural, not an
accident of which two reference games happened to have no decorated `Derived` lines — and closed
WR-01 (shared citation-body regex with `ingest-archive.ts`) and WR-09 (symmetric, nesting-tolerant
presentation qualifier).**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-30
- **Tasks:** 3/3 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- `annotationBody()` is now the single decoration-normalization site both `quoteLinesOnly` and
  `enumerateDerivedLines` route through before every prefix test — a blockquote (`>`) or list
  (`-`, `1.`) decorated `Derived`/`Visual`/`Named-but-undefined` line can no longer diverge between
  the two functions.
- `buildBlindDerivePayload` now throws (never silently emits) if the assembled payload still
  matches any of the three annotation families, independent of which prefix regex missed it. This
  is the part that makes the guarantee structural rather than "wider deny-list, still incidental" —
  proven empirically by execution (see below), not asserted.
- `DERIVED_LINE_RE`/`VISUAL_LINE_RE`/`NAMED_BUT_UNDEFINED_LINE_RE` widened to accept any citation
  body (`\(p\.[^)]*\)`), and the citation-body pattern is now shared between
  `verify-derive-recheck.ts` and `ingest-archive.ts`'s relabeller via a new dependency-free leaf
  module, `derived-line-pattern.ts` (needed to avoid closing a real circular import — see
  Deviations).
- `PRESENTATION_EXCLUSION_MARKERS` (`verify-classify.ts`) now applies the optional parenthetical
  qualifier symmetrically to all three markers (previously `Visual` lacked it) and the qualifier
  body is nesting-tolerant (`\([^:]*\)` instead of `\([^)]+\)`).
- Both new negative pins (decoration-strip fix, payload backstop) were empirically proven to fail
  when reverted — real observed test output recorded below, not "would fail" claims.

## Task Commits

1. **Task 1: Make decoration tolerance structural in one shared helper, and widen the citation body
   to match the relabeller** - `34c4efee` (feat)
2. **Task 2: Pin the leak and silent-drop with real-corpus regression tests, replace the four
   tautological source-grep tests, and empirically prove every new pin fails when reverted** -
   `6d525314` (test)
3. **Task 3: Close WR-09 — apply the presentation qualifier symmetrically to the Visual marker and
   make it nesting-tolerant** - `cc7b98c4` (fix)

_No plan-metadata commit is included in this list — it is created separately per the execution
protocol's final-commit step._

## Files Created/Modified

- `src/cli/commands/derived-line-pattern.ts` (created) - dependency-free leaf module holding the
  single shared `DERIVED_LINE_RE`, consumed by both `verify-derive-recheck.ts` and
  `ingest-archive.ts` without closing a circular import
- `src/cli/commands/verify-derive-recheck.ts` - `annotationBody` helper, widened citation-body
  regexes, payload-level backstop throw, module header comment update
- `src/cli/commands/verify-derive-recheck.test.ts` - decorated-line leak/silent-drop regression
  tests keyed to the real corpus line, `annotationBody` unit tests, a pinned backstop-throw test,
  and behavioral replacements for the four tautological source-grep tests
- `src/cli/commands/verify-classify.ts` - `PRESENTATION_EXCLUSION_MARKERS` widened symmetrically
  and made nesting-tolerant
- `src/cli/commands/verify-classify.test.ts` - updated pin test for the widened constant, plus new
  symmetry/nesting/regression/no-regression test cases
- `src/cli/commands/ingest-archive.ts` - relabeller now derives its citation-body regex from the
  shared `DERIVED_LINE_RE` instead of a second hand-spelled literal

## Empirical Negative-Pin Proof (mandatory per task 2's honesty discipline)

Both reintroductions were performed by editing the committed, tested file directly, running the
full `verify-derive-recheck.test.ts` suite, recording the REAL observed failure output below, then
restoring from a byte-identical backup and confirming `git diff --stat
src/cli/commands/verify-derive-recheck.ts` printed nothing before proceeding.

### Reintroduction 1 — reverted `annotationBody` to pre-fix `^`-anchored trimmed matching

Change: `annotationBody` body replaced with `return line.trim();` (no decoration strip).

Observed: **6 tests failed** (37 passed):

```
× buildBlindDerivePayload > 174-FIXTURES/seven/live/01-overview-setup-and-play.md:30 proves the
  blockquote decoration shape is real: a blockquote-decorated Derived line leaks zero
  annotation-family matches into the payload and is enumerated as a candidate
  → expected [] to have a length of 1 but got +0

× buildBlindDerivePayload > a slice with three Derived lines — bare, blockquote-decorated,
  list-decorated — enumerates all three as candidates, not one (silent-drop regression)
  → expected 1 to be 3 // Object.is equality

× annotationBody > strips a leading blockquote marker
  → expected '> Derived (p.1): x' to be 'Derived (p.1): x' // Object.is equality

× annotationBody > strips a leading list bullet
  → expected '- Derived (p.1): x' to be 'Derived (p.1): x' // Object.is equality

× annotationBody > strips repeated decoration (blockquote + list)
  → expected '> - Derived (p.1): x' to be 'Derived (p.1): x' // Object.is equality

× annotationBody > strips a leading ordered-list marker
  → expected '1. Derived (p.1): x' to be 'Derived (p.1): x' // Object.is equality
```

Restored from backup; `git diff --stat src/cli/commands/verify-derive-recheck.ts` produced no
output (clean) before proceeding.

### Reintroduction 2 — deleted the `buildBlindDerivePayload` construction-site backstop

Change: the `if (ANY_ANNOTATION_LINE_RE.test(payload)) { throw ... }` block removed, leaving only
`return payload;`.

Observed: **1 test failed** (43 passed):

```
× buildBlindDerivePayload > buildBlindDerivePayload throws (never silently emits) when the
  assembled payload still matches an annotation family after quoteLinesOnly — the
  construction-site backstop
AssertionError: expected [Function] to throw an error

- Expected:
null

+ Received:
undefined
```

(This test constructs the case `quoteLinesOnly` itself cannot anticipate — a directly-quoted
sentence whose own prose mentions `Derived (p.` mid-sentence, not line-initial and therefore not a
decoration form `annotationBody` strips — which is exactly the "decoration form nobody
anticipated" scenario the backstop exists to catch.)

Restored from backup; `git diff --stat src/cli/commands/verify-derive-recheck.ts` produced no
output (clean) before proceeding. Full suite re-run after restore: 44/44 passing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `ingest-archive.ts` importing `DERIVED_LINE_RE` directly from
`verify-derive-recheck.ts` closes a real circular import**

- **Found during:** Task 1
- **Issue:** the plan's interface note says "have `ingest-archive.ts`'s relabeller consume the
  shared export rather than re-spelling its own literal." Importing `DERIVED_LINE_RE` directly from
  `verify-derive-recheck.ts` into `ingest-archive.ts` closes a real cycle:
  `ingest-archive.ts` → `verify-derive-recheck.ts` → `verify-classify.ts` → `chunk-provenance.ts`
  → `ingest-archive.ts`. Observed live: `verify-derive-recheck.test.ts` failed at collection with
  `TypeError: Cannot read properties of undefined (reading 'source')` at
  `ingest-archive.ts:354:54` (`DERIVED_LINE_RE.source` was `undefined` at module-init time because
  `ingest-archive.ts` loaded before `verify-derive-recheck.ts` finished initializing in this
  cycle).
- **Fix:** extracted `DERIVED_LINE_RE` into a new dependency-free leaf module,
  `src/cli/commands/derived-line-pattern.ts` (imports nothing). `verify-derive-recheck.ts` imports
  and re-exports the same binding (so any existing importer of `DERIVED_LINE_RE` from
  `verify-derive-recheck.ts` is unaffected), and `ingest-archive.ts` imports directly from the leaf
  module, never from `verify-derive-recheck.ts`. This still satisfies the plan's key-link check
  (`grep -c "DERIVED_LINE_RE" ingest-archive.ts` and the "no second literal" grep both pass) while
  avoiding the cycle.
- **Files modified:** `src/cli/commands/derived-line-pattern.ts` (created),
  `src/cli/commands/verify-derive-recheck.ts`, `src/cli/commands/ingest-archive.ts`
- **Commit:** `34c4efee`

**2. [Rule 1 - Bug] Test file grew a duplicate "no-phrase-list" source-grep test**

- **Found during:** Task 2
- **Issue:** while replacing the four tautological `readFileSync`-and-grep tests in the "module
  source guarantees" describe block, a second copy of the (correctly-kept) no-phrase-list assertion
  was accidentally added alongside the four replacements, duplicating the original in the
  `createDeriveVerdictRecord` describe block.
- **Fix:** removed the duplicate, added a comment on the original noting it is deliberately the
  sole surviving source-text assertion, and removed the now-dead `stripComments` helper the deleted
  tests had used (no remaining caller).
- **Files modified:** `src/cli/commands/verify-derive-recheck.test.ts`
- **Commit:** `6d525314`

### Note on an acceptance-criteria grep count

Task 2's acceptance criteria states `grep -v '^\s*//' ... | grep -c "readFileSync"` should return
"at most 1 (the surviving no-phrase-list test)". The literal command returns **2** in the final
state: the `import { readFileSync } from 'node:fs'` line and the one remaining usage inside the
no-phrase-list test. The import statement itself will always match the literal string
`readFileSync` regardless of how many call sites remain, so a true count of 1 is only achievable by
also removing the import — which would break the intentionally-kept no-phrase-list test. Only ONE
`readFileSync(...)` call site remains in the entire file (down from four), which is what the
acceptance criteria's prose is checking for; the grep pattern itself does not distinguish an import
statement from a call site. Documented here rather than silently declared passing.

## Self-Check

- [x] `src/cli/commands/derived-line-pattern.ts` exists
- [x] `src/cli/commands/verify-derive-recheck.ts` contains `annotationBody(`
- [x] `src/cli/commands/ingest-archive.ts` imports `DERIVED_LINE_RE`
- [x] `src/cli/commands/verify-classify.ts` `PRESENTATION_EXCLUSION_MARKERS` contains no `[^)]+`
- [x] Commits `34c4efee`, `6d525314`, `cc7b98c4` exist in `git log`

## Self-Check: PASSED
