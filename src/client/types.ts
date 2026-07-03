/**
 * BoardSmith Client SDK Types
 */

import type {
  LobbyState,
  SlotStatus,
  LobbySlot,
  LobbyInfo,
  CreateGameRequest,
  ClaimSeatRequest,
  ClaimSeatResponse,
  JoinLobbyResponse,
  LobbyResponse,
  SetReadyRequest,
  AddSlotRequest,
  RemoveSlotRequest,
  SetSlotAIRequest,
  UpdateGameOptionsRequest,
  UpdatePlayerOptionsRequest,
  WebSocketMessage,
} from '../types/protocol.js';
import type { AnimationEvent } from '../engine/index.js';

// ============================================
// Client Configuration
// ============================================

export interface MeepleClientConfig {
  /** Base URL of the BoardSmith worker (e.g., 'https://game.example.com') */
  baseUrl: string;

  /** Auto-reconnect WebSocket on disconnect (default: true) */
  autoReconnect?: boolean;

  /** Maximum reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;

  /** Initial reconnection delay in ms (default: 1000) */
  reconnectDelay?: number;

  /** Timeout for HTTP requests in ms (default: 10000) */
  requestTimeout?: number;
}

// ============================================
// Matchmaking Types
// ============================================

export interface FindMatchOptions {
  /** Number of players for the match */
  playerCount: number;

  /** Display name for this player */
  playerName?: string;
}

export interface MatchmakingResult {
  /** Whether a match was found immediately */
  matched: boolean;

  /** Game ID (if matched) */
  gameId?: string;

  /** Player's seat in the game (1-indexed, if matched) */
  playerSeat?: number;

  /** All player names in the match (if matched) */
  players?: string[];

  /** Position in queue (if not matched) */
  position?: number;

  /** Total players in queue (if not matched) */
  queueSize?: number;

  /** Number of additional players needed (if not matched) */
  playersNeeded?: number;
}

export interface MatchmakingStatus {
  /** Current status: 'waiting', 'matched', or 'not_in_queue' */
  status: 'waiting' | 'matched' | 'not_in_queue';

  /** Game type (if waiting or matched) */
  gameType?: string;

  /** Player count (if waiting or matched) */
  playerCount?: number;

  /** Game ID (if matched) */
  gameId?: string;

  /** Player seat (if matched) */
  playerSeat?: number;

  /** Player names (if matched) */
  players?: string[];

  /** Queue position (if waiting) */
  position?: number;

  /** Queue size (if waiting) */
  queueSize?: number;

  /** Players needed (if waiting) */
  playersNeeded?: number;
}

// ============================================
// Game State Types
// ============================================

export interface FlowState {
  currentPlayer?: number;
  awaitingInput?: boolean;
  availableActions?: string[];
  phase?: string;
}

export interface PlayerState {
  /** Current game phase */
  phase: string;

  /** All players in the game */
  players: Array<{ name: string; seat: number }>;

  /** Current player's position (whose turn it is) */
  currentPlayer?: number;

  /** Actions available to the current player */
  availableActions?: string[];

  /** Whether it's this player's turn */
  isMyTurn: boolean;

  /** Player's view of the game state (filtered for hidden information) */
  view: unknown;

  /** Animation events pending playback. Only present when events exist. */
  animationEvents?: AnimationEvent[];

  /** ID of the last animation event, for acknowledgment convenience. Only present when events exist. */
  lastAnimationEventId?: number;

  /** Action metadata for auto-UI generation (optional) */
  actionMetadata?: Record<string, unknown>;

  /** Whether the player can undo (has made actions this turn) */
  canUndo?: boolean;

  /** Whether color selection is enabled for this game */
  colorSelectionEnabled?: boolean;

  /** Formatted game messages visible to this player */
  messages?: Array<{ text: string }>;
}

export interface GameState {
  /** Flow state (turn info, available actions) */
  flowState: FlowState;

  /** Player-specific state */
  state: PlayerState;

  /** This player's seat */
  playerSeat: number;

  /** Whether this connection is a spectator */
  isSpectator: boolean;
}

