/**
 * @module types/protocol
 *
 * Canonical protocol types for client-server communication in BoardSmith.
 * This is the single source of truth for all protocol-related types.
 *
 * Import from here rather than defining these types elsewhere:
 * ```typescript
 * import type { LobbyState, WebSocketMessage, ElementRef } from 'boardsmith/types';
 * ```
 */

// ============================================
// Error Codes
// ============================================

/**
 * Standard error codes for programmatic error handling.
 * Use these instead of matching error strings.
 *
 * This is the single source of truth for error codes across all layers
 * (runtime, session, server). The error originates where it is detected and
 * carries its own `ErrorCode` outward — never re-inferred from prose.
 *
 * @example
 * ```typescript
 * import { ErrorCode } from 'boardsmith/session';
 *
 * const result = await session.performAction('move', player, args);
 * if (!result.success) {
 *   switch (result.errorCode) {
 *     case ErrorCode.NOT_YOUR_TURN:
 *       showToast('Please wait for your turn');
 *       break;
 *     case ErrorCode.ACTION_NOT_AVAILABLE:
 *       refreshActions();
 *       break;
 *     default:
 *       showToast(result.error || 'An error occurred');
 *   }
 * }
 * ```
 */
export enum ErrorCode {
  // Player/Turn errors
  INVALID_PLAYER = 'INVALID_PLAYER',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',

  // Action errors
  ACTION_NOT_FOUND = 'ACTION_NOT_FOUND',
  ACTION_NOT_AVAILABLE = 'ACTION_NOT_AVAILABLE',
  // Pick errors
  INVALID_PICK = 'INVALID_PICK',
  PICK_NOT_FOUND = 'PICK_NOT_FOUND',

  // State errors
  NOT_AWAITING_INPUT = 'NOT_AWAITING_INPUT',
  INVALID_ACTION_INDEX = 'INVALID_ACTION_INDEX',
  NO_ACTIONS_TO_UNDO = 'NO_ACTIONS_TO_UNDO',
  CANNOT_REWIND_FORWARD = 'CANNOT_REWIND_FORWARD',

  // Lobby errors
  SEAT_ALREADY_CLAIMED = 'SEAT_ALREADY_CLAIMED',
  INVALID_SEAT = 'INVALID_SEAT',
  NOT_AUTHORIZED = 'NOT_AUTHORIZED',
  GAME_ALREADY_STARTED = 'GAME_ALREADY_STARTED',
  LOBBY_NOT_READY = 'LOBBY_NOT_READY',
  COLOR_ALREADY_TAKEN = 'COLOR_ALREADY_TAKEN',

  // Evaluation errors
  CHOICES_EVALUATION_ERROR = 'CHOICES_EVALUATION_ERROR',
  ELEMENTS_EVALUATION_ERROR = 'ELEMENTS_EVALUATION_ERROR',

  // Generic errors
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  REPLAY_FAILED = 'REPLAY_FAILED',
}

// ============================================
// Lobby Types
// ============================================

/**
 * Lobby lifecycle state.
 * - 'waiting': Game is in lobby, waiting for players to join
 * - 'playing': Game has started
 * - 'finished': Game is complete
 */
export type LobbyState = 'waiting' | 'playing' | 'finished';

/**
 * Status of a player slot in the lobby.
 * - 'open': Slot is available for a human player
 * - 'ai': Slot is taken by an AI player
 * - 'claimed': Slot is taken by a human player
 */
export type SlotStatus = 'open' | 'ai' | 'claimed';

/**
 * Information about a player slot in the lobby.
 */
