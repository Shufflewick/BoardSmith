# Common Game Patterns

This guide shows reusable patterns that appear across many board games. Use these as starting points for your implementation.

---

## 1. Dealer Rotation

Many card games rotate who deals each round.

### Pattern

```typescript
class MyGame extends Game<MyGame, MyPlayer> {
  dealerPosition: number = 1;  // 1-indexed: player 1 starts as dealer

  /**
   * Get the current dealer
   */
  get dealer(): MyPlayer {
    return this.players.get(this.dealerPosition) as MyPlayer;
  }

  /**
   * Get the player to the dealer's left (usually plays first)
   */
  get playerAfterDealer(): MyPlayer {
    return this.players.nextAfter(this.dealer) as MyPlayer;
  }

  /**
   * Rotate dealer to the next player
   */
  rotateDealer(): void {
    const nextDealer = this.players.nextAfter(this.dealer);
    this.dealerPosition = nextDealer.seat;
  }
}
```

### In Flow

```typescript
export function createGameFlow(game: MyGame): FlowDefinition {
  return {
    root: loop({
      while: () => !game.isFinished(),
      do: sequence(
        // Deal from current dealer
        execute(() => game.deal()),

        // Play round starting from player after dealer
        eachPlayer({
          startingPlayer: () => game.playerAfterDealer,
          do: actionStep({ actions: ['play'] }),
        }),

        // Rotate dealer for next round
        execute(() => game.rotateDealer()),
      ),
    }),
    // ...
  };
}
```

---

## 2. Simultaneous Actions

All players act at the same time (e.g., revealing cards, placing bids).

### Pattern

```typescript
// In flow
simultaneousActionStep({
  name: 'discard-phase',
  actions: ['discard'],
  prompt: 'Discard 2 cards to the crib',

  // Optional: custom completion check per player
  playerDone: (ctx, player) => {
    const p = player as MyPlayer;
    return p.discarded.count(Card) >= 2;
  },

  // Optional: when all players are done
  allDone: (ctx) => {
    return ctx.game.players.every(p => p.discarded.count(Card) >= 2);
  },
})
```

### Manual Tracking Alternative

For more control, track completion manually:

```typescript
class MyGame extends Game<MyGame, MyPlayer> {
  private completedPlayers: Set<number> = new Set();

  playerCompletedAction(player: MyPlayer): void {
    this.completedPlayers.add(player.seat);
  }

  allPlayersCompleted(): boolean {
    return this.completedPlayers.size === this.players.length;
  }

  resetCompletedPlayers(): void {
    this.completedPlayers.clear();
  }
}
```

---

## 3. Multi-Turn Same Player (Go Again)

Player continues their turn under certain conditions.

### Pattern: Using Game State

The simplest pattern is to use a game-level property:

```typescript
class MyGame extends Game<MyGame, MyPlayer> {
  playerGoesAgain: boolean = false;
}

export function createGameFlow(game: MyGame): FlowDefinition {
  return {
    root: loop({
      while: () => !game.isFinished(),
      do: eachPlayer({
        do: loop({
          name: 'player-turn',
          while: () => game.playerGoesAgain,
          do: sequence(
            // Reset go-again flag
            execute(() => { game.playerGoesAgain = false; }),

            // Player takes action
            actionStep({ actions: ['play'] }),

            // Action can set playerGoesAgain = true to continue
          ),
        }),
      }),
    }),
  };
}

// In action execute:
.execute((args, ctx) => {
  // ... action logic ...

  if (shouldGoAgain) {
    ctx.game.playerGoesAgain = true;
  }

  return { success: true };
});
```

### Alternative: Methods Pattern

For more encapsulation, use methods:

