# Automatic Element Enrichment

When using element selections (`fromElements`, `chooseElement`), the `actionController` automatically enriches valid elements with full element data from the game view. This is the "pit of success" pattern - designers get everything they need without extra work.

## Recommended: Use `validElements` Computed

The `actionController` provides a **reactive `validElements` computed** that automatically updates when:
- The current selection changes
- Choices are fetched from the server
- The gameView updates

```typescript
// In your custom UI component
const { validElements, currentSelection } = props.actionController;

// Use the reactive computed directly - it updates automatically!
const selectableCards = computed(() => {
  if (currentSelection.value?.type !== 'element') return [];

  return validElements.value.map(ve => ({
    id: ve.id,
    name: ve.display,
    // Full element data is included:
    image: ve.element?.attributes?.image,
    description: ve.element?.attributes?.description,
  }));
});
```

## ValidElement Interface

Each item in `validElements` includes:

```typescript
interface ValidElement {
  id: number;                    // Element ID (for submitting selection)
  display?: string;              // Display text for UI
  ref?: { id: number };          // Reference for board highlighting
  element?: GameElement;         // Full element with all attributes!
}
```

## Common Patterns

### Check if an element is selectable

```typescript
function isCardSelectable(cardId: number): boolean {
  if (currentSelection.value?.type !== 'element') return false;

  // Use the reactive validElements computed
  return validElements.value.some(ve => ve.id === cardId);
}
```

### Render selection choices with full data

```typescript
const equipmentChoices = computed(() => {
  if (currentSelection.value?.name !== 'equipment') return [];

  return validElements.value.map(ve => ({
    id: ve.id,
    name: ve.display,
    image: ve.element?.attributes?.image,
    stats: ve.element?.attributes?.stats,
    description: ve.element?.attributes?.description,
  }));
});
```

### Fill a selection when user clicks

```typescript
async function handleCardClick(cardId: number) {
  if (!isCardSelectable(cardId)) return;
  await actionController.fill(currentSelection.value!.name, cardId);
}
```

## Why Use `validElements` Instead of `getValidElements()`?

The `getValidElements()` method reads from an internal Map which Vue can't track reactively. If you use it in a computed:

```typescript
// BAD - Not reactive! Will show empty until something else triggers re-render
const items = computed(() => {
  const sel = currentSelection.value;
  return actionController.getValidElements(sel);  // May be empty!
});
```

The `validElements` computed is designed to be reactive:

```typescript
// GOOD - Reactive! Updates automatically when choices load
const items = computed(() => {
  return validElements.value;  // Always current
});
```

## When `element` Might Be Undefined

The `element` property is optional because the element might not exist in the current game view:

- **Timing**: Element was removed after selection metadata was built
- **Visibility**: Element is hidden from this player's view
- **State change**: A capture/discard happened between server and client updates

When this happens, a console warning is logged (once per element):
```
[actionController] Element 43 (Sarge) not found in gameView.
This can happen if the element was removed after selection metadata was built.
```

## When You Still Need `findElementById`

The `findElementById` utility is still available for cases outside the action flow:

```typescript
import { findElementById } from '@boardsmith/ui';

// Finding container elements for animations
const deck = findElementById(gameView, deckId);

// Finding related elements not in a selection
const parentContainer = findElementById(gameView, parentId);
```

## Type Imports

```typescript
import type {
  UseActionControllerReturn,
  ValidElement,
  SelectionMetadata,
  GameViewElement  // Alias for GameElement
} from '@boardsmith/ui';
```
