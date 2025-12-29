<script setup lang="ts">
import { ref, reactive, computed, watch, watchEffect, onMounted, onUnmounted, provide } from 'vue';
import { MeepleClient, GameConnection, audioService, type LobbyInfo } from '@boardsmith/client';
import { useGame } from '@boardsmith/client/vue';
import ActionPanel from './auto-ui/ActionPanel.vue';
import DebugPanel from './DebugPanel.vue';
import GameHeader from './GameHeader.vue';
import GameHistory from './GameHistory.vue';
import GameLobby from './GameLobby.vue';
import PlayersPanel from './PlayersPanel.vue';
import WaitingRoom from './WaitingRoom.vue';
import Toast from './Toast.vue';
import ZoomPreviewOverlay from './helpers/ZoomPreviewOverlay.vue';
import { createBoardInteraction, provideBoardInteraction } from '../composables/useBoardInteraction';
import { useZoomPreview } from '../composables/useZoomPreview';
import { useToast } from '../composables/useToast';
import { useActionController, type ActionResult as ControllerActionResult } from '../composables/useActionController';
import turnNotificationSound from '../assets/turn-notification.mp3';

// Generate or retrieve persistent player ID
// Session-specific IDs (for same-browser scenarios) are stored in sessionStorage
// and take precedence over localStorage
function getPlayerId(): string {
  const SESSION_KEY = 'boardsmith_session_player_id';
  const LOCAL_KEY = 'boardsmith_player_id';

  // Check sessionStorage first (for same-browser joiner scenarios)
  const sessionId = sessionStorage.getItem(SESSION_KEY);
  if (sessionId) {
    return sessionId;
  }

  // Fall back to localStorage
  let id = localStorage.getItem(LOCAL_KEY);
  if (!id) {
    id = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(LOCAL_KEY, id);
  }
  return id;
}

// Save a session-specific player ID (survives refresh but not browser close)
function setSessionPlayerId(id: string): void {
  const SESSION_KEY = 'boardsmith_session_player_id';
  sessionStorage.setItem(SESSION_KEY, id);
}

// Clear session-specific player ID (when leaving lobby)
function clearSessionPlayerId(): void {
  const SESSION_KEY = 'boardsmith_session_player_id';
  sessionStorage.removeItem(SESSION_KEY);
}

// Get or set persistent player name
function getPlayerName(): string | null {
  const KEY = 'boardsmith_player_name';
  return localStorage.getItem(KEY);
}

function setPlayerName(name: string): void {
  const KEY = 'boardsmith_player_name';
  localStorage.setItem(KEY, name);
}

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
  /** Player positions that should be AI by default (0-indexed). E.g., [1] makes player 2 AI */
  defaultAIPlayers?: number[];
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

// Player identity (persistent across sessions, but can change for joiners in same-browser scenarios)
const playerId = ref(getPlayerId());

// Lobby state
const joinGameId = ref('');
const createdGameId = ref<string | null>(null);
const lobbyInfo = ref<LobbyInfo | null>(null);
const isCreator = ref(false);
const lobbyConnection = ref<GameConnection | null>(null);

// Game definition (for playerOptions)
const gamePlayerOptions = ref<Record<string, unknown> | undefined>(undefined);

// Game state
const gameId = ref<string | null>(null);
const playerPosition = ref<number>(0);

// UI state
const historyCollapsed = ref(false);
const debugExpanded = ref(false);
const zoomLevel = ref(1.0);
const autoEndTurn = ref(true); // Auto-end turn after making a move
const showUndo = ref(true); // Show undo button when undo is available

// Time travel state (for viewing historical game states)
const timeTravelState = ref<any>(null);
const timeTravelActionIndex = ref<number | null>(null);
const timeTravelDiff = ref<{ added: number[]; removed: number[]; changed: number[] } | null>(null);
const isViewingHistory = computed(() => timeTravelState.value !== null);

// Debug highlight state (for element inspector)
const debugHighlightedElementId = ref<number | null>(null);
provide('debugHighlight', debugHighlightedElementId);

// Create client
const client = new MeepleClient({
  baseUrl: props.apiUrl,
});

