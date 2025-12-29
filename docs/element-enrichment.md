# Automatic Element Enrichment

When using element selections (`fromElements`), the `actionController` automatically enriches `validElements` with full element data from the game view. This is the "pit of success" pattern - designers get everything they need without extra work.

## How It Works

When you access `currentSelection.validElements`, each item automatically includes the full game element:

```typescript
interface ValidElement {
  id: number;                    // Element ID (for submitting selection)
  display?: string;              // Display text for UI
  ref?: { id: number };          // Reference for board highlighting
  element?: GameElement;         // ✨ Full element with all attributes!
}
```

The enrichment happens automatically inside `actionController`. It looks up each element ID in the current `gameView` and attaches the full element data.

## Usage

```typescript
const { currentSelection } = props.actionController;

// Access full element data directly - no lookup needed!
function renderEquipmentChoices() {
  const selection = currentSelection.value;
  if (!selection?.validElements) return [];

  return selection.validElements.map(ve => ({
    id: ve.id,
    name: ve.display,
    // Full element data is right here:
    image: ve.element?.attributes?.image,
    description: ve.element?.attributes?.description,
    equipmentId: ve.element?.attributes?.equipmentId,
    stats: ve.element?.attributes?.stats,
  }));
}
```

## Before vs After

**Before (manual lookup required):**
```typescript
import { findElementById } from '@boardsmith/ui';

// Had to manually look up each element
const fullElements = selection.validElements.map(ve =>
  findElementById(props.gameView, ve.id)
);
```

**After (automatic):**
```typescript
// Just use it directly!
selection.validElements.forEach(ve => {
  console.log(ve.element?.attributes?.image);
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

This warning helps with debugging but won't spam the console on repeated access.

## When You Still Need `findElementById`

The `findElementById` utility is still available for cases outside the action flow:

```typescript
import { findElementById } from '@boardsmith/ui';

// Finding container elements for animations
const deck = findElementById(gameView, deckId);

// Finding related elements
const parentContainer = findElementById(gameView, parentId);

// Custom lookups outside of action selections
const specificElement = findElementById(gameView, someId);
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

## Technical Details

### Reactivity

The enrichment is reactive - when `gameView` changes, `currentSelection` recomputes and elements are re-enriched with the latest data.

### Performance

- Element lookup uses depth-first tree traversal: O(n) per element where n = gameView tree size
- Vue's computed caching prevents redundant lookups when dependencies haven't changed
- Typical game trees (< 100 elements) have negligible lookup time

### Implementation

The enrichment happens in `useActionController`:

```typescript
function enrichValidElements(sel: SelectionMetadata): SelectionMetadata {
  if (!sel.validElements || !gameView?.value) return sel;

  const enrichedElements = sel.validElements.map(ve => ({
    ...ve,
    element: findElementById(gameView.value, ve.id),
  }));

  return { ...sel, validElements: enrichedElements };
}
```

This is called automatically when `currentSelection` is accessed, so custom UIs never need to think about it.
