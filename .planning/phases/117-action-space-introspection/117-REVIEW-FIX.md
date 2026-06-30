---
phase: 117-action-space-introspection
fixed_at: 2026-06-30T17:14:00Z
review_path: .planning/phases/117-action-space-introspection/117-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 117: Code Review Fix Report

**Fixed at:** 2026-06-30T17:14:00Z
**Source review:** .planning/phases/117-action-space-introspection/117-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: getActionSchema skips condition check to match documented contract

**Files modified:** `src/engine/element/game.ts`
**Commit:** 9654232
**Applied fix:** Replaced `buildActionMetadata(this, player, [actionName])` delegation
(which evaluates conditions and skips false ones) with direct `buildPickMetadata` calls
per selection, intentionally bypassing condition evaluation. Also added `buildPickMetadata`
to the import from `./action-metadata.js`. Updated the JSDoc to remove the misleading
"delegates to buildActionMetadata" sentence.

### WR-01: buildActionArgs validates required selections are provided

**Files modified:** `src/engine/utils/arg-builder.ts`
**Commit:** fc89652
**Applied fix:** After the unknown-key validation loop, added a loop over all
non-optional selections that throws an actionable error if a required selection is
missing from `selectionValues`, naming the action and all required selections.

### WR-02: buildActionArgs validates seat resolves to a real player

**Files modified:** `src/engine/utils/arg-builder.ts`, `src/engine/utils/arg-builder.test.ts`
**Commit:** 5ac228e
**Applied fix:** Renamed `_seat` to `seat`, added `game.getPlayer(seat)` validation
at step 1 that throws immediately if the seat has no player. Updated the JSDoc `@param`
and `@throws`. Updated the test suite: the "empty args should not throw" test (which was
wrong under WR-01's new required-selection validation) was replaced with tests for the
new required-selection-missing and invalid-seat behaviors.

### WR-03: detect function-based multiSelect in enumerateLegalMoves

**Files modified:** `src/engine/utils/enumerate-moves.ts`
**Commit:** ac7d874
**Applied fix:** Added a `typeof multiSelect === 'function'` guard before the existing
`if (multiSelect)` branch in `_enumerateRecursive`. When the guard fires: skip the
selection (continue to next) if optional, return no moves if required, and emit a
`devWarn` naming the action and selection so game authors see it in development.
Added `devWarn` import from `../../utils/dev.js`.

### WR-04: re-throw condition errors in buildActionMetadata

**Files modified:** `src/engine/element/action-metadata.ts`
**Commit:** 4e3d7f1
**Applied fix:** Replaced `console.error(...)` + `continue` in the condition-eval catch
block with `throw new Error(...)` carrying an actionable message naming the action and
including the original error message. The legitimate "condition is false" path (not an
error) is unaffected — it still continues via the `if (!evaluateCondition(...)) continue`
branch above the catch.

### WR-05: serializeChoice uses public .id getter for element type

**Files modified:** `src/ai/mcts-bot.ts`
**Commit:** 677071c
**Applied fix:** Changed `(choice as { _t: { id: number } })._t.id` to
`(choice as { id: number }).id` in the `selection.type === 'element'` branch, matching
the `elements` branch. Added a comment explaining the rationale.

### IN-01: gate buildActionMetadata console.warn behind devWarn

**Files modified:** `src/engine/element/action-metadata.ts`
**Commit:** c1f3def
**Applied fix:** Replaced the unconditional `console.warn(...)` for missing action name
with `devWarn(key, message)` using a per-action deduplicated key. Added `devWarn` import
from `../../utils/dev.js`. The warning now fires once per action name in development mode
and is silent in production.

### IN-02: move player guard before availableActionsForSeat in getActionSpace

**Files modified:** `src/engine/element/game.ts`
**Commit:** 66d7db1
**Applied fix:** Moved the `const player = this.getPlayer(seat); if (!player) return { actions: [] };`
guard to run before `availableActionsForSeat(this.getFlowState(), seat)`. Behavior is
unchanged (availableActionsForSeat was safe with undefined flow state) but ordering now
matches logical intent: validate inputs before doing work.

---

**Test results after all fixes:**
- `npx vitest run`: 1743 tests passed, 126 test files, 0 failures
- `npx tsc --noEmit`: pre-existing errors only (useActionController.ts, image-leak.test.ts,
  teaching.test.ts, notation-serialization.test.ts, UI composables/renderers test files,
  mcts-stats-checkers.test.ts). No new errors introduced by these fixes.

---

_Fixed: 2026-06-30T17:14:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