// Sync the client's playerId with our localStorage-based one
// This ensures all API calls (claim position, etc.) use the same ID
client.setPlayerId(playerId.value);

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

// Action metadata for auto-UI (selections, choices)
const actionMetadata = computed(() => {
  return (state.value?.state as any)?.actionMetadata;
});

// Available actions (from flow state)
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

// Shared action args - bidirectional sync between ActionPanel and custom game boards
const actionArgs = reactive<Record<string, unknown>>({});

// Action controller - unified action handling for ActionPanel and custom UIs
// This provides 100% parity: same auto-fill, validation, and server communication
const actionController = useActionController({
  sendAction: async (actionName, args) => {
    const result = await action(actionName, args);
    return result as ControllerActionResult;
  },
  availableActions,
  actionMetadata,
  isMyTurn,
  playerPosition,
  autoFill: true,
  autoExecute: true,
  // Share actionArgs with the controller for bidirectional sync with custom UIs
  externalArgs: actionArgs,
  // Phase 3: Deferred choices - fetched from server at selection time
  fetchDeferredChoices: async (actionName, selectionName, player, currentArgs) => {
    if (!gameId.value) {
      return { success: false, error: 'No game ID' };
    }
    try {
      const response = await fetch(`${props.apiUrl}/games/${gameId.value}/deferred-choices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionName,
          selection: selectionName,
          player,
          currentArgs,
        }),
      });
      return await response.json();
    } catch (err) {
      console.error('Fetch deferred choices error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch deferred choices' };
    }
  },
  // Phase 3: Repeating selections - processed step by step on server
  selectionStep: async (player, selectionName, value, actionName, initialArgs) => {
    if (!gameId.value) {
      return { success: false, error: 'No game ID' };
    }
    try {
      const response = await fetch(`${props.apiUrl}/games/${gameId.value}/selection-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player,
          selectionName,
          value,
          action: actionName,
          initialArgs,
        }),
      });
      return await response.json();
    } catch (err) {
      console.error('Selection step error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Selection step failed' };
    }
  },
});

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

// Can undo - from PlayerGameState.canUndo
const canUndo = computed(() => {
  return (state.value?.state as any)?.canUndo ?? false;
});

// Board-provided prompt (for dynamic prompts based on UI state)
const boardPrompt = ref<string | null>(null);

function setBoardPrompt(prompt: string | null): void {
  boardPrompt.value = prompt;
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

// Board interaction state (shared between ActionPanel and game board)
const boardInteraction = createBoardInteraction();
provideBoardInteraction(boardInteraction);

// Zoom preview (Alt+hover to enlarge cards) - uses event delegation for all cards
const { previewState } = useZoomPreview();

// Toast notifications
const toast = useToast();

// Helper to fetch playerOptions from game definitions
async function fetchPlayerOptions(gameType: string): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(`${props.apiUrl}/games/definitions`);
    const data = await response.json();
    if (data.success && data.definitions) {
      const definition = data.definitions.find((d: { gameType: string }) => d.gameType === gameType);
      return definition?.playerOptions;
    }
  } catch (err) {
    console.error('Failed to fetch game definitions:', err);
  }
  return undefined;
}

// Provide context to child components
provide('gameState', state);
provide('gameView', gameView);
provide('players', players);
provide('myPlayer', myPlayer);
provide('playerPosition', playerPosition);
provide('isMyTurn', isMyTurn);
provide('availableActions', availableActions);
provide('actionArgs', actionArgs);
provide('actionController', actionController);
provide('boardInteraction', boardInteraction);
provide('timeTravelDiff', timeTravelDiff);