// ============================================
// Game Connection Types
// ============================================

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface GameConnectionConfig {
  /** Game ID to connect to */
  gameId: string;

  /** Player ID (from matchmaking) */
  playerId: string;

  /** Player seat (if known) */
  playerSeat?: number;

  /** Connect as spectator */
  spectator?: boolean;

  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;

  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;

  /** Initial reconnection delay in ms */
  reconnectDelay?: number;

  /**
   * Override the WebSocket constructor GameConnection uses to connect.
   *
   * Only needed on runtimes without a global `WebSocket` (e.g. Node <22.4).
   * Node >=22.4 exposes `globalThis.WebSocket` natively and needs no override.
   */
  wsImplementation?: typeof WebSocket;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  /** Additional data returned by the action's execute() */
  data?: Record<string, unknown>;
  /** Message from the action (for logging/display) */
  message?: string;
  /** Follow-up action to chain to (for action chaining) */
  followUp?: {
    action: string;
    args?: Record<string, unknown>;
    /** Metadata for the followUp action (so client can execute without it being in availableActions) */
    metadata?: {
      name: string;
      prompt?: string;
      selections: Array<{
        name: string;
        type: string;
        prompt?: string;
        optional?: boolean;
        [key: string]: unknown;
      }>;
    };
  };
}

// ============================================
// Event Callbacks
// ============================================

export type StateChangeCallback = (state: GameState) => void;
export type LobbyChangeCallback = (lobby: LobbyInfo) => void;
export type ErrorCallback = (error: Error) => void;
export type ConnectionCallback = (status: ConnectionStatus) => void;

// ============================================
// WebSocket Messages
// ============================================

/**
 * WebSocket messages the client sends over the wire.
 *
 * Narrowed from the canonical `WebSocketMessage` union to exactly the three
 * variants `GameConnection` constructs: `action`, `ping`, and `getState`.
 * Lobby-mutation operations (claimSeat, joinLobby, setReady, etc.) go over
 * HTTP via `MeepleClient`'s fetch methods, never over this WebSocket.
 */
export type WebSocketOutgoingMessage = Extract<
  WebSocketMessage,
  { type: 'action' | 'ping' | 'getState' }
>;

/** Follow-up action metadata shared by the actionResult incoming message. */
export interface FollowUpAction {
  action: string;
  args?: Record<string, unknown>;
  /** Metadata for the followUp action (so client can execute without it being in availableActions) */
  metadata?: {
    name: string;
    prompt?: string;
    selections: Array<{
      name: string;
      type: string;
      prompt?: string;
      optional?: boolean;
      [key: string]: unknown;
    }>;
  };
}

/** Server pushed a fresh game state (initial state or a mid-game update). */
export interface StateIncomingMessage {
  type: 'state';
  flowState: FlowState;
  state: PlayerState;
  playerSeat?: number;
  isSpectator?: boolean;
}

/** Server signals the game restarted; carries a fresh state, same shape as `state`. */
export interface RestartIncomingMessage {
  type: 'restart';
  flowState: FlowState;
  state: PlayerState;
  playerSeat?: number;
  isSpectator?: boolean;
}

/** Server pushed an updated lobby snapshot. */
export interface LobbyIncomingMessage {
  type: 'lobby';
  lobby: LobbyInfo;
}

/** Server reported an out-of-band error (not tied to a specific action request). */
export interface ErrorIncomingMessage {
  type: 'error';
  error: string;
}

/** Server's response to a client `action` message, correlated by `requestId`. */
export interface ActionResultIncomingMessage {
  type: 'actionResult';
  requestId?: string;
  success?: boolean;
  error?: string;
  data?: Record<string, unknown>;
  message?: string;
  followUp?: FollowUpAction;
}

/** Server's reply to a client `ping` heartbeat. */
export interface PongIncomingMessage {
  type: 'pong';
}

/**
 * WebSocket messages the client receives over the wire.
 *
 * Discriminated union keyed on `type`, built from the exact variants
 * `GameConnection`'s `onmessage` handler dispatches on.
 */
export type WebSocketIncomingMessage =
  | StateIncomingMessage
  | RestartIncomingMessage
  | LobbyIncomingMessage
  | ErrorIncomingMessage
  | ActionResultIncomingMessage
  | PongIncomingMessage;

// ============================================
// HTTP Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

// Re-export canonical request type from protocol.ts (carries playerIds; see SDK-04/F26)
export type { CreateGameRequest };

export interface CreateGameResponse {
  success: boolean;
  gameId?: string;
  flowState?: FlowState;
  state?: PlayerState;
  error?: string;
  /** Lobby info (if useLobby was true) */
  lobby?: LobbyInfo;
}

// ============================================
// Lobby Types
// ============================================

// Re-export lobby types from canonical source
export type { LobbyState, SlotStatus, LobbySlot, LobbyInfo };

// Re-export request/response types from canonical source (SDK-04/F26 — client SDK no
// longer redefines these; protocol.ts is the single source of truth).
export type {
  ClaimSeatRequest,
  ClaimSeatResponse,
  JoinLobbyResponse,
  LobbyResponse,
  SetReadyRequest,
  AddSlotRequest,
  RemoveSlotRequest,
  SetSlotAIRequest,
  UpdateGameOptionsRequest,
  UpdatePlayerOptionsRequest,
};
