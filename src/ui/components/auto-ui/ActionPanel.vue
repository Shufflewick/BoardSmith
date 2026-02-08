<script setup lang="ts">
/**
 * ActionPanel - Automatically generates action UI from action metadata
 *
 * Features:
 * - Generates UI for each pick type (choice, element, number, text)
 * - Hover over choices to highlight elements on the board
 * - Click elements on board to filter choices
 * - Bidirectional interaction with the game board
 * - Element picks show buttons for valid elements
 * - Choice picks can filter based on previous picks (filterBy)
 *
 * Requires: ActionPanel must be used inside a GameShell context where the
 * action controller is provided via inject('actionController').
 */
import { ref, computed, watch, inject, reactive } from 'vue';
import { useBoardInteraction } from '../../composables/useBoardInteraction';
import { useAnimationEvents } from '../../composables/useAnimationEvents.js';
import type {
  UseActionControllerReturn,
  PickMetadata,
  ActionMetadata as ControllerActionMetadata,
  ChoiceWithRefs,
  ValidElement,
  ElementRef,
} from '../../composables/useActionController';
import DoneButton from './DoneButton.vue';
import { devWarn } from '../../composables/actionControllerHelpers.js';

// Inject the action controller from GameShell (REQUIRED)
// ActionPanel is now a thin UI layer over the controller
const _actionController = inject<UseActionControllerReturn>('actionController');
if (!_actionController) {
  throw new Error('ActionPanel requires actionController to be provided via inject. Use inside GameShell.');
}
const actionController = _actionController;

/**
 * Helper to clear all keys from a reactive object while preserving reactivity.
 */
function clearReactiveObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    delete obj[key];
  }
}

/**
 * Clear action-related state (args and display cache)
 */
function clearActionState(args: Record<string, unknown>): void {
  clearReactiveObject(args);
}

// Re-export types
export type { ChoiceWithRefs, ValidElement, ElementRef };
/** A pick/choice the player must make */
export type Pick = PickMetadata;
export type ActionMetadata = ControllerActionMetadata;

const props = defineProps<{
  availableActions: string[];
  actionMetadata?: Record<string, ActionMetadata>;
  playerSeat: number;
  isMyTurn: boolean;
  selectedElementId?: number;
  canUndo?: boolean;
  /**
   * Auto mode: streamlines UX by reducing unnecessary clicks (default: true)
   * - Auto-executes endTurn when it's the only available action
   * - Auto-starts any single available action (shows its first selection prompt)
   * - Auto-executes actions with no selections when they're the only option
   */
  autoEndTurn?: boolean;
  /** Show undo button when undo is available (default: true) */
  showUndo?: boolean;
}>();

const emit = defineEmits<{
  (e: 'selectingElement', selectionName: string, elementClassName?: string): void;
  (e: 'cancelSelection'): void;
  (e: 'undo'): void;
}>();

// Board interaction for hover/selection sync
const boardInteraction = useBoardInteraction();

// Animation events for skip functionality (optional - may not be provided)
const animationEvents = useAnimationEvents();

// Animation gating from controller
const animationsPending = computed(() => actionController.animationsPending.value);
const showActionPanel = computed(() => actionController.showActionPanel.value);

// Skip handler
function skipAnimations(): void {
  animationEvents?.skipAll();
}

// Use controller state directly (controller is required)
const currentAction = actionController.currentAction;
const isExecuting = actionController.isExecuting;
const isLoadingChoices = actionController.isLoadingChoices;

// Repeating state from controller
const repeatingState = computed(() => {
  const rs = actionController.repeatingState.value;
  if (!rs) return null;
  return {
    selectionName: rs.selectionName,
    accumulated: rs.accumulated,
    awaitingServer: rs.awaitingServer,
    currentChoices: rs.currentChoices as ChoiceWithRefs[] | undefined,
  };
});


// Multi-select state: tracks selected values for current multiSelect selection
const multiSelectState = ref<{
  selectionName: string;
  selectedValues: unknown[];
} | null>(null);

// Track current input values for number/text inputs (so Done button can submit them)
const numberInputValue = ref<number | null>(null);
const textInputValue = ref<string>('');

// Inject shared actionArgs from GameShell (required for bidirectional sync with custom game boards)
const _currentArgs = inject<Record<string, unknown>>('actionArgs');
if (!_currentArgs) {
  throw new Error('ActionPanel requires actionArgs to be provided via inject. Use inside GameShell.');
}
const currentArgs = _currentArgs;

// Get metadata for available actions
const actionsWithMetadata = computed(() => {
  if (!props.actionMetadata) {
    return props.availableActions.map(name => ({
      name,
      prompt: formatActionName(name),
      selections: [] as PickMetadata[],
    }));
  }
  // Map available actions to their metadata, falling back to a basic entry
  // if the action doesn't have metadata (e.g., actions with no selections)
  return props.availableActions.map(name => {
    const meta = props.actionMetadata![name];
    if (meta) return meta;
    // Fallback for actions without metadata entry
    return {
      name,
      prompt: formatActionName(name),
      selections: [] as PickMetadata[],
    };
  });
});

// Actions to display in the UI
// endTurn is always shown so users can manually end their turn
// Auto-execute only happens when endTurn is the only available action
const visibleActions = computed(() => {
  return actionsWithMetadata.value;
});

// Current action metadata
// Note: For followUp actions, the action may not be in availableActions,
// so we check the controller's snapshot first (which has the correct metadata)
const currentActionMeta = computed(() => {
  if (!currentAction.value) return null;

  // Check actionSnapshot first - handles followUp actions that aren't in availableActions
  const snapshotMeta = actionController.actionSnapshot?.value;
  if (snapshotMeta?.actionName === currentAction.value && snapshotMeta.metadata) {
    return snapshotMeta.metadata;
  }

  // Fall back to looking up in actionsWithMetadata
  return actionsWithMetadata.value.find(a => a.name === currentAction.value) ?? null;
});

// Current pick - delegates to controller (required)
const currentPick = computed(() => actionController.currentPick.value);

// Note: Auto-fill is handled by the controller's internal watch

/**
 * Get the current multiSelect config, resolving dependsOn-based configs.
 * For selections with dependsOn + multiSelectByDependentValue, looks up the config
 * based on the current value of the dependent selection.
 */
const currentMultiSelect = computed(() => {
  const sel = currentPick.value;
  if (!sel) return undefined;

  // If selection has dependsOn and multiSelectByDependentValue, resolve it
  if (sel.dependsOn && sel.multiSelectByDependentValue) {
    const depValue = currentArgs[sel.dependsOn];
    if (depValue !== undefined) {
      const key = String(depValue);
      return sel.multiSelectByDependentValue[key];
    }
    return undefined;
  }

  // Otherwise use static multiSelect
  return sel.multiSelect;
});

// Get the selected element ID (from currentArgs when element selection completed)
const selectedElementId = computed(() => {
  // Check if we have a previous element selection in args
  if (!currentActionMeta.value) return null;

  for (const sel of currentActionMeta.value.selections) {
    if ((sel.type === 'element' || sel.type === 'elements') && currentArgs[sel.name] !== undefined) {
      return currentArgs[sel.name] as number;
    }
  }
  return null;
});

