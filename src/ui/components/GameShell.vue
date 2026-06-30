<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, provide, toRef } from 'vue';
import { applyTheme, BREAKPOINTS } from '../theme.js';
import { consumeInitMessage, isOriginAllowed } from './GameShellInit.js';
// Dev-only auto-UI peek (see DevAutoUI below). Referenced ONLY under the
// `isDevBuild` (`import.meta.env.DEV`) constant, so a production build constant-
// folds the branch to `null`, leaving this import unreferenced and tree-shaken —
// a custom-UI game ships no AutoUI/AutoRenderer (SHIP-02 holds). A static import
// (not `import()`) is deliberate: a dynamic import would emit a code-split chunk
// that ships even when the branch is dead.
import AutoUIDev from './auto-ui/AutoUI.vue';
import type { PresentationOverlay } from './auto-ui/presentation.js';
import {
  announceTurnChange,
  announceConnectionChange,
  announceGameOver,
  announceOpponentTurn,
} from '../composables/liveRegionAnnouncer.js';
import { MeepleClient, GameConnection, audioService, type LobbyInfo } from '../../client/index.js';
import { useGame } from '../../client/vue.js';

// HMR Debug logging (disabled in production)
const DEBUG_HMR = false;
function hmrLog(...args: unknown[]) {
  if (DEBUG_HMR) console.log('[HMR-DEBUG]', ...args);
}
import ActionPanel from './auto-ui/ActionPanel.vue';
import ControlsMenu from './ControlsMenu.vue';
import DebugPanel from './DebugPanel.vue';
import GameHeader from './GameHeader.vue';
import GameHistory from './GameHistory.vue';
import GameLobby from './GameLobby.vue';
import PlayersPanel from './PlayersPanel.vue';
import PlayerToken from './PlayerToken.vue';
import WaitingRoom from './WaitingRoom.vue';
import Toast from './Toast.vue';
import ZoomPreviewOverlay from './helpers/ZoomPreviewOverlay.vue';
import GameOverCard from './GameOverCard.vue';
import TutorialOverlay from './helpers/TutorialOverlay.vue';
import HintOverlay from './helpers/HintOverlay.vue';
import HeatmapOverlay from './helpers/HeatmapOverlay.vue';
import BoardMessage from './helpers/BoardMessage.vue';
import { createBoardInteraction, provideBoardInteraction } from '../composables/useBoardInteraction';
import { setupDragDropOrchestration } from '../composables/useDragDropTargets';
import { useBoardActionBridge } from '../composables/useBoardActionBridge';
import { createAnimationEvents, provideAnimationEvents } from '../composables/useAnimationEvents';
import { useZoomPreview } from '../composables/useZoomPreview';
import { useToast } from '../composables/useToast';
import { useActionController, type ActionResult as ControllerActionResult } from '../composables/useActionController';
import type { ActionMetadata } from '../composables/useActionControllerTypes';
import turnNotificationSound from '../assets/turn-notification.mp3';
import { toCloneablePayload } from './platformRequestClone.js';

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

