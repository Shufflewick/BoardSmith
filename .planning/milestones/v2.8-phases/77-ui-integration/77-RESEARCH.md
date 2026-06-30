# Phase 77: UI Integration - Research

**Researched:** 2026-02-06
**Domain:** Vue 3 UI layer -- disabled state in ActionPanel, useBoardInteraction, useActionController, fill/auto-fill
**Confidence:** HIGH

## Summary

Phase 77 wires `disabled?: string` from the session wire types (already present in `ValidElement` and `ChoiceWithRefs` in `src/session/types.ts` and `src/types/protocol.ts` from Phase 76) through the UI layer so that disabled items render greyed out with reason tooltips, clicks are ignored, board elements get CSS classes, custom UIs can read `disabled`, `fill()` rejects disabled values client-side, and auto-fill skips disabled items.

The UI layer has three subsystems that need updating:

1. **Type mirrors** (`useActionControllerTypes.ts`): The UI-layer `ValidElement`, `ChoiceWithRefs`, and `PickSnapshot.choices` do NOT yet carry `disabled?: string`. Phase 76 research explicitly deferred this to Phase 77.

2. **Rendering** (ActionPanel, useBoardInteraction, AutoElement): ActionPanel renders buttons for elements and choices but currently has no concept of disabled items. useBoardInteraction's `triggerElementSelect` dispatches clicks without checking disabled state. AutoElement applies CSS classes like `action-selectable` but has no `bs-element-disabled` class.

3. **Logic** (useActionController): `fill()` validates against choices but does not check disabled. `tryAutoFillSelection` selects the single available choice without filtering disabled ones. `getChoices()` returns all choices regardless of disabled state.

**Primary recommendation:** Add `disabled?: string` to UI-layer types, then modify each subsystem top-down: types first, then ActionPanel rendering, then useBoardInteraction guards, then useActionController logic (fill rejection, auto-fill filtering).

## Standard Stack

No new libraries needed. This is purely internal UI changes within the existing Vue 3 + TypeScript codebase.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | existing | Reactive composables, templates | Already used throughout |
| TypeScript | existing | Type field additions | Already used throughout |
| Vitest | existing | Unit tests | Already used for controller tests |

## Architecture Patterns

### Data Flow: Wire to UI

```
Session Wire                      UI Types                          ActionPanel / Custom UI
(src/session/types.ts)           (useActionControllerTypes.ts)     (ActionPanel.vue, useBoardInteraction)

ValidElement {                   ValidElement {                    <button :disabled="!!el.disabled"
  id, display?, ref?,              id, display?, ref?,                :title="el.disabled || undefined">
  disabled?: string  <-- P76       disabled?: string  <-- P77
}                                }

ChoiceWithRefs {                 ChoiceWithRefs {                  <button :disabled="!!choice.disabled"
  value, display,                  value, display,                    :title="choice.disabled || undefined">
  sourceRef?, targetRef?,          sourceRef?, targetRef?,
  disabled?: string  <-- P76       disabled?: string  <-- P77
}                                }
```

### Server -> UI Choice Flow

The flow from server to ActionPanel for choices works like this:

1. `GameShell.vue` calls `fetchPickChoices` via `useActionController` options
2. Server endpoint calls `PickHandler.getPickChoices()` which evaluates `disabled` callbacks
3. Response includes `disabled?: string` on each choice/element (Phase 76 done)
4. `useActionController.fetchChoicesForPick()` stores result in `actionSnapshot.pickSnapshots`
5. `PickSnapshot` stores `choices` and `validElements` arrays
6. ActionPanel reads via `filteredChoices` (computed from `actionController.getCurrentChoices()`) and `filteredValidElements` (computed from `actionController.getValidElements()`)

**Key insight**: The `disabled` field already flows from server to the `PickSnapshot` storage transparently -- the controller stores whatever JSON comes back. But the TypeScript types don't declare it yet, and no rendering code reads it.

### Where Changes Are Needed

