/**
 * Type definitions for useActionController composable.
 *
 * These types define the public API for action handling in BoardSmith UIs.
 * They are used by both the action controller and consuming components.
 */

import type { Ref, ComputedRef } from 'vue';
import type { GameElement } from '../types.js';

// Re-export GameElement as GameViewElement for external use
export type { GameElement as GameViewElement };

/** Reference to a board element (for highlighting) */
export interface ElementRef {
  id?: number;
  name?: string;
  notation?: string;
  className?: string;
}

/** Choice with optional board element references */
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  /** Source element reference (for move origin highlighting) */
  sourceRef?: ElementRef;
  /** Target element reference (for move destination highlighting) */
  targetRef?: ElementRef;
}

/** Valid element for element selections */
export interface ValidElement {
  id: number;
  display?: string;
  /** Element reference (for board highlighting) */
  ref?: ElementRef;
  /** Full element data from gameView (auto-enriched by actionController) */
  element?: GameElement;
}

// Types for action metadata (from server)
/**
 * Metadata for a pick (choice the player must make).
 * "Pick" = a choice player must make to complete an action (per nomenclature.md).
 */
export interface PickMetadata {
  name: string;
  type: 'choice' | 'element' | 'elements' | 'text' | 'number';
  prompt?: string;
  /** If true, shows "Skip" button. If a string, shows that text instead. */
  optional?: boolean | string;
  /** For choice picks: available choices */
  choices?: ChoiceWithRefs[];
  /** For element picks: list of valid element IDs the user can select */
  validElements?: ValidElement[];
  /** For multi-select: min/max selection configuration */
  multiSelect?: { min: number; max?: number };
  /** Filter choices based on a previous pick's value */
  filterBy?: { key: string; selectionName: string };
  /** Look up choices from choicesByDependentValue based on previous pick */
  dependsOn?: string;
  /** Choices indexed by dependent value (used with dependsOn for choice picks) */
  choicesByDependentValue?: Record<string, ChoiceWithRefs[]>;
  /** Elements indexed by dependent value (used with dependsOn for element picks) */
  elementsByDependentValue?: Record<string, ValidElement[]>;
  /** Pick can repeat until terminator */
  repeat?: { hasOnEach: boolean; terminator?: unknown };
  /** For number inputs: minimum value */
  min?: number;
  /** For number inputs: maximum value */
  max?: number;
  /** For number inputs: integer only */
  integer?: boolean;
  /** For text inputs: minimum length */
  minLength?: number;
  /** For text inputs: maximum length */
  maxLength?: number;
  /** For text inputs: regex pattern */
  pattern?: string;
  /** For element picks: CSS class name of selectable elements */
  elementClassName?: string;
  /** For choice picks with dependsOn + multiSelect: multiSelect config indexed by dependent value */
  multiSelectByDependentValue?: Record<string, { min: number; max?: number } | undefined>;
}

/** @deprecated Use PickMetadata instead */
export type SelectionMetadata = PickMetadata;

export interface ActionMetadata {
  name: string;
  prompt?: string;
  selections: PickMetadata[];
}

