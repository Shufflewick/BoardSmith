<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import type { BoardInteraction } from '@boardsmith/ui';
import {
  findElement,
  findElements,
  findPlayerHand,
  findAllHands,
  getElementCount,
  useFlyingCards,
  FlyingCardsOverlay,
  prefersReducedMotion,
  flyToPlayerStat,
  getSuitSymbol,
  getSuitColor,
  getRankName,
  type GameElement,
} from '@boardsmith/ui';

interface CardImages {
  face?: string | { sprite: string; x: number; y: number; width?: number; height?: number };
  back?: string | { sprite: string; x: number; y: number; width?: number; height?: number };
}

interface Card {
  id: number;
  rank: string;
  suit: string;
  $images?: CardImages;
}

// Helper to get image URL from $images attribute
// For Go Fish, we use simple string URLs (individual image files)
// This also supports CSS sprite objects for future compatibility
function getCardImageUrl(images: CardImages | undefined, side: 'face' | 'back'): string | null {
  if (!images) return null;
  const image = images[side];
  if (!image) return null;

  if (typeof image === 'string') {
    return image;
  }

  // For CSS sprite objects, return the sprite URL
  // (The rendering component handles the positioning)
  return image.sprite || null;
}

interface Player {
  position: number;
  name: string;
}

const props = defineProps<{
  gameView: GameElement | null | undefined;
  players: Player[];
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

// Refs for animation sources/targets
const pondRef = ref<HTMLElement | null>(null);
const myHandRef = ref<HTMLElement | null>(null);
const opponentHandRefs = ref<Map<number, HTMLElement>>(new Map());

// Flying cards animation
const { flyingCards, flyCard, flyCards } = useFlyingCards();

// Track previous card IDs to detect new cards
const prevMyCardIds = ref<Set<number>>(new Set());
const prevOpponentCardCounts = ref<Map<number, number>>(new Map());

// Track for book formation animation
const prevMyBooksCount = ref(0);
const prevOpponentBooksCounts = ref<Map<number, number>>(new Map());
// Store card positions keyed by card ID (captured before state changes)
const cardPositions = ref<Map<number, { rect: DOMRect; rank: string; suit: string; faceImage?: string; backImage?: string }>>(new Map());

// Get all players from props
const allPlayers = computed(() => {
  return props.players || [];
});

// Get opponent players (everyone except me)
const opponents = computed(() => {
  return allPlayers.value.filter((p: any) => p.position !== props.playerPosition);
});

// Get player's hand using utility
const myHand = computed(() => findPlayerHand(props.gameView, props.playerPosition));

// Get all opponent hands as a map by player position
const opponentHands = computed(() => {
  const allHands = findAllHands(props.gameView);
  const handMap = new Map<number, GameElement>();
  for (const hand of allHands) {
    const pos = (hand.attributes as any)?.player?.position;
    if (pos !== undefined && pos !== props.playerPosition) {
      handMap.set(pos, hand);
    }
  }
  return handMap;
});

// Helper to set opponent hand ref
function setOpponentHandRef(position: number, el: HTMLElement | null) {
  if (el) {
    opponentHandRefs.value.set(position, el);
  } else {
    opponentHandRefs.value.delete(position);
  }
}

// Get pond (draw pile) using utility
const pond = computed(() => findElement(props.gameView, { type: 'deck' }));

// Get Books containers for all players
function getBooksContainer(playerPosition: number) {
  if (!props.gameView?.children) return null;
  return props.gameView.children.find((child: any) =>
    child.className === 'Books' &&
    child.attributes?.player?.position === playerPosition
  );
}

// Count books for a player (each book is 4 cards)
function getBooksCount(playerPosition: number): number {
  const container = getBooksContainer(playerPosition);
  return container ? Math.floor((container.children?.length || 0) / 4) : 0;
}

const myBooksCount = computed(() => getBooksCount(props.playerPosition));

// For display in custom UI - keep the old Book element lookup for now
const books = computed(() => findElements(props.gameView, { className: 'Book' }));

// Get my books for display
const myBooks = computed(() => {
  return books.value.filter(book =>
    (book.attributes as any)?.player?.position === props.playerPosition
  );
});

// Get books for a specific player
function getPlayerBooks(playerPosition: number) {
  return books.value.filter(book =>
    (book.attributes as any)?.player?.position === playerPosition
  );
}

// Get pond count using utility
const pondCount = computed(() => getElementCount(pond.value));

// Group cards by rank
function getCardsByRank(hand: GameElement | null | undefined): Map<string, Card[]> {
  const byRank = new Map<string, Card[]>();
  if (!hand?.children) return byRank;

  for (const card of hand.children) {
    const attrs = card.attributes as Record<string, any> | undefined;
    const rank = attrs?.rank || '';
    if (!byRank.has(rank)) {
      byRank.set(rank, []);
    }
    byRank.get(rank)!.push({
      id: card.id,
      rank,
      suit: attrs?.suit || '',
      $images: attrs?.$images,
    });
  }

  return byRank;
}

// Get back image URL from any card (they all use the same back)
const cardBackImageUrl = computed(() => {
  // Find any card with $images to get the back URL
  for (const cards of myCardsByRank.value.values()) {
    if (cards.length > 0 && cards[0].$images) {
      return getCardImageUrl(cards[0].$images, 'back');
    }
  }
  return null;
});

const myCardsByRank = computed(() => getCardsByRank(myHand.value));

// Get player name by position
function getPlayerName(position: number): string {
  const player = allPlayers.value.find((p: any) => p.position === position);
  return player?.name || `Player ${position + 1}`;
}

// Check if a specific opponent's hand is selectable
function isOpponentHandSelectable(position: number): boolean {
  if (!boardInteraction) return false;
  const hand = opponentHands.value.get(position);
  if (!hand) return false;
  return boardInteraction.isSelectableElement({ id: hand.id });
}

// Check if we're selecting a target player
const isSelectingPlayer = computed(() => {
  if (!props.isMyTurn || !props.availableActions.includes('ask')) return false;
  // Check if any opponent hand is selectable
  for (const pos of opponentHands.value.keys()) {
    if (isOpponentHandSelectable(pos)) return true;
  }
  return false;
});

// Check if my cards are selectable for rank selection
const isSelectingRank = computed(() => {
  if (!props.isMyTurn || !props.availableActions.includes('ask')) return false;

  // Check if any of my cards are selectable
  if (!boardInteraction || !myHand.value?.children) return false;

  // If any card in my hand is selectable, we're selecting rank
  return myHand.value.children.some((card) =>
    boardInteraction.isSelectableElement({ id: card.id })
  );
});

// Handle clicking an opponent's hand to select them
async function handleOpponentClick(position: number) {
  if (!isSelectingPlayer.value) return;

  const hand = opponentHands.value.get(position);
  if (!hand || !isOpponentHandSelectable(position)) return;

  // Use board interaction to trigger selection (this will notify ActionPanel)
  if (boardInteraction) {
    boardInteraction.triggerElementSelect({ id: hand.id });
  }
}

// Handle clicking a card in my hand to select its rank
async function handleCardClick(rank: string) {
  if (!isSelectingRank.value || !myHand.value) {
    return;
  }

  // Find a card of this rank to get its ID
  const card = myHand.value.children?.find((c) => (c.attributes as any)?.rank === rank);

  // Use board interaction to trigger selection (this will notify ActionPanel)
  if (boardInteraction && card) {
    boardInteraction.triggerElementSelect({ id: card.id });
  }
}

// Watch for new cards appearing in my hand and animate them flying in
watch(
  () => myHand.value?.children,
  (newChildren, oldChildren) => {
    if (prefersReducedMotion.value) return;
    if (!newChildren || !myHandRef.value) return;

    // Get current card IDs
    const currentIds = new Set(newChildren.map(c => c.id));

    // Find new cards (cards that weren't in previous state)
    const newCards = newChildren.filter(c => !prevMyCardIds.value.has(c.id));

    if (newCards.length > 0 && prevMyCardIds.value.size > 0) {
      // Determine source: check if any opponent lost cards
      let sourceRef: HTMLElement | null = pondRef.value;
      for (const [pos, hand] of opponentHands.value) {
        const prevCount = prevOpponentCardCounts.value.get(pos) || 0;
        const currentCount = getElementCount(hand);
        if (currentCount < prevCount) {
          sourceRef = opponentHandRefs.value.get(pos) || null;
          break;
        }
      }

      if (sourceRef) {
        const sourceRect = sourceRef.getBoundingClientRect();
        const isFromPond = sourceRef === pondRef.value;

        // Fly each new card from source to hand
        flyCards(
          newCards.map((card, i) => {
            const attrs = card.attributes as any;
            const images = attrs?.$images;
            return {
              id: `fly-${card.id}-${Date.now()}`,
              startRect: sourceRect,
              endRect: () => myHandRef.value?.getBoundingClientRect() ?? sourceRect,
              cardData: {
                rank: attrs?.rank || '',
                suit: attrs?.suit || '',
                faceUp: !isFromPond,
                faceImage: typeof images?.face === 'string' ? images.face : undefined,
                backImage: typeof images?.back === 'string' ? images.back : undefined,
              },
              flip: isFromPond,
              duration: 400,
              cardSize: { width: 70, height: 100 },
            };
          }),
          80
        );
      }
    }

    // Update tracking state
    prevMyCardIds.value = currentIds;
    for (const [pos, hand] of opponentHands.value) {
      prevOpponentCardCounts.value.set(pos, getElementCount(hand));
    }
  },
  { deep: true }
);

// Flag to track if we've initialized
const isInitialized = ref(false);

// Initialize tracking on first load ONLY
watch(
  () => props.gameView,
  () => {
    if (!isInitialized.value && props.gameView) {
      if (myHand.value?.children) {
        prevMyCardIds.value = new Set(myHand.value.children.map(c => c.id));
      }
      // Initialize opponent tracking
      for (const [pos, hand] of opponentHands.value) {
        prevOpponentCardCounts.value.set(pos, getElementCount(hand));
        prevOpponentBooksCounts.value.set(pos, getBooksCount(pos));
      }
      prevMyBooksCount.value = myBooksCount.value;
      isInitialized.value = true;
    }
  },
  { immediate: true }
);

// Capture card positions from DOM (call this before state changes)
// Uses data attributes on DOM elements so imagery is captured before state changes
function captureCardPositions() {
  if (!myHandRef.value) return;

  const cards = myHandRef.value.querySelectorAll('[data-element-id]');
  cards.forEach((el) => {
    const cardId = parseInt(el.getAttribute('data-element-id') || '0', 10);
    if (cardId) {
      // Read all data from DOM attributes (set in template)
      cardPositions.value.set(cardId, {
        rect: el.getBoundingClientRect(),
        rank: el.getAttribute('data-rank') || '',
        suit: el.getAttribute('data-suit') || '',
        faceImage: el.getAttribute('data-face-image') || undefined,
        backImage: el.getAttribute('data-back-image') || undefined,
      });
    }
  });
}

// Watch for book formation - detect when cards disappear AND books increase
// Use flush: 'sync' to run BEFORE other watchers update prevMyCardIds
watch(
  () => props.gameView,
  async (newGameView, oldGameView) => {
    // Skip if not initialized yet or reduced motion preferred
    if (!isInitialized.value || prefersReducedMotion.value) return;

    // IMMEDIATELY capture previous values before any other watcher updates them
    const snapshotPrevCardIds = new Set(prevMyCardIds.value);
    const snapshotPrevMyBooks = prevMyBooksCount.value;
    const snapshotPrevOpponentBooks = new Map(prevOpponentBooksCounts.value);

    // Capture card positions BEFORE Vue updates DOM (DOM still has old layout)
    captureCardPositions();

    // Wait a tick for Vue to update DOM and other watchers to run
    await new Promise(r => setTimeout(r, 10));

    // Check if books increased for me
    const currentMyBooks = myBooksCount.value;
    const currentIds = new Set(myHand.value?.children?.map(c => c.id) || []);

    // My books increased - find cards that disappeared
    if (currentMyBooks > snapshotPrevMyBooks) {
      const removedCards: Array<{ rect: DOMRect; rank: string; suit: string; faceImage?: string; backImage?: string }> = [];

      // Find cards that were in my hand but are now gone
      for (const [cardId, data] of cardPositions.value) {
        if (snapshotPrevCardIds.has(cardId) && !currentIds.has(cardId)) {
          removedCards.push(data);
        }
      }

      // Fly removed cards to my books stat using the utility
      flyToPlayerStat(flyCards, {
        cards: removedCards,
        playerPosition: props.playerPosition,
        statName: 'books',
        duration: 500,
        cardSize: { width: 70, height: 100 },
      });
    }

    // Check each opponent for book increases
    for (const [opponentPos, hand] of opponentHands.value) {
      const currentBooks = getBooksCount(opponentPos);
      const prevBooks = snapshotPrevOpponentBooks.get(opponentPos) || 0;

      if (currentBooks > prevBooks) {
        const sourceRef = opponentHandRefs.value.get(opponentPos);
        if (sourceRef) {
          const sourceRect = sourceRef.getBoundingClientRect();

          // Fly 4 face-down cards (a book is always 4 cards)
          flyToPlayerStat(flyCards, {
            cards: Array.from({ length: 4 }, () => ({
              rect: sourceRect,
              faceUp: false,
              backImage: cardBackImageUrl.value || undefined,
            })),
            playerPosition: opponentPos,
            statName: 'books',
            duration: 500,
            cardSize: { width: 70, height: 100 },
          });
        }
      }

      // Update tracking for this opponent
      prevOpponentBooksCounts.value.set(opponentPos, currentBooks);
    }

    // Update my book tracking
    prevMyBooksCount.value = currentMyBooks;
  },
  { flush: 'sync' } // Run synchronously before other watchers
);
</script>

<template>
  <div class="go-fish-board">
    <!-- Player Section (at top) -->
    <div class="player-section">
      <div class="player-label">Your Hand</div>

      <!-- My Books -->
      <div v-if="myBooks.length > 0" class="books-area">
        <div v-for="book in myBooks" :key="book.id" class="book">
          <div class="book-rank">{{ getRankName((book.attributes?.rank as string) || '') }}</div>
          <div class="book-cards">
            <div v-for="i in 4" :key="i" class="mini-card"></div>
          </div>
        </div>
      </div>

      <!-- My Hand -->
      <div ref="myHandRef" class="hand my-hand">
        <div
          v-for="[rank, cards] of myCardsByRank"
          :key="rank"
          class="card-group"
          :class="{ 'selectable': isSelectingRank, 'selected': props.actionArgs.rank === rank }"
          @click="handleCardClick(rank)"
        >
          <div
            v-for="card in cards"
            :key="card.id"
            class="card card-front"
            :data-card-id="card.id"
            :data-element-id="card.id"
            :data-rank="card.rank"
            :data-suit="card.suit"
            :data-face-image="getCardImageUrl(card.$images, 'face') || undefined"
            :data-back-image="getCardImageUrl(card.$images, 'back') || undefined"
            data-face-up="true"
          >
            <!-- Card with image -->
            <img
              v-if="getCardImageUrl(card.$images, 'face')"
              :src="getCardImageUrl(card.$images, 'face')!"
              class="card-image"
              :alt="`${card.rank}${card.suit}`"
            />
            <!-- Fallback: text-based card face -->
            <template v-else>
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
            </template>
          </div>
        </div>
        <div v-if="myCardsByRank.size === 0" class="empty-hand">No cards</div>
      </div>
    </div>

    <!-- Opponent Sections -->
    <div class="opponents-container">
      <div v-for="opponent in opponents" :key="opponent.position" class="opponent-section">
        <div class="player-label">{{ getPlayerName(opponent.position) }}'s Hand</div>

        <!-- Opponent's Books -->
        <div v-if="getPlayerBooks(opponent.position).length > 0" class="books-area">
          <div v-for="book in getPlayerBooks(opponent.position)" :key="book.id" class="book">
            <div class="book-rank">{{ getRankName((book.attributes?.rank as string) || '') }}</div>
            <div class="book-cards">
              <div v-for="i in 4" :key="i" class="mini-card"></div>
            </div>
          </div>
        </div>

        <!-- Opponent's Hand -->
        <div
          :ref="(el) => setOpponentHandRef(opponent.position, el as HTMLElement | null)"
          class="hand opponent-hand"
          :class="{ 'selectable': isOpponentHandSelectable(opponent.position), 'selected': props.actionArgs.target === opponent.position }"
          :data-element-id="opponentHands.get(opponent.position)?.id"
          @click="handleOpponentClick(opponent.position)"
        >
          <div v-for="i in getElementCount(opponentHands.get(opponent.position))" :key="i" class="card card-back" :class="{ 'has-image': cardBackImageUrl }">
            <img v-if="cardBackImageUrl" :src="cardBackImageUrl" class="card-image" alt="Card back" />
            <div v-else class="card-pattern"></div>
          </div>
          <div v-if="getElementCount(opponentHands.get(opponent.position)) === 0" class="empty-hand">No cards</div>
        </div>
      </div>
    </div>

    <!-- Pond Section (at bottom) -->
    <div class="pond-section">
      <div class="deck-container">
        <div class="deck-label">Pond</div>
        <div ref="pondRef" class="deck">
          <div v-if="pondCount > 0" class="card card-back deck-card" :class="{ 'has-image': cardBackImageUrl }">
            <img v-if="cardBackImageUrl" :src="cardBackImageUrl" class="card-image deck-card-image" alt="Card back" />
            <div v-else class="card-pattern"></div>
            <div class="deck-count">{{ pondCount }}</div>
          </div>
          <div v-else class="empty-deck">Empty</div>
        </div>
      </div>
    </div>

    <!-- Flying cards animation overlay -->
    <FlyingCardsOverlay
      :flying-cards="flyingCards"
      :get-suit-symbol="getSuitSymbol"
      :get-suit-color="getSuitColor"
    />
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

.opponents-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
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

.card-back.has-image {
  background: transparent;
  border: none;
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

/* Card image styles */
.card-image {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: contain;
}

.deck-card-image {
  border-radius: 6px;
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
