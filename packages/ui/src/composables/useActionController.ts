/**
 * useActionController - Unified action handling for ActionPanel and custom UIs
 *
 * This composable provides the core action execution logic that both ActionPanel
 * and custom UIs can use:
 * - Auto-fill behavior (single-choice selections auto-fill)
 * - Validation (checks choices against available options)
 * - Server communication (returns actual ActionResult from server)
 * - State management (currentAction, currentArgs, isExecuting, etc.)
 *
 * ## Usage Patterns
 *
 * ### Pattern 1: Direct Execution (Recommended for custom UIs)
 * Use `execute()` when you have all the args ready:
 * ```typescript
 * const result = await actionController.execute('playCard', { card: 42 });
 * if (result.success) {
 *   // Action executed successfully
 *   console.log(result.data); // Additional data from action
 * } else {
 *   console.error(result.error); // Error message
 * }
 * ```
 *
 * ### Pattern 2: Wizard Mode (Step-by-step selection)
 * Use `start()`, `fill()`, `skip()`, `cancel()` for guided selection:
 * ```typescript
 * actionController.start('attack');
 * // currentSelection.value now shows first selection needed
 *
 * actionController.fill('attacker', 1);
 * // currentSelection.value now shows next selection
 *
 * actionController.fill('target', 10);
 * // If autoExecute is true, action executes automatically when ready
 * ```
 *
 * ## Auto-fill Behavior
 * When `autoFill: true` (default), selections with exactly one choice are
 * automatically filled without user interaction.
 *
 * ## Auto-execute Behavior
 * When `autoExecute: true` (default), the action executes automatically
 * once all required selections are filled (via wizard mode).
 *
 * ## Accessing from Custom UIs
 * The controller is provided via slot props and inject:
 * ```vue
 * <template #game-board="{ actionController }">
 *   <MyBoard :controller="actionController" />
 * </template>
 * ```
 * Or via inject:
 * ```typescript
 * import { injectActionController } from '@boardsmith/ui';
 * const controller = injectActionController();
 * ```
 *
 * ## Supported Features
 * ✅ Static choices (from actionMetadata)
 * ✅ Element selections (validElements)
 * ✅ Auto-fill for single choices
 * ✅ Optional selections (skip)
 * ✅ Multi-select (multiSelect)
 * ✅ Text and number inputs
 * ✅ filterBy - Choices filtered by previous selection value
 * ✅ dependsOn - Choices looked up from choicesByDependentValue
 * ✅ Deferred choices - Fetched from server at selection time
 * ✅ Repeating selections - Selections that repeat until terminator
 *
 * ## Board Interaction
 * For highlighting elements on hover, use `inject('boardInteraction')` from useBoardInteraction.
 * This is a separate concern from action handling and works independently.
 *
 * @example
 * ```typescript
 * // Full-featured controller with deferred and repeating selections
 * const controller = useActionController({
 *   sendAction,
 *   availableActions,
 *   actionMetadata,
 *   isMyTurn,
 *   playerPosition,
 *   fetchDeferredChoices: async (action, selection, player, args) => {
 *     const result = await fetch('/api/deferred-choices', { ... });
 *     return result.json();
 *   },
 *   selectionStep: async (player, selection, value, action, args) => {
 *     const result = await fetch('/api/selection-step', { ... });
 *     return result.json();
 *   },
 * });
 * ```
 */

import { ref, computed, watch, inject, type Ref, type ComputedRef } from 'vue';

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
}

