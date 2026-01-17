<!--
  Demo: Animation Feature Showcase - GameBoard

  This component demonstrates ALL BoardSmith animation capabilities.
  Actions are named after the animation composable they showcase.

  Layout: 2x2 zone grid
  ┌─────────────────┐   ┌─────────────────┐
  │  Zone A (Up)    │   │  Zone B (Up)    │
  │  [visible cards]│   │  [visible cards]│
  └─────────────────┘   └─────────────────┘
  ┌─────────────────┐   ┌─────────────────┐
  │  Zone C (Down)  │   │  Zone D (Down)  │
  │  [card backs]   │   │  [card backs]   │
  └─────────────────┘   └─────────────────┘

  Animation Features Demonstrated:
  1. useAutoFlyingElements - Auto-animate cards moving between containers
  2. useAutoFLIP - Smooth reordering animations within containers
  3. useAutoFlyToStat - Cards fly to player stat displays
  4. useActionAnimations - Action-triggered animations
  5. Card flip animations - Built into the overlay
-->
<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import type { UseActionControllerReturn } from '@boardsmith/ui';
import {
  findElement,
  useAutoFlyingElements,
  useAutoFLIP,
  useAutoFlyToStat,
  useFlyingCards,
  useActionAnimations,
  FlyingCardsOverlay,
} from '@boardsmith/ui';

// Props from GameShell
const props = defineProps<{
  gameView: any;
  playerPosition: number;
  isMyTurn: boolean;
  availableActions: string[];
  actionArgs: Record<string, unknown>;
  actionController: UseActionControllerReturn;
  setBoardPrompt: (prompt: string | null) => void;
}>();

// ============================================
// ELEMENT REFS FOR ANIMATION ENDPOINTS
// ============================================
const zoneARef = ref<HTMLElement | null>(null);
const zoneBRef = ref<HTMLElement | null>(null);
const zoneCRef = ref<HTMLElement | null>(null);
const zoneDRef = ref<HTMLElement | null>(null);
const scoreRef = ref<HTMLElement | null>(null);

// ============================================
// GAME STATE COMPUTED PROPERTIES
// ============================================
const zoneA = computed(() => findElement(props.gameView, { name: 'zone-a' }));
const zoneB = computed(() => findElement(props.gameView, { name: 'zone-b' }));
const zoneC = computed(() => findElement(props.gameView, { name: 'zone-c' }));
const zoneD = computed(() => findElement(props.gameView, { name: 'zone-d' }));

function getZoneCards(zone: any) {
  if (!zone?.children) return [];
  return zone.children.map((card: any) => ({
    id: card.id,
    rank: card.attributes?.rank || '?',
    suit: card.attributes?.suit || '?',
    faceUp: card.attributes?.faceUp !== false,
  }));
}

const zoneACards = computed(() => getZoneCards(zoneA.value));
const zoneBCards = computed(() => getZoneCards(zoneB.value));
const zoneCCards = computed(() => getZoneCards(zoneC.value));
const zoneDCards = computed(() => getZoneCards(zoneD.value));

// Get all cards for selection
const allCards = computed(() => [
  ...zoneACards.value,
  ...zoneBCards.value,
  ...zoneCCards.value,
  ...zoneDCards.value,
]);

// Player score - player data is in gameView.children, not gameView.players
const playerScore = computed(() => {
  // First try children (BoardSmith stores players as children)
  const children = props.gameView?.children || [];
  const playerChild = children.find((c: any) =>
    c.className === 'DemoPlayer' || c.className?.includes('Player')
  );
  if (playerChild) {
    return playerChild.attributes?.score ?? 0;
  }
  // Fallback to players array
  const players = props.gameView?.players || [];
  const player = players.find((p: any) => p.position === props.playerPosition);
  return player?.score ?? 0;
});


// ============================================
// ACTION CONTROLLER STATE
// ============================================
const currentAction = computed(() => props.actionController?.currentAction.value ?? null);
const currentSelection = computed(() => props.actionController?.currentSelection.value ?? null);

// ============================================
// ANIMATION COMPOSABLES
// ============================================

// 1. useFlyingCards - Base composable for manual flying (used by others internally)
const { flyingCards: manualFlyingCards, flyCards } = useFlyingCards();