export interface LobbySlot {
  /** Seat number (1-indexed) */
  seat: number;
  /** Current status of this slot */
  status: SlotStatus;
  /** Player name (set by creator for AI, by joiner for humans) */
  name: string;
  /**
   * Player ID who claimed this slot (for humans).
   *
   * SECURITY: playerId is a per-seat capability — it is used as the identity
   * proof on WebSocket connect and for host-only authorization checks. In
   * client-facing LobbyInfo it is therefore masked: only the recipient's OWN
   * slot carries a playerId; every other slot has it stripped. Never rely on
   * seeing another player's id here.
   */
  playerId?: string;
  /** AI level if this is an AI slot */
  aiLevel?: string;
  /** Custom player options (color, role, etc.) */
  playerOptions?: Record<string, unknown>;
  /** Whether this player is ready to start (AI slots are always ready) */
  ready: boolean;
  /** Whether this player is currently connected via WebSocket (for humans) */
  connected?: boolean;
  /**
   * Whether this slot belongs to the game's creator/host.
   *
   * Derived server-side so clients can render a "Host" badge without ever
   * receiving the creator's secret playerId. Viewer-independent.
   */
  isHost?: boolean;
}

/**
 * Full lobby information for clients.
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
  /** Number of human slots still open */
  openSlots: number;
  /** Whether all slots are filled AND all humans are ready */
  isReady: boolean;
  /** Min players for this game type */
  minPlayers?: number;
  /** Max players for this game type */
  maxPlayers?: number;
  /** Whether players can select colors in the lobby */
  colorSelectionEnabled?: boolean;
  /** Available color palette (hex strings) */
  colors?: string[];
}

// ============================================
// Game Option Types
// ============================================