/** Follow-up action to chain after an action completes */
export interface FollowUpAction {
  /** Name of the action to chain to */
  action: string;
  /** Args to pre-fill in the follow-up action */
  args?: Record<string, unknown>;
  /** Display strings for args (use instead of { id, name } objects) */
  display?: Record<string, string>;
  /** Metadata for the follow-up action (for actions not in availableActions) */
  metadata?: ActionMetadata;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
  message?: string;
  /** Follow-up action to automatically start after this action completes */
  followUp?: FollowUpAction;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Result from a pick step (repeating picks) */
export interface PickStepResult {
  success: boolean;
  error?: string;
  done?: boolean;
  nextChoices?: unknown[];
  actionComplete?: boolean;
}

/** @deprecated Use PickStepResult instead */
export type SelectionStepResult = PickStepResult;

/** Result from fetching pick choices */
export interface PickChoicesResult {
  success: boolean;
  choices?: Array<{ value: unknown; display: string; sourceRef?: unknown; targetRef?: unknown }>;
  validElements?: ValidElement[];
  multiSelect?: { min: number; max?: number };
  error?: string;
}

/** @deprecated Use PickChoicesResult instead */
export type SelectionChoicesResult = PickChoicesResult;

// ============================================
// Action State Snapshot Types (Pit of Success)
// ============================================

/**
 * Snapshot of a pick's available choices.
 * Frozen when fetched, not affected by server broadcasts.
 */
export interface PickSnapshot {
  /** Choices for choice picks */
  choices?: Array<{ value: unknown; display: string; sourceRef?: ElementRef; targetRef?: ElementRef }>;
  /** Valid elements for element picks */
  validElements?: ValidElement[];
  /** MultiSelect config (evaluated when fetched) */
  multiSelect?: { min: number; max?: number };
}

/** @deprecated Use PickSnapshot instead */
export type SelectionSnapshot = PickSnapshot;

/**
 * A collected pick value with its display text.
 * Display is stored at selection time - single source of truth.
 */
export interface CollectedPick {
  /** The selected value(s) */
  value: unknown;
  /** Display text captured at selection time */
  display: string;
  /** Whether this was explicitly skipped */
  skipped: boolean;
}

/** @deprecated Use CollectedPick instead */
export type CollectedSelection = CollectedPick;

/**
 * Complete snapshot of an in-progress action.
 * Created when start() is called, not affected by server broadcasts.
 * This is the "pit of success" - client owns action state once started.
 */
export interface ActionStateSnapshot {
  /** Action name */
  actionName: string;
  /** Full action metadata - frozen at start time */
  metadata: ActionMetadata;
  /** Pick snapshots indexed by pick name */
  pickSnapshots: Map<string, PickSnapshot>;
  /** Collected picks with value+display stored together */
  collectedPicks: Map<string, CollectedPick>;
  /** For repeating picks: current state (reuses existing RepeatingState) */
  repeatingState: RepeatingState | null;
  /** Queued fills for future picks - applied when pick becomes active */
  prefills: Map<string, unknown>;
}

export interface UseActionControllerOptions {
  /** Function to send action to server */
  sendAction: (actionName: string, args: Record<string, unknown>) => Promise<ActionResult>;
  /** Available actions (from game state) */
  availableActions: Ref<string[]>;
  /** Action metadata (from game state) */
  actionMetadata: Ref<Record<string, ActionMetadata> | undefined>;
  /** Is it this player's turn */
  isMyTurn: Ref<boolean>;
  /** Game view (for enriching validElements with full element data) */
  gameView?: Ref<GameElement | null | undefined>;
  /** Player seat (needed for fetching choices/repeating features) */
  playerSeat?: Ref<number>;
  /** Enable auto-fill for single-choice selections (default: true). Can be reactive. */
  autoFill?: boolean | Ref<boolean>;
  /** Enable auto-execute when all selections filled (default: true). Can be reactive. */
  autoExecute?: boolean | Ref<boolean>;
  /**
   * External args object for bidirectional sync with custom UIs.
   * If provided, the controller will use this instead of creating its own.
   * This allows custom game boards to write directly to args (e.g., args.cards = [...])
   * and have the controller see the changes.
   */
  externalArgs?: Record<string, unknown>;
  /**
   * Function to fetch pick choices from server.
   * Required for choice/element/elements picks.
   */
  fetchPickChoices?: (
    actionName: string,
    selectionName: string,
    player: number,
    currentArgs: Record<string, unknown>
  ) => Promise<PickChoicesResult>;
  /**
   * @deprecated Use fetchPickChoices instead
   */
  fetchSelectionChoices?: (
    actionName: string,
    selectionName: string,
    player: number,
    currentArgs: Record<string, unknown>
  ) => Promise<PickChoicesResult>;
  /**
   * Function to process a repeating pick step.
   * Required for picks with `repeat` config.
   */
  pickStep?: (
    player: number,
    selectionName: string,
    value: unknown,
    actionName: string,
    initialArgs?: Record<string, unknown>
  ) => Promise<PickStepResult>;
  /**
   * @deprecated Use pickStep instead
   */
  selectionStep?: (
    player: number,
    selectionName: string,
    value: unknown,
    actionName: string,
    initialArgs?: Record<string, unknown>
  ) => Promise<PickStepResult>;
  /**
   * Called before auto-execute fires (when all selections are filled).
   * Use this to capture element positions for animations before the DOM updates.
   * Return a Promise to delay execution until animation prep is complete.
   *
   * @example
   * ```typescript
   * const controller = useActionController({
   *   // ...
   *   onBeforeAutoExecute: async (actionName, args) => {
   *     if (actionName === 'assignToSquad') {
   *       // Capture element position before DOM updates
   *       const el = document.querySelector(`[data-combatant="${args.combatantName}"]`);
   *       startRect = el?.getBoundingClientRect();
   *     }
   *   },
   * });
   * ```
   */
  onBeforeAutoExecute?: (
    actionName: string,
    args: Record<string, unknown>
  ) => void | Promise<void>;
}

/** State for repeating selections */
export interface RepeatingState {
  selectionName: string;
  /** Accumulated values with their displays (for UI) */
  accumulated: Array<{ value: unknown; display: string }>;
  awaitingServer: boolean;
  currentChoices?: Array<{ value: unknown; display: string }>;
}

export interface UseActionControllerReturn {
  // === State ===
  /** Currently active action name */
  currentAction: Ref<string | null>;
  /** Args collected so far for current action */
  currentArgs: Ref<Record<string, unknown>>;
  /** Current pick that needs user input (null if all filled or no action) */
  currentPick: ComputedRef<PickMetadata | null>;
  /** @deprecated Use currentPick instead */
  currentSelection: ComputedRef<PickMetadata | null>;
  /**
   * Valid elements for the current selection (reactive).
   * Use this in custom UIs instead of getValidElements() for automatic reactivity.
   * Returns empty array if current selection is not an element type or choices haven't loaded.
   */
  validElements: ComputedRef<ValidElement[]>;
  /** Whether all selections are filled and action is ready */
  isReady: ComputedRef<boolean>;
  /** Whether an action is currently executing */
  isExecuting: Ref<boolean>;
  /** Last validation error */
  lastError: Ref<string | null>;
  /** Whether choices are being fetched from server */
  isLoadingChoices: Ref<boolean>;
  /** Repeating selection state (for repeating selections) */
  repeatingState: Ref<RepeatingState | null>;
  /**
   * Whether a followUp action is pending (scheduled but not yet started).
   * Use this to prevent starting new actions while a followUp is queued.
   * This prevents the race condition where currentAction is null but
   * a followUp is about to start via setTimeout.
   */
  pendingFollowUp: Ref<boolean>;

