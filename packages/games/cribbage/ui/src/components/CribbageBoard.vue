<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, watchEffect, nextTick } from 'vue';
import ScoringOverlay from './ScoringOverlay.vue';
import RoundSummary from './RoundSummary.vue';
import {
  prefersReducedMotion,
  useFlyingCards,
  useFlyOnAppear,
  useAutoAnimations,
  FlyingCardsOverlay,
  findElement,
  findPlayerHand,
  getElementCount,
  getCards,
  getFirstCard,
  getCardData,
  getSuitSymbol,
  getSuitColor,
  getCardPointValue,
  type UseActionControllerReturn,
} from '@boardsmith/ui';

// Animation state - tracks card positions for FLIP animations
const boardRef = ref<HTMLElement | null>(null);

// Manual flying cards for discard (need to capture before action)
const { flyingCards: discardFlyingCards, flyCards } = useFlyingCards();
const cribStackRef = ref<HTMLElement | null>(null);
const deckStackRef = ref<HTMLElement | null>(null);
const starterAreaRef = ref<HTMLElement | null>(null);
const myHandRef = ref<HTMLElement | null>(null);
const playAreaRef = ref<HTMLElement | null>(null);
const playedCardsRef = ref<HTMLElement | null>(null);

// Type for parsed image info (either URL string or sprite with coordinates)
type ImageInfo =
  | { type: 'url'; src: string }
  | { type: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };

interface CardImages {
  face?: string | { sprite: string; x: number; y: number; width: number; height: number };
  back?: string | { sprite: string; x: number; y: number; width: number; height: number };
}

interface Card {
  id: number | string;
  name: string;
  attributes?: {
    rank?: string;
    suit?: string;
    $images?: CardImages;
  };
}

// Helper to parse image info from $images attribute
function getCardImageInfo(card: Card | null | undefined, side: 'face' | 'back'): ImageInfo | null {
  if (!card?.attributes?.$images) return null;
  const image = card.attributes.$images[side];
  if (!image) return null;

  if (typeof image === 'string') {
    return { type: 'url', src: image };
  }

  // Handle coordinate-based sprite sheet
  if (typeof image === 'object' && image.sprite && typeof image.x === 'number' && typeof image.y === 'number') {
    return {
      type: 'sprite',
      sprite: image.sprite,
      x: image.x,
      y: image.y,
      width: image.width ?? 238,
      height: image.height ?? 333,
    };
  }

  return null;
}

// Helper to check if card face is URL image
function isUrlFace(card: Card | null | undefined): boolean {
  return getCardImageInfo(card, 'face')?.type === 'url';
}

// Helper to check if card face is sprite
function isSpriteFace(card: Card | null | undefined): boolean {
  return getCardImageInfo(card, 'face')?.type === 'sprite';
}

// Helper to get face URL src
function getFaceSrc(card: Card | null | undefined): string {
  const info = getCardImageInfo(card, 'face');
  if (info?.type === 'url') return info.src;
  return '';
}

// Helper to get image data for data attribute (works with animation system)
// Returns URL string for URL images, or JSON string for sprite info
function getImageDataAttr(card: Card | null | undefined, side: 'face' | 'back'): string | undefined {
  const info = getCardImageInfo(card, side);
  if (!info) return undefined;
  if (info.type === 'url') return info.src;
  // For sprites, return JSON with sprite coordinates so animation system can render correctly
  return JSON.stringify({
    sprite: info.sprite,
    x: info.x,
    y: info.y,
    width: info.width,
    height: info.height,
  });
}

// Sprite sheet layout constants
// Standard card dimensions in the sprite sheet (face cards)
const NATIVE_CARD_WIDTH = 238;
const NATIVE_CARD_HEIGHT = 333;
const SPRITE_COLS = 13;
const SPRITE_ROWS = 5;

// Helper to get sprite style with proper scaling
// IMPORTANT: Scale based on native face card dimensions (238x333), not the individual
// card's dimensions, because card backs may have different sizes in the sprite
// Default display size matches CSS: .card { width: 60px; height: 84px; }
function getSpriteStyle(info: ImageInfo, displayWidth: number = 60, displayHeight: number = 84): Record<string, string> {
  if (info.type !== 'sprite') return {};

  // Scale based on standard card size, not individual card's dimensions
  const scaleX = displayWidth / NATIVE_CARD_WIDTH;
  const scaleY = displayHeight / NATIVE_CARD_HEIGHT;

  // Total sprite sheet dimensions
  const sheetWidth = SPRITE_COLS * NATIVE_CARD_WIDTH;
  const sheetHeight = SPRITE_ROWS * NATIVE_CARD_HEIGHT;

  // Scaled sprite sheet size
  const scaledSheetWidth = sheetWidth * scaleX;
  const scaledSheetHeight = sheetHeight * scaleY;

  // Scale the position coordinates
  const scaledX = info.x * scaleX;
  const scaledY = info.y * scaleY;

  return {
    backgroundImage: `url(${info.sprite})`,
    backgroundPosition: `-${scaledX}px -${scaledY}px`,
    backgroundSize: `${scaledSheetWidth}px ${scaledSheetHeight}px`,
    backgroundRepeat: 'no-repeat',
  };
}

