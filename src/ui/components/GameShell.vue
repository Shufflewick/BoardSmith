<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, provide, toRef, nextTick } from 'vue';
import { applyTheme, BREAKPOINTS } from '../theme.js';
import { consumeInitMessage, isOriginAllowed } from './GameShellInit.js';
import type { PresentationOverlay } from './auto-ui/presentation.js';
import type { GameUIRegistry } from '../game-uis.js';
import { selectArchetype } from './auto-ui/archetype-selector.js';
import {
  announceTurnChange,
  announceConnectionChange,
  announceGameOver,
  deriveWinnerState,
  announceOpponentTurn,
} from '../composables/liveRegionAnnouncer.js';
import { turnSequence, orderSeatsByTurn, type SeatActivityState } from '../../engine/flow/seat-activity.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../../engine/flow/boundary-key.js';
import { MeepleClient, MeepleClientError, GameConnection, audioService, generatePlayerId, type LobbyInfo } from '../../client/index.js';
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
import DisabledReasonTooltip from './helpers/DisabledReasonTooltip.vue';
import GameOverCard from './GameOverCard.vue';
import TutorialOverlay from './helpers/TutorialOverlay.vue';
import HintOverlay from './helpers/HintOverlay.vue';
import HeatmapOverlay from './helpers/HeatmapOverlay.vue';
import BoardMessage from './helpers/BoardMessage.vue';
import { createBoardInteraction, provideBoardInteraction } from '../composables/useBoardInteraction';
import { setupDragDropOrchestration } from '../composables/useDragDropTargets';
import { useBoardActionBridge } from '../composables/useBoardActionBridge';
import { maybePostDevtoolsUpdate } from './GameShell.devtools.js';
import { createAnimationEvents, provideAnimationEvents } from '../composables/useAnimationEvents';
import { createAnnouncer, provideAnnouncer } from '../composables/useAnnouncer.js';
import { useZoomPreview } from '../composables/useZoomPreview';
import { useAutoZoom, SETTLE_MS } from '../composables/useAutoZoom';
import { useToast } from '../composables/useToast';
import { useActionController, type ActionResult as ControllerActionResult } from '../composables/useActionController';
import type { ActionMetadata } from '../composables/useActionControllerTypes';
import type { GameState, FlowState } from '../../client/types.js';
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

  // Fall back to localStorage. The playerId is a per-seat capability token
  // (identity proof on WS connect + host-authorization checks), so it must
  // be minted by the SDK's single cryptographically-secure minting path —
  // never Math.random().
  let id = localStorage.getItem(LOCAL_KEY);
  if (!id) {
    id = generatePlayerId();
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
  /** Player positions that should be AI by default (1-indexed). E.g., [2] makes player 2 AI */
  defaultAIPlayers?: number[];
  /**
   * Platform-only escape hatch that suppresses the entire Action Panel
   * (D-02 escape hatch, LIBX-01). Do NOT use from a game's own
   * scaffold/bridge — use per-action `.suppressFromActionPanel()` on the action
   * definition instead. Referenced by the platform client and Phase 166
   * SKILLDEF-03. Default: false.
   */
  platformActionPanelEscapeHatch?: boolean;
  /**
   * The game renders its own end-state UI inside its own board (D10/ENDGAME-01).
   * When true, BOTH the default GameOverCard and any `#game-over` slot content
   * are suppressed — the game is fully responsible for presenting the outcome.
   * Default: false.
   */
  providesOwnGameOverUI?: boolean;
  /** Per-UI presentation overlay — keyed by element class/name/attribute → visuals (D-04). */
  presentation?: PresentationOverlay;
  /**
   * The game's UI registry — every board it owns and which one ships. Built by
   * `defineGameUIs()` in the game's `src/ui/uis.ts`, which is the single place
   * this is declared (see src/ui/game-uis.ts).
   *
   * Required, and the ONLY way to supply a board. There is deliberately no
   * `#game-board` slot: two ways to name the default UI is two things that can
   * disagree, and the manifest's old `"ui"` key already proved how that ends.
   * A production build renders `registry.defaultName`; every other entry exists
   * only under `boardsmith dev` and is stripped from the bundle entirely.
   */
  uis: GameUIRegistry;
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
  /**
   * How the players panel orders seats. Default `'turn'`.
   *
   * - `'turn'` — the order the flow will actually take. Recovered from the
   *   running order `eachPlayer` already resolved (`turnSequence`), so a
   *   rotating dealer, a reversed round, or a filtered round all read correctly
   *   with nothing to declare. Falls back to seat order whenever the flow has
   *   no order to report (a simultaneous step, a hand-rolled turn structure).
   * - `'seat'` — plain seat order. The opt-out.
   * - `number[]` — an explicit seat order the game supplies, for turn orders the
   *   flow cannot express (e.g. iterating players sorted by a role's printed
   *   rank). Seats you omit keep their seat-ordered place after the ones you
   *   name; no seat is ever dropped from the panel.
   *
   * The list is NOT rotated to put the acting player first: the panel is the
   * one stable reference surface in the UI, and moving every row on every turn
   * costs more (spatial memory, screen-reader position) than the one wrap it
   * saves when reading "who's next". The acting seat is marked in place.
   */
  playerOrder?: 'turn' | 'seat' | number[];
  /**
   * Whether the players panel renders the shell's turn-status sentence ("Your
   * move" / "{name} is playing") on the active seat's card. Default `true`.
   *
   * Set `false` only when your `#player-stats` content already states turn
   * state for that seat — otherwise the card carries the same fact twice, and
   * per-seat height is the scarce resource in a panel with many players. The
   * turn cue itself does not depend on this: the indicator dot, the active-card
   * highlight, the turn-change pulse, and `aria-current` all remain.
   */
  showTurnStatus?: boolean;
}

const props = withDefaults(defineProps<GameShellProps>(), {
  // Use injected API URL from boardsmith dev (set via window global), fall back to default
  apiUrl: (typeof window !== 'undefined' && (window as any).__BOARDSMITH_API_URL__) || 'http://localhost:8787',
  playerCount: 2,
  debugMode: true,
  platformActionPanelEscapeHatch: false,
  providesOwnGameOverUI: false,
  playerOrder: 'turn',
  showTurnStatus: true,
});

// Platform mode: embedded inside a host platform's iframe (e.g., ShufflewickPub
// in prod, or the boardsmith dev host locally — both run GameShell in an iframe).
// Synchronous detection: if we're in an iframe, we're in platform mode.
const platformMode = ref(typeof window !== 'undefined' && window.parent !== window);

// Dev build (Vite serves `boardsmith dev`); false in production embeds. Gates the
// debug panel so it appears under `boardsmith dev` but never in a deployed game.
const isDevBuild = import.meta.env.DEV;

