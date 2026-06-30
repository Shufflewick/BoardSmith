# Phase 79: Fix element-type disabled in getChoices - Research

**Researched:** 2026-02-06
**Domain:** useActionController element-to-choice mapping gap closure
**Confidence:** HIGH

## Summary

This is a surgical bug fix in a single file (`useActionController.ts`) where three `validElements.map()` calls drop the `disabled` field when converting `ValidElement[]` to choice-like arrays. The fix is adding `...(el.disabled && { disabled: el.disabled })` to each mapping. All downstream consumers (validateSelection, tryAutoFillSelection, execute auto-fill, fill post-fill auto-fill) already handle the `disabled` field correctly because they operate on the output of `getChoices()`.

The codebase is well-structured and the types already support `disabled?: string` on both the return type of `getChoices()` and on `ValidElement`. No type changes are needed. No new dependencies are needed.

**Primary recommendation:** Fix the 3 map calls in `getChoices()`, add 4 test cases to `useActionController.test.ts` covering element-type disabled across all code paths, verify all downstream paths work by tracing through the code.

## Standard Stack

No new libraries needed. This is entirely within the existing codebase:

### Core Files
| File | Purpose | Changes Needed |
|------|---------|----------------|
| `src/ui/composables/useActionController.ts` | Source of the bug -- 3 `validElements.map()` calls | Fix 3 mappings |
| `src/ui/composables/useActionController.test.ts` | Main test file with existing disabled tests | Add element-type disabled tests |
| `src/ui/composables/useActionController.helpers.ts` | Test fixtures (createTestMetadata) | Add element metadata with disabled |

### Verification Files (read-only)
| File | Purpose | Why Check |
|------|---------|-----------|
| `src/ui/composables/useActionControllerTypes.ts` | Type definitions | Confirm ValidElement has `disabled?: string` (it does, line 44) |
| `src/ui/composables/useActionController.picks.test.ts` | Pick-specific tests | Confirm no overlapping element disabled tests exist (none do) |

## Architecture Patterns

### The Bug: Three Mapping Locations

All three are in the `getChoices()` function, which converts various data sources into a uniform `Array<{ value, display, disabled? }>`:

**Location 1 (lines 286-289): Snapshot validElements**
```typescript
// CURRENT (broken):
choices = snapshot.validElements.map(el => ({
  value: el.id,
  display: el.display || `Element ${el.id}`,
}));

// FIX:
choices = snapshot.validElements.map(el => ({
  value: el.id,
  display: el.display || `Element ${el.id}`,
  ...(el.disabled && { disabled: el.disabled }),
}));
```

**Location 2 (lines 310-313): elementsByDependentValue**
```typescript
// CURRENT (broken):
choices = elements.map(el => ({
  value: el.id,
  display: el.display || `Element ${el.id}`,
}));

// FIX:
choices = elements.map(el => ({
  value: el.id,
  display: el.display || `Element ${el.id}`,
  ...(el.disabled && { disabled: el.disabled }),
}));
```

**Location 3 (lines 320-323): Static validElements fallback**
```typescript
// CURRENT (broken):
choices = selection.validElements.map(el => ({
  value: el.id,
  display: el.display || `Element ${el.id}`,
}));

// FIX:
choices = selection.validElements.map(el => ({
  value: el.id,
  display: el.display || `Element ${el.id}`,
  ...(el.disabled && { disabled: el.disabled }),
}));
```

### Why the Sparse Pattern `...(el.disabled && { disabled: el.disabled })`

This matches the project's "sparse wire disabled" decision: the `disabled` field should be absent (not `undefined`) on enabled items for clean JSON. The `&&` short-circuit ensures:
- When `el.disabled` is `undefined` or falsy: spread does nothing (field absent)
- When `el.disabled` is a string: spread adds `{ disabled: "reason" }`

### Downstream Consumers Already Work

Once `getChoices()` returns the `disabled` field, these code paths automatically benefit:

1. **`validateSelection()` (line 372)** - Calls `getChoices(selection)`, then checks `matched.disabled` on found choices. Already handles disabled for both single and array values.