/** Number option definition */
export interface NumberOption {
  type: 'number';
  label: string;
  description?: string;
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

/** Select option definition */
export interface SelectOption {
  type: 'select';
  label: string;
  description?: string;
  default?: string | number;
  choices: Array<{ value: string | number; label: string }>;
}

/** Boolean option definition */
export interface BooleanOption {
  type: 'boolean';
  label: string;
  description?: string;
  default?: boolean;
}

/** Union type for game-level options */
export type GameOptionDefinition = NumberOption | SelectOption | BooleanOption;

// ============================================
// Request/Response Types
// ============================================

/**
 * Request to create a new game.
 */
export interface CreateGameRequest {
  gameType: string;
  playerCount: number;
  playerNames?: string[];
  playerIds?: string[];
  seed?: string;
  /** AI player positions (1-indexed seat numbers) */
  aiPlayers?: number[];
  /** AI difficulty level */
  aiLevel?: string;
  /** Game-specific options (boardSize, targetScore, etc.) */
  gameOptions?: Record<string, unknown>;
  /** Per-player configurations (for lobby UI) */
  playerConfigs?: PlayerConfig[];
  /** Whether to use lobby flow (game waits for players to join) */
  useLobby?: boolean;
  /** Creator's player ID (for lobby) */
  creatorId?: string;
}

/**
 * Per-player configuration in requests.
 */
export interface PlayerConfig {
  name?: string;
  isAI?: boolean;
  aiLevel?: string;
  /** Custom player options (color, role, etc.) */
  [key: string]: unknown;
}

/**
 * Request to claim a seat in the lobby.
 */
export interface ClaimSeatRequest {
  /** Seat to claim (1-indexed) */
  seat: number;
  /** Player's name */
  name: string;
  /** Player's unique ID */
  playerId: string;
}

/**
 * Response to claim seat request.
 */
export interface ClaimSeatResponse {
  success: boolean;
  error?: string;
  /** Updated lobby info */
  lobby?: LobbyInfo;
  /** Seat that was claimed (for confirmation) */
  seat?: number;
}

/**
 * Request to join the lobby (server assigns seat).
 */
export interface JoinLobbyRequest {
  /** Player's unique ID */
  playerId: string;
  /** Player's display name */
  name: string;
}

/**
 * Response to join lobby request.
 */
export interface JoinLobbyResponse {
  success: boolean;
  error?: string;
  /** Updated lobby info */
  lobby?: LobbyInfo;
  /** Seat that was assigned by the server */
  seat?: number;
}

// ============================================
// WebSocket Message Types
// ============================================

/**
 * WebSocket messages from client to server.
 *
 * This is a discriminated union keyed on `type`: each message variant carries
 * exactly the fields it requires and nothing else. Narrowing on `message.type`
 * gives you the precise payload shape, so invalid messages (e.g. an `action`
 * with no `action` name, or a `claimSeat` with no `seat`) are unrepresentable.
 */

/** Perform a game action. */
export interface ActionMessage {
  type: 'action';
  /** Action name */
  action: string;
  /** Action arguments */
  args: Record<string, unknown>;
  /** Request ID for action request/response correlation */
  requestId?: string;
}

/** Heartbeat ping. */
export interface PingMessage {
  type: 'ping';
}

/** Request the current game state. */
export interface GetStateMessage {
  type: 'getState';
}

/** Request the current lobby info. */
export interface GetLobbyMessage {
  type: 'getLobby';
}

/** Claim a specific seat in the lobby. */
export interface ClaimSeatMessage {
  type: 'claimSeat';
  /** Seat to claim (1-indexed) */
  seat: number;
  /** Player's name */
  name: string;
}

/** Join the lobby; the server assigns a seat. */
export interface JoinLobbyMessage {
  type: 'joinLobby';
  /** Player's name */
  name: string;
}

/** Update the calling player's display name. */
export interface UpdateNameMessage {
  type: 'updateName';
  /** New name */
  name: string;
}

/** Set the calling player's ready state. */
export interface SetReadyMessage {
  type: 'setReady';
  /** Ready state */
  ready: boolean;
}

/** Host adds an open slot to the lobby. */
export interface AddSlotMessage {
  type: 'addSlot';
}

/** Host removes a slot from the lobby. */
export interface RemoveSlotMessage {
  type: 'removeSlot';
  /** Seat to remove (1-indexed) */
  seat: number;
}

/** Host toggles a slot between AI and open. */
export interface SetSlotAIMessage {
  type: 'setSlotAI';
  /** Seat to target (1-indexed) */
  seat: number;
  /** Whether the slot should be AI */
  isAI: boolean;
  /** AI difficulty level (when isAI is true) */
  aiLevel?: string;
}

/** The calling player leaves their seat. */
export interface LeaveSeatMessage {
  type: 'leaveSeat';
}

/** Host kicks the player occupying a seat. */
export interface KickPlayerMessage {
  type: 'kickPlayer';
  /** Seat to kick (1-indexed) */
  seat: number;
}

/** The calling player updates their own per-player options. */
export interface UpdatePlayerOptionsMessage {
  type: 'updatePlayerOptions';
  /** The options to set */
  playerOptions: Record<string, unknown>;
}

/** Host updates the per-player options of a specific slot. */
export interface UpdateSlotPlayerOptionsMessage {
  type: 'updateSlotPlayerOptions';
  /** Seat to target (1-indexed) */
  seat: number;
  /** The options to set */
  playerOptions: Record<string, unknown>;
}

/** Host updates the game-level options. */
export interface UpdateGameOptionsMessage {
  type: 'updateGameOptions';
  /** The game options to set */
  gameOptions: Record<string, unknown>;
}

/**
 * WebSocket message from client.
 * Unified discriminated union for all client-to-server communication.
 */
export type WebSocketMessage =
  | ActionMessage
  | PingMessage
  | GetStateMessage
  | GetLobbyMessage
  | ClaimSeatMessage
  | JoinLobbyMessage
  | UpdateNameMessage
  | SetReadyMessage
  | AddSlotMessage
  | RemoveSlotMessage
  | SetSlotAIMessage
  | LeaveSeatMessage
  | KickPlayerMessage
  | UpdatePlayerOptionsMessage
  | UpdateGameOptionsMessage;

// ============================================
// Element Reference Types
// ============================================

/**
 * Reference to a board element for highlighting and identification.
 * Used in action selections and UI highlighting.
 */
export interface ElementRef {
  /** Element ID (for direct lookup) */
  id?: number;
  /** Element name (for display) */
  name?: string;
  /** Chess-style notation (e.g., "A1", "e4") */
  notation?: string;
  /** CSS class name for styling/selection */
  className?: string;
}

// ============================================
// Action Metadata Types
// ============================================

/**
 * Choice with optional board references for highlighting.
 */
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  /** Element reference for source highlighting (e.g., piece being moved) */
  sourceRef?: ElementRef;
  /** Element reference for target highlighting (e.g., destination square) */
  targetRef?: ElementRef;
  /** Disabled reason string, present only when choice is disabled */
  disabled?: string;
}