```typescript
class MyGame extends Game<MyGame, MyPlayer> {
  private _playerGoesAgain: boolean = false;

  setPlayerGoesAgain(value: boolean): void {
    this._playerGoesAgain = value;
  }

  shouldPlayerGoAgain(): boolean {
    return this._playerGoesAgain;
  }

  resetPlayerGoesAgain(): void {
    this._playerGoesAgain = false;
  }
}

// In flow
loop({
  while: () => game.shouldPlayerGoAgain(),
  do: sequence(
    execute(() => game.resetPlayerGoesAgain()),
    actionStep({ actions: ['play'] }),
  ),
})
```

---

## 4. Multi-Step Move (e.g., Checkers Captures)

A single turn consists of multiple moves.

### Pattern

```typescript
// In flow - allow multiple captures in one turn
loop({
  name: 'capture-chain',
  while: (ctx) => {
    const piece = ctx.get<Piece>('movingPiece');
    return piece && game.canCapture(piece);
  },
  do: actionStep({
    name: 'continue-capture',
    actions: ['capture'],
  }),
})

// Track the moving piece
.execute((args, ctx) => {
  const piece = args.piece as Piece;

  // First move or continuing?
  if (!ctx.get('movingPiece')) {
    ctx.set('movingPiece', piece);
  }

  // Perform capture
  game.performCapture(piece, args.target);

  // If piece can't capture anymore, clear tracking
  if (!game.canCapture(piece)) {
    ctx.set('movingPiece', null);
  }

  return { success: true };
});
```

---

## 5. Hidden Information

Managing what each player can see.

### Hand Cards (Visible to Owner Only)

```typescript
class MyPlayer extends Player {
  hand!: Hand;
}

class MyGame extends Game<MyGame, MyPlayer> {
  constructor(options: GameOptions) {
    super(options);

    for (const player of this.players) {
      player.hand = this.create(Hand, `hand-${player.seat}`);
      player.hand.player = player;
      player.hand.contentsVisibleToOwner();
    }
  }
}
```

### Deck (Hidden Until Drawn)

```typescript
this.deck = this.create(Deck, 'deck');
this.deck.contentsHidden();  // No one sees cards in deck
```

### Revealing Cards

```typescript
// Reveal a single card to all players
card.showToAll();

// Reveal to specific players
card.showOnlyTo(player);      // Only this player can see
card.addVisibleTo(player);    // Add player to visibility list

// Hide again (e.g., after showing)
card.hideFromAll();

// Set visibility mode
card.setVisibility('all');     // Everyone sees
card.setVisibility('owner');   // Only owner sees
card.setVisibility('hidden');  // No one sees
```

---

## 6. Piece Promotion

Pieces that change type (e.g., pawns to queens, checkers to kings).

### Pattern: State Property

```typescript
class CheckerPiece extends Piece {
  isKing: boolean = false;

  /**
   * Promote this piece to a king
   */
  promote(): void {
    this.isKing = true;
    // Optionally update visual
    this.$image = this.player?.color === 'black'
      ? '/pieces/black-king.svg'
      : '/pieces/white-king.svg';
  }

  /**
   * Check if this piece can move backward
   */
  canMoveBackward(): boolean {
    return this.isKing;
  }

  /**
   * Get valid move directions
   */
  getMoveDirections(): Array<{ row: number; col: number }> {
    const forward = this.player?.seat === 1 ? -1 : 1;  // Player 1 moves "up"

    if (this.isKing) {
      return [
        { row: forward, col: -1 },
        { row: forward, col: 1 },
        { row: -forward, col: -1 },
        { row: -forward, col: 1 },
      ];
    }

    return [
      { row: forward, col: -1 },
      { row: forward, col: 1 },
    ];
  }
}
```

### Check for Promotion in Move Action

```typescript
.execute((args, ctx) => {
  const piece = args.piece as CheckerPiece;
  const destination = args.destination as Cell;

  // Move the piece
  piece.putInto(destination);

  // Check for promotion (player 1 promotes at row 0, player 2 at row 7)
  const promotionRow = piece.player?.seat === 1 ? 0 : 7;
  if (destination.row === promotionRow && !piece.isKing) {
    piece.promote();
    game.message(`${piece} was crowned king!`);
  }

  return { success: true };
});
```

