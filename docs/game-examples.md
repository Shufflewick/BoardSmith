# Game Examples & Patterns

This document analyzes the example games in `packages/games/` to demonstrate common patterns and best practices.

## Example Games Overview

| Game | Location | Complexity | Key Patterns |
|------|----------|-----------|--------------|
| Hex | `packages/games/hex/` | Simple | Hex grid, path-finding, simple flow |
| Go Fish | `packages/games/go-fish/` | Medium | Cards, hidden info, conditional turns |
| Checkers | `packages/games/checkers/` | Medium | Square grid, multi-step actions, piece promotion |
| Cribbage | `packages/games/cribbage/` | Complex | Multi-phase, simultaneous actions, complex scoring |

---

## Hex - Simplest Example

**Location**: `packages/games/hex/`

Hex is the simplest example, demonstrating core patterns with minimal complexity.

### Key Features
- Hex grid board
- Simple alternating turns
- Path-finding win condition
- Single action type

### Game Structure

```typescript
// game.ts
export class HexGame extends Game<HexGame, HexPlayer> {
  board!: Board;
  winner?: HexPlayer;

  constructor(options: HexOptions) {
    super(options);

    // Register elements
    this.registerElements([Board, Cell, Stone]);

    // Create hex board
    this.board = this.create(Board, 'board', { boardSize: 7 });
    for (let r = 0; r < 7; r++) {
      for (let q = 0; q < 7; q++) {
        this.board.create(Cell, `cell-${q}-${r}`, { q, r });
      }
    }

    // Single action
    this.registerAction(createPlaceStoneAction(this));
    this.setFlow(createHexFlow(this));
  }
}
```

### Simple Flow

```typescript
// flow.ts
export function createHexFlow(game: HexGame): FlowDefinition {
  return {
    root: loop({
      name: 'game-loop',
      while: () => !game.isFinished(),
      do: eachPlayer({
        do: actionStep({
          actions: ['placeStone'],
          skipIf: () => game.isFinished(),
        }),
      }),
    }),
    isComplete: () => game.isFinished(),
    getWinners: () => game.winner ? [game.winner] : [],
  };
}
```

### Element with Board Reference

```typescript
// actions.ts
Action.create('placeStone')
  .chooseElement<Cell>('cell', {
    filter: (cell) => cell.isEmpty(),
    boardRef: (cell) => ({
      id: cell.id,
      notation: cell.notation,
    }),
  })
  .execute((args, ctx) => {
    const cell = args.cell as Cell;
    cell.create(Stone, `stone-${player.position}`, { player });

    // Check win condition
    if (game.board.checkWin(player)) {
      game.setWinner(player);
    }
  });
```

### Pattern: Custom Element Classes

```typescript
// elements.ts
export class Cell extends HexCell {
  q!: number;
  r!: number;

  get notation(): string {
    return `${String.fromCharCode(97 + this.q)}${this.r + 1}`;
  }

  isEmpty(): boolean {
    return this.count(Stone) === 0;
  }
}
```

---

## Go Fish - Card Game Patterns

**Location**: `packages/games/go-fish/`

Go Fish demonstrates card game patterns including hidden information and conditional turns.

### Key Features
- Standard deck creation
- Private hands with visibility
- Player interaction (asking)
- Conditional turns (go again if match)
- Book collection

### Hidden Information

```typescript
// game.ts
constructor(options) {
  // Create player hands - hidden from other players
  for (const player of this.players) {
    const hand = this.create(Hand, `hand-${player.position}`);
    hand.player = player;
    hand.contentsVisibleToOwner();  // Only owner sees their cards
  }

  // The pond (draw pile) - hidden
  this.pond = this.create(Pond, 'pond');
  this.pond.contentsHidden();
}
```

### Conditional Turns (Extra Turn Logic)

```typescript
// flow.ts - Turn loop with extra turns
const playerTurn = sequence(
  setVar('extraTurn', false),
  setVar('turnEnded', false),

  loop({
    name: 'turn-loop',
    while: (ctx) => {
      if (ctx.get('turnEnded')) return false;
      // ... other conditions
      return true;
    },
    do: sequence(
      actionStep({ actions: ['ask'] }),
      execute((ctx) => {
        const extraTurn = ctx.lastActionResult?.data?.extraTurn;
        if (!extraTurn) {
          ctx.set('turnEnded', true);
        }
      }),
    ),
  }),
);
```

### Action with Extra Turn Signal

```typescript
// actions.ts
.execute((args, ctx) => {
  const matchingCards = target.hand.all(Card).filter(c => c.rank === rank);

  if (matchingCards.length > 0) {
    for (const card of matchingCards) {
      card.putInto(player.hand);
    }
    // Signal extra turn
    return { success: true, data: { extraTurn: true } };
  } else {
    game.drawFromPond(player);
    return { success: true, data: { extraTurn: false } };
  }
});
```

### Pattern: Book/Set Collection

