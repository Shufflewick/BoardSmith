---
phase: 71-deprecated-api-removal
plan: 01
subsystem: ui
tags: [vue, animation, flying-elements, api-cleanup]

# Dependency graph
requires:
  - phase: 64-68
    provides: Flying elements API with deprecated aliases
provides:
  - Clean flying element API with only fly()/flyMultiple()/FlyConfig
  - Internal callers migrated from deprecated APIs
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Use fly() for single element animation"
    - "Use flyMultiple() for batched element animations with stagger"
    - "Use FlyConfig type with elementData/elementSize properties"

key-files:
  created: []
  modified:
    - src/ui/composables/usePlayerStatAnimation.ts
    - src/ui/components/auto-ui/AutoGameBoard.vue
    - src/ui/composables/useActionAnimations.ts
    - src/ui/composables/useFlyingElements.ts
    - src/ui/index.ts
    - docs/ui-components.md

key-decisions:
  - "Removed deprecated APIs without deprecation period since internal-only usage"

patterns-established:
  - "FlyConfig uses elementData and elementSize (not cardData/cardSize)"
  - "flyMultiple for batched animations, fly for single"

# Metrics
duration: 3min
completed: 2026-02-02
---

# Phase 71 Plan 01: Deprecated API Removal Summary

**Migrated internal callers from deprecated flyCard()/flyCards()/FlyCardOptions to new fly()/flyMultiple()/FlyConfig APIs, then removed deprecated code entirely**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-02T02:50:48Z
- **Completed:** 2026-02-02T02:54:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Migrated usePlayerStatAnimation.ts to use flyMultiple/FlyConfig with elementData/elementSize properties
- Migrated AutoGameBoard.vue to use fly() with elementData/elementSize properties
- Migrated useActionAnimations.ts to use fly() with elementData/elementSize properties
- Removed flyCard(), flyCards(), and FlyCardOptions from useFlyingElements.ts
- Removed FlyCardOptions export from src/ui/index.ts
- Updated documentation to use new API

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate internal callers to new flying APIs** - `ee489e7` (refactor)
2. **Task 2: Remove deprecated APIs and update exports** - `03aca00` (refactor)

## Files Created/Modified
- `src/ui/composables/usePlayerStatAnimation.ts` - Updated to use FlyConfig/flyMultiple/elementData/elementSize
- `src/ui/components/auto-ui/AutoGameBoard.vue` - Updated to use fly()/elementData/elementSize
- `src/ui/composables/useActionAnimations.ts` - Updated to use fly()/elementData/elementSize
- `src/ui/composables/useFlyingElements.ts` - Removed FlyCardOptions interface, flyCard(), and flyCards() functions
- `src/ui/index.ts` - Removed FlyCardOptions from exports
- `docs/ui-components.md` - Updated usePlayerStatAnimation example to use flyMultiple

## Decisions Made
- Removed deprecated APIs immediately rather than adding a deprecation period, since all callers were internal to the library

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Flying element API is now clean with consistent naming
- Ready for Phase 72 (next cleanup phase)

---
*Phase: 71-deprecated-api-removal*
*Completed: 2026-02-02*
