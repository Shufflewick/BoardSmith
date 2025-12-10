<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

interface ScoringItem {
  category: string;
  points: number;
  cardIds: string[];
  description: string;
}

interface CardData {
  id: string;
  rank: string;
  suit: string;
}

const props = defineProps<{
  active: boolean;
  type: 'hand' | 'crib' | null;
  playerName: string;
  handCards: CardData[];
  starterCard: CardData | null;
  items: ScoringItem[];
  totalPoints: number;
}>();

const emit = defineEmits<{
  (e: 'complete'): void;
}>();

// Animation state
const currentItemIndex = ref(-1);
const revealedItems = ref<ScoringItem[]>([]);
const runningTotal = ref(0);
const highlightedCardIds = ref<string[]>([]);
const showCelebration = ref(false);
const animationComplete = ref(false);

// Animation timing (milliseconds)
const ITEM_REVEAL_DELAY = 1200;
const HIGHLIGHT_DURATION = 800;
const CELEBRATION_DURATION = 1500;

let animationTimer: ReturnType<typeof setTimeout> | null = null;

// All cards being displayed (hand + starter)
const allCards = computed(() => {
  const cards = [...props.handCards];
  if (props.starterCard) {
    cards.push(props.starterCard);
  }
  return cards;
});

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

  if (props.items.length === 0) {
    // No scoring items - show "no points" briefly then complete
    setTimeout(() => {
      animationComplete.value = true;
    }, 1000);
    return;
  }

  // Start revealing items one by one
  revealNextItem();
}

function revealNextItem() {
  const nextIndex = currentItemIndex.value + 1;

  if (nextIndex >= props.items.length) {
    // All items revealed - show celebration
    finishAnimation();
    return;
  }

  currentItemIndex.value = nextIndex;
  const item = props.items[nextIndex];

  // Highlight the cards involved
  highlightedCardIds.value = item.cardIds;

  // After highlight duration, add to revealed list and continue
  animationTimer = setTimeout(() => {
    revealedItems.value.push(item);
    runningTotal.value += item.points;

    // Brief pause then reveal next
    animationTimer = setTimeout(() => {
      revealNextItem();
    }, ITEM_REVEAL_DELAY - HIGHLIGHT_DURATION);
  }, HIGHLIGHT_DURATION);
}

function finishAnimation() {
  highlightedCardIds.value = [];

  if (props.totalPoints > 0) {
    showCelebration.value = true;

    animationTimer = setTimeout(() => {
      showCelebration.value = false;
      animationComplete.value = true;
    }, CELEBRATION_DURATION);
  } else {
    animationComplete.value = true;
  }
}

function resetAnimation() {
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
  currentItemIndex.value = -1;
  revealedItems.value = [];
  runningTotal.value = 0;
  highlightedCardIds.value = [];
  showCelebration.value = false;
  animationComplete.value = false;
}

function handleContinue() {
  emit('complete');
}

