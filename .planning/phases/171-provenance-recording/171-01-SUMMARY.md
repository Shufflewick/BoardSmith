---
phase: 171-provenance-recording
plan: 01
subsystem: cli
tags: [ingest, provenance, edition-normalization, ingest-archive]

# Dependency graph
requires:
  - phase: 170-ingest-contract-upgrade
    provides: "INDEX.md provenance header contract (HEADER_LABELS, GAPS_BEGIN/END fenced-section pattern, PRESENTATION_LEXICON house style) that this plan extends"
provides:
  - "normalizeEdition() + EDITION_EMPTY_LEXICON exported from ingest-archive.ts"
  - "Edition note: field preserving designer's original edition wording"
  - "Machine-checkable EDITION_UNKNOWN sentinel that free text can no longer displace"
affects: [171-02, 171-03, "PROV-01 (edition recording)", "PROV-03 (edition grouping)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lexicon-driven normalization with an explicit self-invalidating guard (bare-word absence), matching the existing PRESENTATION_LEXICON house style"
    - "Un-parsed adjacent field (Edition note:) for preserving human wording without adding it to the parsed-header contract (HEADER_LABELS)"

key-files:
  created: []
  modified:
    - src/cli/commands/ingest-archive.ts
    - src/cli/commands/ingest-archive.test.ts

key-decisions:
  - "Normalise (not refuse) recognisably-empty edition strings, per 171-CONTEXT.md decision 5 — refusing would make both reference games' existing INDEX.md non-conforming with no migration phase in scope."
  - "Corrected a contradiction between the plan's <behavior> spec ('no substring edition') and its <action> spec (which mandates lexicon entries 'no edition' and 'unknown edition'). Resolved in favor of the more precise <action> text: the guard is bare-word absence ('edition', 'unknown' alone), not substring absence."
  - "Reworded a doc comment that incidentally contained the substring 'PRESENTATION_LEXICON' before the real declaration — it was hijacking ingest.test.ts's naive indexOf-based lexicon-extraction test, which silently began comparing EDITION_EMPTY_LEXICON's contents against check.mjs's PRESENTATION_LEXICON copy."

requirements-completed: [PROV-01]

# Metrics
duration: 12min
completed: 2026-07-28
---

# Phase 171 Plan 01: F-1 Edition Sentinel Normalization Summary

**`normalizeEdition()` collapses recognisably-empty `--edition` free text to the machine-checkable `EDITION_UNKNOWN` sentinel at both `INDEX.md` write sites, preserving the designer's original wording on a separate un-parsed `Edition note:` line.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-28T17:30:00Z (approx)
- **Completed:** 2026-07-28T17:42:38Z
- **Tasks:** 2 (RED, GREEN)
- **Files modified:** 2

## Accomplishments
- `normalizeEdition(raw)` + `EDITION_EMPTY_LEXICON` exported from `ingest-archive.ts`, collapsing 8 recognisably-empty phrase patterns (case-insensitive substring match) to `EDITION_UNKNOWN`, while preserving genuine edition strings verbatim (trimmed).
- Applied at both `INDEX.md` write sites: `renderIndex()` (new-project path) and `ingestArchiveCommand()`'s existing-INDEX header rewrite (re-run path).
- `Edition note:` line (new export `EDITION_NOTE_LABEL`) preserves the designer's original wording whenever it normalised away from what they typed — deliberately kept out of `HEADER_LABELS` per CONTEXT.md decision 2 ("any human note goes in a separate adjacent field that nothing parses"). On the existing-INDEX rewrite path, a prior `Edition note:` line is replaced rather than accumulated on repeat runs.
- Both reference games' real `Edition:` strings (`seven`, `one-two-punch`, read live 2026-07-28) verified to normalise to `EDITION_UNKNOWN` as named test fixtures.

## Task Commits

1. **Task 1: RED — pin F-1 with tests that fail against current code** - `99443aff` (test)
2. **Task 2: GREEN — normalizeEdition + EDITION_EMPTY_LEXICON, applied at both write sites** - `15318d3f` (feat)

_Note: Task 2's commit also carries two test-file corrections discovered while driving the suite green — see Deviations below._

## RED Observation (mandatory per 171-VALIDATION.md)

Command: `npx vitest run src/cli/commands/ingest-archive.test.ts -t "edition normalization"`

Observed BEFORE Task 2 landed — 8 failed, 1 passed, 26 skipped:

```
 ❯ src/cli/commands/ingest-archive.test.ts (35 tests | 8 failed | 26 skipped) 23ms
   × edition normalization (F-1) > normalizes undefined to EDITION_UNKNOWN 5ms
     → normalizeEdition is not a function
   × edition normalization (F-1) > normalizes whitespace-only input to EDITION_UNKNOWN 2ms
     → normalizeEdition is not a function
   × edition normalization (F-1) > normalizes seven's real free-text edition to EDITION_UNKNOWN 1ms
     → normalizeEdition is not a function
   × edition normalization (F-1) > normalizes one-two-punch's real free-text edition to EDITION_UNKNOWN 1ms
     → normalizeEdition is not a function
   × edition normalization (F-1) > preserves a real edition string verbatim, trimmed 1ms
     → normalizeEdition is not a function
   × edition normalization (F-1) > matches lexicon phrases case-insensitively 1ms
     → normalizeEdition is not a function
   × edition normalization (F-1) > never contains the bare substring "edition" — that would fire on real editions like "First edition" 1ms
     → EDITION_EMPTY_LEXICON is not iterable
   × edition normalization (F-1) > writes the machine-checkable sentinel for a free-text edition, preserving the original on Edition note: 8ms
     → expected '# Rulebook Index — game\n\nEdition: n…' to contain 'Edition: not stated in the rulebook'
```

The integration-test failure line is the direct proof of F-1: pre-fix, the free-text `--edition` value (`none stated in the rulebook — © 2020 Alright Games ...`) reached `INDEX.md` verbatim instead of the `EDITION_UNKNOWN` sentinel.

## GREEN Result

Command: `npx vitest run src/cli/commands/ingest-archive.test.ts`

```
 ✓ src/cli/commands/ingest-archive.test.ts (35 tests) 279ms

 Test Files  1 passed (1)
      Tests  35 passed (35)
```

Full suite: `npm test` → **226 test files / 3332 tests passed** (baseline at phase start was 3323 — net +9 from this plan's new cases; 0 regressed).

## Files Created/Modified
- `src/cli/commands/ingest-archive.ts` — added `EDITION_EMPTY_LEXICON`, `EDITION_NOTE_LABEL`, `normalizeEdition()`; applied at `renderIndex()` and the existing-INDEX header-rewrite path in `ingestArchiveCommand()`.
- `src/cli/commands/ingest-archive.test.ts` — new `describe('edition normalization (F-1)')` block with unit cases (undefined, whitespace, both reference-game strings, genuine edition, case-insensitivity, lexicon self-guard) and two integration cases (`Edition note:` written/not-written).

## Decisions Made
- Normalise rather than refuse (CONTEXT.md decision 5's chosen branch) — refusing would break both reference games' existing `INDEX.md` files with no migration phase in this milestone's scope.
- `Edition note:` deliberately excluded from `HEADER_LABELS` — it's the un-parsed field CONTEXT.md decision 2 calls for, and `HEADER_LABELS` is the parsed-header contract shared with `scripts/ingest-harness/check.mjs` (acceptance criterion: byte-identical, confirmed via diff).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a self-contradictory test spec in the plan itself**
- **Found during:** Task 2 (driving `npx vitest run src/cli/commands/ingest-archive.test.ts` green)
- **Issue:** The plan's `<behavior>` list (Task 1) specified `EDITION_EMPTY_LEXICON` must not contain the substring `edition`, but the plan's `<action>` list (Task 2) explicitly mandates lexicon entries `no edition` and `unknown edition` — both of which literally contain the substring `edition`. Implementing the action text as written necessarily fails the literal behavior-text test I had transcribed.
- **Fix:** Re-read the action text's own stated rationale — "Deliberately ABSENT... in particular the **bare word** `edition` and the **bare word** `unknown`" — and corrected the test to assert bare-word absence (`.not.toContain('edition')` / `.not.toContain('unknown')` on the array) rather than substring absence. This matches the actual self-invalidating-guard intent: compound phrases like "no edition" never match as a substring of "First edition", so they carry no false-positive risk; only the bare word alone would.
- **Files modified:** `src/cli/commands/ingest-archive.test.ts`
- **Verification:** Test passes; `EDITION_EMPTY_LEXICON` still ships all 8 phrases the action text lists, unmodified.
- **Committed in:** `15318d3f`

**2. [Rule 1 - Bug] Reworded a doc comment whose incidental substring hijacked an unrelated lexicon-parity test**
- **Found during:** Task 2 (`npm test` full-suite run)
- **Issue:** My new doc comment above `EDITION_EMPTY_LEXICON` referenced "the PRESENTATION_LEXICON rationale below applies here too" — introducing the literal substring `PRESENTATION_LEXICON` earlier in the file than the real `export const PRESENTATION_LEXICON` declaration. `src/cli/slash-command/bs/ingest.test.ts`'s "the presentation lexicon is identical in the command and the checker" test extracts the lexicon via a naive `src.indexOf('PRESENTATION_LEXICON')` → next `[` → next `]` scan, so it silently began extracting `EDITION_EMPTY_LEXICON`'s array instead and comparing it against `check.mjs`'s real `PRESENTATION_LEXICON` copy — a spurious cross-repo mismatch failure unrelated to any actual defect in either lexicon.
- **Fix:** Reworded the comment to "the same rationale that shapes the presentation lexicon below," removing the exact-substring match while preserving the intent of the cross-reference.
- **Files modified:** `src/cli/commands/ingest-archive.ts`
- **Verification:** `npm test` — the previously-failing `ingest.test.ts` case now passes; `PRESENTATION_LEXICON` extraction is unaffected (confirmed both lexicons still compare correctly against `check.mjs`).
- **Committed in:** `15318d3f`

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs surfaced while driving the suite green: one in the plan's own test-spec, one in this plan's own code introducing test-parsing crosstalk).
**Impact on plan:** Both fixes were necessary to reach a genuinely green suite with no masked failures. No scope creep — neither touched `EDITION_EMPTY_LEXICON`'s actual contents or `normalizeEdition`'s behavior, only test assertions and a comment.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `normalizeEdition()` and `EDITION_UNKNOWN` are now safe for PROV-01 (edition recording) and PROV-03 (edition grouping) to read directly — the sentinel is machine-checkable and free text can no longer displace it.
- `~/BoardSmithGames/seven` confirmed unmodified: `git status --porcelain` empty, HEAD still `a03f38d4792af9dfc7c798be69686fc3230f54dd`, both before and after this plan's execution (read-only inspection only — the fixture strings were copied into the test file as literals, not re-derived from a live archive run against `seven`).
- No blockers for 171-02.

## Self-Check: PASSED
- `src/cli/commands/ingest-archive.ts` — FOUND (grep confirms `export function normalizeEdition` at line 80)
- `src/cli/commands/ingest-archive.test.ts` — FOUND (`describe('edition normalization (F-1)')` present)
- Commit `99443aff` — FOUND (`git log --oneline` confirms)
- Commit `15318d3f` — FOUND (`git log --oneline` confirms)

---
*Phase: 171-provenance-recording*
*Completed: 2026-07-28*
