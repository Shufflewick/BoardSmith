/**
 * Vue composable for the BoardSmith client SDK.
 *
 * Internal to the library: `GameShell.vue` is the consumer. It is not on the
 * package exports surface, so games reach a live game through `GameShell`
 * rather than by importing this file.
 */

import { ref, computed, watch, onUnmounted, onScopeDispose, shallowRef, type Ref, type ComputedRef } from 'vue';
import { MeepleClient } from './client.js';
import { GameConnection } from './game-connection.js';
import { audioService } from './audio.js';
import type {
  GameState,
  ConnectionStatus,
  ActionResult,
} from './types.js';

// ============================================
// useGame Composable
// ============================================

export interface UseGameOptions {
  /** Auto-connect when gameId is provided */
  autoConnect?: boolean;
  /** Player seat (if known) - can be a ref for reactivity */
  playerSeat?: Ref<number | undefined> | number;
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
  const { autoConnect = true, playerSeat, spectator = false } = options;

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

  // Normalize playerSeat to get current value
  const getPlayerSeat = (): number | undefined => {
    if (playerSeat === undefined) return undefined;
    return isRef(playerSeat) ? playerSeat.value : playerSeat;
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

    // Create new connection. connectImmediately is threaded from autoConnect so
    // useGame({ autoConnect: false }) never opens a socket it has to immediately
    // kill — GameConnection.connect() honors connectImmediately internally.
    connection = client.connect(id, {
      playerSeat: getPlayerSeat(),
      spectator,
      autoReconnect: true,
      connectImmediately: autoConnect,
    });

    // Clear isSettingUp deterministically when the connection's `opened`
    // promise settles, rather than guessing with a fixed delay. When
    // autoConnect is false, `opened` is the connection's still-resolved
    // default (no socket was dialed), so this clears immediately.
    // Identity guard: if setupConnection ran again before this settled
    // (gameId switch mid-handshake), the superseded connection must not
    // clear isSettingUp or write a stale error over the new connection.
    const thisConnection = connection;
    thisConnection.opened
      .then(() => {
        if (connection !== thisConnection) return;
        isSettingUp = false;
      })
      .catch((err) => {
        if (connection !== thisConnection) return;
        isSettingUp = false;
        error.value = err instanceof Error ? err : new Error(String(err));
      });

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
  };

  // Watch for gameId changes
  watch(gameIdRef, (newId) => {
    setupConnection(newId);
  }, { immediate: true });

  // Watch for playerSeat changes if it's a ref
  // Only reconnect if gameId is set AND we're not already setting up
  let seatDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isDisposed = false;
  if (isRef(playerSeat)) {
    watch(playerSeat, () => {
      // Skip if no game or if a connection setup is already in progress
      if (!gameIdRef.value || isSettingUp) return;

      // True trailing-edge debounce: cancel any pending timer so rapid
      // consecutive seat changes coalesce into a single reconnect instead
      // of stacking one teardown-and-redial per change.
      if (seatDebounceTimer) clearTimeout(seatDebounceTimer);
      seatDebounceTimer = setTimeout(() => {
        seatDebounceTimer = null;
        // Never dial after teardown — a socket opened here would have no
        // owner left to disconnect it.
        if (isDisposed) return;
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

  // Cleanup on teardown. onScopeDispose fires both on component unmount
  // (setup() runs inside the component's effect scope) and when a bare
  // effectScope() is stopped — unlike onUnmounted, which never registers
  // outside a component instance.
  onScopeDispose(() => {
    isDisposed = true;
    if (seatDebounceTimer) {
      clearTimeout(seatDebounceTimer);
      seatDebounceTimer = null;
    }
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