// 2. useAutoFlyingElements - Automatic flying between containers
const { flyingElements: autoFlyingCards } = useAutoFlyingElements({
  gameView: () => props.gameView,
  containers: () => [
    { element: zoneA, ref: zoneARef, name: 'zone-a' },
    { element: zoneB, ref: zoneBRef, name: 'zone-b' },
    { element: zoneC, ref: zoneCRef, name: 'zone-c' },
    { element: zoneD, ref: zoneDRef, name: 'zone-d' },
  ],
  getElementData: (element) => ({
    rank: element.rank || element.attributes?.rank,
    suit: element.suit || element.attributes?.suit,
    faceUp: element.faceUp ?? element.attributes?.faceUp ?? false,
    backColor: 'linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%)',
  }),
  duration: 500,
  flip: (fromContainer, toContainer) => {
    // Flip when moving between face-up and face-down zones
    const fromFaceUp = fromContainer.name === 'zone-a' || fromContainer.name === 'zone-b';
    const toFaceUp = toContainer.name === 'zone-a' || toContainer.name === 'zone-b';
    return fromFaceUp !== toFaceUp;
  },
});

// 3. useAutoFLIP - Automatic FLIP animations for reordering
const { isAnimating: isFlipping } = useAutoFLIP({
  gameView: () => props.gameView,
  containers: [
    { ref: zoneARef, selector: '[data-card-id]' },
    { ref: zoneBRef, selector: '[data-card-id]' },
    { ref: zoneCRef, selector: '[data-card-id]' },
    { ref: zoneDRef, selector: '[data-card-id]' },
  ],
  duration: 300,
});

// 4. useAutoFlyToStat - Fly cards to player stat displays when scoring
useAutoFlyToStat({
  gameView: () => props.gameView,
  containerRefs: [zoneARef, zoneBRef],
  selector: '[data-card-id]',
  stats: [
    {
      stat: 'score',
      player: props.playerPosition,
      trackCount: () => playerScore.value,
    },
  ],
  getElementData: (el) => ({
    rank: el.getAttribute('data-rank') || '?',
    suit: el.getAttribute('data-suit') || '?',
  }),
  flyCards,
  duration: 600,
  elementSize: { width: 60, height: 84 },
});

// 5. useActionAnimations - Action-triggered animations
const gameViewRef = computed(() => props.gameView);
const actionAnimations = useActionAnimations({
  gameView: gameViewRef,
  animations: [
    {
      action: 'actionTrigger',
      elementSelection: 'card',
      elementSelector: '[data-card-id="{card}"]',
      destinationSelector: '[data-zone="zone-b"]',
      duration: 500,
      elementSize: { width: 60, height: 84 },
      getElementData: (el) => {
        const cardId = el.getAttribute('data-card-id');
        const card = allCards.value.find(c => String(c.id) === cardId);
        return {
          rank: card?.rank,
          suit: card?.suit,
          faceUp: card?.faceUp ?? true,
        };
      },
    },
    {
      // Flip card in place - source and destination are the same card
      action: 'cardFlip',
      elementSelection: 'card',
      elementSelector: '[data-card-id="{card}"]',
      destinationSelector: '[data-card-id="{card}"]',
      duration: 400,
      elementSize: { width: 60, height: 84 },
      flip: true,
      hideDestination: true, // Hide the card during animation to prevent double-card effect
      getElementData: (el) => {
        const cardId = el.getAttribute('data-card-id');
        const card = allCards.value.find(c => String(c.id) === cardId);
        return {
          rank: card?.rank,
          suit: card?.suit,
          faceUp: card?.faceUp ?? true,
          backColor: 'linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%)',
        };
      },
    },
  ],
});

// Register action animations hook when actionController is available
onMounted(() => {
  if (props.actionController) {
    props.actionController.registerBeforeAutoExecute(actionAnimations.onBeforeAutoExecute);
  }
});

// Watch for actionController changes
watch(
  () => props.actionController,
  (controller) => {
    if (controller) {
      controller.registerBeforeAutoExecute(actionAnimations.onBeforeAutoExecute);
    }
  },
  { immediate: true }
);

// Combine all flying elements for the overlay
const allFlyingCards = computed(() => [
  ...manualFlyingCards.value,
  ...autoFlyingCards.value,
  ...actionAnimations.flyingElements.value,
]);

// ============================================
// UI HELPERS
// ============================================