// URL routing - check for game ID or lobby ID in URL on mount
onMounted(async () => {
  const path = window.location.pathname;

  // Check for game URL: /game/:gameId/:position?
  const gameMatch = path.match(/^\/game\/([a-z0-9]+)(?:\/(\d))?$/);
  if (gameMatch) {
    const urlGameId = gameMatch[1];
    const urlPosition = gameMatch[2] ? parseInt(gameMatch[2], 10) : 0;

    playerPosition.value = urlPosition;
    setTimeout(() => {
      gameId.value = urlGameId;
      currentScreen.value = 'game';
    }, 50);
    return;
  }

  // Check for lobby URL: /lobby/:gameId
  const lobbyMatch = path.match(/^\/lobby\/([a-z0-9]+)$/);
  if (lobbyMatch) {
    const urlGameId = lobbyMatch[1];
    createdGameId.value = urlGameId;

    try {
      // Fetch lobby info to determine our role
      const lobby = await client.getLobby(urlGameId);

      if (lobby.state === 'playing') {
        // Game already started - find our position and go to game
        const mySlot = lobby.slots.find(s => s.playerId === playerId.value);
        if (mySlot) {
          playerPosition.value = mySlot.position;
          gameId.value = urlGameId;
          currentScreen.value = 'game';
          updateUrl(urlGameId, mySlot.position);
        } else {
          // Not in this game - go to lobby screen
          currentScreen.value = 'lobby';
          clearUrl();
        }
        return;
      }

      // Check if we're the creator
      isCreator.value = lobby.creatorId === playerId.value;

      // Check if we have a claimed slot
      const mySlot = lobby.slots.find(s => s.playerId === playerId.value);
      if (mySlot) {
        playerPosition.value = mySlot.position;
      }

      lobbyInfo.value = lobby;
      // Fetch playerOptions for the lobby
      gamePlayerOptions.value = await fetchPlayerOptions(lobby.gameType);
      currentScreen.value = 'waiting';
      connectToLobby(urlGameId);
    } catch (err) {
      console.error('Failed to load lobby:', err);
      currentScreen.value = 'lobby';
      clearUrl();
    }
  }
});

// Cleanup on unmount
onUnmounted(() => {
  disconnectFromLobby();
});

// Update URL when entering a game
function updateUrl(gid: string, position: number) {
  window.history.pushState({ gameId: gid, position }, '', `/game/${gid}/${position}`);
}

// Update URL when entering a lobby
function updateLobbyUrl(gid: string) {
  window.history.pushState({ gameId: gid, lobby: true }, '', `/lobby/${gid}`);
}

// Clear URL when leaving game
function clearUrl() {
  window.history.pushState({}, '', '/');
}

// Lobby config type
interface LobbyConfig {
  playerCount: number;
  gameOptions: Record<string, unknown>;
  playerConfigs: Array<{
    name: string;
    isAI: boolean;
    aiLevel: string;
    [key: string]: unknown;
  }>;
}

// Actions
async function createGame(config?: LobbyConfig) {
  try {
    // Use config from lobby if provided, otherwise fallback to props
    const effectivePlayerCount = config?.playerCount ?? props.playerCount;

    // Build player names and AI config from lobby config
    let playerNames: string[];
    let aiPlayers: number[] = [];
    let aiLevel = 'medium';

    if (config?.playerConfigs?.length) {
      playerNames = config.playerConfigs.map((pc, i) =>
        pc.name || (pc.isAI ? 'Bot' : `Player ${i + 1}`)
      );
      // Extract AI players
      aiPlayers = config.playerConfigs
        .map((pc, i) => (pc.isAI ? i : -1))
        .filter((i) => i >= 0);
      // Get AI level from first AI player
      const firstAI = config.playerConfigs.find((pc) => pc.isAI);
      if (firstAI) {
        aiLevel = firstAI.aiLevel || 'medium';
      }
    } else {
      // Fallback when no config provided
      playerNames = Array.from({ length: effectivePlayerCount }, (_, i) => `Player ${i + 1}`);
    }

    // Always use the lobby so host can configure players, add AI, change settings
    const result = await client.createGame({
      gameType: props.gameType,
      playerCount: effectivePlayerCount,
      playerNames,
      aiPlayers: aiPlayers.length > 0 ? aiPlayers : undefined,
      aiLevel: aiPlayers.length > 0 ? aiLevel : undefined,
      gameOptions: config?.gameOptions,
      playerConfigs: config?.playerConfigs,
      useLobby: true,
      creatorId: playerId.value,
    });

    if (result.success && result.gameId) {
      createdGameId.value = result.gameId;
      playerPosition.value = 0;
      isCreator.value = true;

      if (result.lobby) {
        // Go to waiting room for configuration
        lobbyInfo.value = result.lobby;
        // Fetch playerOptions for the lobby
        gamePlayerOptions.value = await fetchPlayerOptions(props.gameType);
        currentScreen.value = 'waiting';
        updateLobbyUrl(result.gameId);
        connectToLobby(result.gameId);
      } else {
        // Fallback if lobby wasn't created (shouldn't happen)
        gameId.value = result.gameId;
        currentScreen.value = 'game';
        updateUrl(result.gameId, 0);
      }
    }
  } catch (err) {
    console.error('Failed to create game:', err);
    alert('Failed to create game');
  }
}