// Types for action metadata (from server)
export interface SelectionMetadata {
  name: string;
  type: 'choice' | 'element' | 'elements' | 'text' | 'number';
  prompt?: string;
  optional?: boolean;
  /** For choice selections: available choices */
  choices?: ChoiceWithRefs[];
  /** For element selections: list of valid element IDs the user can select */
  validElements?: ValidElement[];
  /** For multi-select: min/max selection configuration */
  multiSelect?: { min: number; max?: number };
  /** Choices are fetched from server at selection time */
  deferred?: boolean;
  /** Filter choices based on a previous selection's value */
  filterBy?: { key: string; selectionName: string };
  /** Look up choices from choicesByDependentValue based on previous selection */
  dependsOn?: string;
  /** Choices indexed by dependent value (used with dependsOn) */
  choicesByDependentValue?: Record<string, ChoiceWithRefs[]>;
  /** Selection can repeat until terminator */
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
  /** For element selections: CSS class name of selectable elements */
  elementClassName?: string;
  /** For choice selections with dependsOn + multiSelect: multiSelect config indexed by dependent value */
  multiSelectByDependentValue?: Record<string, { min: number; max?: number } | undefined>;
}

export interface ActionMetadata {
  name: string;
  prompt?: string;
  selections: SelectionMetadata[];
}

export interface ActionResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Result from a selection step (repeating selections) */
export interface SelectionStepResult {
  success: boolean;
  error?: string;
  done?: boolean;
  nextChoices?: unknown[];
  actionComplete?: boolean;
}

/** Result from fetching deferred choices */
export interface DeferredChoicesResult {
  success: boolean;
  choices?: Array<{ value: unknown; display: string }>;
  error?: string;
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
  /** Player position (needed for deferred/repeating features) */
  playerPosition?: Ref<number>;
  /** Enable auto-fill for single-choice selections (default: true) */
  autoFill?: boolean;
  /** Enable auto-execute when all selections filled (default: true) */
  autoExecute?: boolean;
  /**
   * External args object for bidirectional sync with custom UIs.
   * If provided, the controller will use this instead of creating its own.
   * This allows custom game boards to write directly to args (e.g., args.cards = [...])
   * and have the controller see the changes.
   */
  externalArgs?: Record<string, unknown>;
  /**
   * Function to fetch deferred choices from server.
   * Required for selections with `deferred: true`.
   */
  fetchDeferredChoices?: (
    actionName: string,
    selectionName: string,
    player: number,
    currentArgs: Record<string, unknown>
  ) => Promise<DeferredChoicesResult>;
  /**
   * Function to process a repeating selection step.
   * Required for selections with `repeat` config.
   */
  selectionStep?: (
    player: number,
    selectionName: string,
    value: unknown,
    actionName: string,
    initialArgs?: Record<string, unknown>
  ) => Promise<SelectionStepResult>;
}

/** State for repeating selections */
export interface RepeatingState {
  selectionName: string;
  accumulated: unknown[];
  awaitingServer: boolean;
  currentChoices?: Array<{ value: unknown; display: string }>;
}

export interface UseActionControllerReturn {
  // === State ===
  /** Currently active action name */
  currentAction: Ref<string | null>;
  /** Args collected so far for current action */
  currentArgs: Ref<Record<string, unknown>>;
  /** Current selection that needs user input (null if all filled or no action) */
  currentSelection: ComputedRef<SelectionMetadata | null>;
  /** Whether all selections are filled and action is ready */
  isReady: ComputedRef<boolean>;
  /** Whether an action is currently executing */
  isExecuting: Ref<boolean>;
  /** Last validation error */
  lastError: Ref<string | null>;
  /** Whether deferred choices are loading */
  isDeferredLoading: Ref<boolean>;
  /** Repeating selection state (for repeating selections) */
  repeatingState: Ref<RepeatingState | null>;

  // === High-level Methods ===
  /**
   * Execute an action with all args at once.
   * - Validates args against action's selections
   * - Auto-fills single-choice selections
   * - Returns actual server result
   */
  execute: (actionName: string, args?: Record<string, unknown>) => Promise<ActionResult>;

