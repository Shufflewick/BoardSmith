<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';

interface ScoringItem {
  category: string;
  points: number;
  cardIds: string[];
  description: string;
}

interface HandScore {
  playerName: string;
  playerSeat: number;
  cardIds: string[];
  items: ScoringItem[];
  totalPoints: number;
}

interface CribScore {
  playerName: string;
  cardIds: string[];
  items: ScoringItem[];
  totalPoints: number;
}

interface CardData {
  id: string;
  rank: string;
  suit: string;
}

const props = defineProps<{
  active: boolean;
  starterCard: CardData | null;
  nonDealerHand: HandScore | null;
  dealerHand: HandScore | null;
  crib: CribScore | null;
}>();

const emit = defineEmits<{
  (e: 'complete'): void;
}>();

// Animation state - reveal each section sequentially
const currentSection = ref<'none' | 'nonDealer' | 'dealer' | 'crib' | 'complete'>('none');
const revealedItemsNonDealer = ref<ScoringItem[]>([]);
const revealedItemsDealer = ref<ScoringItem[]>([]);
const revealedItemsCrib = ref<ScoringItem[]>([]);
const highlightedCardIds = ref<string[]>([]);
const showCelebration = ref(false);

// Animation timing
const SECTION_DELAY = 600;
const ITEM_REVEAL_DELAY = 800;
const HIGHLIGHT_DURATION = 500;
const CELEBRATION_DURATION = 1500;

let animationTimer: ReturnType<typeof setTimeout> | null = null;

// Computed totals
const grandTotal = computed(() => {
  return (props.nonDealerHand?.totalPoints ?? 0) +
         (props.dealerHand?.totalPoints ?? 0) +
         (props.crib?.totalPoints ?? 0);
});

// Parse card data directly from ID (e.g., "7S" → {id: "7S", rank: "7", suit: "S"})
// This is more reliable than looking up cards which may have moved in game state
function getCard(cardId: string): CardData {
  // Card IDs are like "7S", "10H", "JD", "QC", "AS", etc.
  // The suit is always the last character, rank is everything before it
  const suit = cardId.slice(-1);
  const rank = cardId.slice(0, -1);
  return { id: cardId, rank, suit };
}

// Start animation when overlay becomes active
watch(() => props.active, (active) => {
  if (active) {
    startAnimation();
  } else {
    resetAnimation();
  }
});

function startAnimation() {
  resetAnimation();
  // Start with non-dealer
  setTimeout(() => {
    currentSection.value = 'nonDealer';
    revealSectionItems('nonDealer');
  }, SECTION_DELAY);
}

function revealSectionItems(section: 'nonDealer' | 'dealer' | 'crib') {
  const itemsSource = section === 'nonDealer' ? props.nonDealerHand?.items :
                      section === 'dealer' ? props.dealerHand?.items :
                      props.crib?.items;
  const revealedArray = section === 'nonDealer' ? revealedItemsNonDealer :
                        section === 'dealer' ? revealedItemsDealer :
                        revealedItemsCrib;

  if (!itemsSource || itemsSource.length === 0) {
    // No items, move to next section
    moveToNextSection(section);
    return;
  }

  // Copy to local array to avoid undefined issues
  const items = [...itemsSource];
  let index = 0;

  function revealNext() {
    if (index >= items.length) {
      // Done with this section
      highlightedCardIds.value = [];
      setTimeout(() => moveToNextSection(section), SECTION_DELAY);
      return;
    }

    const item = items[index];
    highlightedCardIds.value = item.cardIds;

    animationTimer = setTimeout(() => {
      revealedArray.value.push(item);
      highlightedCardIds.value = [];
      index++;

      animationTimer = setTimeout(revealNext, ITEM_REVEAL_DELAY - HIGHLIGHT_DURATION);
    }, HIGHLIGHT_DURATION);
  }

  revealNext();
}

