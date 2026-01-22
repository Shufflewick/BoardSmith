<!--
  Demo: Complex UI Interactions - GameBoard

  This component demonstrates how to use actionController to detect action state
  and handle selections directly from a custom UI.

  Key Features Demonstrated:
  1. Using actionController.currentAction to detect which action is being filled
  2. Using actionController.currentSelection to show which selection step the player is on
  3. Using actionController.fill() to submit selections from custom UI elements
  4. Different visual styles for different actions
  5. Full integration with actionController for "pit of success" pattern
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { UseActionControllerReturn } from '@boardsmith/ui';
import { findPlayerHand, findElement, getElementCount, useAutoFlyingElements, FlyingCardsOverlay, findAllHands } from '@boardsmith/ui';

// Props from GameShell
const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionArgs: Record<string, unknown>;
  actionController: UseActionControllerReturn;
  setBoardPrompt: (prompt: string | null) => void;
  canUndo?: boolean;
  undo?: () => Promise<void>;
}>();

// ============================================
// ACTION CONTROLLER - SINGLE SOURCE OF TRUTH
// ============================================
// Use actionController for action state - this is the "pit of success" pattern
// Use computed to safely access these since actionController may be undefined initially
const currentAction = computed(() => props.actionController?.currentAction.value ?? null);
const currentSelection = computed(() => props.actionController?.currentSelection.value ?? null);

// Which selection step are they on?
const currentSelectionName = computed(() => currentSelection.value?.name || null);

// Compute the selection index by counting filled args
const currentSelectionIndex = computed(() => {
  if (!currentAction.value) return 0;
  // Count how many selections have been filled
  const args = props.actionController?.currentArgs.value ?? {};
  return Object.keys(args).length;
});

// ============================================
// ACTION-SPECIFIC STATES
// ============================================

// Is the player actively in each action flow?
const isCollecting = computed(() => currentAction.value === 'collect');
const isDiscarding = computed(() => currentAction.value === 'discard');
const isTrading = computed(() => currentAction.value === 'trade');
const isGifting = computed(() => currentAction.value === 'gift');
const isScoring = computed(() => currentAction.value === 'score');

// Get action-specific class for styling
const actionClass = computed(() => {
  if (isCollecting.value) return 'action-collect';
  if (isDiscarding.value) return 'action-discard';
  if (isTrading.value) return 'action-trade';
  if (isGifting.value) return 'action-gift';
  if (isScoring.value) return 'action-score';
  return '';
});

// Human-readable action descriptions
const actionDescriptions: Record<string, { name: string; color: string; icon: string }> = {
  collect: { name: 'Collect', color: '#00d9ff', icon: '📥' },
  discard: { name: 'Discard', color: '#ff6b6b', icon: '🗑️' },
  trade: { name: 'Trade', color: '#ffd93d', icon: '🔄' },
  gift: { name: 'Gift', color: '#6bcb77', icon: '🎁' },
  score: { name: 'Score', color: '#a855f7', icon: '⭐' },
};

// Get current action info
const currentActionInfo = computed(() => {
  if (!currentAction.value) return null;
  return actionDescriptions[currentAction.value] || { name: currentAction.value, color: '#888', icon: '?' };
});

// Selection step descriptions for each action
const selectionStepDescriptions: Record<string, Record<string, string>> = {
  discard: { card: 'Select a card to discard' },
  trade: { myCard: 'Select YOUR card to trade', targetPlayer: 'Select a player to trade with' },
  gift: { card: 'Select a card to gift', recipient: 'Select who to gift to' },
  score: { suit: 'Choose a suit to score' },
};

// Get current step description
const currentStepDescription = computed(() => {
  if (!currentAction.value || !currentSelectionName.value) return null;
  const actionSteps = selectionStepDescriptions[currentAction.value];
  if (!actionSteps) return null;
  return actionSteps[currentSelectionName.value] || `Select: ${currentSelectionName.value}`;
});

// ============================================
// GAME STATE
// ============================================

// Get player's hand
const myHand = computed(() => findPlayerHand(props.gameView, props.playerPosition));