| File | What Changes | Requirement |
|------|-------------|-------------|
| `src/ui/composables/useActionControllerTypes.ts` | Add `disabled?: string` to `ValidElement`, `ChoiceWithRefs`, `PickSnapshot.choices` | Foundation for all UI requirements |
| `src/ui/components/auto-ui/ActionPanel.vue` | Add `:disabled` + `title` to element and choice buttons | UI-01, UI-02 |
| `src/ui/composables/useBoardInteraction.ts` | Add `isDisabledElement()`, guard `triggerElementSelect()` | UI-03, UI-04 |
| `src/ui/components/auto-ui/AutoElement.vue` | Add `bs-element-disabled` CSS class | UI-05 |
| `src/ui/composables/useActionController.ts` | Update `validElements` computed, `getChoices()`, `getCurrentChoices()`, `fill()`, `tryAutoFillSelection()` | UI-06, UI-07, UI-08, UI-09 |

### Project Structure (changes only)

```
src/ui/
  composables/
    useActionControllerTypes.ts  # Add disabled to ValidElement, ChoiceWithRefs, PickSnapshot
    useActionController.ts       # fill() disabled rejection, auto-fill filtering
    useBoardInteraction.ts       # isDisabledElement(), triggerElementSelect guard
  components/
    auto-ui/
      ActionPanel.vue            # :disabled + title on buttons
      AutoElement.vue            # bs-element-disabled CSS class
```

### Pattern: ActionPanel Button Rendering

**Current element button template** (line ~1442-1458):
```vue
<button
  v-for="element in filteredValidElements"
  :key="element.id"
  class="choice-btn element-btn"
  @click="selectElement(element.id, element.ref)"
  @mouseenter="handleElementHover(element)"
  @mouseleave="handleElementLeave"
>
  {{ element.display || element.id }}
</button>
```

**After adding disabled support:**
```vue
<button
  v-for="element in filteredValidElements"
  :key="element.id"
  class="choice-btn element-btn"
  :class="{ 'bs-element-disabled': !!element.disabled }"
  :disabled="!!element.disabled"
  :title="element.disabled || undefined"
  @click="selectElement(element.id, element.ref)"
  @mouseenter="handleElementHover(element)"
  @mouseleave="handleElementLeave"
>
  {{ element.display || element.id }}
</button>
```

HTML `disabled` attribute natively prevents clicks and applies `:disabled` CSS.
The `title` attribute provides a native tooltip with the reason string.

**Current choice button template** (line ~1586-1597 for regular choices):
```vue
<button
  v-for="choice in filteredChoices"
  :key="String(choice.value)"
  class="choice-btn"
  @click="setSelectionValue(currentPick.name, choice.value, choice.display)"
  @mouseenter="handleChoiceHover(choice)"
  @mouseleave="handleChoiceLeave"
>
  {{ choice.display }}
</button>
```

**After adding disabled support:**
```vue
<button
  v-for="choice in filteredChoices"
  :key="String(choice.value)"
  class="choice-btn"
  :class="{ 'bs-choice-disabled': !!choice.disabled }"
  :disabled="!!choice.disabled"
  :title="choice.disabled || undefined"
  @click="setSelectionValue(currentPick.name, choice.value, choice.display)"
  @mouseenter="handleChoiceHover(choice)"
  @mouseleave="handleChoiceLeave"
>
  {{ choice.display }}
</button>
```

**CRITICAL**: There are MANY button templates in ActionPanel (6+ different templates for element, elements, choice with filterBy, regular choice, multi-select choice, multi-select elements). Each one needs the disabled treatment. Specifically:

1. **Element selection buttons** (~line 1442) - single element pick
2. **Elements multiSelect checkboxes** (~line 1467) - multiSelect elements
3. **Elements without multiSelect** (~line 1500) - elements pick, no multiSelect
4. **MultiSelect choice checkboxes** (~line 1529) - multiSelect choices
5. **FilterBy/dependsOn choice buttons** (~line 1563) - filtered choices
6. **Regular choice buttons** (~line 1586) - plain choice pick

### Pattern: useBoardInteraction Disabled Check

The design doc says `isDisabledElement(element): string | false`. This is a new method on `BoardInteractionActions`:

```typescript
// In useBoardInteraction.ts

/** Check if a board element is disabled for the current action selection */
isDisabledElement: (element: { id?: number; name?: string; notation?: string }) => string | false;
```

Implementation finds the matching valid element and returns its `disabled` field:

```typescript
isDisabledElement(element) {
  const validElem = state.validElements.find(ve => matchesRef(element, ve.ref));
  if (!validElem) return false;
  return validElem.disabled || false;
},
```

**NOTE**: `state.validElements` is currently typed as `ValidElement[]` where `ValidElement` has `{ id: number; ref: ElementRef }`. It does NOT carry `disabled`. The board interaction `ValidElement` is a DIFFERENT type from the controller's `ValidElement`. The board interaction imports `ValidElement` from its own interface definition (line 38-43):

```typescript
export interface ValidElement {
  id: number;
  ref: ElementRef;
}
```

This interface needs `disabled?: string` added to it for `isDisabledElement` to work.

### Pattern: triggerElementSelect Guard

Current `triggerElementSelect` (line ~265-270):
```typescript
triggerElementSelect(element) {
  const validElem = state.validElements.find(ve => matchesRef(element, ve.ref));
  if (validElem && state.onElementSelect) {
    state.onElementSelect(validElem.id);
  }
},
```

**After adding disabled guard:**
```typescript
triggerElementSelect(element) {
  const validElem = state.validElements.find(ve => matchesRef(element, ve.ref));
  if (validElem && !validElem.disabled && state.onElementSelect) {
    state.onElementSelect(validElem.id);
  }
},
```

### Pattern: AutoElement CSS Class

AutoElement currently applies `action-selectable` class when `boardInteraction.isSelectableElement()` returns true. For disabled elements, we need to add the `bs-element-disabled` class.

The challenge: AutoElement does not currently have access to the `disabled` info. It only checks `boardInteraction.isSelectableElement()`. The new `boardInteraction.isDisabledElement()` method provides this.

```typescript
// In AutoElement.vue
const isDisabledForAction = computed(() => {
  if (!boardInteraction) return false;
  const result = boardInteraction.isDisabledElement({
    id: props.element.id,
    name: props.element.name,
    notation: elementNotation.value || undefined,
  });
  return typeof result === 'string' ? result : false;
});
```

Then in the template, add `bs-element-disabled` to the class binding alongside existing classes.

### Pattern: fill() Disabled Rejection

In `useActionController.ts`, the `fill()` method calls `validateSelection()` which checks if the value is in the choices list. But it does NOT check if the matched choice is disabled.

**Current validateSelection** (line ~372-416):
```typescript
function validateSelection(selection: PickMetadata, value: unknown): ValidationResult {
  // ...checks if value is in choices...
  const valueMatchesChoice = (v: unknown): boolean => {
    return choices.some(c => {
      if (c.value === v) return true;
      // ...more matching...
    });
  };
  // ...
}
```

**Needs**: After finding the matching choice, check if it's disabled:

```typescript
function validateSelection(selection: PickMetadata, value: unknown): ValidationResult {
  const choices = getChoices(selection);
  if (choices.length > 0) {
    // Find the matching choice
    const matchedChoice = choices.find(c => c.value === value || /* other matchers */);

    // Check disabled BEFORE containment check (design doc specifies this order)
    if (matchedChoice && (matchedChoice as any).disabled) {
      return { valid: false, error: `Selection disabled: ${(matchedChoice as any).disabled}` };
    }

    // Then check containment
    if (!matchedChoice) {
      return { valid: false, error: `Invalid selection for "${selection.name}"` };
    }
  }
  return { valid: true };
}
```

**NOTE on error surfacing (UI-08):** The design doc says "reason surfaced to user through the existing error display mechanism". Currently, `fill()` returns `ValidationResult` and ActionPanel logs errors with `console.error('Selection failed:', result.error)`. There is no toast or UI error display for fill failures. The `lastError` ref on the controller could be used, but it's not displayed in ActionPanel's template. The simplest approach is to rely on the existing pattern: ActionPanel already logs errors. For disabled selections, the button is disabled so users shouldn't be able to click it. The `fill()` rejection is a defense-in-depth for programmatic calls from custom UIs. The `lastError` ref already captures the error.

### Pattern: Auto-fill Skips Disabled

