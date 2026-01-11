# Condition Migration Guide

If you have existing code using function-based conditions, you'll see TypeScript errors after updating BoardSmith. This guide shows how to update to the object-based format.

## The Change

Function-based conditions no longer compile:

```typescript
// ❌ This no longer works
.condition((ctx) => ctx.player.hand.count() > 0)

// ✅ Use object format instead
.condition({
  'has cards in hand': (ctx) => ctx.player.hand.count() > 0,
})
```

The key in the object becomes a label shown in debug output when the condition fails.

## Migration Patterns

### Simple Conditions

```typescript
// Before
.condition((ctx) => ctx.game.deck.count(Card) > 0)

// After
.condition({
  'deck has cards': (ctx) => ctx.game.deck.count(Card) > 0,
})
```

### Compound Conditions (&&)

Split into separate labeled predicates for granular debug output:

```typescript
// Before
.condition((ctx) => {
  return ctx.game.phase === 'play' && ctx.player.hand.count(Card) > 0;
})

// After
.condition({
  'in play phase': (ctx) => ctx.game.phase === 'play',
  'has cards in hand': (ctx) => ctx.player.hand.count(Card) > 0,
})
```

Now if the action fails, you'll see exactly which part failed.

### Multiple Independent Checks

```typescript
// Before
.condition((ctx) => {
  const player = ctx.player as MyPlayer;
  return player.canAfford({ gold: 5 }) &&
         player.hasSkill('crafting') &&
         ctx.game.workshop.isEmpty();
})

// After
.condition({
  'can afford crafting cost': (ctx) => {
    const player = ctx.player as MyPlayer;
    return player.canAfford({ gold: 5 });
  },
  'has crafting skill': (ctx) => {
    const player = ctx.player as MyPlayer;
    return player.hasSkill('crafting');
  },
  'workshop is available': (ctx) => ctx.game.workshop.isEmpty(),
})
```

### Complex Logic (Keep Together)

For conditions with complex interdependent logic, keep them in a single predicate:

```typescript
.condition({
  'can continue multi-jump': (ctx) => {
    const piece = game.multiJumpPiece;
    if (!piece) return true;
    return game.getJumpMoves(piece).length === 0;
  },
})
```

## What Labels Should Say

Labels should describe **WHY** the condition exists, not **WHAT** it checks:

| Good Label | Bad Label |
|------------|-----------|
| `'player can afford cost'` | `'gold >= 10'` |
| `'in play phase'` | `'phase === play'` |
| `'has cards to discard'` | `'hand.count > 0'` |
| `'target in range'` | `'distance <= 3'` |

Good labels read like natural English and explain intent.

## Debug Output

The object format provides automatic debugging. When an action isn't available, the debug panel shows:

```
Action 'attack' unavailable:
  ✓ has action points (passed)
  ✗ target in range (FAILED)
  ✓ weapon equipped (passed)
```

This makes it easy to understand why actions are unavailable during development.

## See Also

- [Conditions API](./conditions.md) - Full API reference
- [Actions & Flow](./actions-and-flow.md#conditions) - Conditions in context