  // === High-level Methods ===
  /**
   * Execute an action with all args at once.
   * - Validates args against action's selections
   * - Auto-fills single-choice selections
   * - Returns actual server result
   */
  execute: (actionName: string, args?: Record<string, unknown>) => Promise<ActionResult>;

  // === Step-by-step Methods (wizard mode) ===
  /**
   * Start an action's selection flow (async - fetches choices from server).
   *
   * @param actionName - The action to start
   * @param options - Optional configuration:
   *   - `args`: Initial args to fill immediately (for first selection)
   *   - `prefill`: Args to auto-fill when their selection becomes active (for later selections)
   *
   * @example
   * ```typescript
   * // Start 'move' action, auto-fill 'destination' when we reach that selection
   * await actionController.start('move', {
   *   prefill: { destination: sectorId }
   * });
   * // User selects squad, then destination auto-fills with sectorId
   * ```
   */
  start: (actionName: string, options?: {
    args?: Record<string, unknown>;
    prefill?: Record<string, unknown>;
  }) => Promise<void>;
  /** Fill a selection with a value (async for repeating selections) */
  fill: (selectionName: string, value: unknown) => Promise<ValidationResult>;
  /** Skip an optional selection */
  skip: (selectionName: string) => void;
  /** Clear a selection's value */
  clear: (selectionName: string) => void;
  /** Cancel the current action */
  cancel: () => void;

  // === Utility ===
  /** Get available choices for a pick (handles filterBy, dependsOn) */
  getChoices: (pick: PickMetadata) => Array<{ value: unknown; display: string }>;
  /** Get filtered choices for current pick (convenience method) */
  getCurrentChoices: () => Array<{ value: unknown; display: string }>;
  /** Get valid elements for an element/elements pick from cache */
  getValidElements: (pick: PickMetadata) => ValidElement[];
  /** Get metadata for an action */
  getActionMetadata: (actionName: string) => ActionMetadata | undefined;
  /** Clear all args (preserves reactivity for external args) */
  clearArgs: () => void;
  /** Fetch choices for a pick from server (called automatically by start/fill) */
  fetchChoicesForPick: (selectionName: string) => Promise<void>;
  /** @deprecated Use fetchChoicesForPick instead */
  fetchChoicesForSelection: (selectionName: string) => Promise<void>;

  // === Snapshot API (Pit of Success) ===
  /** Frozen action state - contains metadata for followUp actions not in availableActions */
  actionSnapshot: Ref<ActionStateSnapshot | null>;
  /** Get a collected selection by name (value + display) */
  getCollectedSelection: (name: string) => CollectedSelection | undefined;
  /** Get all collected selections with their names */
  getCollectedSelections: () => Array<CollectedSelection & { name: string }>;

  // === Hook Registration (for GameShell users) ===
  /**
   * Register a hook to be called before auto-execute.
   * Use this when using GameShell (which creates the controller internally)
   * and you need to capture element positions for animations.
   *
   * @example
   * ```typescript
   * // In game-board slot
   * const { flyingElements, onBeforeAutoExecute } = useActionAnimations({
   *   gameView,
   *   animations: [...]
   * });
   *
   * // Register the hook after getting actionController from slot props
   * actionController.registerBeforeAutoExecute(onBeforeAutoExecute);
   * ```
   */
  registerBeforeAutoExecute: (
    hook: (actionName: string, args: Record<string, unknown>) => void | Promise<void>
  ) => void;
}
