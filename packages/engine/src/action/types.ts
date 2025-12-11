import type { GameElement } from '../element/game-element.js';
import type { Player } from '../player/player.js';
import type { Game } from '../element/game.js';
import type { ElementClass } from '../element/types.js';

/**
 * Selection types for action arguments
 */
export type SelectionType = 'element' | 'player' | 'choice' | 'text' | 'number';

/**
 * Base selection configuration
 */
export interface BaseSelection<T = unknown> {
  /** Selection name (becomes key in args) */
  name: string;
  /** User-facing prompt */
  prompt?: string;
  /** Skip if only one valid choice */
  skipIfOnlyOne?: boolean;
  /** Make this selection optional */
  optional?: boolean;
  /** Validation function */
  validate?: (value: T, args: Record<string, unknown>, context: ActionContext) => boolean | string;
}

/**
 * Reference to a board element for UI highlighting
 */
export interface BoardElementRef {
  id?: number;
  name?: string;
  notation?: string;
}

/**
 * Board references for a choice (source and target elements)
 */
export interface ChoiceBoardRefs {
  sourceRef?: BoardElementRef;
  targetRef?: BoardElementRef;
}

/**
 * Filter configuration for dependent selections
 */
export interface DependentFilter {
  /** Key in the choice value object to filter by */
  key: string;
  /** Name of the previous selection to match against */
  selectionName: string;
}

/**
 * Select from a list of choices
 */
export interface ChoiceSelection<T = unknown> extends BaseSelection<T> {
  type: 'choice';
  /** Choices - can be static array or function */
  choices: T[] | ((context: ActionContext) => T[]);
  /** Display function for choices */
  display?: (choice: T) => string;
  /** Get board element references for highlighting (source/target) */
  boardRefs?: (choice: T, context: ActionContext) => ChoiceBoardRefs;
  /** Filter choices based on a previous selection value */
  filterBy?: DependentFilter;
}

/**
 * Select a player
 */
export interface PlayerSelection extends BaseSelection<Player> {
  type: 'player';
  /** Filter which players can be selected */
  filter?: (player: Player, context: ActionContext) => boolean;
  /** Get board element references for highlighting (e.g., player's hand or avatar) */
  boardRefs?: (player: Player, context: ActionContext) => ChoiceBoardRefs;
}

/**
 * Select an element from the board
 */
export interface ElementSelection<T extends GameElement = GameElement> extends BaseSelection<T> {
  type: 'element';
  /** Filter which elements can be selected */
  filter?: (element: GameElement, context: ActionContext) => boolean;
  /** Limit selection to elements of this class */
  elementClass?: ElementClass<T>;
  /** Starting point for the search (defaults to game) */
  from?: GameElement | ((context: ActionContext) => GameElement);
  /** Display function for elements (for UI buttons) */
  display?: (element: T, context: ActionContext) => string;
  /** Get board element reference for highlighting */
  boardRef?: (element: T, context: ActionContext) => BoardElementRef;
}

/**
 * Enter text
 */
export interface TextSelection extends BaseSelection<string> {
  type: 'text';
  /** Pattern to validate against */
  pattern?: RegExp;
  /** Min length */
  minLength?: number;
  /** Max length */
  maxLength?: number;
}

/**
 * Enter a number
 */
export interface NumberSelection extends BaseSelection<number> {
  type: 'number';
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Must be integer */
  integer?: boolean;
}

/**
 * Union of all selection types
 */
export type Selection =
  | ChoiceSelection
  | PlayerSelection
  | ElementSelection
  | TextSelection
  | NumberSelection;

/**
 * Context passed to selection functions and validators
 */
export interface ActionContext {
  /** The game instance */
  game: Game;
  /** The player taking the action */
  player: Player;
  /** Arguments collected so far */
  args: Record<string, unknown>;
}

/**
 * Definition of an action
 */
export interface ActionDefinition {
  /** Unique action name */
  name: string;
  /** User-facing prompt */
  prompt?: string;
  /** Selections required for this action */
  selections: Selection[];
  /** Condition for when this action is available */
  condition?: (context: ActionContext) => boolean;
  /**
   * Message explaining why the action is unavailable when condition returns false.
   * Can be a static string or a function for dynamic messages.
   */
  conditionMessage?: string | ((context: ActionContext) => string);
  /** The effect to execute */
  execute: (args: Record<string, unknown>, context: ActionContext) => ActionResult | void;
  /**
   * Whether this action can be undone (default: true).
   * Set to false for actions that reveal hidden information (e.g., drawing cards),
   * involve randomness (e.g., dice rolls), or shouldn't be undoable for game reasons.
   * When a non-undoable action is executed, undo is disabled for the rest of the turn.
   */
  undoable?: boolean;
}

/**
 * Result of action execution
 */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Additional data to return */
  data?: Record<string, unknown>;
  /** Message to log */
  message?: string;
}

/**
 * Serialized action for transmission
 */
export interface SerializedAction {
  /** Action name */
  name: string;
  /** Player position */
  player: number;
  /** Serialized arguments */
  args: Record<string, unknown>;
  /** Timestamp */
  timestamp?: number;
  /** Whether this action was undoable (false if action.undoable was false) */
  undoable?: boolean;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Metadata about a selection for UI rendering
 */
export interface SelectionMetadata {
  /** Selection name */
  name: string;
  /** Selection type */
  type: SelectionType;
  /** User-facing prompt */
  prompt?: string;
  /** Whether this selection is optional */
  optional?: boolean;
  /** Number of available choices (for choice/player/element types) */
  choiceCount?: number;
  /** Whether to skip if only one choice */
  skipIfOnlyOne?: boolean;
}

/**
 * Evaluated action with availability information.
 * Used in FlowState to provide rich metadata to clients.
 */
export interface EvaluatedAction {
  /** Action name */
  name: string;
  /** Whether the action is currently available */
  isValid: boolean;
  /** Why the action is unavailable (if not valid) */
  invalidReason?: string;
  /** User-facing prompt for the action */
  prompt?: string;
  /** Metadata about required selections */
  selections?: SelectionMetadata[];
}