// Helper to get face sprite style
function getFaceSpriteStyle(card: Card | null | undefined): Record<string, string> {
  const info = getCardImageInfo(card, 'face');
  if (info?.type === 'sprite') {
    return getSpriteStyle(info);
  }
  return {};
}

// Helper to generate card preview data for zoom preview feature
// Returns JSON string for data-card-preview attribute
function getCardPreviewJson(card: Card | null | undefined, showBack: boolean = false): string {
  if (!card) return '';
  return JSON.stringify({
    rank: card.attributes?.rank,
    suit: card.attributes?.suit,
    faceImage: card.attributes?.$images?.face,
    backImage: card.attributes?.$images?.back,
    showBack,
    label: card.name,
  });
}

// Helper to generate preview data for card backs (deck/crib stacks)
function getCardBackPreviewJson(backImage: ImageInfo | null): string {
  if (!backImage) return '';
  return JSON.stringify({
    backImage: backImage,
    showBack: true,
    label: 'Card',
  });
}

interface ScoringCardData {
  id: string;
  rank: string;
  suit: string;
}

const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionArgs: Record<string, unknown>;
  actionController: UseActionControllerReturn;
}>();

// Selected cards - uses shared actionArgs with preview key for ActionPanel sync
// Store element IDs (numbers) so ActionPanel can auto-execute with correct data type
const selectedCards = computed({
  get: () => (props.actionArgs._preview_cards as number[]) || [],
  set: (value: number[]) => {
    props.actionArgs._preview_cards = value;
  }
});
const isPerformingAction = ref(false);

// Computed properties
const cribbagePhase = computed(() => props.gameView?.attributes?.cribbagePhase || 'dealing');
const runningTotal = computed(() => props.gameView?.attributes?.runningTotal || 0);
const dealerPosition = computed(() => props.gameView?.attributes?.dealerPosition ?? 1);  // 1-indexed
const targetScore = computed(() => props.gameView?.attributes?.targetScore || 121);

// Find player hands using helper (searches by $type which handles bundler mangling)
const myHandElement = computed(() => findPlayerHand(props.gameView, props.playerPosition));
const myHand = computed<Card[]>(() => getCards(myHandElement.value) as unknown as Card[]);

const opponentHandElement = computed(() => {
  // Find hand that doesn't belong to current player
  const hands = props.gameView?.children?.filter(
    (c: any) => c.attributes?.$type === 'hand'
  ) || [];
  return hands.find((h: any) => h.attributes?.player?.position !== props.playerPosition);
});
const opponentHand = computed(() => opponentHandElement.value?.children || []);

// Find game elements using name (more stable than className which can be mangled)
const cribElement = computed(() => findElement(props.gameView, { name: 'crib' }));
const crib = computed(() => cribElement.value?.children || []);
const cribCardCount = computed(() => getElementCount(cribElement.value));

const playAreaElement = computed(() => findElement(props.gameView, { name: 'play-area' }));
const playArea = computed(() => getCards(playAreaElement.value));

const playedCardsElement = computed(() => findElement(props.gameView, { name: 'played-cards' }));
const playedCards = computed(() => getCards(playedCardsElement.value));

const starterElement = computed(() => findElement(props.gameView, { name: 'starter' }));
const starterCard = computed(() => getFirstCard(starterElement.value) || null);

// Deck uses $type since it extends base Deck class (className gets mangled to Deck2)
const deckElement = computed(() => findElement(props.gameView, { type: 'deck', name: 'deck' }));
const deckCardCount = computed(() => getElementCount(deckElement.value));

// Auto-animations: FLIP within containers + flying between containers
const { flyingElements: autoFlyingCards } = useAutoAnimations({
  gameView: () => props.gameView,
  containers: [
    // Hand cards reorder with FLIP animation
    { element: myHandElement, ref: myHandRef, flipWithin: '[data-card-id]' },
    // Play area cards reorder with FLIP animation
    { element: playAreaElement, ref: playAreaRef, flipWithin: '[data-card-id]' },
    // Played cards stack with FLIP animation
    { element: playedCardsElement, ref: playedCardsRef, flipWithin: '[data-card-id]' },
    // Crib for flying cards
    { element: cribElement, ref: cribStackRef },
    // Deck for flying cards
    { element: deckElement, ref: deckStackRef },
    // Starter area for flying cards
    { element: starterElement, ref: starterAreaRef },
  ],
  getElementData: (element) => ({
    rank: element.attributes?.rank,
    suit: element.attributes?.suit,
    faceImage: getCardImageInfo(element, 'face') ?? undefined,
    backImage: getCardImageInfo(element, 'back') ?? undefined,
  }),
  duration: 400,
  flipDuration: 300,
});

// Fly starter card from deck when it appears using the reusable composable
const { isFlying: starterIsFlying, flyingCards: starterFlyingCards } = useFlyOnAppear({
  sourceRef: deckStackRef,
  targetRef: starterAreaRef,
  element: starterCard,
  getCardData: (card) => ({
    rank: (card.attributes as any)?.rank,
    suit: (card.attributes as any)?.suit,
    // Pass the full image info object for sprites (FlyingCardsOverlay handles both URL and sprite formats)
    faceImage: getCardImageInfo(card as Card, 'face') ?? undefined,
    backImage: getCardImageInfo(card as Card, 'back') ?? undefined,
  }),
  flip: true,
  startFaceUp: false,
  duration: 500,
});