/**
 * Valid element for element selection.
 */
export interface ValidElement {
  id: number;
  /** Display label for this element */
  display?: string;
  /** Element reference for board highlighting */
  ref?: ElementRef;
  /** Disabled reason string, present only when element is disabled */
  disabled?: string;
}

/**
 * Filter configuration for dependent picks.
 */
export interface PickFilter {
  /** Key in the choice value object to filter by */
  key: string;
  /** Name of the previous pick to match against */
  selectionName: string;
}

/**
 * Pick metadata for auto-UI generation.
 * A "pick" represents a choice the player must make during action resolution.
 */
export interface PickMetadata {
  name: string;
  type: 'choice' | 'element' | 'elements' | 'number' | 'text';
  prompt?: string;
  /** If true, shows "Skip" button. If a string, shows that text instead. */
  optional?: boolean | string;
  // Choice-specific properties
  /** For choice picks: available choices */
  choices?: ChoiceWithRefs[];
  /** For choice picks: filter choices based on a previous pick */
  filterBy?: PickFilter;
  /** For choice picks with dependsOn: name of the pick this depends on */
  dependsOn?: string;
  /** For choice picks with dependsOn: choices indexed by dependent value */
  choicesByDependentValue?: Record<string, ChoiceWithRefs[]>;
  /** For multi-select choice picks: min/max selection configuration */
  multiSelect?: { min: number; max?: number };
  /** For choice picks with dependsOn + multiSelect: config indexed by dependent value */
  multiSelectByDependentValue?: Record<string, { min: number; max?: number } | undefined>;
  // Element-specific properties
  /** For element picks: CSS class name of selectable elements */
  elementClassName?: string;
  /** For element picks: list of valid element IDs the user can select */
  validElements?: ValidElement[];
  /** For element picks with dependsOn: elements indexed by dependent value */
  elementsByDependentValue?: Record<string, ValidElement[]>;
  // Number-specific properties
  /** For number inputs: minimum value */
  min?: number;
  /** For number inputs: maximum value */
  max?: number;
  /** For number inputs: integer only */
  integer?: boolean;
  // Text-specific properties
  /** For text inputs: regex pattern */
  pattern?: string;
  /** For text inputs: minimum length */
  minLength?: number;
  /** For text inputs: maximum length */
  maxLength?: number;
  // Repeating selection properties
  /** For repeating picks: configuration for repeat behavior */
  repeat?: {
    /** Whether the pick has an onEach callback (requires server round-trip) */
    hasOnEach: boolean;
    /** The terminator value (if using repeatUntil shorthand) */
    terminator?: unknown;
  };
}

/**
 * Action metadata for auto-UI generation.
 */
export interface ActionMetadata {
  name: string;
  prompt?: string;
  selections: PickMetadata[];
}

/**
 * Response from getPickChoices endpoint.
 */
export interface PickChoicesResponse {
  success: boolean;
  error?: string;
  /** Programmatic error code for switch statements */
  errorCode?: string;
  /** For choice picks: formatted choices with display strings and board refs */
  choices?: ChoiceWithRefs[];
  /** For element/elements picks: valid elements the user can select */
  validElements?: ValidElement[];
  /** Multi-select configuration (evaluated at request time) */
  multiSelect?: { min: number; max?: number };
}