// Get or set the global "Show action help" preference.
// Key: boardsmith_action_help; default ON (true) when absent.
// Wrapped in try/catch for graceful degradation in private browsing / SSR.
function getActionHelpEnabled(): boolean {
  try {
    const stored = localStorage.getItem('boardsmith_action_help');
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

function setActionHelpEnabled(value: boolean): void {
  try {
    localStorage.setItem('boardsmith_action_help', String(value));
  } catch { /* ignore — private browsing or storage full */ }
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
  /** Player positions that should be AI by default (1-indexed). E.g., [2] makes player 2 AI */
  defaultAIPlayers?: number[];
  /** Suppress the footer ActionPanel regardless of anchor state (D-02 escape hatch). Default: false. */
  suppressActionPanel?: boolean;
  /** Per-UI presentation overlay — keyed by element class/name/attribute → visuals (D-04). */
  presentation?: PresentationOverlay;
  /**
   * Additional named UIs selectable via the `boardsmith dev` UI dropdown, beyond
   * the primary UI in the #game-board slot. Each renders with the same slot props.
   * The built-in auto-UI is offered automatically in dev. A game with several
   * board views (e.g. full board + compact) lists the extras here. Dev-only switch;
   * a production build still renders the primary slot UI.
   */
  uis?: Array<{ name: string; component: unknown }>;
  /**
   * Origins allowed to send postMessages to this GameShell iframe.
   * When non-empty, any message whose event.origin is NOT in this list is
   * silently dropped before the payload is inspected. When empty or unset,
   * the current behavior is retained (no origin filtering) so the existing
   * embed flow is unbroken — the host (HOST-02) supplies this list to lock
   * down the production embed.
   *
   * Example: ['https://shufflewick.pub', 'http://localhost:5173']
   */
  trustedOrigins?: string[];
}

const props = withDefaults(defineProps<GameShellProps>(), {
  // Use injected API URL from boardsmith dev (set via window global), fall back to default
  apiUrl: (typeof window !== 'undefined' && (window as any).__BOARDSMITH_API_URL__) || 'http://localhost:8787',
  playerCount: 2,
  debugMode: true,
  showHistory: true,
  suppressActionPanel: false,
});

// Platform mode: embedded inside a host platform's iframe (e.g., ShufflewickPub
// in prod, or the boardsmith dev host locally — both run GameShell in an iframe).
// Synchronous detection: if we're in an iframe, we're in platform mode.
const platformMode = ref(typeof window !== 'undefined' && window.parent !== window);

// Dev build (Vite serves `boardsmith dev`); false in production embeds. Gates the
// debug panel so it appears under `boardsmith dev` but never in a deployed game.
const isDevBuild = import.meta.env.DEV;

// Dev-only UI switcher. `boardsmith dev` shows a dropdown of every UI this game
// offers — the primary UI (the #game-board slot), any extra UIs from the `uis`
// prop, and the built-in auto-UI — and renders the selected one without a
// permanent split-screen. The AutoUI import is gated behind `isDevBuild`
// (`import.meta.env.DEV`), so a production build statically drops this branch and
// a custom-UI game never bundles AutoUI/AutoRenderer (SHIP-02 tree-shaking holds).
const DevAutoUI = isDevBuild ? AutoUIDev : null;
const AUTO_UI_NAME = 'Auto UI';
const primaryUiName = computed(() => props.displayName || 'Custom UI');
// Ordered list of selectable UI names: primary slot UI, extra `uis`, then auto-UI (dev).
const devUiNames = computed(() => {
  const names = [primaryUiName.value, ...(props.uis ?? []).map(u => u.name)];
  if (isDevBuild) names.push(AUTO_UI_NAME);
  return names;
});
const selectedUiName = ref('');
// The component to render for the current selection, or null to render the slot.
const selectedUiComponent = computed(() => {
  const name = selectedUiName.value;
  if (!name || name === primaryUiName.value) return null; // render the #game-board slot
  if (name === AUTO_UI_NAME) return isDevBuild ? DevAutoUI : null;
  return (props.uis ?? []).find(u => u.name === name)?.component ?? null;
});
// Tell the dev host which UIs are available so it can populate the dropdown.
function postDevUiList(): void {
  if (!isDevBuild || !platformMode.value || typeof window === 'undefined') return;
  window.parent.postMessage(
    // gameType lets the dev host detect when its outer page is stale relative to
    // the game now running in the iframe (e.g. the dev server was restarted with a
    // different game on the same port) and force a full reload.
    { source: 'shufflewick-game', type: 'dev-ui-list', uis: devUiNames.value, gameType: props.gameType },
    '*'
  );
}

// Screen state — start on 'game' in platform mode (skip lobby)
type Screen = 'lobby' | 'waiting' | 'game';
const currentScreen = ref<Screen>(platformMode.value ? 'game' : 'lobby');

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

// Color selection state (persists through lobby->game transition)
const colorSelectionEnabled = ref(false);

// Game state
const gameId = ref<string | null>(null);
const playerSeat = ref<number>(-1); // -1 means no seat assigned yet (spectator)

// Sync colorSelectionEnabled from lobbyInfo (persists through lobby->game transition)
watch(lobbyInfo, (lobby) => {
  if (lobby?.colorSelectionEnabled !== undefined) {
    colorSelectionEnabled.value = lobby.colorSelectionEnabled;
  }
}, { immediate: true });

// UI state
const debugExpanded = ref(false);
// Ref to the mounted GameHistory (lives in the players panel). GameShell mediates
// Copy/Clear from DebugPanel without duplicating message state.
const historyPanel = ref<InstanceType<typeof GameHistory> | null>(null);
const zoomLevel = ref(1.0);
const autoEndTurn = ref(true); // Auto-end turn after making a move

// IA-06: Sidebar rail state. Default expanded; collapses to --bsg-rail on compact phones.
// The matchMedia listener ensures the rail collapses automatically when the viewport
// narrows to compact, but never forces expansion when viewport widens (user preference).
const sidebarRail = ref<boolean>(false);
// Mobile only: the sidebar defaults to a compact one-line player strip; this opens
// the full players + log as an overlay over the board (board stays the hero).
const mobileExpanded = ref<boolean>(false);
// True on phones (≤639px). Mobile uses its own compact-strip + overlay layout and
// must NOT inherit the desktop rail state — otherwise a rail collapsed on desktop
// would make the mobile overlay show icons (and hide the log) instead of the full panel.
const isCompact = ref<boolean>(false);
let compactQuery: MediaQueryList | null = null;
// Track the compact (phone) breakpoint so the mobile layout can ignore the desktop
// rail state. Collapsing the mobile overlay when leaving compact avoids a stuck
// overlay if the viewport widens while expanded.
function updateCompact(mql: MediaQueryList | MediaQueryListEvent) {
  isCompact.value = mql.matches;
  if (!mql.matches) mobileExpanded.value = false;
}

// Floating action dock height, measured so the board reserves matching scroll room
// at the bottom — anything the dock floats over can then be scrolled into view.
const dockHeight = ref<number>(68);
let dockResizeObserver: ResizeObserver | null = null;
const actionbarEl = ref<HTMLElement | null>(null);

// Connection health (IA-01): driven by postMessage heartbeat in platform mode.
// Starts 'connecting'; a valid heartbeat sets it to 'connected' and rearms a
// staleness timer (~10s). Replaces the hardcoded 'connected' string that was
// passed to the GameHeader badge.
const connectionHealth = ref<'connecting' | 'connected' | 'stale'>('connecting');
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

// Winner seats captured from the game_state postMessage (IA-07).
// Validated as number[] on receipt; stays [] in dev-WS mode (graceful degrade).
const winnerSeats = ref<number[]>([]);

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
const { state, connectionStatus, isConnected, isMyTurn, error, action, refreshState, reconnect } = useGame(
  client,
  gameId,
  { playerSeat }
);

// Screen-reader live-region message refs.
// Written only from watchers with immediate:false — never at mount (Pitfall 2).
const politeMessage = ref('');
const assertiveMessage = ref('');

// Emit an announce postMessage alongside each live-region write so a future
// host page can relay the announcement to its own AT-accessible DOM node.
function emitAnnounce(level: 'polite' | 'assertive', text: string): void {
  window.postMessage({ source: 'boardsmith-a11y', type: 'announce', level, text }, '*');
}

// Animation events - wire createAnimationEvents to server state
const animationEvents = createAnimationEvents({
  events: () => state.value?.state?.animationEvents,
});
provideAnimationEvents(animationEvents);

// Sync colorSelectionEnabled from game state (for non-lobby mode like --ai where lobbyInfo is never set)
watch(state, (s) => {
  if (s?.state?.colorSelectionEnabled) {
    colorSelectionEnabled.value = true;
  }
});

// Action metadata for auto-UI (selections, choices)
const actionMetadata = computed(() => {
  return state.value?.state?.actionMetadata as Record<string, ActionMetadata> | undefined;
});

// Per-action disabled reasons from PlayerGameState.disabledActions.
// Mirrors the actionMetadata computed; cast via `any` because PlayerGameState
// is typed in session/types but not imported here.
const disabledActions = computed(() => {
  return (state.value?.state as any)?.disabledActions as Record<string, string> | undefined;
});

// Global "Show action help" preference — persisted to localStorage.
// Initialized from localStorage on mount (default ON when key is absent).
// Mutated only by handleTeachingAction('help-toggle'); no server round-trip.
const isActionHelpVisible = ref(getActionHelpEnabled());

// Available actions (from flow state)
const availableActions = computed(() => {
  const flowState = state.value?.flowState as any;
  if (!flowState) return [];

  // Check awaitingPlayers for simultaneous actions
  if (flowState.awaitingPlayers?.length > 0) {
    const myPlayerState = flowState.awaitingPlayers.find(
      (p: { playerIndex: number }) => p.playerIndex === playerSeat.value
    );
    if (myPlayerState && !myPlayerState.completed) {
      return myPlayerState.availableActions || [];
    }
  }

  return flowState.availableActions || [];
});

// Whether the "Show action help" toggle has anything to reveal: true when any
// currently-available action carries help text or a disabled reason — mirrors
// the exact condition ActionPanel uses to render the per-action "?" affordance
// (`action.help || disabledActions[name]`). Drives ControlsMenu's `hasActionHelp`
// so a game that authored no help text never shows a present-but-inert toggle.
const hasActionHelp = computed(() => {
  const meta = actionMetadata.value;
  const disabled = disabledActions.value;
  return (availableActions.value as string[]).some(
    (name) => !!meta?.[name]?.help || !!disabled?.[name]
  );
});

// Game view - computed here so actionController can use it for element enrichment
// When viewing historical state (time travel), use that instead of live state
const gameView = computed(() => {
  if (timeTravelState.value) {
    return timeTravelState.value.view as any;
  }
  return state.value?.state.view as any;
});

// Platform mode: generic request/response bridge to the host (which relays to
// the games worker / executor). Every server operation the embedded game needs
// — fetching choices, stepping selections, cancelling, undo — goes through this
// ONE helper, so platform/dev branching lives in exactly one place. Adding a new
// server op only requires calling platformRequest(op, ...) and implementing the
// op in the executor; the host relay is generic and needs no per-op changes.
// This prevents the recurring "works in dev, broken in the iframe" class of bug
// where an individual server call forgot its platform branch.
let platformRequestSeq = 0;
const pendingPlatformRequests = new Map<string, (r: Record<string, unknown>) => void>();

function platformRequest(op: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Strip Vue reactivity (a reactive proxy / ref is not structured-cloneable) so the
  // natural `someRef.value` arg survives postMessage; a genuine live-element leak
  // still fails loud via assertCloneable inside toCloneablePayload.
  const cloneable = toCloneablePayload(op, payload);
  return new Promise((resolve) => {
    const requestId = `req-${platformRequestSeq++}`;
    const timer = setTimeout(() => {
      if (pendingPlatformRequests.delete(requestId)) {
        resolve({ success: false, error: `Timed out on '${op}'` });
      }
    }, 20000);
    pendingPlatformRequests.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    window.parent.postMessage({
      source: 'shufflewick-game',
      type: 'server_request',
      requestId,
      op,
      payload: cloneable,
    }, '*');
  });
}

// MR-01 closure: thread the projected tutorial step into the action controller so
// suppressAutoFill fires in production (not just in the unit tests that passed it
// directly). The controller already accepts tutorialStep; this is the missing wire.
const tutorialStep = computed(() => state.value?.state?.tutorial);

// Action controller - unified action handling for ActionPanel and custom UIs
// This provides 100% parity: same auto-fill, validation, and server communication
const actionController = useActionController({
  sendAction: async (actionName, args) => {
    if (platformMode.value) {
      // Request/response so the action RESULT (notably followUp, which chains the
      // next action e.g. explore -> take equipment) comes back to the controller,
      // matching the dev path. Fire-and-forget would drop followUp.
      const result = await platformRequest('action', { actionName, args });
      return result as ControllerActionResult;
    }
    const result = await action(actionName, args);
    return result as ControllerActionResult;
  },
  availableActions,
  actionMetadata,
  isMyTurn,
  gameView,
  playerSeat,
  // Use autoEndTurn ref for both autoFill and autoExecute
  // When auto mode is OFF, user must manually select each option even if only one choice
  autoFill: autoEndTurn,
  autoExecute: true, // Always auto-execute once all selections are manually filled
  // Tutorial step: gates tryAutoFillSelection when suppressAutoFill is active.
  // Computed from state so it stays reactive to server-projected step changes.
  tutorialStep,
  // Animation events for gating (shows "Playing animations..." during playback)
  animationEvents,
  // Selection choices - fetched from server on-demand for each selection
  fetchPickChoices: async (actionName, selectionName, player, currentArgs) => {
    if (platformMode.value) {
      return await platformRequest('resolve_choices', {
        actionName, selectionName, player, args: currentArgs ?? {},
      });
    }
    if (!gameId.value) {
      return { success: false, error: 'No game ID' };
    }
    try {
      const response = await fetch(`${props.apiUrl}/games/${gameId.value}/selection-choices`, {
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
      console.error('Fetch selection choices error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch selection choices' };
    }
  },
  // Cancel pending action on server (for onSelect-routed actions)
  cancelPendingAction: async (player) => {
    if (platformMode.value) {
      await platformRequest('cancel_action', { player });
      return;
    }
    if (!gameId.value) return;
    try {
      await fetch(`${props.apiUrl}/games/${gameId.value}/cancel-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player }),
      });
    } catch (err) {
      console.error('Cancel pending action error:', err);
    }
  },
  // Phase 3: Repeating selections - processed step by step on server
  pickStep: async (player, selectionName, value, actionName, initialArgs) => {
    if (platformMode.value) {
      return await platformRequest('selection_step', {
        player, selectionName, value, actionName, initialArgs,
      });
    }
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

// Read-only action args for display and slot props.
const actionArgs = computed(() => actionController.currentArgs.value);

// Extract messages from game state (prefer formatted messages from session, fall back to view)
const gameMessages = computed(() => {
  if (state.value?.state?.messages?.length) return state.value.state.messages;
  if (!state.value?.state?.view) return [];
  const view = state.value.state.view as any;
  return view.messages || [];
});

// Computed properties derived from game view
const players = computed(() => state.value?.state.players || []);
const myPlayer = computed(() => players.value.find(p => p.seat === playerSeat.value));
const opponentPlayers = computed(() => players.value.filter(p => p.seat !== playerSeat.value));

// Per-seat live connection status for the players panel. The lobby slots are the
// only source of truth for human presence (lobby-manager.setPlayerConnected), kept
// reactive in `lobbyInfo` for the life of the session. AI slots and modes with no
// lobby (e.g. --ai) leave `connected` undefined so PlayersPanel renders no indicator
// rather than fabricating presence we don't actually know.
const playersWithConnection = computed(() => {
  const slots = lobbyInfo.value?.slots;
  if (!slots) return players.value;
  return players.value.map((p) => {
    const slot = slots.find((s) => s.seat === p.seat);
    const connected = slot && slot.aiLevel == null ? slot.connected : undefined;
    return connected === undefined ? p : { ...p, connected };
  });
});
const currentPlayerName = computed(() => {
  const currentPos = state.value?.state?.currentPlayer;
  if (currentPos === undefined) return '';
  const player = players.value.find(p => p.seat === currentPos);
  return player?.name || `Player ${currentPos + 1}`;
});
// Awaiting player seats during simultaneous action steps
const awaitingPlayerSeats = computed(() => {
  const flowState = state.value?.flowState as any;
  if (!flowState?.awaitingPlayers?.length) return [];
  return flowState.awaitingPlayers
    .filter((p: any) => !p.completed && p.availableActions.length > 0)
    .map((p: any) => p.playerIndex);
});

// Awaiting player info for ActionPanel (names + colors for waiting message)
const awaitingPlayerNames = computed(() => {
  const flowState = state.value?.flowState as any;
  if (!flowState?.awaitingPlayers?.length) return [];
  return flowState.awaitingPlayers
    .filter((p: any) => !p.completed && p.availableActions.length > 0)
    .map((p: any) => {
      const player = players.value.find(pl => pl.seat === p.playerIndex);
      return { seat: p.playerIndex, name: player?.name || `Player ${p.playerIndex}`, color: typeof (player as any)?.color === 'string' ? (player as any).color : undefined };
    });
});

// Active player (whose turn it is, or first awaiting) for the action-bar turn
// token. index → token shape; matches the PlayersPanel ordering.
const activePlayer = computed(() => {
  const seat = state.value?.state?.currentPlayer ?? awaitingPlayerSeats.value[0];
  if (seat === undefined) return null;
  const index = players.value.findIndex(p => p.seat === seat);
  if (index < 0) return null;
  const p = players.value[index] as { name?: string; color?: string };
  return { name: p.name ?? `Player ${seat + 1}`, index, color: p.color };
});

const currentPlayerColor = computed((): string | undefined => {
  const currentPos = state.value?.state?.currentPlayer;
  if (currentPos === undefined) return undefined;
  const player = players.value.find(p => p.seat === currentPos) as Record<string, unknown> | undefined;
  if (!player) return undefined;
  return typeof player.color === 'string' ? player.color : undefined;
});

// Can undo - from PlayerGameState.canUndo
const canUndo = computed(() => {
  return state.value?.state?.canUndo ?? false;
});

// Board-provided prompt (for dynamic prompts based on UI state)
const boardPrompt = ref<string | null>(null);

function setBoardPrompt(prompt: string | null): void {
  boardPrompt.value = prompt;
}

// Undo actions back to turn start (called by ActionPanel)
async function handleUndo(): Promise<void> {
  if (platformMode.value) {
    const result = await platformRequest('undo', { player: playerSeat.value });
    if (!result.success) {
      console.error('Undo failed:', result.error);
      toast.error(result.error || 'Undo failed.');
    }
    // State update arrives via the game_state broadcast.
    return;
  }
  if (!gameId.value) return;
  try {
    const response = await fetch(`${props.apiUrl}/games/${gameId.value}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: playerSeat.value }),
    });
    const result = await response.json();
    if (!result.success) {
      console.error('Undo failed:', result.error);
      toast.error(result.error || 'Undo failed.');
    }
    // State update will come via WebSocket
  } catch (error) {
    console.error('Undo error:', error);
    toast.error(error instanceof Error ? error.message : 'Undo failed.');
  }
}

// Board interaction state (shared between ActionPanel and game board)
const boardInteraction = createBoardInteraction();
provideBoardInteraction(boardInteraction);

// Drag-and-drop orchestration (audit F36): derive drop targets generically from
// the action controller's current pick for ANY action shape, wired once here so
// the Action Panel AND custom UIs consume the same targets via useBoardInteraction.
setupDragDropOrchestration({
  boardInteraction,
  actionController,
  availableActions,
  actionMetadata,
  isMyTurn,
});

// Board-centric playability bridge (Phase 94): feeds the board-interaction
// substrate (selectable elements, click dispatch, auto-start, choice callback)
// from the action controller UNCONDITIONALLY — independent of whether the footer
// ActionPanel is mounted. This is what makes clicking the board execute actions
// when the panel is absent (D-02 board-centric default). The ActionPanel is now
// purely presentational; this is the single source that drives the board.
useBoardActionBridge({
  controller: actionController,
  boardInteraction,
  isMyTurn,
  autoEndTurn,
  actionMetadata,
  availableActions,
});

// Zoom preview (Alt+hover to enlarge cards) - uses event delegation for all cards
const { previewState } = useZoomPreview();

// Toast notifications
const toast = useToast();

// ── Teaching controls state (AI-01/02/03) ────────────────────────────────────
// isDemoRunning is derived from broadcast state — injected by GameSession.broadcast()
// when #demoMode is true. This ensures all connections (second window, reconnect)
// see the correct toggle state rather than a local ref that can desync (WR-04).
const isDemoRunning = computed(
  () => (state.value?.state as any)?.isDemoRunning ?? false
);

// Live demo playback-control state (paused, current speed delay, whether a
// step-back is possible), broadcast by SnapshotSessionHost while a demo runs.
const demoControls = computed(
  () => (state.value?.state as any)?.demoControls as
    | { paused: boolean; delay: number; canStepBack: boolean }
    | undefined
);

// Speed presets for the demo control bar (inter-move delay, ms).
const DEMO_SPEEDS = [
  { label: 'Slow', delay: 2200 },
  { label: 'Normal', delay: 1200 },
  { label: 'Fast', delay: 500 },
] as const;

async function sendDemoControl(
  control: 'pause' | 'play' | 'step' | 'back',
  delay?: number
): Promise<void> {
  try {
    await platformRequest('demo-control', delay !== undefined ? { control, delay } : { control });
  } catch {
    toast.error('Demo control failed.');
  }
}

function setDemoSpeed(delay: number): void {
  // Re-assert the current play/pause state alongside the new speed so the gate
  // re-arms its timer with the new delay immediately.
  void sendDemoControl(demoControls.value?.paused ? 'pause' : 'play', delay);
}

// Show Teaching group when:
//   (a) Production lobby path: at least one AI slot in lobbyInfo — unchanged.
//   (b) Dev-host (platform mode) path: SnapshotSessionHost injects hasAIPlayers
//       into broadcast state when aiSeats are present. GameSession (production)
//       never sets hasAIPlayers, so this branch is unreachable in prod (safe
//       by construction — RESEARCH Pitfall 5).
const showHintProp = computed<boolean | undefined>(() => {
  // Production lobby path — unchanged
  if (lobbyInfo.value?.slots?.some(s => s.aiLevel != null)) return true;
  // Dev-host path: SnapshotSessionHost injects hasAIPlayers into broadcast state
  if ((state.value?.state as any)?.hasAIPlayers) return true;
  return undefined;
});

// Show Tutorial group when the game definition has a tutorial attached.
// Reads from broadcast state (hasTutorial is set by buildPlayerState).
const hasTutorialProp = computed<boolean>(
  () => (state.value?.state as any)?.hasTutorial ?? false
);

// True when this seat's tutorial is currently active (status === 'running').
// Derived from the projected tutorial step view: when it is defined, the seat
// is in a running tutorial. When undefined (no tutorial, or exited/completed),
// the button reverts to "Start tutorial".
const isTutorialRunningProp = computed(
  () => tutorialStep.value !== undefined
);

// Hint is disabled when the local player is not at a decision point.
const hintDisabledProp = computed(
  () => !isMyTurn.value || availableActions.value.length === 0
);

// Heatmap toggle is optimistic: the server round-trip runs an MCTS search
// (~1s), and the broadcast `heatmap.visible` only flips when it returns. Without
// instant feedback the toggle looks unresponsive, so users click again — and
// because the first request hasn't broadcast yet, both clicks read the stale
// "off" state and both send visible:true ("had to click twice"). `heatmapPending`
// holds the requested state while a toggle is in flight so the pill reflects the
// click immediately; `heatmapToggling` guards against a duplicate request mid-flight.
const heatmapPending = ref<boolean | null>(null);
const heatmapToggling = ref(false);

// Heatmap visible state: the optimistic pending value while a toggle is in
// flight, otherwise the authoritative broadcast state.
const isHeatmapVisibleProp = computed(() =>
  heatmapPending.value !== null
    ? heatmapPending.value
    : ((state.value?.state as any)?.heatmap?.visible ?? false)
);

// Handle 'teaching-action' emits from ControlsMenu.
// Each action delegates to the appropriate platformRequest op so the dev bridge
// (Phase 109) and production host can implement the server-side handler.
async function handleTeachingAction(
  teachAction: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle' | 'start-tutorial' | 'exit-tutorial'
) {
  if (teachAction === 'hint') {
    // The MCTS search takes ~1s; show a persistent "thinking" toast so the
    // player gets immediate feedback instead of a dead button. Cleared as soon
    // as the hint resolves (or fails), just before the bubble/ring appears.
    const thinkingId = toast.show('Thinking about the best move…', {
      type: 'info',
      duration: 0,
    });
    try {
      await platformRequest('hint', { seat: playerSeat.value });
    } catch {
      toast.error('Hint unavailable — the AI could not suggest a move.');
    } finally {
      toast.remove(thinkingId);
    }
  } else if (teachAction === 'demo-toggle') {
    if (isDemoRunning.value) {
      try {
        await platformRequest('demo-stop', {});
        // isDemoRunning updates from the next broadcast — no local mutation needed.
      } catch {
        toast.error('Failed to stop demo.');
      }
    } else {
      try {
        await platformRequest('demo-start', {});
        // isDemoRunning updates from the next broadcast — no local mutation needed.
      } catch {
        toast.error('Failed to start demo.');
      }
    }
  } else if (teachAction === 'heatmap-toggle') {
    // Ignore a second toggle while one is still computing — otherwise rapid
    // clicks race on the stale broadcast state and the toggle ends up wrong.
    if (heatmapToggling.value) return;
    const nextVisible = !isHeatmapVisibleProp.value;
    heatmapPending.value = nextVisible; // optimistic: flip the pill immediately
    heatmapToggling.value = true;
    try {
      await platformRequest('heatmap-toggle', {
        seat: playerSeat.value,
        visible: nextVisible,
      });
    } catch {
      toast.error('Failed to toggle move quality display.');
    } finally {
      // The broadcast carrying the new heatmap state is delivered before the op
      // response resolves (WS order), so clearing the optimistic value here hands
      // back to the authoritative server state with no flicker.
      heatmapToggling.value = false;
      heatmapPending.value = null;
    }
  } else if (teachAction === 'help-toggle') {
    // Pure client display preference — no server round-trip.
    isActionHelpVisible.value = !isActionHelpVisible.value;
    setActionHelpEnabled(isActionHelpVisible.value);
  } else if (teachAction === 'start-tutorial') {
    try {
      await platformRequest('start-tutorial', { seat: playerSeat.value });
    } catch {
      toast.error('Failed to start tutorial.');
    }
  } else if (teachAction === 'exit-tutorial') {
    try {
      await platformRequest('exit-tutorial', { seat: playerSeat.value });
    } catch {
      toast.error('Failed to exit tutorial.');
    }
  }
}

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
provide('playerSeat', playerSeat);
provide('isMyTurn', isMyTurn);
provide('availableActions', availableActions);
provide('actionController', actionController);
provide('timeTravelDiff', timeTravelDiff);
// The debug panel issues its queries/edits through the host bridge (dev only).
provide('platformRequest', platformRequest);
// Presentation overlay — provided reactively for AutoRenderer → renderers chain (D-04)
provide('presentation', toRef(props, 'presentation'));

// Mount: in platform mode the host (ShufflewickPub in prod, the boardsmith dev
// host locally) manages the session and drives everything via postMessage.
onMounted(async () => {
  // TOKEN-05: Install the Slate token base stylesheet once on mount. This is the
  // single install point for the hosted chrome; it is idempotent so repeated
  // mounts and HMR reloads are safe. A host-supplied theme override arrives later
  // via the init postMessage and is applied by consumeInitMessage below.
  applyTheme();

  // IA-06: Collapse sidebar to rail by default on compact phones (≤639px).
  // This runs after paint so the initial state is correct before first render.
  compactQuery = window.matchMedia(`(max-width: ${BREAKPOINTS.compact - 1}px)`);
  updateCompact(compactQuery);
  compactQuery.addEventListener('change', updateCompact);

  // Track the floating dock's height so the board reserves matching scroll room at
  // the bottom — covered board content can then always be scrolled into view.
  if (actionbarEl.value && typeof ResizeObserver !== 'undefined') {
    dockResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      // Use the BORDER-box height (the dock's full on-screen footprint incl. padding),
      // plus a small buffer so revealed content clears the dock edge. contentRect
      // excludes padding and would leave the board's bottom slightly under the dock.
      const h = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.target.getBoundingClientRect().height;
      if (h != null) dockHeight.value = Math.round(h) + 8;
    });
    dockResizeObserver.observe(actionbarEl.value);
  }

  if (platformMode.value) return;

  // A game ONLY runs through the production path: GameShell embedded in an
  // <iframe> as platform mode. A top-level (non-iframe) load can't run a game,
  // so send the visitor to the host page rather than the removed dev-server path.
  if (window.location.pathname !== '/') {
    window.location.replace('/');
  }
});

// Cleanup on unmount
onUnmounted(() => {
  compactQuery?.removeEventListener('change', updateCompact);
  dockResizeObserver?.disconnect();
  if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
  disconnectFromLobby();
  if (platformMessageHandler) {
    window.removeEventListener('message', platformMessageHandler);
  }
  for (const [, cb] of pendingPlatformRequests) {
    cb({ success: false, error: 'GameShell unmounted' });
  }
  pendingPlatformRequests.clear();
});

// Platform mode: postMessage bridge for iframe embedding
// When hosted inside a platform like ShufflewickPub, the parent page manages
// the session/lobby and sends game state via postMessage. The game UI just
// renders the board and sends actions back.
let platformMessageHandler: ((event: MessageEvent) => void) | null = null;

if (typeof window !== 'undefined' && window.parent !== window) {
  platformMessageHandler = (event: MessageEvent) => {
    // Origin check: event.origin is browser-enforced and cannot be spoofed by
    // the sender, unlike fields inside event.data. isOriginAllowed passes all
    // origins when trustedOrigins is unset (preserving existing behavior); the
    // host locks this down via the trustedOrigins prop (HOST-02).
    if (!isOriginAllowed(event.origin, props.trustedOrigins)) return;

    const data = event.data;
    // Lightweight message-shape filter: data.source is a sender-controlled field,
    // not a security control (use trustedOrigins for that). It filters out
    // unrelated window messages that happen to arrive while the iframe is open.
    if (!data || data.source !== 'shufflewick') return;

    if (data.type === 'init') {
      playerSeat.value = data.seat;
      currentScreen.value = 'game';
      // TOKEN-05: consume any host-supplied theme override delivered at iframe init.
      // consumeInitMessage calls applyTheme() which enforces the --bsg-* key
      // allowlist — this prevents unknown CSS property names but does NOT prevent
      // an attacker from overriding legitimate tokens. Origin validation (above)
      // is the primary security control for the theme-injection path.
      consumeInitMessage(data, { applyTheme });
    }

    if (data.type === 'server_response') {
      const cb = pendingPlatformRequests.get(data.requestId);
      if (cb) {
        pendingPlatformRequests.delete(data.requestId);
        // `result` is the executor op's full result object (choices, step
        // result, etc.). Fall back to the message itself for resilience.
        cb((data.result ?? data) as Record<string, unknown>);
      }
      return;
    }

    // Dev-only UI switcher (boardsmith dev). Ignored in production builds.
    if (data.type === 'dev-ui-select' && isDevBuild) {
      selectedUiName.value = typeof data.name === 'string' ? data.name : '';
      return;
    }
    if (data.type === 'dev-ui-list-request' && isDevBuild) {
      postDevUiList();
      return;
    }

    // Dev-only: the Dev header (DevHost chrome) owns the Debug toggle now. It
    // posts this to open/close the in-iframe DebugPanel. GameShell echoes the
    // resulting state back via the debugExpanded watcher so the header stays synced.
    if (data.type === 'dev-debug-toggle' && isDevBuild) {
      debugExpanded.value = !debugExpanded.value;
      return;
    }

    if (data.type === 'game_state' && platformMode.value) {
      const view = data.view as { flowState?: unknown; state?: Record<string, unknown> } | undefined;
      if (!view?.state) return;

      // The host now sends the SAME { flowState, state } shape the dev server's
      // WebSocket sends, where `state` is the full PlayerGameState produced by
      // buildPlayerState. Assign it directly -- exactly like the dev path -- so
      // the auto-UI and custom UIs receive everything (currentPlayer,
      // awaitingPlayers via flowState, canUndo, animation events, full player
      // attributes, action metadata, messages) with no field dropped. Hand-mapping
      // individual fields here is what caused the recurring "works in dev, broken
      // in the iframe" bugs, so there is deliberately no per-field reconstruction.
      if (view.state.colorSelectionEnabled) {
        colorSelectionEnabled.value = true;
      }

      state.value = {
        flowState: view.flowState,
        state: view.state,
        playerSeat: playerSeat.value,
        isSpectator: false,
      } as any;

      // Capture winners from the game_state message (IA-07, T-100-06-01).
      // Validated as number[] before assigning — protects against tampered payloads.
      // In dev-WS mode the message does not include winners, so winnerSeats stays [].
      winnerSeats.value =
        Array.isArray(data.winners) &&
        (data.winners as unknown[]).every((n: unknown) => typeof n === 'number')
          ? (data.winners as number[])
          : [];
    }

    // Heartbeat: host pings periodically to prove the connection is live (IA-01).
    // Shape-validated before acting (T-100-04-01, T-100-04-02): origin is already
    // guarded by isOriginAllowed above; we additionally confirm source + type so
    // unrelated window messages cannot spoof the health state.
    if (data.type === 'heartbeat') {
      if (
        typeof data === 'object' &&
        data !== null &&
        data.source === 'shufflewick' &&
        data.type === 'heartbeat'
      ) {
        connectionHealth.value = 'connected';
        if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
        heartbeatTimer = setTimeout(() => {
          connectionHealth.value = 'stale';
        }, 10_000);
      }
    }
  };
  window.addEventListener('message', platformMessageHandler);
  // Advertise the available UIs to the dev host so it can render the switcher
  // dropdown (dev-only; no-op in production).
  postDevUiList();
  // Keep the Dev header's Debug toggle in sync with the panel's actual open state
  // (it can also be toggled via the in-panel ✕ or Ctrl/Cmd+D). Dev-only.
  if (isDevBuild) {
    watch(debugExpanded, (open) => {
      window.parent.postMessage(
        { source: 'shufflewick-game', type: 'dev-debug-state', open },
        '*'
      );
    });
  }
  // NOTE: auto-executing a sole endTurn (and auto-starting any single action) is
  // now owned by useBoardActionBridge, which runs unconditionally above — so it
  // works whether or not the footer ActionPanel is mounted.
}

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
      playerSeat.value = 1; // Creator defaults to seat 1
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
        updateUrl(result.gameId, 1);
      }
    }
  } catch (err) {
    console.error('Failed to create game:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to create game.');
  }
}

