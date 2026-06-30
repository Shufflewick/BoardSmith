# Phase 71: Deprecated API Removal - Research

**Researched:** 2026-02-01
**Domain:** UI composables - flying element animations
**Confidence:** HIGH

## Summary

This phase migrates three internal callers from deprecated `flyCard()`/`flyCards()`/`FlyCardOptions` APIs to the new `fly()`/`flyMultiple()`/`FlyConfig` APIs in `useFlyingElements`, then removes the deprecated APIs entirely.

The deprecated APIs use card-specific naming (`cardData`, `cardSize`) while the new APIs use generic element naming (`elementData`, `elementSize`) to support any flying element type (cards, pieces, tokens). The function signatures are nearly identical, making migration straightforward.

**Primary recommendation:** Migrate each file by replacing import types, updating method calls, and renaming parameters per the mapping below. After all migrations, remove deprecated exports from useFlyingElements and index.ts.

## Deprecated vs New APIs

### Current Deprecated APIs (to be removed)

```typescript
// Types
interface FlyCardOptions {
  id: string;
  startRect: DOMRect | HTMLElement;  // Note: no function support
  endRect: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null);
  cardData: FlyingCardData;
  flip?: boolean;
  duration?: number;
  zIndex?: number;
  cardSize?: { width: number; height: number };
  holdDuration?: number;
  onPositionComplete?: () => void;
  skipFadeOut?: boolean;
}

// Methods
flyCard(options: FlyCardOptions): Promise<void>
flyCards(options: FlyCardOptions[], staggerMs?: number): Promise<void>
```

### New APIs (migration targets)

```typescript
// Types
interface FlyConfig {
  id: string;
  startRect: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null);  // Function support added
  endRect: DOMRect | HTMLElement | (() => DOMRect | HTMLElement | null);
  elementData: FlyingCardData;  // Renamed from cardData
  flip?: boolean;
  duration?: number;
  zIndex?: number;
  elementSize?: { width: number; height: number };  // Renamed from cardSize
  holdDuration?: number;
  onPositionComplete?: () => void;
  skipFadeOut?: boolean;
}

// Methods
fly(config: FlyConfig): Promise<void>
flyMultiple(configs: FlyConfig[], staggerMs?: number): Promise<void>
```

### Parameter Mapping

| Deprecated | New | Notes |
|------------|-----|-------|
| `FlyCardOptions` | `FlyConfig` | Type import change |
| `cardData` | `elementData` | Property rename |
| `cardSize` | `elementSize` | Property rename |
| `flyCard()` | `fly()` | Method name change |
| `flyCards()` | `flyMultiple()` | Method name change |

## Current Usage Analysis

### File 1: usePlayerStatAnimation.ts

**Location:** `/Users/jtsmith/BoardSmith/src/ui/composables/usePlayerStatAnimation.ts`

**Current usage:**
```typescript
// Line 37: Import
import type { FlyCardOptions } from './useFlyingElements.js';

// Line 98: Function signature - accepts flyCards function parameter
export function flyToPlayerStat(
  flyCards: (options: FlyCardOptions[], staggerMs?: number) => Promise<void>,
  options: FlyToStatOptions
): boolean {
```

**Lines 127-148: Building FlyCardOptions array**
```typescript
flyCards(
  cards.map((card, i) => ({
    id: `fly-stat-${statName}-${playerSeat}-${Date.now()}-${i}`,
    startRect: card.rect,
    endRect: () => targetEl.getBoundingClientRect(),
    cardData: {  // <-- needs rename to elementData
      rank: card.rank || '',
      suit: card.suit || '',
      faceUp: card.faceUp ?? true,
      faceImage: card.faceImage,
      backImage: card.backImage,
      ...Object.fromEntries(/*...*/),
    },
    flip,
    duration,
    cardSize,  // <-- needs rename to elementSize
  })),
  stagger
);
```

**Migration required:**
1. Change import: `FlyCardOptions` -> `FlyConfig`
2. Update function signature type
3. Rename `cardData` -> `elementData`
4. Rename `cardSize` -> `elementSize`

**Special consideration:** This file exports a function `flyToPlayerStat` that accepts `flyCards` as a parameter. The signature needs to change to accept `flyMultiple` instead. This is a **breaking change for callers** - need to update callers to pass `flyMultiple` instead of `flyCards`.

### File 2: AutoGameBoard.vue

**Location:** `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/AutoGameBoard.vue`

