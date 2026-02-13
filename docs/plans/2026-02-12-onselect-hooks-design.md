# Design: onSelect / onCancel Hooks on Selection Steps

## Problem

Actions with multiple selection steps can only run side-effect logic in `execute()`, which fires after ALL selections complete. Game authors need to emit animation events mid-action (between steps) so spectators see what's happening in real-time.

Concrete example: a "re-equip" action with two steps (pick unit, pick equipment). The spectator panel should appear as soon as the unit is selected, not after the equipment is also chosen.

## Solution

Add `onSelect` and `onCancel` callbacks to selection options. `onSelect` fires when a step resolves. `onCancel` fires if the action is cancelled after `onSelect` ran but before `execute()`.

Both receive a restricted `OnSelectContext` that only exposes `animate()` with no callback parameter, making state mutation impossible at the type level.

## API

```ts
Action.create('reEquip')
  .chooseFrom('actingUnit', {
    choices: (ctx) => [...],
    onSelect: (value, ctx) => {
      ctx.animate('equip-session-start', { unit: value });
    },
    onCancel: (ctx) => {
      ctx.animate('equip-session-end', {});
    },
  })
  .chooseElement('equipment', { optional: true, ... })
  .execute((args, ctx) => { ... })
```

### OnSelectContext

```ts
interface OnSelectContext {
  /** Emit a UI-only animation event. No callback — no state mutation. */
  animate(type: string, data?: Record<string, unknown>): void;
}
```

Constraints:
- No game reference, no element access, no mutation methods
- `animate()` has no callback parameter (unlike `game.animate()` which accepts one)
- Synchronous only (no async, no promises)

### Value Resolution

The `value` passed to `onSelect` is resolved to match what `execute()` args provide:
- `chooseFrom` → the choice value (string, number, object)
- `chooseElement` / `fromElements` → the resolved Element object
- `enterText` → string
- `enterNumber` → number

### Scope

All five selection types get `onSelect`/`onCancel` via `BaseSelection`.

## Execution Points

### Where onSelect Fires

**Pending actions (multi-step):** In `ActionExecutor.processSelectionStep()`, after validation passes and value is stored:

1. Validate selection value
2. Store value in `collectedArgs`
3. Resolve value for this selection (element ID → Element object)
4. Call `selection.onSelect(resolvedValue, onSelectContext)` ← NEW
5. Advance `currentSelectionIndex`

**Repeating selections:** `onSelect` fires on the first iteration only. It signals "this phase of the action has started," not every individual pick within a repeat.

**Non-pending actions (single-step):** When all selections are submitted at once, `onSelect` fires for each selection during `executeAction()`, right before `execute()`.

### Where onCancel Fires

In `PendingActionManager.cancelPendingAction()`, for every selection where `onSelect` has already fired:

1. Look up pending state
2. For each selection up to `currentSelectionIndex` with `onCancel` defined, check if `onSelect` fired (via tracking field)
3. Call `selection.onCancel(onSelectContext)` for each
4. Delete pending state

### Tracking

`PendingActionState` gets a new optional field:

```ts
interface PendingActionState {
  // ...existing...
  /** Indices of selections whose onSelect has fired */
  onSelectFired?: Set<number>;
}
```

## Animation Event Lifecycle

`onSelect` and `onCancel` call `game.animate()` internally. Animation events:
- Go into `game._animationEvents` buffer
- Get broadcast to clients (PendingActionManager already broadcasts after each step)
- Get cleared at the start of the next `performAction()` (existing behavior)

Spectator panel flow:
1. Player picks unit → `onSelect` → `animate('equip-session-start')` → broadcast → panel opens
2. Player picks equipment → `execute()` → result visible
3. OR player cancels → `onCancel` → `animate('equip-session-end')` → broadcast → panel closes

## AI / Programmatic Fill

`onSelect` fires identically for AI picks and `followUp` pre-filled args. No distinction between human and programmatic selection. This is correct: spectators should see the panel regardless of who is picking.

## What This Does NOT Change

- No game state mutation from `onSelect`/`onCancel` (enforced by type)
- No undo implications (animation events already excluded from undo)
- No serialization changes (animations already in broadcast pipeline)
- No new flow states or action states
- No async behavior

## Files to Modify

1. **`src/engine/action/types.ts`** — Add `OnSelectContext`, add `onSelect`/`onCancel` to `BaseSelection`, add `onSelectFired` to `PendingActionState`
2. **`src/engine/action/action-builder.ts`** — Pass through `onSelect`/`onCancel` in all five builder methods
3. **`src/engine/action/action.ts`** — Fire `onSelect` in `processSelectionStep()`, `processRepeatingStep()`, and `executeAction()`. Add value resolution for onSelect.
4. **`src/session/pending-action-manager.ts`** — Fire `onCancel` in `cancelPendingAction()`. Pass game reference for animate context.
5. **`src/engine/action/action.test.ts`** — Tests for onSelect/onCancel in all scenarios
