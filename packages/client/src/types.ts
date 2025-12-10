/**
 * BoardSmith Client SDK Types
 */

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

  /** Player's position in the game (0-indexed, if matched) */
  playerPosition?: number;

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

  /** Player position (if matched) */
  playerPosition?: number;

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
  players: Array<{ name: string; position: number }>;

  /** Current player's position (whose turn it is) */
  currentPlayer?: number;

  /** Actions available to the current player */
  availableActions?: string[];

  /** Whether it's this player's turn */
  isMyTurn: boolean;

  /** Player's view of the game state (filtered for hidden information) */
  view: unknown;
}

export interface GameState {
  /** Flow state (turn info, available actions) */
  flowState: FlowState;

  /** Player-specific state */
  state: PlayerState;

  /** This player's position */
  playerPosition: number;

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

  /** Player position (if known) */
  playerPosition?: number;

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
}

// ============================================
// Event Callbacks
// ============================================

export type StateChangeCallback = (state: GameState) => void;
export type ErrorCallback = (error: Error) => void;
export type ConnectionCallback = (status: ConnectionStatus) => void;

// ============================================
// WebSocket Messages
// ============================================

export interface WebSocketOutgoingMessage {
  type: 'action' | 'ping' | 'getState';
  action?: string;
  args?: Record<string, unknown>;
}

export interface WebSocketIncomingMessage {
  type: 'state' | 'error' | 'pong';
  flowState?: FlowState;
  state?: PlayerState;
  playerPosition?: number;
  isSpectator?: boolean;
  error?: string;
  timestamp?: number;
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
}

export interface CreateGameResponse {
  success: boolean;
  gameId?: string;
  flowState?: FlowState;
  state?: PlayerState;
  error?: string;
}