// Combine all flying cards for the overlay
const allFlyingCards = computed(() => [
  ...autoFlyingCards.value,
  ...discardFlyingCards.value,
  ...starterFlyingCards.value,
]);

// Scores come from hand element attributes (already found above)
const myScore = computed(() => (myHandElement.value?.attributes as any)?.player?.score ?? 0);
const opponentScore = computed(() => (opponentHandElement.value?.attributes as any)?.player?.score ?? 0);

const isDealer = computed(() => dealerPosition.value === props.playerPosition);

// Get card back image info from any card with $images (for deck/crib display)
// Check multiple sources since hands can be empty at end of round
const cardBackImageInfo = computed((): ImageInfo | null => {
  // Try myHand first
  if (myHand.value.length > 0) {
    const info = getCardImageInfo(myHand.value[0], 'back');
    if (info) return info;
  }
  // Try starter card
  if (starterCard.value) {
    const info = getCardImageInfo(starterCard.value as Card, 'back');
    if (info) return info;
  }
  // Try crib cards
  if (crib.value.length > 0) {
    const info = getCardImageInfo(crib.value[0] as Card, 'back');
    if (info) return info;
  }
  // Try play area
  if (playArea.value.length > 0) {
    const info = getCardImageInfo(playArea.value[0] as Card, 'back');
    if (info) return info;
  }
  // Try played cards
  if (playedCards.value.length > 0) {
    const info = getCardImageInfo(playedCards.value[0] as Card, 'back');
    if (info) return info;
  }
  return null;
});

const needsToDiscard = computed(() => {
  if (cribbagePhase.value !== 'discarding') return false;
  return myHand.value.length > 4;
});

const gameOver = computed(() => {
  return myScore.value >= targetScore.value || opponentScore.value >= targetScore.value;
});

const canPlayAnyCard = computed(() => {
  if (cribbagePhase.value !== 'play') return false;
  return props.availableActions.includes('playCard');
});

const mustSayGo = computed(() => {
  if (cribbagePhase.value !== 'play') return false;
  return props.availableActions.includes('sayGo') && !props.availableActions.includes('playCard');
});

const winner = computed(() => {
  if (!gameOver.value) return null;
  if (myScore.value >= targetScore.value) return 'You win!';
  if (opponentScore.value >= targetScore.value) return 'Opponent wins!';
  return null;
});

// Scoring Animation State
const scoringAnimation = computed(() => props.gameView?.attributes?.scoringAnimation);

// Track dismissed scoring animations so Continue button works
const dismissedScoringKey = ref<string | null>(null);

// Generate a unique key for the current scoring animation
const currentScoringKey = computed(() => {
  const anim = scoringAnimation.value;
  if (!anim?.active) return null;
  return `${anim.type}-${anim.playerPosition}-${anim.handCards?.join(',')}`;
});

// Only show overlay if active AND not dismissed by user
const scoringOverlayActive = computed(() => {
  if (scoringAnimation.value?.active !== true) return false;
  // If user dismissed this specific animation, don't show it
  if (dismissedScoringKey.value === currentScoringKey.value) return false;
  return true;
});

// Reset dismissed state when a NEW scoring animation starts
watch(currentScoringKey, (newKey, oldKey) => {
  if (newKey && newKey !== oldKey) {
    dismissedScoringKey.value = null;
  }
});

const scoringOverlayType = computed(() => {
  return scoringAnimation.value?.type ?? null;
});

const scoringOverlayPlayerName = computed(() => {
  return scoringAnimation.value?.playerName ?? '';
});

const scoringOverlayItems = computed(() => {
  return scoringAnimation.value?.items ?? [];
});

const scoringOverlayTotalPoints = computed(() => {
  return scoringAnimation.value?.totalPoints ?? 0;
});

// Convert card IDs to card data with rank/suit for scoring overlay
const scoringOverlayHandCards = computed((): ScoringCardData[] => {
  const cardIds = scoringAnimation.value?.handCards ?? [];
  return cardIds.map((id: string) => getCardDataById(id)).filter((c: ScoringCardData | null): c is ScoringCardData => c !== null);
});

const scoringOverlayStarterCard = computed((): ScoringCardData | null => {
  const starterId = scoringAnimation.value?.starterCard;
  if (!starterId) return null;
  return getCardDataById(starterId);
});

// Find card data by ID from any location in game view
function getCardDataById(cardId: string): ScoringCardData | null {
  // Search all children recursively for the card
  function searchChildren(children: any[]): any {
    for (const child of children) {
      if (child.name === cardId && child.attributes?.rank) {
        return {
          id: cardId,
          rank: child.attributes.rank,
          suit: child.attributes.suit,
        };
      }
      if (child.children) {
        const found = searchChildren(child.children);
        if (found) return found;
      }
    }
    return null;
  }

  if (props.gameView?.children) {
    return searchChildren(props.gameView.children);
  }
  return null;
}