function getLocalSuitSymbol(suit: string): string {
  const symbols: Record<string, string> = { H: '\u2665', D: '\u2666', C: '\u2663', S: '\u2660' };
  return symbols[suit] || suit;
}

function getLocalSuitColor(suit: string): string {
  return suit === 'H' || suit === 'D' ? '#e74c3c' : '#2c3e50';
}

// Action metadata for display
const actionInfo: Record<string, { name: string; icon: string; color: string; animation: string }> = {
  autoFlyUpUp: { name: 'Auto-Fly (Up→Up)', icon: '\u2194', color: '#00d9ff', animation: 'useAutoFlyingElements' },
  autoFlyDownDown: { name: 'Auto-Fly (Down→Down)', icon: '\u2194', color: '#00d9ff', animation: 'useAutoFlyingElements' },
  autoFlyFlip: { name: 'Auto-Fly + Flip', icon: '\u21C5', color: '#f59e0b', animation: 'useAutoFlyingElements' },
  flipReorder: { name: 'FLIP Reorder', icon: '\u{1F500}', color: '#ffd93d', animation: 'useAutoFLIP' },
  flyToStat: { name: 'Fly to Panel', icon: '\u2B50', color: '#a855f7', animation: 'useAutoFlyToStat' },
  actionTrigger: { name: 'Action-Trigger', icon: '\u26A1', color: '#10b981', animation: 'useActionAnimations' },
  cardFlip: { name: 'Card Flip', icon: '\u{1F503}', color: '#3b82f6', animation: 'Card Flip' },
};

// Is card selectable for current action?
function isCardSelectable(cardId: number): boolean {
  if (!currentAction.value || !currentSelection.value) return false;
  if (currentSelection.value.type !== 'element') return false;
  const validIds = props.actionController.validElements.value.map((e: any) => e.id);
  return validIds.includes(cardId);
}

// Handle card click
async function handleCardClick(card: { id: number }) {
  if (!props.actionController) return;
  if (!isCardSelectable(card.id)) return;
  if (!currentSelection.value) return;
  await props.actionController.fill(currentSelection.value.name, card.id);
}

// Handle action button click
function handleActionClick(actionName: string) {
  if (!props.actionController) return;
  if (!props.isMyTurn) return;
  props.actionController.start(actionName);
}

// Cancel current action
function cancelAction() {
  if (!props.actionController) return;
  props.actionController.cancel();
}

</script>