**Current tryAutoFillSelection** (line ~461-479):
```typescript
function tryAutoFillSelection(selection: PickMetadata): boolean {
  if (!getAutoFill() || isExecuting.value) return false;
  const choices = getChoices(selection);
  if (choices.length !== 1 || selection.optional) return false;
  // Auto-fill with the single choice
  const choice = choices[0];
  currentArgs.value[selection.name] = choice.value;
  // ...
  return true;
}
```

**Needs**: Filter out disabled choices before counting:

```typescript
function tryAutoFillSelection(selection: PickMetadata): boolean {
  if (!getAutoFill() || isExecuting.value) return false;
  const choices = getChoices(selection);
  const enabledChoices = choices.filter(c => !(c as any).disabled);
  if (enabledChoices.length !== 1 || selection.optional) return false;
  // Auto-fill with the single enabled choice
  const choice = enabledChoices[0];
  // ...
}
```

This means: 3 total choices, 2 disabled, 1 enabled = auto-fill the enabled one.

### Pattern: validElements Computed Carries Disabled

The `validElements` computed in `useActionController.ts` (line ~627-642) returns enriched elements from the snapshot. Since `PickSnapshot.validElements` will carry `disabled?: string` (after type update), the computed just passes it through. The enrichment in `useGameViewEnrichment.ts` uses spread (`{ ...ve, element }`) which preserves `disabled`.

For `getChoices()` / `getCurrentChoices()`, similar: they already return the snapshot's choices array, which will carry `disabled` once the types are updated.

### Anti-Patterns to Avoid

- **Do NOT filter disabled items out of choices/validElements lists**: Disabled items must REMAIN in the lists so they render as greyed-out buttons. Only auto-fill and validation behavior changes.
- **Do NOT add a new error display system for fill() rejection**: Use the existing `lastError` ref on the controller. ActionPanel already logs errors.
- **Do NOT modify PickHandler or session types**: Phase 76 already completed the wire threading.
- **Do NOT add disabled to `PickMetadata.choices` type**: The `PickMetadata` interface has `choices?: ChoiceWithRefs[]` which will inherit `disabled` when `ChoiceWithRefs` is updated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip for disabled reason | Custom tooltip component | Native HTML `title` attribute | Design doc specifies `title` tooltip, native HTML disabled+title is the simplest correct approach |
| Click prevention for disabled buttons | Custom click handler guards | HTML `disabled` attribute | Native `disabled` prevents click events entirely |
| Board element disabled appearance | Complex opacity/overlay system | CSS class `bs-element-disabled` | Simple CSS approach, game designers can customize |

## Common Pitfalls

### Pitfall 1: Missing Button Templates
**What goes wrong:** ActionPanel has 6+ different button templates (element, elements multiSelect, elements non-multiSelect, choice multiSelect, choice filterBy, choice regular). Missing any template leaves disabled items clickable in that code path.
**Why it happens:** The templates look similar but are in different `v-if`/`v-else-if` branches.
**How to avoid:** Search for ALL `class="choice-btn"` and `class="element-btn"` occurrences in ActionPanel. Each one needs `:disabled` and `:title`.
**Warning signs:** Disabled items are clickable in one selection mode but not another.

### Pitfall 2: Board Interaction ValidElement Type Mismatch
**What goes wrong:** `useBoardInteraction.ts` has its OWN `ValidElement` interface (`{ id: number; ref: ElementRef }`) separate from `useActionControllerTypes.ts`'s `ValidElement` (`{ id: number; display?: string; ref?: ElementRef; element?: GameElement }`). Adding `disabled` to one doesn't add it to the other.
**Why it happens:** The two interfaces evolved independently.
**How to avoid:** Add `disabled?: string` to BOTH `ValidElement` interfaces. Also update the `setValidElements` call in ActionPanel's watch (line ~587) where it maps `filteredValidElements` to board interaction format -- must include `disabled`.
**Warning signs:** `isDisabledElement()` always returns `false` because the board interaction's `ValidElement` doesn't carry `disabled`.

### Pitfall 3: Auto-fill With Mixed Disabled/Enabled
**What goes wrong:** If 3 choices exist, 2 disabled, 1 enabled -- current auto-fill sees 3 choices and does NOT auto-fill. After fix, it should see 1 enabled choice and auto-fill.
**Why it happens:** `tryAutoFillSelection` counts ALL choices, not just enabled ones.
**How to avoid:** Filter disabled before counting in `tryAutoFillSelection` and the parallel auto-fill in `fill()` (line ~1115-1129).
**Warning signs:** Player is forced to manually select the only enabled option.