// Lobby WebSocket connection functions
function connectToLobby(gid: string) {
  hmrLog('connectToLobby', gid, {
    existingConnection: !!lobbyConnection.value,
  });

  // Disconnect any existing connection
  disconnectFromLobby();

  // Create a new connection for the lobby
  const connection = new GameConnection(props.apiUrl, {
    gameId: gid,
    playerId: playerId.value,
    playerSeat: playerSeat.value,
    autoReconnect: true,
  });

  // Listen for lobby updates
  connection.onLobbyChange((lobby) => {
    hmrLog('onLobbyChange', {
      state: lobby.state,
      slots: lobby.slots.map(s => ({ seat: s.seat, status: s.status })),
    });
    lobbyInfo.value = lobby;

    // If game has started, transition to game
    if (lobby.state === 'playing') {
      disconnectFromLobby();

      // Find my seat from the lobby slots
      const mySlot = lobby.slots.find(s => s.playerId === playerId.value);
      if (mySlot) {
        playerSeat.value = mySlot.seat;
      }

      gameId.value = gid;
      currentScreen.value = 'game';
      updateUrl(gid, playerSeat.value);
    }
  });

  // Handle connection errors
  connection.onError((err) => {
    hmrLog('connection.onError', err);
    console.error('Lobby connection error:', err);
  });

  // Log connection state changes
  connection.onConnectionChange?.((status) => {
    hmrLog('connection.onConnectionChange', status);
  });

  // Connect
  connection.connect();
  lobbyConnection.value = connection;
}