// Lobby WebSocket connection functions
function connectToLobby(gid: string) {
  // Disconnect any existing connection
  disconnectFromLobby();

  // Create a new connection for the lobby
  const connection = new GameConnection(props.apiUrl, {
    gameId: gid,
    playerId: playerId.value,
    playerPosition: playerPosition.value,
    autoReconnect: true,
  });

  // Listen for lobby updates
  connection.onLobbyChange((lobby) => {
    lobbyInfo.value = lobby;

    // If game has started, transition to game
    if (lobby.state === 'playing') {
      disconnectFromLobby();

      // Find my position from the lobby slots
      const mySlot = lobby.slots.find(s => s.playerId === playerId.value);
      if (mySlot) {
        playerPosition.value = mySlot.position;
      }

      gameId.value = gid;
      currentScreen.value = 'game';
      updateUrl(gid, playerPosition.value);
    }
  });

  // Handle connection errors
  connection.onError((err) => {
    console.error('Lobby connection error:', err);
  });

  // Connect
  connection.connect();
  lobbyConnection.value = connection;
}

function disconnectFromLobby() {
  if (lobbyConnection.value) {
    lobbyConnection.value.disconnect();
    lobbyConnection.value = null;
  }
}

async function joinGame() {
  if (!joinGameId.value.trim()) {
    alert('Please enter a game code');
    return;
  }

  try {
    const gid = joinGameId.value.trim();

    // Try to get lobby info first
    try {
      const lobby = await client.getLobby(gid);
      createdGameId.value = gid;
      isCreator.value = false;

      if (lobby.state === 'waiting') {
        // Check if our playerId is already claimed in this lobby (same browser scenario)
        // If so, generate a new playerId for this joiner session
        const existingSlot = lobby.slots.find(s => s.playerId === playerId.value);
        if (existingSlot) {
          // Generate a new unique playerId for this joiner (same-browser scenario)
          const newPlayerId = Math.random().toString(36).substring(2) + Date.now().toString(36);
          playerId.value = newPlayerId;
          client.setPlayerId(newPlayerId);
          // Save to sessionStorage so it survives refresh but not browser close
          setSessionPlayerId(newPlayerId);
        }

        // Find the first open slot
        const firstOpenSlot = lobby.slots.find(s => s.status === 'open');

        if (firstOpenSlot) {
          // Auto-claim the first open slot
          // Use saved name if available, otherwise keep the slot's default name
          const playerName = getPlayerName() || firstOpenSlot.name;
          const claimResult = await client.claimPosition(gid, firstOpenSlot.position, playerName);

          if (claimResult.success && claimResult.lobby) {
            lobbyInfo.value = claimResult.lobby;

            // Check if game started (all slots filled)
            if (claimResult.lobby.state === 'playing') {
              playerPosition.value = firstOpenSlot.position;
              gameId.value = gid;
              currentScreen.value = 'game';
              updateUrl(gid, firstOpenSlot.position);
              return;
            }
          } else {
            // Claim failed, show lobby anyway so they can try manually
            lobbyInfo.value = lobby;
          }

          // Fetch playerOptions for the lobby
          gamePlayerOptions.value = await fetchPlayerOptions(lobby.gameType);
          currentScreen.value = 'waiting';
          updateLobbyUrl(gid);
          connectToLobby(gid);
        } else {
          // No open slots - game is full
          toast.error('This game is full. No open positions available.');
        }
        return;
      }
      // Game already started - fall through to direct join
    } catch {
      // No lobby info - game might be old-style without lobby
    }

    // Direct join (legacy flow or game already playing)
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

// Resume a persisted game by ID
async function resumeGame(gid: string) {
  joinGameId.value = gid;
  await joinGame();
}

// Lobby event handlers
async function handleClaimPosition(position: number, name: string) {
  if (!createdGameId.value) return;

  try {
    const result = await client.claimPosition(createdGameId.value, position, name);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
      // Save name for future games
      setPlayerName(name);

      // If game started, transition
      if (result.lobby.state === 'playing') {
        disconnectFromLobby();
        playerPosition.value = position;
        gameId.value = createdGameId.value;
        currentScreen.value = 'game';
        updateUrl(createdGameId.value, position);
      }
    } else {
      alert(result.error || 'Failed to claim position');
    }
  } catch (err) {
    console.error('Failed to claim position:', err);
    alert('Failed to claim position');
  }
}

async function handleUpdateLobbyName(name: string) {
  if (!createdGameId.value) return;

  try {
    await client.updateLobbyName(createdGameId.value, name);
    // Save name for future games
    setPlayerName(name);
    // Lobby update will come via polling
  } catch (err) {
    console.error('Failed to update name:', err);
  }
}

async function handleSetReady(ready: boolean) {
  if (!createdGameId.value) return;

  try {
    const result = await client.setReady(createdGameId.value, ready);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;

      // If game started (all ready), transition to game
      if (result.lobby.state === 'playing') {
        disconnectFromLobby();

        // Find my position from the lobby slots
        const mySlot = result.lobby.slots.find(s => s.playerId === playerId.value);
        if (mySlot) {
          playerPosition.value = mySlot.position;
        }

        gameId.value = createdGameId.value;
        currentScreen.value = 'game';
        updateUrl(createdGameId.value, playerPosition.value);
      }
    } else {
      console.error('Failed to set ready:', result.error);
    }
  } catch (err) {
    console.error('Failed to set ready:', err);
  }
}

