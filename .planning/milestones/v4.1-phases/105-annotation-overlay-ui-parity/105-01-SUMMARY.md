---
phase: 105-annotation-overlay-ui-parity
plan: 01
subsystem: engine
tags: [tutorial, annotation, types, discriminated-union, typescript]

# Dependency graph
requires:
  - phase: 104-tutorial-foundation
    provides: TutorialStep/TutorialStepView with content?: unknown reserved slots, getActiveTutorialStepView projection
provides:
  - Annotation, AnnotationTarget, AnnotationPlacement, ElementRef types in src/engine/tutorial/types.ts
  - content?: Annotation[] on TutorialStep and TutorialStepView (narrowed from unknown)
  - Guard test proving annotation content survives the TutorialStepView projection unchanged
affects:
  - 105-02, 105-03, 105-04, 105-05 (all bind to the Annotation/AnnotationTarget contract)
  - 106 (advanceWhen RESERVED, untouched)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Engine-local ElementRef re-declaration: structurally identical to useBoardInteraction.ElementRef but declared in engine to preserve engine→never→ui dependency direction"
    - "Discriminated union on `kind` field for AnnotationTarget (Pit of Success — invalid shapes unrepresentable in types)"

key-files:
  created:
    - src/engine/tutorial/annotation.test.ts
  modified:
    - src/engine/tutorial/types.ts

key-decisions:
  - "Engine re-declares ElementRef locally rather than importing from src/ui — preserves clean dependency direction (engine must not import upward into UI layer)"
  - "AnnotationTarget uses discriminated union on kind: element/action/panel — invalid targets are unrepresentable in types (T-105-01 mitigated)"
  - "text is required on Annotation — ring-only annotations still carry describing prose (UI-SPEC §4); bubble-only annotations omit target"
  - "advanceWhen left as unknown (Phase 106 RESERVED) — untouched per plan constraint"

patterns-established:
  - "Engine-local type mirrors: re-declare structurally identical types from UI layer rather than importing upward"
  - "content field as Annotation[]: array model lets one step combine a targeted highlight ring with an independent floating prose bubble"

requirements-completed: [TUT-01]

# Metrics
duration: 8min
completed: 2026-06-25
---

# Phase 105 Plan 01: Annotation Content Model Summary

**`Annotation[]` discriminated-union content model on TutorialStep and TutorialStepView with AnnotationTarget (element/action/panel), engine-local ElementRef, and a projection round-trip guard test**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-25T21:35:00Z
- **Completed:** 2026-06-25T21:43:19Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Narrowed `TutorialStep.content` and `TutorialStepView.content` from `unknown` to `Annotation[]`
- Defined `AnnotationTarget` as a discriminated union: `{kind:'element', ref:ElementRef}` | `{kind:'action', actionName:string}` | `{kind:'panel'}` — invalid shapes unrepresentable (T-105-01)
- Declared engine-local `ElementRef` (`{id?,name?,notation?}`) mirroring `useBoardInteraction.ElementRef` with no upward import
- Defined `AnnotationPlacement = 'auto'|'top'|'bottom'|'center'` and `Annotation {text, target?, placement?}`
- Left `advanceWhen?: unknown` RESERVED (Phase 106)
- Guard test proves annotation content deep-equals the authored array through `getActiveTutorialStepView`, covers all three target kinds, and verifies absent content projects as absent (not undefined)

## Task Commits

Each task was committed atomically:

1. **Task 1: Define annotation content model on TutorialStep + TutorialStepView** - `4a2832e` (feat)
2. **Task 2: Guard test — content survives the TutorialStepView projection** - `42a4c74` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/engine/tutorial/types.ts` - Added Annotation, AnnotationTarget, AnnotationPlacement, ElementRef types; narrowed content fields on TutorialStep and TutorialStepView
- `src/engine/tutorial/annotation.test.ts` - Projection round-trip guard: deep equality, absent-content check, all three target kinds including compile-time satisfies assertions

## Decisions Made

- Engine declares its own `ElementRef` to avoid upward import from `src/ui` — same `{id?,name?,notation?}` shape maintained by convention; match precedence (id > notation > name) documented
- `text` required on `Annotation` even for ring-only highlights — every annotation carries prose (UI-SPEC §4)
- `content` is an array to allow one step to pair a targeted ring with an independent floating bubble

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `Annotation[]` type contract is locked; all Phase 105 plans (02-05) can now bind to it
- `getActiveTutorialStepView` already carries `content` verbatim — no runtime changes needed for the projection
- Phase 106 `advanceWhen` remains RESERVED and untouched

---
*Phase: 105-annotation-overlay-ui-parity*
*Completed: 2026-06-25*
