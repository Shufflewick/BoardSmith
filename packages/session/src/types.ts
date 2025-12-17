/**
 * Shared types for game hosting
 */

import type { FlowState, SerializedAction, Game } from '@boardsmith/engine';

// ============================================
// Game Class Types
// ============================================

/**
 * Game class constructor type
 */
export type GameClass<G extends Game = Game> = new (options: {
  playerCount: number;
  playerNames?: string[];
  seed?: string;
}) => G;

/**
 * Game definition for registering games
 */
export interface GameDefinition {
  gameClass: GameClass;
  gameType: string;
  minPlayers: number;
  maxPlayers: number;
  displayName?: string;
  /** AI configuration */
  ai?: {
    objectives: (...args: unknown[]) => unknown;
  };
  /** Game-level configurable options */
  gameOptions?: Record<string, GameOptionDefinition>;
  /** Per-player configurable options */
  playerOptions?: Record<string, PlayerOptionDefinition>;
  /** Preset configurations for quick setup */
  presets?: GamePreset[];
}

// ============================================
// Game Option Metadata Types
// ============================================

/**
 * Number option definition
 */
export interface NumberOption {
  type: 'number';
  label: string;
  description?: string;
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Select option definition
 */
export interface SelectOption {
  type: 'select';
  label: string;
  description?: string;
  default?: string | number;
  choices: Array<{ value: string | number; label: string }>;
}

/**
 * Boolean option definition
 */
export interface BooleanOption {
  type: 'boolean';
  label: string;
  description?: string;
  default?: boolean;
}

/**
 * Union type for game-level options
 */
export type GameOptionDefinition = NumberOption | SelectOption | BooleanOption;

/**
 * Standard per-player option definition (shown for each player slot)
 */
export interface StandardPlayerOption {
  type: 'select' | 'color' | 'text';
  label: string;
  description?: string;
  default?: string;
  choices?: Array<{ value: string; label: string }> | string[];
}

/**
 * Exclusive player option - renders as radio button, exactly one player can have this
 *
 * Use for asymmetric games where exactly one player must have a specific role.
 *
 * @example
 * ```typescript
 * playerOptions: {
 *   isDictator: {
 *     type: 'exclusive',
 *     label: 'Dictator',
 *     description: 'Select which player is the dictator',
 *     default: 'last',  // 'first', 'last', or player index number
 *   },
 * }
 * ```
 */
export interface ExclusivePlayerOption {
  type: 'exclusive';
  label: string;
  description?: string;
  /**
   * Which player has this option by default.
   * - 'first': Player 0 (first player)
   * - 'last': Last player (player count - 1)
   * - number: Specific player index
   */
  default?: 'first' | 'last' | number;
}

/**
 * Per-player option definition (shown for each player slot)
 */
export type PlayerOptionDefinition = StandardPlayerOption | ExclusivePlayerOption;

/**
 * Per-player configuration in requests
 */
export interface PlayerConfig {
  name?: string;
  isAI?: boolean;
  aiLevel?: string;
  /** Custom player options (color, role, etc.) */
  [key: string]: unknown;
}

/**
 * Preset configuration for quick game setup
 */
export interface GamePreset {
  name: string;
  description?: string;
  /** Game options to apply */
  options: Record<string, unknown>;
  /** Per-player configurations */
  players?: PlayerConfig[];
}

/**
 * Game configuration (player count limits)
 */
export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
}

// ============================================
// Game State Types
// ============================================

/**
 * Persisted game state - stored in database/storage
 */
export interface StoredGameState {
  gameType: string;
  playerCount: number;
  playerNames: string[];
  playerIds?: string[];
  seed?: string;
  actionHistory: SerializedAction[];
  createdAt: number;
  aiConfig?: AIConfig;
  /** Game-specific options (for restart) */
  gameOptions?: Record<string, unknown>;
  /** Lobby state - 'waiting' until all players join, then 'playing' */
  lobbyState?: LobbyState;
  /** Per-slot information for lobby (who claimed what, AI status, etc.) */
  lobbySlots?: LobbySlot[];
  /** Creator's player ID */
  creatorId?: string;
  /** Min/max players for this game type (for lobby slot management) */
  minPlayers?: number;
  maxPlayers?: number;
  /** Player options definitions (for initializing defaults when claiming) */
  playerOptionsDefinitions?: Record<string, PlayerOptionDefinition>;
  /** Game options definitions (for host to modify in lobby) */
  gameOptionsDefinitions?: Record<string, GameOptionDefinition>;
}

