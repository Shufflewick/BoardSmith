# onSelect / onCancel Hooks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `onSelect` and `onCancel` callbacks to selection steps so game authors can emit animation events mid-action (between selection steps).

**Architecture:** `onSelect`/`onCancel` are optional properties on `BaseSelection`. They receive a restricted `OnSelectContext` that only exposes `animate()` with no callback parameter, making state mutation impossible at the type level. `onSelect` fires after a step resolves; `onCancel` fires when a pending action is cancelled after `onSelect` ran.

**Tech Stack:** TypeScript, Vitest

**Design doc:** `docs/plans/2026-02-12-onselect-hooks-design.md`

---

### Task 1: Add Types (`OnSelectContext`, `BaseSelection` extensions, `PendingActionState.onSelectFired`)

**Files:**
- Modify: `src/engine/action/types.ts:28-40` (BaseSelection), `src/engine/action/types.ts:104-128` (PendingActionState)
- Modify: `src/engine/action/index.ts` (export OnSelectContext)

**Step 1: Add `OnSelectContext` interface to types.ts**

Add before `BaseSelection` (around line 27):

```ts
/**
 * Restricted context passed to onSelect/onCancel callbacks.
 * Only exposes animate() with no callback parameter — state mutation is impossible.
 */
export interface OnSelectContext {
  /** Emit a UI-only animation event. No callback — no state mutation allowed. */
  animate(type: string, data?: Record<string, unknown>): void;
}
```

**Step 2: Add `onSelect` and `onCancel` to `BaseSelection`**

Add to the `BaseSelection` interface (after the `validate` field, around line 39):

```ts
  /** Called after this step is resolved. Receives the resolved value and a restricted context. */
  onSelect?: (value: T, context: OnSelectContext) => void;
  /** Called if the action is cancelled after onSelect fired but before execute(). */
  onCancel?: (context: OnSelectContext) => void;
```

**Step 3: Add `onSelectFired` to `PendingActionState`**

Add to `PendingActionState` interface (after `currentSelectionIndex`, around line 128):

```ts
  /** Indices of selections whose onSelect callback has fired */
  onSelectFired?: Set<number>;
```

**Step 4: Export `OnSelectContext` from action/index.ts**

Add `OnSelectContext` to the type exports in `src/engine/action/index.ts` (in the `export type` block):

```ts
  OnSelectContext,
```

**Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS (new types are additive, nothing uses them yet)

**Step 6: Commit**

```bash
git add src/engine/action/types.ts src/engine/action/index.ts
git commit -m "feat: add OnSelectContext type, onSelect/onCancel to BaseSelection, onSelectFired to PendingActionState"
```

---

### Task 2: Pass through `onSelect`/`onCancel` in the Action Builder

**Files:**
- Modify: `src/engine/action/action-builder.ts:152-207` (chooseFrom), `src/engine/action/action-builder.ts:247-286` (chooseElement), `src/engine/action/action-builder.ts:310-391` (fromElements), `src/engine/action/action-builder.ts:420-443` (enterText), `src/engine/action/action-builder.ts:473-496` (enterNumber)

All five builder methods need to accept `onSelect` and `onCancel` in their options and pass them through to the selection object.

**Step 1: Write the failing test**

Add to `src/engine/action/action.test.ts` after the existing "Action Builder" describe block (after the last builder test):

```ts
describe('onSelect / onCancel builder', () => {
  it('should store onSelect on chooseFrom selection', () => {
    const handler = () => {};
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        onSelect: handler,
      })
      .execute(() => {});

    expect(action.selections[0].onSelect).toBe(handler);
  });

  it('should store onCancel on chooseFrom selection', () => {
    const handler = () => {};
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        onCancel: handler,
      })
      .execute(() => {});

    expect(action.selections[0].onCancel).toBe(handler);
  });

  it('should store onSelect on chooseElement selection', () => {
    const handler = () => {};
    const action = Action.create('test')
      .chooseElement('card', {
        onSelect: handler,
      })
      .execute(() => {});

    expect(action.selections[0].onSelect).toBe(handler);
  });

  it('should store onSelect on fromElements selection', () => {
    const handler = () => {};
    const action = Action.create('test')
      .fromElements('target', {
        elements: [],
        onSelect: handler,
      })
      .execute(() => {});

    expect(action.selections[0].onSelect).toBe(handler);
  });

  it('should store onSelect on enterText selection', () => {
    const handler = () => {};
    const action = Action.create('test')
      .enterText('name', {
        onSelect: handler,
      })
      .execute(() => {});

    expect(action.selections[0].onSelect).toBe(handler);
  });

  it('should store onSelect on enterNumber selection', () => {
    const handler = () => {};
    const action = Action.create('test')
      .enterNumber('amount', {
        onSelect: handler,
      })
      .execute(() => {});

    expect(action.selections[0].onSelect).toBe(handler);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/action/action.test.ts --reporter verbose 2>&1 | tail -30`
