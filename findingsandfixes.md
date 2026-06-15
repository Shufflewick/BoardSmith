# BoardSmith UI Findings and Fixes

Date: March 2, 2026  
Scope: UI/action-controller integration patterns, with emphasis on fragility, clarity, and code smell.

## Executive Summary

The UI flow now enforces a single source of truth for action state (`useActionController`).
Timer-based sequencing hacks were removed, string-key injection paths were removed, and dead code used for dual-state syncing was deleted.

This is a **breaking cleanup** by design (no backward-compat layer).

## Breaking Changes (Must Migrate)

1. `useActionController({ externalArgs })` was removed.
2. `currentArgs` is now read-only from consumers.
3. `ActionPanel` no longer accepts `selectedElementId`.
4. `GameShell` no longer provides `actionArgs` or `'boardInteraction'` via string-key `provide/inject`.
5. Internal `_preview_<selectionName>` multi-select arg keys are removed.

## Findings, Fixes, and Migration

### 1) Split-brain action state (fragile)

**Finding**: `ActionPanel` and consumers could directly mutate `currentAction/currentArgs`, while controller logic tracked its own selection snapshot. This created drift and hard-to-debug behavior.

**Fix**:
- `ActionPanel` now delegates through controller APIs only: `start`, `fill`, `clear`, `cancel`, `execute`.
- Direct mutation helpers were deleted (`clearReactiveObject`, `clearActionState`, preview-key sync paths).
- Drag/drop and board-click flows now call `startAction(..., { args })` and `setSelectionValue(...)` instead of mutating args directly.

**Migration**:
- Replace direct writes:
  - `actionController.currentArgs.value.foo = value` -> `await actionController.fill('foo', value)`
  - `delete actionController.currentArgs.value.foo` -> `actionController.clear('foo')`
  - direct `currentAction` assignment -> `await actionController.start('actionName', { args: {...} })`
- If you prefill and then continue wizard flow, always prefill through `start(..., { args })` or `fill(...)`.

### 2) External arg write-through model removed

**Finding**: `externalArgs` allowed arbitrary writes from outside the controller, causing state pollution and unclear ownership.

**Fix**:
- Removed `externalArgs` from `UseActionControllerOptions`.
- Controller owns args internally.
- Public `currentArgs` is exposed as read-only.

**Migration**:
- Remove `externalArgs` from `useActionController(...)` calls.
- Replace any direct shared-object mutation patterns with controller API calls (`fill`, `clear`, `start`, `cancel`).
- If you need a display/read model in components, use:
  - `const actionArgs = computed(() => actionController.currentArgs.value)`

### 3) Follow-up sequencing used timers (race-prone)

**Finding**: `setTimeout(..., 0)` was used for follow-up transitions, creating timing fragility.

**Fix**:
- Replaced timeout scheduling with deterministic queueing: `nextTick()` + async follow-up start.

**Migration**:
- No API change required.
- Remove any custom workarounds that assume follow-ups are timer-delayed.

### 4) Board interaction DI and drop marker lifecycle were brittle

**Finding**:
- Mixed typed and string-key injection paths made integration unclear.
- Dropped-element suppression relied on delayed timer reset.

**Fix**:
- Unified board interaction access to typed composable usage (`useBoardInteraction`/`injectBoardInteraction`).
- Added `consumeLastDroppedElementId()`; removed delayed reset timer.

**Migration**:
- Do not use `inject('boardInteraction')` string-key injection.
- Use:
  - `const boardInteraction = injectBoardInteraction()` or `useBoardInteraction()`
- If you suppress animations after drag-drop, consume once:
  - `const droppedId = boardInteraction?.consumeLastDroppedElementId()`

### 5) `ActionPanel` API cleanup

**Finding**: `selectedElementId` prop and related watcher bypassed controller pathways.

**Fix**:
- Removed `selectedElementId` prop from `ActionPanel`.
- Selection must now flow through controller/board interaction callbacks.

**Migration**:
- Remove `:selected-element-id="..."` from `ActionPanel` usage.
- Drive selection via board interaction events or `actionController.fill(...)`.

### 6) Multi-select preview key smell removed

**Finding**: `_preview_*` arg keys leaked internal UI preview state into shared action args.

**Fix**:
- Removed preview key synchronization entirely.
- Multi-select confirmation now commits through controller (`fill`) only.

**Migration**:
- If custom UI depended on `_preview_*`, move preview state to local component state.
- Commit the final array through `await actionController.fill(selectionName, values)`.

### 7) Enrichment lookup inefficiency (N * tree-search)

**Finding**: repeated `findElementById` traversal for each element was unnecessary and scaled poorly.

**Fix**:
- Added per-root element ID index cache in `useGameViewEnrichment`.
- Kept warning semantics (warn once per missing element ID).

**Migration**:
- No API change required.

### 8) Documentation drift

**Finding**: API docs had stale examples (`GameShell` slots, `useDragDrop` shape, missing imports).

**Fix**:
- Updated docs to match current APIs in `docs/api/ui.md`.

**Migration**:
- Recheck any copied examples against updated docs before porting.

## Dead Code Removed

- `ActionPanel.vue`
  - `clearReactiveObject`
  - `clearActionState`
  - `_preview_*` multi-select watcher/sync paths
  - `selectedElementId` prop watcher
  - direct args/action mutation branches
- `useActionController.ts`
  - `externalArgs` pathways and pollution warning logic
  - timer-based follow-up scheduling branches
- `GameShell.vue`
  - shared mutable `actionArgs` source object
  - string-key `provide('actionArgs')`
  - string-key `provide('boardInteraction')`
  - mount/join timeout delays

## Validation

- Focused tests passing:
  - `src/ui/composables/useActionController.test.ts`
  - `src/ui/composables/useActionController.picks.test.ts`
  - `src/ui/composables/useAnimationEvents.test.ts`
  - `src/ui/composables/useBoardInteraction.test.ts`
  - `src/ui/composables/useGameViewEnrichment.test.ts`
  - Result: 139/139 tests passed.
- Typecheck status:
  - `npx tsc --noEmit` currently reports one unrelated pre-existing test typing issue at `src/session/build-player-state.test.ts:144`.

## Migration Checklist

1. Remove `externalArgs` usage from all `useActionController(...)` calls.
2. Replace all direct `currentArgs` mutation with `fill/clear/start/cancel` calls.
3. Remove `ActionPanel` `selectedElementId` wiring.
4. Replace any `inject('boardInteraction')` usage with typed board interaction access.
5. Remove any `_preview_*` multi-select key assumptions.
6. Re-run app flows for: board click selection, drag/drop selection, multi-select, and follow-up action chains.