// Get my cards
const myCards = computed(() => {
  if (!myHand.value?.children) return [];
  return myHand.value.children.map((card: any) => ({
    id: card.id,
    rank: card.attributes?.rank || '?',
    suit: card.attributes?.suit || '?',
  }));
});

// Get deck
const deck = computed(() => findElement(props.gameView, { type: 'deck' }));
const deckCount = computed(() => getElementCount(deck.value));

// Get discard pile
const discardPile = computed(() => findElement(props.gameView, { className: 'DiscardPile' }));
const discardCount = computed(() => getElementCount(discardPile.value));

// Get other players - derive from hands in the element tree since gameView.players may be empty
const otherPlayers = computed(() => {
  // First try gameView.players
  if (props.gameView?.players?.length > 0) {
    return props.gameView.players.filter((p: any) => p.position !== props.playerPosition);
  }
  // Fallback: derive from hands in element tree
  const allHands = findAllHands(props.gameView);
  const opponents = allHands
    .filter((h: any) => h.attributes?.player?.position !== props.playerPosition)
    .map((h: any) => ({
      position: h.attributes?.player?.position,
      name: h.attributes?.player?.name || `Player ${h.attributes?.player?.position}`,
      // Include other player data if available
      ...h.attributes?.player
    }));
  return opponents;
});

// Get opponent hand count
function getOpponentHandCount(position: number): number {
  const hand = findPlayerHand(props.gameView, position);
  return getElementCount(hand);
}

// Get available suits from player's hand (for Score action)
const availableSuits = computed(() => {
  const suits = new Set<string>();
  for (const card of myCards.value) {
    suits.add(card.suit);
  }
  return [...suits];
});

// Suit display info
const suitInfo: Record<string, { symbol: string; name: string; color: string }> = {
  H: { symbol: '♥', name: 'Hearts', color: '#e74c3c' },
  D: { symbol: '♦', name: 'Diamonds', color: '#e74c3c' },
  C: { symbol: '♣', name: 'Clubs', color: '#2c3e50' },
  S: { symbol: '♠', name: 'Spades', color: '#2c3e50' },
};

// Is suit selection active?
const isSuitSelectionActive = computed(() =>
  isScoring.value && currentSelectionName.value === 'suit'
);

// Handle suit selection - use actionController to fill the selection
async function handleSuitClick(suit: string) {
  if (!props.actionController) return;
  if (!isSuitSelectionActive.value) return;
  if (!currentSelection.value) return;

  // Get available choices from actionController
  const choices = props.actionController.getChoices(currentSelection.value);

  // Check if this suit is a valid choice
  const isValidSuit = choices.some((c) => c.value === suit);
  if (!isValidSuit) return;

  // Fill with the suit string value
  await props.actionController.fill('suit', suit);
}

// ============================================
// FLYING CARDS ANIMATION
// ============================================

// Element refs for animation endpoints
const deckRef = ref<HTMLElement | null>(null);
const handRef = ref<HTMLElement | null>(null);
const discardRef = ref<HTMLElement | null>(null);
const opponentRefs = ref<Map<number, HTMLElement>>(new Map());

// Pre-create opponent hand element refs (for up to 6 players)
const opponentHandRefs = [
  ref<HTMLElement | null>(null),
  ref<HTMLElement | null>(null),
  ref<HTMLElement | null>(null),
  ref<HTMLElement | null>(null),
  ref<HTMLElement | null>(null),
  ref<HTMLElement | null>(null),
];

// Store ref for opponent elements (updates both the Map for backward compat and the array for auto-flying)
function setOpponentRef(position: number, el: HTMLElement | null) {
  if (el) {
    opponentRefs.value.set(position, el);
  } else {
    opponentRefs.value.delete(position);
  }
  // Also update the array-based refs for auto-flying cards
  if (opponentHandRefs[position]) {
    opponentHandRefs[position].value = el;
  }
}