function disconnectFromLobby() {
  hmrLog('disconnectFromLobby', { hadConnection: !!lobbyConnection.value });
  if (lobbyConnection.value) {
    lobbyConnection.value.disconnect();
    lobbyConnection.value = null;
  }
}

async function joinGame() {
  if (!joinGameId.value.trim()) {
    toast.error('Please enter a game code.');
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

        // Check if there are open slots to join
        const hasOpenSlots = lobby.slots.some(s => s.status === 'open');

        if (hasOpenSlots) {
          // Auto-join the lobby (server assigns seat)
          const playerName = getPlayerName() || `Player ${lobby.slots.length + 1}`;
          const joinResult = await client.joinLobby(gid, playerName);

          if (joinResult.success && joinResult.lobby) {
            lobbyInfo.value = joinResult.lobby;

            // Check if game started (all slots filled)
            if (joinResult.lobby.state === 'playing' && joinResult.seat) {
              playerSeat.value = joinResult.seat;
              gameId.value = gid;
              currentScreen.value = 'game';
              updateUrl(gid, joinResult.seat);
              return;
            }
          } else {
            // Join failed, show lobby anyway so they can try manually
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
    } catch (e) {
      // Only fall through if lobby doesn't exist
      // Re-throw other errors (like joinLobby failures)
      if (e instanceof Error && !e.message.includes('lobby')) {
        throw e;
      }
      // No lobby info - game might be old-style without lobby
    }

    // Direct join (legacy flow or game already playing)
    const stateResult = await client.getGameState(gid, 1);

    if (stateResult) {
      playerSeat.value = 1;
      gameId.value = gid;
      currentScreen.value = 'game';
      updateUrl(gid, 1);
    }
  } catch (err) {
    console.error('Failed to join game:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to join game. Check the game code.');
  }
}

// Resume a persisted game by ID
async function resumeGame(gid: string) {
  joinGameId.value = gid;
  await joinGame();
}

// Lobby event handlers
async function handleJoinLobby(name: string) {
  if (!createdGameId.value) return;

  try {
    const result = await client.joinLobby(createdGameId.value, name);

    if (result.success && result.lobby) {
      lobbyInfo.value = result.lobby;
      // Save name for future games
      setPlayerName(name);

      // If game started, transition
      if (result.lobby.state === 'playing' && result.seat) {
        disconnectFromLobby();
        playerSeat.value = result.seat;
        gameId.value = createdGameId.value;
        currentScreen.value = 'game';
        updateUrl(createdGameId.value, result.seat);
      }
    } else {
      toast.error(result.error || 'Failed to join lobby.');
    }
  } catch (err) {
    console.error('Failed to join lobby:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to join lobby.');
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

        // Find my seat from the lobby slots
        const mySlot = result.lobby.slots.find(s => s.playerId === playerId.value);
        if (mySlot) {
          playerSeat.value = mySlot.seat;
        }

        gameId.value = createdGameId.value;
        currentScreen.value = 'game';
        updateUrl(createdGameId.value, playerSeat.value);
      }
    } else {
      console.error('Failed to set ready:', result.error);
      toast.error(result.error || 'Failed to mark as ready.');
    }
  } catch (err) {
    console.error('Failed to set ready:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to mark as ready.');
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
    try {
      await client.leavePosition(createdGameId.value);
    } catch (err) {
      console.error('[Leave] Failed to leave position:', err);
      // Continue with cleanup even if leave fails
    }
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
  // In platform mode the host owns which seat the iframe renders; ask it to
  // switch (the dev host reloads this iframe as that seat).
  if (platformMode.value) {
    void platformRequest('debug:switch-seat', { seat: position });
    return;
  }
  playerSeat.value = position;
  if (gameId.value) {
    updateUrl(gameId.value, position);
  }
}

