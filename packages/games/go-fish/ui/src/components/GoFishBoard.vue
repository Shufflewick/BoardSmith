<script setup lang="ts">
import { computed, inject } from 'vue';
import type { BoardInteraction } from '@boardsmith/ui';

interface Card {
  id: number;
  rank: string;
  suit: string;
}

interface Hand {
  id: number;
  className: string;
  children?: Card[];
  childCount?: number;
}

interface GameElement {
  id: number;
  className?: string;
  name?: string;
  notation?: string;
  attributes?: Record<string, any>;
  children?: GameElement[];
  childCount?: number;
}

const props = defineProps<{
  gameView: GameElement | null | undefined;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  action: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  actionArgs: Record<string, unknown>;
  executeAction: (name: string) => Promise<void>;
  setBoardPrompt: (prompt: string | null) => void;
}>();

// Inject board interaction from GameShell
const boardInteraction = inject<BoardInteraction>('boardInteraction');

// Get player's hand
const myHand = computed(() => {
  if (!props.gameView?.children) return null;
  return props.gameView.children.find((child: GameElement) =>
    child.attributes?.$type === 'hand' &&
    child.attributes?.player?.position === props.playerPosition
  );
});

// Get opponent's hand
const opponentHand = computed(() => {
  if (!props.gameView?.children) return null;
  return props.gameView.children.find((child: GameElement) =>
    child.attributes?.$type === 'hand' &&
    child.attributes?.player?.position !== props.playerPosition
  );
});

// Get pond (draw pile)
const pond = computed(() => {
  if (!props.gameView?.children) return null;
  return props.gameView.children.find((child: GameElement) =>
    child.attributes?.$type === 'deck'
  );
});

// Get discard pile (books)
const books = computed(() => {
  if (!props.gameView?.children) return null;
  return props.gameView.children.filter((child: GameElement) =>
    child.className === 'Book'
  );
});

// Get my books
const myBooks = computed(() => {
  return books.value?.filter(book =>
    book.attributes?.player?.position === props.playerPosition
  ) || [];
});

// Get opponent's books
const opponentBooks = computed(() => {
  return books.value?.filter(book =>
    book.attributes?.player?.position !== props.playerPosition
  ) || [];
});

// Get card count
function getCardCount(hand: GameElement | null | undefined): number {
  if (!hand) return 0;
  // Use childCount if children are hidden, otherwise use children.length
  return hand.childCount ?? hand.children?.length ?? 0;
}

// Get pond count
const pondCount = computed(() => getCardCount(pond.value));

// Get rank name
function getRankName(rank: string): string {
  const names: Record<string, string> = {
    'A': 'Ace',
    'J': 'Jack',
    'Q': 'Queen',
    'K': 'King'
  };
  return names[rank] ?? rank;
}

// Get suit symbol
function getSuitSymbol(suit: string): string {
  const symbols: Record<string, string> = {
    'H': '♥',
    'D': '♦',
    'C': '♣',
    'S': '♠'
  };
  return symbols[suit] ?? suit;
}

// Get suit color
function getSuitColor(suit: string): string {
  return (suit === 'H' || suit === 'D') ? '#e74c3c' : '#2c3e50';
}

// Group cards by rank
function getCardsByRank(hand: GameElement | null | undefined): Map<string, Card[]> {
  const byRank = new Map<string, Card[]>();
  if (!hand?.children) return byRank;

  for (const card of hand.children) {
    const rank = card.attributes?.rank || '';
    if (!byRank.has(rank)) {
      byRank.set(rank, []);
    }
    byRank.get(rank)!.push({
      id: card.id,
      rank,
      suit: card.attributes?.suit || ''
    });
  }

  return byRank;
}

const myCardsByRank = computed(() => getCardsByRank(myHand.value));

// Get opponent position
const opponentPosition = computed(() => {
  return props.playerPosition === 0 ? 1 : 0;
});

// Get opponent name
const opponentName = computed(() => {
  return 'Bot'; // Default for now - will get from actual player data
});

// Check if opponent's hand is selectable (board interaction tells us)
const isOpponentHandSelectable = computed(() => {
  if (!boardInteraction || !opponentHand.value) return false;
  return boardInteraction.isSelectableElement({ id: opponentHand.value.id });
});