// Filter args for display - exclude internal keys and current multiSelect selection
// (multiSelect shows its state via checkboxes, not chips)
const displayableArgs = computed(() => {
  const result: Record<string, unknown> = {};
  const currentSelName = currentPick.value?.name;
  const isMultiSelectActive = currentMultiSelect.value !== undefined;

  for (const [key, value] of Object.entries(currentArgs)) {
    // Skip internal preview keys
    if (key.startsWith('_preview_')) continue;

    // Skip the current multiSelect selection (checkboxes show it)
    if (isMultiSelectActive && key === currentSelName) continue;

    // Skip empty arrays (deselected multiSelect)
    if (Array.isArray(value) && value.length === 0) continue;

    // Skip null values (skipped optional selections)
    if (value === null) continue;

    result[key] = value;
  }
  return result;
});

// Filter choices based on filterBy, dependsOn, and previous selections
// Delegates to controller for base choices, then applies ActionPanel-specific filtering
const filteredChoices = computed(() => {
  if (!currentPick.value) return [];

  // Get base choices from controller (handles repeating, dependsOn, filterBy)
  let choices: ChoiceWithRefs[] = actionController.getCurrentChoices() as ChoiceWithRefs[];

  // ActionPanel-specific: Exclude choices that were already selected in previous choice selections
  // This handles sequential choice selections where user shouldn't pick the same thing twice
  if (currentActionMeta.value) {
    const alreadySelectedValues = new Set<unknown>();
    for (const sel of currentActionMeta.value.selections) {
      if (sel.type === 'choice' && sel.name !== currentPick.value.name) {
        const selectedValue = currentArgs[sel.name];
        if (selectedValue !== undefined) {
          alreadySelectedValues.add(selectedValue);
        }
      }
    }

    if (alreadySelectedValues.size > 0) {
      choices = choices.filter(choice => !alreadySelectedValues.has(choice.value));
    }
  }

  return choices;
});

// Filtered valid elements - excludes elements already selected in previous selections
// This handles the case where an action has multiple element selections and the filter
// depends on previous selections (e.g., "select second die, excluding the first")
const filteredValidElements = computed(() => {
  if (!currentPick.value || (currentPick.value.type !== 'element' && currentPick.value.type !== 'elements')) return [];

  // Get valid elements from controller cache
  const validElements = actionController.getValidElements(currentPick.value);
  if (validElements.length === 0) return [];

  // Get IDs of elements already selected in previous element/elements selections
  const alreadySelectedIds = new Set<number>();
  if (currentActionMeta.value) {
    for (const sel of currentActionMeta.value.selections) {
      if ((sel.type === 'element' || sel.type === 'elements') && sel.name !== currentPick.value.name) {
        const selectedValue = currentArgs[sel.name];
        if (typeof selectedValue === 'number') {
          alreadySelectedIds.add(selectedValue);
        } else if (Array.isArray(selectedValue)) {
          // For elements multiSelect - array of IDs
          for (const id of selectedValue) {
            if (typeof id === 'number') alreadySelectedIds.add(id);
          }
        }
      }
    }
  }

  // Filter out already-selected elements
  if (alreadySelectedIds.size === 0) {
    return validElements;
  }

  return validElements.filter(elem => !alreadySelectedIds.has(elem.id));
});

// Skip an optional selection
function skipOptionalSelection() {
  if (!currentPick.value || !currentPick.value.optional) return;
  // Mark as explicitly skipped by setting to null (not undefined)
  currentArgs[currentPick.value.name] = null;

  // Auto-execute if action is now complete (all required selections filled)
  if (currentAction.value && isActionReady.value) {
    executeAction(currentAction.value, { ...currentArgs });
  }
}

// Submit number input value
function submitNumberInput() {
  if (!currentPick.value || currentPick.value.type !== 'number') return;
  if (numberInputValue.value === null) return;

  // Validate against min/max
  const val = numberInputValue.value;
  const min = currentPick.value.min;
  const max = currentPick.value.max;
  if (min !== undefined && val < min) return;
  if (max !== undefined && val > max) return;

  setSelectionValue(currentPick.value.name, val);
  numberInputValue.value = null;
}

// Submit text input value
function submitTextInput() {
  if (!currentPick.value || currentPick.value.type !== 'text') return;
  if (!textInputValue.value) return;

  // Validate against min/max length
  const val = textInputValue.value;
  const minLen = currentPick.value.minLength;
  const maxLen = currentPick.value.maxLength;
  if (minLen !== undefined && val.length < minLen) return;
  if (maxLen !== undefined && val.length > maxLen) return;

  setSelectionValue(currentPick.value.name, val);
  textInputValue.value = '';
}

// Select an element (from element selection buttons)
function selectElement(elementId: number, ref?: ElementRef) {
  if (!currentPick.value || (currentPick.value.type !== 'element' && currentPick.value.type !== 'elements')) return;

  // Get the selection name BEFORE calling setSelectionValue
  // (because setSelectionValue will change currentPick)
  const selectionName = currentPick.value.name;

  // Look up display from validElements
  const validElem = currentPick.value.validElements?.find((e: ValidElement) => e.id === elementId);
  const display = validElem?.display || String(elementId);

  // Use setSelectionValue which handles auto-execute
  setSelectionValue(selectionName, elementId, display);

  // Note: We don't call boardInteraction.selectElement here because it triggers the watch
  // which would try to fill the NEXT selection with the same element
}

// Execute a choice for filtered/dependent selections
// Uses setSelectionValue to ensure auto-execute watcher fires (and beforeAutoExecuteHook)
function executeChoice(selectionName: string, choice: ChoiceWithRefs) {
  if (!currentAction.value) return;

  // Set the hovered choice to show on board briefly
  if (boardInteraction) {
    boardInteraction.setHoveredChoice({
      value: choice.value,
      display: choice.display,
      sourceRefs: choice.sourceRef ? [choice.sourceRef] : [],
      targetRefs: choice.targetRef ? [choice.targetRef] : [],
    });
  }

  // Use setSelectionValue which delegates to controller.fill()
  // This triggers the isReady watcher to detect completion, fire beforeAutoExecuteHook,
  // then auto-execute the action
  setSelectionValue(selectionName, choice.value, choice.display);
}

// Hover handlers for element buttons (highlight on board)
function handleElementHover(element: ValidElement) {
  if (boardInteraction && element.ref) {
    boardInteraction.setHoveredChoice({
      value: element.id,
      display: element.display || String(element.id),
      sourceRefs: [element.ref],
      targetRefs: [],
    });
  }
}

function handleElementLeave() {
  if (boardInteraction) {
    boardInteraction.setHoveredChoice(null);
  }
}

// Get display text for a selection value
// PIT OF SUCCESS: Uses controller's snapshot as single source of truth
function getSelectionDisplay(selectionName: string, value: unknown): string {
  // Check controller's snapshot (single source of truth)
  const collected = actionController.getCollectedPick(selectionName);
  if (collected && !collected.skipped) {
    // Check if this is the same value (handles array values too)
    const sameValue = JSON.stringify(collected.value) === JSON.stringify(value);
    if (sameValue && collected.display) {
      return collected.display;
    }
  }

  // Fallback for edge cases (shouldn't normally be needed)
  return getDisplayLabel(value);
}

/**
 * Get display text for an accumulated value in a repeating selection.
 * PIT OF SUCCESS: Now that accumulated stores {value, display} objects,
 * we can directly use the stored display.
 */
function getAccumulatedDisplay(accumulated: unknown): string {
  // New format: accumulated items are {value, display} objects
  if (accumulated && typeof accumulated === 'object' && 'display' in accumulated) {
    return (accumulated as { display: string }).display;
  }

  // Legacy fallback: accumulated item is just a value
  const value = accumulated;
  if (!currentPick.value) return getDisplayLabel(value);

  // For choice selections, look up display in choices
  if (currentPick.value.type === 'choice') {
    const choices = repeatingState.value?.currentChoices || currentPick.value.choices || [];
    const choice = choices.find((c: ChoiceWithRefs) => c.value === value);
    if (choice) return choice.display;
  }

  return getDisplayLabel(value);
}

