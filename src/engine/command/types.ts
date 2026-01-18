/**
 * Command System - Low-level state mutations for event sourcing
 *
 * Commands are imperative, low-level operations that directly modify the game state tree.
 * They are generated internally when game code calls element methods (putInto, create, etc.)
 * or during Action execution.
 *
 * Commands vs Actions:
 * - Actions = High-level player operations (game-specific, user-facing)
 * - Commands = Low-level state mutations (generic, event-sourced, internal)
 *
 * @see {@link ../../ARCHITECTURE.md} for the Actions vs Commands architecture explanation
 */

import type { ElementClass, ElementAttributes } from '../element/types.js';
import type { GameElement } from '../element/game-element.js';
import type { VisibilityMode } from './visibility.js';

/**
 * Base command interface - all commands extend this
 */
export interface BaseCommand {
  type: string;
}

/**
 * Create a new element
 */
export interface CreateElementCommand extends BaseCommand {
  type: 'CREATE';
  /** Class name of element to create */
  className: string;
  /** Name for the new element */
  name: string;
  /** ID of parent element */
  parentId: number;
  /** Initial attributes */
  attributes?: Record<string, unknown>;
}

/**
 * Create multiple elements at once
 */
export interface CreateManyCommand extends BaseCommand {
  type: 'CREATE_MANY';
  /** Class name of elements to create */
  className: string;
  /** Base name for elements */
  name: string;
  /** ID of parent element */
  parentId: number;
  /** Number of elements to create */
  count: number;
  /** Attributes for each element (by index) */
  attributesList?: Record<string, unknown>[];
}

/**
 * Move an element to a new parent
 */
export interface MoveCommand extends BaseCommand {
  type: 'MOVE';
  /** ID of element to move */
  elementId: number;
  /** ID of destination element */
  destinationId: number;
  /** Position in destination */
  position?: 'first' | 'last';
}

/**
 * Remove an element (move to pile)
 */
export interface RemoveCommand extends BaseCommand {
  type: 'REMOVE';
  /** ID of element to remove */
  elementId: number;
}

/**
 * Shuffle children of a space
 */
export interface ShuffleCommand extends BaseCommand {
  type: 'SHUFFLE';
  /** ID of space to shuffle */
  spaceId: number;
}

/**
 * Set an attribute on an element
 */
export interface SetAttributeCommand extends BaseCommand {
  type: 'SET_ATTRIBUTE';
  /** ID of element */
  elementId: number;
  /** Attribute name */
  attribute: string;
  /** New value */
  value: unknown;
}

/**
 * Set visibility on an element
 */
export interface SetVisibilityCommand extends BaseCommand {
  type: 'SET_VISIBILITY';
  /** ID of element */
  elementId: number;
  /** Visibility mode or configuration */
  visibility: VisibilityMode | VisibilityConfig;
}

/**
 * Add a player to visibility list
 */
export interface AddVisibleToCommand extends BaseCommand {
  type: 'ADD_VISIBLE_TO';
  /** ID of element */
  elementId: number;
  /** Player position(s) to add */
  players: number[];
}

/**
 * Set the current player
 */
export interface SetCurrentPlayerCommand extends BaseCommand {
  type: 'SET_CURRENT_PLAYER';
  /** Player position */
  playerPosition: number;
}

/**
 * Add a message to the game log
 */
export interface MessageCommand extends BaseCommand {
  type: 'MESSAGE';
  /** Message text (can include {{placeholders}}) */
  text: string;
  /** Data for placeholder substitution */
  data?: Record<string, unknown>;
}

/**
 * Start the game
 */
export interface StartGameCommand extends BaseCommand {
  type: 'START_GAME';
}

/**
 * End the game
 */
export interface EndGameCommand extends BaseCommand {
  type: 'END_GAME';
  /** Winner player positions */
  winners?: number[];
}

/**
 * Set the ordering mode for a space
 */
export interface SetOrderCommand extends BaseCommand {
  type: 'SET_ORDER';
  /** ID of space */
  spaceId: number;
  /** Order mode */
  order: 'normal' | 'stacking';
}

/**
 * Reorder a child element within its parent (debug/testing only)
 * Moves an element to a specific index position within its current parent
 */
export interface ReorderChildCommand extends BaseCommand {
  type: 'REORDER_CHILD';
  /** ID of element to reorder */
  elementId: number;
  /** Target index position (0-based) */
  targetIndex: number;
}

/**
 * Visibility configuration for complex cases
 */
export interface VisibilityConfig {
  /** Base mode */
  mode: VisibilityMode;
  /** Additional players who can see (additive) */
  addPlayers?: number[];
  /** Players who cannot see (subtractive, only with 'all' mode) */
  exceptPlayers?: number[];
}

/**
 * Union of all command types
 */
export type GameCommand =
  | CreateElementCommand
  | CreateManyCommand
  | MoveCommand
  | RemoveCommand
  | ShuffleCommand
  | SetAttributeCommand
  | SetVisibilityCommand
  | AddVisibleToCommand
  | SetCurrentPlayerCommand
  | MessageCommand
  | StartGameCommand
  | EndGameCommand
  | SetOrderCommand
  | ReorderChildCommand;

/**
 * Result of executing a command
 */
export interface CommandResult {
  /** Whether command succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}
