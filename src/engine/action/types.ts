import type { GameElement } from '../element/game-element.js';
import type { Player } from '../player/player.js';
import type { Game } from '../element/game.js';
import type { ElementClass } from '../element/types.js';

/**
 * Selection types for action arguments
 */
export type SelectionType = 'element' | 'choice' | 'elements' | 'text' | 'number';

/**
 * Base selection configuration
 */
export interface BaseSelection<T = unknown> {
  /** Selection name (becomes key in args) */
  name: string;
  /**
   * User-facing prompt. Can be a static string or a function that returns a string.
   * Functions are evaluated at render time with the current game state.
   */
  prompt?: string | ((context: ActionContext) => string);
  /** Make this selection optional. If a string, shows that text instead of "Skip". */
  optional?: boolean | string;
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

// ============================================
// Repeating Selections Types
// ============================================

/**
 * Configuration for repeating selections.
 * Allows a selection to be shown multiple times until a termination condition is met.
 */
export interface RepeatConfig<T = unknown> {
  /**
   * Condition to stop repeating. Called after each selection.
   * Return true to stop repeating and complete this selection.
   */
  until: (context: ActionContext, lastChoice: T) => boolean;
  /**
   * Callback after each selection, before computing next choices.
   * Can modify game state (e.g., equip an item, update available choices).
   */
  onEach?: (context: ActionContext, choice: T) => void;
}

/**
 * Configuration for multi-select choices.
 * Renders checkboxes instead of radio buttons, allowing multiple selections at once.
 */
export interface MultiSelectConfig {
  /** Minimum selections required (default: 1) */
  min?: number;
  /** Maximum selections allowed (default: unlimited) */
  max?: number;
}

/**
 * State for an in-progress repeating selection
 */
export interface RepeatingSelectionState {
  /** Name of the selection being repeated */
  selectionName: string;
  /** Accumulated values so far */
  accumulated: unknown[];
  /** Number of iterations completed */
  iterationCount: number;
}

/**
 * State for a pending action with repeating selections.
 * Tracked by the session to support step-by-step selection flow.
 */
export interface PendingActionState {
  /** Action being executed */
  actionName: string;
  /** Player seat number */
  playerPosition: number;
  /** Collected args for completed selections */
  collectedArgs: Record<string, unknown>;
  /** Current repeating selection state (if any) */
  repeating?: RepeatingSelectionState;
  /** Index of current selection in action.selections */
  currentSelectionIndex: number;
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
  /**
   * Name of a previous selection this choice depends on.
   * When specified, choices are computed for each possible value of the
   * dependent selection and sent to the client as a map.
   * Use this when choices are dynamically generated based on previous selections.
   */
  dependsOn?: string;
  /**
   * Repeat this selection until termination condition is met.
   * When used, the selection value becomes an array of all choices made.
   * Each selection round-trips to the server for state updates.
   */
  repeat?: RepeatConfig<T>;
  /**
   * Shorthand for repeat.until that terminates when this value is selected.
   * Equivalent to: repeat: { until: (ctx, choice) => choice === repeatUntil }
   */
  repeatUntil?: T;
  /**
   * Enable multi-select mode with checkboxes instead of radio buttons.
   * Result will be an array of selected values.
   *
   * Can be:
   * - A number: shorthand for { min: 1, max: N }
   * - A config object: { min?: number, max?: number }
   * - A function: evaluated at render time, returns number | config | undefined
   *
   * @example
   * // Select up to 2 targets
   * multiSelect: 2
   *
   * @example
   * // Select exactly 3 items
   * multiSelect: { min: 3, max: 3 }
   *
   * @example
   * // Select 1 or more (no upper limit)
   * multiSelect: { min: 1 }
   *
   * @example
   * // Dynamic based on game state
   * multiSelect: (ctx) => {
   *   const max = ctx.game.activeCombat?.maxTargets;
   *   if (!max || max <= 1) return undefined; // Single-select
   *   return { min: 1, max };
   * }
   */
  multiSelect?: number | MultiSelectConfig | ((context: ActionContext) => number | MultiSelectConfig | undefined);
}

/**
 * Select an element from the board
 */
export interface ElementSelection<T extends GameElement = GameElement> extends BaseSelection<T> {
  type: 'element';
  /**
   * Elements to choose from (alternative to filter/from pattern).
   * Used by fromElements() for single-select.
   */
  elements?: T[] | ((context: ActionContext) => T[]);
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
  /**
   * Name of a previous selection this element selection depends on.
   * When specified, elements are computed for each possible value of the
   * dependent selection and sent to the client as a map.
   * Use this when elements are dynamically filtered based on previous selections.
   */
  dependsOn?: string;
  /**
   * Repeat this selection until termination condition is met.
   * When used, the selection value becomes an array of all elements selected.
   * Each selection round-trips to the server for state updates.
   */
  repeat?: RepeatConfig<T>;
  /**
   * Shorthand for repeat.until that terminates when this element is selected.
   * Equivalent to: repeat: { until: (ctx, el) => el === repeatUntil }
   */
  repeatUntil?: T;
}

/**
 * Select from a pre-computed array of elements.
 *
 * This is the "pit of success" selection for element-based choices.
 * Unlike chooseFrom, this selection:
 * - Uses element IDs as values (numbers), not strings
 * - Auto-generates display names with disambiguation
 * - Accepts element IDs from custom UIs naturally
 * - Resolves IDs to actual Element objects in execute()
 *
 * @example
 * ```typescript
 * action('attack')
 *   .fromElements('target', {
 *     elements: (ctx) => ctx.game.combat.validTargets,
 *     prompt: 'Choose a target',
 *   })
 *   .execute(({ target }) => {
 *     // target is the resolved Element object
 *     target.takeDamage(10);
 *   });
 * ```
 */
export interface ElementsSelection<T extends GameElement = GameElement> extends BaseSelection<T> {
  type: 'elements';
  /**
   * Elements to choose from - can be static array or function.
   * The value sent to the server will be the element's ID (number).
   */
  elements: T[] | ((context: ActionContext) => T[]);
  /**
   * Custom display function. If not provided, uses element.name with
   * automatic disambiguation (e.g., "Militia #1", "Militia #2").
   */
  display?: (element: T, context: ActionContext, allElements: T[]) => string;
  /** Get board element reference for highlighting */
  boardRef?: (element: T, context: ActionContext) => BoardElementRef;
  /**
   * Enable multi-select mode with checkboxes.
   * Result will be an array of elements.
   */
  multiSelect?: number | MultiSelectConfig | ((context: ActionContext) => number | MultiSelectConfig | undefined);
  /**
   * Name of a previous selection this element selection depends on.
   * When specified, elements are computed for each possible value of the
   * dependent selection and sent to the client as a map.
   * Use this when elements are dynamically filtered based on previous selections.
   */
  dependsOn?: string;
  /**
   * Repeat this selection until termination condition is met.
   * When used, the selection value becomes an array of all elements selected.
   * Each selection round-trips to the server for state updates.
   */
  repeat?: RepeatConfig<T>;
  /**
   * Shorthand for repeat.until that terminates when this element is selected.
   * Equivalent to: repeat: { until: (ctx, el) => el === repeatUntil }
   */
  repeatUntil?: T;
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
  | ElementSelection
  | ElementsSelection
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

// ============================================
// Condition Types
// ============================================

/**
 * A condition predicate function that checks if an action is available.
 */
export type ConditionPredicate = (context: ActionContext) => boolean;

/**
 * Object-based condition where keys are human-readable labels and values are predicates.
 * This format enables automatic debug tracing - each label appears in debug output
 * when its condition fails.
 *
 * @example
 * ```typescript
 * {
 *   'has cards in hand': (ctx) => ctx.player.hand.count() > 0,
 *   'is current player': (ctx) => ctx.player === ctx.game.currentPlayer
 * }
 * ```
 */
export type ObjectCondition = Record<string, ConditionPredicate>;

/**
 * Condition configuration using object format with labeled predicates.
 *
 * Each key is a human-readable label that appears in debug output when
 * the condition fails. All predicates must pass for the action to be available.
 *
 * @example
 * ```typescript
 * .condition({
 *   'has cards in hand': (ctx) => ctx.player.hand.count() > 0,
 *   'is current player': (ctx) => ctx.player === ctx.game.currentPlayer
 * })
 * ```
 */
export type ConditionConfig = ObjectCondition;

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
  /**
   * Condition for when this action is available.
   *
   * Supports two formats:
   * - **Object (preferred):** `{ 'label': predicate }` - Enables automatic debug tracing
   * - **Function:** `(ctx) => boolean` - No debug labels
   *
   * @see ConditionConfig for details and examples
   */
  condition?: ConditionConfig;
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
 * Configuration for a follow-up action that should automatically chain
 * after this action completes.
 */
export interface FollowUpAction {
  /** Name of the action to chain to */
  action: string;
  /** Args to pre-fill in the follow-up action (e.g., element IDs, context) */
  args?: Record<string, unknown>;
  /**
   * Display strings for args shown in the action panel.
   * Use this to provide user-friendly names for ID-based args.
   * @example
   * ```typescript
   * followUp: {
   *   action: 'collectEquipment',
   *   args: { mercId: merc.id, sectorId: sector.id },
   *   display: { mercId: 'Bronson', sectorId: 'Diamond Industry' },
   * }
   * ```
   */
  display?: Record<string, string>;
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
  /**
   * Optional follow-up action to chain after this action completes.
   * When specified, the follow-up action automatically starts with
   * the provided args pre-filled. This enables seamless multi-phase
   * actions where state changes are visible between phases.
   *
   * @example
   * ```typescript
   * Action.create('explore')
   *   .chooseElement('merc', { ... })
   *   .execute((args, ctx) => {
   *     const sector = args.merc.getCurrentSector();
   *     drawEquipmentToStash(sector);
   *     sector.explored = true;
   *
   *     return {
   *       success: true,
   *       followUp: sector.stashCount > 0 ? {
   *         action: 'collectEquipment',
   *         args: { mercId: args.merc.id, sectorId: sector.id }
   *       } : undefined
   *     };
   *   });
   * ```
   */
  followUp?: FollowUpAction;
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

// ============================================
// Action Tracing Types (for debug interface)
// ============================================

/**
 * Detail of a condition check for deep tracing.
 * Used when game developers opt-in to detailed condition tracing.
 */
export interface ConditionDetail {
  /** Human-readable label (e.g., "hasStash(primarySquad)") */
  label: string;
  /** The actual value that was checked */
  value: unknown;
  /** Whether this check passed (truthy) */
  passed: boolean;
  /** Nested condition details for complex checks */
  children?: ConditionDetail[];
}

/**
 * Trace information for a pick within an action.
 * A "pick" represents a choice the player must make during action resolution.
 */
export interface PickTrace {
  /** Pick name */
  name: string;
  /** Pick type (choice, player, element, etc.) */
  type: string;
  /** Number of available choices */
  choiceCount: number;
  /** Whether auto-selected (single choice with Auto mode) */
  skipped?: boolean;
  /** Whether this pick is optional. If a string, shows that text instead of "Skip". */
  optional?: boolean | string;
  /** Whether filterBy was applied */
  filterApplied?: boolean;
  /** Name of pick this depends on (if using dependsOn) */
  dependentOn?: string;
}

/**
 * Complete trace of action availability check.
 * Used by debug interface to show why actions are available/unavailable.
 */
export interface ActionTrace {
  /** Action name */
  actionName: string;
  /** Whether the action is available */
  available: boolean;
  /** Result of condition check (true/false/undefined if no condition) */
  conditionResult?: boolean;
  /** Error message if condition threw */
  conditionError?: string;
  /** Detailed condition trace (automatically populated for object-based conditions) */
  conditionDetails?: ConditionDetail[];
  /** Trace of each pick */
  selections: PickTrace[];
}

// ============================================
// Action Debug Types (human-readable output)
// ============================================

/**
 * Detailed info about a pick's availability.
 * Used by debugActionAvailability() for human-readable output.
 * A "pick" represents a choice the player must make.
 */
export interface PickDebugInfo {
  /** Pick name */
  name: string;
  /** Number of choices available */
  choices: number;
  /** Whether this pick passed (had choices or was optional) */
  passed: boolean;
  /** Human-readable note explaining the status */
  note?: string;
}

/**
 * Human-readable debug information about why an action is or isn't available.
 *
 * @example
 * ```typescript
 * const debug = game.debugActionAvailability('equipItem', player);
 * if (!debug.available) {
 *   console.log(debug.reason);
 *   // "Selection 'equipment' has no valid choices"
 *
 *   for (const sel of debug.details.selections) {
 *     console.log(`${sel.name}: ${sel.choices} choices - ${sel.note}`);
 *   }
 * }
 * ```
 */
export interface ActionDebugInfo {
  /** Action name */
  actionName: string;
  /** Whether the action is available */
  available: boolean;
  /**
   * Human-readable explanation of why the action is/isn't available.
   * Examples:
   * - "Action is available with 3 choices for 'target'"
   * - "Condition failed: player has no action points"
   * - "Selection 'equipment' has no valid choices"
   */
  reason: string;
  /** Detailed breakdown */
  details: {
    /** Whether the action's condition passed (true if no condition) */
    conditionPassed: boolean;
    /** Condition failure details if available */
    conditionNote?: string;
    /** Info about each pick */
    selections: PickDebugInfo[];
  };
}

