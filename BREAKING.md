# Breaking Changes

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