// Clear a specific selection (and all subsequent selections)
function clearSelection(selectionName: string) {
  if (!currentActionMeta.value) return;

  // Find the index of this selection
  const index = currentActionMeta.value.selections.findIndex(s => s.name === selectionName);
  if (index === -1) return;

  // Clear this selection and all subsequent ones
  for (let i = index; i < currentActionMeta.value.selections.length; i++) {
    const sel = currentActionMeta.value.selections[i];
    delete currentArgs[sel.name];
  }

  // Clear board interaction
  boardInteraction?.clear();
}

// Check if action is ready
const isActionReady = computed(() => {
  if (!currentActionMeta.value) return false;
  // Ready when all required selections have values AND no selection needs input
  // (currentPick is null means all selections are filled or skipped)
  return currentPick.value === null;
});

// Note: Auto-execute when action becomes ready is handled by the controller

/**
 * Try to auto-start or auto-execute a single available action.
 * Called from multiple watches to handle different trigger scenarios.
 *
 * @param skipNoSelections - If true, skip actions without selections (to avoid double-execution
 *                           when multiple watches fire for the same state update)
 */
function tryAutoStartSingleAction(skipNoSelections = false): void {
  // Guard conditions - skip if auto not applicable
  if (props.autoEndTurn === false) return;
  if (!props.isMyTurn) return;
  if (currentAction.value) return;
  if (isExecuting.value) return;
  // CRITICAL: Don't start new action if a followUp is pending (race condition fix)
  // After execute() completes with followUp, currentAction is cleared but
  // startFollowUp is scheduled via setTimeout. Without this check, we could
  // start a new action here that runs in parallel with the followUp.
  if (actionController.pendingFollowUp.value) return;

  const actions = actionsWithMetadata.value;
  if (actions.length !== 1) return;

  const action = actions[0];

  // If action has selections, auto-start it (show first selection prompt)
  if (action.selections.length > 0) {
    startAction(action.name);
  }
  // If action has no selections, auto-execute it (unless skipped)
  else if (!skipNoSelections) {
    executeAction(action.name, {});
  }
}

// Auto-start/execute single actions when auto mode is enabled
// This watch handles initial render and when isMyTurn/actions change
watch([() => props.isMyTurn, actionsWithMetadata], () => {
  tryAutoStartSingleAction();
}, { immediate: true });

// Reset current action if it's no longer available (e.g., executed from custom UI)
// Also handles auto-start for single available actions with selections
watch(() => props.availableActions, (actions, oldActions) => {
  // Determine if we need to clear action state
  let shouldClear = false;

  // Clear if current action is no longer available
  if (currentAction.value && !actions.includes(currentAction.value)) {
    shouldClear = true;
  }

  // Clear if action set changed completely (flow transition)
  // This handles cases like: regular actions → combat → regular actions
  // where stale partial action state might otherwise persist
  if (oldActions && oldActions.length > 0 && actions.length > 0) {
    const hasOverlap = actions.some(a => oldActions.includes(a));
    if (!hasOverlap) {
      shouldClear = true;
    }
  }

  if (shouldClear) {
    actionController.cancel();
    clearActionState(currentArgs);
    multiSelectState.value = null;
    boardInteraction?.clear();
  }

  // Try auto-start, but skip no-selection actions to avoid double-execution
  // with the isMyTurn/actionsWithMetadata watch above
  tryAutoStartSingleAction(/* skipNoSelections */ true);
});

// Retry auto-start when action execution completes
// This handles the race condition where state updates (with new availableActions)
// arrive before the actionResult (which clears isExecuting)
watch(isExecuting, (executing, wasExecuting) => {
  if (wasExecuting && !executing) {
    tryAutoStartSingleAction();
  }
});

// Watch for current selection changes - update board interaction for element selections
// and choice selections with board refs
// Also watch filteredValidElements to update when selected elements change
watch([currentPick, filteredValidElements], ([selection]) => {
  if (!selection || !boardInteraction) {
    boardInteraction?.setValidElements([], () => {});
    boardInteraction?.setDraggableSelectedElement(null);
    return;
  }

  // Update action state for custom GameBoard components
  if (currentAction.value && currentActionMeta.value) {
    const selectionIndex = currentActionMeta.value.selections.findIndex(s => s.name === selection.name);
    boardInteraction.setCurrentPick(selectionIndex, selection.name);
  }

  let validElems: { id: number; ref: any }[] = [];
  let onSelect: ((id: number) => void) | null = null;

  // Handle element/elements selections - always support board-direct clicking
  if (selection.type === 'element' || selection.type === 'elements') {
    // Use filteredValidElements which excludes already-selected elements
    validElems = filteredValidElements.value.map(ve => ({
      id: ve.id,
      ref: ve.ref || { id: ve.id },
      disabled: ve.disabled,
    }));

    onSelect = (elementId: number) => {
      // For elements with multiSelect, toggle instead of set
      const multiSelect = currentMultiSelect.value;
      if (selection.type === 'elements' && multiSelect) {
        const validElem = filteredValidElements.value.find(e => e.id === elementId);
        const display = validElem?.display || String(elementId);
        toggleMultiSelectValue(selection.name, elementId, display);
      } else {
        setSelectionValue(selection.name, elementId);
      }
    };

    // Clear draggable selected element when we're on element selection
    boardInteraction.setDraggableSelectedElement(null);
  }
  // Handle choice selections with board refs - support board-direct clicking
  else if (selection.type === 'choice' && selection.choices) {
    // Use filtered choices if there's a filterBy configuration
    const choices = filteredChoices.value.length > 0 ? filteredChoices.value : selection.choices;

    const choicesWithRefs = choices.filter((c: any) => c.sourceRef || c.targetRef);

    if (choicesWithRefs.length > 0) {
      const refToChoice = new Map<number, { value: any; ref: any; disabled?: string }>();

      choicesWithRefs.forEach((choice: any) => {
        // Use targetRef for clickable elements (destinations)
        // sourceRef is only for highlighting the source
        const ref = choice.targetRef || choice.sourceRef;
        if (ref?.id !== undefined) {
          refToChoice.set(ref.id, { value: choice.value, ref, disabled: choice.disabled });
        }
      });

      validElems = Array.from(refToChoice.entries()).map(([id, { ref, disabled }]) => ({
        id,
        ref,  // Include full ref with notation
        disabled,
      }));

      onSelect = (elementId: number) => {
        const entry = refToChoice.get(elementId);
        if (entry !== undefined && !entry.disabled) {
          // For multiSelect, toggle the value instead of setting it
          const multiSelect = currentMultiSelect.value;
          if (multiSelect) {
            // Find the display for this choice
            const choice = choices.find((c: any) => c.value === entry.value);
            const display = choice?.display || String(entry.value);
            toggleMultiSelectValue(selection.name, entry.value, display);
          } else {
            setSelectionValue(selection.name, entry.value);
          }
        }
      };
    }

    // If this choice selection has filterBy and previous element selection was auto-filled,
    // set the selected piece as draggable
    if (selection.filterBy && currentActionMeta.value) {
      const firstSel = currentActionMeta.value.selections[0];
      if ((firstSel?.type === 'element' || firstSel?.type === 'elements') && currentArgs[firstSel.name] !== undefined) {
        const selectedPieceId = currentArgs[firstSel.name] as number;
        // Find the ref for this piece from the first selection's validElements
        const pieceRef = firstSel.validElements?.find(ve => ve.id === selectedPieceId)?.ref;
        boardInteraction.setDraggableSelectedElement(pieceRef || { id: selectedPieceId });
      }
    }
  }

  if (validElems.length > 0 && onSelect) {
    boardInteraction.setValidElements(validElems, onSelect);
  } else {
    boardInteraction?.setValidElements([], () => {});
  }
}, { immediate: true });