<template>
  <div class="game-board">
    <!-- HEADER -->
    <div class="header">
      <div class="title">Animation Feature Showcase</div>
      <div class="subtitle">Each button demonstrates a different BoardSmith animation composable</div>
      <div ref="scoreRef" class="score-display" data-player-stat="score" :data-player-position="playerPosition">
        Score: {{ playerScore }}
      </div>
    </div>

    <!-- ACTION STATUS (when action in progress) -->
    <div v-if="currentAction" class="action-status">
      <div class="status-content" :style="{ borderColor: actionInfo[currentAction]?.color || '#888' }">
        <span class="status-icon">{{ actionInfo[currentAction]?.icon }}</span>
        <div class="status-details">
          <div class="status-action" :style="{ color: actionInfo[currentAction]?.color }">
            {{ actionInfo[currentAction]?.name }}
          </div>
          <div class="status-animation">
            {{ actionInfo[currentAction]?.animation }}
          </div>
          <div v-if="currentSelection" class="status-prompt">
            {{ currentSelection.prompt || 'Select an option...' }}
          </div>
        </div>
        <button class="cancel-btn" @click="cancelAction" title="Cancel">&times;</button>
      </div>
    </div>

    <!-- ACTION BUTTONS -->
    <div class="action-buttons">
      <button
        v-for="actionName in availableActions"
        :key="actionName"
        class="action-btn"
        :class="{ active: currentAction === actionName }"
        :style="{ '--action-color': actionInfo[actionName]?.color || '#888' }"
        :disabled="!isMyTurn"
        @click="handleActionClick(actionName)"
      >
        <span class="btn-icon">{{ actionInfo[actionName]?.icon }}</span>
        <span class="btn-name">{{ actionInfo[actionName]?.name }}</span>
        <span class="btn-anim">{{ actionInfo[actionName]?.animation }}</span>
      </button>
    </div>

    <!-- 2x2 ZONE GRID -->
    <div class="zone-grid">
      <!-- Row 1: Face-up zones A and B -->
      <div class="zone-row">
        <div ref="zoneARef" class="zone face-up" data-zone="zone-a">
          <div class="zone-header">
            <span class="zone-label">Zone A</span>
            <span class="zone-type">Face-Up</span>
          </div>
          <div class="zone-cards">
            <div
              v-for="card in zoneACards"
              :key="card.id"
              class="card"
              :class="{ selectable: isCardSelectable(card.id), 'card-back': !card.faceUp }"
              :data-card-id="card.id"
              :data-rank="card.rank"
              :data-suit="card.suit"
              @click="handleCardClick(card)"
            >
              <template v-if="card.faceUp">
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
              </template>
              <template v-else>
                <div class="card-back-design">?</div>
              </template>
            </div>
            <div v-if="zoneACards.length === 0" class="empty-zone">Empty</div>
          </div>
        </div>

        <div ref="zoneBRef" class="zone face-up" data-zone="zone-b">
          <div class="zone-header">
            <span class="zone-label">Zone B</span>
            <span class="zone-type">Face-Up</span>
          </div>
          <div class="zone-cards">
            <div
              v-for="card in zoneBCards"
              :key="card.id"
              class="card"
              :class="{ selectable: isCardSelectable(card.id), 'card-back': !card.faceUp }"
              :data-card-id="card.id"
              :data-rank="card.rank"
              :data-suit="card.suit"
              @click="handleCardClick(card)"
            >
              <template v-if="card.faceUp">
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
              </template>
              <template v-else>
                <div class="card-back-design">?</div>
              </template>
            </div>
            <div v-if="zoneBCards.length === 0" class="empty-zone">Empty</div>
          </div>
        </div>
      </div>

      <!-- Row 2: Face-down zones C and D -->
      <div class="zone-row">
        <div ref="zoneCRef" class="zone face-down" data-zone="zone-c">
          <div class="zone-header">
            <span class="zone-label">Zone C</span>
            <span class="zone-type">Face-Down</span>
          </div>
          <div class="zone-cards">
            <div
              v-for="card in zoneCCards"
              :key="card.id"
              class="card"
              :class="{ selectable: isCardSelectable(card.id), 'card-back': !card.faceUp }"
              :data-card-id="card.id"
              :data-rank="card.rank"
              :data-suit="card.suit"
              @click="handleCardClick(card)"
            >
              <template v-if="card.faceUp">
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
              </template>
              <template v-else>
                <div class="card-back-design">?</div>
              </template>
            </div>
            <div v-if="zoneCCards.length === 0" class="empty-zone">Empty</div>
          </div>
        </div>

        <div ref="zoneDRef" class="zone face-down" data-zone="zone-d">
          <div class="zone-header">
            <span class="zone-label">Zone D</span>
            <span class="zone-type">Face-Down</span>
          </div>
          <div class="zone-cards">
            <div
              v-for="card in zoneDCards"
              :key="card.id"
              class="card"
              :class="{ selectable: isCardSelectable(card.id), 'card-back': !card.faceUp }"
              :data-card-id="card.id"
              :data-rank="card.rank"
              :data-suit="card.suit"
              @click="handleCardClick(card)"
            >
              <template v-if="card.faceUp">
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
              </template>
              <template v-else>
                <div class="card-back-design">?</div>
              </template>
            </div>
            <div v-if="zoneDCards.length === 0" class="empty-zone">Empty</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Shuffling indicator -->
    <div v-if="isFlipping" class="shuffle-indicator">
      Shuffling...
    </div>

    <!-- ANIMATION REFERENCE TABLE -->
    <details class="reference-panel">
      <summary>Animation Reference</summary>
      <div class="reference-content">
        <table class="reference-table">
          <thead>
            <tr>
              <th>Button</th>
              <th>Animation Composable</th>
              <th>What It Demonstrates</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="ref-action">Auto-Fly (Up→Up)</span></td>
              <td><code>useAutoFlyingElements</code></td>
              <td>ID-based tracking, no flip (A↔B)</td>
            </tr>
            <tr>
              <td><span class="ref-action">Auto-Fly (Down→Down)</span></td>
              <td><code>useAutoFlyingElements</code></td>
              <td>Count-based tracking, no flip (C↔D)</td>
            </tr>
            <tr>
              <td><span class="ref-action">Auto-Fly + Flip</span></td>
              <td><code>useAutoFlyingElements</code></td>
              <td>Card flips during flight (A↔C)</td>
            </tr>
            <tr>
              <td><span class="ref-action">FLIP Reorder</span></td>
              <td><code>useAutoFLIP</code></td>
              <td>In-place reordering animation</td>
            </tr>
            <tr>
              <td><span class="ref-action">Fly to Stat</span></td>
              <td><code>useAutoFlyToStat</code></td>
              <td>Flies to player stat display on removal</td>
            </tr>
            <tr>
              <td><span class="ref-action">Action-Trigger</span></td>
              <td><code>useActionAnimations</code></td>
              <td>Pre-action capture, post-action animation</td>
            </tr>
            <tr>
              <td><span class="ref-action">Card Flip</span></td>
              <td><code>Card Flip</code></td>
              <td>Toggle face state without moving</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <!-- Flying Cards Animation Overlay with custom card rendering -->
    <FlyingCardsOverlay :flying-cards="allFlyingCards || []">
      <template #card="{ card }">
        <!-- 3D flip container - isFlipped determines starting face -->
        <div class="flying-card-custom" :class="{ flipped: card.isFlipped }">
          <!-- Front face (card face) -->
          <div class="card-face card-front" :style="{ color: getLocalSuitColor(card.cardData.suit || '') }">
            <div class="card-corner top-left">
              <div class="corner-rank">{{ card.cardData.rank }}</div>
              <div class="corner-suit">{{ getLocalSuitSymbol(card.cardData.suit || '') }}</div>
            </div>
            <div class="card-center">
              {{ getLocalSuitSymbol(card.cardData.suit || '') }}
            </div>
            <div class="card-corner bottom-right">
              <div class="corner-rank">{{ card.cardData.rank }}</div>
              <div class="corner-suit">{{ getLocalSuitSymbol(card.cardData.suit || '') }}</div>
            </div>
          </div>
          <!-- Back face -->
          <div class="card-face card-back">
            <div class="card-back-design">?</div>
          </div>
        </div>
      </template>
    </FlyingCardsOverlay>
  </div>
