/**
 * Vue Composables for BoardSmith Client SDK
 *
 * Optional Vue 3 integration - only import if using Vue.
 * Import from '@boardsmith/client/vue'
 */

import { ref, computed, watch, onUnmounted, shallowRef, type Ref, type ComputedRef } from 'vue';
import { MeepleClient } from './client.js';
import { GameConnection } from './game-connection.js';
import { audioService } from './audio.js';
import type {
  MeepleClientConfig,
  GameState,
  ConnectionStatus,
  FindMatchOptions,
  MatchmakingResult,
  ActionResult,
} from './types.js';

// ============================================
// useGame Composable
// ============================================

export interface UseGameOptions {
  /** Auto-connect when gameId is provided */
  autoConnect?: boolean;
  /** Player position (if known) - can be a ref for reactivity */
  playerPosition?: Ref<number | undefined> | number;
  /** Connect as spectator */
  spectator?: boolean;
}

export interface UseGameReturn {
  /** Current game state (reactive) */
  state: Ref<GameState | null>;
  /** Connection status (reactive) */
  connectionStatus: Ref<ConnectionStatus>;
  /** Whether connected (computed) */
  isConnected: ComputedRef<boolean>;
  /** Whether it's this player's turn (computed) */
  isMyTurn: ComputedRef<boolean>;
  /** Last error (reactive) */
  error: Ref<Error | null>;
  /** Perform an action */
  action: (actionName: string, args?: Record<string, unknown>) => Promise<ActionResult>;
  /** Manually connect */
  connect: () => void;
  /** Disconnect */
  disconnect: () => void;
  /** Reconnect */
  reconnect: () => void;
  /** Request fresh state */
  refreshState: () => void;
}

// Helper to check if value is a ref
function isRef<T>(value: Ref<T> | T): value is Ref<T> {
  return value !== null && typeof value === 'object' && 'value' in value;
}

export function useGame(
  client: MeepleClient,
  gameId: Ref<string | null> | string | null,
  options: UseGameOptions = {}
): UseGameReturn {
  const { autoConnect = true, playerPosition, spectator = false } = options;

  // Reactive state
  const state = shallowRef<GameState | null>(null);
  const connectionStatus = ref<ConnectionStatus>('disconnected');
  const error = ref<Error | null>(null);

  // Internal connection reference
  let connection: GameConnection | null = null;

  // Computed properties
  const isConnected = computed(() => connectionStatus.value === 'connected');
  const isMyTurn = computed(() => state.value?.state.isMyTurn ?? false);

  // Normalize gameId to a ref
  const gameIdRef = typeof gameId === 'string' || gameId === null
    ? ref(gameId)
    : gameId;

  // Normalize playerPosition to get current value
  const getPlayerPosition = (): number | undefined => {
    if (playerPosition === undefined) return undefined;
    return isRef(playerPosition) ? playerPosition.value : playerPosition;
  };

  // Track if we're currently setting up a connection
  let isSettingUp = false;

  // Setup connection when gameId changes
  const setupConnection = (id: string | null) => {
    isSettingUp = true;

    // Clean up previous connection
    if (connection) {
      connection.disconnect();
      connection = null;
    }

    if (!id) {
      state.value = null;
      connectionStatus.value = 'disconnected';
      isSettingUp = false;
      return;
    }

    // Create new connection
    connection = client.connect(id, {
      playerPosition: getPlayerPosition(),
      spectator,
      autoReconnect: true,
    });

    // Mark setup complete after a short delay to allow connection to establish
    setTimeout(() => {
      isSettingUp = false;
    }, 100);

    // Subscribe to state changes
    connection.onStateChange((newState) => {
      state.value = newState;
      error.value = null;
    });

    // Subscribe to connection changes
    connection.onConnectionChange((status) => {
      connectionStatus.value = status;
    });

    // Subscribe to errors
    connection.onError((err) => {
      error.value = err;
    });

    // Auto-connect is handled by client.connect()
    if (!autoConnect) {
      connection.disconnect();
    }
  };

  // Watch for gameId changes
  watch(gameIdRef, (newId) => {
    setupConnection(newId);
  }, { immediate: true });

  // Watch for playerPosition changes if it's a ref
  // Only reconnect if gameId is set AND we're not already setting up
  if (isRef(playerPosition)) {
    watch(playerPosition, () => {
      // Skip if no game or if a connection setup is already in progress
      if (!gameIdRef.value || isSettingUp) return;

      // Debounce to avoid race conditions with gameId changes
      setTimeout(() => {
        if (gameIdRef.value && !isSettingUp) {
          setupConnection(gameIdRef.value);
        }
      }, 50);
    });
  }

  // Play sound when it becomes this player's turn
  // Use a separate ref to track previous value since Vue's oldValue on computed can be unreliable
  const previousIsMyTurn = ref<boolean | null>(null);
  watch(isMyTurn, (newIsMyTurn) => {
    // Play sound only when transitioning TO your turn (false -> true)
    // Skip initial state (null) to avoid sound on page load
    if (newIsMyTurn === true && previousIsMyTurn.value === false) {
      audioService.playTurnSound();
    }
    previousIsMyTurn.value = newIsMyTurn;
  }, { immediate: true });

  // Cleanup on unmount
  onUnmounted(() => {
    if (connection) {
      connection.disconnect();
      connection = null;
    }
  });

  // Action methods
  const action = async (actionName: string, args: Record<string, unknown> = {}): Promise<ActionResult> => {
    if (!connection) {
      return { success: false, error: 'Not connected' };
    }
    return connection.action(actionName, args);
  };

  const connect = () => {
    connection?.connect();
  };

  const disconnect = () => {
    connection?.disconnect();
  };

  const reconnect = () => {
    connection?.reconnect();
  };

  const refreshState = () => {
    connection?.requestState();
  };

  return {
    state,
    connectionStatus,
    isConnected,
    isMyTurn,
    error,
    action,
    connect,
    disconnect,
    reconnect,
    refreshState,
  };
}

