<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import ScoringOverlay from './ScoringOverlay.vue';
import RoundSummary from './RoundSummary.vue';

interface Card {
  id: string;
  name: string;
  attributes?: {
    rank?: string;
    suit?: string;
  };
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
  action: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  actionArgs: Record<string, unknown>;
  executeAction: (name: string) => Promise<void>;
}>();

// Selected cards - uses shared actionArgs.cards so RightNow button can access it
const selectedCards = computed({
  get: () => (props.actionArgs.cards as string[]) || [],
  set: (value: string[]) => {
    props.actionArgs.cards = value;
  }
});
const isPerformingAction = ref(false);

// Computed properties
const cribbagePhase = computed(() => props.gameView?.attributes?.cribbagePhase || 'dealing');
const runningTotal = computed(() => props.gameView?.attributes?.runningTotal || 0);
const dealerPosition = computed(() => props.gameView?.attributes?.dealerPosition ?? 0);
const targetScore = computed(() => props.gameView?.attributes?.targetScore || 121);

const myHand = computed<Card[]>(() => {
  if (!props.gameView) return [];
  const handElement = props.gameView.children?.find(
    (c: any) => c.attributes?.$type === 'hand' && c.attributes?.player?.position === props.playerPosition
  );
  return handElement?.children?.filter((c: any) => c.attributes?.rank) || [];
});

const opponentHand = computed(() => {
  if (!props.gameView) return [];
  const handElement = props.gameView.children?.find(
    (c: any) => c.attributes?.$type === 'hand' && c.attributes?.player?.position !== props.playerPosition
  );
  return handElement?.children || [];
});

const crib = computed(() => {
  if (!props.gameView) return [];
  const cribElement = props.gameView.children?.find((c: any) => c.className === 'Crib');
  return cribElement?.children || [];
});

const playArea = computed(() => {
  if (!props.gameView) return [];
  const playElement = props.gameView.children?.find((c: any) => c.className === 'PlayArea');
  return playElement?.children?.filter((c: any) => c.attributes?.rank) || [];
});

const starterCard = computed(() => {
  if (!props.gameView) return null;
  const starterElement = props.gameView.children?.find((c: any) => c.className === 'StarterArea');
  const card = starterElement?.children?.find((c: any) => c.attributes?.rank);
  return card || null;
});

const myScore = computed(() => {
  if (!props.gameView) return 0;
  const playerData = props.gameView.children?.find(
    (c: any) => c.attributes?.$type === 'hand' && c.attributes?.player?.position === props.playerPosition
  );
  return playerData?.attributes?.player?.score ?? 0;
});

const opponentScore = computed(() => {
  if (!props.gameView) return 0;
  const playerData = props.gameView.children?.find(
    (c: any) => c.attributes?.$type === 'hand' && c.attributes?.player?.position !== props.playerPosition
  );
  return playerData?.attributes?.player?.score ?? 0;
});

const isDealer = computed(() => dealerPosition.value === props.playerPosition);

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
    await props.executeAction('acknowledgeScore');
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
    await props.executeAction('acknowledgeScore');
  }
}

// Helpers
function getSuitSymbol(suit: string): string {
  const symbols: Record<string, string> = { 'H': '\u2665', 'D': '\u2666', 'C': '\u2663', 'S': '\u2660' };
  return symbols[suit] || suit;
}

function getSuitColor(suit: string): string {
  return suit === 'H' || suit === 'D' ? '#e74c3c' : '#2c3e50';
}

function getCardPointValue(rank: string): number {
  if (rank === 'A') return 1;
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  return parseInt(rank, 10);
}

function isCardPlayable(rank: string): boolean {
  if (cribbagePhase.value !== 'play') return true;
  const cardValue = getCardPointValue(rank);
  return runningTotal.value + cardValue <= 31;
}

function toggleCardSelection(cardName: string) {
  if (!props.isMyTurn || isPerformingAction.value) return;

  const current = selectedCards.value;
  const index = current.indexOf(cardName);
  if (index >= 0) {
    // Remove card - create new array without it
    selectedCards.value = current.filter((_, i) => i !== index);
  } else {
    if (cribbagePhase.value === 'discarding' && current.length < 2) {
      // Add card - create new array with it
      selectedCards.value = [...current, cardName];
    } else if (cribbagePhase.value === 'play') {
      const card = myHand.value.find((c: Card) => c.name === cardName);
      const rank = card?.attributes?.rank;
      if (rank && isCardPlayable(rank)) {
        selectedCards.value = [cardName];
      }
    }
  }
}

// Actions - call action() directly with proper parameters
async function performDiscard() {
  if (selectedCards.value.length !== 2 || isPerformingAction.value) return;

  isPerformingAction.value = true;
  try {
    // Discard action expects card1 and card2 parameters
    const result = await props.action('discard', {
      card1: selectedCards.value[0],
      card2: selectedCards.value[1],
    });
    if (result.success) {
      selectedCards.value = [];
    }
  } finally {
    isPerformingAction.value = false;
  }
}