async function handleRestartGame() {
  // In platform mode the host owns the session; ask it to start a fresh game.
  if (platformMode.value) {
    void platformRequest('debug:restart', {});
    return;
  }
  if (!gameId.value) return;

  try {
    await client.restartGame(gameId.value);
    // The server broadcasts the restart to all clients via WebSocket,
    // so the state will update automatically
  } catch (err) {
    console.error('Failed to restart game:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to restart game.');
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

// Retry handler — wired from AutoUI → GameShell when the user clicks Retry
// after the 8-second loading timeout (DEV-05).
// In platform mode (iframe inside dev host or prod host): post a request-state
// message to the parent so it re-sends the last game_state. This covers the
// case where the iframe mounted before the host sent its first game_state.
// In standalone/WebSocket mode: call refreshState() which sends a state request
// on the existing GameConnection, and reconnect() to re-open the socket if it
// dropped.
function handleRetry(): void {
  if (platformMode.value) {
    window.parent.postMessage(
      { source: 'shufflewick-game', type: 'request-state' },
      '*'
    );
    return;
  }
  // Non-platform: refresh state via WebSocket (requestState) and ensure the
  // connection is live (reconnect is a no-op if already connected).
  refreshState();
  reconnect();
}

// ── Live-region watchers (immediate: false — never write to regions at mount) ─

watch(isMyTurn, (newVal) => {
  const text = announceTurnChange(newVal);
  if (text) {
    politeMessage.value = text;
    emitAnnounce('polite', text);
  }
}, { immediate: false });

watch(connectionStatus, (newVal, oldVal) => {
  const text = announceConnectionChange(newVal, oldVal ?? '');
  if (text) {
    politeMessage.value = text;
    emitAnnounce('polite', text);
  }
}, { immediate: false });

watch(
  () => (state.value?.flowState as any)?.complete,
  (newComplete, oldComplete) => {
    if (newComplete && !oldComplete) {
      const flowState = state.value?.flowState as any;
      const winnerSeats: number[] = flowState?.winners ?? [];
      const winnerNames = winnerSeats.map((seat) => {
        const p = players.value.find((pl) => pl.seat === seat);
        return (p as any)?.name || `Player ${seat}`;
      });
      const text = announceGameOver(winnerNames);
      assertiveMessage.value = text;
      emitAnnounce('assertive', text);

      // Stop any running AI demo when the game completes. isDemoRunning is
      // now derived from broadcast state (WR-04), so we only fire the request;
      // the session broadcasts the updated state on its own.
      if (isDemoRunning.value) {
        void platformRequest('demo-stop', {}).catch(() => {/* best-effort */});
      }
    }
  },
  { immediate: false },
);

watch(awaitingPlayerNames, (newVal) => {
  if (newVal.length > 0 && !isMyTurn.value) {
    const text = announceOpponentTurn(newVal.map((p: any) => p.name));
    if (text) {
      politeMessage.value = text;
      emitAnnounce('polite', text);
    }
  }
}, { immediate: false });

// Expose to parent/slots
defineExpose({
  state,
  gameView,
  players,
  myPlayer,
  playerSeat,
  isMyTurn,
  availableActions,
  action,
  actionController,
  connectionStatus,
  error,
  leaveGame,
});

// HMR detection - log state before and after hot reload
if ((import.meta as any).hot) {
  (import.meta as any).hot.on('vite:beforeUpdate', () => {
    hmrLog('vite:beforeUpdate', {
      screen: currentScreen.value,
      hasLobbyInfo: !!lobbyInfo.value,
      hasConnection: !!lobbyConnection.value,
      gameId: gameId.value,
      createdGameId: createdGameId.value,
    });
  });

  (import.meta as any).hot.on('vite:afterUpdate', () => {
    hmrLog('vite:afterUpdate', {
      screen: currentScreen.value,
      hasLobbyInfo: !!lobbyInfo.value,
      hasConnection: !!lobbyConnection.value,
      gameId: gameId.value,
      createdGameId: createdGameId.value,
    });
  });
}
</script>

<template>
  <div class="game-shell" :class="{ 'game-shell--platform': platformMode }">
    <!-- Skip link: visually hidden until focused; .sr-skip in global style block -->
    <a class="sr-skip" href="#main">Skip to game board</a>

    <!-- Visually-hidden page title for AT landmarks -->
    <h1 class="vh">BoardSmith — game board</h1>

    <!-- Visually-hidden live regions — always mounted, never v-if (Pitfall 2).
         Written only from watchers with immediate:false so ATs register the
         regions before any content appears. -->
    <p class="vh" role="status" aria-live="polite">{{ politeMessage }}</p>
    <p class="vh" role="alert" aria-live="assertive">{{ assertiveMessage }}</p>
    <!-- Always-mounted prompt region: value is empty when not the player's turn.
         Replaces the conditionally-mounted duplicate that was inside the actionbar
         v-if block (WR-04). Mounting the region before writing content is required
         for ATs to register it (Pitfall 2). -->
    <span class="vh" aria-live="polite">{{ (isMyTurn || awaitingPlayerNames.length) ? (boardPrompt ?? actionController.currentPick.value?.prompt) : '' }}</span>

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
      @join="handleJoinLobby"
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
      <!-- Top Header Bar — dev/standalone only; absent in platform mode (IA-01) -->
      <GameHeader
        v-if="!platformMode"
        :game-title="displayName || gameType"
        :game-id="gameId"
        :connection-status="connectionStatus"
        v-model:zoom="zoomLevel"
        v-model:auto-end-turn="autoEndTurn"
        @menu-item-click="handleMenuItemClick"
      />

      <!-- Stage: sidebar + boardregion side by side (full-width actionbar is a sibling, below) -->
      <div class="stage">
        <!-- Sidebar: always-visible player status + history; collapses to rail (IA-06) -->
        <aside class="sidebar" :class="{ rail: sidebarRail, 'mobile-expanded': mobileExpanded }" aria-label="Players and log">
          <!-- Rail toggle button: absolutely positioned on the right edge of the sidebar (IA-06) -->
          <button
            class="side-edge"
            type="button"
            :aria-label="sidebarRail ? 'Expand panel' : 'Collapse panel'"
            :aria-expanded="!sidebarRail"
            @click="sidebarRail = !sidebarRail"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Mobile only (CSS-gated): a one-line player-icon strip with an expand
               toggle. Keeps the board the hero; the full panel + log open as an
               overlay below (see .mobile-expanded). -->
          <div class="mobile-strip">
            <PlayersPanel
              class="mobile-strip__players"
              :players="players"
              :player-seat="playerSeat"
              :current-player-seat="state?.state.currentPlayer"
              :awaiting-player-seats="awaitingPlayerSeats"
              seat-strip
            />
            <button
              class="mobile-strip__toggle"
              type="button"
              :aria-expanded="mobileExpanded"
              :aria-label="mobileExpanded ? 'Hide players and log' : 'Show players and log'"
              @click="mobileExpanded = !mobileExpanded"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- No header band: host branding (ShufflewickPub pull-down tab) overlays
               the top in production, and the ⋯ controls now live in the action bar. -->
          <div class="side-scroll">
            <PlayersPanel
              :players="playersWithConnection"
              :player-seat="playerSeat"
              :current-player-seat="state?.state.currentPlayer"
              :awaiting-player-seats="awaitingPlayerSeats"
              :seat-strip="!isCompact && sidebarRail"
            >
              <template #player-stats="{ player }">
                <!-- Expose interaction state so a game's player-stats can be actionable
                     (e.g. tap your own special ability to use it), not just informational.
                     player is the panel's player; playerSeat is the local seat. -->
                <slot
                  name="player-stats"
                  :player="player"
                  :game-view="gameView"
                  :players="players"
                  :player-seat="playerSeat"
                  :is-my-turn="isMyTurn"
                  :available-actions="availableActions"
                  :action-controller="actionController"
                ></slot>
              </template>
            </PlayersPanel>

            <slot name="sidebar-extra"
              :state="state"
              :game-view="gameView"
              :players="players"
            ></slot>

            <!-- Game History in the side-scroll: shown when expanded on desktop, and
                 always on mobile (inside the overlay). The desktop rail uses the sheet. -->
            <GameHistory
              v-if="showHistory && (isCompact || !sidebarRail)"
              ref="historyPanel"
              :messages="gameMessages"
              class="sidebar-history"
            />
          </div>
        </aside>

        <!-- Board region: hero; ~zero chrome padding; container-query-sized.
             --dock-h carries the floating dock's measured height so the board has
             matching scroll room at the bottom (covered content stays reachable). -->
        <main class="boardregion" id="main" role="main" :style="{ '--dock-h': dockHeight + 'px' }">
          <!-- Connection health dot: platform mode only, and only surfaced when there's
               something to say (stale/connecting). A healthy connection shows nothing —
               a persistent green dot over the board just reads as a mystery speck (IA-01).
               Dev/standalone uses the GameHeader connection badge instead. -->
          <span
            v-if="platformMode && connectionHealth !== 'connected'"
            class="conn-dot"
            :class="connectionHealth"
            :title="connectionHealth === 'stale' ? 'Connection lost — reconnecting…' : 'Connecting…'"
            aria-hidden="true"
          ></span>
          <!-- Game Over result card: overlays the board behind a Slate scrim (IA-07).
               Scrim is absolute inside .boardregion — cannot cover the .actionbar sibling
               or browser chrome (T-100-06-02). winnerSeats degrades to [] in dev-WS mode.
               @new-game → handleMenuItemClick goes back to lobby; @rematch → restarts same game. -->
          <GameOverCard
            v-if="state?.flowState?.complete"
            :winner-seats="winnerSeats"
            :players="players"
            @new-game="handleMenuItemClick('new-game')"
            @rematch="handleRestartGame"
          />
          <!-- Tutorial annotation overlay: mounts once here so it appears over BOTH
               the #game-board slot (custom UI) and the dev UI-switcher <component>
               path. Position is absolute inside .boardregion (inset: 0, z-index: 20).
               Sits above the turn prompt (z-5) and below GameOverCard scrim (z-50).
               No props — injects gameState and renders only when tutorial.content
               is present (v-if internal). Not inside zoom-container so it measures
               boardregion rects unscaled by --zoom-level. -->
          <TutorialOverlay />
          <!-- AI hint overlay (AI-01): renders when state.hint is set.
               Shares z-index 20 with TutorialOverlay — both may coexist (Phase 109).
               Teleports to body (position:fixed); resolves data-bs-el-* anchors the
               same way TutorialOverlay does — no renderer coupling (project hard-rule). -->
          <HintOverlay />
          <!-- Heatmap overlay (AI-03): renders when state.heatmap.visible is true.
               z-index 15 — below TutorialOverlay/HintOverlay, above turn prompt (z-5).
               pointer-events:none throughout. Resolves same data-bs-el-* anchors. -->
          <HeatmapOverlay />
          <!-- AI demo narration card (AI-02): announces each move before it executes.
               Rendered via BoardMessage variant="narration" (position:fixed, top, z-10).
               Text is from broadcast state.narration (engine-derived, plain string —
               never v-html, T-107-08 mitigated). -->
          <BoardMessage
            v-if="(state?.state as any)?.narration?.text"
            variant="narration"
            :visible="true"
          >{{ (state?.state as any)?.narration?.text }}</BoardMessage>
          <!-- AI demo playback controls — speed + step so the learner follows at
               their own pace. Fixed bottom-center (never over the board). -->
          <div
            v-if="isDemoRunning && demoControls"
            class="bsg-demo-controls"
            role="group"
            aria-label="AI demo playback controls"
          >
            <div class="bsg-demo-controls__speeds" role="group" aria-label="Speed">
              <button
                v-for="s in DEMO_SPEEDS"
                :key="s.label"
                type="button"
                class="bsg-demo-btn bsg-demo-btn--speed"
                :class="{ 'is-active': demoControls.delay === s.delay }"
                :aria-pressed="demoControls.delay === s.delay"
                @click="setDemoSpeed(s.delay)"
              >{{ s.label }}</button>
            </div>
            <span class="bsg-demo-controls__sep" aria-hidden="true"></span>
            <button
              type="button"
              class="bsg-demo-btn"
              :disabled="!demoControls.canStepBack"
              aria-label="Step back one move"
              title="Step back"
              @click="sendDemoControl('back')"
            >◀</button>
            <button
              type="button"
              class="bsg-demo-btn bsg-demo-btn--play"
              :aria-label="demoControls.paused ? 'Play' : 'Pause'"
              :title="demoControls.paused ? 'Play' : 'Pause'"
              @click="sendDemoControl(demoControls.paused ? 'play' : 'pause')"
            >{{ demoControls.paused ? '▶' : '⏸' }}</button>
            <button
              type="button"
              class="bsg-demo-btn"
              aria-label="Step forward one move"
              title="Step forward"
              @click="sendDemoControl('step')"
            >▶❘</button>
            <span class="bsg-demo-controls__sep" aria-hidden="true"></span>
            <button
              type="button"
              class="bsg-demo-btn bsg-demo-btn--stop"
              aria-label="Stop demo"
              @click="handleTeachingAction('demo-toggle')"
            >Stop</button>
          </div>
          <div class="game-shell__zoom-container" :style="{ '--zoom-level': zoomLevel }">
            <!--
              Game Board Slot Props:
              - actionController: USE THIS for all action handling (start, fill, execute, cancel)
              - actionArgs: Read-only view of current selection args (for UI display)
              - Other props: game state for rendering
            -->
            <!-- Dev-only UI switcher: render the selected non-primary UI (an
                 extra `uis` entry or the built-in auto-UI) with the same slot
                 props. Falls through to the #game-board slot for the primary UI
                 and always in production (selectedUiComponent is null there). -->
            <component
              v-if="selectedUiComponent"
              :is="selectedUiComponent"
              :state="state"
              :game-view="gameView || null"
              :players="players"
              :my-player="myPlayer"
              :player-seat="playerSeat"
              :is-my-turn="isMyTurn"
              :available-actions="availableActions"
              :action-args="actionArgs"
              :set-board-prompt="setBoardPrompt"
              :can-undo="canUndo && !isViewingHistory"
              :undo="handleUndo"
              :action-controller="actionController"
              :is-action-help-visible="isActionHelpVisible"
              :disabled-actions="disabledActions"
              :flow-state="state?.flowState"
              @retry="handleRetry"
            />
            <slot
              v-else
              name="game-board"
              :state="state"
              :game-view="gameView"
              :players="players"
              :my-player="myPlayer"
              :player-seat="playerSeat"
              :is-my-turn="isMyTurn"
              :available-actions="availableActions"
              :action-args="actionArgs"
              :set-board-prompt="setBoardPrompt"
              :can-undo="canUndo && !isViewingHistory"
              :undo="handleUndo"
              :action-controller="actionController"
              :is-action-help-visible="isActionHelpVisible"
              :disabled-actions="disabledActions"
            >
              <div class="empty-game-area">
                <p>Add your game board in the #game-board slot</p>
              </div>
            </slot>
          </div>
        </main>
        <!-- No floating log button: the log lives in the players panel. Collapse the
             sidebar rail / mobile strip to hide it; expand to read it. -->
        <!-- Scrim: active only on mobile when the player strip is expanded into the
             full overlay. Tapping it collapses back to the strip. Sibling of .stage
             children so it sits inside .stage and never covers the .actionbar below. -->
        <div
          class="scrim"
          :class="{ active: mobileExpanded }"
          aria-hidden="true"
          @click="mobileExpanded = false"
        ></div>
      </div>

      <!-- Floating action dock: absolutely positioned over the BOTTOM of the game
           area (full width) so showing/growing it NEVER reflows or moves the board.
           Its options list caps at 5 rows and scrolls; the board reserves the dock's
           measured height as scroll room so anything it floats over stays reachable. -->
      <div class="actionbar" role="region" aria-label="Actions" ref="actionbarEl">
        <!-- ⋯ controls menu: always available at the far-left of the bar (the sole
             control surface in platform mode, where GameHeader is hidden). Opens
             upward since the bar is bottom-anchored. -->
        <ControlsMenu
          class="actionbar-controls"
          open-up
          align="left"
          v-model:auto-end-turn="autoEndTurn"
          v-model:zoom="zoomLevel"
          :can-undo="canUndo && !isViewingHistory"
          :show-hint="showHintProp"
          :hint-disabled="hintDisabledProp"
          :is-demo-running="isDemoRunning"
          :is-heatmap-visible="isHeatmapVisibleProp"
          :is-action-help-visible="isActionHelpVisible"
          :has-action-help="hasActionHelp"
          :has-tutorial="hasTutorialProp"
          :is-tutorial-running="isTutorialRunningProp"
          @undo="handleUndo"
          @menu-item-click="handleMenuItemClick"
          @teaching-action="handleTeachingAction"
        />
        <!-- Dock: only render when player is actionable (IA-04) -->
        <template v-if="isMyTurn || awaitingPlayerNames.length">
          <!-- Active-player identity token: always shown at the head of the dock so
               the action bar carries WHO is acting (IA-02), regardless of whether the
               ActionPanel or the fallback prompt strip renders the WHAT. -->
          <PlayerToken
            v-if="activePlayer"
            class="turn-token"
            :name="activePlayer.name"
            :index="activePlayer.index"
            :color="activePlayer.color"
            :size="30"
          />
          <!-- Turn strip: the fallback prompt surface. Shown ONLY when the ActionPanel
               is explicitly suppressed (the D-02 escape hatch) — that way the prompt
               survives even when no panel renders (IA-03, never a silent board). -->
          <span
            v-if="props.suppressActionPanel"
            class="turn"
          >
            <span class="pr">{{ boardPrompt ?? actionController.currentPick.value?.prompt }}</span>
          </span>
          <!-- Action panel: mounted whenever not explicitly suppressed — INCLUDING the
               all-board-anchored case, where ActionPanel renders its anchored-choices
               operable button list ("Select on board or choose here"). That focusable
               list is the keyboard/SR safety net (A11Y C-2): the panel is never fully
               removed while a pick has choices, so custom UIs whose board isn't
               keyboard-operable still expose an operable control. -->
          <template v-if="!props.suppressActionPanel">
            <slot name="action-panel">
              <ActionPanel
                :available-actions="isViewingHistory ? [] : availableActions"
                :action-metadata="isViewingHistory ? {} : actionMetadata"
                :is-action-help-visible="isActionHelpVisible"
                :disabled-actions="isViewingHistory ? undefined : disabledActions"
                :players="players"
                :player-seat="playerSeat"
                :is-my-turn="isMyTurn && !isViewingHistory"
                :can-undo="canUndo && !isViewingHistory"
                :auto-end-turn="autoEndTurn"
                :messages="gameMessages"
                :current-player-name="currentPlayerName"
                :current-player-color="currentPlayerColor"
                :awaiting-players="awaitingPlayerNames"
                @undo="handleUndo"
              />
            </slot>
            <!-- Time travel banner -->
            <div v-if="isViewingHistory" class="time-travel-banner">
              <span class="time-travel-icon">⏰</span>
              Viewing historical state (action {{ timeTravelActionIndex }}) - Actions disabled
            </div>
          </template>
        </template>
      </div>

      <!-- Debug Panel: dev only. Renders inside the dev host iframe (platform
           mode + dev build); never in a deployed/production embed. -->
      <DebugPanel
        v-if="debugMode && platformMode && isDevBuild"
        :state="state"
        :player-seat="playerSeat"
        :player-count="playerCount"
        :game-id="gameId"
        :history-has-messages="historyPanel?.hasMessages.value ?? false"
        v-model:expanded="debugExpanded"
        @switch-player="handleSwitchPlayer"
        @restart-game="handleRestartGame"
        @time-travel="handleTimeTravel"
        @highlight-element="handleHighlightElement"
        @copy-history="() => historyPanel?.copyHistory()"
        @clear-history="() => historyPanel?.clearHistory()"
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

<!-- Global (non-scoped) a11y primitives owned by GameShell — covers all
     descendant components including those in slots and child trees. -->
<style>
/* ─── Visible focus ring ────────────────────────────────────────────────────
   Replaces UA default outline with a token-colored ring that satisfies WCAG
   2.2 Focus Appearance (3:1 minimum contrast). Non-scoped so it applies
   everywhere — child components no longer need per-element outline rules.
   Source: mockup boardsmith-chrome.html:59, 101-RESEARCH.md A11Y-06. */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bsg-bg), 0 0 0 4px var(--bsg-accent);
  border-radius: var(--bsg-r-sm);
}

