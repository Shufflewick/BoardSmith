---
phase: 85-theatre-erasure
plan: 04
subsystem: docs
tags: [breaking-changes, migration-guide, verification, theatre-erasure]

# Dependency graph
requires:
  - phase: 85-02
    provides: Session/server theatre erasure complete
  - phase: 85-03
    provides: Client/UI theatre erasure complete
provides:
  - "BREAKING.md at repo root documenting every removed API with migration patterns"
  - "Full verification: tsc clean, 509 tests pass, zero theatre references in src/"
affects: [Phase 90 Documentation & Migration]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - "BREAKING.md"
  modified:
    - "src/ui/composables/useAnimationEvents.ts"

key-decisions:
  - "BREAKING.md covers all 20 removed APIs with module, replacement, and before/after code examples"

patterns-established: []

# Metrics
duration: 2min
completed: 2026-02-08
---

# Phase 85 Plan 04: BREAKING.md and Full Verification Summary

**Created BREAKING.md documenting 20 removed theatre APIs with migration patterns; verified zero compile errors, 509 passing tests, zero theatre references in source**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-08T00:01:54Z
- **Completed:** 2026-02-08T00:04:25Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Created comprehensive BREAKING.md (146 lines) at repo root documenting every removed API
- Before/after code examples for mutation capture, acknowledgment protocol, and currentView split
- Full verification: tsc --noEmit clean, 509/509 tests pass, zero theatre references in src/
- Phase 85 success criteria fully met

## Task Commits

Each task was committed atomically:

1. **Task 1: Create BREAKING.md** - `9df1a6c` (docs)
2. **Task 2: Full verification + stale comment fix** - `fe85c60` (fix)

## Files Created/Modified
- `BREAKING.md` - Complete migration guide for v3.0 theatre removal (146 lines)
- `src/ui/composables/useAnimationEvents.ts` - Removed stale comment referencing theatre snapshot

## Decisions Made
None - followed plan as specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed stale "theatre snapshot" comment from useAnimationEvents.ts**
- **Found during:** Task 2 (clean grep verification)
- **Issue:** Comment on line 180 referenced "theatre snapshot" which no longer exists after Phase 85 removal
- **Fix:** Removed the stale comment line
- **Files modified:** src/ui/composables/useAnimationEvents.ts
- **Verification:** grep for "theatre" in src/ returns zero results
- **Committed in:** fe85c60

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minimal -- single stale comment removal. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 85 is complete. All success criteria met:
  1. _theatreSnapshot, theatreState, theatreStateForPlayer(), acknowledgeAnimationEvents() removed from Game class
  2. MutationCaptureContext, property diffing, element attribute diffing deleted -- no mutation-capture.ts or theatre-state.ts files remain
  3. acknowledgeAnimations WebSocket handler and GameSession.acknowledgeAnimations() are gone
  4. All theatre-related tests removed; 509 remaining tests pass with zero regressions
  5. BREAKING.md documents every removed API with before/after migration patterns
- Ready for Phase 86: Simplified Animation Events

---
*Phase: 85-theatre-erasure*
*Completed: 2026-02-08*