// ============================================
// useMatchmaking Composable
// ============================================

export interface UseMatchmakingOptions {
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Timeout in ms (default: 60000) */
  timeout?: number;
}

export type MatchmakingStatus =
  | { status: 'idle' }
  | { status: 'searching'; position?: number; queueSize?: number; playersNeeded?: number }
  | { status: 'matched'; result: MatchmakingResult }
  | { status: 'error'; error: Error }
  | { status: 'timeout' };

export interface UseMatchmakingReturn {
  /** Current matchmaking state (reactive) */
  matchState: Ref<MatchmakingStatus>;
  /** Whether currently searching (computed) */
  isSearching: ComputedRef<boolean>;
  /** Whether matched (computed) */
  isMatched: ComputedRef<boolean>;
  /** Start searching for a match */
  findMatch: (gameType: string, options: FindMatchOptions) => Promise<void>;
  /** Cancel matchmaking */
  cancel: () => Promise<void>;
  /** Reset to idle state */
  reset: () => void;
}

export function useMatchmaking(
  client: MeepleClient,
  options: UseMatchmakingOptions = {}
): UseMatchmakingReturn {
  const { pollInterval = 2000, timeout = 60000 } = options;

  // Reactive state
  const matchState = ref<MatchmakingStatus>({ status: 'idle' });

  // Internal state
  let aborted = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  // Computed properties
  const isSearching = computed(() => matchState.value.status === 'searching');
  const isMatched = computed(() => matchState.value.status === 'matched');

  const findMatch = async (gameType: string, findOptions: FindMatchOptions): Promise<void> => {
    aborted = false;
    matchState.value = { status: 'searching' };

    // Set timeout
    timeoutId = setTimeout(() => {
      aborted = true;
      matchState.value = { status: 'timeout' };
      client.leaveMatchmaking().catch(() => {});
    }, timeout);

    try {
      // Initial join
      const initial = await client.findMatch(gameType, findOptions);

      if (aborted) return;

      if (initial.matched) {
        clearTimeout(timeoutId!);
        matchState.value = { status: 'matched', result: initial };
        return;
      }

      matchState.value = {
        status: 'searching',
        position: initial.position,
        queueSize: initial.queueSize,
        playersNeeded: initial.playersNeeded,
      };

      // Poll for match
      while (!aborted) {
        await sleep(pollInterval);

        if (aborted) return;

        const status = await client.getMatchStatus();

        if (aborted) return;

        if (status.status === 'matched' && status.gameId) {
          clearTimeout(timeoutId!);
          matchState.value = {
            status: 'matched',
            result: {
              matched: true,
              gameId: status.gameId,
              playerPosition: status.playerPosition,
              players: status.players,
            },
          };
          return;
        }

        if (status.status === 'not_in_queue') {
          clearTimeout(timeoutId!);
          matchState.value = {
            status: 'error',
            error: new Error('Removed from matchmaking queue'),
          };
          return;
        }

        matchState.value = {
          status: 'searching',
          position: status.position,
          queueSize: status.queueSize,
          playersNeeded: status.playersNeeded,
        };
      }
    } catch (err) {
      if (aborted) return;
      clearTimeout(timeoutId!);
      matchState.value = {
        status: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  };

  const cancel = async (): Promise<void> => {
    aborted = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    try {
      await client.leaveMatchmaking();
    } catch {
      // Ignore errors when leaving
    }
    matchState.value = { status: 'idle' };
  };

  const reset = (): void => {
    aborted = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    matchState.value = { status: 'idle' };
  };

  // Cleanup on unmount
  onUnmounted(() => {
    aborted = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  return {
    matchState,
    isSearching,
    isMatched,
    findMatch,
    cancel,
    reset,
  };
}

// ============================================
// useMeepleClient Composable
// ============================================

/**
 * Create and manage a MeepleClient instance.
 * The client is created once and reused for the component's lifetime.
 */
export function useMeepleClient(config: MeepleClientConfig): MeepleClient {
  // Create client once (Vue's setup runs once per component)
  const client = new MeepleClient(config);
  return client;
}

// ============================================
// useGameWithMatchmaking Composable
// ============================================

export interface UseGameWithMatchmakingReturn extends UseGameReturn {
  /** Matchmaking state (reactive) */
  matchState: Ref<MatchmakingStatus>;
  /** Whether currently searching (computed) */
  isSearching: ComputedRef<boolean>;
  /** Whether matched (computed) */
  isMatched: ComputedRef<boolean>;
  /** Start matchmaking */
  findMatch: (gameType: string, options: FindMatchOptions) => Promise<void>;
  /** Cancel matchmaking */
  cancelMatchmaking: () => Promise<void>;
  /** Current game ID (reactive) */
  gameId: Ref<string | null>;
}

/**
 * Combined composable that handles matchmaking and game connection.
 */
export function useGameWithMatchmaking(
  client: MeepleClient,
  options: UseMatchmakingOptions & UseGameOptions = {}
): UseGameWithMatchmakingReturn {
  // Game ID from matchmaking
  const gameId = ref<string | null>(null);

  // Get initial player position value
  const initialPosition = options.playerPosition !== undefined
    ? (isRef(options.playerPosition) ? options.playerPosition.value : options.playerPosition)
    : undefined;
  const playerPositionRef = ref<number | undefined>(initialPosition);

  // Setup matchmaking
  const matchmaking = useMatchmaking(client, options);

  // Setup game connection (will connect when gameId becomes non-null)
  const game = useGame(client, gameId, {
    ...options,
    playerPosition: playerPositionRef,
  });

  // Watch for match completion
  watch(matchmaking.matchState, (state) => {
    if (state.status === 'matched') {
      gameId.value = state.result.gameId ?? null;
      playerPositionRef.value = state.result.playerPosition;
    }
  });

  const cancelMatchmaking = async (): Promise<void> => {
    await matchmaking.cancel();
    gameId.value = null;
    playerPositionRef.value = undefined;
  };

  return {
    // Game properties
    ...game,

    // Matchmaking properties
    matchState: matchmaking.matchState,
    isSearching: matchmaking.isSearching,
    isMatched: matchmaking.isMatched,
    findMatch: matchmaking.findMatch,
    cancelMatchmaking,
    gameId,
  };
}

// ============================================
// Helper Functions
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