---

## 7. Turn-Based Combat

Resolving combat between game pieces.

### Pattern

```typescript
interface CombatResult {
  attacker: Piece;
  defender: Piece;
  attackerDamage: number;
  defenderDamage: number;
  attackerDestroyed: boolean;
  defenderDestroyed: boolean;
}

class MyGame extends Game<MyGame, MyPlayer> {
  /**
   * Resolve combat between two pieces
   */
  resolveCombat(attacker: Piece, defender: Piece): CombatResult {
    // Roll dice or use stats
    const attackRoll = this.random.d6();
    const defendRoll = this.random.d6();

    const attackerPower = (attacker.attack ?? 0) + attackRoll;
    const defenderPower = (defender.defense ?? 0) + defendRoll;

    const result: CombatResult = {
      attacker,
      defender,
      attackerDamage: 0,
      defenderDamage: 0,
      attackerDestroyed: false,
      defenderDestroyed: false,
    };

    if (attackerPower > defenderPower) {
      // Attacker wins
      result.defenderDamage = attackerPower - defenderPower;
      defender.health -= result.defenderDamage;
      result.defenderDestroyed = defender.health <= 0;
    } else if (defenderPower > attackerPower) {
      // Defender wins
      result.attackerDamage = defenderPower - attackerPower;
      attacker.health -= result.attackerDamage;
      result.attackerDestroyed = attacker.health <= 0;
    }
    // Tie: no damage

    // Remove destroyed pieces
    if (result.attackerDestroyed) attacker.remove();
    if (result.defenderDestroyed) defender.remove();

    return result;
  }
}
```

---

## 8. Resource/Economy System

Managing player resources.

### Pattern

```typescript
class MyPlayer extends Player {
  gold: number = 0;
  wood: number = 0;
  food: number = 0;

  /**
   * Check if player can afford a cost
   */
  canAfford(cost: { gold?: number; wood?: number; food?: number }): boolean {
    if (cost.gold && this.gold < cost.gold) return false;
    if (cost.wood && this.wood < cost.wood) return false;
    if (cost.food && this.food < cost.food) return false;
    return true;
  }

  /**
   * Pay a cost (throws if can't afford)
   */
  pay(cost: { gold?: number; wood?: number; food?: number }): void {
    if (!this.canAfford(cost)) {
      throw new Error('Cannot afford this cost');
    }
    this.gold -= cost.gold ?? 0;
    this.wood -= cost.wood ?? 0;
    this.food -= cost.food ?? 0;
  }

  /**
   * Gain resources
   */
  gain(resources: { gold?: number; wood?: number; food?: number }): void {
    this.gold += resources.gold ?? 0;
    this.wood += resources.wood ?? 0;
    this.food += resources.food ?? 0;
  }
}
```

### In Actions

```typescript
Action.create('build')
  .condition({
    'can afford building cost': (ctx) => {
      const player = ctx.player as MyPlayer;
      return player.canAfford({ wood: 5, gold: 2 });
    },
  })
  .execute((args, ctx) => {
    const player = ctx.player as MyPlayer;
    player.pay({ wood: 5, gold: 2 });

    // Create building...

    return { success: true };
  });
```

---

## 9. Area Control / Majority

Determining who controls a zone based on unit count.

### Pattern

```typescript
class Zone extends Space {
  /**
   * Get the player(s) with the most units in this zone
   */
  getControllers(): Player[] {
    const counts = new Map<Player, number>();

    for (const unit of this.all(Unit)) {
      if (unit.player) {
        counts.set(unit.player, (counts.get(unit.player) ?? 0) + 1);
      }
    }

    if (counts.size === 0) return [];

    const maxCount = Math.max(...counts.values());
    const controllers: Player[] = [];

    for (const [player, count] of counts) {
      if (count === maxCount) {
        controllers.push(player);
      }
    }

    return controllers;
  }

  /**
   * Get the single controller, or null if contested/empty
   */
  getController(): Player | null {
    const controllers = this.getControllers();
    return controllers.length === 1 ? controllers[0] : null;
  }

  /**
   * Check if a player controls this zone
   */
  isControlledBy(player: Player): boolean {
    const controller = this.getController();
    return controller?.seat === player.seat;
  }
}
```