Expected: FAIL — TypeScript errors because `onSelect`/`onCancel` aren't in the builder options types yet.

**Step 3: Add `onSelect`/`onCancel` to all five builder methods**

For each builder method, add to the options type signature and pass through to the selection object.

**chooseFrom** (line 152-207): Add to options type (after `disabled`):
```ts
      /** Called after this step is resolved with the selected value */
      onSelect?: (value: T, context: import('./types.js').OnSelectContext) => void;
      /** Called if action is cancelled after onSelect fired */
      onCancel?: (context: import('./types.js').OnSelectContext) => void;
```
Add to the selection object construction (after `disabled: options.disabled,`):
```ts
      onSelect: options.onSelect,
      onCancel: options.onCancel,
```

**chooseElement** (line 247-286): Same pattern — add to options type and pass through.

**fromElements** (line 310-391): Add to options type and pass through in BOTH the `elements` and `element` branches of the if/else.

**enterText** (line 420-443): Add to options type and pass through.

**enterNumber** (line 473-496): Add to options type and pass through.

Import `OnSelectContext` at the top of `action-builder.ts`:
```ts
import type { OnSelectContext } from './types.js';
```
Then use `OnSelectContext` directly in the options types instead of inline imports.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/action/action.test.ts --reporter verbose 2>&1 | tail -30`
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine/action/action-builder.ts src/engine/action/action.test.ts
git commit -m "feat: pass through onSelect/onCancel in all Action builder methods"
```

---

### Task 3: Add `createOnSelectContext` helper and `resolveSelectionValue` to ActionExecutor

**Files:**
- Modify: `src/engine/action/action.ts` (add two private methods)

These helpers will be used by Tasks 4 and 5. `createOnSelectContext` wraps `game.animate()` without the callback parameter. `resolveSelectionValue` resolves a single selection's raw value (as stored in `collectedArgs`) to its resolved form.

**Step 1: Write the failing test**

Add to `action.test.ts` in the "Action Executor" describe block:

```ts
describe('onSelect context', () => {
  it('createOnSelectContext.animate() calls game.animate without callback', () => {
    const animateCalls: Array<{ type: string; data: Record<string, unknown> }> = [];
    const originalAnimate = game.animate.bind(game);
    game.animate = (type: string, data: Record<string, unknown>, callback?: () => void) => {
      animateCalls.push({ type, data });
      originalAnimate(type, data, callback);
    };

    // Access private method via cast
    const ctx = (executor as any).createOnSelectContext();
    ctx.animate('test-event', { foo: 'bar' });

    expect(animateCalls).toHaveLength(1);
    expect(animateCalls[0]).toEqual({ type: 'test-event', data: { foo: 'bar' } });
  });

  it('createOnSelectContext.animate() defaults data to empty object', () => {
    const animateCalls: Array<{ type: string; data: Record<string, unknown> }> = [];
    const originalAnimate = game.animate.bind(game);
    game.animate = (type: string, data: Record<string, unknown>, callback?: () => void) => {
      animateCalls.push({ type, data });
      originalAnimate(type, data, callback);
    };

    const ctx = (executor as any).createOnSelectContext();
    ctx.animate('test-event');

    expect(animateCalls[0].data).toEqual({});
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/action/action.test.ts -t "onSelect context" --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `createOnSelectContext` doesn't exist

**Step 3: Implement `createOnSelectContext` and `resolveSelectionValue`**

Add to `ActionExecutor` class in `action.ts` (before `processSelectionStep`, around line 1396):

```ts
  /**
   * Create the restricted OnSelectContext for onSelect/onCancel callbacks.
   * Only exposes animate() without the callback parameter.
   * @internal
   */
  createOnSelectContext(): OnSelectContext {
    const game = this.game;
    return {
      animate(type: string, data?: Record<string, unknown>): void {
        game.animate(type, data ?? {});
      },
    };
  }

  /**
   * Resolve a single selection's raw value to its resolved form.
   * Element IDs become Element objects, choice values get smart-resolved, etc.
   * @internal
   */
  resolveSelectionValue(selection: Selection, value: unknown, player: Player): unknown {
    switch (selection.type) {
      case 'element':
      case 'elements': {
        if (typeof value === 'number') {
          return this.game.getElementById(value) ?? value;
        }
        if (this.looksLikeSerializedElement(value)) {
          return this.game.getElementById((value as { id: number }).id) ?? value;
        }
        return value;
      }
      case 'choice': {
        if (this.isSerializedElement(value)) {
          return this.game.getElementById((value as { id: number }).id) ?? value;
        }
        const choices = this.getChoices(selection, player, {});
        let resolved = this.smartResolveChoiceValue(value, choices);
        resolved = this.extractChoiceValue(resolved);
        return resolved !== value ? resolved : value;
      }
      default:
        return value;
    }
  }