// Dev-only UI switcher. `boardsmith dev` shows a dropdown of every UI the game's
// registry declares and renders the selected one without a permanent split-screen.
//
// The auto-UI is NOT injected here any more. A game that wants it lists it like
// any other board — `Auto: devUI(() => import('boardsmith/ui/auto-ui'))` — so the
// registry really is the complete list of a game's UIs rather than the list plus
// one the shell adds behind its back. That also stops offering an auto-UI peek to
// games where it means nothing.
//
// Elimination note, because this is the part that is easy to get wrong: a devUI
// entry's component is null in production (see src/ui/game-uis.ts), and its
// module never enters the graph. An SFC's `<style>` compiles to a SIDE-EFFECTFUL
// CSS import that outlives JS tree-shaking, so "the JS got shaken out" is never
// proof a UI is gone — AutoUI's stylesheet shipped in every custom-UI game for
// months on exactly that assumption, reaching them through the `boardsmith/ui`
// barrel's re-export rather than through any import anyone was looking at.
// Elimination is a property of the WHOLE graph. Only the built artifact proves
// it, which is what treeshake-bundle.test.ts asserts, for CSS as well as JS.
const registry = computed(() => props.uis);
const devUiNames = computed(() =>
  // In production every non-default entry has a null component; listing only
  // resolvable UIs keeps the switcher honest if it is ever shown outside dev.
  registry.value.names.filter(
    (name) => name === registry.value.defaultName || registry.value.entries[name]?.component,
  ),
);
const selectedUiName = ref('');
/** The board to render: the dev selection when there is one, else the default. */
const selectedUiComponent = computed(() => {
  const reg = registry.value;
  const name = selectedUiName.value && isDevBuild ? selectedUiName.value : reg.defaultName;
  return (reg.entries[name] ?? reg.entries[reg.defaultName])?.component ?? null;
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
// Host anti-cheat: teaching features disabled for this session.
// Set from the platform init postMessage (data.teachingDisabled) for first-render
// before any broadcast. The broadcast-preferred computed below (teachingDisabledProp)
// uses the authoritative broadcast value once state is available (criterion 4 / D-03).
const teachingDisabled = ref(false);

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

// The floating Action Panel's footprint is a CONSTANT, declared in CSS
// (--bsg-panel-reserved, applied as .boardregion's padding-bottom) and never
// measured. Its height has no single value — it re-wraps on every selection
// step — so a fit that reserved the measured height was not reproducible
// between two loads of the same state (issue #13). The panel's content lays out
// inside --bsg-panel-max and scrolls internally past it.

// Startup zoom fit: when a game (re)mounts, the board is zoomed once to fill
// the board region (clamped to the 0.5–2.0 slider range) and then left alone —
// mid-game content growth and window resizes never move the zoom. The user
// adjusts with the slider, or re-fits on demand via the header percent button
// / menu "Fit".
const boardregionEl = ref<HTMLElement | null>(null);
const zoomContainerEl = ref<HTMLElement | null>(null);
const { zoomLevel, setZoom, fitZoom } = useAutoZoom({
  boardEl: zoomContainerEl,
  regionEl: boardregionEl,
});

// Connection health (IA-01): driven by postMessage heartbeat in platform mode.
// Starts 'connecting'; a valid heartbeat sets it to 'connected' and rearms a
// staleness timer (~10s). Replaces the hardcoded 'connected' string that was
// passed to the GameHeader badge.
const connectionHealth = ref<'connecting' | 'connected' | 'stale'>('connecting');
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

// Winner seats captured from the game_state postMessage (IA-07).
// Validated as number[] on receipt; stays [] in dev-WS mode (graceful degrade).
const winnerSeats = ref<number[]>([]);

// Explicit draw signal captured from the game_state postMessage (D10/ENDGAME-01).
// Sourced from the session (isComplete && winners.length === 0), threaded via
// snapshot-session-host meta -> multiplayer-host game_state frame. Absent on
// the frame (or platformMode not used) -> stays false ("unknown", not a draw) —
// never inferred from a bare empty winnerSeats, which also occurs pre-completion.
const isDraw = ref(false);

// Game-over card/slot dismissed by the player (D10). Reset when a new game
// starts (flowState.complete transitions back to false) so the next completion
// shows the card again.
const gameOverDismissed = ref(false);
function dismissGameOver(): void {
  gameOverDismissed.value = true;
  nextTick(() => boardregionEl.value?.focus());
}

// Time travel state (for viewing historical game states)
const timeTravelState = ref<any>(null);
const timeTravelActionIndex = ref<number | null>(null);
const timeTravelDiff = ref<{ added: number[]; removed: number[]; changed: number[] } | null>(null);
const isViewingHistory = computed(() => timeTravelState.value !== null);

// Debug highlight state (for element inspector)
const debugHighlightedElementId = ref<number | null>(null);
provide('debugHighlight', debugHighlightedElementId);

// Create client with our persisted playerId so all API calls (claim
// position, etc.) use the same ID. Passing it into the constructor (rather
// than overwriting after construction via setPlayerId) means the client
// never mints an ID that is immediately discarded.
const client = new MeepleClient({
  baseUrl: props.apiUrl,
  playerId: playerId.value,
});

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

// Animation events - wire createAnimationEvents to server state.
// actionCount (UNDO-04) is the rewind-detection signal: a decrease resets
// the composable's watermark so a reconnect into a rewound session doesn't
// carry a stale high-water mark forward (defense-in-depth for Plan 155-04's
// server-side monotonic-sequence fix).
const animationEvents = createAnimationEvents({
  events: () => state.value?.state?.animationEvents,
  actionCount: () => state.value?.state?.actionCount,
});
provideAnimationEvents(animationEvents);

// Announcer - lets any descendant (custom UI or AutoUI) write through the
// existing live-region refs / postMessage relay above without new DOM nodes.
const announcer = createAnnouncer({ politeMessage, assertiveMessage, emitAnnounce });
provideAnnouncer(announcer);

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
// No cast needed: `PlayerState` (client/types.ts) now declares this field, as
// the wire shape always carried it.
const disabledActions = computed(() => state.value?.state?.disabledActions);

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

// LIBX-01 / A11Y C-2: GameShell no longer unmounts ActionPanel when every
// available action is `.suppressFromActionPanel()`. It used to, with a mid-pick escape
// hatch to keep the keyboard/SR safety net alive for the action the net exists
// to protect. That guard only covered actions that HAVE a pick in progress: an
// action with no selections can never start one, so a game whose sole
// available action was a suppressed no-selection confirm emptied the Action Panel with
// nothing left to press and no way to reach the net — a state the player cannot
// leave. The fix belongs at the mechanism, not the guard: ActionPanel's own
// suppression filter now falls back to the full list rather than emptying the
// Action Panel (see its `visibleActions`), so "all suppressed" is no longer a state
// this component has to defend against. The only thing that removes the panel
// is the explicit platform escape hatch below.

// True while a simultaneous step is active (`awaitingPlayers` non-empty).
// Single source for every D27 guard below: while true, status must never be
// derived from a single `currentPlayer` (that identity is meaningless when
// multiple seats are deciding independently).
const isSimultaneous = computed(() => {
  const flowState = state.value?.flowState as any;
  return (flowState?.awaitingPlayers?.length ?? 0) > 0;
});

// The viewer's OWN completed flag during a simultaneous step (T-160-27 /
// D27 commit-leak fix). `false` outside a simultaneous step — the concept
// doesn't apply to turn-based actions. Fed to ActionPanel so its execute
// guard can reject a seat that already committed this step, independent of
// (and in addition to) `isMyTurn` — defense in depth against a stale/
// optimistic `isMyTurn=true` prop after the seat has already committed.
const myCompleted = computed(() => {
  const flowState = state.value?.flowState as any;
  if (!flowState?.awaitingPlayers?.length) return false;
  const myPlayerState = flowState.awaitingPlayers.find(
    (p: { playerIndex: number }) => p.playerIndex === playerSeat.value
  );
  return !!myPlayerState?.completed;
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

// LIBX-04 (D31): single source of truth for the board's displayed state. During
// time-travel, timeTravelState is a raw PlayerGameState — ONE level shallower
// than `state.value` (GameState = { flowState, state: PlayerState, ... }), the
// exact same shape asymmetry gameView above already normalizes for `.view`.
// Re-wrap the historical PlayerGameState into a GameState-shaped object here so
// every :state consumer (board + sidebar-extra) gets a consistent shape whether
// live or historical, with no shape-aware branching downstream.
//
// WR-02 (164 review): `flowState` ("turn info, available actions" per
// `GameState.flowState`'s own doc) is nulled out during time-travel rather
// than left pointing at LIVE data superimposed on a historical board. There is
// no historical flowState to substitute -- DebugPanel.vue's own internal state
// view has the identical hard constraint and null's it out for the exact same
// reason (`{ state: historicalState.value, flowState: null }`). A custom UI
// that reads `props.state.flowState` directly (rather than the separately-
// passed, correctly isViewingHistory-gated `availableActions`/`isMyTurn`
// props GameShell already computes for the auto-UI ActionPanel) now sees the
// gap loudly (null) instead of silently-wrong live data.
type DisplayedGameState = Omit<GameState, 'flowState'> & { flowState: FlowState | null };
const displayedState = computed<DisplayedGameState | null>(() => {
  if (timeTravelState.value) {
    return state.value ? { ...state.value, state: timeTravelState.value, flowState: null } : null;
  }
  return state.value;
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

/**
 * Narrow an untyped host response into a ControllerActionResult.
 *
 * `platformRequest` returns `Record<string, unknown>` because the host is
 * across a postMessage boundary — nothing guarantees its shape. Only `success`
 * is normalized (it drives control flow, and a missing/garbage value must read
 * as failure, not as truthy). Everything else is passed through untouched so
 * `followUp` — which chains the next action, e.g. explore -> take equipment —
 * survives.
 */
function toControllerActionResult(raw: Record<string, unknown>): ControllerActionResult {
  return { ...raw, success: raw.success === true } as ControllerActionResult;
}

/** Read an error message off an untyped host response, with a fallback. */
function hostErrorText(raw: Record<string, unknown>, fallback: string): string {
  return typeof raw.error === 'string' && raw.error.length > 0 ? raw.error : fallback;
}

function platformRequest(op: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Strip Vue reactivity (a reactive proxy / ref is not structured-cloneable) so the
  // natural `someRef.value` arg survives postMessage; a genuine live-element leak
  // still fails loud via assertCloneable inside toCloneablePayload.
  //
  // BSMITH-05: the boundary key is stamped HERE, on the ONE outbound chokepoint,
  // from the flow state THIS SHELL RENDERED — the round the human was actually
  // looking at. Stamping it per call site is how a submission ends up carrying
  // no key at all and landing in whichever round is open by the time it arrives.
  // It rides on every op, not just the two the engine reads it from: an inert
  // extra field on a debug payload costs nothing, and "remember to add it when
  // you add a submission op" is not a guardrail. See
  // docs/simultaneous-and-interrupt-semantics.md.
  //
  // `state.value`, deliberately, NOT `displayedState`: during time travel the
  // displayed flow state is nulled out, and a submission must name the LIVE
  // round it will be judged against, not the historical frame on screen.
  const cloneable = toCloneablePayload(op, payload, state.value?.flowState as BoundaryKeyState | null | undefined);
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
      return toControllerActionResult(result);
    }
    const result = await action(actionName, args);
    return result as ControllerActionResult;
  },
  availableActions,
  actionMetadata,
  isMyTurn,
  // D27 commit-leak gate (T-160-27 / BLOCKER-160): shared chokepoint so
  // ActionPanel AND every custom UI routed through useBoardActionBridge
  // refuse a re-submit once this seat has committed this simultaneous step —
  // see useActionController's `completed` option doc for the full rationale.
  completed: myCompleted,
  // Disabled-action gate (issue #4): same shared-chokepoint principle — a
  // disabled action stays available so the panel can explain it, so start()/
  // execute() are where it gets refused, for every UI at once.
  disabledActions,
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
          // Same rule as the platform path above: a selection is a SUBMISSION,
          // so it names the boundary this shell rendered it against
          // (docs/simultaneous-and-interrupt-semantics.md).
          boundaryKey: flowBoundaryKey(state.value?.flowState as BoundaryKeyState | null | undefined),
        }),
      });
      return await response.json();
    } catch (err) {
      console.error('Selection step error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Selection step failed' };
    }
  },
  // LIBX-04/CR-01: single authoritative chokepoint for "never commit to the live
  // engine while viewing history". useBoardActionBridge's four mutators already
  // check this, but ActionPanel talks to the controller directly (fill/toggle/
  // start), and the controller's own internal auto-execute watch can fire a
  // commit with NO caller in the loop at all. Passing it here — rather than
  // re-implementing the guard in every caller — is the one place every commit
  // path (board clicks, ActionPanel, auto-execute) funnels through.
  isViewingHistory,
});