/**
 * Reference to a board element for highlighting
 */
export interface ElementRef {
  id?: number;
  name?: string;
  notation?: string;
}

/**
 * Choice with optional board references for highlighting
 */
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  /** Element reference for source highlighting (e.g., piece being moved) */
  sourceRef?: ElementRef;
  /** Element reference for target highlighting (e.g., destination square) */
  targetRef?: ElementRef;
}

/**
 * Valid element for element selection
 */
export interface ValidElement {
  id: number;
  /** Display label for this element */
  display?: string;
  /** Element reference for board highlighting */
  ref?: ElementRef;
}

/**
 * Filter configuration for dependent selections
 */
export interface SelectionFilter {
  /** Key in the choice value object to filter by */
  key: string;
  /** Name of the previous selection to match against */
  selectionName: string;
}

/**
 * Selection metadata for auto-UI generation
 */
export interface SelectionMetadata {
  name: string;
  type: 'choice' | 'player' | 'element' | 'number' | 'text';
  prompt?: string;
  optional?: boolean;
  skipIfOnlyOne?: boolean;
  // Type-specific properties
  choices?: ChoiceWithRefs[];
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  elementClassName?: string;
  /** For element selections: list of valid element IDs the user can select */
  validElements?: ValidElement[];
  /** For choice selections: filter choices based on a previous selection */
  filterBy?: SelectionFilter;
  /** For player selections with boardRefs: list of players with their board element references */
  playerChoices?: Array<{
    position: number;
    name: string;
    sourceRef?: ElementRef;
    targetRef?: ElementRef;
  }>;
}

/**
 * Action metadata for auto-UI generation
 */
export interface ActionMetadata {
  name: string;
  prompt?: string;
  selections: SelectionMetadata[];
}

/**
 * Player-facing game state - what clients receive
 */
export interface PlayerGameState {
  phase: string;
  /** Full player data including custom properties (abilities, score, etc.) */
  players: Array<{ name: string; position: number; [key: string]: unknown }>;
  currentPlayer?: number;
  availableActions?: string[];
  isMyTurn: boolean;
  view: unknown;
  /** Action metadata for auto-UI generation (optional) */
  actionMetadata?: Record<string, ActionMetadata>;
  /** Whether the player can undo (has made actions this turn) */
  canUndo?: boolean;
  /** Number of actions made by this player since turn start */
  actionsThisTurn?: number;
  /** Action index where this player's current turn started */
  turnStartActionIndex?: number;
}

// ============================================
// Lobby Types
// ============================================

/**
 * Lobby lifecycle state
 */
export type LobbyState = 'waiting' | 'playing' | 'finished';

/**
 * Status of a player slot in the lobby
 */
export type SlotStatus = 'open' | 'ai' | 'claimed';

/**
 * Information about a player slot in the lobby
 */
export interface LobbySlot {
  /** Position index (0-based) */
  position: number;
  /** Current status of this slot */
  status: SlotStatus;
  /** Player name (set by creator for AI, by joiner for humans) */
  name: string;
  /** Player ID who claimed this slot (for humans) */
  playerId?: string;
  /** AI level if this is an AI slot */
  aiLevel?: string;
  /** Custom player options (color, role, etc.) */
  playerOptions?: Record<string, unknown>;
  /** Whether this player is ready to start (AI slots are always ready) */
  ready: boolean;
  /** Whether this player is currently connected via WebSocket (for humans) */
  connected?: boolean;
}

/**
 * Full lobby information for clients
 */