### Pitfall 4: Multi-select Disabled Handling
**What goes wrong:** Multi-select checkboxes should show disabled items but prevent checking them. The existing `disabled` binding on checkboxes handles "max reached" case. Adding disabled-by-game-logic requires a compound condition.
**Why it happens:** The checkbox `:disabled` binding is already complex (checks max reached).
**How to avoid:** Add `|| !!choice.disabled` to the existing disabled binding for multi-select checkboxes.
**Warning signs:** Disabled multi-select choices are still checkable.

### Pitfall 5: ActionPanel setValidElements Not Passing Disabled
**What goes wrong:** In ActionPanel's `watch([currentPick, filteredValidElements], ...)` (line ~568), valid elements are mapped for board interaction. The current mapping only includes `{ id, ref }`. If `disabled` is not included, the board interaction won't know about disabled elements.
**Why it happens:** The mapping was written before disabled existed.
**How to avoid:** Update the map in the watch to include `disabled`:
```typescript
validElems = filteredValidElements.value.map(ve => ({
  id: ve.id,
  ref: ve.ref || { id: ve.id },
  disabled: ve.disabled,
}));
```
**Warning signs:** Board clicks still select disabled elements even though ActionPanel buttons are disabled.

### Pitfall 6: Choice-with-refs Board Click Not Checking Disabled
**What goes wrong:** For choice selections with `sourceRef`/`targetRef`, clicking a board element triggers the choice. The onSelect callback in ActionPanel (line ~631) doesn't check if the choice is disabled.
**Why it happens:** The refToChoice map lookup doesn't consider disabled state.
**How to avoid:** In the `onSelect` callback for choice-with-refs, check if the matched choice is disabled before calling `setSelectionValue`.
**Warning signs:** Clicking a board element selects a disabled choice.

## Code Examples

### Type Changes (useActionControllerTypes.ts)

```typescript
// Source: src/ui/composables/useActionControllerTypes.ts

/** Choice with optional board element references */
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  sourceRef?: ElementRef;
  targetRef?: ElementRef;
  /** Disabled reason string, present only when choice is disabled */
  disabled?: string;  // <-- ADD THIS
}

/** Valid element for element selections */
export interface ValidElement {
  id: number;
  display?: string;
  ref?: ElementRef;
  element?: GameElement;
  /** Disabled reason string, present only when element is disabled */
  disabled?: string;  // <-- ADD THIS
}

export interface PickSnapshot {
  choices?: Array<{
    value: unknown;
    display: string;
    sourceRef?: ElementRef;
    targetRef?: ElementRef;
    disabled?: string;  // <-- ADD THIS
  }>;
  validElements?: ValidElement[];  // Already gets it via ValidElement update
  multiSelect?: { min: number; max?: number };
}
```

### Board Interaction Changes (useBoardInteraction.ts)

```typescript
// Source: src/ui/composables/useBoardInteraction.ts

// Update ValidElement interface
export interface ValidElement {
  id: number;
  ref: ElementRef;
  disabled?: string;  // <-- ADD THIS
}

// Add to BoardInteractionActions interface
/** Check if a board element is disabled for the current action selection */
isDisabledElement: (element: { id?: number; name?: string; notation?: string }) => string | false;

// Implementation in createBoardInteraction
isDisabledElement(element) {
  const validElem = state.validElements.find(ve => matchesRef(element, ve.ref));
  if (!validElem) return false;
  return validElem.disabled || false;
},

// Guard triggerElementSelect
triggerElementSelect(element) {
  const validElem = state.validElements.find(ve => matchesRef(element, ve.ref));
  if (validElem && !validElem.disabled && state.onElementSelect) {
    state.onElementSelect(validElem.id);
  }
},
```

### ActionPanel Disabled Button (representative example)

