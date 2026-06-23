<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, provide, toRef } from 'vue';
import { applyTheme } from '../theme.js';
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
import WaitingRoom from './WaitingRoom.vue';
import Toast from './Toast.vue';
import ZoomPreviewOverlay from './helpers/ZoomPreviewOverlay.vue';
import GameOverCard from './GameOverCard.vue';
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
const historyCollapsed = ref(false);
const debugExpanded = ref(false);
const zoomLevel = ref(1.0);
const autoEndTurn = ref(true); // Auto-end turn after making a move

// IA-06: Sidebar rail state. Default expanded; collapses to --bsg-rail on compact phones.
// The matchMedia listener ensures the rail collapses automatically when the viewport
// narrows to compact, but never forces expansion when viewport widens (user preference).
const sidebarRail = ref<boolean>(false);
let compactQuery: MediaQueryList | null = null;
function initCompactRail(mql: MediaQueryList | MediaQueryListEvent) {
  if (mql.matches) sidebarRail.value = true;
}

// Connection health (IA-01): driven by postMessage heartbeat in platform mode.
// Starts 'connecting'; a valid heartbeat sets it to 'connected' and rearms a
// staleness timer (~10s). Replaces the hardcoded 'connected' string that was
// passed to the GameHeader badge.
const connectionHealth = ref<'connecting' | 'connected' | 'stale'>('connecting');
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

// Winner seats captured from the game_state postMessage (IA-07).
// Validated as number[] on receipt; stays [] in dev-WS mode (graceful degrade).
const winnerSeats = ref<number[]>([]);

