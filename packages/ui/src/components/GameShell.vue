<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, provide } from 'vue';
import { MeepleClient, audioService } from '@boardsmith/client';
import { useGame } from '@boardsmith/client/vue';
import ActionPanel from './auto-ui/ActionPanel.vue';
import DebugPanel from './DebugPanel.vue';
import GameHistory from './GameHistory.vue';
import HamburgerMenu from './HamburgerMenu.vue';
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
const gameView = computed(() => state.value?.state.view as any);
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
  // For now, just leave and start fresh
  // In the future, this could call a restart API
  leaveGame();
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
    <div v-if="currentScreen === 'lobby'" class="game-shell__lobby">
      <h1>{{ displayName || gameType }}</h1>

      <div class="lobby-form">
        <div class="form-group">
          <label>Your Name:</label>
          <input v-model="playerName" type="text" placeholder="Enter your name" />
        </div>

        <div class="lobby-actions">
          <div class="action-box">
            <h3>Create New Game</h3>
            <p>Start a new game and invite friends</p>
            <button @click="createGame" class="btn primary">Create Game</button>
          </div>

          <div class="divider">OR</div>

          <div class="action-box">
            <h3>Join Existing Game</h3>
            <p>Enter the game code from your friend</p>
            <input v-model="joinGameId" type="text" placeholder="Enter game code" class="game-code-input" />
            <button @click="joinGame" class="btn secondary">Join Game</button>
          </div>
        </div>
      </div>

      <slot name="lobby-extra"></slot>
    </div>

    <!-- WAITING SCREEN -->
    <div v-if="currentScreen === 'waiting'" class="game-shell__waiting">
      <h2>Waiting for other players...</h2>
      <div class="share-code">
        <p>Share this code with your friends:</p>
        <div class="code-display">
          <span class="code">{{ createdGameId }}</span>
          <button @click="copyGameCode" class="btn small">Copy</button>
        </div>
      </div>
      <button @click="() => { gameId = createdGameId; currentScreen = 'game'; if (createdGameId) updateUrl(createdGameId, 0); }" class="btn secondary">
        Start Playing
      </button>
      <button @click="leaveGame" class="btn text">Cancel</button>
    </div>

    <!-- GAME SCREEN -->
    <div v-if="currentScreen === 'game'" class="game-shell__game">
      <!-- Top Header Bar -->
      <header class="game-shell__header">
        <div class="header-left">
          <HamburgerMenu
            :game-title="displayName || gameType"
            :game-id="gameId"
            :connection-status="connectionStatus"
            @menu-item-click="handleMenuItemClick"
          />
          <h1>{{ displayName || gameType }}</h1>
        </div>
        <div class="header-center">
          <ActionPanel
            :available-actions="availableActions"
            :action-metadata="actionMetadata"
            :players="players"
            :player-position="playerPosition"
            :is-my-turn="isMyTurn"
            @execute="handleActionExecute"
          />
        </div>
        <div class="header-right">
          <span v-if="gameId" class="game-code">Game: <strong>{{ gameId }}</strong></span>
          <span class="connection-badge" :class="connectionStatus">{{ connectionStatus }}</span>
        </div>
      </header>

      <!-- Main Content Area -->
      <div class="game-shell__main">
        <!-- Left Sidebar: Players, Stats & History (on desktop) -->
        <aside class="game-shell__sidebar">
          <div class="sidebar-section">
            <h3>Players</h3>
            <div v-for="player in players" :key="player.position" class="player-card" :class="{ current: player.position === state?.state.currentPlayer }">
              <div class="player-name-row">
                <span v-if="player.position === state?.state.currentPlayer" class="turn-indicator-dot"></span>
                <span class="player-name">{{ player.name }}</span>
                <span v-if="player.position === playerPosition" class="you-badge">(You)</span>
              </div>
              <slot name="player-stats" :player="player" :game-view="gameView"></slot>
            </div>
          </div>

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
        </main>
      </div>

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

/* Lobby */
.game-shell__lobby {
  max-width: 500px;
  margin: 0 auto;
  padding: 40px 20px;
  text-align: center;
}

.game-shell__lobby h1 {
  font-size: 2.5rem;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 30px;
}

.lobby-form {
  max-width: 500px;
  margin: 0 auto;
}

.form-group {
  margin-bottom: 30px;
  text-align: left;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: #aaa;
}

.form-group input {
  width: 100%;
  padding: 15px;
  border: 2px solid #ccc;
  border-radius: 8px;
  background: #fff;
  color: #333;
  font-size: 1.1rem;
}