// Pre-create opponent hand element computed refs
const opponentHand0 = computed(() => findPlayerHand(props.gameView, 0));
const opponentHand1 = computed(() => findPlayerHand(props.gameView, 1));
const opponentHand2 = computed(() => findPlayerHand(props.gameView, 2));
const opponentHand3 = computed(() => findPlayerHand(props.gameView, 3));
const opponentHand4 = computed(() => findPlayerHand(props.gameView, 4));
const opponentHand5 = computed(() => findPlayerHand(props.gameView, 5));
const opponentHandElements = [opponentHand0, opponentHand1, opponentHand2, opponentHand3, opponentHand4, opponentHand5];

// Helper to get opponent ref by position
function getOpponentHandRef(position: number) {
  return opponentHandRefs[position] || opponentHandRefs[0];
}

// Auto-flying elements - automatically animates cards between containers
const { flyingElements: flyingCards } = useAutoFlyingElements({
  gameView: () => props.gameView,
  // Use a function for containers to support dynamic opponent hands
  containers: () => {
    const containerList = [
      // Static containers
      { element: deck, ref: deckRef },
      { element: myHand, ref: handRef },
      { element: discardPile, ref: discardRef },
    ];

    // Add opponent hand containers (only those with valid refs)
    for (const opponent of otherPlayers.value) {
      const pos = opponent.position;
      const handElement = opponentHandElements[pos]?.value;
      const handRef = opponentHandRefs[pos]?.value;
      if (handElement && handRef) {
        containerList.push({
          element: opponentHandElements[pos],
          ref: opponentHandRefs[pos],
        });
      }
    }

    return containerList;
  },
  getElementData: (element) => ({
    rank: element.rank || element.attributes?.rank,
    suit: element.suit || element.attributes?.suit,
    faceUp: false,
    backColor: 'linear-gradient(135deg, #c41e3a 0%, #8b0000 100%)',
  }),
  flip: () => true,
  duration: 500
});

// ============================================
// VISUAL HELPERS
// ============================================

// Local suit helpers (match the getSuitSymbol/getSuitColor from @boardsmith/ui signature)
function getLocalSuitSymbol(suit: string): string {
  const symbols: Record<string, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
  return symbols[suit] || suit;
}

function getLocalSuitColor(suit: string): string {
  return suit === 'H' || suit === 'D' ? '#e74c3c' : '#2c3e50';
}

// Should this card be highlighted based on current action?
function shouldHighlightCard(card: { id: number; suit: string }): boolean {
  // When scoring, highlight cards of the selected suit
  if (isScoring.value && props.actionArgs.suit === card.suit) {
    return true;
  }
  // Check if this card is selected in actionArgs
  // fromElements() stores element IDs (numbers), not objects
  const selectedCard = props.actionArgs.card || props.actionArgs.myCard;
  if (typeof selectedCard === 'number') {
    return selectedCard === card.id;
  }
  // Also check preview keys for in-progress selections
  const previewCard = props.actionArgs._preview_card || props.actionArgs._preview_myCard;
  if (typeof previewCard === 'number') {
    return previewCard === card.id;
  }
  return false;
}

// Check if we're in an element selection step for cards (fromElements)
function isCardSelectable(cardId: number): boolean {
  if (!currentAction.value || !currentSelection.value) return false;
  // Check if this is a fromElements selection type (type is 'element' singular)
  if (currentSelection.value.type !== 'element') return false;

  // Check if this card is in the valid elements list (reactive computed)
  const validIds = props.actionController.validElements.value.map((e: any) => e.id);
  return validIds.includes(cardId);
}

// Handle card click - fill the selection with the card ID
async function handleCardClick(card: { id: number }) {
  if (!props.actionController) return;
  if (!isCardSelectable(card.id)) return;
  if (!currentSelection.value) return;

  // Fill with the element ID (fromElements expects the ID)
  await props.actionController.fill(currentSelection.value.name, card.id);
}