// Read-only action args for display and slot props.
const actionArgs = computed(() => actionController.currentArgs.value);

// The session's formatted, seat-scoped messages are the ONLY source. There used
// to be a `state.view.messages` fallback here, reading the raw log off the game
// tree — that copy is gone (the log is not part of `toJSON()` any more), and it
// was never the right thing to render: it was unformatted and, before SEC-04,
// unfiltered. If this is ever empty when it should not be, fix
// `buildPlayerState`/`getFormattedMessages`, do not reintroduce a second source.
const gameMessages = computed(() => state.value?.state?.messages ?? []);

// Computed properties derived from game view
const players = computed(() => state.value?.state.players || []);
const myPlayer = computed(() => players.value.find(p => p.seat === playerSeat.value));

/**
 * The players panel's list, ordered per the `playerOrder` prop (default: the
 * order the flow will actually take).
 *
 * Deliberately separate from `players` above: that array stays in seat order for
 * every slot and consumer that has always received it, so turning this on
 * reorders the panel and nothing else. `orderSeatsByTurn` guarantees the result
 * is total and duplicate-free — a `filter`ed round omits seats from its running
 * order, and a player who is sitting this round out still has a name, a score,
 * and a connection state to show.
 */
const panelPlayers = computed(() => {
  const all = players.value;
  if (props.playerOrder === 'seat' || all.length < 2) return all;

  const sequence = Array.isArray(props.playerOrder)
    ? props.playerOrder
    : turnSequence(state.value?.flowState as SeatActivityState | null);
  if (sequence.length === 0) return all;

  const bySeat = new Map(all.map((p) => [p.seat, p]));
  return orderSeatsByTurn([...bySeat.keys()], sequence)
    .map((seat) => bySeat.get(seat))
    .filter((p): p is (typeof all)[number] => p !== undefined);
});

// #game-over slot prop (D10): the winning Player objects, derived the same
// way GameOverCard derives them internally — kept here so a game's custom
// slot content doesn't need to re-implement the seat -> Player lookup.
const gameOverWinners = computed(() =>
  winnerSeats.value
    .map((seat) => players.value.find((p: any) => p.seat === seat))
    .filter((p: any): p is NonNullable<typeof p> => p !== undefined)
);
const opponentPlayers = computed(() => players.value.filter(p => p.seat !== playerSeat.value));