// Actionbar element ref + ResizeObserver for dock-height reservation (IA-04).
// The observer sets --bsg-dock-h on the root element so .boardregion can
// reserve exactly the measured dock height instead of a hardcoded 80px.
const actionbarRef = ref<HTMLElement | null>(null);
let dockObserver: ResizeObserver | null = null;

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

  // IA-04: Measure the actionbar height and publish it as --bsg-dock-h so the
  // .boardregion can reserve exactly the right amount of padding at the bottom.
  // A single observer on the actionbar element fires whenever it grows/shrinks
  // (e.g. when action buttons appear/disappear or flex-wrap adds rows).
  dockObserver = new ResizeObserver((entries) => {
    const h = entries[0]?.borderBoxSize?.[0]?.blockSize ?? 0;
    document.documentElement.style.setProperty('--bsg-dock-h', `${h}px`);
  });
  // The actionbar only exists while currentScreen === 'game'. In dev/standalone
  // mode the screen starts at 'lobby', so the element is absent at mount and
  // appears later on the lobby→game transition. Track the ref so the observer
  // (re)attaches whenever the actionbar mounts and detaches when it unmounts —
  // observing on mount alone would silently never fire in the lobby-first flow.
  watch(
    actionbarRef,
    (el, prev) => {
      if (prev) dockObserver?.unobserve(prev);
      if (el) dockObserver?.observe(el);
      else document.documentElement.style.setProperty('--bsg-dock-h', '0px');
    },
    { immediate: true },
  );

  // IA-06: Collapse sidebar to rail by default on compact phones (≤639px).
  // This runs after paint so the initial state is correct before first render.
  compactQuery = window.matchMedia('(max-width: 639px)');
  initCompactRail(compactQuery);
  compactQuery.addEventListener('change', initCompactRail);

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
  dockObserver?.disconnect();
  compactQuery?.removeEventListener('change', initCompactRail);
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
        <aside class="sidebar" :class="{ rail: sidebarRail }" aria-label="Players and log">
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
          <!-- side-head: Shufflewick branding + ⋯ controls menu (IA-01) -->
          <div class="side-head">
            <!-- sw-btn is purely decorative branding — no interactive affordance is available
                 in platform mode (GameHeader/HamburgerMenu is hidden). aria-hidden prevents
                 AT users from encountering a non-functional interactive element (IN-02). -->
            <div class="sw-btn" aria-hidden="true">
              <span class="sw-btn__mark"></span>
              <span class="sw-btn__wordmark">Shufflewick</span>
            </div>
            <ControlsMenu
              v-model:auto-end-turn="autoEndTurn"
              v-model:zoom="zoomLevel"
              :can-undo="canUndo && !isViewingHistory"
              @undo="handleUndo"
              @menu-item-click="handleMenuItemClick"
            />
          </div>

          <div class="side-scroll">
            <PlayersPanel
              :players="players"
              :player-seat="playerSeat"
              :current-player-seat="state?.state.currentPlayer"
              :color-selection-enabled="colorSelectionEnabled"
              :awaiting-player-seats="awaitingPlayerSeats"
              :seat-strip="sidebarRail"
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

            <!-- Game History (sidebar mode: medium/wide only; replaced by sheet on compact) -->
            <GameHistory
              v-if="showHistory && !sidebarRail"
              :messages="gameMessages"
              v-model:collapsed="historyCollapsed"
              class="sidebar-history"
            />
          </div>
        </aside>

        <!-- Board region: hero; ~zero chrome padding; container-query-sized -->
        <main class="boardregion" id="main" role="main">
          <!-- Connection health dot: platform mode only. Driven by postMessage heartbeat
               (IA-01). Dev/standalone uses the GameHeader connection badge instead. -->
          <span
            v-if="platformMode"
            class="conn-dot"
            :class="connectionHealth"
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
              :flow-state="state?.flowState"
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
            >
              <div class="empty-game-area">
                <p>Add your game board in the #game-board slot</p>
              </div>
            </slot>
          </div>
        </main>
        <!-- Game History bottom sheet: compact/phone mode (IA-06).
             Positioned absolute within .stage — never covers the .actionbar sibling below. -->
        <GameHistory
          v-if="showHistory && sidebarRail"
          :messages="gameMessages"
          :sheet="true"
          v-model:collapsed="historyCollapsed"
        />
        <!-- Scrim: only active on compact phones when sidebar is expanded over the board (IA-06).
             Click collapses the sidebar back to the rail. Sibling of .stage children so it
             sits inside .stage and can never cover the .actionbar below. -->
        <div
          class="scrim"
          :class="{ active: !sidebarRail }"
          aria-hidden="true"
          @click="sidebarRail = true"
        ></div>
      </div>

      <!-- Full-width actionbar: sibling of .stage; grows vertically (IA-02, IA-03, IA-04) -->
      <div class="actionbar" ref="actionbarRef" role="region" aria-label="Actions">
        <!-- Dock: only render when player is actionable (IA-04) -->
        <template v-if="isMyTurn || awaitingPlayerNames.length">
          <!-- Turn strip: always visible while dock is shown — survives even when
               every current pick is board-anchored (IA-02). Never a silent board. -->
          <span class="turn">
            <span
              v-if="currentPlayerColor"
              class="turn__swatch"
              :style="{ background: currentPlayerColor }"
              aria-hidden="true"
            ></span>
            <span class="pr">{{ boardPrompt ?? actionController.currentPick.value?.prompt }}</span>
          </span>
          <!-- Action buttons: suppressed ONLY when every pick is board-anchored (IA-03).
               The .turn strip above is NOT inside this gate so the prompt survives. -->
          <template v-if="!props.suppressActionPanel && !actionController.allCurrentChoicesAnchored.value">
            <slot name="action-panel">
              <ActionPanel
                :available-actions="isViewingHistory ? [] : availableActions"
                :action-metadata="isViewingHistory ? {} : actionMetadata"
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

