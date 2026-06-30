---
phase: 94-interaction-presentation-playability
plan: 02
subsystem: ui
tags: [vue3, composable, action-controller, action-panel, game-shell, board-interaction]

requires:
  - phase: 94-01
    provides: protocol refs migration (RefWithRole/ChoiceWithRefs.refs) that allCurrentChoicesAnchored reads

provides:
  - allCurrentChoicesAnchored computed on useActionController (false at rest; true when every active choice is board-anchored)
  - GameShell footer auto-absent via v-if (not v-show) when all choices anchored OR suppressActionPanel=true
  - suppressActionPanel prop on GameShell (default false) for explicit D-02 escape hatch
  - action-panel slot on GameShell for replacing ActionPanel while keeping footer chrome
  - filterAnchoredChoices() pure utility — ActionPanel filteredChoices excludes anchored choices for mixed-anchor picks (D-03)
  - ActionPanel.test.ts with 10 tests for D-03 filter logic

affects:
  - 94-03 (renderer interaction wiring reads allCurrentChoicesAnchored behavior)
  - 94-05 (game playability gates rely on footer being absent during board-anchored picks)
  - 94-06 (playability gate verifies DOM-absent footer)

tech-stack:
  added: []
  patterns:
    - "D-02: v-if at <footer> level (not v-show, not on <ActionPanel>) — full chrome absent"
    - "D-02: allCurrentChoicesAnchored computed returns false for null pick (Pitfall 4 guard)"
    - "D-03: filterAnchoredChoices pure function — anchored choices excluded from panel only for choice picks"
    - "Extract pure filter logic from Vue computed into testable helper module"

key-files:
  created:
    - src/ui/components/auto-ui/action-panel-helpers.ts
    - src/ui/components/auto-ui/ActionPanel.test.ts
  modified:
    - src/ui/composables/useActionController.ts
    - src/ui/composables/useActionControllerTypes.ts
    - src/ui/composables/useActionController.test.ts
    - src/ui/components/GameShell.vue
    - src/ui/components/auto-ui/ActionPanel.vue

key-decisions:
  - "allCurrentChoicesAnchored returns false for null pick (no action in progress) — Pitfall 4: player must be able to start actions"
  - "filterAnchoredChoices extracted to action-panel-helpers.ts as pure function — enables independent unit testing without mounting the component"
  - "v-if at <footer> level, not on <ActionPanel> — ensures footer chrome (padding, positioning) is fully absent, not hidden"
  - "slot name='action-panel' wraps ActionPanel in footer — board UIs can replace ActionPanel while keeping footer structure if needed"

patterns-established:
  - "D-02 auto-absent: controller computed drives footer v-if; no special GameShell knowledge of pick semantics"
  - "D-03 hybrid filter: pure function filterAnchoredChoices(choices, pickType) — testable without Vue reactivity"
  - "Pitfall 4 guard pattern: any computed that drives UI absence MUST return false for the null/empty state"

requirements-completed: [INTERACT-01, INTERACT-02]

duration: 25min
completed: 2026-06-21
---

# Phase 94 Plan 02: ActionPanel Auto-Absent and Hybrid Filter Summary

**`allCurrentChoicesAnchored` computed + GameShell `v-if` footer + `suppressActionPanel` prop/slot + `filterAnchoredChoices` hybrid filter for board-centric ActionPanel suppression (D-02/D-03)**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-21T16:00:00Z
- **Completed:** 2026-06-21T16:25:00Z
- **Tasks:** 2 (Task 1 TDD: controller computed; Task 2: GameShell + ActionPanel)
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- Added `allCurrentChoicesAnchored: ComputedRef<boolean>` to `useActionController` and `UseActionControllerReturn` — returns false at rest (Pitfall 4 guard), true for element/elements picks, true for choice picks where every choice has refs.length > 0
- GameShell footer now uses `v-if` (not `v-show`) at `<footer>` level with `!props.suppressActionPanel && !actionController.allCurrentChoicesAnchored.value` — full chrome absent when all choices are board-anchored
- Added `suppressActionPanel?: boolean` prop (default false) and `<slot name="action-panel">` escape hatch to GameShell
- Extracted D-03 filter as pure `filterAnchoredChoices(choices, pickType)` in `action-panel-helpers.ts`; ActionPanel's `filteredChoices` computed uses it to exclude board-anchored choices from the panel for mixed-anchor picks
- 15 new tests (5 controller cases + 10 ActionPanel filter cases), all passing

