---
phase: 178-worked-example-tests
plan: 12
subsystem: verification

# Dependency graph
requires:
  - phase: 178-worked-example-tests plan 11
    provides: "178-PROOF.md — the live dispatch proof whose §5/§9 'malformed-response rate' finding this plan root-caused and fixed"
provides:
  - "verifyExampleReplayCommand never emits a dispatchable extractionPayload for a zero-content-line slice — reported instead as the named, machine-readable notDispatchable: 'no-extractable-content'"
  - "178-PROOF.md §11 — the corrected reading of the 37.5% malformed-response rate: our own payload-construction defect, not model unreliability"
affects: [179]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First-class-blindness discipline applied to a new state: a content-free slice is named (notDispatchable) rather than silently omitted or conflated with a thrown error."
    - "Refusal-to-dispatch decided at the CALLER (verifyExampleReplayCommand), not at the payload-construction site (buildExampleExtractionPayload) — reserving construction-site throws for genuine contract violations (the existing Derived (p.N): backstop), never for a normal empty result."

key-files:
  created: []
  modified:
    - src/cli/commands/verify-example-replay.ts
    - src/cli/commands/verify-example-replay.test.ts
    - src/cli/commands/example-derivation.ts
    - .planning/phases/178-worked-example-tests/178-PROOF.md
    - .planning/phases/178-worked-example-tests/178-11-SUMMARY.md

key-decisions:
  - "buildExampleExtractionPayload keeps returning lines: [] (unchanged) for a content-free slice rather than throwing — an empty slice is a common, legitimate outcome, not the kind of contract violation its existing Derived (p.N): construction-site throw exists to catch. The refusal to DISPATCH belongs at the caller that decides whether to hand a payload to a model."
  - "notDispatchable is a typed union (ExampleReplayNotDispatchableReason) with one frozen member today, not a bare string — mirrors this module's existing extractionError precedent and gives a future second reason a home without a shape change at every call site."
  - "No skill-prose (build/test.md, verify-game.md) changes needed: neither file enumerates VerifyExampleReplaySlice's fields, and the existing (never-mentioned) extractionError field already establishes the precedent that a slice without extractionPayload is simply not dispatched — notDispatchable follows the same convention. example-derivation.test.ts's regression pin only checks command citation, not field-level prose, confirmed by reading it."

requirements-completed: []

# Metrics
duration: ~40min
completed: 2026-07-31
---

# Phase 178 Plan 12: Fix content-free extraction dispatch defect Summary

**`verifyExampleReplayCommand` no longer offers a dispatchable `extractionPayload` for a slice with zero extractable content lines — it reports `notDispatchable: 'no-extractable-content'` instead, closing the payload-construction defect that 178-11's live proof mis-measured as a 37.5% model-reliability limit.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 1 (RED test + fix, atomic)
- **Files modified:** 5 (3 source, 2 documentation corrections)

## Accomplishments

- Proved (RED test) that a zero-content-line slice previously yielded a dispatchable `extractionPayload` — the defect described in the task prompt was real, not hypothesized.
- Fixed `verifyExampleReplayCommand` to detect `buildExampleExtractionPayload(...).lines.length === 0` and report the slice as `notDispatchable: 'no-extractable-content'` with no `extractionPayload` field at all, instead of handing a model an empty prompt.
- Recorded an explicit, reasoned decision that `buildExampleExtractionPayload` itself should NOT fail-closed for this case (unlike its existing `Derived (p.N):` reference backstop) — the empty-content case is normal and frequent, not a contract violation.
- Confirmed the build-side paths (`verifyExampleTranslateCommand`, `example-test-emit.ts`'s `verifyExampleEmitCommand`) consume already-extracted `WorkedExampleSpec` entries, never `buildExampleExtractionPayload` directly — so they can never be reached with a content-free extraction payload once the replay-side guard holds. No separate fix needed there; confirmed by reading both modules' call graphs.
- Appended `178-PROOF.md` §11, correcting the record: the 37.5% figure measured the harness dispatching empty payloads and receiving honest, contractually-correct refusals — not a statement about extraction-model reliability on real content.
- Updated `178-11-SUMMARY.md`'s "Findings recorded, not fixed" entry to point at the correction rather than repeat the original mis-attribution.

## Task Commits

1. **RED test + fix (atomic)** - `72b13df9` (fix)

**Plan metadata:** (this commit, docs-only — SUMMARY.md, 178-PROOF.md §11, 178-11-SUMMARY.md correction, STATE.md)

## Files Created/Modified

- `src/cli/commands/verify-example-replay.ts` - Added `ExampleReplayNotDispatchableReason` type and `VerifyExampleReplaySlice.notDispatchable` field; `verifyExampleReplayCommand` now branches on `lines.length === 0` before constructing a dispatchable slice entry.
- `src/cli/commands/verify-example-replay.test.ts` - New RED-then-GREEN test: a plain-prose-only slice (no quotes/citations/markers) is reported `notDispatchable: 'no-extractable-content'` with `extractionPayload` undefined.
- `src/cli/commands/example-derivation.ts` - Extended `buildExampleExtractionPayload`'s doc comment recording the explicit decision NOT to fail-closed for a zero-line slice, and why that differs from the existing `Derived (p.N):` throw.
- `.planning/phases/178-worked-example-tests/178-PROOF.md` - Appended §11, the dated correction.
- `.planning/phases/178-worked-example-tests/178-11-SUMMARY.md` - Updated the affected limits-paragraph bullet to point at §11.

## Decisions Made

See `key-decisions` in frontmatter. In short: the construction site (`buildExampleExtractionPayload`) stays permissive for an empty result (it is a normal outcome across most rulebook slices); the dispatch decision (`verifyExampleReplayCommand`) is the layer that refuses to hand an empty payload to a model, reported as a named state rather than silently or via a thrown error.

## Deviations from Plan

None — plan executed exactly as written. The "also consider the build side" check (required_fix item 2) resolved to "no code change needed there," confirmed by reading `verifyExampleTranslateCommand` and `verifyExampleEmitCommand`'s call graphs rather than assumed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

CHECK-06/TEST-01's live-proof metric is now correctly attributed; any future re-run of the live proof (Phase 179 or later) will see 4 of the 25 slices report `notDispatchable` immediately, mechanically, with zero dispatches and therefore zero possibility of a "malformed response" for that class of slice. No blockers.

---
*Phase: 178-worked-example-tests*
*Completed: 2026-07-31*