// Set up choice selection callback for custom UIs to trigger choice selections
// This allows custom game boards to call boardInteraction.triggerChoiceSelect('suit', 'H')
// and have it properly advance the ActionPanel's selection state
watch(currentAction, (action) => {
  if (!boardInteraction) return;

  if (action) {
    // Set callback that allows custom UI to trigger choice selection
    boardInteraction.setChoiceSelectCallback((selectionName: string, value: unknown) => {
      // Verify we're on the right selection
      if (currentPick.value?.name === selectionName) {
        setSelectionValue(selectionName, value);
      }
    });
  } else {
    boardInteraction.setChoiceSelectCallback(null);
  }
}, { immediate: true });

// Watch for external cancellation via boardInteraction.clear() from custom UI
// This syncs ActionPanel's internal state when custom UI calls cancelAction
watch(() => boardInteraction?.currentAction, (boardAction) => {
  // If boardInteraction action was cleared but we still have an action, sync the cancel
  if (boardAction === null && currentAction.value !== null) {
    // This was externally cleared (e.g., by custom UI cancel button)
    // Reset ActionPanel's internal state to match
    actionController.cancel();
    multiSelectState.value = null;
    clearActionState(currentArgs);
    emit('cancelSelection');
  }
});

// Watch for board element selection - handle element selection from board clicks
// This watch handles auto-starting actions when clicking elements before starting an action.
// When an action is already in progress, triggerElementSelect handles selection via onElementSelect callback.
watch(() => boardInteraction?.selectedElement, (selected) => {
  if (!selected) return;

  // If we're configuring an action with an element/elements selection, check if triggerElementSelect will handle it
  if (currentPick.value && (currentPick.value.type === 'element' || currentPick.value.type === 'elements')) {
    // If onElementSelect callback is set, triggerElementSelect will handle this selection
    // Don't duplicate by also calling setSelectionValue here
    if (boardInteraction?.onElementSelect) {
      return;
    }

    // Check if this element was already selected in a previous selection
    // (prevents double-selection bug when clicking elements)
    const alreadySelected = Object.values(currentArgs).includes(selected.id);
    if (alreadySelected) {
      return;
    }

    // Find the valid element that matches the selection (use filtered list)
    const validElem = filteredValidElements.value.find(e => {
      if (selected.id !== undefined && e.id === selected.id) return true;
      if (selected.notation && e.ref?.notation === selected.notation) return true;
      return false;
    });

    if (validElem) {
      // Use setSelectionValue which handles auto-execute
      setSelectionValue(currentPick.value.name, validElem.id);
    }
    return;
  }

  // If not configuring, auto-start the first action that has an element selection
  // This handles clicking a piece on the board before clicking the action button
  // Guard: don't auto-start if it's not my turn or if currently executing
  if (!props.isMyTurn || isExecuting.value) {
    return;
  }

  const elementAction = actionsWithMetadata.value.find(action => {
    const firstSel = action.selections[0];
    if (firstSel?.type !== 'element') return false;
    // Check if the selected element is valid for this action
    return firstSel.validElements?.some(e => {
      if (selected.id !== undefined && e.id === selected.id) return true;
      if (selected.notation && e.ref?.notation === selected.notation) return true;
      return false;
    });
  });

  if (elementAction) {
    currentAction.value = elementAction.name;
    clearActionState(currentArgs);

    // Find and set the element in args
    const firstSel = elementAction.selections[0];
    const validElem = firstSel.validElements?.find(e => {
      if (selected.id !== undefined && e.id === selected.id) return true;
      if (selected.notation && e.ref?.notation === selected.notation) return true;
      return false;
    });

    if (validElem) {
      currentArgs[firstSel.name] = validElem.id;
      // Note: Display is stored via controller's fill() - direct arg setting loses display info
    }
  }
});