```typescript
// game.ts
checkForBooks(player: GoFishPlayer): void {
  const hand = this.getPlayerHand(player);
  const cards = hand.all(Card);

  // Count cards by rank
  const rankCounts = new Map<string, Card[]>();
  for (const card of cards) {
    const existing = rankCounts.get(card.rank) || [];
    existing.push(card);
    rankCounts.set(card.rank, existing);
  }

  // Create books for complete sets
  for (const [rank, rankCards] of rankCounts) {
    if (rankCards.length === 4) {
      const book = this.books.create(Book, `book-${rank}`, { rank, player });
      for (const card of rankCards) {
        card.putInto(book);
      }
      player.score++;
    }
  }
}
```

---

## Checkers - Grid & Multi-Step Actions

**Location**: `packages/games/checkers/`

Checkers demonstrates square grids, forced moves, and multi-step actions.

### Key Features
- 8x8 square grid
- Jump chains (multi-step moves)
- Forced jump rule
- Piece promotion (kings)

### Grid Setup

```typescript
// game.ts
constructor(options) {
  this.board = this.create(Board, 'board');
  this.board.contentsVisible();

  // Create 8x8 grid
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cell = this.board.create(Cell, `cell-${col}-${row}`, {
        col, row,
        isPlayable: (row + col) % 2 === 1,  // Dark squares only
      });
    }
  }

  // Place initial pieces
  this.setupInitialPieces();
}
```

### Multi-Step Action (Jump Chain)

```typescript
// actions.ts - Handling jump chains
Action.create('move')
  .chooseElement<Piece>('piece', {
    filter: (piece, ctx) => {
      const game = ctx.game as CheckersGame;
      // If there's a pending jump, only that piece can continue
      if (game.pendingJumpPiece) {
        return piece === game.pendingJumpPiece;
      }
      return piece.player === ctx.player && game.hasValidMoves(piece);
    },
  })
  .chooseElement<Cell>('destination', {
    filter: (cell, ctx) => {
      const piece = ctx.args.piece as Piece;
      return game.isValidMove(piece, cell);
    },
  })
  .execute((args, ctx) => {
    const piece = args.piece as Piece;
    const dest = args.destination as Cell;

    const isJump = game.isJumpMove(piece, dest);
    piece.putInto(dest);

    if (isJump) {
      game.captureJumpedPiece(piece, dest);

      // Check for additional jumps
      if (game.canContinueJumping(piece)) {
        game.pendingJumpPiece = piece;
        game.setPlayerGoesAgain(true);
      } else {
        game.pendingJumpPiece = null;
      }
    }

    // Check for promotion
    if (game.shouldPromote(piece)) {
      piece.isKing = true;
    }
  });
```

### Forced Move Logic

```typescript
// game.ts
getValidMoves(player: CheckersPlayer): Move[] {
  const pieces = this.board.all(Piece).filter(p => p.player === player);

  // Check for forced jumps
  const jumpMoves = [];
  for (const piece of pieces) {
    jumpMoves.push(...this.getJumpMoves(piece));
  }

  // If jumps available, must take one
  if (jumpMoves.length > 0) {
    return jumpMoves;
  }

  // Otherwise, regular moves
  return pieces.flatMap(p => this.getRegularMoves(p));
}
```

---

## Cribbage - Complex Multi-Phase Game

**Location**: `packages/games/cribbage/`

Cribbage is the most complex example, demonstrating multi-phase flow, simultaneous actions, and complex scoring.

### Key Features
- Multi-phase rounds (deal, discard, play, show)
- Simultaneous actions (both players discard at once)
- Complex scoring logic
- Running count during play
- "Go" mechanics

### Multi-Phase Flow

```typescript
// flow.ts
const playRound = sequence(
  // Initialize round
  execute((ctx) => game.startNewRound()),

  // Discard phase - simultaneous
  phase('discarding', {
    do: simultaneousActionStep({
      actions: ['discard'],
      prompt: 'Discard 2 cards to the crib',
      playerDone: (ctx, player) => {
        const hand = game.getPlayerHand(player);
        return hand.count(Card) <= 4;  // Done when 4 cards left
      },
      allDone: (ctx) => game.allPlayersDiscarded(),
    }),
  }),

  // Store hands before play
  execute(() => game.storeOriginalHands()),

  // Cut starter
  execute(() => game.cutStarterCard()),

  // Play phase - alternating turns
  phase('play', { do: playPhaseSequence }),

  // Scoring phase
  phase('scoring', {
    do: sequence(
      execute(() => game.scoreRoundAndBuildSummary()),
      simultaneousActionStep({
        actions: ['acknowledgeScore'],
        allDone: () => !game.roundSummary.active,
      }),
    ),
  }),

  // Rotate dealer
  execute(() => game.rotateDealer()),
);
```

### Simultaneous Actions

```typescript
// Both players discard at the same time
simultaneousActionStep({
  name: 'simultaneous-discard',
  actions: ['discard'],
  prompt: 'Discard 2 cards to the crib',
  playerDone: (ctx, player) => {
    const hand = game.getPlayerHand(player as CribbagePlayer);
    return hand.count(Card) <= 4;
  },
  allDone: (ctx) => {
    return game.allPlayersDiscarded() || game.isFinished();
  },
});
```