// Per-seat live connection status for the players panel. The lobby slots are the
// only source of truth for human presence (lobby-manager.setPlayerConnected), kept
// reactive in `lobbyInfo` for the life of the session. AI slots and modes with no
// lobby (e.g. --ai) leave `connected` undefined so PlayersPanel renders no indicator
// rather than fabricating presence we don't actually know.
// Built on `panelPlayers`, so the panel's ordering and its presence indicators
// are the same list — deriving this from seat-ordered `players` instead would
// silently un-order the sidebar panel the moment a lobby exists.
const playersWithConnection = computed(() => {
  const slots = lobbyInfo.value?.slots;
  if (!slots) return panelPlayers.value;
  return panelPlayers.value.map((p) => {
    const slot = slots.find((s) => s.seat === p.seat);
    const connected = slot && slot.aiLevel == null ? slot.connected : undefined;
    return connected === undefined ? p : { ...p, connected };
  });
});
// D27: never derive a single-player "It is X's turn" identity while a
// simultaneous step is active — multiple seats are deciding independently,
// so `currentPlayer` (which may still hold a stale/unrelated value) does
// not represent "whose turn it is" the way it does in a turn-based step.
const currentPlayerName = computed(() => {
  if (isSimultaneous.value) return '';
  const currentPos = state.value?.state?.currentPlayer;
  if (currentPos === undefined) return '';
  const player = players.value.find(p => p.seat === currentPos);
  return player?.name || `Player ${currentPos + 1}`;
});
// Awaiting player seats during simultaneous action steps — EXCLUDES the
// viewer's own seat (D27 self-filter, T-160-28): the viewer's own
// awaiting/not-completed status is already surfaced via `availableActions`
// (action buttons render), so listing it here too produces the "Your move"
// + "waiting" contradiction. This list names only co-deciders.
const awaitingPlayerSeats = computed(() => {
  const flowState = state.value?.flowState as any;
  if (!flowState?.awaitingPlayers?.length) return [];
  return flowState.awaitingPlayers
    .filter((p: any) => !p.completed && p.availableActions.length > 0 && p.playerIndex !== playerSeat.value)
    .map((p: any) => p.playerIndex);
});

// Awaiting player info for ActionPanel (names + colors for waiting message)
// — same self-filter as awaitingPlayerSeats above (D27).
const awaitingPlayerNames = computed(() => {
  const flowState = state.value?.flowState as any;
  if (!flowState?.awaitingPlayers?.length) return [];
  return flowState.awaitingPlayers
    .filter((p: any) => !p.completed && p.availableActions.length > 0 && p.playerIndex !== playerSeat.value)
    .map((p: any) => {
      const player = players.value.find(pl => pl.seat === p.playerIndex);
      return { seat: p.playerIndex, name: player?.name || `Player ${p.playerIndex}`, color: typeof (player as any)?.color === 'string' ? (player as any).color : undefined };
    });
});

// Active player (whose turn it is) for the action-bar turn token. D27:
// suppressed during a simultaneous step — a single PlayerToken cannot
// represent "multiple seats deciding independently" without itself being
// the misleading single-identity status this fix removes.
// The token's shape comes from the SEAT, not this array's position: the players
// panel renders the same players in turn order, and a position-derived shape
// would draw the acting player as one shape here and another there.
const activePlayer = computed(() => {
  if (isSimultaneous.value) return null;
  const seat = state.value?.state?.currentPlayer;
  if (seat === undefined) return null;
  const p = players.value.find(pl => pl.seat === seat) as { name?: string; color?: string } | undefined;
  if (!p) return null;
  return { name: p.name ?? `Player ${seat + 1}`, seat, color: p.color };
});

/**
 * The identity token the action bar shows, and what it CLAIMS (B14).
 *
 * Two different statements, which is why this is not just `activePlayer`:
 *
 * - `'active'` — "this is whose turn it is". A claim about the TABLE. D27 is
 *   why it must never render during a simultaneous step: several seats are
 *   deciding independently, so no single seat is "the" active one, and drawing
 *   one would assert something false.
 * - `'you'` — "this is you". A claim about the VIEWER only, which is never
 *   ambiguous no matter how many seats are deciding. The bar is already
 *   viewer-scoped in that state (availableActions resolves to this seat's own
 *   `awaitingPlayers` entry, and re-submission gates on this seat's own
 *   `completed`), so it was showing your actions with nothing saying who you
 *   are — and the same bar carrying a token in one phase and not the next read
 *   as a bug, because the shape is otherwise a constant identity anchor.
 *
 * D27 removed a false claim about the table; it was never a reason to withhold
 * the viewer's own identity from them.
 *
 * Both render IDENTICALLY — `kind` selects WHICH seat the token names, never how
 * it is drawn. A ring/outline/opacity marking the 'you' case was tried and
 * removed: on an identity glyph a decoration reads as an unexplained
 * decoration, not as meaning, and it competes with shape, which is the stable
 * identity channel (the only one in a colourless game). The bar never shows two
 * tokens at once, so there is nothing to tell apart on screen; the prompt
 * beside it already says what is being asked.
 */