async function handleScoringComplete() {
  // Execute the acknowledgeScore action to advance the game
  if (props.availableActions.includes('acknowledgeScore')) {
    await props.actionController.execute('acknowledgeScore');
  }
  // Also mark as dismissed locally in case action doesn't clear it immediately
  dismissedScoringKey.value = currentScoringKey.value;
}

// Round Summary State (shows all scores at once)
const roundSummary = computed(() => props.gameView?.attributes?.roundSummary);

// Local state to "latch" onto showing the summary until user dismisses
const showingRoundSummary = ref(false);
const latchedRoundSummaryData = ref<{
  starterCard: string | null;
  nonDealerHand: any;
  dealerHand: any;
  crib: any;
} | null>(null);

// Watch for when roundSummary becomes active - latch onto it
watch(() => roundSummary.value?.active, (active) => {
  if (active && roundSummary.value) {
    // Latch onto this summary data
    showingRoundSummary.value = true;
    latchedRoundSummaryData.value = {
      starterCard: roundSummary.value.starterCard,
      nonDealerHand: roundSummary.value.nonDealerHand,
      dealerHand: roundSummary.value.dealerHand,
      crib: roundSummary.value.crib,
    };
  }
});

// Use the latched state for display
const roundSummaryActive = computed(() => showingRoundSummary.value);

const roundSummaryStarterCard = computed((): ScoringCardData | null => {
  const starterId = latchedRoundSummaryData.value?.starterCard;
  if (!starterId) return null;
  return getCardDataById(starterId);
});

const roundSummaryNonDealerHand = computed(() => {
  return latchedRoundSummaryData.value?.nonDealerHand ?? null;
});

const roundSummaryDealerHand = computed(() => {
  return latchedRoundSummaryData.value?.dealerHand ?? null;
});

const roundSummaryCrib = computed(() => {
  return latchedRoundSummaryData.value?.crib ?? null;
});


async function handleRoundSummaryComplete() {
  // Clear the latched state so overlay closes
  showingRoundSummary.value = false;
  latchedRoundSummaryData.value = null;
  // Then execute the action to advance the game
  if (props.availableActions.includes('acknowledgeScore')) {
    await props.actionController.execute('acknowledgeScore');
  }
}

// Helpers
function isCardPlayable(rank: string): boolean {
  if (cribbagePhase.value !== 'play') return true;
  const cardValue = getCardPointValue(rank);
  return runningTotal.value + cardValue <= 31;
}

function toggleCardSelection(cardName: string) {
  if (!props.isMyTurn || isPerformingAction.value) return;

  // Find the card to get its element ID
  const card = myHand.value.find((c: Card) => c.name === cardName);
  if (!card || typeof card.id !== 'number') return;
  const cardId = card.id;

  const current = selectedCards.value;
  const index = current.indexOf(cardId);
  if (index >= 0) {
    // Remove card - create new array without it
    selectedCards.value = current.filter((_, i) => i !== index);
  } else {
    if (cribbagePhase.value === 'discarding' && current.length < 2) {
      // Add card - create new array with it
      selectedCards.value = [...current, cardId];
    } else if (cribbagePhase.value === 'play') {
      const rank = card?.attributes?.rank;
      if (rank && isCardPlayable(rank)) {
        // During play phase, immediately execute the action (single card selection)
        // Don't use selectedCards - call actionController directly with the card ID
        props.actionController.execute('playCard', { card: cardId });
      }
    }
  }
}

// Actions - call actionController.execute() with proper parameters
async function performDiscard() {
  if (selectedCards.value.length !== 2 || isPerformingAction.value) {
    return;
  }

  isPerformingAction.value = true;

  // Capture card positions BEFORE the action (cards will be gone after)
  const cardsToFly: Array<{
    id: string;
    startRect: DOMRect;
    cardData: { rank: string; suit: string; faceImage?: unknown; backImage?: unknown };
  }> = [];

  for (const cardId of selectedCards.value) {
    // Find card by element ID
    const card = myHand.value.find((c: Card) => c.id === cardId);
    if (!card) continue;
    // Use card.name for DOM selector (data-card-id uses name)
    const cardEl = boardRef.value?.querySelector(`[data-card-id="${card.name}"]`);
    if (cardEl && card?.attributes?.rank && card?.attributes?.suit) {
      cardsToFly.push({
        id: card.name,
        startRect: cardEl.getBoundingClientRect(),
        cardData: {
          rank: card.attributes.rank,
          suit: card.attributes.suit,
          // Pass full image info object for sprites
          faceImage: getCardImageInfo(card, 'face') ?? undefined,
          backImage: getCardImageInfo(card, 'back') ?? undefined,
        },
      });
    }
  }

  try {
    // Discard action expects cards array of element IDs (fromElements with multiSelect)
    // selectedCards already contains element IDs
    const result = await props.actionController.execute('discard', {
      cards: selectedCards.value,
    });

    if (result.success) {
      selectedCards.value = [];

      // Start flying animations from old card positions to crib
      // Pass a function for endRect so it tracks the crib position as it moves
      if (cardsToFly.length > 0) {
        flyCards(
          cardsToFly.map((card) => ({
            id: `discard-${card.id}-${Date.now()}`,
            startRect: card.startRect,
            endRect: () => boardRef.value?.querySelector('[data-zone="crib"]') as HTMLElement | null,
            cardData: {
              rank: card.cardData.rank,
              suit: card.cardData.suit,
              faceUp: true,
              faceImage: card.cardData.faceImage,
              backImage: card.cardData.backImage,
            },
            flip: true,
            duration: 400,
          })),
          100 // stagger by 100ms
        );
      }
    }
  } finally {
    isPerformingAction.value = false;
  }
}