2. **`tryAutoFillSelection()` (line 470)** - Calls `getChoices(selection)`, filters with `choices.filter(c => !c.disabled)`. Already filters disabled.

3. **`execute()` auto-fill (line 863)** - Calls `getChoices(selection)`, filters with `choices.filter(c => !c.disabled)`. Already filters disabled.

4. **`fill()` post-fill auto-fill (line 1127)** - Calls `getChoices(nextSel)`, filters with `choices.filter(c => !c.disabled)`. Already filters disabled.

5. **`getCurrentChoices()` (line 342)** - Delegates to `getChoices()`. Return type already includes `disabled?: string`.

### Test Fixtures Need Element-Type Disabled Metadata

The existing `createTestMetadata()` in helpers has `movePiece` and `attack` with `validElements` but none have `disabled`. Tests should create inline metadata with disabled elements (matching the pattern used by the existing choice-type disabled tests in the same file, which define metadata inline rather than modifying the shared fixtures).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Disabled field propagation | Custom transform layer | Spread in existing map calls | 3 one-line changes, no abstraction needed |
| Test metadata | Shared fixture changes | Inline metadata per test | Matches existing disabled test pattern (lines 1181-1451) |

## Common Pitfalls

### Pitfall 1: Using `disabled: el.disabled` Instead of Sparse Spread
**What goes wrong:** Setting `disabled: el.disabled` when `el.disabled` is `undefined` would add `disabled: undefined` to the object, violating the sparse wire convention.
**Why it happens:** Direct property copy feels simpler than spread.
**How to avoid:** Use `...(el.disabled && { disabled: el.disabled })` to keep the field absent when not disabled.
**Warning signs:** Test assertions checking `disabled: undefined` instead of `disabled` being absent.

### Pitfall 2: Only Testing Location 3 (Static Fallback)
**What goes wrong:** Tests pass for static metadata but miss the snapshot and dependsOn paths.
**Why it happens:** Static metadata tests are simpler (no fetchPickChoices mock needed). Snapshot path requires fetched choices. DependsOn path requires multi-step setup.
**How to avoid:** Write tests for all 3 code paths:
1. Static validElements (no fetchPickChoices, metadata has validElements directly)
2. Snapshot validElements (with fetchPickChoices returning validElements)
3. elementsByDependentValue (dependsOn with element type)

### Pitfall 3: Forgetting to Test fill() Rejection for Element-Type Disabled
**What goes wrong:** getChoices() carries disabled, but fill() rejection is untested for element picks.
**Why it happens:** validateSelection() uses getChoices() internally, so it should work, but without a test we can't prove it.
**How to avoid:** Add a test that starts an element-type action with disabled elements and verifies `fill()` returns `{ valid: false, error: 'Selection disabled: ...' }`.

### Pitfall 4: Forgetting to Test Auto-Fill Skips Disabled Elements
**What goes wrong:** Auto-fill could select a disabled element if getChoices() doesn't carry the field.
**Why it happens:** tryAutoFillSelection() filters `choices.filter(c => !c.disabled)`, but this only works if disabled is present.
**How to avoid:** Add a test with 2 elements where one is disabled (leaving exactly 1 enabled), verify auto-fill picks the enabled one.

## Code Examples

### Test Pattern: Element-Type Disabled in getChoices()
```typescript
it('should include disabled field in getChoices() for element-type selections', () => {
  const disabledElementMeta: Record<string, ActionMetadata> = {
    moveWithDisabled: {
      name: 'moveWithDisabled',
      prompt: 'Move piece',
      selections: [
        {
          name: 'piece',
          type: 'element',
          prompt: 'Select piece',
          validElements: [
            { id: 100, display: 'Pawn A' },
            { id: 101, display: 'Pawn B', disabled: 'Pinned' },
          ],
        },
      ],
    },
  };

  actionMetadata.value = { ...createTestMetadata(), ...disabledElementMeta };
  availableActions.value = [...(availableActions.value ?? []), 'moveWithDisabled'];

  const controller = useActionController({
    sendAction,
    availableActions,
    actionMetadata,
    isMyTurn,
    autoFill: false,
    autoExecute: false,
  });

  const selection = actionMetadata.value!.moveWithDisabled.selections[0];
  const choices = controller.getChoices(selection);

  expect(choices).toHaveLength(2);
  expect(choices[0].disabled).toBeUndefined();
  expect(choices[1].disabled).toBe('Pinned');
});
```