async function handleAddSlot() {
  if (!createdGameId.value) return;

  try {
    const result = await client.addSlot(createdGameId.value);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
    } else {
      toast.error(result.error || 'Failed to add slot');
    }
  } catch (err) {
    console.error('Failed to add slot:', err);
    toast.error('Failed to add slot');
  }
}

async function handleRemoveSlot(position: number) {
  if (!createdGameId.value) return;

  try {
    const result = await client.removeSlot(createdGameId.value, position);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
    } else {
      toast.error(result.error || 'Failed to remove slot');
    }
  } catch (err) {
    console.error('Failed to remove slot:', err);
    toast.error('Failed to remove slot');
  }
}

async function handleSetSlotAI(position: number, isAI: boolean, aiLevel?: string) {
  if (!createdGameId.value) return;

  try {
    const result = await client.setSlotAI(createdGameId.value, position, isAI, aiLevel);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
    } else {
      toast.error(result.error || 'Failed to update slot');
    }
  } catch (err) {
    console.error('Failed to set slot AI:', err);
    toast.error('Failed to update slot');
  }
}

async function handleKickPlayer(position: number) {
  if (!createdGameId.value) return;

  try {
    const result = await client.kickPlayer(createdGameId.value, position);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
    } else {
      toast.error(result.error || 'Failed to kick player');
    }
  } catch (err) {
    console.error('Failed to kick player:', err);
    toast.error('Failed to kick player');
  }
}

async function handleUpdatePlayerOptions(options: Record<string, unknown>) {
  if (!createdGameId.value) return;

  try {
    const result = await client.updatePlayerOptions(createdGameId.value, options);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
    } else {
      toast.error(result.error || 'Failed to update options');
    }
  } catch (err) {
    console.error('Failed to update player options:', err);
    toast.error('Failed to update options');
  }
}

async function handleUpdateGameOptions(options: Record<string, unknown>) {
  if (!createdGameId.value) return;

  try {
    const result = await client.updateGameOptions(createdGameId.value, options);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
    } else {
      toast.error(result.error || 'Failed to update game options');
    }
  } catch (err) {
    console.error('Failed to update game options:', err);
    toast.error('Failed to update game options');
  }
}