export interface LobbyInfo {
  /** Current lobby state */
  state: LobbyState;
  /** Game type */
  gameType: string;
  /** Display name of the game */
  displayName?: string;
  /** All player slots */
  slots: LobbySlot[];
  /** Game options that were configured */
  gameOptions?: Record<string, unknown>;
  /** Game options definitions (for host to modify) */
  gameOptionsDefinitions?: Record<string, GameOptionDefinition>;
  /** Creator's player ID */
  creatorId?: string;
  /** Number of human slots still open */
  openSlots: number;
  /** Whether all slots are filled AND all humans are ready */
  isReady: boolean;
  /** Min players for this game type */
  minPlayers?: number;
  /** Max players for this game type */
  maxPlayers?: number;
}

// ============================================
// Session Types
// ============================================

/**
 * Session identity for broadcasting
 */
export interface SessionInfo {
  playerId?: string;
  playerPosition: number;
  isSpectator: boolean;
}

/**
 * State update message sent to clients
 */
export interface StateUpdate {
  type: 'state';
  flowState: FlowState | undefined;
  state: PlayerGameState;
  playerPosition: number;
  isSpectator: boolean;
}

// ============================================
// AI Types
// ============================================

/**
 * AI player configuration
 */
export interface AIConfig {
  players: number[];
  level: string;
}

// ============================================
// Adapter Interfaces
// ============================================

/**
 * Storage adapter interface for persisting game state
 */
export interface StorageAdapter {
  save(state: StoredGameState): Promise<void>;
  load(): Promise<StoredGameState | null>;
}

/**
 * Broadcast adapter interface for real-time updates
 */
export interface BroadcastAdapter<TSession = SessionInfo> {
  getSessions(): TSession[];
  send(session: TSession, message: unknown): void;
}

// ============================================
// Request/Response Types
// ============================================

/**
 * Request to create a new game
 */
export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  playerIds?: string[];
  seed?: string;
  aiPlayers?: number[];
  aiLevel?: string;
  /** Game-specific options (boardSize, targetScore, etc.) */
  gameOptions?: Record<string, unknown>;
  /** Per-player configurations (for lobby UI) */
  playerConfigs?: PlayerConfig[];
}

/**
 * Request to perform an action
 */
export interface ActionRequest {
  action: string;
  player: number;
  args: Record<string, unknown>;
}

/**
 * WebSocket message from client
 */
export interface WebSocketMessage {
  type: 'action' | 'ping' | 'getState' | 'getLobby' | 'claimPosition' | 'updateName' | 'setReady' | 'addSlot' | 'removeSlot' | 'setSlotAI' | 'leavePosition' | 'kickPlayer' | 'updatePlayerOptions' | 'updateGameOptions';
  action?: string;
  args?: Record<string, unknown>;
  /** For claimPosition/kickPlayer: which position to target */
  position?: number;
  /** For updateName/claimPosition: player's name */
  name?: string;
  /** For setReady: ready state */
  ready?: boolean;
  /** For setSlotAI: whether slot should be AI */
  isAI?: boolean;
  /** For setSlotAI: AI difficulty level */
  aiLevel?: string;
  /** For updatePlayerOptions: the options to set */
  playerOptions?: Record<string, unknown>;
  /** For updateGameOptions: the game options to set (host only) */
  gameOptions?: Record<string, unknown>;
}

// ============================================
// Lobby Request/Response Types
// ============================================

/**
 * Request to claim a position in the lobby
 */
export interface ClaimPositionRequest {
  /** Position to claim (0-indexed) */
  position: number;
  /** Player's name */
  name: string;
  /** Player's unique ID */
  playerId: string;
}

/**
 * Response to claim position request
 */
export interface ClaimPositionResponse {
  success: boolean;
  error?: string;
  /** Updated lobby info */
  lobby?: LobbyInfo;
}

/**
 * Request to update player name
 */
export interface UpdateNameRequest {
  /** Player's unique ID */
  playerId: string;
  /** New name */
  name: string;
}

/**
 * Lobby state update message sent to clients
 */
export interface LobbyUpdate {
  type: 'lobby';
  lobby: LobbyInfo;
}