.form-group input:focus {
  outline: none;
  border-color: #00d9ff;
  box-shadow: 0 0 0 3px rgba(0, 217, 255, 0.2);
}

.form-group input::placeholder {
  color: #999;
}

.lobby-actions {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.action-box {
  background: rgba(255, 255, 255, 0.05);
  padding: 25px;
  border-radius: 12px;
  text-align: center;
}

.action-box h3 {
  margin-bottom: 10px;
}

.action-box p {
  color: #aaa;
  margin-bottom: 15px;
  font-size: 0.9rem;
}

.game-code-input {
  width: 100%;
  padding: 12px;
  margin-bottom: 15px;
  border: 2px solid #ccc;
  border-radius: 8px;
  background: #fff;
  color: #333;
  font-size: 1rem;
  font-family: monospace;
}

.game-code-input:focus {
  outline: none;
  border-color: #00d9ff;
  box-shadow: 0 0 0 3px rgba(0, 217, 255, 0.2);
}

.game-code-input::placeholder {
  color: #999;
}

.divider {
  color: #666;
  font-size: 0.9rem;
}

/* Waiting */
.game-shell__waiting {
  max-width: 500px;
  margin: 0 auto;
  text-align: center;
  padding: 40px 20px;
}

.game-shell__waiting h2 {
  margin-bottom: 30px;
}

.share-code {
  background: rgba(0, 217, 255, 0.1);
  padding: 30px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.share-code p {
  margin-bottom: 15px;
  color: #aaa;
}

.code-display {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
}

.code {
  font-family: monospace;
  font-size: 2rem;
  color: #00d9ff;
  letter-spacing: 3px;
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
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  font-weight: bold;
}

.btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 217, 255, 0.4);
}

.btn.secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.btn.secondary:hover {
  border-color: #00d9ff;
}

.btn.text {
  background: transparent;
  color: #888;
}

.btn.text:hover {
  color: #fff;
}

.btn.small {
  padding: 8px 16px;
  font-size: 0.9rem;
}

/* Game Screen */
.game-shell__game {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  padding-bottom: 40px; /* Space for debug panel */
}

/* Header - Mobile First */
.game-shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  gap: 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Hide game title on mobile - it's in the hamburger menu */
.game-shell__header h1 {
  display: none;
  font-size: 1.3rem;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin: 0;
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

/* Hide header-right on mobile - info is in hamburger menu */
.header-right {
  display: none;
  align-items: center;
  gap: 15px;
}

.game-code {
  font-size: 0.85rem;
  color: #aaa;
}

.game-code strong {
  color: #00d9ff;
  font-family: monospace;
}

.connection-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.7rem;
  text-transform: uppercase;
}

.connection-badge.connected { background: #27ae60; }
.connection-badge.connecting, .connection-badge.reconnecting { background: #f39c12; }
.connection-badge.disconnected, .connection-badge.error { background: #e74c3c; }

/* Desktop: Show header elements */
@media (min-width: 768px) {
  .game-shell__header {
    padding: 12px 20px;
  }

  .header-left {
    gap: 20px;
  }

  .game-shell__header h1 {
    display: block;
  }

  .header-center {
    max-width: 600px;
  }

  .header-right {
    display: flex;
  }
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
  overflow-y: auto;
  min-height: 300px;
  order: 1; /* Content first on mobile */
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

.sidebar-section {
  margin-bottom: 25px;
}

.sidebar-section h3 {
  font-size: 0.8rem;
  text-transform: uppercase;
  color: #888;
  margin-bottom: 15px;
  letter-spacing: 0.5px;
}

.player-card {
  background: rgba(255, 255, 255, 0.05);
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 10px;
  transition: all 0.2s;
}

.player-card.current {
  background: rgba(0, 217, 255, 0.15);
  border: 1px solid rgba(0, 217, 255, 0.3);
}

.player-name {
  font-weight: 600;
}

.you-badge {
  color: #00d9ff;
  font-size: 0.8rem;
  margin-left: 8px;
}

.player-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.turn-indicator-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  animation: pulse-glow 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse-glow {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 0 8px rgba(0, 217, 255, 0.6);
  }
  50% {
    transform: scale(1.15);
    box-shadow: 0 0 16px rgba(0, 255, 136, 0.8);
  }
}

.error-banner {
  position: fixed;
  bottom: 50px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(231, 76, 60, 0.9);
  border: 1px solid #e74c3c;
  padding: 12px 24px;
  border-radius: 8px;
  z-index: 50;
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