## Task Commits

1. **Task 1: Add allCurrentChoicesAnchored computed + controller return type** - `5b4902f` (feat — TDD RED→GREEN verified)
2. **Task 2: GameShell footer v-if + suppress prop/slot + ActionPanel hybrid filter** - `6cf3b64` (feat)

## Files Created/Modified

- `src/ui/composables/useActionController.ts` - Added `allCurrentChoicesAnchored` computed (after `isReady`), added to return object, fixed `ChoiceWithRefs` import
- `src/ui/composables/useActionControllerTypes.ts` - Added `allCurrentChoicesAnchored: ComputedRef<boolean>` to `UseActionControllerReturn` interface
- `src/ui/composables/useActionController.test.ts` - Added 5 behavior-case tests for the new computed
- `src/ui/components/GameShell.vue` - Added `suppressActionPanel` prop + withDefaults, wrapped footer with conditional v-if, wrapped ActionPanel in slot
- `src/ui/components/auto-ui/ActionPanel.vue` - Added `filterAnchoredChoices` import and call in `filteredChoices` computed
- `src/ui/components/auto-ui/action-panel-helpers.ts` - NEW: pure `filterAnchoredChoices` utility function
- `src/ui/components/auto-ui/ActionPanel.test.ts` - NEW: 10 tests for D-03 filter (mixed/none/all-anchored, element pick no-op, refs edge cases)

## Decisions Made

- Extracted D-03 filter logic into `action-panel-helpers.ts` rather than leaving inline in ActionPanel's computed — pure functions are testable without mounting the full Vue component (pit of success for tests).
- `filterAnchoredChoices` accepts `pickType: string | undefined` instead of a full PickMetadata — minimizes surface and avoids leaking component internals to the helper.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing ChoiceWithRefs import in useActionController.ts**
- **Found during:** Task 1 (TypeScript compilation check)
- **Issue:** `ChoiceWithRefs` was re-exported but not imported for use inside the function; TypeScript error "Cannot find name 'ChoiceWithRefs'" at the cast in `allCurrentChoicesAnchored`
- **Fix:** Added `ChoiceWithRefs` to the `import type { ... }` block from `useActionControllerTypes.js`
- **Files modified:** `src/ui/composables/useActionController.ts`
- **Verification:** `npx tsc --noEmit` passes with no new errors
- **Committed in:** 6cf3b64 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Minor TypeScript fix; no scope change.

## Issues Encountered

- Pre-existing test failure: "should preserve followUp pre-filled args when skip triggers auto-execute" in `useActionController.test.ts` — was failing before this plan's changes and is out of scope. 869 tests pass, 1 pre-existing failure.

## Known Stubs

None — all logic is fully wired.

## Threat Flags

No new security surface introduced. The `suppressActionPanel` prop is purely presentational — server-side pick validation is unchanged. No network endpoints, auth paths, or schema changes.

## Next Phase Readiness

- `allCurrentChoicesAnchored` is available for any component that injects `actionController` (e.g., custom UIs that want to conditionally render their own action surface)
- GameShell footer suppression is active — board games will now auto-hide the footer during element picks
- Ready for 94-03 (renderer interaction wiring) which will exercise the full D-02/D-03 flow

## Self-Check

---
*Phase: 94-interaction-presentation-playability*
*Completed: 2026-06-21*
