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
 * // Full-featured controller with selection fetching and repeating selections
 * const controller = useActionController({
 *   sendAction,
 *   availableActions,
 *   actionMetadata,
 *   isMyTurn,
 *   playerPosition,
 *   fetchSelectionChoices: async (action, selection, player, args) => {
 *     const result = await fetch('/api/selection-choices', { ... });
 *     return result.json();
 *   },
 *   selectionStep: async (player, selection, value, action, args) => {
 *     const result = await fetch('/api/selection-step', { ... });
 *     return result.json();
 *   },
 * });
 * ```
 */

import { ref, computed, watch, inject } from 'vue';
import { isDevMode, devWarn, getDisplayFromValue, actionNeedsWizardMode } from './actionControllerHelpers.js';
import { createEnrichment } from './useGameViewEnrichment.js';

// Re-export all types from the types module for consumers
export type {
  GameViewElement,
  ElementRef,
  ChoiceWithRefs,
  ValidElement,
  SelectionMetadata,
  ActionMetadata,
  FollowUpAction,
  ActionResult,
  ValidationResult,
  SelectionStepResult,
  SelectionChoicesResult,
  SelectionSnapshot,
  CollectedSelection,
  ActionStateSnapshot,
  UseActionControllerOptions,
  RepeatingState,
  UseActionControllerReturn,
} from './useActionControllerTypes.js';

import type {
  ElementRef,
  ValidElement,
  SelectionMetadata,
  ActionMetadata,
  ActionResult,
  ValidationResult,
  SelectionSnapshot,
  CollectedSelection,
  ActionStateSnapshot,
  UseActionControllerOptions,
  RepeatingState,
  UseActionControllerReturn,
} from './useActionControllerTypes.js';

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
    gameView,
    playerPosition,
    autoFill: autoFillOption = true,
    autoExecute: autoExecuteOption = true,
    externalArgs,
    fetchSelectionChoices,
    selectionStep,
    onBeforeAutoExecute: initialBeforeAutoExecute,
  } = options;

  // Registered hooks (can be added after creation via registerBeforeAutoExecute)
  // Stored as ref to allow dynamic registration
  const beforeAutoExecuteHook = ref<((actionName: string, args: Record<string, unknown>) => void | Promise<void>) | undefined>(
    initialBeforeAutoExecute
  );

  // Helper to get current value of potentially reactive options
  const getAutoFill = (): boolean => {
    return typeof autoFillOption === 'boolean' ? autoFillOption : autoFillOption.value;
  };
  const getAutoExecute = (): boolean => {
    return typeof autoExecuteOption === 'boolean' ? autoExecuteOption : autoExecuteOption.value;
  };

  // === State ===
  const currentAction = ref<string | null>(null);

  // Args storage - uses externalArgs if provided (for custom UI sync), otherwise internal ref
  // Note: fill() updates both currentArgs AND collectedSelections (for display tracking)
  // Direct modifications to currentArgs work but lose display info - use fill() for proper display
  const internalArgs = ref<Record<string, unknown>>({});
  const currentArgs = computed({
    get: () => externalArgs ?? internalArgs.value,
    set: (val) => {
      if (externalArgs) {
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

  // Track pending followUp to prevent race condition with auto-start
  // When execute() returns with followUp, it clears currentAction but schedules
  // startFollowUp via setTimeout. During this window, external code might see
  // currentAction === null and try to start a new action, causing parallel actions.
  const pendingFollowUp = ref(false);

  // Selection choices loading state
  const isLoadingChoices = ref(false);

  // Repeating selections state
  const repeatingState = ref<RepeatingState | null>(null);

  // Pit of Success: Client-owned action state snapshot
  // When start() is called, we clone the metadata so we don't depend on server broadcasts
  // selectionSnapshots stores fetched choices - single source of truth
  const actionSnapshot = ref<ActionStateSnapshot | null>(null);

  // Flag to prevent double-fetch when startFollowUp/start already fetched choices
  // The currentSelection watcher would otherwise also trigger a fetch
  let suppressNextWatcherFetch = false;

  // Version counter for selection snapshots - increments when choices are fetched
  // This enables reactive computeds that depend on snapshot data (Maps aren't reactive)
  const snapshotVersion = ref(0);

  // === Element Enrichment ===
  // Creates functions to enrich validElements with full element data from gameView
  const { enrichElementsList, enrichValidElements } = createEnrichment(gameView, currentArgs);

  // === Helpers ===
  // Note: isDevMode, devWarn, getDisplayFromValue are imported from actionControllerHelpers.ts
  // Note: enrichElementsList, enrichValidElements are from useGameViewEnrichment.ts

  /** Clear all keys from the args object while preserving reactivity */
  function clearArgs(): void {
    const args = currentArgs.value;
    for (const key of Object.keys(args)) {
      delete args[key];
    }
  }

  /** Clear all selection state */
  function clearAdvancedState(): void {
    repeatingState.value = null;
    actionSnapshot.value = null;
  }

  function getActionMetadata(actionName: string): ActionMetadata | undefined {
    return actionMetadata.value?.[actionName];
  }

  /**
   * Find the display value for a selection value from snapshot.
   * Used to store display alongside value in collectedSelections.
   */
  function findDisplayForValue(selectionName: string, value: unknown): string {
    // Get from snapshot - single source of truth
    const snapshot = actionSnapshot.value?.selectionSnapshots.get(selectionName);

    if (snapshot?.choices) {
      const match = snapshot.choices.find(c =>
        c.value === value || JSON.stringify(c.value) === JSON.stringify(value)
      );
      if (match) return match.display;
    }

    if (snapshot?.validElements) {
      const match = snapshot.validElements.find(e =>
        e.id === value || e.id === Number(value)
      );
      if (match && match.display) return match.display;
    }

    // Fallback
    return String(value);
  }

  /**
   * Get available choices for a selection.
   * Priority: selectionSnapshots > static metadata (for execute() and tests)
   */
  function getChoices(selection: SelectionMetadata): Array<{ value: unknown; display: string }> {
    let choices: Array<{ value: unknown; display: string }> = [];

    // For repeating selections with dynamic choices from server
    if (selection.repeat && repeatingState.value?.selectionName === selection.name) {
      if (repeatingState.value.currentChoices) {
        choices = repeatingState.value.currentChoices;
      }
    }
    // Primary: Use selectionSnapshots (populated by fetchChoicesForSelection)
    else if (actionSnapshot.value) {
      const snapshot = actionSnapshot.value.selectionSnapshots.get(selection.name);

      if (snapshot) {
        if (snapshot.choices) {
          choices = snapshot.choices;
        } else if (snapshot.validElements) {
          choices = snapshot.validElements.map(el => ({
            value: el.id,
            display: el.display || `Element ${el.id}`,
          }));
        }
      }
    }

    // Fallback: Use static metadata choices (for execute() and tests without fetch)
    if (choices.length === 0) {
      // Handle dependsOn with choicesByDependentValue
      if (selection.dependsOn && selection.choicesByDependentValue) {
        const dependentValue = currentArgs.value[selection.dependsOn];
        if (dependentValue !== undefined) {
          const depKey = String(dependentValue);
          choices = selection.choicesByDependentValue[depKey] || [];
        }
      }
      // Handle dependsOn with elementsByDependentValue
      else if (selection.dependsOn && selection.elementsByDependentValue) {
        const dependentValue = currentArgs.value[selection.dependsOn];
        if (dependentValue !== undefined) {
          const depKey = String(dependentValue);
          const elements = selection.elementsByDependentValue[depKey] || [];
          choices = elements.map(el => ({
            value: el.id,
            display: el.display || `Element ${el.id}`,
          }));
        }
      }
      // Regular static choices
      else if (selection.choices) {
        choices = selection.choices;
      } else if (selection.validElements) {
        choices = selection.validElements.map(el => ({
          value: el.id,
          display: el.display || `Element ${el.id}`,
        }));
      }
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

  /** Get valid elements for an element/elements selection from snapshot */
  function getValidElements(selection: SelectionMetadata): ValidElement[] {
    if (!actionSnapshot.value) return [];
    if (selection.type !== 'element' && selection.type !== 'elements') return [];

    const snapshot = actionSnapshot.value.selectionSnapshots.get(selection.name);
    return snapshot?.validElements || [];
  }

  function selectionNeedsInput(selection: SelectionMetadata): boolean {
    const value = currentArgs.value[selection.name];
    return value === undefined;
  }

  /** Type guard for values that may have an id property */
  function hasId(obj: unknown): obj is { id: unknown } {
    return typeof obj === 'object' && obj !== null && 'id' in obj;
  }

  /** Type guard for values that may have a value property */
  function hasValue(obj: unknown): obj is { value: unknown } {
    return typeof obj === 'object' && obj !== null && 'value' in obj;
  }

  function validateSelection(selection: SelectionMetadata, value: unknown): ValidationResult {
    // For repeating selections, validation is done by the server
    if (selection.repeat) {
      return { valid: true };
    }

    // Check if value is in valid choices
    const choices = getChoices(selection);
    if (choices.length > 0) {
      // Helper to check if a single value matches any choice
      const valueMatchesChoice = (v: unknown): boolean => {
        return choices.some(c => {
          // Handle both direct match and value property match
          if (c.value === v) return true;
          if (typeof c.value === 'object' && c.value !== null) {
            return (hasValue(c.value) && c.value.value === v) ||
                   (hasId(c.value) && c.value.id === v);
          }
          return false;
        });
      };

      // Handle arrays (multiSelect) - check each element is valid
      if (Array.isArray(value)) {
        const allValid = value.every(v => valueMatchesChoice(v));
        if (!allValid) {
          return { valid: false, error: `Invalid selection for "${selection.name}"` };
        }
      } else {
        // Single value
        if (!valueMatchesChoice(value)) {
          // PIT OF SUCCESS: Check if they passed an object with a .value that would have matched
          // This helps catch cases where auto-unwrap didn't trigger (e.g., object has value but not display)
          if (hasValue(value) && valueMatchesChoice((value as { value: unknown }).value)) {
            return {
              valid: false,
              error: `Invalid selection for "${selection.name}". Did you mean to pass choice.value (${JSON.stringify((value as { value: unknown }).value)}) instead of the choice object?`
            };
          }
          return { valid: false, error: `Invalid selection for "${selection.name}"` };
        }
      }
    }
    return { valid: true };
  }

  /**
   * Build args for server requests from the controller's source of truth.
   * This prevents pollution from external code writing to the shared externalArgs.
   * Only includes args that the controller explicitly set via fill/startFollowUp.
   */
  function buildServerArgs(): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    // Use collectedSelections as the source of truth
    if (actionSnapshot.value) {
      for (const [name, collected] of actionSnapshot.value.collectedSelections) {
        args[name] = collected.value;
      }
    }

    // Development warning: detect when externalArgs has been polluted by external code
    if (externalArgs && actionSnapshot.value) {
      const controllerKeys = new Set(actionSnapshot.value.collectedSelections.keys());
      const externalKeys = Object.keys(externalArgs);
      const unknownKeys = externalKeys.filter(k => !controllerKeys.has(k));

      if (unknownKeys.length > 0) {
        devWarn(
          `externalArgs-pollution:${currentAction.value}`,
          `Detected unexpected keys in actionArgs during '${currentAction.value}': ${unknownKeys.join(', ')}\n` +
          `  These were NOT set by the action controller (start/fill/startFollowUp).\n` +
          `  This usually means your custom UI is writing to actionArgs in a watcher/computed.\n` +
          `  The controller ignores these to prevent bugs - use actionController.fill() instead.\n` +
          `  Controller knows: ${[...controllerKeys].join(', ') || '(none)'}`
        );
      }
    }

    return args;
  }

  /**
   * Fetch choices for a selection from the server.
   */
  async function fetchChoicesForSelection(selectionName: string): Promise<void> {
    if (!fetchSelectionChoices) {
      return;
    }
    if (!currentAction.value) {
      return;
    }

    // Get selection metadata - check snapshot first (for followUp actions), then live metadata
    let meta: ActionMetadata | undefined;
    if (actionSnapshot.value?.actionName === currentAction.value) {
      meta = actionSnapshot.value.metadata;
    } else {
      meta = getActionMetadata(currentAction.value);
    }

    const selection = meta?.selections.find(s => s.name === selectionName);
    if (!selection) {
      console.warn(`[ActionController] fetchChoicesForSelection: selection "${selectionName}" not found in metadata`);
      return;
    }

    // Skip fetch for number/text selections - they don't have choices
    if (selection.type === 'number' || selection.type === 'text') {
      return;
    }

    const player = playerPosition?.value ?? 0;

    isLoadingChoices.value = true;
    const fetchStartTime = Date.now();
    try {

      // Use controller's source of truth for args, not the shared externalArgs
      // This prevents pollution from custom UI code writing to the shared args object
      const result = await fetchSelectionChoices(
        currentAction.value,
        selectionName,
        player,
        buildServerArgs()
      );

      const fetchDuration = Date.now() - fetchStartTime;

      if (result.success && actionSnapshot.value) {
        // Store in snapshot - this is the single source of truth
        actionSnapshot.value.selectionSnapshots.set(selectionName, {
          choices: result.choices as SelectionSnapshot['choices'],
          validElements: result.validElements,
          multiSelect: result.multiSelect,
        });
        // Increment version to trigger reactive computeds (Maps aren't reactive)
        snapshotVersion.value++;
      } else if (!result.success) {
        console.error(`[BoardSmith] Failed to fetch selection choices for '${selectionName}' after ${fetchDuration}ms:`, result.error);
      }
    } catch (err) {
      const fetchDuration = Date.now() - fetchStartTime;
      console.error(
        `[BoardSmith] Error fetching selection choices for '${selectionName}' after ${fetchDuration}ms:`,
        err
      );
    } finally {
      isLoadingChoices.value = false;
    }
  }

  // === Computed ===

  const currentActionMeta = computed((): ActionMetadata | undefined => {
    if (!currentAction.value) return undefined;

    // PIT OF SUCCESS: Use snapshot metadata when available
    // This ensures we don't lose metadata when server broadcasts update
    // (e.g., when onEach modifies game state and action disappears from availableActions)
    if (actionSnapshot.value?.actionName === currentAction.value) {
      return actionSnapshot.value.metadata;
    }

    // Fallback to live metadata (e.g., for execute() which doesn't use snapshot)
    return getActionMetadata(currentAction.value);
  });

  const currentSelection = computed((): SelectionMetadata | null => {
    if (!currentActionMeta.value) return null;

    // Find first selection that needs input
    for (const sel of currentActionMeta.value.selections) {
      if (selectionNeedsInput(sel) && !sel.optional) {
        return enrichValidElements(sel);
      }
    }

    // Then check optional selections
    for (const sel of currentActionMeta.value.selections) {
      if (selectionNeedsInput(sel) && sel.optional) {
        return enrichValidElements(sel);
      }
    }

    return null;
  });

  const isReady = computed((): boolean => {
    if (!currentActionMeta.value) return false;
    return currentSelection.value === null;
  });

  /**
   * Reactive valid elements for the current selection.
   * This is the "pit of success" for custom UIs - just use this computed directly.
   * It automatically updates when:
   * - currentSelection changes
   * - choices are fetched from server
   * - gameView updates (elements are enriched with full data)
   */
  const validElements = computed((): ValidElement[] => {
    // Depend on snapshotVersion to re-run when choices are fetched
    // (Maps aren't reactive, so we use this counter to trigger updates)
    const _version = snapshotVersion.value;

    const sel = currentSelection.value;
    if (!sel) return [];
    if (sel.type !== 'element' && sel.type !== 'elements') return [];

    // Get from snapshot (populated by fetchChoicesForSelection)
    const snapshot = actionSnapshot.value?.selectionSnapshots.get(sel.name);
    const elements = snapshot?.validElements || [];

    // Enrich with full element data from gameView
    return enrichElementsList(elements);
  });

  // === Auto-fill Watch ===
  // When a selection changes, fetch choices if needed and auto-fill if only one choice
  // Also applies prefills when a selection becomes active
  watch(currentSelection, async (sel) => {
    if (!sel || isExecuting.value) return;

    // Skip fetch if start/startFollowUp already handled it (prevents double-fetch)
    // But still continue to handle prefills and auto-fill below
    const shouldSkipFetch = suppressNextWatcherFetch;
    if (shouldSkipFetch) {
      suppressNextWatcherFetch = false;
    }

    // Fetch choices if not in snapshot yet (handles case where board sets args directly)
    if (!shouldSkipFetch) {
      const snapshot = actionSnapshot.value?.selectionSnapshots.get(sel.name);
      if (!snapshot && (sel.type === 'choice' || sel.type === 'element' || sel.type === 'elements')) {
        await fetchChoicesForSelection(sel.name);
      }
    }

    // Check for prefill first - takes priority over auto-fill
    const prefillValue = actionSnapshot.value?.prefills.get(sel.name);
    if (prefillValue !== undefined) {
      // Validate prefill value against available choices
      const choices = getChoices(sel);
      const validChoice = choices.find(c => {
        if (c.value === prefillValue) return true;
        if (typeof c.value === 'object' && c.value !== null) {
          return (c.value as Record<string, unknown>).id === prefillValue;
        }
        // For element selections, compare IDs directly
        if (sel.type === 'element' || sel.type === 'elements') {
          return c.value === prefillValue;
        }
        return false;
      });

      if (validChoice) {
        // Apply prefill
        currentArgs.value[sel.name] = validChoice.value;

        // Update collectedSelections
        if (actionSnapshot.value) {
          actionSnapshot.value.collectedSelections.set(sel.name, {
            value: validChoice.value,
            display: validChoice.display,
            skipped: false,
          });
          // Remove from prefills - it's been applied
          actionSnapshot.value.prefills.delete(sel.name);
        }
        return; // Don't do auto-fill, prefill was applied
      }
      // Prefill value not valid - remove it and continue to auto-fill
      actionSnapshot.value?.prefills.delete(sel.name);
    }

    // Now attempt auto-fill if enabled
    // Don't auto-fill optional selections - user must consciously choose or skip
    if (getAutoFill()) {
      const choices = getChoices(sel);
      if (choices.length === 1 && !sel.optional) {
        // Auto-fill
        const choice = choices[0];
        currentArgs.value[sel.name] = choice.value;

        // Also update collectedSelections so UI reflects the selection
        if (actionSnapshot.value) {
          actionSnapshot.value.collectedSelections.set(sel.name, {
            value: choice.value,
            display: choice.display,
            skipped: false,
          });
        }
      }
    }
  }, { immediate: true });

  // === Auto-execute Watch ===
  // When all selections are filled, auto-execute
  watch(isReady, async (ready) => {
    if (ready && getAutoExecute() && currentAction.value && !isExecuting.value) {
      // Call hook before executing - allows capturing element positions for animations
      if (beforeAutoExecuteHook.value) {
        await beforeAutoExecuteHook.value(currentAction.value, { ...currentArgs.value });
      }
      executeCurrentAction();
    }
  });

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
  function registerBeforeAutoExecute(
    hook: (actionName: string, args: Record<string, unknown>) => void | Promise<void>
  ): void {
    beforeAutoExecuteHook.value = hook;
  }

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

      // IMPORTANT: Set pendingFollowUp BEFORE clearing currentAction to prevent race condition.
      // Without this, external code (like ActionPanel's tryAutoStartSingleAction) might see
      // currentAction === null and start a new action before the followUp runs.
      if (result.success && result.followUp) {
        pendingFollowUp.value = true;
      }

      // Clear state on success or failure
      currentAction.value = null;
      clearArgs();
      clearAdvancedState();

      // Handle followUp: automatically start the next action if specified
      if (result.success && result.followUp) {
        const { action: followUpAction, args: followUpArgs, metadata: followUpMetadata, display: followUpDisplay } = result.followUp;
        // Use setTimeout to ensure state updates are flushed before starting next action
        setTimeout(async () => {
          try {
            await startFollowUp(followUpAction, followUpArgs ?? {}, followUpMetadata, followUpDisplay);
          } finally {
            pendingFollowUp.value = false;
          }
        }, 0);
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

  async function execute(actionName: string, args: Record<string, unknown> = {}): Promise<ActionResult> {
    if (!isMyTurn.value) {
      return { success: false, error: 'Not your turn' };
    }

    if (!availableActions.value.includes(actionName)) {
      return { success: false, error: `Action "${actionName}" is not available` };
    }

    const meta = getActionMetadata(actionName);

    // Check if action needs wizard mode but execute() was called without required args
    if (meta) {
      const wizardCheck = actionNeedsWizardMode(meta, args);
      if (wizardCheck.needed) {
        devWarn(
          `execute-needs-wizard:${actionName}`,
          `Action "${actionName}" called with execute() but may need wizard mode.\n` +
            `  Reason: ${wizardCheck.reason}\n` +
            `  Consider using actionController.start('${actionName}') instead, which:\n` +
            `  - Fetches valid choices from the server\n` +
            `  - Enables element selection on the game board\n` +
            `  - Handles dependent selections automatically\n` +
            `  If you have all values, pass them: execute('${actionName}', { ${wizardCheck.selectionName}: value })`
        );
      }
    }

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
        // Try auto-fill (but not for optional selections - user must consciously choose or skip)
        if (getAutoFill()) {
          const choices = getChoices(selection);
          if (choices.length === 1 && !selection.optional) {
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
        // Skip client-side validation for filterBy/dependsOn selections when using
        // direct execute() - the server will validate. This is needed because
        // getChoices() relies on currentArgs which isn't populated in execute().
        if (selection.filterBy || selection.dependsOn) {
          continue;
        }

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

      // Handle followUp: automatically start the next action if specified
      if (result.success && result.followUp) {
        pendingFollowUp.value = true;
        const { action: followUpAction, args: followUpArgs, metadata: followUpMetadata, display: followUpDisplay } = result.followUp;
        // Use setTimeout to ensure state updates are flushed before starting next action
        setTimeout(async () => {
          try {
            await startFollowUp(followUpAction, followUpArgs ?? {}, followUpMetadata, followUpDisplay);
          } finally {
            pendingFollowUp.value = false;
          }
        }, 0);
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

  /**
   * Start a follow-up action (bypasses availability check).
   * Used internally when chaining actions via followUp - the server already validated this chain.
   * @param actionName The action to start
   * @param initialArgs Pre-filled arguments for the action
   * @param providedMetadata Optional metadata from the server (for actions not in availableActions)
   * @param displayOverrides Optional display strings for args (use instead of { id, name } objects)
   */
  async function startFollowUp(
    actionName: string,
    initialArgs: Record<string, unknown> = {},
    providedMetadata?: ActionMetadata,
    displayOverrides?: Record<string, string>
  ): Promise<void> {
    // Use provided metadata first, then fall back to looking up from actionMetadata
    const meta = providedMetadata ?? getActionMetadata(actionName);

    if (!meta) {
      console.warn(`[ActionController] No metadata for followUp action "${actionName}" - action may not have selections`);
    }

    currentAction.value = actionName;
    clearArgs();
    clearAdvancedState();
    Object.assign(currentArgs.value, initialArgs);
    lastError.value = null;

    // PIT OF SUCCESS: Create snapshot - FREEZE the metadata
    actionSnapshot.value = {
      actionName,
      metadata: meta ? JSON.parse(JSON.stringify(meta)) : { name: actionName, selections: [] },
      selectionSnapshots: new Map(),
      collectedSelections: new Map(),
      repeatingState: null,
      prefills: new Map(),
    };

    // Store display values for any initialArgs
    // Use displayOverrides if provided (cleaner API), otherwise extract from value
    for (const [name, value] of Object.entries(initialArgs)) {
      // Warn if a plain number is used without a display override
      if (typeof value === 'number' && !displayOverrides?.[name]) {
        devWarn(
          `followUp-plain-number:${actionName}:${name}`,
          `followUp arg "${name}" is a plain number (${value}).\n` +
          `  This displays as "${value}" in the action panel, which may not be user-friendly.\n` +
          `  Consider using the display option:\n` +
          `    followUp: {\n` +
          `      action: '${actionName}',\n` +
          `      args: { ${name}: ${value} },\n` +
          `      display: { ${name}: 'Human-readable name' },\n` +
          `    }\n` +
          `  Or pass an object with a name property:\n` +
          `    args: { ${name}: { id: ${value}, name: 'Human-readable name' } }`
        );
      }

      actionSnapshot.value.collectedSelections.set(name, {
        value,
        display: displayOverrides?.[name] ?? getDisplayFromValue(value),
        skipped: false,
      });
    }

    // If we have metadata with selections, fetch choices for the first unfilled selection
    if (meta && meta.selections.length > 0) {
      let selectionToFetch: SelectionMetadata | undefined;
      for (const sel of meta.selections) {
        if (initialArgs[sel.name] === undefined) {
          selectionToFetch = sel;
          break;
        }
      }

      if (selectionToFetch && (selectionToFetch.type === 'choice' || selectionToFetch.type === 'element' || selectionToFetch.type === 'elements')) {
        // Prevent the watcher from also fetching (would cause double-fetch)
        suppressNextWatcherFetch = true;
        await fetchChoicesForSelection(selectionToFetch.name);

        // After fetching, check for auto-fill (but not for optional selections)
        if (getAutoFill() && !isExecuting.value) {
          const choices = getChoices(selectionToFetch);
          if (choices.length === 1 && !selectionToFetch.optional) {
            const choice = choices[0];
            currentArgs.value[selectionToFetch.name] = choice.value;

            if (actionSnapshot.value) {
              actionSnapshot.value.collectedSelections.set(selectionToFetch.name, {
                value: choice.value,
                display: choice.display,
                skipped: false,
              });
            }

            // Fetch next selection if needed
            const nextSel = getNextSelection(selectionToFetch.name);
            if (nextSel && (nextSel.type === 'choice' || nextSel.type === 'element' || nextSel.type === 'elements')) {
              await fetchChoicesForSelection(nextSel.name);

              // Don't auto-fill optional selections - user must consciously choose or skip
              if (getAutoFill() && !isExecuting.value) {
                const nextChoices = getChoices(nextSel);
                if (nextChoices.length === 1 && !nextSel.optional) {
                  currentArgs.value[nextSel.name] = nextChoices[0].value;
                  if (actionSnapshot.value) {
                    actionSnapshot.value.collectedSelections.set(nextSel.name, {
                      value: nextChoices[0].value,
                      display: nextChoices[0].display,
                      skipped: false,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

  }

  async function start(
    actionName: string,
    startOptions?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> } | Record<string, unknown>
  ): Promise<void> {
    // Support both old signature (initialArgs object) and new signature (options with args/prefill)
    let initialArgs: Record<string, unknown> = {};
    let prefillArgs: Record<string, unknown> = {};

    if (startOptions) {
      if ('args' in startOptions || 'prefill' in startOptions) {
        // New signature: { args?, prefill? }
        initialArgs = (startOptions as { args?: Record<string, unknown> }).args ?? {};
        prefillArgs = (startOptions as { prefill?: Record<string, unknown> }).prefill ?? {};
      } else {
        // Old signature: plain args object (backward compatible)
        initialArgs = startOptions as Record<string, unknown>;
      }
    }

    if (!availableActions.value.includes(actionName)) {
      lastError.value = `Action "${actionName}" is not available`;
      return;
    }

    // Get metadata (only needed at start time)
    const meta = getActionMetadata(actionName);
    if (!meta) {
      lastError.value = `No metadata for action "${actionName}"`;
      return;
    }

    currentAction.value = actionName;
    clearArgs();
    clearAdvancedState();
    Object.assign(currentArgs.value, initialArgs);
    lastError.value = null;

    // PIT OF SUCCESS: Create snapshot - FREEZE the metadata
    // Client now owns this metadata and doesn't depend on server broadcasts
    actionSnapshot.value = {
      actionName,
      metadata: JSON.parse(JSON.stringify(meta)), // Deep clone
      selectionSnapshots: new Map(),
      collectedSelections: new Map(),
      repeatingState: null,
      prefills: new Map(Object.entries(prefillArgs)),
    };

    // Store display values for any initialArgs
    for (const [name, value] of Object.entries(initialArgs)) {
      actionSnapshot.value.collectedSelections.set(name, {
        value,
        display: getDisplayFromValue(value),
        skipped: false,
      });
    }

    // Fetch choices for the first selection that needs input
    // This handles both normal start (first selection) and followUp with pre-filled args
    // (where we need to fetch choices for the next unfilled selection)
    if (meta.selections.length > 0) {
      // Find first selection that needs input (wasn't pre-filled)
      let selectionToFetch: SelectionMetadata | undefined;
      for (const sel of meta.selections) {
        if (initialArgs[sel.name] === undefined) {
          selectionToFetch = sel;
          break;
        }
      }

      // Fetch choices for the selection that actually needs input
      if (selectionToFetch && (selectionToFetch.type === 'choice' || selectionToFetch.type === 'element' || selectionToFetch.type === 'elements')) {
        // Prevent the watcher from also fetching (would cause double-fetch)
        suppressNextWatcherFetch = true;
        await fetchChoicesForSelection(selectionToFetch.name);

        // After fetching, manually trigger auto-fill if there's exactly one choice
        // The watch may have fired before choices were fetched, so we need to check again
        // Don't auto-fill optional selections - user must consciously choose or skip
        if (getAutoFill() && !isExecuting.value) {
          const choices = getChoices(selectionToFetch);
          if (choices.length === 1 && !selectionToFetch.optional) {
            const choice = choices[0];
            currentArgs.value[selectionToFetch.name] = choice.value;

            // Store in snapshot
            if (actionSnapshot.value) {
              actionSnapshot.value.collectedSelections.set(selectionToFetch.name, {
                value: choice.value,
                display: choice.display,
                skipped: false,
              });
            }

            // Recursively fetch and auto-fill the next selection if needed
            const nextSel = getNextSelection(selectionToFetch.name);
            if (nextSel && (nextSel.type === 'choice' || nextSel.type === 'element' || nextSel.type === 'elements')) {
              await fetchChoicesForSelection(nextSel.name);

              // Check for auto-fill on the next selection too
              // Don't auto-fill optional selections - user must consciously choose or skip
              if (getAutoFill() && !isExecuting.value) {
                const nextChoices = getChoices(nextSel);
                if (nextChoices.length === 1 && !nextSel.optional) {
                  currentArgs.value[nextSel.name] = nextChoices[0].value;
                  if (actionSnapshot.value) {
                    actionSnapshot.value.collectedSelections.set(nextSel.name, {
                      value: nextChoices[0].value,
                      display: nextChoices[0].display,
                      skipped: false,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  async function fill(selectionName: string, rawValue: unknown): Promise<ValidationResult> {
    if (!currentActionMeta.value) {
      return { valid: false, error: 'No action in progress' };
    }

    const selection = currentActionMeta.value.selections.find(s => s.name === selectionName);
    if (!selection) {
      return { valid: false, error: `Unknown selection: "${selectionName}"` };
    }

    // PIT OF SUCCESS: Auto-unwrap choice objects from getChoices()
    // Developers often pass the whole { value, display } object instead of just the value
    let value = rawValue;
    if (typeof rawValue === 'object' && rawValue !== null && 'value' in rawValue && 'display' in rawValue) {
      devWarn(
        `fill-choice-object-${selectionName}`,
        `fill('${selectionName}', ...) received a choice object { value, display }. ` +
        `Automatically unwrapping to use choice.value. ` +
        `Consider passing choice.value directly for clarity.`
      );
      value = (rawValue as { value: unknown }).value;
    }

    // Handle repeating selections
    if (selection.repeat) {
      return await handleRepeatingFill(selection, value);
    }

    // Normal fill
    const validation = validateSelection(selection, value);
    if (validation.valid) {
      currentArgs.value[selectionName] = value;

      // PIT OF SUCCESS: Store value+display together in snapshot
      // Single source of truth for display values
      if (actionSnapshot.value) {
        const display = findDisplayForValue(selectionName, value);
        actionSnapshot.value.collectedSelections.set(selectionName, {
          value,
          display,
          skipped: false,
        });
      }

      // Always fetch choices for the next selection (unless it's number/text)
      const nextSel = getNextSelection(selectionName);
      if (nextSel && (nextSel.type === 'choice' || nextSel.type === 'element' || nextSel.type === 'elements')) {
        await fetchChoicesForSelection(nextSel.name);

        // After fetch, check for auto-fill on the next selection
        // (the watch may have fired before cache was populated)
        // Don't auto-fill optional selections - user must consciously choose or skip
        if (getAutoFill() && !isExecuting.value) {
          const choices = getChoices(nextSel);
          if (choices.length === 1 && !nextSel.optional) {
            const autoValue = choices[0].value;
            currentArgs.value[nextSel.name] = autoValue;

            // Also store auto-filled value in snapshot
            if (actionSnapshot.value) {
              actionSnapshot.value.collectedSelections.set(nextSel.name, {
                value: autoValue,
                display: choices[0].display,
                skipped: false,
              });
            }
          }
        }
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

    // Find display value from current choices
    const choices = repeatingState.value.currentChoices || selection.choices || [];
    const matchedChoice = choices.find(c => c.value === value || JSON.stringify(c.value) === JSON.stringify(value));
    const display = matchedChoice?.display || String(value);

    // Add to accumulated with display
    repeatingState.value.accumulated.push({ value, display });
    repeatingState.value.awaitingServer = true;

    try {
      const result = await selectionStep(
        player,
        selection.name,
        value,
        currentAction.value,
        { ...currentArgs.value }
      );

      // Guard: repeatingState may have been cleared by startFollowUp during the await
      if (!repeatingState.value) {
        // State was cleared (e.g., by followUp) - just return success
        return { valid: true };
      }

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
        // Move accumulated values to args (server expects raw values, not {value, display} objects)
        currentArgs.value[selection.name] = repeatingState.value.accumulated.map(a => a.value);
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

      // Store skipped state in snapshot
      if (actionSnapshot.value) {
        actionSnapshot.value.collectedSelections.set(selectionName, {
          value: null,
          display: '',
          skipped: true,
        });
      }
    }
  }

  function clear(selectionName: string): void {
    delete currentArgs.value[selectionName];

    // Remove from snapshot
    if (actionSnapshot.value) {
      actionSnapshot.value.collectedSelections.delete(selectionName);
    }
  }

  function cancel(): void {
    currentAction.value = null;
    clearArgs();
    clearAdvancedState();
    lastError.value = null;
  }

  // === Public API for Snapshot Access ===

  /**
   * Get a collected selection by name (value + display).
   * Returns undefined if selection hasn't been filled yet.
   *
   * @example
   * ```typescript
   * // Get the display for a filled selection
   * const merc = actionController.getCollectedSelection('merc');
   * if (merc) {
   *   console.log(`Selected: ${merc.display}`); // "Selected: John Smith"
   * }
   * ```
   */
  function getCollectedSelection(name: string): CollectedSelection | undefined {
    return actionSnapshot.value?.collectedSelections.get(name);
  }

  /**
   * Get all collected selections with their names.
   * Useful for displaying what's been selected so far.
   *
   * @example
   * ```typescript
   * // Build a summary of selections
   * const selections = actionController.getCollectedSelections();
   * const summary = selections
   *   .filter(s => !s.skipped)
   *   .map(s => `${s.name}: ${s.display}`)
   *   .join(', ');
   * ```
   */
  function getCollectedSelections(): Array<CollectedSelection & { name: string }> {
    if (!actionSnapshot.value) return [];

    const result: Array<CollectedSelection & { name: string }> = [];
    for (const [name, collected] of actionSnapshot.value.collectedSelections) {
      result.push({ name, ...collected });
    }
    return result;
  }

  return {
    // State
    currentAction,
    currentArgs,
    currentSelection,
    validElements,  // Reactive! Use this in custom UIs
    isReady,
    isExecuting,
    lastError,
    isLoadingChoices,
    repeatingState,
    pendingFollowUp,  // Use to prevent starting new actions during followUp transition

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
    getValidElements,  // Non-reactive, prefer validElements computed
    getActionMetadata,
    clearArgs,
    fetchChoicesForSelection,

    // Snapshot API (Pit of Success)
    actionSnapshot,  // Readonly access to frozen action state (for followUp metadata)
    getCollectedSelection,
    getCollectedSelections,

    // Hook registration (for GameShell users who can't pass options at creation)
    registerBeforeAutoExecute,
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
