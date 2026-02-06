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
 * // currentPick.value now shows first pick needed
 *
 * actionController.fill('attacker', 1);
 * // currentPick.value now shows next pick
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
 *   playerSeat,
 *   fetchPickChoices: async (action, selection, player, args) => {
 *     const result = await fetch('/api/pick-choices', { ... });
 *     return result.json();
 *   },
 *   pickStep: async (player, selection, value, action, args) => {
 *     const result = await fetch('/api/pick-step', { ... });
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
  PickMetadata,
  PickStepResult,
  PickChoicesResult,
  PickSnapshot,
  CollectedPick,
  ActionMetadata,
  FollowUpAction,
  ActionResult,
  ValidationResult,
  ActionStateSnapshot,
  UseActionControllerOptions,
  RepeatingState,
  UseActionControllerReturn,
} from './useActionControllerTypes.js';

import type {
  ElementRef,
  ValidElement,
  PickMetadata,
  PickSnapshot,
  CollectedPick,
  ActionMetadata,
  ActionResult,
  ValidationResult,
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
    playerSeat,
    autoFill: autoFillOption = true,
    autoExecute: autoExecuteOption = true,
    externalArgs,
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
  // Note: fill() updates both currentArgs AND collectedPicks (for display tracking)
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
  // pickSnapshots stores fetched choices - single source of truth
  const actionSnapshot = ref<ActionStateSnapshot | null>(null);


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
   * Used to store display alongside value in collectedPicks.
   */
  function findDisplayForValue(selectionName: string, value: unknown): string {
    // Get from snapshot - single source of truth
    const snapshot = actionSnapshot.value?.pickSnapshots.get(selectionName);

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
   * Get available choices for a pick.
   * Priority: pickSnapshots > static metadata (for execute() and tests)
   */
  function getChoices(selection: PickMetadata): Array<{ value: unknown; display: string; disabled?: string }> {
    let choices: Array<{ value: unknown; display: string; disabled?: string }> = [];

    // For repeating selections with dynamic choices from server
    if (selection.repeat && repeatingState.value?.selectionName === selection.name) {
      if (repeatingState.value.currentChoices) {
        choices = repeatingState.value.currentChoices;
      }
    }
    // Primary: Use pickSnapshots (populated by fetchChoicesForPick)
    else if (actionSnapshot.value) {
      const snapshot = actionSnapshot.value.pickSnapshots.get(selection.name);

      if (snapshot) {
        if (snapshot.choices) {
          choices = snapshot.choices;
        } else if (snapshot.validElements) {
          choices = snapshot.validElements.map(el => ({
            value: el.id,
            display: el.display || `Element ${el.id}`,
            ...(el.disabled && { disabled: el.disabled }),
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
            ...(el.disabled && { disabled: el.disabled }),
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
          ...(el.disabled && { disabled: el.disabled }),
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

  /** Get choices for the current pick (convenience method) */
  function getCurrentChoices(): Array<{ value: unknown; display: string; disabled?: string }> {
    const sel = currentPick.value;
    if (!sel) return [];
    return getChoices(sel);
  }

  /** Get valid elements for an element/elements pick from snapshot */
  function getValidElements(selection: PickMetadata): ValidElement[] {
    if (!actionSnapshot.value) return [];
    if (selection.type !== 'element' && selection.type !== 'elements') return [];

    const snapshot = actionSnapshot.value.pickSnapshots.get(selection.name);
    return snapshot?.validElements || [];
  }

  function selectionNeedsInput(selection: PickMetadata): boolean {
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

  function validateSelection(selection: PickMetadata, value: unknown): ValidationResult {
    // For repeating selections, validation is done by the server
    if (selection.repeat) {
      return { valid: true };
    }

    // Check if value is in valid choices
    const choices = getChoices(selection);
    if (choices.length > 0) {
      // Helper to find the matching choice for a single value
      const findMatchingChoice = (v: unknown) => {
        return choices.find(c => {
          // Handle both direct match and value property match
          if (c.value === v) return true;
          if (typeof c.value === 'object' && c.value !== null) {
            return (hasValue(c.value) && c.value.value === v) ||
                   (hasId(c.value) && c.value.id === v);
          }
          return false;
        });
      };

      // Handle arrays (multiSelect) - check each element is valid and not disabled
      if (Array.isArray(value)) {
        for (const v of value) {
          const matched = findMatchingChoice(v);
          if (matched && matched.disabled) {
            return { valid: false, error: `Selection disabled: ${matched.disabled}` };
          }
          if (!matched) {
            return { valid: false, error: `Invalid selection for "${selection.name}"` };
          }
        }
      } else {
        // Single value - check disabled BEFORE containment for specific error message
        const matchedChoice = findMatchingChoice(value);
        if (matchedChoice && matchedChoice.disabled) {
          return { valid: false, error: `Selection disabled: ${matchedChoice.disabled}` };
        }
        if (!matchedChoice) {
          // PIT OF SUCCESS: Check if they passed an object with a .value that would have matched
          // This helps catch cases where auto-unwrap didn't trigger (e.g., object has value but not display)
          if (hasValue(value) && findMatchingChoice((value as { value: unknown }).value)) {
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

    // Use collectedPicks as the source of truth
    if (actionSnapshot.value) {
      for (const [name, collected] of actionSnapshot.value.collectedPicks) {
        args[name] = collected.value;
      }
    }

    // Development warning: detect when externalArgs has been polluted by external code
    if (externalArgs && actionSnapshot.value) {
      const controllerKeys = new Set(actionSnapshot.value.collectedPicks.keys());
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
   * Attempt to auto-fill a selection if it has exactly one non-optional choice.
   * Updates both currentArgs and collectedPicks in actionSnapshot.
   *
   * @param selection - The selection metadata to check for auto-fill
   * @returns true if auto-fill was applied, false otherwise
   */
  function tryAutoFillSelection(selection: PickMetadata): boolean {
    if (!getAutoFill() || isExecuting.value) return false;

    const choices = getChoices(selection);
    const enabledChoices = choices.filter(c => !c.disabled);
    if (enabledChoices.length !== 1 || selection.optional) return false;

    const choice = enabledChoices[0];
    currentArgs.value[selection.name] = choice.value;

    if (actionSnapshot.value) {
      actionSnapshot.value.collectedPicks.set(selection.name, {
        value: choice.value,
        display: choice.display,
        skipped: false,
      });
    }

    return true;
  }

  /**
   * Fetch choices for a selection and attempt auto-fill.
   * Recursively handles next selection if current is auto-filled.
   *
   * @param selection - The selection to fetch and potentially auto-fill
   */
  async function fetchAndAutoFill(selection: PickMetadata): Promise<void> {
    // Only fetch for types that have choices
    if (selection.type !== 'choice' && selection.type !== 'element' && selection.type !== 'elements') {
      return;
    }

    // Mark as fetched BEFORE the await to prevent the watcher from racing ahead
    actionSnapshot.value?.fetchedSelections.add(selection.name);
    await fetchChoicesForPick(selection.name);

    if (tryAutoFillSelection(selection)) {
      // Recursively handle next selection
      const nextSel = getNextSelection(selection.name);
      if (nextSel) {
        await fetchAndAutoFill(nextSel);
      }
    }
  }

  /**
   * Fetch choices for a pick from the server.
   */
  async function fetchChoicesForPick(selectionName: string): Promise<void> {
    const fetchFn = options.fetchPickChoices;
    if (!fetchFn) {
      return;
    }
    if (!currentAction.value) {
      return;
    }

    // Get pick metadata - check snapshot first (for followUp actions), then live metadata
    let meta: ActionMetadata | undefined;
    if (actionSnapshot.value?.actionName === currentAction.value) {
      meta = actionSnapshot.value.metadata;
    } else {
      meta = getActionMetadata(currentAction.value);
    }

    const selection = meta?.selections.find(s => s.name === selectionName);
    if (!selection) {
      console.warn(`[ActionController] fetchChoicesForPick: pick "${selectionName}" not found in metadata`);
      return;
    }

    // Skip fetch for number/text picks - they don't have choices
    if (selection.type === 'number' || selection.type === 'text') {
      return;
    }

    const player = playerSeat?.value ?? 0;

    isLoadingChoices.value = true;
    const fetchStartTime = Date.now();
    try {

      // Use controller's source of truth for args, not the shared externalArgs
      // This prevents pollution from custom UI code writing to the shared args object
      const result = await fetchFn(
        currentAction.value,
        selectionName,
        player,
        buildServerArgs()
      );

      const fetchDuration = Date.now() - fetchStartTime;

      if (result.success && actionSnapshot.value) {
        // Store in snapshot - this is the single source of truth
        actionSnapshot.value.pickSnapshots.set(selectionName, {
          choices: result.choices as PickSnapshot['choices'],
          validElements: result.validElements,
          multiSelect: result.multiSelect,
        });
        // Increment version to trigger reactive computeds (Maps aren't reactive)
        snapshotVersion.value++;
      } else if (!result.success) {
        console.error(`[BoardSmith] Failed to fetch pick choices for '${selectionName}' after ${fetchDuration}ms:`, result.error);
      }
    } catch (err) {
      const fetchDuration = Date.now() - fetchStartTime;
      console.error(
        `[BoardSmith] Error fetching pick choices for '${selectionName}' after ${fetchDuration}ms:`,
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

  const currentPick = computed((): PickMetadata | null => {
    if (!currentActionMeta.value) return null;

    // Find first pick that needs input
    for (const sel of currentActionMeta.value.selections) {
      if (selectionNeedsInput(sel) && !sel.optional) {
        return enrichValidElements(sel);
      }
    }

    // Then check optional picks
    for (const sel of currentActionMeta.value.selections) {
      if (selectionNeedsInput(sel) && sel.optional) {
        return enrichValidElements(sel);
      }
    }

    return null;
  });

  const isReady = computed((): boolean => {
    if (!currentActionMeta.value) return false;
    return currentPick.value === null;
  });

  /**
   * Reactive valid elements for the current pick.
   * This is the "pit of success" for custom UIs - just use this computed directly.
   * It automatically updates when:
   * - currentPick changes
   * - choices are fetched from server
   * - gameView updates (elements are enriched with full data)
   */
  const validElements = computed((): ValidElement[] => {
    // Depend on snapshotVersion to re-run when choices are fetched
    // (Maps aren't reactive, so we use this counter to trigger updates)
    const _version = snapshotVersion.value;

    const sel = currentPick.value;
    if (!sel) return [];
    if (sel.type !== 'element' && sel.type !== 'elements') return [];

    // Get from snapshot (populated by fetchChoicesForPick)
    const snapshot = actionSnapshot.value?.pickSnapshots.get(sel.name);
    const elements = snapshot?.validElements || [];

    // Enrich with full element data from gameView
    return enrichElementsList(elements);
  });

  // === Auto-fill Watch ===
  // When a pick changes, fetch choices if needed and auto-fill if only one choice
  // Also applies prefills when a pick becomes active
  watch(currentPick, async (sel) => {
    if (!sel || isExecuting.value) return;

    // Check if this selection was already fetched (by start/startFollowUp/fetchAndAutoFill)
    const alreadyFetched = actionSnapshot.value?.fetchedSelections.has(sel.name) ?? false;

    // Fetch choices if not already fetched and not in snapshot yet
    if (!alreadyFetched) {
      const snapshot = actionSnapshot.value?.pickSnapshots.get(sel.name);
      if (!snapshot && (sel.type === 'choice' || sel.type === 'element' || sel.type === 'elements')) {
        // Mark as fetched BEFORE the await to prevent duplicate fetches
        actionSnapshot.value?.fetchedSelections.add(sel.name);
        await fetchChoicesForPick(sel.name);
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

        // Update collectedPicks
        if (actionSnapshot.value) {
          actionSnapshot.value.collectedPicks.set(sel.name, {
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
    tryAutoFillSelection(sel);
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

    if (!availableActions.value?.includes(actionName)) {
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
          const enabledChoices = choices.filter(c => !c.disabled);
          if (enabledChoices.length === 1 && !selection.optional) {
            finalArgs[selection.name] = enabledChoices[0].value;
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
      pickSnapshots: new Map(),
      collectedPicks: new Map(),
      repeatingState: null,
      prefills: new Map(),
      fetchedSelections: new Set(),
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

      actionSnapshot.value.collectedPicks.set(name, {
        value,
        display: displayOverrides?.[name] ?? getDisplayFromValue(value),
        skipped: false,
      });
    }

    // If we have metadata with selections, fetch choices for the first unfilled selection
    if (meta && meta.selections.length > 0) {
      let selectionToFetch: PickMetadata | undefined;
      for (const sel of meta.selections) {
        if (initialArgs[sel.name] === undefined) {
          selectionToFetch = sel;
          break;
        }
      }

      if (selectionToFetch) {
        await fetchAndAutoFill(selectionToFetch);
      }
    }
  }

  async function start(
    actionName: string,
    options?: { args?: Record<string, unknown>; prefill?: Record<string, unknown> }
  ): Promise<void> {
    const initialArgs = options?.args ?? {};
    const prefillArgs = options?.prefill ?? {};

    if (!availableActions.value?.includes(actionName)) {
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
      pickSnapshots: new Map(),
      collectedPicks: new Map(),
      repeatingState: null,
      prefills: new Map(Object.entries(prefillArgs)),
      fetchedSelections: new Set(),
    };

    // Store display values for any initialArgs
    for (const [name, value] of Object.entries(initialArgs)) {
      actionSnapshot.value.collectedPicks.set(name, {
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
      let selectionToFetch: PickMetadata | undefined;
      for (const sel of meta.selections) {
        if (initialArgs[sel.name] === undefined) {
          selectionToFetch = sel;
          break;
        }
      }

      if (selectionToFetch) {
        await fetchAndAutoFill(selectionToFetch);
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
        actionSnapshot.value.collectedPicks.set(selectionName, {
          value,
          display,
          skipped: false,
        });
      }

      // Always fetch choices for the next selection (unless it's number/text)
      const nextSel = getNextSelection(selectionName);
      if (nextSel && (nextSel.type === 'choice' || nextSel.type === 'element' || nextSel.type === 'elements')) {
        await fetchChoicesForPick(nextSel.name);

        // After fetch, check for auto-fill on the next selection
        // (the watch may have fired before cache was populated)
        // Don't auto-fill optional selections - user must consciously choose or skip
        if (getAutoFill() && !isExecuting.value) {
          const choices = getChoices(nextSel);
          const enabledChoices = choices.filter(c => !c.disabled);
          if (enabledChoices.length === 1 && !nextSel.optional) {
            const autoValue = enabledChoices[0].value;
            currentArgs.value[nextSel.name] = autoValue;

            // Also store auto-filled value in snapshot
            if (actionSnapshot.value) {
              actionSnapshot.value.collectedPicks.set(nextSel.name, {
                value: autoValue,
                display: enabledChoices[0].display,
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

  /** Handle fill for repeating picks */
  async function handleRepeatingFill(selection: PickMetadata, value: unknown): Promise<ValidationResult> {
    const stepFn = options.pickStep;
    if (!stepFn || !currentAction.value) {
      return { valid: false, error: 'pickStep function not provided for repeating pick' };
    }

    const player = playerSeat?.value ?? 0;

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
      const result = await stepFn(
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
  function getNextSelection(afterSelectionName: string): PickMetadata | null {
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
        actionSnapshot.value.collectedPicks.set(selectionName, {
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
      actionSnapshot.value.collectedPicks.delete(selectionName);
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
   * const merc = actionController.getCollectedPick('merc');
   * if (merc) {
   *   console.log(`Selected: ${merc.display}`); // "Selected: John Smith"
   * }
   * ```
   */
  function getCollectedPick(name: string): CollectedPick | undefined {
    return actionSnapshot.value?.collectedPicks.get(name);
  }

  /**
   * Get all collected selections with their names.
   * Useful for displaying what's been selected so far.
   *
   * @example
   * ```typescript
   * // Build a summary of selections
   * const picks = actionController.getCollectedPicks();
   * const summary = picks
   *   .filter(s => !s.skipped)
   *   .map(s => `${s.name}: ${s.display}`)
   *   .join(', ');
   * ```
   */
  function getCollectedPicks(): Array<CollectedPick & { name: string }> {
    if (!actionSnapshot.value) return [];

    const result: Array<CollectedPick & { name: string }> = [];
    for (const [name, collected] of actionSnapshot.value.collectedPicks) {
      result.push({ name, ...collected });
    }
    return result;
  }

  // === Animation Gating ===
  // Gates action panel on animation completion (soft continuation pattern)

  const animationsPending = computed((): boolean => {
    return options.animationEvents?.isAnimating.value ?? false;
  });

  const showActionPanel = computed((): boolean => {
    // Show when:
    // 1. It's my turn
    // 2. No animations pending
    // 3. No followUp action pending
    return Boolean(isMyTurn.value) && !animationsPending.value && !pendingFollowUp.value;
  });

  return {
    // State
    currentAction,
    currentArgs,
    currentPick,
    validElements,           // Reactive! Use this in custom UIs
    isReady,
    isExecuting,
    lastError,
    isLoadingChoices,
    repeatingState,
    pendingFollowUp,         // Use to prevent starting new actions during followUp transition

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
    getValidElements,        // Non-reactive, prefer validElements computed
    getActionMetadata,
    clearArgs,
    fetchChoicesForPick,

    // Snapshot API (Pit of Success)
    actionSnapshot,          // Readonly access to frozen action state (for followUp metadata)
    getCollectedPick,
    getCollectedPicks,

    // Hook registration (for GameShell users who can't pass options at creation)
    registerBeforeAutoExecute,

    // Animation gating (soft continuation pattern)
    animationsPending,       // True when animations are playing
    showActionPanel,         // True when safe to show action UI (turn + no animations + no followUp)
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
 * Type for the pick step function (repeating picks).
 * Used when a pick can repeat multiple times (e.g., discard until done).
 */
export type PickStepFn = (
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
 * Inject the pick step function for repeating picks.
 * Returns undefined if not in a GameShell context (function is optional).
 *
 * @example
 * ```typescript
 * const stepFn = injectPickStepFn();
 * if (stepFn && selection.repeat) {
 *   const result = await stepFn(playerSeat, 'card', selectedValue, 'discard');
 *   if (result.done) {
 *     // Repeating pick complete
 *   } else {
 *     // result.nextChoices has the next available choices
 *   }
 * }
 * ```
 */
export function injectPickStepFn(): PickStepFn | undefined {
  return inject<PickStepFn | undefined>('pickStepFn', undefined);
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
export function injectBoardInteraction(): unknown {
  return inject('boardInteraction', undefined);
}

export default useActionController;