// Handle opponent click - for chooseFrom selections (targetPlayer, recipient)
async function handleOpponentClick(position: number) {
  if (!props.actionController) return;
  if (!currentAction.value || !currentSelection.value) return;

  // Check if this is a choice selection type
  if (currentSelection.value.type !== 'choice') return;

  // Get available choices from actionController
  const choices = props.actionController.getChoices(currentSelection.value);

  // Find the choice for this player position
  const playerChoice = choices.find((c: any) => c.value?.value === position);
  if (!playerChoice) return;

  // Fill with the choice value (player choice object)
  await props.actionController.fill(currentSelection.value.name, playerChoice.value);
}

// Is opponent selectable? Check if we're in a player choice selection
function isOpponentSelectable(position: number): boolean {
  if (!props.actionController) return false;
  if (!currentAction.value || !currentSelection.value) return false;

  // Check if this is a choice selection type
  if (currentSelection.value.type !== 'choice') return false;

  // Get available choices from actionController
  const choices = props.actionController.getChoices(currentSelection.value);

  // Check if this player position is a valid choice
  return choices.some((c: any) => c.value?.value === position);
}

// Handle action button click - starts the action flow
function handleActionClick(actionName: string) {
  if (!props.actionController) return;
  if (!props.isMyTurn) return;
  // Use actionController.start for all actions - will auto-execute if no selections needed
  props.actionController.start(actionName);
}

// Cancel the current action
function cancelAction() {
  if (!props.actionController) return;
  // Use actionController.cancel to reset action state
  props.actionController.cancel();
}
</script>