/* Platform mode: embedded in host iframe, transparent backdrop so host shows through */
.game-shell--platform {
  min-height: 100%;
  height: 100vh; /* fallback: browsers without dvh support */
  height: 100dvh;
  background: transparent;
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

/* Game Screen: flex column, full viewport height */
.game-shell__game {
  display: flex;
  flex-direction: column;
  height: 100vh; /* fallback: browsers without dvh support */
  height: 100dvh;
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
.sidebar.rail .side-head {
  flex-direction: column;
  gap: var(--bsg-s2);
  padding: 9px 0;
}
.sidebar.rail .sw-btn__wordmark {
  display: none;
}
.sidebar.rail .sw-btn {
  padding: 6px;
}
.sidebar.rail .side-scroll {
  padding: var(--bsg-s2) 0;
}
/* In rail, hide sidebar text labels; keep only the player tokens visible */
.sidebar.rail :deep(.player-name-row),
.sidebar.rail :deep(.you-badge),
.sidebar.rail :deep(.player-color) {
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

/* Scrim: transparent cover over board area; visible only on compact when sidebar expanded (IA-06).
   Positioned inside .stage so it never covers the .actionbar sibling below. */
.scrim {
  position: absolute;
  inset: 0;
  z-index: 45;
  background: rgba(0, 0, 0, .5);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--bsg-dur-base);
}

/* Side head: Shufflewick host button + ⋯ controls menu trigger */
.side-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 9px 9px 11px;
  border-bottom: 1px solid var(--bsg-line);
}

.sw-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  cursor: pointer;
  padding: 7px 10px;
  border-radius: var(--bsg-r-sm);
  border: 1px solid transparent;
  background: none;
  color: var(--bsg-ink);
  font-weight: 800;
  font-size: 14px;
  letter-spacing: 0.01em;
}
.sw-btn:hover {
  background: var(--bsg-field);
  border-color: var(--bsg-line);
}
.sw-btn__mark {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex: none;
  background: var(--bsg-accent);
  opacity: 0.7;
}
.sw-btn__wordmark {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-size: 14px;
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

/* Board region: hero; container-query-sized; ~zero chrome padding (IA-05) */
.boardregion {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: grid;
  place-items: center;
  padding: var(--bsg-s1);
  container-type: size;
  /* Reserve space for the actionbar measured via ResizeObserver (IA-04).
     Falls back to s3 or safe-area inset if --bsg-dock-h is not yet set. */
  padding-bottom: max(var(--bsg-s3), var(--bsg-dock-h, 0px), env(safe-area-inset-bottom));
}

/* Full-width actionbar: sibling of .stage, spans both sidebar + boardregion.
   Grows vertically (flex-wrap), caps at ~5 rows, then scrolls — never horizontal. */
.actionbar {
  flex: none;
  background: var(--bsg-surface);
  border-top: 1px solid var(--bsg-line);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 9px var(--bsg-s4);
  padding-bottom: calc(9px + env(safe-area-inset-bottom));
  max-height: min(40dvh, 320px);
  overflow-y: auto;
}

/* Turn strip: active player color swatch + prompt sentence */
.turn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 10px;
  min-height: 46px;
  border-right: 1px solid var(--bsg-line);
  margin-right: 4px;
}
.turn__swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex: none;
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

/* Compact (phones ≤639px): board fills the viewport; sidebar defaults to rail.
   When expanded the sidebar overlays the board area only (never the actionbar),
   absolutely positioned inside .stage. Scrim becomes visible and interactive. */
@media (max-width: 639px) {
  .sidebar:not(.rail) {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 50;
    width: min(86vw, var(--bsg-side));
    box-shadow: var(--bsg-shadow);
  }
  .scrim.active {
    opacity: 1;
    pointer-events: auto;
  }
}

/* Medium (768px–1023px): standard sidebar + board. */
@media (min-width: 768px) and (max-width: 1023px) {
  .boardregion {
    min-height: 380px;
  }
}

/* Large (≥1024px): wider board min-height. */
@media (min-width: 1024px) {
  .boardregion {
    min-height: 480px;
  }
}

/* Wide (≥1440px): center the game shell at a max-width so the board stays
   the hero on ultra-wide displays. Auto margins center it horizontally. */
@media (min-width: 1440px) {
  .game-shell__game {
    max-width: 1600px;
    margin-inline: auto;
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

.game-shell__zoom-container {
  --zoom-level: 1;
  transform: scale(var(--zoom-level));
  transform-origin: top left;
  /* Width/height at 100% divided by zoom to reserve correct space */
  width: calc(100% / var(--zoom-level));
  min-height: calc(100% / var(--zoom-level));

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
