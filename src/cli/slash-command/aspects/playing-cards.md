# Playing Cards Aspect

**Documentation:** Read `docs/core-concepts.md` (Deck, Hand, Card sections) and `docs/ui-components.md` (useCardDisplay) before using this template.

## Element Setup (game.ts)

```typescript
import { Game, type GameOptions } from 'boardsmith';
import { Card, Hand, DrawPile, MyPlayer } from './elements.js';

export class MyGame extends Game<MyGame, MyPlayer> {
  deck!: DrawPile;

  constructor(options: MyGameOptions) {
    super(options);

    this.registerElements([Card, Hand, DrawPile]);

    // Create deck with standard 52 cards
    this.deck = this.create(DrawPile, 'deck');
    this.deck.contentsHidden();

    const suits = ['H', 'D', 'C', 'S'] as const;
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

    for (const suit of suits) {
      for (const rank of ranks) {
        this.deck.create(Card, `${rank}${suit}`, { suit, rank });
      }
    }

    this.deck.shuffle();

    // Create player hands and deal
    for (const player of this.players) {
      player.hand = this.create(Hand, `hand-${player.seat}`);
      player.hand.player = player;
      player.hand.contentsVisibleToOwner();
    }

    // Deal 5 cards to each player
    for (let i = 0; i < 5; i++) {
      for (const player of this.players) {
        const card = this.deck.first(Card);
        if (card) card.putInto(player.hand);
      }
    }
  }
}
```

## Elements (elements.ts)

```typescript
import { Card as BaseCard, Hand as BaseHand, Deck, Player } from 'boardsmith';
import type { MyGame } from './game.js';

export class Card extends BaseCard<MyGame, MyPlayer> {
  suit!: 'H' | 'D' | 'C' | 'S';
  rank!: string;

  get value(): number {
    const values: Record<string, number> = { 'A': 1, 'J': 11, 'Q': 12, 'K': 13 };
    return values[this.rank] ?? parseInt(this.rank);
  }
}

export class Hand extends BaseHand<MyGame, MyPlayer> {}

export class DrawPile extends Deck<MyGame, MyPlayer> {}

export class MyPlayer extends Player {
  hand!: Hand;
  score: number = 0;
}
```

## Action Patterns (actions.ts)

```typescript
import { Action, type ActionDefinition } from 'boardsmith';
import { Card } from './elements.js';
import type { MyGame } from './game.js';

// Draw a card
export function createDrawAction(game: MyGame): ActionDefinition {
  return Action.create('draw')
    .prompt('Draw a card')
    .execute((args, ctx) => {
      const currentGame = ctx.game as MyGame;
      const card = currentGame.deck.first(Card);
      if (!card) {
        return { success: false, message: 'Deck is empty' };
      }
      card.putInto(ctx.player.hand);
      currentGame.message(`${ctx.player.name} drew a card`);
      return { success: true };
    });
}

// Play a card from hand
export function createPlayAction(game: MyGame): ActionDefinition {
  return Action.create('play')
    .prompt('Play a card')
    .chooseElement<Card>('card', {
      prompt: 'Select a card to play',
      from: (ctx) => ctx.player.hand.all(Card),
    })
    .execute((args, ctx) => {
      const currentGame = ctx.game as MyGame;
      const cardArg = args.card as { id: number };
      const card = currentGame.all(Card).find(c => c.id === cardArg.id);
      if (!card) return { success: false };

      card.remove();
      currentGame.message(`${ctx.player.name} played ${card.rank}${card.suit}`);
      return { success: true };
    });
}
```

## Custom UI Component (GameTable.vue)

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { findElements, getSuitSymbol, getSuitColor, type UseActionControllerReturn } from 'boardsmith/ui';

const props = defineProps<{
  gameView: any;
  playerSeat: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionController: UseActionControllerReturn;
}>();

