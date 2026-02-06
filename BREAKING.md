# Breaking Changes

## v2.8 (2026-02-06)

This release adds disabled selections support, allowing items to be visible but unselectable in action choices.

### Summary

- **BREAKING:** `getChoices()` return type changed from `T[]` to `AnnotatedChoice<T>[]`
- **BREAKING:** `game.getSelectionChoices()` return type changed from `unknown[]` to `AnnotatedChoice<unknown>[]`
- **Additive:** UI `getChoices()`/`getCurrentChoices()` return type gains `disabled?: string` field
- **Additive:** New `disabled` callback option on `chooseElement()`, `fromElements()`, and `chooseFrom()`

---

### getChoices() Return Type Change (BREAKING)

The engine-level `getChoices()` (on ActionExecutor) previously returned `T[]` and now returns `AnnotatedChoice<T>[]` where each item has `{ value: T, disabled: string | false }`.

Additionally, `game.getSelectionChoices()` (the public Game method) changed from `unknown[]` to `AnnotatedChoice<unknown>[]`.

**Before:**
```typescript
const choices = game.getSelectionChoices('attack', 'target', player);
// choices: unknown[] -- values directly
for (const choice of choices) {
  console.log(choice); // the value itself
}
```

**After:**
```typescript
import { AnnotatedChoice } from 'boardsmith/engine';

const choices = game.getSelectionChoices('attack', 'target', player);
// choices: AnnotatedChoice<unknown>[] -- annotated with disabled status
for (const choice of choices) {
  console.log(choice.value);     // the actual value
  console.log(choice.disabled);  // string reason or false
}
```

**Migration:**

| Before | After |
|--------|-------|
| `choices[i]` | `choices[i].value` |
| `choices.includes(x)` | `choices.some(c => c.value === x)` |
| `choices.map(c => ...)` | `choices.map(c => { /* use c.value */ })` |

---

### UI getChoices()/getCurrentChoices() Return Type Change (ADDITIVE)

The `actionController.getChoices()` and `actionController.getCurrentChoices()` return type changed from `Array<{ value: unknown; display: string }>` to `Array<{ value: unknown; display: string; disabled?: string }>`. This is additive -- existing code still works, but callers should be aware of the new field.

The `disabled` field is only present on items that are disabled. It contains the reason string explaining why the item cannot be selected. Selectable items do not have the field at all (sparse representation for clean JSON).

---

### New disabled Option on Builder Methods (ADDITIVE)

`chooseElement()`, `fromElements()`, and `chooseFrom()` now accept a `disabled` callback option:

```typescript
disabled?: (item: T, context: ActionContext) => string | false
```

Returns `false` if selectable, or a reason string if disabled. No bare `true` is allowed -- the framework requires a reason string to enforce good UX.

**Example:**
```typescript
action('equip')
  .fromElements('equipment', {
    elements: (ctx) => ctx.game.all(Equipment),
    disabled: (equip, ctx) =>
      equip.isExplosive ? "Cannot use explosives" : false,
  })
```

**filter vs disabled:** `filter` controls visibility (what's in the pool), `disabled` controls selectability (what can be selected within the pool). `disabled` only runs on items that passed `filter`.

See the [Custom UI Guide](docs/custom-ui-guide.md) for updated `getChoices()` usage examples.

---

## v2.7 (2026-02-02)

This release includes cleanup of deprecated APIs and consolidation of type definitions.

### Summary

- Removed deprecated flying element APIs (`flyCard`, `flyCards`, `FlyCardOptions`)
- Removed vestigial `src/ai/utils.ts` re-export file
- Consolidated lobby types to single canonical source (`types/protocol.ts`)

---

### Removed Flying Element APIs

The deprecated card-specific flying element APIs have been removed. Use the element-agnostic equivalents.

**Removed APIs:**
- `flyCard()` - removed from `useFlyingElements`
- `flyCards()` - removed from `useFlyingElements`
- `FlyCardOptions` interface - removed from `useFlyingElements` and `ui` exports

**Migration:**

| Before | After |
|--------|-------|
| `flyCard(options)` | `fly(config)` |
| `flyCards(options)` | `flyMultiple(configs)` |
| `FlyCardOptions` | `FlyConfig` |

**Property renames in config object:**

| Before | After |
|--------|-------|
| `cardData` | `elementData` |
| `cardSize` | `elementSize` |

**Before:**
```typescript
import { useFlyingElements, FlyCardOptions } from 'boardsmith/ui';

const { flyCard, flyCards } = useFlyingElements();

// Single element
flyCard({
  cardData: myCard,
  cardSize: { width: 100, height: 140 },
  from: sourceRef.value,
  to: targetRef.value,
});

// Multiple elements
flyCards({
  cards: [card1, card2, card3],
  cardSize: { width: 100, height: 140 },
  from: deckRef.value,
  to: handRef.value,
  stagger: 50,
});
```

**After:**
```typescript
import { useFlyingElements, FlyConfig } from 'boardsmith/ui';

const { fly, flyMultiple } = useFlyingElements();

// Single element
fly({
  elementData: myCard,
  elementSize: { width: 100, height: 140 },
  from: sourceRef.value,
  to: targetRef.value,
});

// Multiple elements
flyMultiple([
  { elementData: card1, elementSize: { width: 100, height: 140 }, from: deckRef.value, to: handRef.value },
  { elementData: card2, elementSize: { width: 100, height: 140 }, from: deckRef.value, to: handRef.value },
  { elementData: card3, elementSize: { width: 100, height: 140 }, from: deckRef.value, to: handRef.value },
], { stagger: 50 });
```

---

### Removed Re-export File

The vestigial `src/ai/utils.ts` file has been deleted. It only re-exported `SeededRandom` from its canonical location.

**Before:**
```typescript
import { SeededRandom } from 'boardsmith/ai/utils';
```

**After:**
```typescript
import { SeededRandom } from 'boardsmith/utils/random';
```

---

### Type Consolidation

Lobby types are now defined in a single canonical location: `types/protocol.ts`.

**Consolidated types:**
- `LobbyState`
- `SlotStatus`
- `LobbySlot`
- `LobbyInfo`

**For backwards compatibility**, these types are still re-exported from:
- `session/types`
- `client/types`

**Recommendation:** For new code, import directly from the canonical source:

```typescript
// Recommended
import { LobbyState, LobbySlot, LobbyInfo, SlotStatus } from 'boardsmith/types/protocol';

// Still works (re-export)
import { LobbyState } from 'boardsmith/session/types';
import { LobbyState } from 'boardsmith/client/types';
```

This consolidation ensures all modules have access to the complete type definitions and prevents type drift between modules.