// Watch for drag start - set up drop targets for the dragged element
watch(() => boardInteraction?.isDragging, (isDragging) => {
  if (!isDragging || !boardInteraction?.draggedElement) {
    return;
  }

  const dragged = boardInteraction.draggedElement;

  // Case 1: Action already in progress with piece selected (e.g., auto-select triggered)
  // Check if the dragged element matches the already-selected piece
  if (currentAction.value && currentActionMeta.value) {
    const firstSel = currentActionMeta.value.selections[0];
    const secondSel = currentActionMeta.value.selections[1];

    // If first selection is element/elements and already filled, and second is choice with filterBy
    if ((firstSel?.type === 'element' || firstSel?.type === 'elements') &&
        currentArgs[firstSel.name] !== undefined &&
        secondSel?.type === 'choice' &&
        secondSel.filterBy) {

      const selectedPieceId = currentArgs[firstSel.name] as number;

      // Check if dragged element matches the selected piece
      if (dragged.id === selectedPieceId) {
        // Set up drop targets for destinations
        const allChoices = secondSel.choices || [];
        const filterBy = secondSel.filterBy!;
        const filteredDestinations = allChoices.filter((choice: any) => {
          const choiceValue = choice.value as Record<string, unknown>;
          return choiceValue[filterBy.key] === selectedPieceId;
        });

        const dropTargets: { id: number; ref: ElementRef }[] = [];
        const choiceByTargetId = new Map<number, any>();

        filteredDestinations.forEach((choice: any) => {
          const ref = choice.targetRef;
          if (ref?.id !== undefined) {
            dropTargets.push({ id: ref.id, ref });
            choiceByTargetId.set(ref.id, choice);
          }
        });

        boardInteraction.setDropTargets(dropTargets, (targetId: number) => {
          const choice = choiceByTargetId.get(targetId);
          if (choice && currentAction.value) {
            executeAction(currentAction.value, {
              ...currentArgs,
              [secondSel.name]: choice.value
            });
          }
        });
        return;
      }
    }
  }

  // Case 2: No action in progress - find and start an action
  // Find an action that has element selection followed by choice selection with filterBy
  // This is the pattern for drag-and-drop: select piece, then select destination
  const dragAction = actionsWithMetadata.value.find(action => {
    const firstSel = action.selections[0];
    const secondSel = action.selections[1];

    // First selection must be element type
    if (firstSel?.type !== 'element') return false;

    // Check if the dragged element is valid for this action
    const isValidPiece = firstSel.validElements?.some(e => {
      if (dragged.id !== undefined && e.id === dragged.id) return true;
      if (dragged.notation && e.ref?.notation === dragged.notation) return true;
      return false;
    });

    if (!isValidPiece) return false;

    // Second selection must be choice type with filterBy (destinations filtered by piece)
    return secondSel?.type === 'choice' && secondSel.filterBy;
  });

  if (dragAction) {
    // Start the action and set the piece
    const firstSel = dragAction.selections[0];
    const secondSel = dragAction.selections[1];

    // Find the valid element that matches
    const validPiece = firstSel.validElements?.find(e => {
      if (dragged.id !== undefined && e.id === dragged.id) return true;
      if (dragged.notation && e.ref?.notation === dragged.notation) return true;
      return false;
    });

    if (!validPiece) return;

    // Set up the action state
    currentAction.value = dragAction.name;
    clearActionState(currentArgs);
    currentArgs[firstSel.name] = validPiece.id;
    // Note: Display is stored via controller's fill() - direct arg setting loses display info

    // Get filtered choices for this piece (destinations)
    const allChoices = secondSel.choices || [];
    const filterBy = secondSel.filterBy!;
    const filteredDestinations = allChoices.filter((choice: any) => {
      const choiceValue = choice.value as Record<string, unknown>;
      return choiceValue[filterBy.key] === validPiece.id;
    });

    // Convert choices to drop targets
    const dropTargets: { id: number; ref: ElementRef }[] = [];
    const choiceByTargetId = new Map<number, any>();

    filteredDestinations.forEach((choice: any) => {
      // Use targetRef for drop targets (the destination square)
      const ref = choice.targetRef;
      if (ref?.id !== undefined) {
        dropTargets.push({ id: ref.id, ref });
        choiceByTargetId.set(ref.id, choice);
      }
    });

    // Set drop targets with callback to execute the action
    boardInteraction.setDropTargets(dropTargets, (targetId: number) => {
      const choice = choiceByTargetId.get(targetId);
      if (choice && currentAction.value) {
        executeAction(currentAction.value, {
          ...currentArgs,
          [secondSel.name]: choice.value
        });
      }
    });
    return;
  }

  // Case 3: Element-element drag-drop (e.g., drag card to zone)
  // First selection is element type, second selection is also element type
  // NOTE: validElements is NOT populated in static metadata - it's only available after
  // an action is started and fetchChoicesForSelection is called.
  // So we find element-element actions by type, then start with the dragged element.

  // Find actions with two element-type selections
  const elementElementAction = actionsWithMetadata.value.find(action => {
    const firstSel = action.selections[0];
    const secondSel = action.selections[1];
    return firstSel?.type === 'element' && secondSel?.type === 'element';
  });

  if (!elementElementAction) {
    // No matching action found for this drag - warn the developer
    devWarn(
      `drag-no-action-${JSON.stringify(dragged)}`,
      `Drag started for element ${JSON.stringify(dragged)} but no matching action found.

For drag-drop to work automatically, your action needs one of these patterns:
1. Element -> Choice with filterBy: .fromElements('piece', {...}).chooseFrom('dest', { filterBy: { key: 'pieceId' } })
2. Element -> Element: .fromElements('source', {...}).fromElements('target', {...})

Current action: ${currentAction.value || 'none'}
Available actions: ${props.availableActions?.join(', ') || 'none'}`
    );
    return;
  }

  const firstSel = elementElementAction.selections[0];
  const secondSel = elementElementAction.selections[1];

  // Try to start the action with the dragged element as the first selection
  // The controller will validate if this element is valid for the action
  const draggedId = dragged.id;
  if (draggedId === undefined) return;

  actionController.start(elementElementAction.name, {
    args: { [firstSel.name]: draggedId }
  }).then(() => {
    // After the action starts and choices are fetched, set up drop targets
    // Get valid elements for the second selection from the controller
    const secondValidElements = actionController.getValidElements(secondSel);

    const dropTargets: { id: number; ref: ElementRef }[] = [];
    const elementById = new Map<number, { id: number; ref?: ElementRef }>();

    secondValidElements.forEach(elem => {
      if (elem.id !== undefined && elem.ref) {
        dropTargets.push({ id: elem.id, ref: elem.ref });
        elementById.set(elem.id, elem);
      }
    });

    // Set drop targets with callback to execute the action
    boardInteraction.setDropTargets(dropTargets, (targetId: number) => {
      const elem = elementById.get(targetId);
      if (elem && currentAction.value) {
        executeAction(currentAction.value, {
          ...currentArgs,
          [secondSel.name]: targetId
        });
      }
    });
  }).catch(() => {
    // Element might not be valid for this action - that's ok, just don't set up drop targets
  });
});

// Watch for external element selection prop
watch(() => props.selectedElementId, (newId) => {
  if (newId !== undefined && (currentPick.value?.type === 'element' || currentPick.value?.type === 'elements')) {
    currentArgs[currentPick.value.name] = newId;
    // Note: Display is stored via controller's fill() - direct arg setting loses display info
  }
});

function formatActionName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Get a human-readable display label for any value.
 * Priority: display property > name property > stringified primitive
 * Never returns [object Object]
 */
function getDisplayLabel(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  // Handle primitives directly
  if (typeof value !== 'object') {
    return String(value);
  }

  // For objects, look for common display properties
  const obj = value as Record<string, unknown>;

  // Priority 1: display property (most explicit)
  if (typeof obj.display === 'string') {
    return obj.display;
  }

  // Priority 2: name property (common for elements/entities)
  if (typeof obj.name === 'string') {
    return obj.name;
  }

  // Priority 3: value property that's a primitive (like playerChoices returns)
  if (obj.value !== undefined && typeof obj.value !== 'object') {
    return String(obj.value);
  }

  // Fallback: JSON for debugging (better than [object Object])
  try {
    return JSON.stringify(value);
  } catch {
    return '[Complex Object]';
  }
}

/**
 * Check if a pick is repeating
 */
function isRepeatingSelection(sel: PickMetadata): boolean {
  return sel.repeat !== undefined;
}

/**
 * Check if a value is currently selected in multi-select mode
 */
function isMultiSelectValueSelected(value: unknown): boolean {
  if (!multiSelectState.value) return false;
  return multiSelectState.value.selectedValues.some(v => v === value);
}

/**
 * Toggle a value in multi-select mode
 */
function toggleMultiSelectValue(selectionName: string, value: unknown, display?: string) {
  const multiSelect = currentMultiSelect.value;
  if (!currentPick.value || !multiSelect) return;

  // Initialize state if needed
  if (!multiSelectState.value || multiSelectState.value.selectionName !== selectionName) {
    multiSelectState.value = {
      selectionName,
      selectedValues: [],
    };
  }

  const state = multiSelectState.value;
  const index = state.selectedValues.findIndex(v => v === value);

  if (index >= 0) {
    // Already selected - remove it
    state.selectedValues.splice(index, 1);
  } else {
    // Not selected - add it if we haven't hit max
    const max = multiSelect.max;
    if (max === undefined || state.selectedValues.length < max) {
      state.selectedValues.push(value);
      // Note: Display stored via controller's fill() when multi-select is confirmed

      // Auto-confirm when min === max and we've reached exact count (no Done button needed)
      if (multiSelect.min === multiSelect.max && state.selectedValues.length === multiSelect.min) {
        confirmMultiSelect();
        return;
      }
    }
  }

  // Sync preview to board using special key (doesn't affect selection completion)
  currentArgs[`_preview_${selectionName}`] = [...state.selectedValues];

  // Update AutoUI board highlighting for selected items
  updateMultiSelectBoardHighlights();
}

/**
 * Update board highlighting to show all selected multiSelect items
 * This makes the AutoUI highlight the selected elements
 */
function updateMultiSelectBoardHighlights() {
  if (!boardInteraction || !multiSelectState.value || multiSelectState.value.selectedValues.length === 0) {
    boardInteraction?.setHoveredChoice(null);
    return;
  }

  const selectedValues = multiSelectState.value.selectedValues;

  // Collect all boardRefs for selected values from filteredChoices
  const sourceRefs: ElementRef[] = [];
  const targetRefs: ElementRef[] = [];

  for (const val of selectedValues) {
    const choice = filteredChoices.value.find(c => c.value === val);
    if (choice) {
      if (choice.sourceRef) sourceRefs.push(choice.sourceRef);
      if (choice.targetRef) targetRefs.push(choice.targetRef);
    }
  }

  if (sourceRefs.length > 0 || targetRefs.length > 0) {
    boardInteraction.setHoveredChoice({
      value: selectedValues,
      display: `${selectedValues.length} selected`,
      sourceRefs,
      targetRefs,
    });
  }
}

