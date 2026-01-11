# Conditions

Conditions control when actions are available to players. They use labeled predicates that provide automatic debug tracing.

## Basic Usage

```typescript
Action.create('draw')
  .condition({
    'deck has cards': (ctx) => game.deck.count(Card) > 0,
  })
  .execute(...)
```

The key (`'deck has cards'`) is a human-readable label. When this condition fails, the debug panel shows:

```
Action 'draw' unavailable:
  ✗ deck has cards (FAILED)
```

## Multiple Conditions

All conditions must pass for the action to be available:

```typescript
Action.create('purchase')
  .condition({
    'player can afford cost': (ctx) => ctx.player.gold >= 10,
    'item is available': (ctx) => game.shop.count(Item) > 0,
    'shop is open': (ctx) => game.phase === 'shopping',
  })
  .execute(...)
```

Debug output shows each condition's result:

```
Action 'purchase' unavailable:
  ✓ player can afford cost (passed)
  ✗ item is available (FAILED)
  ✓ shop is open (passed)
```

## Writing Good Labels

Labels should describe **WHY** the condition exists, not **WHAT** it checks:

| Good Label | Bad Label |
|------------|-----------|
| `'player can afford cost'` | `'gold >= 10'` |
| `'in play phase'` | `'phase === play'` |
| `'has cards to discard'` | `'hand.count > 0'` |
| `'target in range'` | `'distance <= 3'` |
| `'is player turn'` | `'currentPlayer === player'` |

Good labels read like natural English and explain intent.

## Complex Conditions

For conditions with complex logic, keep the predicate function readable:

```typescript
.condition({
  'can continue multi-jump': (ctx) => {
    const piece = game.multiJumpPiece;
    if (!piece) return true;  // No multi-jump in progress
    return game.getJumpMoves(piece).length === 0;
  },
})
```

## Examples

### Phase Check

```typescript
.condition({
  'in discarding phase': (ctx) => game.phase === 'discarding',
  'has cards to discard': (ctx) => game.getPlayerHand(ctx.player).count(Card) > 4,
})
```

### Resource Check

```typescript
.condition({
  'can afford building cost': (ctx) => {
    const player = ctx.player as MyPlayer;
    return player.canAfford({ wood: 5, gold: 2 });
  },
})
```

### Game State Check

```typescript
.condition({
  'player can take action': (ctx) => game.canTakeAction(ctx.player as MyPlayer),
})
```

## See Also

- [Actions & Flow](./actions-and-flow.md#conditions) - Conditions in context
- [Common Patterns](./common-patterns.md) - More condition examples