### Test Pattern: fill() Rejects Disabled Element
```typescript
it('should reject disabled element value via fill()', async () => {
  // ... same metadata setup as above ...

  await controller.start('moveWithDisabled');
  const result = await controller.fill('piece', 101);

  expect(result.valid).toBe(false);
  expect(result.error).toBe('Selection disabled: Pinned');
});
```

### Test Pattern: Auto-Fill Skips Disabled Elements
```typescript
it('should auto-fill single enabled element when others are disabled', async () => {
  const autoFillElementMeta: Record<string, ActionMetadata> = {
    forcedElement: {
      name: 'forcedElement',
      prompt: 'Select piece',
      selections: [
        {
          name: 'piece',
          type: 'element',
          prompt: 'Select piece',
          validElements: [
            { id: 100, display: 'Pawn A', disabled: 'Blocked' },
            { id: 101, display: 'Pawn B' },
          ],
        },
      ],
    },
  };

  // ... setup ...

  await controller.start('forcedElement');
  await nextTick();

  expect(controller.currentArgs.value.piece).toBe(101);
  expect(controller.isReady.value).toBe(true);
});
```

### Test Pattern: elementsByDependentValue with Disabled
```typescript
it('should include disabled in getChoices() for elementsByDependentValue', async () => {
  const depElementMeta: Record<string, ActionMetadata> = {
    depElementAction: {
      name: 'depElementAction',
      prompt: 'Select with depends',
      selections: [
        {
          name: 'zone',
          type: 'choice',
          prompt: 'Select zone',
          choices: [{ value: 'north', display: 'North' }],
        },
        {
          name: 'unit',
          type: 'element',
          prompt: 'Select unit',
          dependsOn: 'zone',
          elementsByDependentValue: {
            north: [
              { id: 1, display: 'Soldier' },
              { id: 2, display: 'Medic', disabled: 'Exhausted' },
            ],
          },
        },
      ],
    },
  };

  // ... setup, fill zone with 'north' ...

  const unitSel = depElementMeta.depElementAction.selections[1];
  const choices = controller.getChoices(unitSel);

  expect(choices[0].disabled).toBeUndefined();
  expect(choices[1].disabled).toBe('Exhausted');
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| getChoices() maps `{ value, display }` for elements | Should map `{ value, display, disabled? }` | Phase 79 (this fix) | Closes integration gap from v2.8 milestone |

**What is NOT changing:**
- ValidElement type (already has `disabled?: string`)
- getChoices() return type (already has `disabled?: string`)
- validateSelection() (already checks disabled)
- tryAutoFillSelection() (already filters disabled)
- ActionPanel element rendering (uses `validElements` computed, not `getChoices()`)
- Board interaction isDisabledElement() (works independently)

## Open Questions

None. This is a well-characterized, surgical fix with clear scope:
- 3 lines of production code to change (adding disabled spread to 3 map calls)
- 4 test cases to add (getChoices carries disabled, fill rejects disabled, auto-fill skips disabled, elementsByDependentValue carries disabled)
- All types and downstream consumers already support the fix

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.ts` - Full source read, all 3 bug locations verified at lines 286-289, 310-313, 320-323
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionControllerTypes.ts` - ValidElement type confirmed to have `disabled?: string` at line 44
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.test.ts` - All 7 existing disabled tests use `type: 'choice'`, none test element type
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.picks.test.ts` - Element tests exist but none test disabled
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionController.helpers.ts` - Test fixtures confirmed, no disabled elements in shared metadata
- `/Users/jtsmith/BoardSmith/.planning/v2.8-MILESTONE-AUDIT.md` - Gap identification and impact analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Single file, types verified, no external dependencies
- Architecture: HIGH - All 3 locations identified with exact line numbers, fix pattern confirmed
- Pitfalls: HIGH - Downstream consumers verified to already handle disabled correctly

**Research date:** 2026-02-06
**Valid until:** Indefinite (this is a bug fix in a stable codebase, not a moving target)