async function performPlayCard() {
  if (selectedCards.value.length !== 1 || isPerformingAction.value) {
    return;
  }

  const cardName = selectedCards.value[0];
  // Find the card object to get its numeric ID (chooseElement needs ID, not name)
  const card = myHand.value.find((c: Card) => c.name === cardName);
  if (!card) {
    return;
  }

  isPerformingAction.value = true;
  try {
    // Send numeric ID for chooseElement selection
    await props.action('playCard', {
      card: parseInt(card.id, 10),
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
    await props.executeAction('sayGo');
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
  <div class="cribbage-board">
    <!-- Game Over -->
    <div v-if="gameOver" class="game-over">
      <h2>Game Over!</h2>
      <p class="winner">{{ winner }}</p>
      <p>Your score: {{ myScore }} | Opponent: {{ opponentScore }}</p>
    </div>

    <template v-else>
      <!-- Phase indicator -->
      <div class="phase-indicator">
        <span class="phase-badge">{{ cribbagePhase }}</span>
        <span v-if="cribbagePhase === 'play'" class="running-total">Count: {{ runningTotal }}</span>
      </div>

      <!-- Play Area (during play phase) -->
      <div v-if="cribbagePhase === 'play' || playArea.length > 0" class="play-area">
        <div class="play-area-header">
          <span>Play Area</span>
        </div>
        <div class="played-cards">
          <div
            v-for="card in playArea"
            :key="card.id"
            class="card small"
            :style="{ color: getSuitColor(card.attributes?.suit) }"
          >
            <span class="rank">{{ card.attributes?.rank }}</span>
            <span class="suit">{{ getSuitSymbol(card.attributes?.suit) }}</span>
          </div>
          <div v-if="playArea.length === 0" class="no-cards">No cards played yet</div>
        </div>
      </div>

      <!-- Middle Area: Starter & Crib -->
      <div class="middle-area">
        <div class="starter-area">
          <div class="area-label">Starter</div>
          <div v-if="starterCard" class="card" :style="{ color: getSuitColor(starterCard.attributes?.suit) }">
            <span class="rank">{{ starterCard.attributes?.rank }}</span>
            <span class="suit">{{ getSuitSymbol(starterCard.attributes?.suit) }}</span>
          </div>
          <div v-else class="card-placeholder">
            <span>?</span>
          </div>
        </div>

        <div class="crib-area">
          <div class="area-label">Crib ({{ isDealer ? 'Yours' : "Opponent's" }})</div>
          <div class="crib-cards">
            <div v-for="(card, i) in crib" :key="i" class="card-back small">
              <span v-if="card.attributes?.rank">{{ card.attributes.rank }}{{ getSuitSymbol(card.attributes.suit) }}</span>
              <span v-else>?</span>
            </div>
            <div v-if="crib.length === 0" class="card-placeholder small">{{ crib.length }} cards</div>
          </div>
        </div>
      </div>

      <!-- My Hand -->
      <div class="my-hand-area">
        <div class="hand-label">Your Hand ({{ myHand.length }} cards)</div>
        <div class="my-cards">
          <div
            v-for="card in myHand"
            :key="card.name"
            class="card"
            :class="{
              selected: selectedCards.includes(card.name),
              clickable: isMyTurn && !isPerformingAction && isCardPlayable(card.attributes?.rank || ''),
              unplayable: cribbagePhase === 'play' && !isCardPlayable(card.attributes?.rank || '')
            }"
            :style="{ color: getSuitColor(card.attributes?.suit || '') }"
            @click="toggleCardSelection(card.name)"
          >
            <span class="rank">{{ card.attributes?.rank }}</span>
            <span class="suit">{{ getSuitSymbol(card.attributes?.suit || '') }}</span>
            <span class="point-value">{{ getCardPointValue(card.attributes?.rank || '') }}</span>
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

/* Phase indicator */
.phase-indicator {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
}

.phase-badge {
  background: rgba(139, 90, 43, 0.3);
  color: #d4a574;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.8rem;
  text-transform: uppercase;
}

.running-total {
  background: rgba(139, 90, 43, 0.3);
  color: #d4a574;
  padding: 6px 12px;
  border-radius: 8px;
  font-weight: bold;
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
}

.played-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 60px;
}

/* Middle Area */
.middle-area {
  display: flex;
  justify-content: center;
  gap: 40px;
}

.starter-area, .crib-area {
  text-align: center;
}

.area-label {
  color: #aaa;
  font-size: 0.85rem;
  margin-bottom: 8px;
}

.crib-cards {
  display: flex;
  gap: 4px;
  justify-content: center;
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
</style>