/* ─── Reduced-motion block ───────────────────────────────────────────────────
   Halts all animations/transitions globally when the user has requested it.
   Covers pulse/slide/breathe/fly animations in all renderers.
   Source: 101-RESEARCH.md A11Y-08:515-525. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}

/* ─── Visually-hidden utility ────────────────────────────────────────────────
   Hides content visually while keeping it in the accessibility tree.
   MUST NOT use display:none (that removes it from the a11y tree entirely).
   Used for live regions, skip link target h1, and other SR-only text.
   Source: mockup boardsmith-chrome.html:60. */
.vh {
  position: absolute !important;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ─── Skip link ──────────────────────────────────────────────────────────────
   Visually hidden until focused; jumps keyboard users to #main bypassing
   repeated header chrome. Source: mockup boardsmith-chrome.html:61-64,
   101-RESEARCH.md A11Y-10:589-594. */
.sr-skip {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 200;
  background: var(--bsg-surface);
  color: var(--bsg-ink);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-sm);
  padding: 10px 14px;
  font-weight: 700;
  transform: translateY(-160%);
  transition: transform .15s;
  text-decoration: none;
}

.sr-skip:focus {
  transform: none;
}
</style>

<style scoped>
.game-shell {
  min-height: 100vh; /* fallback: browsers without dvh support */
  min-height: 100dvh;
  font-family: var(--bsg-font);
  background: var(--bsg-bg);
  color: var(--bsg-ink);
}