async function handleUpdateSlotPlayerOptions(position: number, options: Record<string, unknown>) {
  if (!createdGameId.value) return;

  try {
    const result = await client.updateSlotPlayerOptions(createdGameId.value, position, options);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
    } else {
      toast.error(result.error || 'Failed to update slot options');
    }
  } catch (err) {
    console.error('Failed to update slot player options:', err);
    toast.error('Failed to update slot options');
  }
}

async function handleLobbyCancel() {
  // For non-hosts, release our slot before leaving
  if (!isCreator.value && createdGameId.value) {
    console.log('[Leave] Calling leavePosition for game:', createdGameId.value, 'playerId:', playerId.value);
    try {
      const result = await client.leavePosition(createdGameId.value);
      console.log('[Leave] leavePosition result:', result);
    } catch (err) {
      console.error('[Leave] Failed to leave position:', err);
      // Continue with cleanup even if leave fails
    }
  } else {
    console.log('[Leave] Skipping leavePosition - isCreator:', isCreator.value, 'createdGameId:', createdGameId.value);
  }

  disconnectFromLobby();
  clearSessionPlayerId();
  lobbyInfo.value = null;
  createdGameId.value = null;
  isCreator.value = false;
  currentScreen.value = 'lobby';
  clearUrl();
}

function copyGameCode() {
  if (createdGameId.value) {
    navigator.clipboard.writeText(createdGameId.value);
    toast.success('Copied!');
  }
}

function leaveGame() {
  disconnectFromLobby();
  clearSessionPlayerId();
  gameId.value = null;
  createdGameId.value = null;
  joinGameId.value = '';
  lobbyInfo.value = null;
  isCreator.value = false;
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

// Debug highlight handler - highlights an element on the board
function handleHighlightElement(elementId: number | null) {
  debugHighlightedElementId.value = elementId;
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
  actionController,
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
      :api-url="apiUrl"
      :default-a-i-players="defaultAIPlayers"
      v-model:join-game-id="joinGameId"
      @create="createGame"
      @join="joinGame"
      @resume="resumeGame"
    >
      <slot name="lobby-extra"></slot>
    </GameLobby>

    <!-- WAITING SCREEN -->
    <WaitingRoom
      v-if="currentScreen === 'waiting' && lobbyInfo"
      :game-id="createdGameId || ''"
      :lobby="lobbyInfo"
      :player-id="playerId"
      :is-creator="isCreator"
      :player-options="gamePlayerOptions"
      @claim-position="handleClaimPosition"
      @update-name="handleUpdateLobbyName"
      @set-ready="handleSetReady"
      @add-slot="handleAddSlot"
      @remove-slot="handleRemoveSlot"
      @set-slot-ai="handleSetSlotAI"
      @kick-player="handleKickPlayer"
      @update-player-options="handleUpdatePlayerOptions"
      @update-slot-player-options="handleUpdateSlotPlayerOptions"
      @update-game-options="handleUpdateGameOptions"
      @cancel="handleLobbyCancel"
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
        v-model:show-undo="showUndo"
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
              <slot name="player-stats" :player="player" :game-view="gameView" :players="players"></slot>
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
              <!--
                Game Board Slot Props:
                - actionController: USE THIS for all action handling (start, fill, execute, cancel)
                - actionArgs: Read-only view of current selection args (for UI display)
                - Other props: game state for rendering
              -->
              <slot
                name="game-board"
                :state="state"
                :game-view="gameView"
                :players="players"
                :my-player="myPlayer"
                :player-position="playerPosition"
                :is-my-turn="isMyTurn"
                :available-actions="availableActions"
                :action-args="actionArgs"
                :set-board-prompt="setBoardPrompt"
                :can-undo="canUndo && !isViewingHistory"
                :undo="handleUndo"
                :action-controller="actionController"
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
          :show-undo="showUndo"
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
        @highlight-element="handleHighlightElement"
      />

      <!-- Error display -->
      <div v-if="error" class="error-banner">
        {{ error.message }}
      </div>
    </div>

    <!-- Zoom preview overlay (Alt+hover to enlarge cards) -->
    <ZoomPreviewOverlay :preview-state="previewState" />

    <!-- Toast notifications -->
    <Toast />
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
  padding: 0;
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
    padding: 0;
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
