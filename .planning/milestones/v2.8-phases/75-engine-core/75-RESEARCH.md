# Phase 75: Engine Core - Research

**Researched:** 2026-02-05
**Domain:** Action system disabled selections (engine layer)
**Confidence:** HIGH

## Summary

This phase adds `disabled` callback support to the three selection builder methods (`chooseElement`, `fromElements`, `chooseFrom`), changes `getChoices()` to return `AnnotatedChoice<T>[]`, and updates `hasValidSelectionPath()` and `validateSelection()` to enforce disabled semantics.

The design document (`docs/plans/2026-02-05-disabled-selections-design.md`) specifies all decisions clearly. The engine already has a clean separation between `filter` (visibility/scoping) and the new `disabled` (selectability). The `getChoices()` return type change from `T[]` to `AnnotatedChoice<T>[]` is the most impactful change -- it is intentionally breaking and affects every caller of `getChoices` and `getSelectionChoices` across the codebase.

**Primary recommendation:** Implement in four layers: (1) add `AnnotatedChoice` type and `disabled` to selection interfaces, (2) update builder methods, (3) update `getChoices()` to return annotated choices, (4) update `hasValidSelectionPath()` and `validateSelection()` to respect disabled state. Internal callers within `ActionExecutor` that currently compare against raw choice values must be updated to compare against `.value` instead.

## Standard Stack

No new libraries needed. This is purely internal engine work using existing TypeScript types and patterns.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | existing | Type definitions for AnnotatedChoice | Already used throughout |
| Vitest | existing | Tests for all new behavior | Already used for engine tests |

## Architecture Patterns

### Current Architecture (What Exists)

```
Action Builder (action-builder.ts)
  - chooseFrom<T>(name, options) -> stores ChoiceSelection<T>
  - chooseElement<T>(name, options) -> stores ElementSelection<T>
  - fromElements<T>(name, options) -> stores ElementSelection<T> or ElementsSelection<T>

ActionExecutor (action.ts)
  - getChoices(selection, player, args) -> unknown[]
  - hasValidSelectionPath(selections, player, args, index) -> boolean
  - validateSelection(selection, value, player, args) -> ValidationResult
  - choicesContain(choices, value) -> boolean  [private]
  - trySmartResolveChoice(value, choices) -> boolean  [private]
  - smartResolveChoiceValue(value, choices) -> unknown  [private]
```

### Target Architecture (What We Build)

```
Types (types.ts)
  + AnnotatedChoice<T> = { value: T, disabled: string | false }
  + disabled?: (item: T, ctx: ActionContext) => string | false  [on selection interfaces]

Action Builder (action-builder.ts)
  ~ chooseFrom<T>(name, { ..., disabled? }) -> stores disabled on ChoiceSelection
  ~ chooseElement<T>(name, { ..., disabled? }) -> stores disabled on ElementSelection
  ~ fromElements<T>(name, { ..., disabled? }) -> stores disabled on ElementSelection/ElementsSelection

ActionExecutor (action.ts)
  ~ getChoices(selection, player, args) -> AnnotatedChoice<unknown>[]  [BREAKING]
  ~ hasValidSelectionPath() -> only counts items where disabled === false
  ~ validateSelection() -> rejects disabled items with "Selection disabled: <reason>"
  ~ choicesContain() -> must compare against .value
  ~ trySmartResolveChoice() -> must compare against .value
  ~ smartResolveChoiceValue() -> must compare against .value
  ~ resolveArgs() -> line 166 calls getChoices, must use .value for resolution
```

### Key Structural Detail: Where disabled Callback Runs

The `disabled` callback runs AFTER `filter`. In `getChoices()`:

1. For `element` type: elements are gathered via `from`/`elementClass`/`filter`, then each gets annotated with disabled status
2. For `elements` type: elements come from the `elements` array/function, then each gets annotated
3. For `choice` type: choices come from `choices` array/function (with `filterBy` applied), then each gets annotated

### Anti-Patterns to Avoid
- **Do NOT filter out disabled items from getChoices**: They must remain in the list with their annotation. The design explicitly says disabled items "appear in the list (not filtered out)."
- **Do NOT return `string | false` on the wire**: The wire type uses `disabled?: string` (optional). This is Phase 76's concern but the engine type must be `string | false`.
- **Do NOT add `display` to AnnotatedChoice**: Display is layered by session/UI. AnnotatedChoice only has `value` and `disabled`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Disabled state type | Custom boolean + string combo | `string \| false` pattern | Design doc specifies; no bare `true` forces reason strings |
| Choice annotation | Inline disabled check everywhere | Single annotation pass in `getChoices()` | Centralizes the logic, all callers get consistent data |