async function performPlayCard() {
  if (selectedCards.value.length !== 1 || isPerformingAction.value) {
    return;
  }

  // selectedCards already contains element IDs
  const cardId = selectedCards.value[0];

  isPerformingAction.value = true;
  try {
    // Send numeric ID for chooseElement selection
    await props.actionController.execute('playCard', {
      card: cardId,
    });
  } finally {
    // Always clear selection after action (server will send updated state)
    selectedCards.value = [];
    isPerformingAction.value = false;
  }
}

async function sayGo() {
  if (isPerformingAction.value) return;

  isPerformingAction.value = true;
  try {
    await props.actionController.execute('sayGo');
  } finally {
    isPerformingAction.value = false;
  }
}

// Expose for parent
defineExpose({
  selectedCards,
  isPerformingAction,
  cribbagePhase,
  performDiscard,
  performPlayCard,
  sayGo,
});
</script>

<template>
  <div ref="boardRef" class="cribbage-board">
    <!-- Game Over -->
    <div v-if="gameOver" class="game-over">
      <h2>Game Over!</h2>
      <p class="winner">{{ winner }}</p>
      <p>Your score: {{ myScore }} | Opponent: {{ opponentScore }}</p>
    </div>

    <template v-else>
      <!-- Play Area (current count, up to 31) -->
      <div v-if="cribbagePhase === 'play'" class="play-area">
        <div class="play-area-header">
          <span>Current Count</span>
          <span class="running-total-inline">{{ runningTotal }}/31</span>
        </div>
        <div ref="playAreaRef" class="current-count-cards">
          <div
            v-for="(card, index) in playArea"
            :key="card.id"
            class="card"
            :class="{ 'has-image': getCardImageInfo(card as Card, 'face') }"
            :data-card-id="card.name"
            :data-element-id="card.name"
            :data-rank="card.attributes?.rank"
            :data-suit="card.attributes?.suit"
            :data-face-image="getImageDataAttr(card as Card, 'face')"
            :data-back-image="getImageDataAttr(card as Card, 'back')"
            data-face-up="true"
            :data-card-preview="getCardPreviewJson(card as Card)"
            :style="{ color: getSuitColor((card.attributes?.suit as string) || '') }"
          >
            <img v-if="isUrlFace(card as Card)" :src="getFaceSrc(card as Card)" class="card-image" :alt="`${card.attributes?.rank}${card.attributes?.suit}`" />
            <div
              v-else-if="isSpriteFace(card as Card)"
              class="card-image card-sprite"
              :style="getFaceSpriteStyle(card as Card)"
            ></div>
            <template v-else>
              <span class="rank">{{ card.attributes?.rank }}</span>
              <span class="suit">{{ getSuitSymbol((card.attributes?.suit as string) || '') }}</span>
            </template>
          </div>
          <div v-if="playArea.length === 0" class="no-cards">Waiting for play...</div>
        </div>
      </div>

      <!-- Middle Area: Deck, Starter, Crib & Played Stack -->
      <div class="middle-area">
        <!-- Deck -->
        <div class="deck-area" data-zone="deck">
          <div class="area-label">Deck</div>
          <div ref="deckStackRef" class="deck-stack">
            <template v-if="deckCardCount > 0">
              <div
                v-for="i in Math.min(deckCardCount, 5)"
                :key="'deck-' + i"
                class="card-back stacked"
                :class="{ 'has-image': cardBackImageInfo }"
                :style="{ '--stack-index': i - 1 }"
                :data-card-preview="getCardBackPreviewJson(cardBackImageInfo)"
              >
                <img v-if="cardBackImageInfo?.type === 'url'" :src="cardBackImageInfo.src" class="card-image" alt="Card back" />
                <div
                  v-else-if="cardBackImageInfo?.type === 'sprite'"
                  class="card-image card-sprite"
                  :style="getSpriteStyle(cardBackImageInfo)"
                ></div>
              </div>
            </template>
            <div v-else class="card-placeholder">Empty</div>
          </div>
          <div class="deck-count">{{ deckCardCount }}</div>
        </div>

        <div class="starter-area">
          <div class="area-label">Starter</div>
          <div ref="starterAreaRef" class="starter-card-container">
            <!-- Hide actual card while flying animation is active -->
            <div
              v-if="starterCard && !starterIsFlying"
              class="card"
              :class="{ 'has-image': getCardImageInfo(starterCard as any, 'face') }"
              :data-card-id="starterCard.name"
              :data-element-id="starterCard.name"
              :data-rank="starterCard.attributes?.rank"
              :data-suit="starterCard.attributes?.suit"
              :data-face-image="getImageDataAttr(starterCard as any, 'face')"
              :data-back-image="getImageDataAttr(starterCard as any, 'back')"
              data-face-up="true"
              :data-card-preview="getCardPreviewJson(starterCard as any)"
              :style="{ color: getSuitColor((starterCard.attributes?.suit as string) || '') }"
            >
              <img v-if="isUrlFace(starterCard as any)" :src="getFaceSrc(starterCard as any)" class="card-image" :alt="`${starterCard.attributes?.rank}${starterCard.attributes?.suit}`" />
              <div
                v-else-if="isSpriteFace(starterCard as any)"
                class="card-image card-sprite"
                :style="getFaceSpriteStyle(starterCard as any)"
              ></div>
              <template v-else>
                <span class="rank">{{ starterCard.attributes?.rank }}</span>
                <span class="suit">{{ getSuitSymbol((starterCard.attributes?.suit as string) || '') }}</span>
              </template>
            </div>
            <div v-else-if="!starterCard" class="card-placeholder">
              <span>?</span>
            </div>
          </div>
        </div>

        <div class="crib-area">
          <div class="area-label">Crib ({{ isDealer ? 'Yours' : "Opponent's" }})</div>
          <div ref="cribStackRef" data-zone="crib" class="crib-stack">
            <!-- Show actual cards if visible -->
            <template v-if="crib.length > 0">
              <div
                v-for="(card, i) in crib"
                :key="i"
                class="card-back stacked"
                :class="{ 'has-image': cardBackImageInfo }"
                :data-card-id="card.name"
                :data-card-preview="getCardBackPreviewJson(cardBackImageInfo)"
                :style="{ '--stack-index': i }"
              >
                <img v-if="cardBackImageInfo?.type === 'url'" :src="cardBackImageInfo.src" class="card-image" alt="Card back" />
                <div
                  v-else-if="cardBackImageInfo?.type === 'sprite'"
                  class="card-image card-sprite"
                  :style="getSpriteStyle(cardBackImageInfo)"
                ></div>
                <template v-else>
                  <span v-if="card.attributes?.rank">{{ card.attributes.rank }}{{ getSuitSymbol((card.attributes.suit as string) || '') }}</span>
                  <span v-else>?</span>
                </template>
              </div>
            </template>
            <!-- Show card backs for hidden cards based on childCount -->
            <template v-else-if="cribCardCount > 0">
              <div
                v-for="i in cribCardCount"
                :key="'hidden-' + i"
                class="card-back stacked"
                :class="{ 'has-image': cardBackImageInfo }"
                :style="{ '--stack-index': i - 1 }"
                :data-card-preview="getCardBackPreviewJson(cardBackImageInfo)"
              >
                <img v-if="cardBackImageInfo?.type === 'url'" :src="cardBackImageInfo.src" class="card-image" alt="Card back" />
                <div
                  v-else-if="cardBackImageInfo?.type === 'sprite'"
                  class="card-image card-sprite"
                  :style="getSpriteStyle(cardBackImageInfo)"
                ></div>
                <span v-else>?</span>
              </div>
            </template>
            <!-- Empty placeholder when no cards -->
            <div v-else class="card-placeholder">0 cards</div>
          </div>
        </div>

        <!-- Played Stack (cards from completed counts, visible during play phase) -->
        <div v-if="cribbagePhase === 'play'" class="played-stack-area">
          <div class="area-label">Played ({{ playedCards.length }})</div>
          <div ref="playedCardsRef" class="played-stack">
            <div
              v-for="(card, index) in playedCards"
              :key="card.name || card.id"
              class="card stacked"
              :class="{ 'has-image': getCardImageInfo(card as Card, 'face') }"
              :data-card-id="card.name"
              :data-element-id="card.name"
              :data-rank="card.attributes?.rank"
              :data-suit="card.attributes?.suit"
              :data-face-image="getImageDataAttr(card as Card, 'face')"
              :data-back-image="getImageDataAttr(card as Card, 'back')"
              data-face-up="true"
              :data-card-preview="getCardPreviewJson(card as Card)"
              :style="{
                color: getSuitColor((card.attributes?.suit as string) || ''),
                '--stack-index': index
              }"
            >
              <img v-if="isUrlFace(card as Card)" :src="getFaceSrc(card as Card)" class="card-image" :alt="`${card.attributes?.rank}${card.attributes?.suit}`" />
              <div
                v-else-if="isSpriteFace(card as Card)"
                class="card-image card-sprite"
                :style="getFaceSpriteStyle(card as Card)"
              ></div>
              <template v-else>
                <span class="rank">{{ card.attributes?.rank }}</span>
                <span class="suit">{{ getSuitSymbol((card.attributes?.suit as string) || '') }}</span>
              </template>
            </div>
            <div v-if="playedCards.length === 0" class="card-placeholder">—</div>
          </div>
        </div>
      </div>

      <!-- My Hand -->
      <div class="my-hand-area">
        <div class="hand-label">Your Hand ({{ myHand.length }} cards)</div>
        <div ref="myHandRef" class="my-cards">
          <div
            v-for="card in myHand"
            :key="card.name"
            class="card"
            :class="{
              'has-image': getCardImageInfo(card, 'face'),
              selected: selectedCards.includes(card.id as number),
              clickable: isMyTurn && !isPerformingAction && isCardPlayable(card.attributes?.rank || ''),
              unplayable: cribbagePhase === 'play' && !isCardPlayable(card.attributes?.rank || '')
            }"
            :data-card-id="card.name"
            :data-element-id="card.name"
            :data-rank="card.attributes?.rank"
            :data-suit="card.attributes?.suit"
            :data-face-image="getImageDataAttr(card, 'face')"
            :data-back-image="getImageDataAttr(card, 'back')"
            data-face-up="true"
            :data-card-preview="getCardPreviewJson(card)"
            :style="{ color: getSuitColor(card.attributes?.suit || '') }"
            @click="toggleCardSelection(card.name)"
          >
            <img v-if="isUrlFace(card)" :src="getFaceSrc(card)" class="card-image" :alt="`${card.attributes?.rank}${card.attributes?.suit}`" />
            <div
              v-else-if="isSpriteFace(card)"
              class="card-image card-sprite"
              :style="getFaceSpriteStyle(card)"
            ></div>
            <template v-else>
              <span class="rank">{{ card.attributes?.rank }}</span>
              <span class="suit">{{ getSuitSymbol(card.attributes?.suit || '') }}</span>
            </template>
          </div>
          <div v-if="myHand.length === 0" class="no-cards">No cards in hand</div>
        </div>
      </div>

      <!-- Turn Actions -->
      <div v-if="isMyTurn" class="turn-actions">
        <!-- Discard phase -->
        <template v-if="cribbagePhase === 'discarding' && availableActions.includes('discard')">
          <span class="action-hint">Select 2 cards to discard ({{ selectedCards.length }}/2)</span>
          <button
            @click="performDiscard"
            :disabled="selectedCards.length !== 2 || isPerformingAction"
            class="btn primary"
          >
            Discard Selected
          </button>
        </template>

        <!-- Play phase -->
        <template v-if="cribbagePhase === 'play'">
          <template v-if="canPlayAnyCard">
            <span class="action-hint">Select a card to play</span>
            <button
              @click="performPlayCard"
              :disabled="selectedCards.length !== 1 || isPerformingAction"
              class="btn primary"
            >
              Play Card
            </button>
          </template>

          <template v-else-if="mustSayGo">
            <span class="action-hint go-warning">No playable cards!</span>
            <button
              @click="sayGo"
              :disabled="isPerformingAction"
              class="btn go-btn"
            >
              Say "Go"
            </button>
          </template>
        </template>
      </div>

    </template>

    <!-- Scoring Animation Overlay (deprecated, but kept for backward compat) -->
    <ScoringOverlay
      :active="scoringOverlayActive"
      :type="scoringOverlayType"
      :player-name="scoringOverlayPlayerName"
      :hand-cards="scoringOverlayHandCards"
      :starter-card="scoringOverlayStarterCard"
      :items="scoringOverlayItems"
      :total-points="scoringOverlayTotalPoints"
      @complete="handleScoringComplete"
    />

    <!-- Round Summary Overlay (shows all scores at end of round) -->
    <RoundSummary
      :active="roundSummaryActive"
      :starter-card="roundSummaryStarterCard"
      :non-dealer-hand="roundSummaryNonDealerHand"
      :dealer-hand="roundSummaryDealerHand"
      :crib="roundSummaryCrib"
      @complete="handleRoundSummaryComplete"
    />

    <!-- Flying cards animation overlay -->
    <FlyingCardsOverlay
      :flying-cards="allFlyingCards"
      :get-suit-symbol="getSuitSymbol"
      :get-suit-color="getSuitColor"
    />
  </div>