---

## 10. Victory Point Scoring

Tracking and calculating victory points.

### Pattern

```typescript
interface ScoreBreakdown {
  cards: number;
  territories: number;
  bonuses: number;
  total: number;
}

class MyPlayer extends Player {
  /**
   * Calculate this player's score
   */
  calculateScore(game: MyGame): ScoreBreakdown {
    const cardPoints = this.hand.sum((card) => card.pointValue);

    const territoryPoints = game.zones
      .filter(z => z.isControlledBy(this))
      .reduce((sum, z) => sum + z.pointValue, 0);

    const bonusPoints = this.calculateBonuses(game);

    return {
      cards: cardPoints,
      territories: territoryPoints,
      bonuses: bonusPoints,
      total: cardPoints + territoryPoints + bonusPoints,
    };
  }

  private calculateBonuses(game: MyGame): number {
    let bonus = 0;

    // Longest road bonus
    if (game.hasLongestRoad(this)) {
      bonus += 5;
    }

    // Most cards bonus
    if (game.hasMostCards(this)) {
      bonus += 3;
    }

    return bonus;
  }
}

class MyGame extends Game<MyGame, MyPlayer> {
  override getWinners(): MyPlayer[] {
    const scores = this.players.map(p => ({
      player: p,
      score: p.calculateScore(this),
    }));

    const maxScore = Math.max(...scores.map(s => s.score.total));

    return scores
      .filter(s => s.score.total === maxScore)
      .map(s => s.player);
  }
}
```

---

## 13. Multi-Phase Actions (Action Chaining)

Many complex game actions need to show updated state between phases. Use `followUp` to chain actions together seamlessly.

### Pattern: Explore and Collect

```typescript
// First action: performs exploration and draws items
Action.create('explore')
  .chooseElement('unit', { elementClass: Unit })
  .execute((args, ctx) => {
    const unit = args.unit as Unit;
    const location = unit.location;

    // Draw items to location
    for (let i = 0; i < location.lootCount; i++) {
      const item = ctx.game.drawItem();
      if (item) item.putInto(location.itemsZone);
    }
    location.explored = true;

    // Chain to collect - UI will show drawn items
    return {
      success: true,
      followUp: location.itemsZone.count() > 0
        ? { action: 'collect', args: { unitId: unit.id, locationId: location.id } }
        : undefined,
    };
  });

// Second action: picks from drawn items
Action.create('collect')
  .fromElements<Item>('item', {
    elements: (ctx) => {
      const location = ctx.game.getElementById(ctx.args.locationId);
      return [...location.itemsZone.all(Item)];
    },
    optional: 'Done',
  })
  .execute((args, ctx) => {
    if (args.item) {
      const unit = ctx.game.getElementById(ctx.args.unitId);
      (args.item as Item).putInto(unit.inventoryZone);
    }
    return { success: true };
  });
```

### Key Benefits

1. **State visibility**: UI updates between explore and collect
2. **Context preserved**: unitId and locationId flow automatically
3. **Seamless UX**: feels like one action to the player
4. **Conditional**: only chains if there are items to collect

### When to Use

- After combat: resolve abilities, loot defeated enemies
- After exploration: collect discovered items
- After card play: trigger effects that require choices
- After movement: interact with new location

See [Action Chaining](./actions-and-flow.md#action-chaining-with-followup) for complete documentation.

---

## See Also

- [Common Pitfalls](./common-pitfalls.md) - Mistakes to avoid
- [Actions & Flow](./actions-and-flow.md) - Action and flow details
- [Game Examples](./game-examples.md) - Complete game implementations