**Current usage:**
```typescript
// Line 26: Import
import { useFlyingElements, type FlyCardOptions } from '../../composables/useFlyingElements.js';

// Line 143: Destructure
const { flyingElements: flyingCards, flyCard } = useFlyingElements();

// Lines 314-324: First call (cards going to hidden zones)
flyPromises.push(
  flyCard({
    id: `fly-${id}-${Date.now()}`,
    startRect: oldRect,
    endRect: () => targetElement.getBoundingClientRect(),
    cardData: { ...cardData, faceUp: true },
    flip: true,
    duration: 400,
  })
);

// Lines 353-364: Second call (cards appearing from hidden zones)
flyPromises.push(
  flyCard({
    id: `fly-appear-${id}-${Date.now()}`,
    startRect: sourceRect,
    endRect: () => cardElement.getBoundingClientRect(),
    cardData: { ...cardData, faceUp: false },
    flip: true,
    duration: 400,
    cardSize: { width: targetRect.width, height: targetRect.height },  // <-- rename
  })
);
```

**Migration required:**
1. Remove `type FlyCardOptions` from import
2. Change destructure: `flyCard` -> `fly`
3. Rename `cardData` -> `elementData` (2 occurrences)
4. Rename `cardSize` -> `elementSize` (1 occurrence)

### File 3: useActionAnimations.ts

**Location:** `/Users/jtsmith/BoardSmith/src/ui/composables/useActionAnimations.ts`

**Current usage:**
```typescript
// Line 108: Import
import { useFlyingElements, type FlyingCardData, type FlyingCard } from './useFlyingElements.js';

// Line 356: Destructure
const { flyingElements, flyCard, cancelAll } = useFlyingElements();

// Lines 511-539: Call with FlyCardOptions-compatible object
await flyCard({
  id: animationId,
  startRect,
  endRect: () => destinationElement!.getBoundingClientRect(),
  cardData: elementData,  // <-- rename to elementData (already named that locally!)
  duration: config.duration ?? 400,
  cardSize: config.elementSize,  // <-- rename to elementSize
  flip: shouldFlip,
  zIndex: config.zIndex ?? 1000,
  holdDuration: crossfadeDuration,
  skipFadeOut: shouldFlip,
  onPositionComplete: shouldHideDestination ? () => { /*...*/ } : undefined,
});
```

**Migration required:**
1. Change destructure: `flyCard` -> `fly`
2. Rename `cardData` -> `elementData` (the local variable is already named `elementData`, so this becomes `elementData: elementData` or just `elementData`)
3. Rename `cardSize` -> `elementSize`

## Public API Surface Impact

### src/ui/index.ts Exports

Currently exports (Line 96):
```typescript
export {
  useFlyingElements,
  type FlyConfig,
  type FlyOnAppearOptions,
  type FlyingCard,
  type FlyingCardData,
  type FlyCardOptions,  // <-- TO BE REMOVED
  type UseFlyingElementsOptions,
  type UseFlyingElementsReturn,
  // ...
} from './composables/useFlyingElements.js';
```

**After migration:** Remove `FlyCardOptions` from exports.

### Documentation Impact

`docs/ui-components.md` contains examples using `flyCards`:

```typescript
// Line 915: Example
const { flyCards } = useFlyingElements();
const { getPlayerStatElement } = usePlayerStatAnimation();

// Fly cards to a player's stat display
flyToPlayerStat(flyCards, {
  cards: removedCards.map(c => ({ rect: c.rect, rank: c.rank, suit: c.suit })),
  playerSeat: 0,
  statName: 'books',
});
```

**Documentation update needed:** Change `flyCards` to `flyMultiple` in example.

## Migration Order

**Recommended order:**

1. **usePlayerStatAnimation.ts** - Update function signature and internal usage
2. **AutoGameBoard.vue** - Straightforward method/property renames
3. **useActionAnimations.ts** - Straightforward method/property renames
4. **useFlyingElements.ts** - Remove deprecated methods and interface
5. **src/ui/index.ts** - Remove deprecated type export
6. **docs/ui-components.md** - Update documentation examples

## Code Examples

### Migration Pattern: usePlayerStatAnimation.ts

**Before:**
```typescript
import type { FlyCardOptions } from './useFlyingElements.js';

export function flyToPlayerStat(
  flyCards: (options: FlyCardOptions[], staggerMs?: number) => Promise<void>,
  options: FlyToStatOptions
): boolean {
  // ...
  flyCards(
    cards.map((card, i) => ({
      id: '...',
      startRect: card.rect,
      endRect: () => targetEl.getBoundingClientRect(),
      cardData: { rank: card.rank, suit: card.suit, faceUp: card.faceUp },
      flip,
      duration,
      cardSize,
    })),
    stagger
  );
}
```