// Check if we're selecting a target player
const isSelectingPlayer = computed(() => {
  return props.isMyTurn && props.availableActions.includes('ask') && isOpponentHandSelectable.value;
});

// Check if my cards are selectable for rank selection
const isSelectingRank = computed(() => {
  if (!props.isMyTurn || !props.availableActions.includes('ask')) return false;

  // Check if any of my cards are selectable
  if (!boardInteraction || !myHand.value?.children) return false;

  // If any card in my hand is selectable, we're selecting rank
  return myHand.value.children.some((card: GameElement) =>
    boardInteraction.isSelectableElement({ id: card.id })
  );
});

// Handle clicking opponent's hand to select them
async function handleOpponentClick(event: MouseEvent) {
  if (!isSelectingPlayer.value || !opponentHand.value) {
    return;
  }

  // Use board interaction to trigger selection (this will notify ActionPanel)
  if (boardInteraction) {
    boardInteraction.triggerElementSelect({ id: opponentHand.value.id });
  }
}

// Handle clicking a card in my hand to select its rank
async function handleCardClick(rank: string) {
  if (!isSelectingRank.value || !myHand.value) {
    return;
  }

  // Find a card of this rank to get its ID
  const card = myHand.value.children?.find((c: GameElement) => c.attributes?.rank === rank);

  // Use board interaction to trigger selection (this will notify ActionPanel)
  if (boardInteraction && card) {
    boardInteraction.triggerElementSelect({ id: card.id });
  }
}
</script>

