---
phase: 132-engine-element-builder-safety
plan: 02
subsystem: engine
tags: [element-tree, mutation-safety, piece, moveToInternal, error-handling]

# Dependency graph
requires:
  - phase: 132-01
    provides: PROC-01 verification gate — F3/ENG-01 independently confirmed LEGITIMATE against current source
provides:
  - Unconditional (all-mode) self/descendant containment guard in Piece.moveToInternal
  - Actionable dual-named Error thrown before any tree mutation on invalid putInto()
  - Red-first regression test covering self-move, descendant-move, and legal-move control
affects: [133-engine-flow-action-validation, 139-docx-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chokepoint guard: validation runs as the first statement of the single low-level mutation method (moveToInternal), before any dev-only diagnostics or state mutation"

key-files:
  created: []
  modified:
    - src/engine/element/piece.ts
    - src/engine/element/game-element.test.ts

key-decisions:
  - "Self-move error message also uses the word 'descendant' (an element is trivially its own descendant) so both self and descendant cases share one actionable error shape and one test regex"
  - "Guard placed BEFORE the existing isDevMode()-gated WR-03 detached-destination check, not merged into it — different bug class (production tree corruption vs. dev-only stale-closure diagnostic)"

patterns-established:
  - "New always-on invariant checks at moveToInternal must precede WR-03's dev-only block, matching the 132-PATTERNS.md ancestor-walk idiom with an explicit destination === this pre-check"

requirements-completed: [ENG-01, PROC-02]

# Metrics
duration: 12min
completed: 2026-07-03
---

# Phase 132 Plan 02: Self/Descendant putInto Containment Guard Summary

**Piece.moveToInternal now throws an actionable, dual-named error (unconditionally, in all modes) instead of silently corrupting the element tree when putInto() targets the moved element itself or one of its own descendants.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-03T05:08:00Z
- **Completed:** 2026-07-03T05:20:08Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Red-first regression test added to the existing `Piece Movement` describe block in `game-element.test.ts`, covering self-move, descendant-move, and a legal-move control
- RED confirmed: both throw-assertions failed against unpatched `moveToInternal` (`expected [Function] to throw an error` — `undefined` received)
- Containment guard added as the first statement of `moveToInternal`, before Phase 131's `isDevMode()`-gated WR-03 block: an explicit `destination === this` pre-check, followed by an O(depth) ancestor walk on `destination._t.parent`
- WR-03 dev-only devWarn block left completely unchanged; confirmed via `grep -n isDevMode` that the new throw is not nested inside it
- Full suite green: 168 files / 2138 tests

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — regression test for self/descendant putInto** - `8811072` (test)
2. **Task 2: GREEN — self/descendant containment throw in moveToInternal** - `edfa335` (feat)

**Plan metadata:** (this commit, following) - `docs: complete 132-02 plan`

## Files Created/Modified
- `src/engine/element/piece.ts` - Added unconditional containment guard (self pre-check + ancestor walk) as the first statement of `moveToInternal`, before the existing WR-03 dev-only block
- `src/engine/element/game-element.test.ts` - Added `ENG-01 self/descendant containment` nested describe inside `Piece Movement` with 3 test cases (self, descendant, legal-move control)

## Decisions Made
- The self-move error message includes the word "descendant" ("an element is trivially its own descendant") so a single regex (`/descendant/`) and a single actionable-error shape cover both the self-move and true-descendant cases, per the plan's Task 1 instruction to assert both via the same matcher.
- Guard kept as a fully separate check from WR-03 (not merged), preserving WR-03's distinct purpose (dev-only detached-destination diagnostic for stale post-restore closures) per 132-RESEARCH.md Pitfall 1.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The first test run against the unmodified fix produced RED as expected (2 failures); after adding the guard, one test regex needed the self-move error message to include "descendant" for consistency with the plan's stated assertion pattern — this was addressed within Task 2 before committing (not a separate deviation, just following the plan's own acceptance-criteria wording).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

ENG-01 (F3) is fully resolved: `putInto()` onto self or a descendant throws an actionable error in all environments, at the sole low-level mutation chokepoint (`moveToInternal`), covering all four call paths (`Piece.putInto`, `Piece.remove`, `executeMove`, `executeRemove`) confirmed in `132-FINDINGS-VERIFICATION.md`. No documentation described the prior silent-detach behavior, so no doc update was needed. Ready for 132-03 (next ENG finding in this phase).

---
*Phase: 132-engine-element-builder-safety*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: src/engine/element/piece.ts
- FOUND: src/engine/element/game-element.test.ts
- FOUND: .planning/phases/132-engine-element-builder-safety/132-02-SUMMARY.md
- FOUND commit: 8811072 (test)
- FOUND commit: edfa335 (feat)
