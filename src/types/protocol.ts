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

// ============================================
// WebSocket Message Types
// ============================================

/**
 * WebSocket message from client.
 * Unified message type for all client-to-server communication.
 */
export interface WebSocketMessage {
  type:
    | 'action'
    | 'ping'
    | 'getState'
    | 'getLobby'
    | 'claimSeat'
    | 'updateName'
    | 'setReady'
    | 'addSlot'
    | 'removeSlot'
    | 'setSlotAI'
    | 'leaveSeat'
    | 'kickPlayer'
    | 'updatePlayerOptions'
    | 'updateSlotPlayerOptions'
    | 'updateGameOptions';
  /** For action messages: action name */
  action?: string;
  /** For action messages: action arguments */
  args?: Record<string, unknown>;
  /** Request ID for action request/response correlation */
  requestId?: string;
  /** For claimSeat/kickPlayer: which seat to target */
  seat?: number;
  /** For updateName/claimSeat: player's name */
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