</template>

<style scoped>
.game-board {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border-radius: 12px;
  min-height: 600px;
}

/* Header */
.header {
  text-align: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
}

.title {
  font-size: 1.4rem;
  font-weight: bold;
  color: #fff;
  margin-bottom: 4px;
}

.subtitle {
  font-size: 0.85rem;
  color: #888;
}

.score-display {
  margin-top: 8px;
  display: inline-block;
  padding: 6px 16px;
  background: linear-gradient(135deg, #a855f7 0%, #6b21a8 100%);
  border-radius: 20px;
  color: #fff;
  font-weight: bold;
  font-size: 1rem;
}

/* Action Status */
.action-status {
  padding: 8px 0;
}

.status-content {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border-left: 4px solid;
}

.status-icon {
  font-size: 1.5rem;
}

.status-details {
  flex: 1;
}

.status-action {
  font-weight: bold;
  font-size: 1.1rem;
}

.status-animation {
  font-size: 0.75rem;
  color: #888;
  font-family: monospace;
}

.status-prompt {
  font-size: 0.85rem;
  color: #aaa;
  margin-top: 4px;
}

.cancel-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: #888;
  font-size: 1.2rem;
  cursor: pointer;
}

.cancel-btn:hover {
  background: rgba(255, 107, 107, 0.3);
  color: #ff6b6b;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #ccc;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 100px;
}

.action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--action-color);
  color: var(--action-color);
  transform: translateY(-2px);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-btn.active {
  background: rgba(255, 255, 255, 0.15);
  border-color: var(--action-color);
  color: var(--action-color);
  box-shadow: 0 0 15px var(--action-color);
}

.btn-icon {
  font-size: 1.3rem;
}

.btn-name {
  font-size: 0.8rem;
  font-weight: 500;
  text-align: center;
}

.btn-anim {
  font-size: 0.55rem;
  color: #666;
  font-family: monospace;
}

/* Zone Grid */
.zone-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

.zone-row {
  display: flex;
  gap: 16px;
  justify-content: center;
}

.zone {
  flex: 1;
  max-width: 280px;
  min-width: 200px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 12px;
  padding: 12px;
  border: 2px solid transparent;
}