/* Platform mode: embedded in host iframe. Paint the Slate ground (var(--bsg-bg))
   rather than `transparent` — an iframe's own document defaults to opaque white, so a
   transparent shell reveals white, not the host. The host re-themes by overriding
   --bsg-bg via applyTheme, so this stays host-controllable. */
.game-shell--platform {
  min-height: 100%;
  height: 100vh; /* fallback: browsers without dvh support */
  height: 100dvh;
  background: var(--bsg-bg);
}

.game-shell--platform .game-shell__game {
  min-height: 100%;
  height: 100%;
}

/* Platform mode: the host renders a pull-down logo tab at the top-center.
   Keep the header's centered controls (zoom / Auto / Undo) out of the middle
   by packing them to the left and pushing the connection badge to the right,
   leaving the horizontal center clear for the host tab. Do NOT add vertical
   padding here — that only makes the bar taller. */
.game-shell--platform :deep(.game-header) {
  justify-content: flex-start;
}
.game-shell--platform :deep(.header-center) {
  flex: 0 0 auto;
  justify-content: flex-start;
}
.game-shell--platform :deep(.header-right) {
  margin-left: auto;
}

/* Game Screen: flex column, full viewport height. Positioning context for the
   floating action dock (.actionbar), which is absolutely positioned within it. */
.game-shell__game {
  display: flex;
  flex-direction: column;
  height: 100vh; /* fallback: browsers without dvh support */
  height: 100dvh;
  position: relative;
}

/* Stage: sidebar + boardregion side by side; fills remaining height */
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  position: relative;
}

/* Sidebar: always-visible player status + history; collapses to rail (IA-06) */
.sidebar {
  flex: none;
  width: clamp(220px, 22vw, 320px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bsg-surface);
  border-right: 1px solid var(--bsg-line);
  position: relative;
  transition: width var(--bsg-dur-base) cubic-bezier(.4, 0, .2, 1);
}

/* Rail mode: slim sidebar showing only icon tokens (IA-06) */
.sidebar.rail {
  width: var(--bsg-rail);
}
.sidebar.rail .side-scroll {
  padding: var(--bsg-s2) 0;
}
/* In rail, hide sidebar text labels; keep only the player tokens visible */
.sidebar.rail :deep(.player-name-row),
.sidebar.rail :deep(.you-badge) {
  display: none;
}
/* History hidden in rail mode */
.sidebar.rail .sidebar-history {
  display: none;
}

/* Rail toggle button: floats on the right edge of the sidebar */
.side-edge {
  position: absolute;
  top: 14px;
  right: -13px;
  z-index: 6;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--bsg-surface);
  border: 1px solid var(--bsg-line);
  box-shadow: var(--bsg-shadow-sm);
  color: var(--bsg-ink-2);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.side-edge svg {
  width: 15px;
  height: 15px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  transition: transform var(--bsg-dur-fast);
}
.sidebar.rail .side-edge svg {
  transform: rotate(180deg);
}

/* Scrim: transparent cover over board area; visible only on mobile when the player
   strip is expanded into the overlay (IA-06). Inside .stage so it never covers the
   .actionbar sibling below. */
.scrim {
  position: absolute;
  inset: 0;
  z-index: 45;
  background: rgba(0, 0, 0, .5);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--bsg-dur-base);
}
.scrim.active {
  opacity: 1;
  pointer-events: auto;
}

/* Mobile player strip (one-line icons + expand toggle). Hidden on desktop;
   shown only inside the mobile @media block below. */
.mobile-strip {
  display: none;
}

/* Side scroll: players panel + game history (scrollable) */
.side-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--bsg-s3);
}

/* Connection health dot: absolute corner of boardregion; platform mode only (IA-01).
   Class bound to connectionHealth ref: connected / stale / connecting. */
.conn-dot {
  position: absolute;
  top: var(--bsg-s2);
  right: var(--bsg-s2);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bsg-away);
  z-index: 5;
  pointer-events: none;
}
.conn-dot.connected { background: var(--bsg-ok); }
.conn-dot.stale     { background: var(--bsg-warn); }
.conn-dot.connecting { background: var(--bsg-away); }

