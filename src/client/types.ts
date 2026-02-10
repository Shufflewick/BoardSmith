/**
 * BoardSmith Client SDK Types
 */

import type { LobbyState, SlotStatus, LobbySlot, LobbyInfo } from '../types/protocol.js';
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

export interface WebSocketOutgoingMessage {
  type: 'action' | 'ping' | 'getState';
  action?: string;
  args?: Record<string, unknown>;
  /** Request ID for action request/response correlation */
  requestId?: string;
}

export interface WebSocketIncomingMessage {
  type: 'state' | 'restart' | 'error' | 'pong' | 'lobby' | 'actionResult';
  flowState?: FlowState;
  state?: PlayerState;
  playerSeat?: number;
  isSpectator?: boolean;
  error?: string;
  timestamp?: number;
  lobby?: LobbyInfo;
  /** For actionResult messages */
  requestId?: string;
  success?: boolean;
  data?: Record<string, unknown>;
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
// HTTP Response Types
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  seed?: string;
  /** AI player positions */
  aiPlayers?: number[];
  /** AI difficulty level */
  aiLevel?: string;
  /** Game-specific options (boardSize, targetScore, etc.) */
  gameOptions?: Record<string, unknown>;
  /** Per-player configuration (name, color, role, etc.) */
  playerConfigs?: Array<{
    name?: string;
    isAI?: boolean;
    aiLevel?: string;
    [key: string]: unknown;
  }>;
  /** Whether to use lobby flow (game waits for players to join) */
  useLobby?: boolean;
  /** Creator's player ID (for lobby) */
  creatorId?: string;
}

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

/** Request to claim a seat in the lobby */
export interface ClaimSeatRequest {
  seat: number;
  name: string;
  playerId: string;
}

/** Response to claim seat */
export interface ClaimSeatResponse {
  success: boolean;
  error?: string;
  lobby?: LobbyInfo;
  seat?: number;
}

/** Generic lobby response */
export interface LobbyResponse {
  success: boolean;
  error?: string;
  lobby?: LobbyInfo;
}

/** Request to set ready state */
export interface SetReadyRequest {
  playerId: string;
  ready: boolean;
}

/** Request to add a player slot (host only) */
export interface AddSlotRequest {
  playerId: string;
}

/** Request to remove a player slot (host only) */
export interface RemoveSlotRequest {
  playerId: string;
  seat: number;
}

/** Request to set a slot to AI or open (host only) */
export interface SetSlotAIRequest {
  playerId: string;
  seat: number;
  isAI: boolean;
  aiLevel?: string;
}

/** Request to update game options (host only) */
export interface UpdateGameOptionsRequest {
  playerId: string;
  gameOptions: Record<string, unknown>;
}

/** Request to update player options */
export interface UpdatePlayerOptionsRequest {
  playerId: string;
  playerOptions: Record<string, unknown>;
}