</template>

<style scoped>
.cribbage-board {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

/* Scoreboard */
.scoreboard {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 30px;
  background: rgba(255, 255, 255, 0.05);
  padding: 15px 30px;
  border-radius: 12px;
}

.player-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.player-score .name {
  font-size: 0.9rem;
  color: #aaa;
}

.player-score .score {
  font-size: 2rem;
  font-weight: bold;
  color: #d4a574;
}

.player-score.dealer .score {
  color: #f39c12;
}

.dealer-badge {
  background: #f39c12;
  color: #1a1a2e;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: bold;
}

.score-divider {
  color: #666;
  font-size: 1.2rem;
}

/* Play Area */
.play-area {
  background: rgba(0, 100, 0, 0.2);
  padding: 15px;
  border-radius: 12px;
  border: 2px solid rgba(0, 100, 0, 0.3);
}

.play-area-header {
  margin-bottom: 10px;
  color: #aaa;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

.play-area-header .card-count {
  font-size: 0.8rem;
  color: #888;
}

.play-area-header .running-total-inline {
  background: rgba(255, 255, 255, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: bold;
  color: #d4a574;
}

.current-count-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 65px;
  align-items: center;
}

/* Middle Area */
.middle-area {
  display: flex;
  justify-content: center;
  gap: 40px;
}

.starter-area, .crib-area, .played-stack-area, .deck-area {
  text-align: center;
}

.area-label {
  color: #aaa;
  font-size: 0.85rem;
  margin-bottom: 12px;
}

.deck-stack, .crib-stack {
  position: relative;
  width: 60px;
  height: 84px;
  margin: 0 auto;
}

.deck-stack .card-back.stacked,
.crib-stack .card-back.stacked {
  position: absolute;
  top: calc(var(--stack-index, 0) * -2px);
  left: calc(var(--stack-index, 0) * 2px);
  z-index: calc(var(--stack-index, 0) + 1);
  box-shadow: -1px 1px 4px rgba(0, 0, 0, 0.3);
}

.deck-stack .card-placeholder,
.crib-stack .card-placeholder {
  width: 100%;
  height: 100%;
}

.deck-count {
  color: #888;
  font-size: 0.75rem;
  margin-top: 8px;
}

/* Played Stack */
.played-stack {
  position: relative;
  width: 60px;
  height: 84px;
  margin: 0 auto;
}

.played-stack .card.stacked {
  position: absolute;
  top: calc(var(--stack-index, 0) * -2px);
  left: calc(var(--stack-index, 0) * 2px);
  z-index: calc(var(--stack-index, 0) + 1);
  box-shadow: -1px 1px 4px rgba(0, 0, 0, 0.3);
}

.played-stack .card-placeholder {
  width: 100%;
  height: 100%;
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
}

/* My Hand */
.my-hand-area {
  background: rgba(255, 255, 255, 0.05);
  padding: 20px;
  border-radius: 12px;
}

.hand-label {
  color: #aaa;
  margin-bottom: 15px;
  font-size: 0.9rem;
}

.my-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}

/* Cards */
.card {
  width: 60px;
  height: 84px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  position: relative;
}

.card.small {
  width: 45px;
  height: 63px;
}

.card.clickable {
  cursor: pointer;
}

.card.clickable:hover {
  transform: translateY(-5px);
}

.card.selected {
  transform: translateY(-10px);
  box-shadow: 0 8px 20px rgba(139, 90, 43, 0.5);
  border: 3px solid #d4a574;
}

.card.unplayable {
  opacity: 0.4;
  cursor: not-allowed;
}

.card .rank {
  font-size: 1.3rem;
}

.card.small .rank {
  font-size: 1rem;
}

.card .suit {
  font-size: 1.5rem;
}

.card.small .suit {
  font-size: 1.2rem;
}

.card .point-value {
  position: absolute;
  bottom: 2px;
  right: 4px;
  font-size: 0.6rem;
  color: #999;
}

/* Card image styles */
.card-image {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: contain;
}

/* CSS sprite sheet (uses background-position) */
.card-sprite {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  background-repeat: no-repeat;
}

.card.has-image,
.card-back.has-image {
  padding: 0;
  background: transparent;
}

.card-back.has-image {
  background: transparent;
}

.card-back {
  width: 60px;
  height: 84px;
  background: linear-gradient(135deg, #8b5a2b, #6b4423);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #d4a574;
  font-size: 0.8rem;
}

.card-back.small {
  width: 45px;
  height: 63px;
  font-size: 0.7rem;
}

.card-placeholder {
  width: 60px;
  height: 84px;
  border: 2px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
}

.card-placeholder.small {
  width: 45px;
  height: 63px;
}

.no-cards {
  color: #666;
  font-style: italic;
}

/* Turn Actions */
.turn-actions {
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 15px 20px;
  background: rgba(139, 90, 43, 0.2);
  border-radius: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.action-hint {
  color: #aaa;
  font-size: 0.9rem;
}

.go-warning {
  color: #f39c12;
  font-weight: bold;
}

/* Buttons */
.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn.primary {
  background: linear-gradient(90deg, #8b5a2b, #d4a574);
  color: #1a1a2e;
  font-weight: bold;
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(139, 90, 43, 0.4);
}

.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.go-btn {
  background: linear-gradient(90deg, #f39c12, #e67e22);
  color: #1a1a2e;
  font-weight: bold;
  animation: pulse-go 1s infinite;
}

@keyframes pulse-go {
  0%, 100% { box-shadow: 0 0 5px rgba(243, 156, 18, 0.5); }
  50% { box-shadow: 0 0 15px rgba(243, 156, 18, 0.8); }
}

/* Game Over */
.game-over {
  text-align: center;
  padding: 40px;
  background: rgba(139, 90, 43, 0.2);
  border-radius: 16px;
}

.game-over h2 {
  font-size: 2rem;
  margin-bottom: 15px;
}

.winner {
  font-size: 1.5rem;
  color: #d4a574;
  margin-bottom: 10px;
}

/* Starter card container */
.starter-card-container {
  width: 60px;
  height: 84px;
}

/* Card flip animation (legacy) */
.card-flip-container {
  perspective: 1000px;
}

.card.card-flippable {
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.5s ease-in-out;
}

.card.card-face-down {
  transform: rotateY(180deg);
}

.card.card-face-up {
  transform: rotateY(0deg);
}

.card .card-front,
.card .card-back-face {
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.card .card-front {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.card .card-back-face {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform: rotateY(180deg);
  background: linear-gradient(135deg, #8b5a2b, #6b4423);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card .card-back-face::before {
  content: '';
  width: 60%;
  height: 70%;
  background: repeating-linear-gradient(
    45deg,
    rgba(212, 165, 116, 0.3),
    rgba(212, 165, 116, 0.3) 2px,
    transparent 2px,
    transparent 8px
  );
  border-radius: 4px;
}

/* Reduced motion: instant flip */
@media (prefers-reduced-motion: reduce) {
  .card.card-flippable {
    transition: none;
  }
}
</style>