/* Board region: hero; container-query-sized; ~zero chrome padding (IA-05).
   The board is NOT force-fit or centered: it renders at its NATURAL size, pinned
   top-left, and this region scrolls (both axes) whenever the board — at its natural
   size or zoomed — is larger than the viewport. Many games have more content than
   ever fits a viewport, so scroll is the contract, not shrink-to-fit. */
.boardregion {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  overflow: auto;
  padding: var(--bsg-s1);
  padding-bottom: env(safe-area-inset-bottom);
}

/* Floating action dock: absolutely anchored to the bottom, FULL WIDTH (spans under
   the sidebar too). Out of flow, so it never reflows/moves the board — it floats over
   the board's bottom; the board reserves the dock's measured height (--dock-h) as
   scroll room so covered content stays reachable. Everything inside wraps naturally
   (flex-wrap) — no reserved columns; the options list caps at 5 rows and scrolls. */
.actionbar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 30;
  background: var(--bsg-surface);
  border-top: 1px solid var(--bsg-line);
  box-shadow: var(--bsg-shadow);
  /* One inline-wrapping flow: the ⋯ menu, player token, prompt text, cancel, and
     every option button are flattened into THIS flex container (ActionPanel wrappers
     use display:contents) so they wrap together like words in a sentence — no header
     row / carriage return before the buttons. */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-content: flex-start;
  gap: 8px;
  padding: 9px var(--bsg-s4);
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
  /* Cap at ~5 button-rows (44px buttons + 8px row gaps + vertical padding), then the
     whole flow scrolls. The ⋯ menu popover teleports to <body>, so overflow is safe. */
  max-height: calc(5 * 44px + 4 * 8px + 18px + env(safe-area-inset-bottom));
  overflow-y: auto;
}

/* ⋯ controls menu — first item in the inline dock flow. */
.actionbar-controls {
  margin-right: 4px;
}

/* Active-player identity token — flows inline right after the ⋯ menu. */
.turn-token {
  margin-right: 4px;
}

/* Turn strip: prompt sentence (fallback when ActionPanel is not rendering) */
.turn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 4px;
  min-height: 46px;
  border-right: 1px solid var(--bsg-line);
  margin-right: 4px;
}
.turn .pr {
  font-size: 13.5px;
  color: var(--bsg-ink);
  font-weight: 600;
}

/* ─── Responsive Tiers (IA-06) ──────────────────────────────────────────────
   Shared breakpoint scale: 640 / 768 / 1024 / 1440.
   @media queries drive shell chrome; @container for renderer reflow (plan 100-02).
   ──────────────────────────────────────────────────────────────────────────── */

/* Compact (phones ≤639px): the board is the hero. The sidebar collapses to a single
   one-line player-icon strip across the top; tapping its chevron opens the full
   players + log as an overlay over the board (never the action bar), with a scrim. */
@media (max-width: 639px) {
  .stage {
    flex-direction: column;
  }
  /* Sidebar = just the strip height by default; positioned so the expanded overlay
     (top:100%) anchors right below the strip. */
  .sidebar,
  .sidebar.rail {
    position: relative;
    width: 100%;
    flex: none;
    max-height: none;
    overflow: visible;
    border-right: none;
    border-bottom: 1px solid var(--bsg-line);
    box-shadow: none;
  }
  /* The desktop rail toggle has no role on phones. */
  .side-edge {
    display: none;
  }
  /* Compact strip: player icons on the left, expand chevron on the right. */
  .mobile-strip {
    display: flex;
    align-items: center;
    gap: var(--bsg-s2);
    padding: 6px var(--bsg-s3);
  }
  .mobile-strip__players {
    flex: 1;
    min-width: 0;
  }
  /* Strip icons hug the left and never wrap to a second row. */
  .mobile-strip :deep(.seat-strip) {
    justify-content: flex-start;
  }
  .mobile-strip :deep(.strip-tokens) {
    flex-wrap: nowrap;
    justify-content: flex-start;
  }
  /* Un-hide the turn-status sentence in the phone strip so off-turn players can
     READ whose turn it is (the desktop rail keeps it icon-only — see PlayersPanel).
     Scoped to .mobile-strip so only the wide phone bar gets the text. */
  .mobile-strip :deep(.strip-status) {
    display: inline-block;
    margin-left: var(--bsg-s2);
    font-size: 13px;
    font-weight: 600;
    color: var(--bsg-accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .mobile-strip__toggle {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--bsg-r-sm);
    background: transparent;
    border: 1px solid var(--bsg-line);
    color: var(--bsg-ink-2);
    cursor: pointer;
  }
  .mobile-strip__toggle svg {
    width: 16px;
    height: 16px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    transition: transform var(--bsg-dur-fast);
  }
  .sidebar.mobile-expanded .mobile-strip__toggle svg {
    transform: rotate(180deg);
  }
  /* Full panel + log: hidden by default; shown as an overlay below the strip when
     expanded (board stays the hero underneath, dimmed by the scrim). */
  .side-scroll {
    display: none;
  }
  /* Lift the whole sidebar (strip + overlay) above the scrim so the toggle stays tappable. */
  .sidebar.mobile-expanded {
    z-index: 50;
    background: var(--bsg-surface);
  }
  .sidebar.mobile-expanded .side-scroll {
    display: block;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 60dvh;
    overflow-y: auto;
    background: var(--bsg-surface);
    border-bottom: 1px solid var(--bsg-line);
    box-shadow: var(--bsg-shadow);
  }
  /* Phones use the SAME 5-row dock cap as desktop (no override) — the base
     .actionbar max-height applies. */
}

/* Medium (640px–1023px): standard sidebar + board. Lower bound aligns with the
   compact ceiling (639px) so 640–767px is a real tier, not an untiered gap. */
@media (min-width: 640px) and (max-width: 1023px) {
  .boardregion {
    min-height: 380px;
  }
}

/* Large (≥1024px): wider board min-height. The board is NOT centered or width-capped
   — many games have more content than fits the viewport, so the board sits top-left
   and the region scrolls (both axes) when the board is larger than the viewport. */
@media (min-width: 1024px) {
  .boardregion {
    min-height: 480px;
  }
}

/* Landscape phone (short screen): prevent the actionbar from crushing the board.
   The stage already uses the row layout (sidebar | board); this branch only
   reduces the actionbar height cap so the board retains adequate vertical space. */
@media (orientation: landscape) and (max-height: 600px) {
  .actionbar {
    max-height: min(22dvh, 120px);
    padding-top: 6px;
    padding-bottom: max(6px, env(safe-area-inset-bottom));
  }
}

/* ── AI demo playback control bar ─────────────────────────────────────────── */
.bsg-demo-controls {
  position: fixed;
  bottom: 88px; /* clears the floating action dock */
  left: 50%;
  transform: translateX(-50%);
  z-index: 21; /* above the board + narration overlay (z-20), below modals */
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bsg-surface-2);
  border: 1px solid var(--bsg-line-2);
  border-radius: var(--bsg-r-pill, 999px);
  box-shadow: var(--bsg-shadow);
}
.bsg-demo-controls__speeds {
  display: flex;
  gap: 4px;
}
.bsg-demo-controls__sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 2px;
  background: var(--bsg-line-2);
}
.bsg-demo-btn {
  min-height: 36px;
  min-width: 36px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bsg-surface-3);
  border: 1px solid var(--bsg-line);
  border-radius: var(--bsg-r-md, 8px);
  color: var(--bsg-ink);
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.bsg-demo-btn:hover:not(:disabled) {
  border-color: var(--bsg-accent);
  background: var(--bsg-selectable);
}
.bsg-demo-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.bsg-demo-btn--speed {
  font-size: 0.8rem;
  padding: 0 10px;
}
.bsg-demo-btn--speed.is-active {
  background: var(--bsg-accent);
  color: var(--bsg-accent-ink);
  border-color: var(--bsg-accent);
}
.bsg-demo-btn--play {
  font-size: 1.05rem;
}
.bsg-demo-btn--stop {
  font-size: 0.8rem;
  color: var(--bsg-ink-2);
}

.game-shell__zoom-container {
  --zoom-level: 1;
  /* Size to the board's NATURAL content (not stretched to the region), so the board
     keeps its intrinsic size top-left and the region scrolls when it's bigger. */
  flex: none;
  width: max-content;
  max-width: none;
  /* Use the `zoom` property (not transform): it scales the LAYOUT box, so a
     zoomed-up board genuinely overflows .boardregion and becomes scrollable in both
     axes (the board has an intrinsic size to multiply) — unlike transform:scale,
     which only shifts the paint and left the board un-scrollable / drifting sideways. */
  zoom: var(--zoom-level);

  /* Scroll room equal to the floating dock's height, so the board's bottom — which
     the dock floats over — can always be scrolled up into view. Measured live by a
     ResizeObserver (--dock-h) so it tracks the dock as it grows/shrinks. */
  margin-bottom: var(--dock-h, 0px);

  /* CONTAINMENT: Prevents position:fixed from escaping to viewport.
     Any fixed-position elements inside will behave like absolute positioning
     relative to this container - they cannot cover the navbar or ActionPanel. */
  contain: layout;
}

/* Time travel banner */
.time-travel-banner {
  background: color-mix(in srgb, var(--bsg-warn) 20%, transparent);
  border: 1px solid var(--bsg-warn);
  color: var(--bsg-warn);
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
  background: color-mix(in srgb, var(--bsg-danger) 90%, transparent);
  border: 1px solid var(--bsg-danger);
  color: var(--bsg-ink);
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
  color: var(--bsg-ink-2);
  background: var(--bsg-field);
  border-radius: 12px;
}

/* GameHistory when used in sidebar (not standalone left column) */
.sidebar-history {
  width: 100% !important;
  min-width: unset !important;
  border-right: none !important;
  border-top: 1px solid var(--bsg-line);
  height: auto !important;
  max-height: 300px;
  margin-top: 20px;
  border-radius: 8px;
  overflow: hidden;
}

/* Platform mode: drawer backdrop transparent so host shows through */
.game-shell--platform :deep(.menu-drawer) {
  background: transparent;
}
</style>
