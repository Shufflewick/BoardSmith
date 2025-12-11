<script setup lang="ts">
import { ref, reactive, computed, watch, watchEffect, onMounted, provide } from 'vue';
import { MeepleClient, audioService } from '@boardsmith/client';
import { useGame } from '@boardsmith/client/vue';
import ActionPanel from './auto-ui/ActionPanel.vue';
import DebugPanel from './DebugPanel.vue';
import GameHeader from './GameHeader.vue';
import GameHistory from './GameHistory.vue';
import GameLobby from './GameLobby.vue';
import PlayersPanel from './PlayersPanel.vue';
import WaitingRoom from './WaitingRoom.vue';
import { createBoardInteraction, provideBoardInteraction } from '../composables/useBoardInteraction';
import turnNotificationSound from '../assets/turn-notification.mp3';

interface GameShellProps {
  /** Game type identifier (e.g., 'go-fish', 'cribbage') */
  gameType: string;
  /** Display name for the game */
  displayName?: string;
  /** API base URL (default: http://localhost:8787) */
  apiUrl?: string;
  /** Number of players (default: 2) */
  playerCount?: number;
  /** Enable debug panel (default: true in dev) */
  debugMode?: boolean;
  /** Show game history sidebar (default: true) */
  showHistory?: boolean;
}

const props = withDefaults(defineProps<GameShellProps>(), {
  apiUrl: 'http://localhost:8787',
  playerCount: 2,
  debugMode: true,
  showHistory: true,
});

// Screen state
type Screen = 'lobby' | 'waiting' | 'game';
const currentScreen = ref<Screen>('lobby');

// Lobby state
const playerName = ref('');
const joinGameId = ref('');
const createdGameId = ref<string | null>(null);

// Game state
const gameId = ref<string | null>(null);
const playerPosition = ref<number>(0);

// UI state
const historyCollapsed = ref(false);
const debugExpanded = ref(false);
const zoomLevel = ref(1.0);
const autoEndTurn = ref(true); // Auto-end turn after making a move

// Time travel state (for viewing historical game states)
const timeTravelState = ref<any>(null);
const timeTravelActionIndex = ref<number | null>(null);
const timeTravelDiff = ref<{ added: number[]; removed: number[]; changed: number[] } | null>(null);
const isViewingHistory = computed(() => timeTravelState.value !== null);

// Create client
const client = new MeepleClient({
  baseUrl: props.apiUrl,
});

// Initialize audio service with the turn notification sound
audioService.init({
  turnSoundUrl: turnNotificationSound,
});

// Use game composable
const { state, connectionStatus, isConnected, isMyTurn, error, action } = useGame(
  client,
  gameId,
  { playerPosition }
);

// Extract messages from game state
const gameMessages = computed(() => {
  if (!state.value?.state?.view) return [];
  const view = state.value.state.view as any;
  return view.messages || [];
});

// Computed properties for game view
// When viewing historical state, use that instead of live state
const gameView = computed(() => {
  if (timeTravelState.value) {
    return timeTravelState.value.view as any;
  }
  return state.value?.state.view as any;
});
const players = computed(() => state.value?.state.players || []);
const myPlayer = computed(() => players.value.find(p => p.position === playerPosition.value));
const opponentPlayers = computed(() => players.value.filter(p => p.position !== playerPosition.value));
const currentPlayerName = computed(() => {
  const currentPos = state.value?.state?.currentPlayer;
  if (currentPos === undefined) return '';
  const player = players.value.find(p => p.position === currentPos);
  return player?.name || `Player ${currentPos + 1}`;
});
const prompt = computed(() => (state.value?.flowState as any)?.prompt);
const availableActions = computed(() => {
  const flowState = state.value?.flowState as any;
  if (!flowState) return [];

  // Check awaitingPlayers for simultaneous actions
  if (flowState.awaitingPlayers?.length > 0) {
    const myPlayerState = flowState.awaitingPlayers.find(
      (p: { playerIndex: number }) => p.playerIndex === playerPosition.value
    );
    if (myPlayerState && !myPlayerState.completed) {
      return myPlayerState.availableActions || [];
    }
  }

  return flowState.availableActions || [];
});

// Action metadata for auto-UI (selections, choices)
const actionMetadata = computed(() => {
  return (state.value?.state as any)?.actionMetadata;
});