## Common Pitfalls

### Pitfall 1: Internal Callers of getChoices() Break
**What goes wrong:** `getChoices()` currently returns `unknown[]` and is called ~15 times within `action.ts` itself. After the change to `AnnotatedChoice<unknown>[]`, every internal caller that treats results as raw values will break.
**Why it happens:** The return type changes from `T[]` to `AnnotatedChoice<T>[]`, but internal code like `choicesContain`, `trySmartResolveChoice`, `smartResolveChoiceValue`, `resolveArgs` (line 166), and `processRepeatingStep` all compare against raw values.
**How to avoid:** Systematically update every internal call site. The critical internal callers are:
- `validateSelection()` (line 549, 562) - uses `choicesContain` against raw values
- `resolveArgs()` (line 166) - calls `getChoices` for smart resolution
- `hasValidSelectionPath()` (lines 965, 987, 1011, 1032) - checks `choices.length === 0`
- `traceSelectionPath()` (line 870) - checks `choices.length`
- `processRepeatingStep()` (lines 1163, 1174, 1241) - validates against choices
- `formatValidChoices()` (line 510) - formats for error messages
**Warning signs:** TypeScript compiler errors after changing the return type. Run `tsc --noEmit` to find all sites.

### Pitfall 2: hasValidSelectionPath() Must Count Only Enabled Items
**What goes wrong:** Currently `hasValidSelectionPath()` checks `choices.length === 0` to determine if a selection has valid options. After the change, a selection with 5 items all disabled should return `false` for required selections.
**Why it happens:** The length check is insufficient -- need to check if any item has `disabled === false`.
**How to avoid:** After `getChoices()` returns annotated choices, filter to only enabled items before checking length. For optional selections, the selection remains available even when all items are disabled (player can skip).
**Warning signs:** Actions appearing available when all their choices are disabled.

### Pitfall 3: choicesContain and Smart Resolution Must Unwrap .value
**What goes wrong:** `choicesContain(choices, value)` compares `value` against each `choice` using `valuesEqual`. After the change, each choice is `{ value: T, disabled: string | false }`, not `T`.
**Why it happens:** The comparison logic doesn't know about the wrapper.
**How to avoid:** Either (a) create a parallel method that compares against `.value` of each annotated choice, or (b) map to values before comparison. Option (a) is cleaner since it avoids creating throwaway arrays.
**Warning signs:** Validation rejecting valid selections because `choicesContain` can't find the value in annotated choices.

### Pitfall 4: AI Bot Receives AnnotatedChoice from getSelectionChoices
**What goes wrong:** The MCTS bot in `src/ai/mcts-bot.ts` calls `game.getSelectionChoices()` which calls `executor.getChoices()`. After the change, the bot receives `AnnotatedChoice[]` and tries to use them as raw values for action args.
**Why it happens:** `game.getSelectionChoices()` passes through the return of `getChoices()`.
**How to avoid:** This is technically out of scope for Phase 75 (downstream concern), but the planner should note that `game.getSelectionChoices()` and the AI bot are callers that need updating. The AI bot should filter out disabled choices (it should never select a disabled option) and extract `.value` from each choice. This should be tracked as part of downstream work or addressed within this phase if scoped.
**Warning signs:** AI crashes or selects disabled items.

### Pitfall 5: Existing Tests Assert getChoices Returns Raw Values
**What goes wrong:** Tests like `expect(choices).toEqual(['red', 'blue', 'green'])` will fail because `getChoices` now returns `[{ value: 'red', disabled: false }, ...]`.
**Why it happens:** Return type changed.
**How to avoid:** Update all test assertions to match the new `AnnotatedChoice` structure. Consider adding a helper to extract values: `choices.map(c => c.value)` for tests that don't care about disabled status.
**Warning signs:** All existing getChoices tests fail after the change.

## Code Examples

### AnnotatedChoice Type Definition

```typescript
// Source: docs/plans/2026-02-05-disabled-selections-design.md
// Location: src/engine/action/types.ts

/**
 * A choice annotated with its disabled status.
 * Returned by getChoices() for all selection types.
 */
export type AnnotatedChoice<T> = {
  /** The actual choice value */
  value: T;
  /**
   * Disabled reason string, or false if selectable.
   * No bare `true` -- forces a reason string for good UX.
   */
  disabled: string | false;
};
```

### Adding disabled to Selection Interfaces