  // === Step-by-step Methods (wizard mode) ===
  /** Start an action's selection flow (async for deferred choices) */
  start: (actionName: string, initialArgs?: Record<string, unknown>) => Promise<void>;
  /** Fill a selection with a value (async for repeating selections) */
  fill: (selectionName: string, value: unknown) => Promise<ValidationResult>;
  /** Skip an optional selection */
  skip: (selectionName: string) => void;
  /** Clear a selection's value */
  clear: (selectionName: string) => void;
  /** Cancel the current action */
  cancel: () => void;

  // === Utility ===
  /** Get available choices for a selection (handles filterBy, dependsOn, deferred) */
  getChoices: (selection: SelectionMetadata) => Array<{ value: unknown; display: string }>;
  /** Get filtered choices for current selection (convenience method) */
  getCurrentChoices: () => Array<{ value: unknown; display: string }>;
  /** Get metadata for an action */
  getActionMetadata: (actionName: string) => ActionMetadata | undefined;
  /** Clear all args (preserves reactivity for external args) */
  clearArgs: () => void;
  /** Fetch deferred choices for a selection (called automatically by start/fill) */
  fetchChoicesForSelection: (selectionName: string) => Promise<void>;
}

/**
 * Create an action controller for handling game actions.
 * This is the shared logic between ActionPanel and custom UIs.
 */
