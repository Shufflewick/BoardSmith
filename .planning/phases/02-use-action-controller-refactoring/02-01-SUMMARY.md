---
phase: 02-use-action-controller-refactoring
plan: 01
subsystem: ui
tags: [vue, composables, refactoring, analysis]

# Dependency graph
requires:
  - phase: 01-game-session-refactoring
    provides: Completed class extraction patterns as reference
provides:
  - Analysis document mapping 1,807-line composable structure
  - Revised extraction strategy (types + helpers only)
  - Rationale for keeping stateful code together
affects: [02-02, 02-03, 02-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vue composable analysis methodology"
    - "Pit of Success pattern preservation"

key-files:
  created:
    - .planning/phases/02-use-action-controller-refactoring/02-ANALYSIS.md
  modified: []

key-decisions:
  - "Original 3-composable extraction is too aggressive - state too interconnected"
  - "Extract types (~350 lines) and pure helpers (~100 lines) only"
  - "Keep remaining ~1,300 lines together to preserve Pit of Success architecture"

patterns-established:
  - "Vue composable extraction: prefer type/helper extraction over stateful splits"

issues-created: []

# Metrics
duration: 6min
completed: 2026-01-08
---

# Phase 2 Plan 01: Analyze useActionController Summary

**Analyzed 1,807-line Vue composable and revised extraction strategy - original 3-composable plan too aggressive, recommending types + helpers extraction only**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-08T20:19:59Z
- **Completed:** 2026-01-08T20:26:46Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Mapped complete structure of useActionController.ts with line counts
- Identified all state refs, computed values, helpers, and core methods
- Discovered that `actionSnapshot` is central to everything - the "Pit of Success" pattern
- Revised extraction strategy from 3 composables to 2 extractions (types + helpers)
- Documented key differences between class extraction (Phase 1) and composable extraction

## Task Commits

1. **Task 1: Document current structure** - `b307f4f` (docs)

**Plan metadata:** (this commit)

## Files Created/Modified

- `.planning/phases/02-use-action-controller-refactoring/02-ANALYSIS.md` - Complete analysis with structure mapping and extraction recommendations

## Decisions Made

1. **Original plan too aggressive**: The proposed `useSelectionState`, `useFollowUp`, `useActionExecution` extraction would break the Pit of Success architecture because:
   - All state flows through `actionSnapshot`
   - Methods share responsibility across proposed boundaries
   - `fill()` triggers fetch + auto-fill for next selection
   - FollowUp is just a variant of `start()`, not separable

2. **Revised strategy**: Extract only what's genuinely independent:
   - Types (~350 lines) - zero risk, purely organizational
   - Pure helpers (~100 lines) - low risk, no state dependencies
   - Keep ~1,300 lines of stateful code together

3. **Phase 2 plans need revision**: The existing 02-02, 02-03, 02-04 plans should be updated to reflect this analysis

## Deviations from Plan

None - plan executed exactly as written (analysis task + human verification).

## Issues Encountered

None

## Next Phase Readiness

- Analysis complete, extraction boundaries clearly defined
- **Important**: Plans 02-02, 02-03, 02-04 in ROADMAP.md describe the original 3-composable extraction
- These plans should be revised to match the new strategy:
  - 02-02: Extract types to `useActionControllerTypes.ts`
  - 02-03: Extract helpers to `actionControllerHelpers.ts`
  - 02-04: (Optional) Extract enrichment to `useGameViewEnrichment.ts`

---
*Phase: 02-use-action-controller-refactoring*
*Completed: 2026-01-08*