// Find my hand - search for Hand element owned by this player
const myHand = computed(() => {
  if (!props.gameView) return [];
  const hands = findElements(props.gameView, { className: 'Hand' });
  const myHandElement = hands.find(h => h.attributes?.player?.seat === props.playerSeat);
  return myHandElement?.children ?? [];
});

// Find deck for card count display
const deck = computed(() => {
  if (!props.gameView) return null;
  const decks = findElements(props.gameView, { className: 'DrawPile' });
  return decks[0] ?? null;
});

const deckCount = computed(() => deck.value?.children?.length ?? 0);

// Game over detection
const isGameOver = computed(() => props.gameView?.isFinished ?? false);

// Action availability
const canDraw = computed(() => props.availableActions.includes('draw'));
const canPlay = computed(() => props.availableActions.includes('play'));

function handleDraw() {
  props.actionController.execute('draw', {});
}

function handlePlayCard(cardId: number) {
  // Use start() then fill() for chooseElement actions
  props.actionController.start('play');
  props.actionController.fill('card', cardId);
}
</script>

<template>
  <div class="game-board">
    <div v-if="isGameOver" class="game-over-panel">
      <h2>Game Over!</h2>
    </div>

    <template v-else>
      <!-- Deck area -->
      <div class="deck-area">
        <div class="deck-pile" @click="canDraw && isMyTurn && handleDraw()">
          <div class="card-back">
            <span class="deck-count">{{ deckCount }}</span>
          </div>
        </div>
        <button
          v-if="canDraw && isMyTurn"
          @click="handleDraw"
          class="action-button"
        >
          Draw Card
        </button>
      </div>

      <!-- My hand -->
      <div class="hand-area">
        <h3>Your Hand</h3>
        <div class="hand">
          <div
            v-for="card in myHand"
            :key="card.id"
            class="card"
            :class="{ playable: canPlay && isMyTurn }"
            :style="{ color: getSuitColor(card.attributes?.suit) }"
            @click="canPlay && isMyTurn && handlePlayCard(card.id)"
          >
            <span class="rank">{{ card.attributes?.rank }}</span>
            <span class="suit">{{ getSuitSymbol(card.attributes?.suit) }}</span>
          </div>
        </div>
      </div>

      <p v-if="!isMyTurn" class="waiting">Waiting for other player...</p>
    </template>
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  gap: 24px;
}

.deck-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.deck-pile {
  cursor: pointer;
}

.card-back {
  width: 60px;
  height: 84px;
  background: linear-gradient(135deg, #2c3e50, #34495e);
  border: 2px solid #1a252f;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.deck-count {
  background: rgba(255, 255, 255, 0.2);
  padding: 4px 8px;
  border-radius: 4px;
  color: white;
  font-weight: bold;
}

.hand-area {
  width: 100%;
  max-width: 600px;
}

.hand-area h3 {
  margin-bottom: 12px;
  color: #888;
}

.hand {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.card {
  width: 60px;
  height: 84px;
  background: white;
  border: 2px solid #ddd;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  transition: transform 0.2s, box-shadow 0.2s;
}

.card.playable {
  cursor: pointer;
  border-color: #00d9ff;
}

.card.playable:hover {
  transform: translateY(-12px);
  box-shadow: 0 8px 16px rgba(0, 217, 255, 0.3);
}

.rank {
  font-size: 1.4rem;
}

.suit {
  font-size: 1.2rem;
}

.action-button {
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
}

.waiting {
  color: #888;
}
</style>
```

## Key Rules

1. **Use `findElements()`** - Searches entire tree recursively to find nested elements.
2. **Use `getSuitSymbol()` and `getSuitColor()`** - From `boardsmith/ui` for card display.
3. **Visibility** - Use `contentsHidden()` for deck, `contentsVisibleToOwner()` for hands.
4. **Card movement** - Use `card.putInto(destination)` to move cards.
5. **chooseElement actions** - Use `start()` then `fill()` for user selections.
