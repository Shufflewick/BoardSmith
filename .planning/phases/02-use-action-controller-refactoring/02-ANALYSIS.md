# useActionController Analysis

Analysis of `packages/ui/src/composables/useActionController.ts` for Vue composable extraction.

## 1. Current Structure (1,807 lines total)

### Section Breakdown

| Section | Lines | Description |
|---------|-------|-------------|
| Header comments/docs | 1-94 | Usage documentation, examples |
| Development mode warnings | 100-121 | `isDevMode()`, `devWarn()` helper |
| Types/Interfaces | 96-350 (~254 lines) | Public API types for action metadata |
| Options & State types | 295-444 (~150 lines) | Controller options and return types |
| Main function body | 450-1715 (~1265 lines) | Core composable logic |
| Injection helpers | 1717-1807 (~90 lines) | `injectActionController()`, etc. |

### State Refs (lines 474-519)

| Ref | Purpose |
|-----|---------|
| `currentAction` | Currently active action name |
| `internalArgs` | Internal args storage (if no externalArgs) |
| `isExecuting` | Whether action is currently executing |
| `lastError` | Last validation/execution error |
| `pendingFollowUp` | Prevents race condition with followUp auto-start |
| `isLoadingChoices` | Whether choices are being fetched |
| `repeatingState` | State for repeating selections |
| `actionSnapshot` | Pit of Success: frozen action state |
| `suppressNextWatcherFetch` | Flag to prevent double-fetch |
| `snapshotVersion` | Version counter for reactive snapshot updates |

### Computed Values (lines 820-943)

| Computed | Lines | Purpose |
|----------|-------|---------|
| `currentActionMeta` | 820-832 | Gets metadata from snapshot or live |
| `currentSelection` | 895-913 | First unfilled selection with enrichment |
| `isReady` | 915-918 | Whether all selections filled |
| `validElements` | 928-943 | Reactive valid elements for current selection |

### Helper Functions (lines 522-858)

| Helper | Lines | Purpose |
|--------|-------|---------|
| `getDisplayFromValue` | 527-540 | Extract display string from value |
| `clearArgs` | 543-548 | Clear args while preserving reactivity |
| `clearAdvancedState` | 551-554 | Clear repeating/snapshot state |
| `getActionMetadata` | 556-558 | Get metadata for action name |
| `findDisplayForValue` | 564-584 | Find display in snapshot choices |
| `getChoices` | 590-660 | Get choices with filterBy/dependsOn handling |
| `getCurrentChoices` | 663-667 | Convenience for current selection |
| `getValidElements` | 670-676 | Get valid elements from snapshot |
| `selectionNeedsInput` | 678-681 | Check if selection needs value |
| `validateSelection` | 683-705 | Validate selection value |
| `buildServerArgs` | 712-741 | Build args from collectedSelections |
| `enrichElementsList` | 840-857 | Add full element data from gameView |
| `enrichValidElements` | 864-893 | Enrich selection's validElements |

### Core Methods (lines 746-1679)

| Method | Lines | Purpose |
|--------|-------|---------|
| `fetchChoicesForSelection` | 746-816 | Fetch choices from server |
| `executeCurrentAction` | 1034-1089 | Execute with current args |
| `execute` | 1091-1189 | Direct execution with validation |
| `startFollowUp` | 1199-1310 | Start follow-up action (bypasses availability) |
| `start` | 1312-1431 | Start action wizard mode |
| `fill` | 1433-1493 | Fill a selection value |
| `handleRepeatingFill` | 1497-1584 | Handle repeating selection fills |
| `getNextSelection` | 1587-1602 | Get next unfilled selection |
| `skip` | 1604-1619 | Skip optional selection |
| `clear` | 1622-1629 | Clear a selection value |
| `cancel` | 1631-1636 | Cancel current action |
| `getCollectedSelection` | 1653-1655 | Get single collected selection |
| `getCollectedSelections` | 1671-1679 | Get all collected selections |

### Watchers (lines 948-1030)

| Watcher | Lines | Purpose |
|---------|-------|---------|
| Auto-fill watch | 948-1022 | Fetch choices and auto-fill single-choice |
| Auto-execute watch | 1026-1030 | Execute when all selections filled |

## 2. Proposed Extractions

After careful analysis, the original plan of 3 composables is **too aggressive**. The code is highly interconnected:

- Selection state (`collectedSelections`, `selectionSnapshots`) is deeply tied to action state (`actionSnapshot`)
- `fill()` triggers choice fetching for next selection and auto-fill logic
- `start()`, `startFollowUp()`, and `fill()` all share the same snapshot manipulation
- FollowUp is not separable - it's just a variant of `start()` that bypasses availability checks

### Why Decomposition is Difficult

1. **Snapshot is the central state** - Everything reads/writes `actionSnapshot`:
   - `start()` creates it
   - `fill()` updates `collectedSelections`
   - `getChoices()` reads `selectionSnapshots`
   - `buildServerArgs()` reads `collectedSelections`

2. **Choices and selections are coupled** - `fill()` must:
   - Update args
   - Update `collectedSelections`
   - Fetch choices for next selection
   - Trigger auto-fill if single choice
   - Handle repeating selections specially

