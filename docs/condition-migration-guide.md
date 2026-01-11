# Condition Migration Guide

This guide helps you migrate from function-based conditions to the new object-based format.

## Why Migrate?

Object-based conditions provide **automatic debug tracing**. When an action isn't available, the debug panel shows exactly which condition(s) failed:

```
Action 'attack' unavailable:
  ✓ has action points (passed)
  ✗ target in range (FAILED)
  ✓ weapon equipped (passed)
```

Function-based conditions just show "condition failed" with no detail.

## The Change

### Before (Function Format)

```typescript
Action.create('attack')
  .condition((ctx) => ctx.player.actionPoints > 0)
  .execute(...)
```

### After (Object Format)

```typescript
Action.create('attack')
  .condition({
    'has action points': (ctx) => ctx.player.actionPoints > 0,
  })
  .execute(...)
```

The key in the object (`'has action points'`) becomes the label shown in debug output.

## Migration Patterns

### Simple Conditions

**Before:**
```typescript
.condition((ctx) => ctx.game.deck.count(Card) > 0)
```

**After:**
```typescript
.condition({
  'deck has cards': (ctx) => ctx.game.deck.count(Card) > 0,
})
```

### Compound Conditions (&&)

Split into separate labeled predicates for granular debug output.

**Before:**
```typescript
.condition((ctx) => {
  return ctx.game.phase === 'play' && ctx.player.hand.count(Card) > 0;
})
```

**After:**
```typescript
.condition({
  'in play phase': (ctx) => ctx.game.phase === 'play',
  'has cards in hand': (ctx) => ctx.player.hand.count(Card) > 0,
})
```

Now if the action fails, you'll see exactly which part failed.

### Multiple Independent Checks

**Before:**
```typescript
.condition((ctx) => {
  const player = ctx.player as MyPlayer;
  return player.canAfford({ gold: 5 }) &&
         player.hasSkill('crafting') &&
         ctx.game.workshop.isEmpty();
})
```

**After:**
```typescript
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

## Real Examples

### Go Fish: Player Can Take Action

**Before:**
```typescript
.condition((ctx) => game.canTakeAction(ctx.player as GoFishPlayer))
```

**After:**
```typescript
.condition({
  'player can take action': (ctx) => game.canTakeAction(ctx.player as GoFishPlayer),
})
```

### Cribbage: Phase Check with Hand Cards

**Before:**
```typescript
.condition((ctx) =>
  game.phase === 'discarding' && game.getPlayerHand(ctx.player).count(Card) > 4
)
```

**After:**
```typescript
.condition({
  'in discarding phase': (ctx) => game.phase === 'discarding',
  'has cards to discard': (ctx) => game.getPlayerHand(ctx.player).count(Card) > 4,
})
```

### Checkers: Multi-Jump Logic

**Before:**
```typescript
.condition((ctx) => {
  const currentPiece = game.multiJumpPiece;
  if (currentPiece) {
    return game.getJumpMoves(currentPiece).length === 0;
  }
  return true;
})
```

**After:**
```typescript
.condition({
  'no more jumps available': (ctx) => {
    const currentPiece = game.multiJumpPiece;
    if (currentPiece) {
      return game.getJumpMoves(currentPiece).length === 0;
    }
    return true;
  },
})
```

## What Labels Should Say

Labels should describe **WHY** the condition exists, not **WHAT** it checks.

| Good Label | Bad Label |
|------------|-----------|
| `'player can afford cost'` | `'gold >= 10'` |
| `'in play phase'` | `'phase === play'` |
| `'has cards to discard'` | `'hand.count > 0'` |
| `'target in range'` | `'distance <= 3'` |
| `'is player turn'` | `'currentPlayer === player'` |

Good labels read like natural English and explain intent.

## Backward Compatibility

- **Function format still works** - no breaking changes
- Function conditions produce no automatic trace (just "condition failed")
- You can migrate incrementally, one action at a time
- Both formats can coexist in the same codebase

## Quick Reference

| Pattern | Before | After |
|---------|--------|-------|
| Simple | `.condition((ctx) => bool)` | `.condition({ 'label': (ctx) => bool })` |
| Compound (&&) | `.condition((ctx) => a && b)` | `.condition({ 'a': ..., 'b': ... })` |
| Complex logic | Keep in single function | Keep in single function with label |

## See Also

- [Actions & Flow](./actions-and-flow.md#conditions) - Full condition documentation
- [Common Patterns](./common-patterns.md) - Pattern examples using object conditions