// Watch for external changes from board (via preview key) when in multiSelect mode
watch(
  () => {
    const sel = currentPick.value;
    const multiSelect = currentMultiSelect.value;
    if (!sel || !multiSelect) return undefined;
    return currentArgs[`_preview_${sel.name}`];
  },
  (previewValue) => {
    const sel = currentPick.value;
    const multiSelect = currentMultiSelect.value;
    if (!sel || !multiSelect || !Array.isArray(previewValue)) return;

    // Sync preview to multiSelectState
    const currentValues = multiSelectState.value?.selectedValues ?? [];
    const isDifferent = previewValue.length !== currentValues.length ||
      previewValue.some((v, i) => v !== currentValues[i]);

    if (isDifferent) {
      multiSelectState.value = {
        selectionName: sel.name,
        selectedValues: [...previewValue],
      };

      // Update AutoUI board highlighting for the new selection
      updateMultiSelectBoardHighlights();

      // Check for auto-confirm when min === max
      if (multiSelect.min === multiSelect.max && previewValue.length === multiSelect.min) {
        confirmMultiSelect();
      }
    }
  },
  { deep: true }
);

/**
 * Confirm multi-select and move to next selection or execute action
 */
function confirmMultiSelect() {
  if (!currentPick.value) return;

  const selectionName = currentPick.value.name;
  const values = multiSelectState.value?.selectedValues ? [...multiSelectState.value.selectedValues] : [];

  // Set the selection value as an array
  currentArgs[selectionName] = values;

  // Clear multi-select state and board highlights
  multiSelectState.value = null;
  boardInteraction?.setHoveredChoice(null);

  // Auto-execute if action is now complete
  if (currentAction.value && isActionReady.value) {
    executeAction(currentAction.value, { ...currentArgs });
  }
}

/**
 * Check if multi-select "Done" button should be enabled
 */
const isMultiSelectReady = computed(() => {
  if (!currentMultiSelect.value) return false;
  const min = currentMultiSelect.value.min;
  const selectedCount = multiSelectState.value?.selectedValues?.length ?? 0;
  return selectedCount >= min;
});

/**
 * Check if Done button should be shown (hidden when min === max, since auto-confirms)
 */
const showMultiSelectDoneButton = computed(() => {
  if (!currentMultiSelect.value) return false;
  const { min, max } = currentMultiSelect.value;
  // Hide Done button when exact count required - auto-confirms on reaching count
  return min !== max;
});

/**
 * Get display text for multi-select count (e.g., "Selected: 1/2")
 */
const multiSelectCountDisplay = computed(() => {
  if (!multiSelectState.value || !currentMultiSelect.value) return '';
  const count = multiSelectState.value.selectedValues.length;
  const max = currentMultiSelect.value.max;
  if (max !== undefined) {
    return `Selected: ${count}/${max}`;
  }
  return `Selected: ${count}`;
});

async function startAction(actionName: string) {
  const meta = actionsWithMetadata.value.find(a => a.name === actionName);

  if (!meta || meta.selections.length === 0) {
    executeAction(actionName, {});
    return;
  }

  const firstSel = meta.selections[0];

  // Delegate to controller for core start logic
  // Controller handles: clearing args, fetching choices for first selection
  await actionController.start(actionName);

  // ActionPanel-specific state cleanup (controller doesn't know about these)
  multiSelectState.value = null;
  boardInteraction?.clear();

  // Notify board interaction of action start (for custom GameBoard components)
  boardInteraction?.setCurrentAction(actionName, 0, firstSel.name);

  if (firstSel.type === 'element' || firstSel.type === 'elements') {
    emit('selectingElement', firstSel.name, firstSel.elementClassName);
  }
}

function cancelAction() {
  // Delegate cancel to controller (handles repeating selection cleanup too)
  actionController.cancel();

  // Clear ActionPanel-specific state
  multiSelectState.value = null;
  clearActionState(currentArgs);
  boardInteraction?.clear();
  emit('cancelSelection');
}

/**
 * Handle a selection choice - delegates to controller.fill() for core logic.
 * This is a thin wrapper that handles UI concerns (display caching, board interaction).
 *
 * The controller handles:
 * - Validation
 * - Repeating selections (via selectionStep)
 * - Deferred choices
 * - Auto-execute when ready
 *
 * ActionPanel handles:
 * - Display caching
 * - Board interaction (highlighting, selecting)
 * - Element selection emits
 */
async function setSelectionValue(name: string, value: unknown, display?: string) {
  const selection = currentPick.value;

  // Delegate to controller for core fill logic
  // Controller stores display in collectedSelections automatically
  // Controller handles: validation, repeating selections, auto-execute
  const result = await actionController.fill(name, value);
  if (!result.valid) {
    console.error('Selection failed:', result.error);
    return;
  }

  // UI-only concerns below (controller doesn't handle these)

  // For choice selections with board refs, mark the selected element
  if (selection?.type === 'choice' && selection.choices) {
    const choice = selection.choices.find((c: any) => c.value === value);
    if (choice && (choice.sourceRef || choice.targetRef)) {
      const ref = choice.sourceRef || choice.targetRef;
      if (ref && boardInteraction) {
        boardInteraction.selectElement(ref);
      }
    }
  }

  // Keep the selected move highlighted on the board
  if (boardInteraction && display) {
    boardInteraction.setHoveredChoice({
      value,
      display,
    });
  }

  if (selection?.type === 'element' || selection?.type === 'elements') {
    emit('selectingElement', selection.name, selection.elementClassName);
  }
}

async function executeAction(actionName: string, args: Record<string, unknown>) {
  // CRITICAL: Atomic check-and-set MUST happen first, before any other code
  // This prevents race conditions when multiple reactive paths trigger in the same tick
  if (isExecuting.value) {
    return;
  }

  // Extra safeguard: don't execute if it's not our turn
  if (!props.isMyTurn) {
    return;
  }

  // Filter out null values (explicitly skipped optional selections)
  // Server expects undefined for missing optional args, not null
  const filteredArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== null) {
      filteredArgs[key] = value;
    }
  }

  try {
    // Delegate to controller for execution
    const result = await actionController.execute(actionName, filteredArgs);
    if (!result.success && result.error) {
      console.error('Action failed:', result.error);
    }
  } catch (err) {
    console.error('Execute action error:', err);
  } finally {
    clearActionState(currentArgs);
    boardInteraction?.clear();
    emit('cancelSelection');
  }
}


// Hover handlers for choice buttons
function handleChoiceHover(choice: ChoiceWithRefs) {
  boardInteraction?.setHoveredChoice({
    value: choice.value,
    display: choice.display,
    sourceRefs: choice.sourceRef ? [choice.sourceRef] : [],
    targetRefs: choice.targetRef ? [choice.targetRef] : [],
  });
}

function handleChoiceLeave() {
  // Don't clear hover if we have multiSelect items selected - keep them highlighted
  if (multiSelectState.value && multiSelectState.value.selectedValues.length > 0) {
    // Re-apply the multiSelect highlights instead of clearing
    updateMultiSelectBoardHighlights();
    return;
  }
  boardInteraction?.setHoveredChoice(null);
}

// Clear board selection
function clearBoardSelection() {
  boardInteraction?.selectElement(null);
}

</script>