3. **Repeating selections are tightly integrated** - `handleRepeatingFill()` uses:
   - `selectionStep` callback
   - `repeatingState` ref
   - `currentArgs` manipulation
   - `clearArgs()` and `clearAdvancedState()`

### Revised Strategy: Extract Read-Only Helpers Only

Instead of extracting stateful composables, extract **pure helper functions** into separate files:

#### a. `useActionControllerTypes.ts` (~350 lines)

All type definitions - already at the top of the file:
- `ElementRef`, `ChoiceWithRefs`, `ValidElement`
- `SelectionMetadata`, `ActionMetadata`
- `FollowUpAction`, `ActionResult`, `ValidationResult`
- `SelectionStepResult`, `SelectionChoicesResult`
- `ActionStateSnapshot`, `CollectedSelection`, `SelectionSnapshot`
- `UseActionControllerOptions`, `UseActionControllerReturn`
- `RepeatingState`

**Benefit:** Types are the largest chunk and genuinely independent.

#### b. `actionControllerHelpers.ts` (~100 lines)

Pure helper functions that don't depend on refs:
- `isDevMode()`, `devWarn()` (with shownWarnings Set)
- `getDisplayFromValue(value)` (pure function)

**Benefit:** Small but clear separation of utilities.

#### c. `useGameViewEnrichment.ts` (~50 lines)

Element enrichment logic (already somewhat standalone):
- `enrichElementsList(elements, gameView)`
- `enrichValidElements(selection, gameView, currentArgs)`

**Benefit:** Could be useful in other composables.

### What Stays in `useActionController.ts` (~1,300 lines)

The core remains because:
- All state refs must stay together (they reference each other)
- All watchers must stay (they depend on the refs)
- All methods that mutate state must stay (fill, start, cancel, etc.)
- The "Pit of Success" snapshot pattern requires tight coupling

## 3. Key Differences from Phase 1 (Class vs Composable)

Phase 1 extracted classes from a class. Phase 2 is different:

| Aspect | Phase 1 (Class) | Phase 2 (Composable) |
|--------|-----------------|----------------------|
| State | `this.field` on instance | `ref()` at module scope |
| Methods | `class.method()` | Closures over refs |
| Sharing | Pass instance | Inject/provide or pass refs |
| Dependencies | Constructor DI | Function parameters or inject |
| Encapsulation | Private fields | Closure scope |

### Vue Composable Extraction Patterns

1. **Factory function pattern** (like useBoardInteraction):
   - `createBoardInteraction()` returns reactive state + methods
   - Uses `reactive()` for state object
   - Methods are plain functions merged into state

2. **Composable with refs pattern** (like useActionController):
   - Uses individual `ref()` for each piece of state
   - Uses `computed()` for derived state
   - Uses `watch()` for side effects
   - Returns object with refs and methods

3. **Helper functions pattern** (like useGameViewHelpers):
   - Pure functions, no state
   - Optionally wrapped in a composable for convenience
   - Can be used anywhere

**For useActionController**: The helper functions pattern is most applicable for extractions.

## 4. Recommended Extraction Order

1. **Phase 2 Plan 02**: Extract types to `useActionControllerTypes.ts`
   - Zero risk, purely organizational
   - Makes main file easier to navigate

2. **Phase 2 Plan 03**: Extract helpers to `actionControllerHelpers.ts`
   - `isDevMode()`, `devWarn()`
   - `getDisplayFromValue()`
   - Low risk, pure functions

3. **Phase 2 Plan 04**: Extract enrichment to `useGameViewEnrichment.ts`
   - `enrichElementsList()`
   - `enrichValidElements()`
   - Moderate risk (used by computed values)

4. **Consider NOT extracting more**
   - The remaining ~1,200 lines are inherently coupled
   - Further extraction would require passing 10+ parameters
   - The "Pit of Success" pattern works because it's all together

## 5. Alternative: Do Not Extract

Given the analysis, another valid approach is to **not extract composables** and instead:

1. **Improve organization within the file**:
   - Add clear section comments (already partially present)
   - Group related functions together
   - Consider #region comments for IDE folding

2. **Extract only types** (~350 lines):
   - Significant line reduction
   - Zero behavioral risk
   - Types are genuinely independent

This reduces the file from 1,807 lines to ~1,457 lines while maintaining all the benefits of the Pit of Success architecture.

## Summary

The original plan proposed extracting:
- `useSelectionState` (~400 lines)
- `useFollowUp` (~250 lines)
- `useActionExecution` (~300 lines)

After analysis, this decomposition is **not recommended** because:
1. The state is deeply interconnected via `actionSnapshot`
2. Methods share responsibility across the proposed boundaries
3. The Pit of Success pattern works precisely because state is centralized

**Recommended approach:**
1. Extract types (~350 lines) - safe, valuable
2. Extract pure helpers (~100 lines) - safe, minor benefit
3. Keep the rest together - maintains correctness guarantees

This reduces the file by ~450 lines while preserving the architectural integrity.