```vue
<!-- Element selection button with disabled support -->
<button
  v-for="element in filteredValidElements"
  :key="element.id"
  class="choice-btn element-btn"
  :class="{ 'bs-element-disabled': !!element.disabled }"
  :disabled="!!element.disabled"
  :title="element.disabled || undefined"
  @click="selectElement(element.id, element.ref)"
  @mouseenter="handleElementHover(element)"
  @mouseleave="handleElementLeave"
>
  {{ element.display || element.id }}
</button>
```

### Auto-fill Filtering

```typescript
// In useActionController.ts - tryAutoFillSelection
function tryAutoFillSelection(selection: PickMetadata): boolean {
  if (!getAutoFill() || isExecuting.value) return false;
  const choices = getChoices(selection);
  // Filter to enabled choices only for auto-fill counting
  const enabledChoices = choices.filter(c => !(c as any).disabled);
  if (enabledChoices.length !== 1 || selection.optional) return false;
  // Auto-fill with the single enabled choice
  const choice = enabledChoices[0];
  currentArgs.value[selection.name] = choice.value;
  // ... store in collectedPicks ...
  return true;
}
```

### fill() Disabled Rejection

```typescript
// In useActionController.ts - validateSelection
// Check disabled BEFORE containment (design doc spec)
function validateSelection(selection: PickMetadata, value: unknown): ValidationResult {
  const choices = getChoices(selection);
  if (choices.length > 0) {
    // Find matching choice first
    const matched = choices.find(c => /* matching logic */);

    // Check disabled before reporting invalid
    if (matched && (matched as any).disabled) {
      return {
        valid: false,
        error: `Selection disabled: ${(matched as any).disabled}`
      };
    }

    if (!matched) {
      return { valid: false, error: `Invalid selection for "${selection.name}"` };
    }
  }
  return { valid: true };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Filter hides items | Filter + disabled (two-state) | Phase 75-77 | Items can be visible but unselectable |
| No disabled on wire | `disabled?: string` on wire types | Phase 76 | Wire carries disabled reason from server |
| No disabled in UI | `disabled?: string` on UI types | Phase 77 (this phase) | UI can render and enforce disabled |

## Open Questions

1. **Error display for fill() rejection:**
   - What we know: `fill()` returns `ValidationResult` with error string. ActionPanel logs to console. `lastError` ref stores it.
   - What's unclear: Should the disabled reason show as a toast notification? The design doc says "surfaced to user" but doesn't specify mechanism.
   - Recommendation: Use `lastError` ref. If a toast is wanted, that can be added later. The primary UX is the button being disabled with a tooltip -- fill() rejection is defense-in-depth for programmatic use.

2. **Disabled elements in multi-select Done button logic:**
   - What we know: `isMultiSelectReady` checks `selectedCount >= min`. Auto-confirm fires when `min === max && count === min`.
   - What's unclear: If disabled items are present, should `min`/`max` change?
   - Recommendation: No -- `min`/`max` comes from the engine and already accounts for disabled items via `hasValidSelectionPath`. The UI just prevents selecting disabled items.

## Sources

### Primary (HIGH confidence)
- `src/ui/composables/useActionControllerTypes.ts` -- UI-layer types, verified `disabled` NOT present yet
- `src/ui/composables/useActionController.ts` -- fill(), tryAutoFillSelection, getChoices, validateSelection
- `src/ui/composables/useBoardInteraction.ts` -- triggerElementSelect, ValidElement interface
- `src/ui/components/auto-ui/ActionPanel.vue` -- All 6+ button templates identified
- `src/ui/components/auto-ui/AutoElement.vue` -- CSS class system verified
- `src/session/types.ts` -- Wire types already have `disabled?: string` (Phase 76)
- `src/types/protocol.ts` -- Protocol types already have `disabled?: string` (Phase 76)
- `src/session/pick-handler.ts` -- Disabled threading verified working (Phase 76)
- `docs/plans/2026-02-05-disabled-selections-design.md` -- Canonical design decisions

### Secondary (MEDIUM confidence)
- `src/ui/composables/useGameViewEnrichment.ts` -- Uses spread, will pass through disabled

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing Vue 3 patterns
- Architecture: HIGH -- all code paths traced through actual source files
- Pitfalls: HIGH -- each pitfall identified from reading actual code, not speculation
- Code examples: HIGH -- based on actual current code with minimal changes

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (stable internal codebase, unlikely to change)