<template>
  <!-- Animations pending indicator -->
  <div v-if="animationsPending" class="action-panel-pending">
    <span class="pending-text">Playing animations...</span>
    <button class="skip-btn" @click="skipAnimations">Skip</button>
  </div>

  <!-- Normal action panel content, gated on showActionPanel -->
  <div class="action-panel" v-else-if="showActionPanel">
    <!-- No action being configured -->
    <!-- Key forces re-render when available actions change -->
    <div v-if="!currentAction" class="action-buttons" :key="availableActions.join(',')">
      <button
        v-for="action in visibleActions"
        :key="action.name"
        class="action-btn"
        @click="startAction(action.name)"
        :disabled="isExecuting"
      >
        {{ action.prompt || formatActionName(action.name) }}
      </button>
      <!-- Undo button - shows when player has made actions this turn and showUndo is enabled -->
      <button
        v-if="canUndo && showUndo !== false"
        class="action-btn undo-btn"
        @click="emit('undo')"
        :disabled="isExecuting"
      >
        Undo
      </button>
    </div>

    <!-- Configuring an action -->
    <div v-else class="action-config">
      <div class="config-header">
        <span class="config-title">{{ currentActionMeta?.prompt || formatActionName(currentAction) }}</span>
        <button class="cancel-btn" @click="cancelAction">✕</button>
      </div>

      <!-- Selected values (show previous selections as chips) -->
      <!-- Note: displayableArgs filters out internal keys and current multiSelect selection -->
      <div v-if="Object.keys(displayableArgs).length > 0" class="selected-values">
        <template v-for="(value, key) in displayableArgs" :key="key">
          <div class="selected-value from-board">
            <span class="value-display">{{ getSelectionDisplay(key as string, value) }}</span>
            <button class="clear-selection-btn" @click="clearSelection(key as string)">✕</button>
          </div>
        </template>
      </div>

      <!-- Accumulated selections for repeating selection in progress -->
      <div v-if="repeatingState && repeatingState.accumulated.length > 0" class="accumulated-selections">
        <span class="accumulated-label">Selected:</span>
        <span
          v-for="(val, idx) in repeatingState.accumulated"
          :key="idx"
          class="accumulated-chip"
        >
          {{ getAccumulatedDisplay(val) }}
        </span>
        <span v-if="repeatingState.awaitingServer" class="loading-indicator">...</span>
      </div>

      <!-- Current selection input -->
      <div v-if="currentPick" class="selection-input">
        <!-- Element selection with validElements (shows buttons for each valid element) -->
        <template v-if="currentPick.type === 'element' && filteredValidElements.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.elementClassName || 'element'}` }}
            <span v-if="currentPick.optional" class="optional-label">(optional)</span>
          </div>
          <div class="choice-buttons element-selection">
            <button
              v-for="element in filteredValidElements"
              :key="element.id"
              class="choice-btn element-btn"
              :disabled="!!element.disabled"
              :title="element.disabled || undefined"
              @click="selectElement(element.id, element.ref)"
              @mouseenter="handleElementHover(element)"
              @mouseleave="handleElementLeave"
            >
              {{ element.display || element.id }}
            </button>
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
          </div>
        </template>

        <!-- Elements selection with multiSelect (checkboxes for multiple element selection) -->
        <template v-else-if="currentPick.type === 'elements' && currentMultiSelect && filteredValidElements.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <span class="multi-select-count">{{ multiSelectCountDisplay }}</span>
          </div>
          <div class="choice-buttons multi-select-choices">
            <label
              v-for="element in filteredValidElements"
              :key="element.id"
              class="multi-select-choice"
              :class="{ selected: isMultiSelectValueSelected(element.id) }"
              :title="element.disabled || undefined"
              @mouseenter="handleElementHover(element)"
              @mouseleave="handleElementLeave"
            >
              <input
                type="checkbox"
                :checked="isMultiSelectValueSelected(element.id)"
                @change="toggleMultiSelectValue(currentPick.name, element.id, element.display)"
                :disabled="!!element.disabled || (!isMultiSelectValueSelected(element.id) && currentMultiSelect?.max !== undefined && (multiSelectState?.selectedValues?.length ?? 0) >= currentMultiSelect.max)"
              />
              <span class="checkbox-label">{{ element.display || element.id }}</span>
            </label>
            <span v-if="filteredValidElements.length === 0" class="no-choices">
              No options available
            </span>
            <DoneButton
              v-if="showMultiSelectDoneButton"
              :disabled="!isMultiSelectReady"
              @click="confirmMultiSelect"
            />
          </div>
        </template>

        <!-- Elements selection without multiSelect (buttons for single element selection) -->
        <template v-else-if="currentPick.type === 'elements' && filteredValidElements.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <span v-if="currentPick.optional" class="optional-label">(optional)</span>
          </div>
          <div class="choice-buttons element-selection">
            <button
              v-for="element in filteredValidElements"
              :key="element.id"
              class="choice-btn element-btn"
              :disabled="!!element.disabled"
              :title="element.disabled || undefined"
              @click="selectElement(element.id, element.ref)"
              @mouseenter="handleElementHover(element)"
              @mouseleave="handleElementLeave"
            >
              {{ element.display || element.id }}
            </button>
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
          </div>
        </template>

        <!-- Multi-select choice selection (checkboxes with Done button) - MUST come before dependsOn template -->
        <template v-else-if="currentPick.type === 'choice' && currentMultiSelect && filteredChoices.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <span class="multi-select-count">{{ multiSelectCountDisplay }}</span>
          </div>
          <div class="choice-buttons multi-select-choices">
            <label
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="multi-select-choice"
              :class="{ selected: isMultiSelectValueSelected(choice.value) }"
              :title="choice.disabled || undefined"
              @mouseenter="handleChoiceHover(choice)"
              @mouseleave="handleChoiceLeave"
            >
              <input
                type="checkbox"
                :checked="isMultiSelectValueSelected(choice.value)"
                @change="toggleMultiSelectValue(currentPick.name, choice.value, choice.display)"
                :disabled="!!choice.disabled || (!isMultiSelectValueSelected(choice.value) && currentMultiSelect?.max !== undefined && (multiSelectState?.selectedValues?.length ?? 0) >= currentMultiSelect.max)"
              />
              <span class="checkbox-label">{{ choice.display }}</span>
            </label>
            <span v-if="filteredChoices.length === 0" class="no-choices">
              No options available
            </span>
            <DoneButton
              v-if="showMultiSelectDoneButton"
              :disabled="!isMultiSelectReady"
              @click="confirmMultiSelect"
            />
          </div>
        </template>

        <!-- Choice selection with filterBy or dependsOn (shows filtered choices, executes immediately) -->
        <!-- This comes AFTER multi-select so multiSelect+dependsOn uses multi-select template above -->
        <template v-else-if="currentPick.type === 'choice' && (currentPick.filterBy || currentPick.dependsOn)">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
          </div>
          <div class="choice-buttons">
            <button
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="choice-btn filtered-choice-btn"
              :disabled="!!choice.disabled"
              :title="choice.disabled || undefined"
              @click="executeChoice(currentPick.name, choice)"
              @mouseenter="handleChoiceHover(choice)"
              @mouseleave="handleChoiceLeave"
            >
              {{ choice.display }}
            </button>
            <span v-if="filteredChoices.length === 0" class="no-choices">
              No options available
            </span>
          </div>
        </template>

        <!-- Regular choice selection -->
        <template v-else-if="currentPick.type === 'choice' && filteredChoices.length">
          <div class="selection-prompt">
            {{ currentPick.prompt || `Select ${currentPick.name}` }}
            <span v-if="currentPick.optional" class="optional-label">(optional)</span>
          </div>
          <div class="choice-buttons">
            <button
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="choice-btn"
              :disabled="!!choice.disabled"
              :title="choice.disabled || undefined"
              @click="setSelectionValue(currentPick.name, choice.value, choice.display)"
              @mouseenter="handleChoiceHover(choice)"
              @mouseleave="handleChoiceLeave"
            >
              {{ choice.display }}
            </button>
            <button
              v-if="currentPick.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              {{ typeof currentPick.optional === 'string' ? currentPick.optional : 'Skip' }}
            </button>
            <span v-if="filteredChoices.length === 0 && !currentPick.optional" class="no-choices">
              No options available
            </span>
          </div>
        </template>

        <!-- Loading choices indicator for element selections -->
        <div v-else-if="(currentPick.type === 'element' || currentPick.type === 'elements') && isLoadingChoices" class="loading-choices">
          Loading choices...
        </div>

        <!-- Element selection (fallback when no validElements and not loading) -->
        <div v-else-if="currentPick.type === 'element' || currentPick.type === 'elements'" class="element-instruction">
          <span class="instruction-text">
            Click on a {{ currentPick.elementClassName || 'element' }} to select it
          </span>
        </div>

        <!-- Number input -->
        <div v-else-if="currentPick.type === 'number'" class="number-input">
          <span v-if="currentPick.min !== undefined || currentPick.max !== undefined" class="input-hint">
            ({{ currentPick.min ?? '?' }}-{{ currentPick.max ?? '?' }}{{ currentPick.integer ? ', integer' : '' }})
          </span>
          <div class="input-row">
            <input
              type="number"
              v-model.number="numberInputValue"
              :min="currentPick.min"
              :max="currentPick.max"
              :step="currentPick.integer ? 1 : 'any'"
              @keyup.enter="submitNumberInput"
            />
            <DoneButton @click="submitNumberInput" />
          </div>
        </div>

        <!-- Text input -->
        <div v-else-if="currentPick.type === 'text'" class="text-input">
          <span v-if="currentPick.minLength !== undefined || currentPick.maxLength !== undefined" class="input-hint">
            ({{ currentPick.minLength ?? '?' }}-{{ currentPick.maxLength ?? '?' }} chars)
          </span>
          <div class="input-row">
            <input
              type="text"
              v-model="textInputValue"
              :minlength="currentPick.minLength"
              :maxlength="currentPick.maxLength"
              :pattern="currentPick.pattern"
              @keyup.enter="submitTextInput"
            />
            <DoneButton @click="submitTextInput" />
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Not my turn -->
  <div v-else class="waiting-message">
    Waiting for other player...
  </div>