<template>
  <div class="game-board" :class="actionClass">
    <!-- ACTION STATUS PANEL - Only shown when an action is in progress -->
    <div v-if="currentAction && currentActionInfo" class="action-status-panel">
      <div class="current-action" :style="{ borderColor: currentActionInfo.color }">
        <span class="action-icon">{{ currentActionInfo.icon }}</span>
        <div class="action-details">
          <div class="action-name" :style="{ color: currentActionInfo.color }">
            {{ currentActionInfo.name }}
          </div>
          <div v-if="currentStepDescription" class="action-step">
            Step {{ currentSelectionIndex + 1 }}: {{ currentStepDescription }}
          </div>
          <div v-else class="action-step">
            Confirming...
          </div>
        </div>
        <button class="cancel-button" @click="cancelAction" title="Cancel action">
          ✕
        </button>
      </div>
    </div>

    <!-- ACTION BUTTONS - Click to start an action -->
    <div class="action-buttons">
      <div class="buttons-title">Choose an Action:</div>
      <div class="buttons-row">
        <button
          v-for="actionName in availableActions"
          :key="actionName"
          class="action-button"
          :class="{ active: currentAction === actionName }"
          :style="{
            '--action-color': actionDescriptions[actionName]?.color || '#888'
          }"
          :disabled="!isMyTurn"
          @click="handleActionClick(actionName)"
        >
          <span class="button-icon">{{ actionDescriptions[actionName]?.icon || '?' }}</span>
          <span class="button-name">{{ actionDescriptions[actionName]?.name || actionName }}</span>
        </button>
        <!-- Undo button -->
        <button
          v-if="canUndo"
          class="action-button undo-button"
          :disabled="!isMyTurn"
          @click="undo?.()"
        >
          <span class="button-icon">↩️</span>
          <span class="button-name">Undo</span>
        </button>
      </div>
    </div>

    <!-- GAME AREA -->
    <div class="game-area">
      <!-- Deck and Discard -->
      <div class="center-area">
        <div ref="deckRef" class="pile deck-pile" :class="{ 'highlight': isCollecting }">
          <div class="pile-label">Deck</div>
          <div class="pile-cards">
            <div v-if="deckCount > 0" class="card card-back">
              <span class="count">{{ deckCount }}</span>
            </div>
            <div v-else class="empty-pile">Empty</div>
          </div>
        </div>

        <div ref="discardRef" class="pile discard-pile" :class="{ 'highlight': isDiscarding }">
          <div class="pile-label">Discard</div>
          <div class="pile-cards">
            <div v-if="discardCount > 0" class="card card-back discard">
              <span class="count">{{ discardCount }}</span>
            </div>
            <div v-else class="empty-pile">Empty</div>
          </div>
        </div>
      </div>

      <!-- Suit Selector (for Score action) -->
      <div v-if="isSuitSelectionActive" class="suit-selector">
        <div class="suit-selector-label">Choose a suit to score:</div>
        <div class="suit-buttons">
          <button
            v-for="suit in availableSuits"
            :key="suit"
            class="suit-button"
            :class="{ selected: props.actionArgs.suit === suit }"
            :style="{ '--suit-color': suitInfo[suit]?.color || '#888' }"
            @click="handleSuitClick(suit)"
          >
            <span class="suit-symbol">{{ suitInfo[suit]?.symbol || suit }}</span>
            <span class="suit-name">{{ suitInfo[suit]?.name || suit }}</span>
          </button>
        </div>
      </div>

      <!-- Opponents -->
      <div class="opponents-area">
        <div
          v-for="opponent in otherPlayers"
          :key="opponent.position"
          class="opponent"
          :class="{
            'selectable': isOpponentSelectable(opponent.position),
            'highlight': (isTrading || isGifting) && currentSelectionName === (isTrading ? 'targetPlayer' : 'recipient')
          }"
          @click="handleOpponentClick(opponent.position)"
        >
          <div class="opponent-name">{{ opponent.name }}</div>
          <div
            class="opponent-hand"
            :ref="(el) => setOpponentRef(opponent.position, el as HTMLElement)"
          >
            <div v-for="i in getOpponentHandCount(opponent.position)" :key="i" class="card card-back small" />
            <div v-if="getOpponentHandCount(opponent.position) === 0" class="no-cards">No cards</div>
          </div>
          <div class="opponent-score">Score: {{ opponent.score || 0 }}</div>
        </div>
      </div>

      <!-- My Hand -->
      <div class="my-hand-area">
        <div class="hand-label">Your Hand</div>
        <div ref="handRef" class="hand-cards">
          <div
            v-for="card in myCards"
            :key="card.id"
            class="card"
            :class="{
              'selectable': isCardSelectable(card.id),
              'selected': shouldHighlightCard(card),
              'discard-target': isDiscarding && isCardSelectable(card.id),
              'trade-target': isTrading && currentSelectionName === 'myCard' && isCardSelectable(card.id),
              'gift-target': isGifting && currentSelectionName === 'card' && isCardSelectable(card.id),
              'score-match': isScoring && props.actionArgs.suit === card.suit,
            }"
            @click="handleCardClick(card)"
          >
            <div class="card-corner top-left" :style="{ color: getLocalSuitColor(card.suit) }">
              <div class="corner-rank">{{ card.rank }}</div>
              <div class="corner-suit">{{ getLocalSuitSymbol(card.suit) }}</div>
            </div>
            <div class="card-center" :style="{ color: getLocalSuitColor(card.suit) }">
              {{ getLocalSuitSymbol(card.suit) }}
            </div>
            <div class="card-corner bottom-right" :style="{ color: getLocalSuitColor(card.suit) }">
              <div class="corner-rank">{{ card.rank }}</div>
              <div class="corner-suit">{{ getLocalSuitSymbol(card.suit) }}</div>
            </div>
          </div>
          <div v-if="myCards.length === 0" class="no-cards">No cards in hand</div>
        </div>
      </div>
    </div>

    <!-- DEBUG: actionController state -->
    <details class="debug-panel">
      <summary>Debug: actionController State</summary>
      <div class="debug-content">
        <div><strong>currentAction:</strong> {{ currentAction || 'null' }}</div>
        <div><strong>currentSelectionName:</strong> {{ currentSelectionName || 'null' }}</div>
        <div><strong>currentSelectionIndex:</strong> {{ currentSelectionIndex }}</div>
        <div><strong>availableActions:</strong> {{ availableActions.join(', ') }}</div>
        <div><strong>actionArgs:</strong> {{ JSON.stringify(actionArgs) }}</div>
      </div>
    </details>

    <!-- Flying cards animation overlay -->
    <FlyingCardsOverlay
      :flying-cards="flyingCards || []"
      :get-suit-symbol="getLocalSuitSymbol"
      :get-suit-color="getLocalSuitColor"
    />
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  min-height: 500px;
  transition: all 0.3s ease;
}