const panelToken = computed(() => {
  if (isSimultaneous.value) {
    const me = myPlayer.value as { name?: string; color?: string; seat?: number } | undefined;
    if (!me || me.seat === undefined) return null;
    return {
      kind: 'you' as const,
      name: me.name ?? `Player ${me.seat + 1}`,
      seat: me.seat,
      color: me.color,
    };
  }
  const active = activePlayer.value;
  return active ? { kind: 'active' as const, ...active } : null;
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
  // LIBX-04 / F-15: undo is a state-committing operation and MUST honor the
  // time-travel guard, exactly like every action path (guarded at the
  // controller chokepoints). The `can-undo` prop handed to custom UIs is only
  // advisory — a custom UI that calls the `undo` slot prop while viewing
  // history would otherwise commit an undo against the LIVE engine. Refuse here
  // so the guard cannot be bypassed from any UI.
  if (isViewingHistory.value) {
    toast.error('Return to the current position before undoing.');
    return;
  }
  if (platformMode.value) {
    const result = await platformRequest('undo', { player: playerSeat.value });
    if (!result.success) {
      console.error('Undo failed:', result.error);
      toast.error(hostErrorText(result, 'Undo failed.'));
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
      toast.error(hostErrorText(result, 'Undo failed.'));
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
  // Same source the Action Panel greys its buttons from, so the board and the
  // panel refuse exactly the same actions.
  disabledActions,
  isViewingHistory,
  // "The runner was replaced" (undo / rewind / host restore). The bridge cancels
  // the open pick on a change — see BoardActionBridgeOptions.restoreEpoch.
  restoreEpoch: computed(() => state.value?.state?.restoreEpoch),
});

// ── DEV-02: devtools postMessage bridge ──────────────────────────────────────
// In platform mode + dev builds only: broadcast reactive state to window.parent
// so the `boardsmith dev` host page can expose window.__BOARDSMITH_DEVTOOLS.
// The entire watch registration is guarded by isDevBuild so production builds
// dead-code-eliminate this block (import.meta.env.DEV is false in production).
if (isDevBuild) {
  watch(
    [
      availableActions,
      actionMetadata,
      playerSeat,
      () => boardInteraction.currentAction,
      () => boardInteraction.currentPickIndex,
      () => boardInteraction.validElements.length,
      state,
    ],
    () => {
      maybePostDevtoolsUpdate(
        { isDevBuild, platformMode: platformMode.value },
        {
          seat: playerSeat.value,
          state: state.value?.state ?? null,
          availableActions: availableActions.value,
          actionMetadata: actionMetadata.value,
          boardInteraction: {
            currentAction: boardInteraction.currentAction,
            currentPickIndex: boardInteraction.currentPickIndex,
            validElements: boardInteraction.validElements,
          },
          flowDebugInfo: state.value?.state?.flowDebugInfo,
          pendingAction: state.value?.state?.pendingAction,
        },
      );
    },
    { deep: false },
  );
}

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

// The move-quality heatmap paints a per-move score chip onto a distinct board
// cell. That is only meaningful when each candidate move maps to its own spatial
// cell — i.e. a grid/hex board. For gridless games (e.g. card games like Go Fish)
// every "ask" move anchors to the same rank group, so the chips collide and the
// overlay collapses to one chip per rank — misleading, not informative. Reuse the
// same archetype signal the AutoUI renderer dispatches on ($layout grid/hex-grid)
// as the single source of truth, so the toggle hides exactly when the heatmap
// cannot render meaningfully.
const heatmapSupportedProp = computed<boolean>(
  () => selectArchetype(gameView.value?.children ?? []) === 'grid-board'
);

// Show Tutorial group when the game definition has a tutorial attached.
// Reads from broadcast state (hasTutorial is set by buildPlayerState).
const hasTutorialProp = computed<boolean>(
  () => (state.value?.state as any)?.hasTutorial ?? false
);

// Teaching lockout (LOCK-01, criterion 4): PREFER broadcast state.teachingDisabled
// as the authoritative single source of truth — every connected seat (reconnect,
// second window) reads the session value, not just the local init snapshot.
// Falls back to the local `teachingDisabled` ref (set from the init postMessage)
// for first-render before the first broadcast arrives (criterion 1 / D-02).
const teachingDisabledProp = computed<boolean>(
  () => (state.value?.state as any)?.teachingDisabled ?? teachingDisabled.value
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

// Gate for the game UI (the registry's board component): it must
// not mount until GameShell's own DOM — including the `#bs-game-modal` teleport
// host — is IN THE DOCUMENT. On a fresh page load the whole app tree is built
// detached and inserted at the end of the root mount, so a game component that
// mounts in the same pass as GameShell resolves `<Teleport to="#bs-game-modal">`
// against the document and finds nothing. Vue then mounts the Teleport with a
// null target, and the component's FIRST re-render throws mid-patch ("Cannot read
// properties of null"), aborting the flush queue and wedging the entire UI (dead
// Action Panel, stale board). Deferring the game UI by one tick (mounted hooks run
// after the tree is inserted) guarantees the host exists in the document first,
// so the documented plain-Teleport pattern always works.
const shellMounted = ref(false);
onMounted(() => {
  shellMounted.value = true;
});

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
      // D-02 / LOCK-01 criterion 1: consume teachingDisabled for first-render gating
      // before any broadcast arrives. The broadcast-preferred computed (teachingDisabledProp)
      // will override this with the authoritative session value on first state update.
      teachingDisabled.value = data.teachingDisabled === true;
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

      // Explicit draw signal (D10/ENDGAME-01): absent/malformed on the frame
      // -> false ("unknown"), never fabricated from the winners array above.
      isDraw.value = data.isDraw === true;
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

    if (result.gameId) {
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

// Decide whether a getLobby() failure means "no lobby — try the legacy
// direct join" vs. a real error to surface. Mirrored in
// GameShell.join-fallthrough.test.ts — keep the two in sync.
// Fall through only when the server answered: HTTP 404 (no lobby support)
// or MeepleClientError (server-reported game/lobby state error). Network
// failures and 5xx must reach the user instead of silently degrading.
function shouldFallThroughToDirectJoin(e: unknown): boolean {
  const is404 = e instanceof Error && /HTTP 404/.test(e.message);
  const isClientErr = e instanceof MeepleClientError;
  return is404 || isClientErr;
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
          // Mint a new unique playerId for this joiner (same-browser scenario)
          // via the SDK's secure minting path — it's a capability token.
          const newPlayerId = generatePlayerId();
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

          try {
            const joinResult = await client.joinLobby(gid, playerName);
            lobbyInfo.value = joinResult.lobby ?? lobby;

            // Check if game started (all slots filled)
            if (joinResult.lobby?.state === 'playing' && joinResult.seat) {
              playerSeat.value = joinResult.seat;
              gameId.value = gid;
              currentScreen.value = 'game';
              updateUrl(gid, joinResult.seat);
              return;
            }
          } catch (joinErr) {
            // Join failed, show lobby anyway so they can try manually
            console.error('Failed to auto-join lobby:', joinErr);
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
      if (!shouldFallThroughToDirectJoin(e)) {
        throw e;
      }
      // No lobby (404) or server-reported lobby/game-state error — the game
      // might be old-style without lobby, so try the legacy direct join.
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

    if (result.lobby) {
      lobbyInfo.value = result.lobby;
    }
    // Save name for future games
    setPlayerName(name);

    // If game started, transition
    if (result.lobby?.state === 'playing' && result.seat) {
      disconnectFromLobby();
      playerSeat.value = result.seat;
      gameId.value = createdGameId.value;
      currentScreen.value = 'game';
      updateUrl(createdGameId.value, result.seat);
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

    if (result.lobby) {
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

    if (result.lobby) {
      lobbyInfo.value = result.lobby;
    }
  } catch (err) {
    console.error('Failed to add slot:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to add slot');
  }
}

async function handleRemoveSlot(position: number) {
  if (!createdGameId.value) return;

  try {
    const result = await client.removeSlot(createdGameId.value, position);

    if (result.lobby) {
      lobbyInfo.value = result.lobby;
    }
  } catch (err) {
    console.error('Failed to remove slot:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to remove slot');
  }
}

async function handleSetSlotAI(position: number, isAI: boolean, aiLevel?: string) {
  if (!createdGameId.value) return;

  try {
    const result = await client.setSlotAI(createdGameId.value, position, isAI, aiLevel);

    if (result.lobby) {
      lobbyInfo.value = result.lobby;
    }
  } catch (err) {
    console.error('Failed to set slot AI:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to update slot');
  }
}

async function handleKickPlayer(position: number) {
  if (!createdGameId.value) return;

  try {
    const result = await client.kickPlayer(createdGameId.value, position);

    if (result.lobby) {
      lobbyInfo.value = result.lobby;
    }
  } catch (err) {
    console.error('Failed to kick player:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to kick player');
  }
}

async function handleUpdatePlayerOptions(options: Record<string, unknown>) {
  if (!createdGameId.value) return;

  try {
    const result = await client.updatePlayerOptions(createdGameId.value, options);

    if (result.lobby) {
      lobbyInfo.value = result.lobby;
    }
  } catch (err) {
    console.error('Failed to update player options:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to update options');
  }
}

async function handleUpdateGameOptions(options: Record<string, unknown>) {
  if (!createdGameId.value) return;

  try {
    const result = await client.updateGameOptions(createdGameId.value, options);

    if (result.lobby) {
      lobbyInfo.value = result.lobby;
    }
  } catch (err) {
    console.error('Failed to update game options:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to update game options');
  }
}

async function handleUpdateSlotPlayerOptions(position: number, options: Record<string, unknown>) {
  if (!createdGameId.value) return;

  try {
    const result = await client.updateSlotPlayerOptions(createdGameId.value, position, options);

    if (result.lobby) {
      lobbyInfo.value = result.lobby;
    }
  } catch (err) {
    console.error('Failed to update slot player options:', err);
    toast.error(err instanceof Error ? err.message : 'Failed to update slot options');
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
    // D11 (ENDGAME-02): "New Game" restarts via the same real restart path as
    // Rematch — it used to call leaveGame(), which goes to a lobby that doesn't
    // exist in dev/platform mode and never restarts. In dev there is no lobby to
    // land in, so "leave" was a dead end; restart is the only real forward exit.
    void handleRestartGame();
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

// All writes go through announcer.announce() so every live-region write shares
// one scheduling discipline (clear-then-set on nextTick, last-write-wins in
// call order) and duplicates re-announce. Never assign the refs directly here —
// a raw synchronous write races the announcer's deferred commit and can be
// silently clobbered by a descendant's announce() from the same tick.

watch(isMyTurn, (newVal) => {
  const text = announceTurnChange(newVal);
  if (text) {
    announcer.announce(text);
  }
}, { immediate: false });

watch(connectionStatus, (newVal, oldVal) => {
  const text = announceConnectionChange(newVal, oldVal ?? '');
  if (text) {
    announcer.announce(text);
  }
}, { immediate: false });

// A restart clears `complete` back to false — re-arm the dismissed card so
// the NEXT completion shows it again (D10).
watch(
  () => (state.value?.flowState as any)?.complete,
  (newComplete) => {
    if (!newComplete) gameOverDismissed.value = false;
  },
  { immediate: false },
);

watch(
  () => (state.value?.flowState as any)?.complete,
  (newComplete, oldComplete) => {
    if (newComplete && !oldComplete) {
      const flowState = state.value?.flowState as any;
      // flowState.winners is a DEFINED array when complete (empty = a genuine
      // draw) vs undefined when winner data could not be validated (dev-WS
      // degrade) — see engine/utils/snapshot.ts. A bare `winnerSeats.length
      // === 0` cannot distinguish the two; the definedness check can (D10).
      const rawWinners: number[] | undefined = flowState?.winners;
      const derived = deriveWinnerState(rawWinners);
      // ENDGAME-01 / F-13: keep the GameOverCard's refs in sync with the SAME
      // flowState.winners source the announcer uses, in NON-platform mode. In
      // platform mode the validated `data.winners`/`data.isDraw` frame (captured
      // in the game_state handler) is authoritative, so don't overwrite it here.
      if (!platformMode.value) {
        winnerSeats.value = derived.winnerSeats;
        isDraw.value = derived.isDraw;
      }
      const winnerNames = derived.winnerSeats.map((seat) => {
        const p = players.value.find((pl) => pl.seat === seat);
        return (p as any)?.name || `Player ${seat}`;
      });
      const text = announceGameOver(winnerNames, derived.isDraw);
      announcer.announce(text, { assertive: true });

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
      announcer.announce(text);
    }
  }
}, { immediate: false });

// UIX-01: single chokepoint for action-failure feedback. actionController is
// shared by ActionPanel AND every custom UI (via useBoardInteraction/inject),
// so watching here covers both parity paths with exactly one toast per
// failure — ActionPanel's own direct toast.error calls are removed (see
// ActionPanel.vue) so this watch is the ONLY place a failed action surfaces.
// Watch source is errorTick, NOT lastError (CR-01): fill()-path failures never
// null-clear lastError between attempts, so a retried IDENTICAL failure leaves
// the string unchanged and a watch on lastError would silently drop the retry's
// toast. errorTick bumps on every failure; the message is read from lastError.
// Never render undefined/[object Object]/.stack — lastError is always either
// an engine/server error string or the UIX-01 fallback copy below.
watch(actionController.errorTick, () => {
  const err = actionController.lastError.value;
  if (!err) return;
  const text = typeof err === 'string' && err.length > 0
    ? err
    : `${actionController.currentAction.value ?? 'Action'} failed — try again or check the current selection.`;
  toast.error(text);
  announcer.announce(text, { assertive: true });
}, { immediate: false });

// UIX-03: dev-mode diagnostic when a responsive custom board silently collapses
// to 0×0 inside the zoom container (`.game-shell__zoom-container { width:
// max-content }` — DO NOT modify that CSS, the structural fix is rejected per
// 134-RESEARCH.md: a definite-width ancestor breaks useAutoZoom's fit formula
// for every board, not just percentage-width ones). Fires ONCE per session
// (WR-01 latch — this reports a structural CSS bug, so re-logging on every
// state broadcast while collapsed would flood the console in AI-vs-AI dev
// games); gated on game state having arrived (non-null gameView), the slot
// having mounted children (RESEARCH Pitfall 2: startup transient), AND the
// board actually being rendered — a display:none ancestor (v-show behind a
// modal, dev-host layout state) reports 0×0 rects even when the sizing CSS
// is correct, so hidden boards are skipped, not reported.
if (isDevBuild) {
  let warned0x0 = false;
  let pending0x0Check: ReturnType<typeof setTimeout> | undefined;
  watch(gameView, async (view) => {
    if (!view || warned0x0) return;
    await nextTick();
    // Only one settle-check in flight at a time — each broadcast would
    // otherwise leave another SETTLE_MS timer pending.
    if (pending0x0Check !== undefined) clearTimeout(pending0x0Check);
    pending0x0Check = setTimeout(() => {
      pending0x0Check = undefined;
      if (warned0x0) return;
      const el = zoomContainerEl.value;
      if (!el || el.children.length === 0) return;
      // Hidden, not collapsed: any display:none ancestor makes offsetParent
      // null (position:fixed elements also have a null offsetParent but ARE
      // rendered, so they still get measured).
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) {
        warned0x0 = true;
        console.error(
          "Custom board failed to render: the board measured 0×0 after game state arrived. " +
          "This usually means a percentage-width or container-type board is collapsing inside GameShell's " +
          "zoom container ('.game-shell__zoom-container { width: max-content }'). Give your board's root " +
          "element a definite width (not 100%), or pin it to the region with useBoardSize() from " +
          'boardsmith/ui — see the "Board Sizing" section of docs/custom-ui-guide.md.'
        );
      }
    }, SETTLE_MS);
  }, { immediate: false });
}

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
        :zoom="zoomLevel"
        v-model:auto-end-turn="autoEndTurn"
        @update:zoom="setZoom"
        @fit-zoom="fitZoom"
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
              :players="panelPlayers"
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
              :show-turn-status="props.showTurnStatus"
            >
              <!-- Beneath the identity token, in the card's narrow first column —
                   for content that reads as part of the seat's identity (a
                   portrait, a rank pip) and would otherwise have to stack under
                   the name row and make every card taller. -->
              <template #player-token-extra="{ player }">
                <slot
                  name="player-token-extra"
                  :player="player"
                  :game-view="gameView"
                  :player-seat="playerSeat"
                ></slot>
              </template>
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
              :state="displayedState"
              :game-view="gameView"
              :players="players"
            ></slot>

            <!-- Game History in the side-scroll: shown when expanded on desktop, and
                 always on mobile (inside the overlay).

                 A game cannot turn this off. The log is the shell's record of what
                 happened, and the only gate on it is the PLAYER's own sidebar-rail
                 collapse — reversible, by the person who chose it. There is
                 deliberately no prop here: a game rendering its own narration
                 elsewhere adds a surface, it does not remove this one, and a game
                 that publishes nothing to `game.messages` gets an honestly empty
                 log rather than no log at all. -->
            <GameHistory
              v-if="isCompact || !sidebarRail"
              ref="historyPanel"
              :messages="gameMessages"
              class="sidebar-history"
            />
          </div>
        </aside>

        <!-- Board region: hero; ~zero chrome padding; container-query-sized.
             Its padding-bottom reserves the Action Panel's CONSTANT footprint
             (--bsg-panel-reserved), so the board is fitted above the panel without
             anything measuring the panel. -->
        <main class="boardregion" id="main" role="main" ref="boardregionEl" tabindex="-1">
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
          <!-- Game Over result card: overlays the board behind a Slate scrim (IA-07, D10).
               Scrim is absolute inside .boardregion — cannot cover the .actionbar sibling
               or browser chrome (T-100-06-02). winnerSeats degrades to [] in dev-WS mode;
               isDraw distinguishes that degrade from a genuine draw.
               A filled #game-over slot replaces the default card entirely; providesOwnGameOverUI
               suppresses BOTH (the game renders its own end state on its own board). Dismissing
               (close button / Escape) reveals the board without restarting or leaving.
               @new-game and @rematch both restart via the one real restart path (D11/ENDGAME-02);
               @leave (menu-only) is the only forward exit that returns to the lobby. -->
          <template v-if="state?.flowState?.complete && !props.providesOwnGameOverUI && !gameOverDismissed">
            <slot
              v-if="$slots['game-over']"
              name="game-over"
              :winners="gameOverWinners"
              :players="players"
              :is-draw="isDraw"
              :rematch="handleRestartGame"
              :new-game="() => handleMenuItemClick('new-game')"
              :dismiss="dismissGameOver"
            />
            <GameOverCard
              v-else
              :winner-seats="winnerSeats"
              :players="players"
              :is-draw="isDraw"
              @new-game="handleMenuItemClick('new-game')"
              @rematch="handleRestartGame"
              @dismiss="dismissGameOver"
            />
          </template>
          <!-- Tutorial annotation overlay: mounts once here so it appears over BOTH
               the registry's board component (default or dev-switcher selection)
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
          <!-- Game modal host: the sanctioned full-board-region overlay layer for custom
               UIs. A game Teleports a blocking modal here (`<Teleport to="#bs-game-modal">`)
               to cover the board area (e.g. an end-of-round summary). It is a direct child
               of .boardregion, so — like GameOverCard/TutorialOverlay — it can cover the
               board but NEVER the header or .actionbar chrome (those are siblings outside
               .boardregion). `contain: layout` re-establishes the containing block, so even
               a teleported overlay that uses `position: fixed` is confined to THIS box (the
               board region) instead of escaping to the viewport — the board-area sandbox
               invariant holds no matter what the game designer does. pointer-events are
               none on the host (click-through when no modal is open) and auto on its
               children (a teleported modal is interactive), so games need no extra wiring.
               The game UI is mounted one tick after this host is in the document (the
               `shellMounted` gate), so a plain `<Teleport to="#bs-game-modal">` in a
               game component always resolves — no `defer` required. -->
          <div class="game-shell__game-modal-host" id="bs-game-modal"></div>
          <div class="game-shell__zoom-container" ref="zoomContainerEl" :style="{ '--zoom-level': zoomLevel }">
            <!--
              Game Board Slot Props:
              - actionController: USE THIS for all action handling (start, fill, execute, cancel)
              - actionArgs: Read-only view of current selection args (for UI display)
              - Other props: game state for rendering
            -->
            <!-- ONE render path for the board: the registry's default UI, or the
                 dev switcher's selection. There is no #game-board slot — a second
                 way to name the default UI would be a second thing to disagree
                 with `src/ui/uis.ts`, and props drifted between the two paths for
                 real while both existed (the slot never received flow-state or
                 @retry). Games declare boards in defineGameUIs(); nothing else. -->
            <!-- `shellMounted` gate: the game UI mounts one tick after GameShell's
                 DOM is in the document, so a game's `<Teleport to="#bs-game-modal">`
                 always resolves its target (see the shellMounted declaration). -->
            <!-- TIME TRAVEL (LIBX-04/D31): a custom board is a PEER of the auto-UI,
                 so it gets the identical treatment the auto ActionPanel gets below
                 — `isViewingHistory` STATED as a prop, and every actionability
                 signal pre-gated on it. Ungated is not a smaller bug than
                 undocumented: what the board DRAWS comes from the historical
                 `gameView`, so an ungated `is-my-turn`/`available-actions` lets it
                 offer a real, clickable control positioned from a state that is no
                 longer true, and the click commits against the LIVE game. Gate here,
                 once, rather than leaving every game to re-derive it from the nulled
                 `flowState`. -->
            <template v-if="shellMounted">
            <component
              v-if="selectedUiComponent"
              :is="selectedUiComponent"
              :state="displayedState"
              :game-view="gameView || null"
              :players="players"
              :my-player="myPlayer"
              :player-seat="playerSeat"
              :is-my-turn="isMyTurn && !isViewingHistory"
              :available-actions="isViewingHistory ? [] : availableActions"
              :action-args="actionArgs"
              :set-board-prompt="setBoardPrompt"
              :can-undo="canUndo && !isViewingHistory"
              :is-viewing-history="isViewingHistory"
              :undo="handleUndo"
              :action-controller="actionController"
              :is-action-help-visible="isActionHelpVisible"
              :disabled-actions="isViewingHistory ? undefined : disabledActions"
              :flow-state="displayedState?.flowState"
              @retry="handleRetry"
            />
            <!-- Only reachable if the registry's default entry resolved to no
                 component — a broken uis.ts. Name the fix, don't render blank. -->
            <div v-else class="empty-game-area">
              <p>No board to render. Mark one UI with defaultUI() in src/ui/uis.ts.</p>
            </div>
            </template>
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

      <!-- Floating Action Panel: absolutely positioned over the BOTTOM of the game
           area (full width) so showing/growing it NEVER reflows or moves the board.
           Its options list caps at 5 rows and scrolls; the board reserves the Action Panel's
           measured height as scroll room so anything it floats over stays reachable. -->
      <div class="actionbar" role="region" aria-label="Actions">
        <!-- ⋯ controls menu: always available at the far-left of the bar (the sole
             control surface in platform mode, where GameHeader is hidden). Opens
             upward since the bar is bottom-anchored. -->
        <ControlsMenu
          class="actionbar-controls"
          open-up
          align="left"
          v-model:auto-end-turn="autoEndTurn"
          :zoom="zoomLevel"
          @update:zoom="setZoom"
          @fit-zoom="fitZoom"
          :can-undo="canUndo && !isViewingHistory"
          :show-hint="showHintProp"
          :hint-disabled="hintDisabledProp"
          :is-demo-running="isDemoRunning"
          :is-heatmap-visible="isHeatmapVisibleProp"
          :heatmap-supported="heatmapSupportedProp"
          :is-action-help-visible="isActionHelpVisible"
          :has-action-help="hasActionHelp"
          :has-tutorial="hasTutorialProp"
          :is-tutorial-running="isTutorialRunningProp"
          :teaching-disabled="teachingDisabledProp"
          @undo="handleUndo"
          @menu-item-click="handleMenuItemClick"
          @teaching-action="handleTeachingAction"
        />
        <!-- Action Panel: only render when player is actionable (IA-04) -->
        <template v-if="isMyTurn || awaitingPlayerNames.length">
          <!-- Identity token at the head of the Action Panel, so the action bar always
               carries WHO (IA-02) regardless of whether the ActionPanel or the fallback
               prompt strip renders the WHAT.

               Turn-based: whose turn it is. Simultaneous: the VIEWER's own seat — see
               `panelToken` for why those are different claims, and why they are drawn
               the same. Never absent while the bar is up: an identity anchor that comes
               and goes between phases reads as broken. -->
          <PlayerToken
            v-if="panelToken"
            class="turn-token"
            :name="panelToken.name"
            :seat="panelToken.seat"
            :color="panelToken.color"
            :size="30"
          />
          <!-- Turn strip: the fallback prompt surface, shown ONLY when the platform
               takes the panel away entirely (the D-02 escape hatch). The prompt
               survives even when no panel renders (IA-03, never a silent board /
               no turn indicator). Per-action `.suppressFromActionPanel()` no longer
               reaches this branch: it can hide redundant buttons but never the
               last one, so it can never leave the Action Panel empty (LIBX-01, see
               ActionPanel's `visibleActions`). -->
          <span v-if="props.platformActionPanelEscapeHatch" class="turn">
            <span class="pr">{{ boardPrompt ?? actionController.currentPick.value?.prompt }}</span>
          </span>
          <!-- Action panel: mounted unless the platform escape hatch removes it.
               It always carries at least one operable control — including in the
               all-board-anchored case, where it renders its anchored-choices
               button list ("Select on board or choose here"). That focusable list
               is the keyboard/SR safety net (A11Y C-2): custom UIs whose board
               isn't keyboard-operable still expose an operable control. -->
          <template v-if="!props.platformActionPanelEscapeHatch">
            <slot name="action-panel">
              <ActionPanel
                :available-actions="isViewingHistory ? [] : availableActions"
                :action-metadata="isViewingHistory ? {} : actionMetadata"
                :is-action-help-visible="isActionHelpVisible"
                :disabled-actions="isViewingHistory ? undefined : disabledActions"
                :players="players"
                :player-seat="playerSeat"
                :is-my-turn="isMyTurn && !isViewingHistory"
                :completed="myCompleted"
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
        :history-has-messages="historyPanel?.hasMessages ?? false"
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

    <!-- The single tooltip every dimmed control borrows to explain itself.
         Mounted once here rather than per-button: at most one shows at a time,
         and a teleported node per compass point / card / option is waste. -->
    <DisabledReasonTooltip />

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

  /* ── Action Panel footprint tokens ────────────────────────────────────────
     The board is fitted above a CONSTANT reserved footprint, never above the
     panel's measured height. The panel's height legitimately changes on every
     selection step, so it has no single value and a fit that reserved it was
     not reproducible between two loads of the same state (issue #13). These
     tokens are derived from the panel's own control metrics, so there is one
     definition of a "row" for both the ceiling and the reservation. */
  --bsg-panel-row: 44px;   /* one control row: the WCAG 2.5.8 touch-target floor */
  --bsg-panel-gap: 8px;    /* .actionbar row gap */
  --bsg-panel-pad: 9px;    /* .actionbar vertical padding */

  /* Visual ceiling: the panel's content lays out inside this and scrolls past it. */
  --bsg-panel-max: calc(5 * var(--bsg-panel-row) + 4 * var(--bsg-panel-gap)
                        + 2 * var(--bsg-panel-pad) + env(safe-area-inset-bottom));

  /* Reserved footprint the board is fitted above: TWO rows. The panel has two
     resting states a player sits in between picks — the action-choice row (which
     routinely wraps once on a phone) and prompt + one row of choices during a
     pick. One row guarantees routine overlap; three would cost 158px of board on
     every load to buy headroom that only many-choice moments need, and internal
     scroll already serves those. */
  --bsg-panel-reserved: min(
    calc(2 * var(--bsg-panel-row) + var(--bsg-panel-gap)
         + 2 * var(--bsg-panel-pad) + env(safe-area-inset-bottom)),
    var(--bsg-panel-max)
  );
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
   floating Action Panel (.actionbar), which is absolutely positioned within it. */
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
   The board renders at its NATURAL size, pinned top-left; at startup a
   one-shot fit (useAutoZoom) zooms it to fill this region without scrolling,
   clamped to the 0.5–2.0 slider range, then leaves it alone. Whenever the
   board — grown mid-game, clamped, or manually zoomed — is larger than the
   region, this region scrolls (both axes): scroll is the contract after
   startup, never clipping and never auto-rescaling. */
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
  /* Reserve scrollbar space so a fit landing near the overflow boundary can't
     toggle the scrollbar on/off, which would change clientWidth/clientHeight
     and create a resize-observer feedback path into useAutoZoom's re-fit. */
  scrollbar-gutter: stable;
  padding: var(--bsg-s1);
  /* The Action Panel's reserved footprint is LAYOUT, not arithmetic: the region's
     own padding excludes it, so the fit's `region.clientHeight - padding` already
     accounts for it and nothing in JS has to know the panel exists. It is a
     constant, so this padding never changes and the persistent region observer
     fires only on genuine viewport changes. Includes the safe-area inset. */
  padding-bottom: var(--bsg-panel-reserved);
}

/* Floating Action Panel: absolutely anchored to the bottom, FULL WIDTH (spans under
   the sidebar too). Out of flow, so it never reflows/moves the board — it floats over
   the board's bottom; the board reserves a CONSTANT footprint (--bsg-panel-reserved,
   in .boardregion's padding) plus scroll room up to the panel's ceiling, so covered
   content stays reachable however tall the panel grows. Everything inside wraps
   naturally (flex-wrap) — no reserved columns; the options list caps at 5 rows and scrolls. */
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
  /* Cap at 5 button-rows, then the whole flow scrolls. The ⋯ menu popover teleports
     to <body>, so overflow is safe. */
  max-height: var(--bsg-panel-max);
  overflow-y: auto;
}

/* ⋯ controls menu — first item in the inline action bar flow. */
.actionbar-controls {
  margin-right: 4px;
}

/* Active-player identity token — flows inline right after the ⋯ menu. */
.turn-token {
  margin-right: 4px;
}

/* The token in a simultaneous step gets NO decoration of its own — it is drawn
   exactly as the whose-turn token is. Do not add a ring, outline, or opacity
   here: a treatment on the identity glyph reads as an unexplained decoration
   rather than as meaning, and it competes with shape, which is the stable
   identity channel and the only one in a colourless game. Which seat the token
   names is `panelToken`'s job; how it looks never varies. */

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
  /* Phones use the SAME 5-row Action Panel row cap as desktop (no override) — the base
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
  .game-shell {
    --bsg-panel-max: min(22dvh, 120px);
    /* One row on a short screen: vertical space is the scarce axis here. */
    --bsg-panel-reserved: min(
      calc(var(--bsg-panel-row) + 2 * var(--bsg-panel-pad) + env(safe-area-inset-bottom)),
      var(--bsg-panel-max)
    );
  }
  .actionbar {
    padding-top: 6px;
    padding-bottom: max(6px, env(safe-area-inset-bottom));
  }
}

/* ── AI demo playback control bar ─────────────────────────────────────────── */
.bsg-demo-controls {
  position: fixed;
  /* Sits one row-gap above the Action Panel's reserved footprint — the same
     quantity the board is fitted against, not a second magic number. */
  bottom: calc(var(--bsg-panel-reserved) + var(--bsg-panel-gap));
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

  /* Total clearance below the board = .boardregion's padding-bottom
     (--bsg-panel-reserved) + this margin = --bsg-panel-max, the panel's ceiling.
     So even a panel grown to its full 5 rows can always be scrolled clear of, while
     the board is still FITTED against only the constant reserved footprint.
     Divided by --zoom-level because `zoom` scales this element's whole layout box,
     margin included: at zoom 0.82 an undivided margin delivered only 82% of the
     clearance and the board's last ~27px stayed pinned under the panel. */
  margin-bottom: calc((var(--bsg-panel-max) - var(--bsg-panel-reserved)) / var(--zoom-level));

  /* CONTAINMENT: Prevents position:fixed from escaping to viewport.
     Any fixed-position elements inside will behave like absolute positioning
     relative to this container - they cannot cover the navbar or ActionPanel. */
  contain: layout;
}

/* Sanctioned full-board-region overlay layer for custom-UI modals (see the
   #bs-game-modal host in the template). Fills .boardregion exactly (like the
   GameOverCard scrim) so a game modal covers the board but not the chrome, and
   `contain: layout` keeps a teleported position:fixed overlay confined to this
   box — the board cannot be escaped. */
.game-shell__game-modal-host {
  position: absolute;
  inset: 0;
  /* Same stacking level as the GameOverCard scrim: above the board content and
     the tutorial/hint/heatmap overlays, but NOT above the floating .actionbar
     Action Panel (also z-index 30, a later sibling that therefore stays on top). A game
     modal covers the board area only — never the Action Panel/header chrome. */
  z-index: 30;
  contain: layout;
  /* Transparent to pointer events when no modal is open; a teleported modal
     (a direct child) re-enables them, so it blocks the board as expected. */
  pointer-events: none;
}
.game-shell__game-modal-host > * {
  pointer-events: auto;
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