</template>

<style scoped>
.action-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.action-btn {
  padding: 10px 20px;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 217, 255, 0.4);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Undo button - amber/orange color */
.undo-btn {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  border-color: #b45309;
}

.undo-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);
}

/* Action configuration - horizontal flow layout */
.action-config {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
}

.config-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-title {
  font-weight: bold;
  font-size: 1rem;
  white-space: nowrap;
}

.cancel-btn {
  background: transparent;
  border: none;
  color: #888;
  font-size: 1rem;
  cursor: pointer;
  padding: 2px 6px;
  line-height: 1;
}

.cancel-btn:hover {
  color: #fff;
}

.selected-values {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.selected-value {
  background: rgba(255, 255, 255, 0.1);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
}

/* Accumulated selections for repeating choices */
.accumulated-selections {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(0, 217, 255, 0.1);
  border-radius: 6px;
  border: 1px solid rgba(0, 217, 255, 0.3);
}

.accumulated-label {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.7);
  margin-right: 4px;
}

.accumulated-chip {
  background: rgba(0, 217, 255, 0.2);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  color: #00d9ff;
}

.loading-indicator {
  color: rgba(255, 255, 255, 0.5);
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.value-display {
  color: #00d9ff;
}

.selected-value.from-board {
  background: rgba(0, 255, 136, 0.15);
  border: 1px solid rgba(0, 255, 136, 0.3);
  display: flex;
  align-items: center;
  gap: 6px;
}

.selected-value.from-board .value-display {
  color: #00ff88;
  font-weight: bold;
}

.clear-selection-btn {
  background: transparent;
  border: none;
  color: #888;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.clear-selection-btn:hover {
  color: #fff;
}

/* Selection input - flows inline */
.selection-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.selection-prompt {
  font-size: 0.9rem;
  color: #aaa;
  white-space: nowrap;
}

.choice-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.choice-btn {
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.choice-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(0.5);
  border-color: rgba(128, 128, 128, 0.3);
  color: rgba(255, 255, 255, 0.5);
}

.choice-btn:hover:not(:disabled) {
  border-color: #00d9ff;
  background: rgba(0, 217, 255, 0.2);
}

/* Element selection buttons */
.element-btn {
  font-weight: bold;
}

/* Skip button for optional selections */
.skip-btn {
  background: rgba(128, 128, 128, 0.2);
  border-color: rgba(128, 128, 128, 0.4);
  color: #999;
}

.skip-btn:hover {
  background: rgba(128, 128, 128, 0.3);
  border-color: rgba(128, 128, 128, 0.6);
  color: #ccc;
}

/* Optional label */
.optional-label {
  color: #888;
  font-style: italic;
  font-size: 0.85em;
  margin-left: 6px;
}

/* Filtered choice buttons */
.filtered-choice-btn {
  background: rgba(0, 255, 136, 0.1);
  border-color: rgba(0, 255, 136, 0.3);
}

.filtered-choice-btn:hover {
  border-color: #00ff88;
  background: rgba(0, 255, 136, 0.25);
}

.no-choices {
  color: #888;
  font-style: italic;
  font-size: 0.85rem;
}

.element-instruction {
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  text-align: center;
}

.instruction-text {
  color: #00d9ff;
  font-size: 0.9rem;
}

.number-input input,
.text-input input {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  font-size: 0.9rem;
  width: 120px;
}

.number-input input:focus,
.text-input input:focus {
  outline: none;
  border-color: #00d9ff;
}

.input-hint {
  color: #888;
  font-size: 0.8rem;
  margin-bottom: 6px;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.waiting-message {
  padding: 10px 20px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  text-align: center;
  color: #888;
  font-size: 0.9rem;
}

/* Multi-select styles */
.multi-select-count {
  color: #00d9ff;
  font-weight: bold;
  margin-left: 8px;
}

.multi-select-choices {
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.multi-select-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.multi-select-choice:has(input:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
  filter: grayscale(0.5);
  border-color: rgba(128, 128, 128, 0.3);
  color: rgba(255, 255, 255, 0.5);
}

.multi-select-choice:hover:not(:has(input:disabled)) {
  border-color: #00d9ff;
  background: rgba(0, 217, 255, 0.2);
}

.multi-select-choice.selected {
  border-color: #00ff88;
  background: rgba(0, 255, 136, 0.2);
}

.multi-select-choice input[type="checkbox"] {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
}

.multi-select-choice input[type="checkbox"]:checked {
  border-color: #00ff88;
  background: #00ff88;
}

.multi-select-choice input[type="checkbox"]:checked::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #1a1a2e;
  font-size: 12px;
  font-weight: bold;
}

.multi-select-choice input[type="checkbox"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.checkbox-label {
  flex: 1;
}

/* Choice loading styles */
.loading-choices {
  color: #00d9ff;
  font-style: italic;
  font-size: 0.9rem;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

/* Animation pending state */
.action-panel-pending {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 0.5rem;
}

.pending-text {
  color: var(--text-secondary, #666);
  font-style: italic;
}

.skip-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 0.25rem;
  background: var(--bg-primary, #fff);
  cursor: pointer;
  font-size: 0.875rem;
}

.skip-btn:hover {
  background: var(--bg-hover, #eee);
}
</style>