function moveToNextSection(currentSect: 'nonDealer' | 'dealer' | 'crib') {
  if (currentSect === 'nonDealer' && props.dealerHand) {
    currentSection.value = 'dealer';
    revealSectionItems('dealer');
  } else if ((currentSect === 'nonDealer' || currentSect === 'dealer') && props.crib) {
    currentSection.value = 'crib';
    revealSectionItems('crib');
  } else {
    finishAnimation();
  }
}

function finishAnimation() {
  currentSection.value = 'complete';
  if (grandTotal.value > 0) {
    showCelebration.value = true;
    animationTimer = setTimeout(() => {
      showCelebration.value = false;
    }, CELEBRATION_DURATION);
  }
}

function resetAnimation() {
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
  currentSection.value = 'none';
  revealedItemsNonDealer.value = [];
  revealedItemsDealer.value = [];
  revealedItemsCrib.value = [];
  highlightedCardIds.value = [];
  showCelebration.value = false;
}

function handleContinue() {
  emit('complete');
}

function skipAnimation() {
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
  revealedItemsNonDealer.value = [...(props.nonDealerHand?.items ?? [])];
  revealedItemsDealer.value = [...(props.dealerHand?.items ?? [])];
  revealedItemsCrib.value = [...(props.crib?.items ?? [])];
  highlightedCardIds.value = [];
  currentSection.value = 'complete';
}

// Helpers
function getSuitSymbol(suit: string): string {
  const symbols: Record<string, string> = { 'H': '\u2665', 'D': '\u2666', 'C': '\u2663', 'S': '\u2660' };
  return symbols[suit] || suit;
}

function getSuitColor(suit: string): string {
  return suit === 'H' || suit === 'D' ? '#e74c3c' : '#2c3e50';
}

function isCardHighlighted(cardId: string): boolean {
  return highlightedCardIds.value.includes(cardId);
}

function getCategoryIcon(category: string): string {
  switch (category) {
    case 'fifteen': return '15';
    case 'pair': return '2x';
    case 'run': return '\u2192';
    case 'flush': return '\u2660';
    case 'nobs': return 'J';
    default: return '\u2605';
  }
}

// Get cards for display in a section
function getSectionCards(cardIds: string[]): CardData[] {
  return cardIds.map(id => getCard(id));
}

// Calculate section running total
function getSectionTotal(items: ScoringItem[]): number {
  return items.reduce((sum, item) => sum + item.points, 0);
}

onUnmounted(() => {
  if (animationTimer) {
    clearTimeout(animationTimer);
  }
});
</script>

