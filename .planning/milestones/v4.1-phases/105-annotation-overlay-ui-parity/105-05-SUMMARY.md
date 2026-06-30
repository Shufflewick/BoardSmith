---
phase: 105-annotation-overlay-ui-parity
plan: "05"
subsystem: testing
tags: [vitest, vue-test-utils, tutorial-overlay, parity, useSelectable, anchorAttrs, jsdom]

# Dependency graph
requires:
  - phase: 105-annotation-overlay-ui-parity
    provides: "Plans 01-04: Annotation[] type, anchorAttrs on all renderers, TutorialOverlay.vue resolving anchors, GameShell wiring"

provides:
  - "TutorialOverlay.parity.test.ts — dual-path parity proof for criterion #3"
  - "7 tests proving same step.content renders identically in AutoUI and custom-UI paths"
  - "Non-vacuous test: anchor sourced from shared layer, never hand-written (grep = 0)"
  - "Cross-path equality for both element (kind:element) and action (kind:action) targets"

affects: [106-predicate-advance, 107-ai-teaching, 108-tooltips, 109-checkers-content]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MinimalAutoUIRenderer pattern: defineComponent calling useSelectable to exercise the shared anchor layer without mounting a full renderer"
    - "MinimalCustomUIRenderer pattern: defineComponent calling anchorAttrs directly to simulate a hand-rolled custom UI"
    - "Fixture wrapper pattern: WrapperComponent in test setup with provideBoardInteraction inside setup() for proper injection chain"

key-files:
  created:
    - src/ui/components/helpers/TutorialOverlay.parity.test.ts
  modified: []

key-decisions:
  - "Non-vacuity enforced via grep on the committed test file: grep -c 'data-bs-el' returns 0, proving anchors flow from useSelectable/anchorAttrs and are never hand-written"
  - "Fixture components defined as defineComponent with render functions (not SFC) so anchor attributes come from the shared composable layer, not template attribute literals"
  - "Both element and action targets covered in the single load-bearing cross-path assertion (criterion #2 x criterion #3)"
  - "Custom-UI fixture intentionally omits provideBoardInteraction to prove anchorAttrs alone is sufficient for annotation routing"

patterns-established:
  - "Parity test structure: two parallel wrapper fixtures (AutoUI + custom-UI) with the same gameState, asserting identical ring count and identical bubble text arrays"

requirements-completed: [TUT-01]

# Metrics
duration: 15min
completed: 2026-06-25
---

# Phase 105 Plan 05: TutorialOverlay Dual-Path Parity Summary

**Dual-path parity proof via MinimalAutoUIRenderer (useSelectable path) and MinimalCustomUIRenderer (anchorAttrs path) producing identical rings and bubble text for element and action targets, with non-vacuity grep enforced**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-25T22:07:00Z
- **Completed:** 2026-06-25T22:23:28Z
- **Tasks:** 3 (Tasks 1+2+3 in a single test file, committed atomically)
- **Files modified:** 1

## Accomplishments

- Wrote `TutorialOverlay.parity.test.ts` with 7 tests covering Tasks 1, 2, and 3
- AutoUI renderer path: `MinimalAutoUIRenderer` calls `useSelectable` (same path as all 8 built-in renderers) — overlay resolves ring + bubble with no annotation-specific method
- Custom-UI path: `MinimalCustomUIRenderer` calls `anchorAttrs` directly — overlay resolves ring + bubble without `boardInteraction` at all
- Cross-path equality assertion (Task 3) covers BOTH `kind:'element'` target (via shared anchor layer) AND `kind:'action'` target (`data-bs-action`), closing criterion #2 × criterion #3
- Non-vacuity greps: `grep -c "data-bs-el" file` = 0 and `grep -c "isAnnotationHighlighted" file` = 0
- Full suite: 1366 tests passed (7 new, up from 1359 baseline)

## Task Commits

Tasks 1, 2, and 3 were shipped together in a single test-file commit (all are in `TutorialOverlay.parity.test.ts`):

1. **Tasks 1+2+3: Dual-path parity proof** — `a249084` (test)

**Plan metadata commit:** (docs commit to follow)

## Files Created/Modified

- `/Users/jtsmith/BoardSmith/src/ui/components/helpers/TutorialOverlay.parity.test.ts` — Dual-path parity proof: AutoUI renderer fixture + custom-UI fixture + cross-path equality assertion for element and action targets

## Decisions Made

- All three tasks are in a single test file committed atomically — they share fixture helper functions and the cross-path test consumes both fixtures simultaneously
- Used `defineComponent` with render functions (not SFC) so no template attribute literals appear — all anchor attributes flow from `useSelectable` or `anchorAttrs` at runtime
- Custom-UI wrapper intentionally does NOT call `provideBoardInteraction` — proving the "free via shared layer" guarantee: `anchorAttrs` alone, without selection infrastructure, is sufficient for annotation routing
- Comment describing the grep constraint was rewritten to avoid the literal forbidden string itself (the comment cannot contain what the grep is checking for)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comments contained the forbidden literal strings being tested by grep**
- **Found during:** Post-write verification (acceptance grep check)
- **Issue:** The file header comment included `data-bs-el` and `isAnnotationHighlighted` as literal strings in the grep command examples, making the acceptance greps return 2 and 1 respectively instead of 0
- **Fix:** Rewrote comments to describe the grep constraint without repeating the forbidden strings; split the example pattern and deferred the method name to "documented in SUMMARY.md"
- **Files modified:** `TutorialOverlay.parity.test.ts`
- **Verification:** `grep -c "data-bs-el" file` = 0, `grep -c "isAnnotationHighlighted" file` = 0; all 7 tests still pass
- **Committed in:** a249084 (part of the same commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in comment content that violated acceptance criteria)
**Impact on plan:** Necessary fix for non-vacuity enforcement. No scope change.

## Issues Encountered

None beyond the comment grep-self-reference caught in the acceptance check.

## Known Stubs

None — this is a test-only plan. No runtime stubs introduced.

## Threat Flags

None — test-only plan; introduces no runtime surface. T-105-10 (vacuous parity test) mitigated: anchor attribute names are computed from `useSelectable`/`anchorAttrs` at runtime; the grep enforcement confirms no literal attribute strings appear in the test file.

## Self-Check

- [x] `src/ui/components/helpers/TutorialOverlay.parity.test.ts` exists
- [x] `git log --oneline | grep a249084` — commit exists
- [x] `grep -c "data-bs-el" file` = 0
- [x] `grep -c "isAnnotationHighlighted" file` = 0
- [x] `grep -c "custom\|Custom" file` ≥ 1 (custom-UI path present)
- [x] Full suite: 1366 tests, all passed

## Self-Check: PASSED

## Next Phase Readiness

- Phase 105 is complete: all 5 plans executed (01–05), all criteria met
- Criterion #1 (Annotation[] content model): Plan 01 ✓
- Criterion #2 (all four anchor kinds): Plans 02–03 ✓
- Criterion #3 (dual-path parity): Plan 05 (this plan) ✓
- MR-01 (GameShell tutorialStep wiring): Plan 04 ✓
- Phase 106 (predicate auto-advance) is unblocked

---
*Phase: 105-annotation-overlay-ui-parity*
*Completed: 2026-06-25*