### Phase Lifecycle Hooks

```typescript
// flow.ts
return {
  root: /* ... */,
  isComplete: /* ... */,
  getWinners: /* ... */,

  // Phase lifecycle hooks
  onEnterPhase: (phaseName, ctx) => {
    const game = ctx.game as CribbageGame;
    game.cribbagePhase = phaseName;

    const phaseNames = {
      discarding: 'DISCARD PHASE',
      play: 'PLAY PHASE',
      scoring: 'SCORING PHASE',
    };
    game.message(`=== ${phaseNames[phaseName]} ===`);
  },
};
```

### Complex Play Phase with Go

```typescript
// Play phase loop with "Go" mechanics
loop({
  name: 'play-loop',
  while: () => !game.allCardsPlayed() && !game.isFinished(),
  do: sequence(
    // Check if count needs reset
    execute(() => {
      const currentStuck = currentSaidGo || !currentCanPlay;
      const otherStuck = otherSaidGo || !otherCanPlay;

      if (currentStuck && otherStuck && (hasCards)) {
        // Award "Go" point
        if (game.runningTotal < 31) {
          game.addPoints(lastPlayer, 1, 'Go');
        }
        game.resetCount();
      }
    }),

    // Player plays or says Go
    actionStep({
      player: () => game.getCurrentPlayPlayer(),
      actions: ['playCard', 'sayGo'],
      skipIf: () => playerAlreadySaidGo || !hasCards,
    }),

    // Switch turns
    execute(() => {
      if (!otherSaidGo && otherHasCards) {
        game.switchPlayTurn();
      }
    }),
  ),
});
```

### Scoring System

```typescript
// scoring.ts - Complex scoring calculation
export function scoreHand(cards: Card[], starter: Card, isCrib: boolean): ScoreBreakdown {
  const allFive = [...cards, starter];
  const breakdown: ScoreBreakdown = { fifteens: 0, pairs: 0, runs: 0, flush: 0, nobs: 0 };

  // Score 15s (combinations summing to 15)
  breakdown.fifteens = scoreFifteens(allFive);

  // Score pairs
  breakdown.pairs = scorePairs(allFive);

  // Score runs (sequences)
  breakdown.runs = scoreRuns(allFive);

  // Score flush (requires 4 in hand, or 5 total for crib)
  breakdown.flush = scoreFlush(cards, starter, isCrib);

  // Score nobs (Jack of starter suit)
  breakdown.nobs = scoreNobs(cards, starter);

  return breakdown;
}
```

---

## Common Patterns Summary

### 1. Game Initialization

```typescript
constructor(options) {
  super(options);
  this.registerElements([...]);  // Always register elements
  // Create board/deck
  // Register actions
  this.setFlow(createGameFlow(this));
}
```

### 2. Custom Player Classes

```typescript
export class MyPlayer extends Player<MyGame, MyPlayer> {
  hand!: Hand;
  score: number = 0;
  abilities: Record<string, number> = {};

  constructor(position: number, name: string, game: MyGame) {
    super(position, name);
    this.game = game;
    this.hand = game.create(Hand, `hand-${position}`);
    this.hand.player = this;
  }

  // Required to send custom properties to the UI
  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      score: this.score,
      abilities: this.abilities,
    };
  }
}
```

> **Note**: Always override `toJSON()` if you have custom properties that the UI needs to display (scores, abilities, etc.). See [Core Concepts - Serialization](./core-concepts.md#playercollection-serialization-warning) for details.

### 3. Win Condition Checking

```typescript
override isFinished(): boolean {
  return this.winner !== undefined || /* other condition */;
}

override getWinners(): MyPlayer[] {
  if (!this.isFinished()) return [];
  return this.winner ? [this.winner] : [];
}
```

### 4. Action Result Data

```typescript
.execute((args, ctx) => {
  // ... game logic ...
  return {
    success: true,
    message: 'Action completed',
    data: {
      extraTurn: shouldGoAgain,  // Can be read by flow
      customData: 'anything',
    },
  };
});
```

### 5. Flow Variables

```typescript
sequence(
  setVar('roundNumber', 1),
  loop({
    while: (ctx) => ctx.get('roundNumber') <= 10,
    do: sequence(
      /* round logic */,
      execute((ctx) => ctx.set('roundNumber', ctx.get('roundNumber') + 1)),
    ),
  }),
)
```

### 6. Visibility Control

```typescript
// Hidden from everyone
deck.contentsHidden();

// Visible to everyone
board.contentsVisible();

// Only owner sees
hand.contentsVisibleToOwner();
```

## Related Documentation

- [Getting Started](./getting-started.md) - Create your first game
- [Core Concepts](./core-concepts.md) - Element tree, visibility, state
- [Actions & Flow](./actions-and-flow.md) - Action and flow API details