/* Action-specific board tinting */
.game-board.action-collect { box-shadow: inset 0 0 60px rgba(0, 217, 255, 0.1); }
.game-board.action-discard { box-shadow: inset 0 0 60px rgba(255, 107, 107, 0.1); }
.game-board.action-trade { box-shadow: inset 0 0 60px rgba(255, 217, 61, 0.1); }
.game-board.action-gift { box-shadow: inset 0 0 60px rgba(107, 203, 119, 0.1); }
.game-board.action-score { box-shadow: inset 0 0 60px rgba(168, 85, 247, 0.1); }

/* Action Status Panel (only shown when action is in progress) */
.action-status-panel {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 12px;
}

.current-action {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border-left: 4px solid;
  animation: action-pulse 2s ease-in-out infinite;
}

@keyframes action-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}

.action-icon {
  font-size: 1.5rem;
}

.action-details {
  flex: 1;
}

.action-name {
  font-weight: bold;
  font-size: 1.1rem;
}

.action-step {
  color: #aaa;
  font-size: 0.85rem;
  margin-top: 2px;
}

.cancel-button {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: #888;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.cancel-button:hover {
  background: rgba(255, 107, 107, 0.3);
  color: #ff6b6b;
}

/* Action Buttons */
.action-buttons {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 12px;
}

.buttons-title {
  font-size: 0.75rem;
  color: #666;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.buttons-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  font-size: 0.85rem;
  color: #ccc;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--action-color);
  color: var(--action-color);
  transform: translateY(-2px);
}

.action-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-button.active {
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--action-color);
  color: var(--action-color);
  box-shadow: 0 0 15px var(--action-color);
}

.action-button.undo-button {
  --action-color: #f59e0b;
  background: rgba(245, 158, 11, 0.15);
  border-color: rgba(245, 158, 11, 0.4);
  color: #f59e0b;
}

.action-button.undo-button:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.25);
  border-color: #f59e0b;
}

.button-icon {
  font-size: 1rem;
}

.button-name {
  font-weight: 500;
}

/* Game Area */
.game-area {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

.center-area {
  display: flex;
  justify-content: center;
  gap: 32px;
}

/* Suit Selector */
.suit-selector {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(168, 85, 247, 0.1);
  border: 2px solid rgba(168, 85, 247, 0.3);
  border-radius: 12px;
  animation: suit-selector-pulse 2s ease-in-out infinite;
}

@keyframes suit-selector-pulse {
  0%, 100% { border-color: rgba(168, 85, 247, 0.3); }
  50% { border-color: rgba(168, 85, 247, 0.6); }
}

.suit-selector-label {
  font-size: 0.9rem;
  color: #a855f7;
  font-weight: 500;
}

.suit-buttons {
  display: flex;
  gap: 12px;
}

.suit-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.1);
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.suit-button:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: var(--suit-color);
  transform: translateY(-2px);
}

.suit-button.selected {
  background: rgba(255, 255, 255, 0.2);
  border-color: var(--suit-color);
  box-shadow: 0 0 15px var(--suit-color);
}

.suit-symbol {
  font-size: 2rem;
  color: var(--suit-color);
}

.suit-name {
  font-size: 0.75rem;
  color: #ccc;
  text-transform: uppercase;
}

.pile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  transition: all 0.3s ease;
}

.pile.highlight {
  background: rgba(255, 255, 255, 0.1);
  box-shadow: 0 0 20px rgba(0, 217, 255, 0.3);
}

.pile-label {
  font-size: 0.8rem;
  color: #888;
  text-transform: uppercase;
}

.empty-pile {
  width: 60px;
  height: 84px;
  border: 2px dashed #444;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 0.7rem;
}

/* Opponents */
.opponents-area {
  display: flex;
  justify-content: center;
  gap: 24px;
}