// Can undo - from PlayerGameState.canUndo
const canUndo = computed(() => {
  return (state.value?.state as any)?.canUndo ?? false;
});

// Shared action arguments - game boards write to this, ActionPanel reads from it
const actionArgs = reactive<Record<string, unknown>>({});

// Board-provided prompt (for dynamic prompts based on UI state)
const boardPrompt = ref<string | null>(null);

function setBoardPrompt(prompt: string | null): void {
  boardPrompt.value = prompt;
}

// Execute an action with args (called by ActionPanel)
async function handleActionExecute(actionName: string, args: Record<string, unknown>): Promise<void> {
  await action(actionName, args);
}

// Undo actions back to turn start (called by ActionPanel)
async function handleUndo(): Promise<void> {
  if (!gameId.value) return;
  try {
    const response = await fetch(`${props.apiUrl}/games/${gameId.value}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: playerPosition.value }),
    });
    const result = await response.json();
    if (!result.success) {
      console.error('Undo failed:', result.error);
    }
    // State update will come via WebSocket
  } catch (error) {
    console.error('Undo error:', error);
  }
}

// Execute an action using shared actionArgs (legacy, used by custom game boards)
async function executeAction(actionName: string): Promise<void> {
  const cards = actionArgs.cards as string[] | undefined;

  if (cards && cards.length > 0) {
    // Handle multi-card actions (like discard, playCard) by iterating
    for (const card of [...cards]) {
      const result = await action(actionName, { card });
      if (!result.success) break;
    }
    // Clear the selection after action completes
    actionArgs.cards = [];
  } else {
    // Build args from all actionArgs properties (for games like Go Fish with rank/target)
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(actionArgs)) {
      if (actionArgs[key] !== undefined) {
        args[key] = actionArgs[key];
      }
    }
    await action(actionName, args);
    // Clear actionArgs after action completes
    for (const key of Object.keys(actionArgs)) {
      delete actionArgs[key];
    }
  }
}

// Board interaction state (shared between ActionPanel and game board)
const boardInteraction = createBoardInteraction();
provideBoardInteraction(boardInteraction);

// Provide context to child components
provide('gameState', state);
provide('gameView', gameView);
provide('players', players);
provide('myPlayer', myPlayer);
provide('playerPosition', playerPosition);
provide('isMyTurn', isMyTurn);
provide('availableActions', availableActions);
provide('action', action);
provide('actionArgs', actionArgs);
provide('boardInteraction', boardInteraction);
provide('timeTravelDiff', timeTravelDiff);

// URL routing - check for game ID in URL on mount
onMounted(() => {
  const path = window.location.pathname;
  const match = path.match(/^\/game\/([a-z0-9]+)(?:\/(\d))?$/);
  if (match) {
    const urlGameId = match[1];
    const urlPosition = match[2] ? parseInt(match[2], 10) : 0;

    playerName.value = localStorage.getItem('playerName') || 'Player';
    playerPosition.value = urlPosition;
    setTimeout(() => {
      gameId.value = urlGameId;
      currentScreen.value = 'game';
    }, 50);
  }
});

// Update URL when entering a game
function updateUrl(gid: string, position: number) {
  window.history.pushState({ gameId: gid, position }, '', `/game/${gid}/${position}`);
}

// Clear URL when leaving game
function clearUrl() {
  window.history.pushState({}, '', '/');
}

// Actions
async function createGame() {
  if (!playerName.value.trim()) {
    alert('Please enter your name');
    return;
  }
  localStorage.setItem('playerName', playerName.value.trim());

  try {
    const playerNames = [playerName.value.trim()];
    for (let i = 1; i < props.playerCount; i++) {
      playerNames.push(`Waiting for player ${i + 1}...`);
    }

    const result = await client.createGame({
      gameType: props.gameType,
      playerCount: props.playerCount,
      playerNames,
    });

    if (result.success && result.gameId) {
      createdGameId.value = result.gameId;
      playerPosition.value = 0;
      currentScreen.value = 'waiting';
      pollForOtherPlayers(result.gameId);
    }
  } catch (err) {
    console.error('Failed to create game:', err);
    alert('Failed to create game');
  }
}

async function pollForOtherPlayers(gid: string) {
  gameId.value = gid;
  currentScreen.value = 'game';
  updateUrl(gid, 0);
}

async function joinGame() {
  if (!playerName.value.trim()) {
    alert('Please enter your name');
    return;
  }
  if (!joinGameId.value.trim()) {
    alert('Please enter a game code');
    return;
  }
  localStorage.setItem('playerName', playerName.value.trim());

  try {
    const gid = joinGameId.value.trim();
    const stateResult = await client.getGameState(gid, 1);

    if (stateResult) {
      playerPosition.value = 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      gameId.value = gid;
      currentScreen.value = 'game';
      updateUrl(gid, 1);
    }
  } catch (err) {
    console.error('Failed to join game:', err);
    alert('Failed to join game. Check the game code.');
  }
}

function copyGameCode() {
  if (createdGameId.value) {
    navigator.clipboard.writeText(createdGameId.value);
    alert('Game code copied!');
  }
}

function leaveGame() {
  gameId.value = null;
  createdGameId.value = null;
  joinGameId.value = '';
  currentScreen.value = 'lobby';
  clearUrl();
}

// Debug panel handlers
function handleSwitchPlayer(position: number) {
  playerPosition.value = position;
  if (gameId.value) {
    updateUrl(gameId.value, position);
  }
}

async function handleRestartGame() {
  if (!gameId.value) return;

  try {
    await client.restartGame(gameId.value);
    // The server broadcasts the restart to all clients via WebSocket,
    // so the state will update automatically
  } catch (err) {
    console.error('Failed to restart game:', err);
    error.value = err instanceof Error ? err : new Error('Failed to restart game');
  }
}

// Time travel handler - updates the game view to show historical state
function handleTimeTravel(
  historicalState: any | null,
  actionIndex: number | null,
  diff: { added: number[]; removed: number[]; changed: number[] } | null
) {
  timeTravelState.value = historicalState;
  timeTravelActionIndex.value = actionIndex;
  timeTravelDiff.value = diff;
}

// Menu handlers
function handleMenuItemClick(id: string) {
  if (id === 'leave') {
    leaveGame();
  } else if (id === 'new-game') {
    leaveGame();
  }
}

// Expose to parent/slots
defineExpose({
  state,
  gameView,
  players,
  myPlayer,
  playerPosition,
  isMyTurn,
  availableActions,
  action,
  connectionStatus,
  error,
  leaveGame,
});
</script>

<template>
  <div class="game-shell">
    <!-- LOBBY SCREEN -->
    <GameLobby
      v-if="currentScreen === 'lobby'"
      :display-name="displayName || gameType"
      v-model:player-name="playerName"
      v-model:join-game-id="joinGameId"
      @create="createGame"
      @join="joinGame"
    >
      <slot name="lobby-extra"></slot>
    </GameLobby>

    <!-- WAITING SCREEN -->
    <WaitingRoom
      v-if="currentScreen === 'waiting'"
      :game-id="createdGameId || ''"
      @start="() => { gameId = createdGameId; currentScreen = 'game'; if (createdGameId) updateUrl(createdGameId, 0); }"
      @cancel="leaveGame"
    />

    <!-- GAME SCREEN -->
    <div v-if="currentScreen === 'game'" class="game-shell__game">
      <!-- Top Header Bar -->
      <GameHeader
        :game-title="displayName || gameType"
        :game-id="gameId"
        :connection-status="connectionStatus"
        v-model:zoom="zoomLevel"
        v-model:auto-end-turn="autoEndTurn"
        @menu-item-click="handleMenuItemClick"
      />

      <!-- Main Content Area -->
      <div class="game-shell__main">
        <!-- Left Sidebar: Players, Stats & History (on desktop) -->
        <aside class="game-shell__sidebar">
          <PlayersPanel
            :players="players"
            :player-position="playerPosition"
            :current-player-position="state?.state.currentPlayer"
          >
            <template #player-stats="{ player }">
              <slot name="player-stats" :player="player" :game-view="gameView"></slot>
            </template>
          </PlayersPanel>

          <slot name="sidebar-extra"
            :state="state"
            :game-view="gameView"
            :players="players"
          ></slot>

          <!-- Game History (below scoreboard) -->
          <GameHistory
            v-if="showHistory"
            :messages="gameMessages"
            v-model:collapsed="historyCollapsed"
            class="sidebar-history"
          />
        </aside>

        <!-- Center: Game Board -->
        <main class="game-shell__content">
          <div class="game-shell__zoom-container" :style="{ '--zoom-level': zoomLevel }">
              <slot
                name="game-board"
                :state="state"
                :game-view="gameView"
                :players="players"
                :my-player="myPlayer"
                :player-position="playerPosition"
                :is-my-turn="isMyTurn"
                :available-actions="availableActions"
                :action="action"
                :action-args="actionArgs"
                :execute-action="executeAction"
                :set-board-prompt="setBoardPrompt"
              >
                <div class="empty-game-area">
                  <p>Add your game board in the #game-board slot</p>
                </div>
              </slot>
          </div>
        </main>
      </div>

      <!-- Bottom Action Bar -->
      <footer class="game-shell__action-bar">
        <ActionPanel
          :available-actions="isViewingHistory ? [] : availableActions"
          :action-metadata="isViewingHistory ? {} : actionMetadata"
          :players="players"
          :player-position="playerPosition"
          :is-my-turn="isMyTurn && !isViewingHistory"
          :can-undo="canUndo && !isViewingHistory"
          :auto-end-turn="autoEndTurn"
          @execute="handleActionExecute"
          @undo="handleUndo"
        />
        <!-- Time travel banner -->
        <div v-if="isViewingHistory" class="time-travel-banner">
          <span class="time-travel-icon">⏰</span>
          Viewing historical state (action {{ timeTravelActionIndex }}) - Actions disabled
        </div>
      </footer>

      <!-- Debug Panel (bottom) -->
      <DebugPanel
        v-if="debugMode"
        :state="state"
        :player-position="playerPosition"
        :player-count="playerCount"
        :game-id="gameId"
        :api-url="apiUrl"
        v-model:expanded="debugExpanded"
        @switch-player="handleSwitchPlayer"
        @restart-game="handleRestartGame"
        @time-travel="handleTimeTravel"
      />

      <!-- Error display -->
      <div v-if="error" class="error-banner">
        {{ error.message }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-shell {
  min-height: 100vh;
  font-family: system-ui, -apple-system, sans-serif;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
}

/* Game Screen */
.game-shell__game {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Main Content Area - Mobile First */
.game-shell__main {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.game-shell__content {
  flex: 1;
  padding: 15px;
  padding-bottom: 80px; /* Space for sticky action bar */
  overflow: auto;
  min-height: 300px;
  order: 1; /* Content first on mobile */
}

.game-shell__zoom-container {
  --zoom-level: 1;
  transform: scale(var(--zoom-level));
  transform-origin: top left;
  /* Width/height at 100% divided by zoom to reserve correct space */
  width: calc(100% / var(--zoom-level));
  min-height: calc(100% / var(--zoom-level));
}

/* Sidebar - Mobile (below content) */
.game-shell__sidebar {
  width: 100%;
  background: rgba(0, 0, 0, 0.3);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 15px;
  overflow-y: auto;
  order: 2; /* Sidebar below content on mobile */
  max-height: 40vh;
}

/* Desktop: Sidebar on Left */
@media (min-width: 768px) {
  .game-shell__main {
    flex-direction: row;
  }

  .game-shell__content {
    padding: 20px;
    min-height: 400px;
    order: 2; /* Content on right on desktop */
  }

  .game-shell__sidebar {
    width: 280px;
    min-width: 280px;
    max-height: none;
    border-top: none;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    padding: 20px;
    order: 1; /* Sidebar on left on desktop */
  }
}

/* Bottom Action Bar - Fixed at bottom */
.game-shell__action-bar {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding: 12px 15px;
  z-index: 100;
}

/* Desktop: Wider padding for action bar */
@media (min-width: 768px) {
  .game-shell__action-bar {
    padding: 16px 20px;
  }
}

/* Time travel banner */
.time-travel-banner {
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid #f59e0b;
  color: #f59e0b;
  padding: 8px 16px;
  border-radius: 6px;
  margin-top: 8px;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

.time-travel-icon {
  font-size: 1.1rem;
}

.error-banner {
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(231, 76, 60, 0.9);
  border: 1px solid #e74c3c;
  padding: 12px 24px;
  border-radius: 8px;
  z-index: 150;
}

.empty-game-area {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 300px;
  color: #666;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 12px;
}

/* GameHistory when used in sidebar (not standalone left column) */
.sidebar-history {
  width: 100% !important;
  min-width: unset !important;
  border-right: none !important;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  height: auto !important;
  max-height: 300px;
  margin-top: 20px;
  border-radius: 8px;
  overflow: hidden;
}
</style>