<template>
  <Teleport to="body">
    <Transition name="overlay">
      <div v-if="active" class="round-summary-overlay" @click="skipAnimation">
        <div class="round-summary-content" @click.stop>
          <!-- Header -->
          <div class="summary-header">
            <h2>Round Summary</h2>
          </div>

          <!-- Starter Card -->
          <div class="starter-section" v-if="starterCard">
            <span class="starter-label">Starter Card:</span>
            <div
              class="mini-card starter"
              :style="{ color: getSuitColor(starterCard.suit) }"
            >
              <span class="rank">{{ starterCard.rank }}</span>
              <span class="suit">{{ getSuitSymbol(starterCard.suit) }}</span>
            </div>
          </div>

          <!-- Scrollable content area -->
          <div class="sections-container">
            <!-- Non-Dealer Hand Section -->
            <div
              v-if="nonDealerHand"
              class="score-section"
              :class="{ active: currentSection === 'nonDealer' || currentSection === 'complete' }"
            >
              <div class="section-header">
                <span class="section-title">{{ nonDealerHand.playerName }}'s Hand</span>
                <span class="section-total" v-if="revealedItemsNonDealer.length > 0 || currentSection !== 'nonDealer'">
                  {{ getSectionTotal(revealedItemsNonDealer) }}
                </span>
              </div>

              <!-- Hand cards -->
              <div class="section-cards">
                <div
                  v-for="cardId in nonDealerHand.cardIds"
                  :key="cardId"
                  class="mini-card"
                  :class="{ highlighted: isCardHighlighted(cardId) }"
                  :style="{ color: getSuitColor(getCard(cardId)?.suit ?? 'S') }"
                >
                  <span class="rank">{{ getCard(cardId)?.rank }}</span>
                  <span class="suit">{{ getSuitSymbol(getCard(cardId)?.suit ?? 'S') }}</span>
                </div>
                <div
                  v-if="starterCard"
                  class="mini-card starter"
                  :class="{ highlighted: isCardHighlighted(starterCard.id) }"
                  :style="{ color: getSuitColor(starterCard.suit) }"
                >
                  <span class="rank">{{ starterCard.rank }}</span>
                  <span class="suit">{{ getSuitSymbol(starterCard.suit) }}</span>
                </div>
              </div>

              <!-- Scoring items -->
              <div class="section-items">
                <TransitionGroup name="score-item">
                  <div
                    v-for="(item, index) in revealedItemsNonDealer"
                    :key="`nd-${index}`"
                    class="score-item"
                  >
                    <span class="item-icon">{{ getCategoryIcon(item.category) }}</span>
                    <span class="item-description">{{ item.description }}</span>
                    <div class="item-cards">
                      <div
                        v-for="cardId in item.cardIds"
                        :key="cardId"
                        class="tiny-card"
                        :style="{ color: getSuitColor(getCard(cardId)?.suit ?? 'S') }"
                      >
                        {{ getCard(cardId)?.rank }}{{ getSuitSymbol(getCard(cardId)?.suit ?? 'S') }}
                      </div>
                    </div>
                    <span class="item-points">+{{ item.points }}</span>
                  </div>
                </TransitionGroup>
                <div v-if="nonDealerHand.items.length === 0 && currentSection !== 'none'" class="no-points">
                  No points
                </div>
              </div>
            </div>

            <!-- Dealer Hand Section -->
            <div
              v-if="dealerHand"
              class="score-section"
              :class="{ active: currentSection === 'dealer' || currentSection === 'complete' }"
            >
              <div class="section-header">
                <span class="section-title">{{ dealerHand.playerName }}'s Hand</span>
                <span class="section-total" v-if="revealedItemsDealer.length > 0 || currentSection === 'complete'">
                  {{ getSectionTotal(revealedItemsDealer) }}
                </span>
              </div>

              <!-- Hand cards -->
              <div class="section-cards">
                <div
                  v-for="cardId in dealerHand.cardIds"
                  :key="cardId"
                  class="mini-card"
                  :class="{ highlighted: isCardHighlighted(cardId) }"
                  :style="{ color: getSuitColor(getCard(cardId)?.suit ?? 'S') }"
                >
                  <span class="rank">{{ getCard(cardId)?.rank }}</span>
                  <span class="suit">{{ getSuitSymbol(getCard(cardId)?.suit ?? 'S') }}</span>
                </div>
                <div
                  v-if="starterCard"
                  class="mini-card starter"
                  :class="{ highlighted: isCardHighlighted(starterCard.id) }"
                  :style="{ color: getSuitColor(starterCard.suit) }"
                >
                  <span class="rank">{{ starterCard.rank }}</span>
                  <span class="suit">{{ getSuitSymbol(starterCard.suit) }}</span>
                </div>
              </div>

              <!-- Scoring items -->
              <div class="section-items">
                <TransitionGroup name="score-item">
                  <div
                    v-for="(item, index) in revealedItemsDealer"
                    :key="`d-${index}`"
                    class="score-item"
                  >
                    <span class="item-icon">{{ getCategoryIcon(item.category) }}</span>
                    <span class="item-description">{{ item.description }}</span>
                    <div class="item-cards">
                      <div
                        v-for="cardId in item.cardIds"
                        :key="cardId"
                        class="tiny-card"
                        :style="{ color: getSuitColor(getCard(cardId)?.suit ?? 'S') }"
                      >
                        {{ getCard(cardId)?.rank }}{{ getSuitSymbol(getCard(cardId)?.suit ?? 'S') }}
                      </div>
                    </div>
                    <span class="item-points">+{{ item.points }}</span>
                  </div>
                </TransitionGroup>
                <div v-if="dealerHand.items.length === 0 && currentSection === 'complete'" class="no-points">
                  No points
                </div>
              </div>
            </div>

            <!-- Crib Section -->
            <div
              v-if="crib"
              class="score-section crib-section"
              :class="{ active: currentSection === 'crib' || currentSection === 'complete' }"
            >
              <div class="section-header">
                <span class="section-title">{{ crib.playerName }}'s Crib</span>
                <span class="section-total" v-if="revealedItemsCrib.length > 0 || currentSection === 'complete'">
                  {{ getSectionTotal(revealedItemsCrib) }}
                </span>
              </div>

              <!-- Crib cards -->
              <div class="section-cards">
                <div
                  v-for="cardId in crib.cardIds"
                  :key="cardId"
                  class="mini-card"
                  :class="{ highlighted: isCardHighlighted(cardId) }"
                  :style="{ color: getSuitColor(getCard(cardId)?.suit ?? 'S') }"
                >
                  <span class="rank">{{ getCard(cardId)?.rank }}</span>
                  <span class="suit">{{ getSuitSymbol(getCard(cardId)?.suit ?? 'S') }}</span>
                </div>
                <div
                  v-if="starterCard"
                  class="mini-card starter"
                  :class="{ highlighted: isCardHighlighted(starterCard.id) }"
                  :style="{ color: getSuitColor(starterCard.suit) }"
                >
                  <span class="rank">{{ starterCard.rank }}</span>
                  <span class="suit">{{ getSuitSymbol(starterCard.suit) }}</span>
                </div>
              </div>

              <!-- Scoring items -->
              <div class="section-items">
                <TransitionGroup name="score-item">
                  <div
                    v-for="(item, index) in revealedItemsCrib"
                    :key="`c-${index}`"
                    class="score-item"
                  >
                    <span class="item-icon">{{ getCategoryIcon(item.category) }}</span>
                    <span class="item-description">{{ item.description }}</span>
                    <div class="item-cards">
                      <div
                        v-for="cardId in item.cardIds"
                        :key="cardId"
                        class="tiny-card"
                        :style="{ color: getSuitColor(getCard(cardId)?.suit ?? 'S') }"
                      >
                        {{ getCard(cardId)?.rank }}{{ getSuitSymbol(getCard(cardId)?.suit ?? 'S') }}
                      </div>
                    </div>
                    <span class="item-points">+{{ item.points }}</span>
                  </div>
                </TransitionGroup>
                <div v-if="crib.items.length === 0 && currentSection === 'complete'" class="no-points">
                  No points
                </div>
              </div>
            </div>
          </div>

          <!-- Grand Total -->
          <div class="grand-total" :class="{ celebrating: showCelebration }">
            <span class="total-label">Round Total:</span>
            <span class="total-value">{{ grandTotal }}</span>
          </div>

          <!-- Celebration Effect -->
          <div v-if="showCelebration" class="celebration">
            <div class="confetti" v-for="i in 20" :key="i" :style="{ '--i': i }"></div>
          </div>

          <!-- Continue Button -->
          <Transition name="fade">
            <button v-if="currentSection === 'complete'" class="continue-btn" @click="handleContinue">
              Continue to Next Round
            </button>
          </Transition>

          <!-- Skip hint -->
          <div v-if="currentSection !== 'complete' && currentSection !== 'none'" class="skip-hint">
            Click anywhere to skip
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.round-summary-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.round-summary-content {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 20px;
  padding: 25px 30px;
  max-width: 700px;
  width: 95%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  border: 2px solid rgba(212, 165, 116, 0.3);
  position: relative;
  overflow: hidden;
}