function skipAnimation() {
  // Skip to end
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
  revealedItems.value = [...props.items];
  runningTotal.value = props.totalPoints;
  highlightedCardIds.value = [];
  animationComplete.value = true;
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

function isStarterCard(cardId: string): boolean {
  return props.starterCard?.id === cardId;
}

function getCategoryIcon(category: string): string {
  switch (category) {
    case 'fifteen': return '15';
    case 'pair': return '2x';
    case 'run': return '\u2192'; // Arrow
    case 'flush': return '\u2660'; // Spade for flush
    case 'nobs': return 'J';
    default: return '\u2605'; // Star
  }
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
      <div v-if="active" class="scoring-overlay" @click="skipAnimation">
        <div class="scoring-content" @click.stop>
          <!-- Header -->
          <div class="scoring-header">
            <h2>{{ playerName }}'s {{ type === 'crib' ? 'Crib' : 'Hand' }}</h2>
          </div>

          <!-- Cards Display -->
          <div class="cards-display">
            <div
              v-for="card in allCards"
              :key="card.id"
              class="scoring-card"
              :class="{
                highlighted: isCardHighlighted(card.id),
                starter: isStarterCard(card.id)
              }"
              :style="{ color: getSuitColor(card.suit) }"
            >
              <span class="rank">{{ card.rank }}</span>
              <span class="suit">{{ getSuitSymbol(card.suit) }}</span>
              <span v-if="isStarterCard(card.id)" class="starter-label">Cut</span>
            </div>
          </div>

          <!-- Scoring Items -->
          <div class="scoring-items">
            <TransitionGroup name="score-item">
              <div
                v-for="(item, index) in revealedItems"
                :key="index"
                class="score-item"
              >
                <span class="item-icon">{{ getCategoryIcon(item.category) }}</span>
                <span class="item-description">{{ item.description }}</span>
                <span class="item-points">+{{ item.points }}</span>
              </div>
            </TransitionGroup>

            <div v-if="items.length === 0 && animationComplete" class="no-points">
              No points
            </div>
          </div>

          <!-- Running Total -->
          <div class="running-total" :class="{ celebrating: showCelebration }">
            <span class="total-label">Total:</span>
            <span class="total-value">{{ runningTotal }}</span>
          </div>

          <!-- Celebration Effect -->
          <div v-if="showCelebration" class="celebration">
            <div class="confetti" v-for="i in 20" :key="i" :style="{ '--i': i }"></div>
            <div class="points-burst">+{{ totalPoints }}</div>
          </div>

          <!-- Continue Button -->
          <Transition name="fade">
            <button v-if="animationComplete" class="continue-btn" @click="handleContinue">
              Continue
            </button>
          </Transition>

          <!-- Skip hint -->
          <div v-if="!animationComplete" class="skip-hint">
            Click anywhere to skip
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scoring-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.scoring-content {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 20px;
  padding: 30px 40px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  border: 2px solid rgba(212, 165, 116, 0.3);
  position: relative;
  overflow: hidden;
}

.scoring-header {
  text-align: center;
  margin-bottom: 25px;
}

.scoring-header h2 {
  color: #d4a574;
  font-size: 1.5rem;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 2px;
}

/* Cards Display */
.cards-display {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 30px;
  flex-wrap: wrap;
}

.scoring-card {
  width: 60px;
  height: 84px;
  background: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
  position: relative;
}

.scoring-card .rank {
  font-size: 1.3rem;
}

.scoring-card .suit {
  font-size: 1.5rem;
}

.scoring-card.highlighted {
  transform: translateY(-15px) scale(1.1);
  box-shadow: 0 10px 30px rgba(212, 165, 116, 0.6), 0 0 20px rgba(212, 165, 116, 0.4);
  border: 3px solid #d4a574;
}

.scoring-card.starter {
  border: 2px dashed rgba(212, 165, 116, 0.5);
}

.starter-label {
  position: absolute;
  bottom: -20px;
  font-size: 0.6rem;
  color: #d4a574;
  background: rgba(0, 0, 0, 0.5);
  padding: 2px 6px;
  border-radius: 4px;
}

/* Scoring Items */
.scoring-items {
  min-height: 150px;
  margin-bottom: 20px;
}

.score-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 15px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  margin-bottom: 8px;
}

.item-icon {
  width: 30px;
  height: 30px;
  background: rgba(212, 165, 116, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  color: #d4a574;
  font-weight: bold;
}

.item-description {
  flex: 1;
  color: #ccc;
  font-size: 0.95rem;
}

.item-points {
  color: #4ade80;
  font-weight: bold;
  font-size: 1.1rem;
}

.no-points {
  text-align: center;
  color: #888;
  font-style: italic;
  padding: 40px 0;
}

/* Running Total */
.running-total {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  padding: 15px;
  background: rgba(212, 165, 116, 0.1);
  border-radius: 12px;
  margin-bottom: 20px;
  transition: all 0.3s ease;
}

.running-total.celebrating {
  background: rgba(212, 165, 116, 0.3);
  transform: scale(1.05);
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
    transform: translateY(400px) rotate(720deg);
    opacity: 0;
  }
}

.points-burst {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 4rem;
  font-weight: bold;
  color: #4ade80;
  text-shadow: 0 0 30px rgba(74, 222, 128, 0.5);
  animation: burst 1.5s ease-out forwards;
}

@keyframes burst {
  0% {
    transform: translate(-50%, -50%) scale(0);
    opacity: 0;
  }
  30% {
    transform: translate(-50%, -50%) scale(1.2);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
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
}

.continue-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 20px rgba(139, 90, 43, 0.4);
}

.skip-hint {
  text-align: center;
  color: #666;
  font-size: 0.8rem;
  margin-top: 15px;
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