.opponent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.opponent.selectable {
  cursor: pointer;
  border-color: rgba(0, 255, 136, 0.5);
  animation: selectable-pulse 1.5s ease-in-out infinite;
}

.opponent.selectable:hover {
  border-color: rgba(0, 255, 136, 1);
  background: rgba(0, 255, 136, 0.1);
}

.opponent.highlight {
  background: rgba(255, 217, 61, 0.1);
}

@keyframes selectable-pulse {
  0%, 100% { box-shadow: 0 0 5px rgba(0, 255, 136, 0.3); }
  50% { box-shadow: 0 0 15px rgba(0, 255, 136, 0.5); }
}

.opponent-name {
  font-weight: bold;
  color: #fff;
}

.opponent-hand {
  display: flex;
  gap: -10px;
}

.opponent-score {
  font-size: 0.8rem;
  color: #888;
}

.no-cards {
  color: #666;
  font-style: italic;
  font-size: 0.8rem;
}

/* My Hand */
.my-hand-area {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 12px;
}

.hand-label {
  font-size: 0.8rem;
  color: #888;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.hand-cards {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

/* Cards */
.card {
  width: 60px;
  height: 84px;
  border-radius: 6px;
  position: relative;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.card.small {
  width: 40px;
  height: 56px;
  margin-left: -15px;
}

.card.small:first-child {
  margin-left: 0;
}

.card-back {
  background: linear-gradient(135deg, #c41e3a 0%, #8b0000 100%);
  border: 2px solid #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-back.discard {
  background: linear-gradient(135deg, #444 0%, #222 100%);
}

.card-back .count {
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: bold;
  font-size: 0.9rem;
}

/* Face-up cards */
.hand-cards > .card {
  background: #fff;
  border: 2px solid #333;
}

.hand-cards > .card.selectable {
  cursor: pointer;
  border-color: rgba(0, 255, 136, 0.6);
}

.hand-cards > .card.selectable:hover {
  transform: translateY(-8px);
  border-color: rgba(0, 255, 136, 1);
  box-shadow: 0 8px 20px rgba(0, 255, 136, 0.3);
}

.hand-cards > .card.selected {
  transform: translateY(-8px);
  border-color: #00ff88;
  box-shadow: 0 8px 20px rgba(0, 255, 136, 0.5);
}

.hand-cards > .card.discard-target.selectable {
  border-color: rgba(255, 107, 107, 0.6);
}

.hand-cards > .card.discard-target.selectable:hover {
  border-color: #ff6b6b;
  box-shadow: 0 8px 20px rgba(255, 107, 107, 0.3);
}

.hand-cards > .card.trade-target.selectable {
  border-color: rgba(255, 217, 61, 0.6);
}

.hand-cards > .card.trade-target.selectable:hover {
  border-color: #ffd93d;
  box-shadow: 0 8px 20px rgba(255, 217, 61, 0.3);
}

.hand-cards > .card.gift-target.selectable {
  border-color: rgba(107, 203, 119, 0.6);
}

.hand-cards > .card.gift-target.selectable:hover {
  border-color: #6bcb77;
  box-shadow: 0 8px 20px rgba(107, 203, 119, 0.3);
}

.hand-cards > .card.score-match {
  border-color: #a855f7;
  box-shadow: 0 0 15px rgba(168, 85, 247, 0.5);
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
  top: 3px;
  left: 3px;
}

.card-corner.bottom-right {
  bottom: 3px;
  right: 3px;
  transform: rotate(180deg);
}

.corner-rank {
  font-size: 0.7rem;
}

.corner-suit {
  font-size: 0.7rem;
}

.card-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.5rem;
}

/* Debug Panel */
.debug-panel {
  background: rgba(0, 0, 0, 0.4);
  border-radius: 6px;
  padding: 8px;
  font-size: 0.75rem;
  color: #888;
}

.debug-panel summary {
  cursor: pointer;
  color: #666;
}

.debug-content {
  margin-top: 8px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  font-family: monospace;
}

.debug-content div {
  margin: 4px 0;
}
</style>