.summary-header {
  text-align: center;
  margin-bottom: 15px;
  flex-shrink: 0;
}

.summary-header h2 {
  color: #d4a574;
  font-size: 1.6rem;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 2px;
}

/* Starter card display */
.starter-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 15px;
  flex-shrink: 0;
}

.starter-label {
  color: #888;
  font-size: 0.9rem;
}

/* Scrollable sections container */
.sections-container {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  margin-bottom: 15px;
}

/* Score sections */
.score-section {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 15px;
  margin-bottom: 12px;
  opacity: 0.4;
  transition: all 0.3s ease;
}

.score-section.active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
}

.score-section.crib-section {
  border: 1px dashed rgba(212, 165, 116, 0.3);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.section-title {
  color: #d4a574;
  font-size: 1.1rem;
  font-weight: bold;
}

.section-total {
  color: #4ade80;
  font-size: 1.3rem;
  font-weight: bold;
}

/* Mini cards in sections */
.section-cards {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.mini-card {
  width: 40px;
  height: 56px;
  background: #fff;
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-size: 0.85rem;
}

.mini-card .rank {
  font-size: 0.9rem;
  line-height: 1;
}

.mini-card .suit {
  font-size: 1rem;
  line-height: 1;
}

.mini-card.highlighted {
  transform: translateY(-8px) scale(1.1);
  box-shadow: 0 8px 20px rgba(212, 165, 116, 0.6), 0 0 15px rgba(212, 165, 116, 0.4);
  border: 2px solid #d4a574;
}

.mini-card.starter {
  border: 2px dashed rgba(212, 165, 116, 0.5);
}

/* Section scoring items */
.section-items {
  min-height: 30px;
}

.score-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.item-icon {
  width: 26px;
  height: 26px;
  background: rgba(212, 165, 116, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  color: #d4a574;
  font-weight: bold;
  flex-shrink: 0;
}

.item-description {
  flex: 1;
  color: #ccc;
  font-size: 0.9rem;
  min-width: 100px;
}

.item-cards {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.tiny-card {
  background: rgba(255, 255, 255, 0.9);
  padding: 2px 5px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: bold;
}

.item-points {
  color: #4ade80;
  font-weight: bold;
  font-size: 1rem;
  flex-shrink: 0;
}

.no-points {
  text-align: center;
  color: #666;
  font-style: italic;
  padding: 10px 0;
  font-size: 0.9rem;
}

/* Grand Total */
.grand-total {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  padding: 15px;
  background: rgba(212, 165, 116, 0.15);
  border-radius: 12px;
  margin-bottom: 15px;
  transition: all 0.3s ease;
  flex-shrink: 0;
}

.grand-total.celebrating {
  background: rgba(212, 165, 116, 0.3);
  transform: scale(1.02);
}

.total-label {
  color: #aaa;
  font-size: 1.1rem;
}

.total-value {
  color: #d4a574;
  font-size: 2rem;
  font-weight: bold;
}

/* Celebration */
.celebration {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  overflow: hidden;
}

.confetti {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #d4a574;
  top: -10px;
  left: calc(var(--i) * 5%);
  animation: confetti-fall 1.5s ease-out forwards;
  animation-delay: calc(var(--i) * 0.05s);
  border-radius: 2px;
}

.confetti:nth-child(even) {
  background: #f39c12;
}

.confetti:nth-child(3n) {
  background: #4ade80;
  width: 8px;
  height: 8px;
}

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translateY(500px) rotate(720deg);
    opacity: 0;
  }
}

/* Continue Button */
.continue-btn {
  display: block;
  width: 100%;
  padding: 15px;
  background: linear-gradient(90deg, #8b5a2b, #d4a574);
  border: none;
  border-radius: 10px;
  color: #1a1a2e;
  font-size: 1.1rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.continue-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(139, 90, 43, 0.4);
}

.skip-hint {
  text-align: center;
  color: #555;
  font-size: 0.8rem;
  margin-top: 10px;
  flex-shrink: 0;
}

/* Transitions */
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity 0.3s ease;
}

.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
}

.score-item-enter-active {
  transition: all 0.4s ease;
}

.score-item-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