```

Add `OnSelectContext` to the imports at the top of `action.ts`:
```ts
import type { OnSelectContext } from './types.js';
```
(Add it to the existing import block from `'./types.js'`)

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/action/action.test.ts -t "onSelect context" --reporter verbose 2>&1 | tail -20`
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine/action/action.ts src/engine/action/action.test.ts
git commit -m "feat: add createOnSelectContext and resolveSelectionValue helpers to ActionExecutor"
```

---

### Task 4: Fire `onSelect` in `processSelectionStep` (pending actions)

**Files:**
- Modify: `src/engine/action/action.ts:1401-1437` (processSelectionStep)
- Test: `src/engine/action/action.test.ts`

**Step 1: Write the failing test**

Add to `action.test.ts`:

```ts
describe('onSelect in processSelectionStep', () => {
  it('fires onSelect after validation passes with resolved value', () => {
    const onSelectCalls: Array<{ value: unknown }> = [];

    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue', 'green'],
        onSelect: (value, ctx) => {
          onSelectCalls.push({ value });
          ctx.animate('color-picked', { color: value });
        },
      })
      .chooseFrom('size', {
        choices: ['S', 'M', 'L'],
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    const result = executor.processSelectionStep(action, player, pendingState, 'color', 'red');

    expect(result.success).toBe(true);
    expect(onSelectCalls).toHaveLength(1);
    expect(onSelectCalls[0].value).toBe('red');
    expect(game.pendingAnimationEvents).toHaveLength(1);
    expect(game.pendingAnimationEvents[0].type).toBe('color-picked');
  });

  it('does not fire onSelect if validation fails', () => {
    const onSelectCalls: unknown[] = [];

    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue', 'green'],
        onSelect: (value) => { onSelectCalls.push(value); },
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    const result = executor.processSelectionStep(action, player, pendingState, 'color', 'invalid');

    expect(result.success).toBe(false);
    expect(onSelectCalls).toHaveLength(0);
  });

  it('tracks onSelectFired in pendingState', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        onSelect: () => {},
      })
      .chooseFrom('size', {
        choices: ['S', 'M', 'L'],
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    executor.processSelectionStep(action, player, pendingState, 'color', 'red');

    expect(pendingState.onSelectFired).toBeDefined();
    expect(pendingState.onSelectFired!.has(0)).toBe(true);
    expect(pendingState.onSelectFired!.has(1)).toBe(false);
  });

  it('resolves element IDs before passing to onSelect', () => {
    // Create an element to select
    const space = game.create(Space, 'board');
    const piece = space.create(Piece, 'warrior');

    const onSelectCalls: unknown[] = [];

    const action = Action.create('test')
      .chooseElement('target', {
        elementClass: Piece,
        onSelect: (value) => { onSelectCalls.push(value); },
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    executor.processSelectionStep(action, player, pendingState, 'target', piece.id);

    expect(onSelectCalls).toHaveLength(1);
    expect(onSelectCalls[0]).toBe(piece); // Resolved element, not ID
  });

  it('skips onSelect if selection has no onSelect defined', () => {
    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        // No onSelect
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    const result = executor.processSelectionStep(action, player, pendingState, 'color', 'red');

    expect(result.success).toBe(true);
    expect(pendingState.onSelectFired).toBeUndefined(); // Not initialized if never needed
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/action/action.test.ts -t "onSelect in processSelectionStep" --reporter verbose 2>&1 | tail -30`
Expected: FAIL — onSelect never fires, onSelectFired never set

**Step 3: Implement onSelect firing in processSelectionStep**

Modify `processSelectionStep` in `action.ts` (line 1401-1437). After storing the value and before advancing the index, add onSelect logic:

```ts
  processSelectionStep(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    selectionName: string,
    value: unknown
  ): { success: boolean; error?: string } {
    const selectionIndex = action.selections.findIndex(s => s.name === selectionName);
    if (selectionIndex === -1) {
      return { success: false, error: `Selection ${selectionName} not found` };
    }

    // Ensure we're at the right selection index
    if (selectionIndex !== pendingState.currentSelectionIndex) {
      return { success: false, error: `Expected selection at index ${pendingState.currentSelectionIndex}, got ${selectionName} at index ${selectionIndex}` };
    }

    const selection = action.selections[selectionIndex];

    // If it's a repeating selection, delegate to processRepeatingStep
    if (this.isRepeatingSelection(selection)) {
      const result = this.processRepeatingStep(action, player, pendingState, value);
      return { success: !result.error, error: result.error };
    }

    // Validate the selection
    const validationResult = this.validateSelection(selection, value, player, pendingState.collectedArgs);
    if (!validationResult.valid) {
      return { success: false, error: validationResult.errors.join('; ') };
    }

    // Store the value and move to next selection
    pendingState.collectedArgs[selectionName] = value;

    // Fire onSelect if defined
    if (selection.onSelect) {
      const resolvedValue = this.resolveSelectionValue(selection, value, player);
      const ctx = this.createOnSelectContext();
      selection.onSelect(resolvedValue, ctx);

      // Track that onSelect fired for this selection (for onCancel)
      if (!pendingState.onSelectFired) {
        pendingState.onSelectFired = new Set();
      }
      pendingState.onSelectFired.add(selectionIndex);
    }

    pendingState.currentSelectionIndex++;

    return { success: true };
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/action/action.test.ts -t "onSelect in processSelectionStep" --reporter verbose 2>&1 | tail -30`
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine/action/action.ts src/engine/action/action.test.ts
git commit -m "feat: fire onSelect in processSelectionStep for pending actions"
```

---

### Task 5: Fire `onSelect` on first iteration of repeating selections

**Files:**
- Modify: `src/engine/action/action.ts:1165-1334` (processRepeatingStep)
- Test: `src/engine/action/action.test.ts`

**Step 1: Write the failing test**

```ts
describe('onSelect in processRepeatingStep', () => {
  it('fires onSelect on first iteration only', () => {
    const onSelectCalls: unknown[] = [];

    const action = Action.create('test')
      .chooseFrom('items', {
        choices: ['a', 'b', 'c', 'done'],
        repeatUntil: 'done',
        onSelect: (value) => { onSelectCalls.push(value); },
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    // First iteration — onSelect should fire
    executor.processRepeatingStep(action, player, pendingState, 'a');
    expect(onSelectCalls).toHaveLength(1);
    expect(onSelectCalls[0]).toBe('a');

    // Second iteration — onSelect should NOT fire again
    executor.processRepeatingStep(action, player, pendingState, 'b');
    expect(onSelectCalls).toHaveLength(1); // Still 1

    // Termination — onSelect should NOT fire
    executor.processRepeatingStep(action, player, pendingState, 'done');
    expect(onSelectCalls).toHaveLength(1); // Still 1
  });

  it('tracks onSelectFired for repeating selections', () => {
    const action = Action.create('test')
      .chooseFrom('items', {
        choices: ['a', 'b', 'done'],
        repeatUntil: 'done',
        onSelect: () => {},
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    executor.processRepeatingStep(action, player, pendingState, 'a');

    expect(pendingState.onSelectFired).toBeDefined();
    expect(pendingState.onSelectFired!.has(0)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/action/action.test.ts -t "onSelect in processRepeatingStep" --reporter verbose 2>&1 | tail -20`
Expected: FAIL

**Step 3: Implement onSelect in processRepeatingStep**

In `processRepeatingStep` (line 1165), add onSelect firing right after the repeating state is initialized (after line 1208, the `if (!pendingState.repeating)` block). The key is: fire on first iteration only, which is when `pendingState.repeating` was just initialized:

After the initialization block `if (!pendingState.repeating) { ... }`, and BEFORE the validation/choice checking logic, add:

```ts
    // Fire onSelect on first iteration only (when repeating state was just initialized)
    const isFirstIteration = pendingState.repeating.iterationCount === 0;
    if (isFirstIteration && selection.onSelect) {
      // Resolve the value before passing to onSelect
      const isElementSelection = selection.type === 'element' || selection.type === 'elements';
      const resolvedValue = isElementSelection
        ? (this.game.getElementById(value as number) ?? value)
        : value;
      const ctx = this.createOnSelectContext();
      selection.onSelect(resolvedValue, ctx);

      if (!pendingState.onSelectFired) {
        pendingState.onSelectFired = new Set();
      }
      pendingState.onSelectFired.add(pendingState.currentSelectionIndex);
    }
```

Important: This must go AFTER the repeating state init but BEFORE the choice validation so the value isn't yet validated. Actually, we should fire after validation to maintain consistency with `processSelectionStep`. Move it to after the validation succeeds and value is accumulated (after line 1255 `pendingState.repeating.iterationCount++`), but guarded by `isFirstIteration`:

Actually the cleaner approach: capture `isFirstIteration` right after initialization, then fire onSelect after validation passes and value is accumulated (after line 1255), guarded by `isFirstIteration`.

```ts
    // Capture before iteration count changes
    const isFirstIteration = pendingState.repeating.iterationCount === 0;

    // ... (existing validation and accumulation code) ...

    // Add to accumulated values (existing line 1254)
    pendingState.repeating.accumulated.push(value);
    pendingState.repeating.iterationCount++;

    // Fire onSelect on first iteration only (after validation passes)
    if (isFirstIteration && selection.onSelect) {
      const resolvedForHook = isElementSelection
        ? (this.game.getElementById(value as number) ?? value)
        : value;
      const ctx = this.createOnSelectContext();
      selection.onSelect(resolvedForHook, ctx);

      if (!pendingState.onSelectFired) {
        pendingState.onSelectFired = new Set();
      }
      pendingState.onSelectFired.add(pendingState.currentSelectionIndex);
    }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/action/action.test.ts -t "onSelect in processRepeatingStep" --reporter verbose 2>&1 | tail -20`
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine/action/action.ts src/engine/action/action.test.ts
git commit -m "feat: fire onSelect on first iteration of repeating selections"
```

---

### Task 6: Fire `onSelect` in `executeAction` (non-pending single-step actions)

**Files:**
- Modify: `src/engine/action/action.ts:773-806` (executeAction)
- Test: `src/engine/action/action.test.ts`

**Step 1: Write the failing test**

```ts
describe('onSelect in executeAction', () => {
  it('fires onSelect for each selection before execute()', () => {
    const callOrder: string[] = [];

    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        onSelect: (value) => { callOrder.push(`onSelect:color:${value}`); },
      })
      .chooseFrom('size', {
        choices: ['S', 'M', 'L'],
        onSelect: (value) => { callOrder.push(`onSelect:size:${value}`); },
      })
      .execute(() => { callOrder.push('execute'); });

    const player = game.getPlayer(1);
    const result = executor.executeAction(action, player, { color: 'red', size: 'M' });

    expect(result.success).toBe(true);
    expect(callOrder).toEqual([
      'onSelect:color:red',
      'onSelect:size:M',
      'execute',
    ]);
  });

  it('does not fire onSelect if validation fails', () => {
    const onSelectCalls: unknown[] = [];

    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        onSelect: (value) => { onSelectCalls.push(value); },
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const result = executor.executeAction(action, player, { color: 'invalid' });

    expect(result.success).toBe(false);
    expect(onSelectCalls).toHaveLength(0);
  });

  it('fires onSelect with resolved element values', () => {
    const space = game.create(Space, 'board');
    const piece = space.create(Piece, 'warrior');

    const onSelectCalls: unknown[] = [];

    const action = Action.create('test')
      .chooseElement('target', {
        elementClass: Piece,
        onSelect: (value) => { onSelectCalls.push(value); },
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    executor.executeAction(action, player, { target: piece.id });

    expect(onSelectCalls).toHaveLength(1);
    expect(onSelectCalls[0]).toBe(piece);
  });

  it('skips selections without onSelect', () => {
    const onSelectCalls: string[] = [];

    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        // No onSelect
      })
      .chooseFrom('size', {
        choices: ['S', 'M', 'L'],
        onSelect: (value) => { onSelectCalls.push(value as string); },
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    executor.executeAction(action, player, { color: 'red', size: 'M' });

    expect(onSelectCalls).toEqual(['M']); // Only size's onSelect fired
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/action/action.test.ts -t "onSelect in executeAction" --reporter verbose 2>&1 | tail -20`
Expected: FAIL

**Step 3: Implement onSelect in executeAction**

Modify `executeAction` in `action.ts` (line 773-806). After validation passes and before calling `action.execute()`, fire onSelect for each selection that has it:

```ts
  executeAction(
    action: ActionDefinition,
    player: Player,
    args: Record<string, unknown>
  ): ActionResult {
    // Resolve serialized args (player indices, element IDs) to actual objects
    const resolvedArgs = this.resolveArgs(action, args, player);

    // Validate with resolved args
    const validation = this.validateAction(action, player, resolvedArgs);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join('; '),
      };
    }

    // Fire onSelect for each selection that has it (before execute)
    const onSelectCtx = this.createOnSelectContext();
    for (const selection of action.selections) {
      if (selection.onSelect && resolvedArgs[selection.name] !== undefined) {
        selection.onSelect(resolvedArgs[selection.name], onSelectCtx);
      }
    }

    const context: ActionContext = {
      game: this.game,
      player,
      args: resolvedArgs,
    };

    try {
      const result = action.execute(resolvedArgs, context);
      return result ?? { success: true };
    } catch (error) {
      console.error(`[BoardSmith] Action '${action.name}' execution failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/action/action.test.ts -t "onSelect in executeAction" --reporter verbose 2>&1 | tail -20`
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine/action/action.ts src/engine/action/action.test.ts
git commit -m "feat: fire onSelect in executeAction for non-pending actions"
```

---

### Task 7: Fire `onCancel` in `cancelPendingAction`

**Files:**
- Modify: `src/session/pending-action-manager.ts:307-309` (cancelPendingAction)
- Test: `src/engine/action/action.test.ts` (unit test for the cancel logic)

The `cancelPendingAction` method needs access to the game's action definitions and executor to fire `onCancel`. Currently it just deletes from the map. We need to:
1. Look up the action definition
2. Iterate selections where `onSelectFired` is true
3. Call `onCancel` for each

**Step 1: Write the failing test**

Add a new describe block for cancel behavior. Since `cancelPendingAction` lives in `PendingActionManager` (session layer), we'll test the onCancel logic at the executor level first by adding a helper method `fireOnCancelCallbacks`:

```ts
describe('onCancel callbacks', () => {
  it('fires onCancel for selections where onSelect fired', () => {
    const cancelCalls: string[] = [];

    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        onSelect: () => {},
        onCancel: (ctx) => {
          cancelCalls.push('color');
          ctx.animate('color-cancelled', {});
        },
      })
      .chooseFrom('size', {
        choices: ['S', 'M', 'L'],
        onSelect: () => {},
        onCancel: (ctx) => { cancelCalls.push('size'); },
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    // Complete first selection (onSelect fires)
    executor.processSelectionStep(action, player, pendingState, 'color', 'red');

    // Cancel before second selection
    executor.fireOnCancelCallbacks(action, pendingState);

    expect(cancelCalls).toEqual(['color']); // Only color's onCancel fired (size's onSelect never ran)
    expect(game.pendingAnimationEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does not fire onCancel if onSelect never fired', () => {
    const cancelCalls: string[] = [];

    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        onCancel: () => { cancelCalls.push('color'); },
      })
      .execute(() => {});

    const pendingState = executor.createPendingActionState('test', 1);

    // Cancel without any selections made
    executor.fireOnCancelCallbacks(action, pendingState);

    expect(cancelCalls).toHaveLength(0);
  });

  it('fires onCancel for multiple selections where onSelect fired', () => {
    const cancelCalls: string[] = [];

    const action = Action.create('test')
      .chooseFrom('color', {
        choices: ['red', 'blue'],
        onSelect: () => {},
        onCancel: () => { cancelCalls.push('color'); },
      })
      .chooseFrom('size', {
        choices: ['S', 'M', 'L'],
        onSelect: () => {},
        onCancel: () => { cancelCalls.push('size'); },
      })
      .chooseFrom('qty', {
        choices: [1, 2, 3],
        onSelect: () => {},
        onCancel: () => { cancelCalls.push('qty'); },
      })
      .execute(() => {});

    const player = game.getPlayer(1);
    const pendingState = executor.createPendingActionState('test', 1);

    // Complete first two selections
    executor.processSelectionStep(action, player, pendingState, 'color', 'red');
    executor.processSelectionStep(action, player, pendingState, 'size', 'M');

    // Cancel before third selection
    executor.fireOnCancelCallbacks(action, pendingState);

    expect(cancelCalls).toEqual(['color', 'size']); // Both fired, qty did not
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/action/action.test.ts -t "onCancel callbacks" --reporter verbose 2>&1 | tail -20`
Expected: FAIL — `fireOnCancelCallbacks` doesn't exist

**Step 3: Implement `fireOnCancelCallbacks` on ActionExecutor**

Add to `ActionExecutor` in `action.ts`:

```ts
  /**
   * Fire onCancel callbacks for selections where onSelect had fired.
   * Called when a pending action is cancelled.
   */
  fireOnCancelCallbacks(action: ActionDefinition, pendingState: PendingActionState): void {
    if (!pendingState.onSelectFired || pendingState.onSelectFired.size === 0) return;

    const ctx = this.createOnSelectContext();
    for (const index of pendingState.onSelectFired) {
      const selection = action.selections[index];
      if (selection?.onCancel) {
        selection.onCancel(ctx);
      }
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/action/action.test.ts -t "onCancel callbacks" --reporter verbose 2>&1 | tail -20`
Expected: PASS

**Step 5: Wire `cancelPendingAction` in PendingActionManager to call `fireOnCancelCallbacks`**

Modify `cancelPendingAction` in `src/session/pending-action-manager.ts` (line 307-309):

```ts
  cancelPendingAction(playerPosition: number): void {
    const pendingState = this.#pendingActions.get(playerPosition);
    if (pendingState) {
      // Fire onCancel for selections where onSelect had fired
      const action = this.#runner.game.getAction(pendingState.actionName);
      if (action) {
        const executor = this.#runner.game.getActionExecutor();
        executor.fireOnCancelCallbacks(action, pendingState);
      }
      this.#pendingActions.delete(playerPosition);
    }
  }
```

**Step 6: Run full test suite**

Run: `npx vitest run src/engine/action/action.test.ts --reporter verbose 2>&1 | tail -30`
Expected: All PASS

**Step 7: Commit**

```bash
git add src/engine/action/action.ts src/engine/action/action.test.ts src/session/pending-action-manager.ts
git commit -m "feat: fire onCancel callbacks when pending action is cancelled"
```

---

### Task 8: Run full test suite and verify nothing broke

**Step 1: Run all engine tests**

Run: `npx vitest run src/engine/ --reporter verbose 2>&1 | tail -40`
Expected: All PASS

**Step 2: Run session tests**

Run: `npx vitest run src/session/ --reporter verbose 2>&1 | tail -40`
Expected: All PASS

**Step 3: Run full project type check**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors

**Step 4: Commit (if any fixes were needed)**

Only if fixes were required in steps 1-3.