.zone.face-up {
  border-color: rgba(0, 217, 255, 0.3);
}

.zone.face-down {
  border-color: rgba(255, 165, 0, 0.3);
}

.zone-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.zone-label {
  font-weight: bold;
  color: #fff;
  font-size: 1rem;
}

.zone-type {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
}

.zone.face-up .zone-type {
  background: rgba(0, 217, 255, 0.2);
  color: #00d9ff;
}

.zone.face-down .zone-type {
  background: rgba(255, 165, 0, 0.2);
  color: #ffa500;
}

.zone-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 90px;
  justify-content: center;
  align-items: flex-start;
}

.empty-zone {
  width: 60px;
  height: 84px;
  border: 2px dashed #444;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  font-size: 0.7rem;
}

/* Shuffle indicator */
.shuffle-indicator {
  text-align: center;
  color: #ffd93d;
  font-style: italic;
  padding: 8px;
  background: rgba(255, 217, 61, 0.1);
  border-radius: 6px;
}

/* Cards */
.card {
  width: 60px;
  height: 84px;
  border-radius: 6px;
  position: relative;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  background: #fff;
  border: 2px solid #333;
  cursor: default;
}

.card.selectable {
  cursor: pointer;
  border-color: rgba(0, 255, 136, 0.6);
  animation: pulse-glow 1.5s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(0, 255, 136, 0.4); }
  50% { box-shadow: 0 0 16px rgba(0, 255, 136, 0.7); }
}

.card.selectable:hover {
  transform: translateY(-8px);
  border-color: #00ff88;
  box-shadow: 0 8px 20px rgba(0, 255, 136, 0.4);
}

.card.card-back {
  background: linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%);
  border-color: #0d1b2a;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-back-design {
  color: rgba(255, 255, 255, 0.3);
  font-size: 2rem;
  font-weight: bold;
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

/* Reference Panel */
.reference-panel {
  background: rgba(0, 0, 0, 0.4);
  border-radius: 8px;
  padding: 10px;
  font-size: 0.75rem;
  color: #888;
}

.reference-panel summary {
  cursor: pointer;
  color: #aaa;
  font-weight: bold;
  padding: 4px;
}

.reference-content {
  margin-top: 10px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
}

.reference-table {
  width: 100%;
  border-collapse: collapse;
}

.reference-table th,
.reference-table td {
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.reference-table th {
  color: #aaa;
  font-weight: 600;
}

.reference-table code {
  background: rgba(0, 217, 255, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  color: #00d9ff;
  font-size: 0.7rem;
}

.ref-action {
  color: #ffd93d;
}
</style>

<!-- Non-scoped styles for flying card (teleported content) -->
<style>
/* 3D flip container */
.flying-card-custom {
  width: 100%;
  height: 100%;
  position: relative;
  transform-style: preserve-3d;
  /* Match the font-family from the game board (teleport loses inheritance) */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}

/* When flipped, rotate 180deg so back face shows initially.
   The parent's rotateY animation (0→180) then flips it to show front.
   Without flipped: starts showing front, ends showing back.
   With flipped: starts showing back, ends showing front. */
.flying-card-custom.flipped {
  transform: rotateY(180deg);
}

/* Both faces share common styling */
.flying-card-custom .card-face {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

/* Front face (card face) */
.flying-card-custom .card-front {
  background: #fff;
  border: 2px solid #333;
}

/* Back face - rotated 180deg so it faces the other way */
.flying-card-custom .card-back {
  background: linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%);
  border: 2px solid #0d1b2a;
  transform: rotateY(180deg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.flying-card-custom .card-corner {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-weight: bold;
  line-height: 1;
}

.flying-card-custom .card-corner.top-left {
  top: 3px;
  left: 3px;
}

.flying-card-custom .card-corner.bottom-right {
  bottom: 3px;
  right: 3px;
  transform: rotate(180deg);
}

.flying-card-custom .corner-rank {
  font-size: 0.7rem;
}

.flying-card-custom .corner-suit {
  font-size: 0.7rem;
}

.flying-card-custom .card-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 1.5rem;
}

.flying-card-custom .card-back-design {
  color: rgba(255, 255, 255, 0.3);
  font-size: 2rem;
  font-weight: bold;
}
</style>