**After:**
```typescript
import type { FlyConfig } from './useFlyingElements.js';

export function flyToPlayerStat(
  flyMultiple: (configs: FlyConfig[], staggerMs?: number) => Promise<void>,
  options: FlyToStatOptions
): boolean {
  // ...
  flyMultiple(
    cards.map((card, i) => ({
      id: '...',
      startRect: card.rect,
      endRect: () => targetEl.getBoundingClientRect(),
      elementData: { rank: card.rank, suit: card.suit, faceUp: card.faceUp },
      flip,
      duration,
      elementSize,
    })),
    stagger
  );
}
```

### Migration Pattern: Component Files

**Before:**
```typescript
import { useFlyingElements, type FlyCardOptions } from './useFlyingElements.js';
const { flyCard, flyingElements } = useFlyingElements();

await flyCard({
  id: 'animation-1',
  startRect: sourceRect,
  endRect: () => targetRef.getBoundingClientRect(),
  cardData: { rank: 'A', suit: 'S', faceUp: false },
  cardSize: { width: 60, height: 84 },
  flip: true,
});
```

**After:**
```typescript
import { useFlyingElements } from './useFlyingElements.js';
const { fly, flyingElements } = useFlyingElements();

await fly({
  id: 'animation-1',
  startRect: sourceRect,
  endRect: () => targetRef.getBoundingClientRect(),
  elementData: { rank: 'A', suit: 'S', faceUp: false },
  elementSize: { width: 60, height: 84 },
  flip: true,
});
```

## Common Pitfalls

### Pitfall 1: Forgetting to Update Callers of flyToPlayerStat

**What goes wrong:** After changing `flyToPlayerStat` signature to accept `flyMultiple`, existing callers passing `flyCards` will have type errors or runtime issues.

**How to avoid:** Search codebase for all usages of `flyToPlayerStat` and update them to pass `flyMultiple` instead of `flyCards`.

**Grep pattern:** `flyToPlayerStat\(`

### Pitfall 2: Missing Property Renames in Object Spreads

**What goes wrong:** When spreading options objects, the old property names (`cardData`, `cardSize`) may persist.

**How to avoid:** Carefully check each call site for spread operators and ensure all properties are renamed.

### Pitfall 3: Incomplete Type Export Removal

**What goes wrong:** Removing `FlyCardOptions` from internal files but forgetting to remove it from public exports in `index.ts`.

**How to avoid:** After removing from source, also update the export list in `src/ui/index.ts`.

## Risks and Edge Cases

### Risk 1: External Callers Using Deprecated APIs

**Risk level:** LOW - This is an internal library, and the deprecated APIs are marked `@deprecated`. However, there may be game UIs using these APIs directly.

**Mitigation:** The deprecation notices have been in place, and the migration is straightforward. Game developers can update their code using the same patterns documented here.

### Risk 2: Runtime vs Type-Only Breakage

**Risk level:** LOW - The new APIs are functionally equivalent. The only difference is naming. No behavioral changes.

**Verification:** All tests should continue to pass after migration since the underlying `flyCardInternal` function remains unchanged.

## Test Coverage

### Existing Tests

No direct unit tests found for `useFlyingElements` composable using grep patterns:
- `flyCard|flyCards|FlyCardOptions` in `*.test.ts` - No results
- `useFlyingElements` in `*.test.ts` - No results

**Implication:** Migration relies on:
1. TypeScript type checking to catch signature mismatches
2. Manual/integration testing of flying animations
3. Existing game tests that exercise these code paths

### Recommended Verification

After migration, manually verify:
1. AutoGameBoard flying animations (public -> private card transitions)
2. useActionAnimations flip-in-place animations
3. flyToPlayerStat animations (if any games use this)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flying animations | Custom animation code | `fly()`/`flyMultiple()` | Handles RAF loop, tracking moving targets, flip math, reduced motion |

## Sources

### Primary (HIGH confidence)
- `/Users/jtsmith/BoardSmith/src/ui/composables/useFlyingElements.ts` - Source of truth for API signatures
- `/Users/jtsmith/BoardSmith/src/ui/index.ts` - Public export surface
- `/Users/jtsmith/BoardSmith/src/ui/composables/usePlayerStatAnimation.ts` - Caller file
- `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/AutoGameBoard.vue` - Caller file
- `/Users/jtsmith/BoardSmith/src/ui/composables/useActionAnimations.ts` - Caller file

### Secondary (MEDIUM confidence)
- `/Users/jtsmith/BoardSmith/docs/ui-components.md` - Documentation examples

## Metadata

**Confidence breakdown:**
- API signatures: HIGH - Direct source code inspection
- Migration mapping: HIGH - Straightforward renames, verified in source
- External caller risk: MEDIUM - No comprehensive search of game packages

**Research date:** 2026-02-01
**Valid until:** No expiration - internal API removal, not dependent on external factors