<template>
  <div class="go-fish-board">
    <!-- Player Section (at top) -->
    <div class="player-section">
      <div class="player-label">Your Hand</div>

      <!-- My Books -->
      <div v-if="myBooks.length > 0" class="books-area">
        <div v-for="book in myBooks" :key="book.id" class="book">
          <div class="book-rank">{{ getRankName(book.attributes?.rank || '') }}</div>
          <div class="book-cards">
            <div v-for="i in 4" :key="i" class="mini-card"></div>
          </div>
        </div>
      </div>

      <!-- My Hand -->
      <div class="hand my-hand">
        <div
          v-for="[rank, cards] of myCardsByRank"
          :key="rank"
          class="card-group"
          :class="{ 'selectable': isSelectingRank, 'selected': props.actionArgs.rank === rank }"
          @click="handleCardClick(rank)"
        >
          <div v-for="card in cards" :key="card.id" class="card card-front">
            <div class="card-corner top-left" :style="{ color: getSuitColor(card.suit) }">
              <div class="corner-rank">{{ card.rank }}</div>
              <div class="corner-suit">{{ getSuitSymbol(card.suit) }}</div>
            </div>
            <div class="card-center" :style="{ color: getSuitColor(card.suit) }">
              {{ getSuitSymbol(card.suit) }}
            </div>
            <div class="card-corner bottom-right" :style="{ color: getSuitColor(card.suit) }">
              <div class="corner-rank">{{ card.rank }}</div>
              <div class="corner-suit">{{ getSuitSymbol(card.suit) }}</div>
            </div>
          </div>
        </div>
        <div v-if="myCardsByRank.size === 0" class="empty-hand">No cards</div>
      </div>
    </div>

    <!-- Opponent Section -->
    <div class="opponent-section">
      <div class="player-label">{{ opponentName }}'s Hand</div>

      <!-- Opponent's Books -->
      <div v-if="opponentBooks.length > 0" class="books-area">
        <div v-for="book in opponentBooks" :key="book.id" class="book">
          <div class="book-rank">{{ getRankName(book.attributes?.rank || '') }}</div>
          <div class="book-cards">
            <div v-for="i in 4" :key="i" class="mini-card"></div>
          </div>
        </div>
      </div>

      <!-- Opponent's Hand -->
      <div
        class="hand opponent-hand"
        :class="{ 'selectable': isSelectingPlayer, 'selected': props.actionArgs.target === opponentPosition }"
        :data-element-id="opponentHand?.id"
        @click="handleOpponentClick"
      >
        <div v-for="i in getCardCount(opponentHand)" :key="i" class="card card-back">
          <div class="card-pattern"></div>
        </div>
        <div v-if="getCardCount(opponentHand) === 0" class="empty-hand">No cards</div>
      </div>
    </div>

    <!-- Pond Section (at bottom) -->
    <div class="pond-section">
      <div class="deck-container">
        <div class="deck-label">Pond</div>
        <div class="deck">
          <div v-if="pondCount > 0" class="card card-back deck-card">
            <div class="card-pattern"></div>
            <div class="deck-count">{{ pondCount }}</div>
          </div>
          <div v-else class="empty-deck">Empty</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.go-fish-board {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px;
  background: linear-gradient(135deg, #1a472a 0%, #2d5a3d 100%);
  border-radius: 12px;
  min-height: 600px;
  box-shadow: inset 0 0 50px rgba(0, 0, 0, 0.3);
}

.opponent-section,
.player-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player-label {
  font-size: 1.1rem;
  font-weight: bold;
  color: #ffd700;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

.books-area {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 60px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.book {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  background: rgba(255, 215, 0, 0.2);
  border: 2px solid #ffd700;
  border-radius: 8px;
  gap: 4px;
}

.book-rank {
  font-weight: bold;
  color: #ffd700;
  font-size: 0.9rem;
}

.book-cards {
  display: flex;
  gap: 2px;
}

.mini-card {
  width: 8px;
  height: 12px;
  background: #fff;
  border-radius: 2px;
  border: 1px solid #ccc;
}

.hand {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  min-height: 140px;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.hand.selectable {
  cursor: pointer;
  border: 2px solid rgba(0, 255, 136, 0.6);
  background: rgba(0, 255, 136, 0.1);
  animation: pulse-selectable 2s ease-in-out infinite;
}

.hand.selectable:hover {
  border-color: rgba(0, 255, 136, 1);
  background: rgba(0, 255, 136, 0.2);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 255, 136, 0.3);
}

.hand.selected {
  border: 2px solid rgba(0, 255, 136, 1);
  background: rgba(0, 255, 136, 0.3);
}

@keyframes pulse-selectable {
  0%, 100% {
    border-color: rgba(0, 255, 136, 0.6);
  }
  50% {
    border-color: rgba(0, 255, 136, 1);
  }
}

.opponent-hand {
  justify-content: center;
}

.my-hand {
  justify-content: flex-start;
}

.card-group {
  display: flex;
  gap: -20px;
  position: relative;
  transition: all 0.2s ease;
  border-radius: 8px;
  padding: 4px;
  margin: -4px;
}

.card-group.selectable {
  cursor: pointer;
}

.card-group.selectable:hover {
  background: rgba(0, 255, 136, 0.2);
  transform: translateY(-8px);
}

.card-group.selected {
  background: rgba(0, 255, 136, 0.3);
  box-shadow: 0 0 12px rgba(0, 255, 136, 0.5);
}

.card-group .card {
  margin-right: -30px;
}

.card-group .card:last-child {
  margin-right: 0;
}

.card {
  width: 70px;
  height: 100px;
  border-radius: 8px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: transform 0.2s;
}

.card:hover {
  transform: translateY(-8px);
  z-index: 10;
}

.card-back {
  background: linear-gradient(135deg, #c41e3a 0%, #8b0000 100%);
  border: 2px solid #fff;
}

.card-pattern {
  width: 100%;
  height: 100%;
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 5px,
    rgba(255, 255, 255, 0.1) 5px,
    rgba(255, 255, 255, 0.1) 10px
  );
  border-radius: 6px;
}

.card-front {
  background: #fff;
  border: 2px solid #333;
  position: relative;
}

.card-corner {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: bold;
  line-height: 1;
}

.card-corner.top-left {
  top: 4px;
  left: 4px;
}

.card-corner.bottom-right {
  bottom: 4px;
  right: 4px;
  transform: rotate(180deg);
}

.corner-rank {
  font-size: 0.9rem;
  font-weight: bold;
}

.corner-suit {
  font-size: 0.9rem;
  margin-top: -2px;
}

.card-center {
  font-size: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.empty-hand {
  color: #888;
  font-style: italic;
  padding: 20px;
}

.pond-section {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px 0;
}

.deck-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.deck-label {
  font-size: 0.9rem;
  color: #ccc;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.deck {
  position: relative;
}

.deck-card {
  width: 80px;
  height: 110px;
}

.deck-count {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  padding: 4px 12px;
  border-radius: 20px;
  font-weight: bold;
  font-size: 1.1rem;
}

.empty-deck {
  width: 80px;
  height: 110px;
  border: 2px dashed #666;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-style: italic;
}
</style>
