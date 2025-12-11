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
  players: Array<{ name: string; position: number }>;
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
  type: 'action' | 'ping' | 'getState';
  action?: string;
  args?: Record<string, unknown>;
}