```typescript
// Location: src/engine/action/types.ts

// On ChoiceSelection<T>:
export interface ChoiceSelection<T = unknown> extends BaseSelection<T> {
  // ... existing fields ...
  /**
   * Check if a choice should be disabled (visible but not selectable).
   * Returns a reason string if disabled, or false if selectable.
   * Only runs on items that passed filter (filter = visibility, disabled = selectability).
   */
  disabled?: (choice: T, context: ActionContext) => string | false;
}

// On ElementSelection<T>:
export interface ElementSelection<T extends GameElement = GameElement> extends BaseSelection<T> {
  // ... existing fields ...
  disabled?: (element: T, context: ActionContext) => string | false;
}

// On ElementsSelection<T>:
export interface ElementsSelection<T extends GameElement = GameElement> extends BaseSelection<T> {
  // ... existing fields ...
  disabled?: (element: T, context: ActionContext) => string | false;
}
```

### Updated getChoices() Pattern

```typescript
// Location: src/engine/action/action.ts

getChoices(
  selection: Selection,
  player: Player,
  args: Record<string, unknown>
): AnnotatedChoice<unknown>[] {
  const context: ActionContext = { game: this.game, player, args };

  switch (selection.type) {
    case 'choice': {
      const choiceSel = selection as ChoiceSelection;
      let rawChoices = typeof choiceSel.choices === 'function'
        ? choiceSel.choices(context)
        : [...choiceSel.choices];

      // Apply filterBy if present (existing logic)
      if (choiceSel.filterBy) { /* ... existing filterBy logic ... */ }

      // Annotate each choice with disabled status
      return rawChoices.map(choice => ({
        value: choice,
        disabled: choiceSel.disabled ? choiceSel.disabled(choice, context) : false,
      }));
    }

    case 'element': {
      const elementSel = selection as ElementSelection;
      let elements: GameElement[];
      // ... existing element gathering and filter logic ...

      // Annotate each element with disabled status
      return elements.map(el => ({
        value: el,
        disabled: elementSel.disabled
          ? elementSel.disabled(el as any, context)
          : false,
      }));
    }

    case 'elements': {
      const elementsSel = selection as ElementsSelection;
      const elements = typeof elementsSel.elements === 'function'
        ? elementsSel.elements(context)
        : [...elementsSel.elements];

      return elements.map(el => ({
        value: el,
        disabled: elementsSel.disabled
          ? elementsSel.disabled(el as any, context)
          : false,
      }));
    }

    case 'text':
    case 'number':
      return [];

    default:
      return [];
  }
}
```

### Updated hasValidSelectionPath() Pattern

```typescript
// For each selection type in hasValidSelectionPath():
const annotatedChoices = this.getChoices(selection, player, args);
const enabledChoices = annotatedChoices.filter(c => c.disabled === false);

if (enabledChoices.length === 0) {
  // Required selections: no valid path
  return false;
}

// When checking dependent selections, iterate over enabled choices only:
for (const choice of enabledChoices) {
  const newArgs = { ...args, [selection.name]: choice.value };
  if (this.hasValidSelectionPath(selections, player, newArgs, index + 1)) {
    return true;
  }
}
```

### Updated validateSelection() Pattern

```typescript
// In validateSelection(), after getting annotated choices:
const annotatedChoices = this.getChoices(selection, player, args);

// Check if the submitted value is disabled
const matchingChoice = annotatedChoices.find(c => this.valuesEqual(c.value, value));
if (matchingChoice && matchingChoice.disabled !== false) {
  errors.push(`Selection disabled: ${matchingChoice.disabled}`);
  return { valid: false, errors };
}

// Then check if value is in valid choices (using .value for comparison)
if (!annotatedChoices.some(c => this.valuesEqual(c.value, value))) {
  // ... existing "invalid selection" error logic ...
}
```

### Builder Method Update Pattern

```typescript
// Location: src/engine/action/action-builder.ts

// chooseFrom gains disabled option:
chooseFrom<T>(
  name: string,
  options: {
    // ... existing options ...
    /** Check if a choice should be disabled. Returns reason string or false. */
    disabled?: (choice: T, context: ActionContext) => string | false;
  }
): this {
  const selection: ChoiceSelection<T> = {
    // ... existing fields ...
    disabled: options.disabled,
  };
  this.definition.selections.push(selection as Selection);
  return this;
}

// Same pattern for chooseElement and fromElements
```

## Caller Impact Analysis

Every caller of `getChoices()` and `getSelectionChoices()` must be updated. Here is the complete list:

### Internal to ActionExecutor (action.ts) -- IN SCOPE
| Line | Method | Current Usage | Required Change |
|------|--------|---------------|-----------------|
| 166 | `resolveArgs()` | `getChoices(selection, player, resolved)` for smart resolution | Extract `.value` from each annotated choice |
| 549 | `validateSelection()` | `choicesContain(choices, v)` for multiSelect | Compare against `.value`; check disabled status |
| 562 | `validateSelection()` | `choicesContain(choices, value)` for single select | Compare against `.value`; check disabled status |
| 576 | `validateSelection()` | `getChoices() as GameElement[]` for elements | Extract `.value` for element validation |
| 870 | `traceSelectionPath()` | `choices.length` | Use total length (disabled items still shown in trace) |
| 965 | `hasValidSelectionPath()` | `choices.length === 0` for element | Filter to enabled, check enabled length |
| 987 | `hasValidSelectionPath()` | `elements.length === 0` for elements | Filter to enabled, check enabled length |
| 1011 | `hasValidSelectionPath()` | `choices.length === 0` for dynamic choice | Filter to enabled, check enabled length |
| 1032 | `hasValidSelectionPath()` | `choices.length === 0` for static choice | Filter to enabled, check enabled length |
| 1163 | `processRepeatingStep()` | `getChoices()` for validation | Extract `.value` for validation |
| 1174 | `processRepeatingStep()` | `choicesContain(currentChoices, value)` | Compare against `.value` |
| 1241 | `processRepeatingStep()` | `getChoices()` for next choices | Extract `.value` for next choices |

### External Callers -- DOWNSTREAM (Phase 76+)
| File | Method | Impact |
|------|--------|--------|
| `engine/element/game.ts:1035` | `getSelectionChoices()` | Returns `AnnotatedChoice[]` to callers |
| `ai/mcts-bot.ts:1057` | `getChoicesForSelection()` | Receives annotated; must filter disabled, extract `.value` |
| `session/pick-handler.ts:*` | `getPickChoices()` | Duplicates choice resolution; will need to thread disabled |
| `ui/composables/useActionController.ts:269` | `getChoices()` | UI-layer, separate concern |
| `testing/debug.ts:290` | debug utility | Uses `selection.getChoices` (different method signature) |

### Key Decision: game.getSelectionChoices() Return Type
`game.getSelectionChoices()` currently returns `unknown[]` and directly passes through `executor.getChoices()`. After the change, it returns `AnnotatedChoice<unknown>[]`. This affects:
- AI bot (must extract `.value` and filter disabled)
- Any game code calling `getSelectionChoices()` directly

This is a deliberate breaking change per the design document.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `filter` only (binary include/exclude) | `filter` (visibility) + `disabled` (selectability) | This phase | Two-tier filtering with rich UX |
| `getChoices()` returns `T[]` | `getChoices()` returns `AnnotatedChoice<T>[]` | This phase | Breaking change; all callers must update |

## Open Questions

1. **Should `traceSelectionPath()` count disabled items in `choiceCount`?**
   - Design says disabled items are "in the list" -- so yes, the trace should show total count (including disabled)
   - But the `available` flag should be based on enabled count only
   - Recommendation: Show total in `choiceCount`, add `enabledCount` to `PickTrace` if useful for debugging. Low priority -- can defer.

2. **Should `processRepeatingStep()` allow selecting disabled items?**
   - Almost certainly no -- disabled means "not selectable"
   - Recommendation: Reject disabled items in repeating step validation, same as validateSelection

3. **Game.getSelectionChoices() return type change -- scope?**
   - The design says this is a breaking change
   - The AI bot caller needs updating to handle AnnotatedChoice
   - Recommendation: If updating the AI bot is trivial (filter disabled + extract .value), include it in this phase. Otherwise, track as Phase 76 blocker.

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/docs/plans/2026-02-05-disabled-selections-design.md` -- Full design document with all decisions
- `/Users/jtsmith/BoardSmith/src/engine/action/action.ts` -- Current ActionExecutor implementation (1401 lines)
- `/Users/jtsmith/BoardSmith/src/engine/action/action-builder.ts` -- Current builder methods (527 lines)
- `/Users/jtsmith/BoardSmith/src/engine/action/types.ts` -- Current type definitions (606 lines)
- `/Users/jtsmith/BoardSmith/src/engine/action/action.test.ts` -- Existing test patterns (1336 lines)

### Secondary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/session/pick-handler.ts` -- Session layer caller (354 lines)
- `/Users/jtsmith/BoardSmith/src/ai/mcts-bot.ts` -- AI bot caller
- `/Users/jtsmith/BoardSmith/src/engine/element/game.ts` -- `getSelectionChoices()` passthrough

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No external dependencies, pure TypeScript
- Architecture: HIGH -- Complete source code read, all callers identified, design doc available
- Pitfalls: HIGH -- Every call site mapped with line numbers, breaking change impact fully understood

**Research date:** 2026-02-05
**Valid until:** Stable (this is internal engine code with a locked design document)