export function useActionController(options: UseActionControllerOptions): UseActionControllerReturn {
  const {
    sendAction,
    availableActions,
    actionMetadata,
    isMyTurn,
    playerPosition,
    autoFill = true,
    autoExecute = true,
    externalArgs,
    fetchDeferredChoices,
    selectionStep,
  } = options;

  // === State ===
  const currentAction = ref<string | null>(null);
  // Use external args if provided (for bidirectional sync with custom UIs),
  // otherwise create our own reactive object
  const internalArgs = ref<Record<string, unknown>>({});
  const currentArgs = computed({
    get: () => externalArgs ?? internalArgs.value,
    set: (val) => {
      if (externalArgs) {
        // Clear and copy to external object
        for (const key of Object.keys(externalArgs)) {
          delete externalArgs[key];
        }
        Object.assign(externalArgs, val);
      } else {
        internalArgs.value = val;
      }
    }
  });
  const isExecuting = ref(false);
  const lastError = ref<string | null>(null);

  // Phase 3: Deferred choices state
  const isDeferredLoading = ref(false);
  const deferredChoicesCache = ref<Record<string, Array<{ value: unknown; display: string }>>>({});

  // Phase 3: Repeating selections state
  const repeatingState = ref<RepeatingState | null>(null);

  // === Helpers ===

  /** Clear all keys from the args object while preserving reactivity */
  function clearArgs(): void {
    const args = currentArgs.value;
    for (const key of Object.keys(args)) {
      delete args[key];
    }
  }

  /** Clear all Phase 3 state */
  function clearAdvancedState(): void {
    deferredChoicesCache.value = {};
    repeatingState.value = null;
  }

  function getActionMetadata(actionName: string): ActionMetadata | undefined {
    return actionMetadata.value?.[actionName];
  }

  /**
   * Get available choices for a selection.
   * Handles: static choices, validElements, dependsOn, filterBy, deferred, repeating
   */
  function getChoices(selection: SelectionMetadata): Array<{ value: unknown; display: string }> {
    let choices: Array<{ value: unknown; display: string }> = [];

    // For repeating selections with dynamic choices from server
    if (selection.repeat && repeatingState.value?.selectionName === selection.name) {
      if (repeatingState.value.currentChoices) {
        choices = repeatingState.value.currentChoices;
      } else if (selection.choices) {
        choices = selection.choices;
      }
    }
    // For deferred selections, use cached choices from server
    else if (selection.deferred && currentAction.value) {
      const key = `${currentAction.value}:${selection.name}`;
      choices = deferredChoicesCache.value[key] || [];
    }
    // Handle dependsOn: look up choices from choicesByDependentValue
    else if (selection.dependsOn && selection.choicesByDependentValue) {
      const dependentValue = currentArgs.value[selection.dependsOn];
      if (dependentValue !== undefined) {
        const key = String(dependentValue);
        choices = selection.choicesByDependentValue[key] || [];
      }
      // If dependent selection not yet made, return empty
    }
    // Regular static choices
    else if (selection.choices) {
      choices = selection.choices;
    }
    // Element selections
    else if (selection.validElements) {
      choices = selection.validElements.map(el => ({
        value: el.id,
        display: el.display || `Element ${el.id}`,
      }));
    }

    // Apply filterBy if specified
    if (selection.filterBy && choices.length > 0) {
      const filterValue = currentArgs.value[selection.filterBy.selectionName];
      if (filterValue !== undefined) {
        choices = choices.filter(choice => {
          const choiceValue = choice.value as Record<string, unknown>;
          return choiceValue[selection.filterBy!.key] === filterValue;
        });
      }
    }

    return choices;
  }

  /** Get choices for the current selection (convenience method) */
  function getCurrentChoices(): Array<{ value: unknown; display: string }> {
    const sel = currentSelection.value;
    if (!sel) return [];
    return getChoices(sel);
  }

  function selectionNeedsInput(selection: SelectionMetadata): boolean {
    const value = currentArgs.value[selection.name];
    return value === undefined;
  }

  function validateSelection(selection: SelectionMetadata, value: unknown): ValidationResult {
    // For repeating selections, validation is done by the server
    if (selection.repeat) {
      return { valid: true };
    }

    // Check if value is in valid choices
    const choices = getChoices(selection);
    if (choices.length > 0) {
      const isValid = choices.some(c => {
        // Handle both direct match and value property match
        if (c.value === value) return true;
        if (typeof c.value === 'object' && c.value !== null) {
          return (c.value as any).value === value || (c.value as any).id === value;
        }
        return false;
      });
      if (!isValid) {
        return { valid: false, error: `Invalid selection for "${selection.name}"` };
      }
    }
    return { valid: true };
  }

  /** Fetch deferred choices for a selection from the server */
  async function fetchChoicesForSelection(selectionName: string): Promise<void> {
    if (!fetchDeferredChoices || !currentAction.value) {
      return;
    }

    const player = playerPosition?.value ?? 0;
    const key = `${currentAction.value}:${selectionName}`;

    isDeferredLoading.value = true;
    try {
      const result = await fetchDeferredChoices(
        currentAction.value,
        selectionName,
        player,
        { ...currentArgs.value }
      );

      if (result.success && result.choices) {
        deferredChoicesCache.value[key] = result.choices;
      } else {
        console.error('Failed to fetch deferred choices:', result.error);
        deferredChoicesCache.value[key] = [];
      }
    } catch (err) {
      console.error('Error fetching deferred choices:', err);
      deferredChoicesCache.value[key] = [];
    } finally {
      isDeferredLoading.value = false;
    }
  }

  // === Computed ===

  const currentActionMeta = computed((): ActionMetadata | undefined => {
    if (!currentAction.value) return undefined;
    return getActionMetadata(currentAction.value);
  });

  const currentSelection = computed((): SelectionMetadata | null => {
    if (!currentActionMeta.value) return null;

    // Find first selection that needs input
    for (const sel of currentActionMeta.value.selections) {
      if (selectionNeedsInput(sel) && !sel.optional) {
        return sel;
      }
    }

    // Then check optional selections
    for (const sel of currentActionMeta.value.selections) {
      if (selectionNeedsInput(sel) && sel.optional) {
        return sel;
      }
    }

    return null;
  });

  const isReady = computed((): boolean => {
    if (!currentActionMeta.value) return false;
    return currentSelection.value === null;
  });

  // === Auto-fill Watch ===
  // When a selection has only one choice, auto-fill it
  watch(currentSelection, (sel) => {
    if (!sel || !autoFill || isExecuting.value) return;

    const choices = getChoices(sel);
    if (choices.length === 1) {
      // Auto-fill
      const choice = choices[0];
      currentArgs.value[sel.name] = choice.value;
    }
  }, { immediate: true });

  // === Auto-execute Watch ===
  // When all selections are filled, auto-execute
  watch(isReady, (ready) => {
    if (ready && autoExecute && currentAction.value && !isExecuting.value) {
      executeCurrentAction();
    }
  });

  // === Methods ===

  async function executeCurrentAction(): Promise<ActionResult> {
    if (!currentAction.value) {
      return { success: false, error: 'No action in progress' };
    }

    if (isExecuting.value) {
      return { success: false, error: 'Action already executing' };
    }

    const actionName = currentAction.value;
    const args = { ...currentArgs.value };

    isExecuting.value = true;
    lastError.value = null;

    try {
      const result = await sendAction(actionName, args);

      if (!result.success) {
        lastError.value = result.error || 'Action failed';
      }

      // Clear state on success or failure
      currentAction.value = null;
      clearArgs();

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Action failed';
      lastError.value = error;
      return { success: false, error };
    } finally {
      isExecuting.value = false;
    }
  }

  async function execute(actionName: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
    if (!isMyTurn.value) {
      return { success: false, error: 'Not your turn' };
    }

    if (!availableActions.value.includes(actionName)) {
      return { success: false, error: `Action "${actionName}" is not available` };
    }

    const meta = getActionMetadata(actionName);
    if (!meta) {
      // No metadata means no selections, execute directly
      isExecuting.value = true;
      lastError.value = null;
      try {
        const result = await sendAction(actionName, args);
        if (!result.success) {
          lastError.value = result.error || 'Action failed';
        }
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Action failed';
        lastError.value = error;
        return { success: false, error };
      } finally {
        isExecuting.value = false;
      }
    }

    // Build final args with auto-fill
    const finalArgs = { ...args };

    for (const selection of meta.selections) {
      if (finalArgs[selection.name] === undefined) {
        // Try auto-fill
        if (autoFill) {
          const choices = getChoices(selection);
          if (choices.length === 1) {
            finalArgs[selection.name] = choices[0].value;
            continue;
          }
        }

        // Check if required
        if (!selection.optional) {
          const error = `Missing required selection: "${selection.name}"`;
          lastError.value = error;
          return { success: false, error };
        }
      } else {
        // Validate provided value
        const validation = validateSelection(selection, finalArgs[selection.name]);
        if (!validation.valid) {
          lastError.value = validation.error || 'Validation failed';
          return { success: false, error: validation.error };
        }
      }
    }

    // Execute
    isExecuting.value = true;
    lastError.value = null;

    try {
      const result = await sendAction(actionName, finalArgs);
      if (!result.success) {
        lastError.value = result.error || 'Action failed';
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Action failed';
      lastError.value = error;
      return { success: false, error };
    } finally {
      isExecuting.value = false;
    }
  }

  async function start(actionName: string, initialArgs: Record<string, unknown> = {}): Promise<void> {
    if (!availableActions.value.includes(actionName)) {
      lastError.value = `Action "${actionName}" is not available`;
      return;
    }

    currentAction.value = actionName;
    clearArgs();
    clearAdvancedState();
    Object.assign(currentArgs.value, initialArgs);
    lastError.value = null;

    // Check if first selection is deferred - if so, fetch choices
    const meta = getActionMetadata(actionName);
    if (meta && meta.selections.length > 0) {
      const firstSel = meta.selections[0];
      if (firstSel.deferred) {
        await fetchChoicesForSelection(firstSel.name);
      }
    }
  }

  async function fill(selectionName: string, value: unknown): Promise<ValidationResult> {
    if (!currentActionMeta.value) {
      return { valid: false, error: 'No action in progress' };
    }

    const selection = currentActionMeta.value.selections.find(s => s.name === selectionName);
    if (!selection) {
      return { valid: false, error: `Unknown selection: "${selectionName}"` };
    }

    // Handle repeating selections
    if (selection.repeat) {
      return await handleRepeatingFill(selection, value);
    }

    // Normal fill
    const validation = validateSelection(selection, value);
    if (validation.valid) {
      currentArgs.value[selectionName] = value;

      // Check if next selection is deferred - if so, fetch choices
      const nextSel = getNextSelection(selectionName);
      if (nextSel?.deferred) {
        await fetchChoicesForSelection(nextSel.name);
      }
    } else {
      lastError.value = validation.error || 'Validation failed';
    }

    return validation;
  }

  /** Handle fill for repeating selections */
  async function handleRepeatingFill(selection: SelectionMetadata, value: unknown): Promise<ValidationResult> {
    if (!selectionStep || !currentAction.value) {
      return { valid: false, error: 'selectionStep function not provided for repeating selection' };
    }

    const player = playerPosition?.value ?? 0;

    // Initialize repeating state if needed
    if (!repeatingState.value || repeatingState.value.selectionName !== selection.name) {
      repeatingState.value = {
        selectionName: selection.name,
        accumulated: [],
        awaitingServer: false,
        currentChoices: selection.choices,
      };
    }

    // Add to accumulated
    repeatingState.value.accumulated.push(value);
    repeatingState.value.awaitingServer = true;

    try {
      const result = await selectionStep(
        player,
        selection.name,
        value,
        currentAction.value,
        { ...currentArgs.value }
      );

      if (!result.success) {
        // Remove from accumulated on error
        repeatingState.value.accumulated.pop();
        const error = result.error || 'Selection step failed';
        lastError.value = error;
        return { valid: false, error };
      }

      // Check if action is complete (termination condition met)
      if (result.actionComplete) {
        // Action completed - clear everything
        repeatingState.value = null;
        currentAction.value = null;
        clearArgs();
        return { valid: true };
      }

      // Check if this repeating selection is done but action continues
      if (result.done) {
        // Move accumulated to args and clear repeating state
        currentArgs.value[selection.name] = repeatingState.value.accumulated;
        repeatingState.value = null;
        return { valid: true };
      }

      // For selections with onEach, clear accumulated since items are processed immediately
      if (selection.repeat?.hasOnEach) {
        repeatingState.value.accumulated = [];
      }

      // More iterations needed - update choices if provided
      if (result.nextChoices) {
        repeatingState.value.currentChoices = result.nextChoices.map((choice: unknown) => {
          if (typeof choice === 'object' && choice !== null && 'value' in choice && 'display' in choice) {
            return choice as { value: unknown; display: string };
          }
          return { value: choice, display: String(choice) };
        });
      }

      return { valid: true };
    } finally {
      if (repeatingState.value) {
        repeatingState.value.awaitingServer = false;
      }
    }
  }

  /** Get the next selection after the given one */
  function getNextSelection(afterSelectionName: string): SelectionMetadata | null {
    if (!currentActionMeta.value) return null;

    const selections = currentActionMeta.value.selections;
    const currentIndex = selections.findIndex(s => s.name === afterSelectionName);
    if (currentIndex === -1 || currentIndex >= selections.length - 1) return null;

    // Find next selection that needs input
    for (let i = currentIndex + 1; i < selections.length; i++) {
      const sel = selections[i];
      if (selectionNeedsInput(sel)) {
        return sel;
      }
    }
    return null;
  }

  function skip(selectionName: string): void {
    if (!currentActionMeta.value) return;

    const selection = currentActionMeta.value.selections.find(s => s.name === selectionName);
    if (selection?.optional) {
      currentArgs.value[selectionName] = null; // Explicitly skipped
    }
  }

  function clear(selectionName: string): void {
    delete currentArgs.value[selectionName];
  }

  function cancel(): void {
    currentAction.value = null;
    clearArgs();
    clearAdvancedState();
    lastError.value = null;
  }

  return {
    // State
    currentAction,
    currentArgs,
    currentSelection,
    isReady,
    isExecuting,
    lastError,
    isDeferredLoading,
    repeatingState,

    // Methods
    execute,
    start,
    fill,
    skip,
    clear,
    cancel,

    // Utility
    getChoices,
    getCurrentChoices,
    getActionMetadata,
    clearArgs,
    fetchChoicesForSelection,
  };
}

/**
 * Injection key for action controller.
 * Use with Vue's inject() to access the controller from deeply nested components.
 */
export const ACTION_CONTROLLER_KEY = 'actionController';

/**
 * Convenience function to inject the action controller from a parent GameShell.
 * Throws an error if not inside a GameShell context.
 *
 * @example
 * ```typescript
 * // In a deeply nested component inside GameShell
 * const controller = injectActionController();
 * await controller.execute('playCard', { card: 42 });
 * ```
 */
export function injectActionController(): UseActionControllerReturn {
  const controller = inject<UseActionControllerReturn>(ACTION_CONTROLLER_KEY);
  if (!controller) {
    throw new Error('injectActionController() must be called inside a GameShell context');
  }
  return controller;
}

// ============================================
// Advanced Feature Injection Helpers
// ============================================

/**
 * Type for the selection step function (repeating selections).
 * Used when a selection can repeat multiple times (e.g., discard until done).
 */
export type SelectionStepFn = (
  player: number,
  selectionName: string,
  value: unknown,
  actionName: string,
  initialArgs?: Record<string, unknown>
) => Promise<{
  success: boolean;
  error?: string;
  done?: boolean;
  nextChoices?: unknown[];
  actionComplete?: boolean;
}>;

/**
 * Type for the deferred choices fetch function.
 * Used when choices must be computed by the server at selection time.
 */
export type FetchDeferredChoicesFn = (
  actionName: string,
  selectionName: string,
  player: number,
  currentArgs: Record<string, unknown>
) => Promise<{
  success: boolean;
  choices?: Array<{ value: unknown; display: string }>;
  error?: string;
}>;

/**
 * Inject the selection step function for repeating selections.
 * Returns undefined if not in a GameShell context (function is optional).
 *
 * @example
 * ```typescript
 * const stepFn = injectSelectionStepFn();
 * if (stepFn && selection.repeat) {
 *   const result = await stepFn(playerPosition, 'card', selectedValue, 'discard');
 *   if (result.done) {
 *     // Repeating selection complete
 *   } else {
 *     // result.nextChoices has the next available choices
 *   }
 * }
 * ```
 */
export function injectSelectionStepFn(): SelectionStepFn | undefined {
  return inject<SelectionStepFn | undefined>('selectionStepFn', undefined);
}

/**
 * Inject the deferred choices fetch function.
 * Returns undefined if not in a GameShell context (function is optional).
 *
 * @example
 * ```typescript
 * const fetchChoices = injectFetchDeferredChoicesFn();
 * if (fetchChoices && selection.deferred) {
 *   const result = await fetchChoices('move', 'destination', playerPosition, { piece: 5 });
 *   if (result.success) {
 *     // result.choices has the available choices
 *   }
 * }
 * ```
 */
export function injectFetchDeferredChoicesFn(): FetchDeferredChoicesFn | undefined {
  return inject<FetchDeferredChoicesFn | undefined>('fetchDeferredChoicesFn', undefined);
}

/**
 * Inject the board interaction controller for element highlighting.
 * Returns undefined if not in a GameShell context.
 *
 * @example
 * ```typescript
 * const boardInteraction = injectBoardInteraction();
 * if (boardInteraction) {
 *   // Highlight an element on the board
 *   boardInteraction.setHoveredChoice({
 *     value: choice.value,
 *     display: choice.display,
 *     sourceRefs: [{ id: 42 }],
 *     targetRefs: [],
 *   });
 * }
 * ```
 */
export function injectBoardInteraction(): unknown | undefined {
  return inject<unknown | undefined>('boardInteraction', undefined);
}

export default useActionController;
