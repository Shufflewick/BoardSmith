<script setup lang="ts">
/**
 * ActionPanel - Automatically generates action UI from action metadata
 *
 * Features:
 * - Generates UI for each selection type (choice, player, element, etc.)
 * - Hover over choices to highlight elements on the board
 * - Click elements on board to filter choices
 * - Bidirectional interaction with the game board
 * - Element selections show buttons for valid elements
 * - Choice selections can filter based on previous selections (filterBy)
 */
import { ref, computed, watch, inject, reactive } from 'vue';
import { useBoardInteraction } from '../../composables/useBoardInteraction';

/**
 * Helper to clear all keys from a reactive object while preserving reactivity.
 * This is needed because we share actionArgs with custom game boards,
 * and they may have watchers on it.
 */
function clearReactiveObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    delete obj[key];
  }
}

// Clear action state including display cache
function clearActionState(args: Record<string, unknown>, cache: Record<string, string>): void {
  clearReactiveObject(args);
  clearReactiveObject(cache as unknown as Record<string, unknown>);
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
 * Choice with optional board references
 */
export interface ChoiceWithRefs {
  value: unknown;
  display: string;
  sourceRef?: ElementRef;
  targetRef?: ElementRef;
}

/**
 * Valid element for element selection
 */
export interface ValidElement {
  id: number;
  display?: string;
  ref?: ElementRef;
}

/**
 * Filter configuration for dependent selections
 */
export interface SelectionFilter {
  key: string;
  selectionName: string;
}

export interface Selection {
  name: string;
  type: 'choice' | 'player' | 'element' | 'number' | 'text';
  prompt?: string;
  optional?: boolean;
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
  /** For choice selections: name of a previous selection this depends on */
  dependsOn?: string;
  /** For choice selections with dependsOn: choices indexed by dependent value */
  choicesByDependentValue?: Record<string, ChoiceWithRefs[]>;
  /** For repeating choice selections: configuration for repeat behavior */
  repeat?: {
    /** Whether the selection has an onEach callback (requires server round-trip) */
    hasOnEach: boolean;
    /** The terminator value (if using repeatUntil shorthand) */
    terminator?: unknown;
  };
  /** For multi-select choice selections: min/max selection configuration */
  multiSelect?: {
    /** Minimum selections required (default: 1) */
    min: number;
    /** Maximum selections allowed (undefined = unlimited) */
    max?: number;
  };
  /**
   * For choice selections with dependsOn + multiSelect: multiSelect config indexed by dependent value.
   * Key is the string representation of the dependent value (element ID, player position, etc.)
   */
  multiSelectByDependentValue?: Record<string, { min: number; max?: number } | undefined>;
}

export interface ActionMetadata {
  name: string;
  prompt?: string;
  selections: Selection[];
}

export interface Player {
  position: number;
  name: string;
}

const props = defineProps<{
  availableActions: string[];
  actionMetadata?: Record<string, ActionMetadata>;
  players: Player[];
  playerPosition: number;
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
  /** Action to start (set by external UI, consumed and cleared via action-started event) */
  pendingActionStart?: string | null;
  /** Initial args to apply when starting the pending action (applied after clearing) */
  pendingActionArgs?: Record<string, unknown>;
}>();

const emit = defineEmits<{
  (e: 'execute', actionName: string, args: Record<string, unknown>): void;
  (e: 'selectingElement', selectionName: string, elementClassName?: string): void;
  (e: 'cancelSelection'): void;
  (e: 'undo'): void;
  (e: 'action-started'): void;
  // Repeating selection events
  (e: 'start-action', actionName: string, player: number): Promise<{ success: boolean; hasRepeatingSelections?: boolean }>;
  (e: 'selection-step', player: number, selectionName: string, value: unknown): Promise<{
    success: boolean;
    error?: string;
    done?: boolean;
    nextChoices?: unknown[];
    actionComplete?: boolean;
  }>;
  (e: 'cancel-action', player: number): void;
}>();

// Board interaction for hover/selection sync
const boardInteraction = useBoardInteraction();

// Current action state
const currentAction = ref<string | null>(null);
const isExecuting = ref(false);

// Cache for selection display values (preserves display even after game state changes)
const displayCache = reactive<Record<string, string>>({});

// Repeating selection state
const repeatingState = ref<{
  selectionName: string;
  accumulated: unknown[];
  awaitingServer: boolean;
  currentChoices?: ChoiceWithRefs[];
} | null>(null);

// Multi-select state: tracks selected values for current multiSelect selection
const multiSelectState = ref<{
  selectionName: string;
  selectedValues: unknown[];
} | null>(null);

// Track the last executed action to prevent auto-starting it immediately after execution
// This handles the race condition where availableActions hasn't updated yet from the server
const lastExecutedAction = ref<string | null>(null);

/**
 * Type for the selection step function that handles repeating selections.
 * This must be injected by the parent component (e.g., GameShell) to handle
 * server communication for repeating selections.
 */
type SelectionStepFn = (
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

// Inject the selection step function for repeating selections
// This is required for repeating selections to work - parent must provide it
const selectionStepFn = inject<SelectionStepFn | undefined>('selectionStepFn', undefined);

// Inject shared actionArgs from GameShell (enables bidirectional sync with custom game boards)
// Falls back to local state for standalone usage (testing, storybook, etc.)
const injectedActionArgs = inject<Record<string, unknown> | undefined>('actionArgs', undefined);
const fallbackArgs = reactive<Record<string, unknown>>({});
const currentArgs = computed(() => injectedActionArgs ?? fallbackArgs);

// Get metadata for available actions
const actionsWithMetadata = computed(() => {
  if (!props.actionMetadata) {
    return props.availableActions.map(name => ({
      name,
      prompt: formatActionName(name),
      selections: [] as Selection[],
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
      selections: [] as Selection[],
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
const currentActionMeta = computed(() => {
  if (!currentAction.value) return null;
  return actionsWithMetadata.value.find(a => a.name === currentAction.value) ?? null;
});

// Helper to get available choices for a selection
function getAvailableChoices(selection: any): unknown[] {
  if (selection.type === 'choice') {
    return selection.choices || [];
  } else if (selection.type === 'player') {
    // Count other players (exclude current player)
    return otherPlayers.value;
  } else if (selection.type === 'element') {
    return selection.validElements || [];
  }
  return [];
}

// Check if a selection needs user input (undefined = not filled, null = explicitly skipped)
function selectionNeedsInput(sel: { name: string }): boolean {
  const value = currentArgs.value[sel.name];
  // undefined = not filled yet, null = explicitly skipped (counts as filled)
  return value === undefined;
}

// Current selection - returns next selection that needs user input
// First returns required selections, then optional ones (so user can fill or skip them)
const currentSelection = computed(() => {
  if (!currentActionMeta.value) return null;

  // First pass: find first required selection without value
  for (const sel of currentActionMeta.value.selections) {
    if (selectionNeedsInput(sel) && !sel.optional) {
      // Check if we should skip this selection (skipIfOnlyOne)
      if ((sel as any).skipIfOnlyOne) {
        const choices = getAvailableChoices(sel);

        if (choices.length === 1) {
          // Auto-fill this selection and move to next
          const choice = choices[0];

          if (sel.type === 'player') {
            currentArgs.value[sel.name] = (choice as any).position;
          } else if (sel.type === 'element') {
            currentArgs.value[sel.name] = (choice as any).id;
            // Cache display for later lookup
            if ((choice as any).display) {
              cacheSelectionDisplay(sel.name, (choice as any).id, (choice as any).display);
            }
          } else {
            currentArgs.value[sel.name] = (choice as any).value ?? choice;
          }

          continue; // Skip to next selection
        }
      }
      return sel;
    }
  }

  // Second pass: find first optional selection without value
  // This gives the user a chance to fill optional selections before auto-executing
  for (const sel of currentActionMeta.value.selections) {
    if (selectionNeedsInput(sel) && sel.optional) {
      // Check if we should skip this selection (skipIfOnlyOne)
      if ((sel as any).skipIfOnlyOne) {
        const choices = getAvailableChoices(sel);
        if (choices.length === 1) {
          // Auto-fill and continue
          const choice = choices[0];
          if (sel.type === 'player') {
            currentArgs.value[sel.name] = (choice as any).position;
          } else if (sel.type === 'element') {
            currentArgs.value[sel.name] = (choice as any).id;
            // Cache display for later lookup
            if ((choice as any).display) {
              cacheSelectionDisplay(sel.name, (choice as any).id, (choice as any).display);
            }
          } else {
            currentArgs.value[sel.name] = (choice as any).value ?? choice;
          }
          continue;
        }
      }
      return sel;
    }
  }

  return null;
});

/**
 * Get the current multiSelect config, resolving dependsOn-based configs.
 * For selections with dependsOn + multiSelectByDependentValue, looks up the config
 * based on the current value of the dependent selection.
 */
const currentMultiSelect = computed(() => {
  const sel = currentSelection.value;
  if (!sel) return undefined;

  // If selection has dependsOn and multiSelectByDependentValue, resolve it
  if (sel.dependsOn && sel.multiSelectByDependentValue) {
    const depValue = currentArgs.value[sel.dependsOn];
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
    if (sel.type === 'element' && currentArgs.value[sel.name] !== undefined) {
      return currentArgs.value[sel.name] as number;
    }
  }
  return null;
});

// Get the selected element ref for highlighting
const selectedElementRef = computed(() => {
  if (selectedElementId.value === null) return null;

  // Find the element selection that was completed
  if (!currentActionMeta.value) return null;
  for (const sel of currentActionMeta.value.selections) {
    if (sel.type === 'element' && currentArgs.value[sel.name] !== undefined) {
      const validElem = sel.validElements?.find(e => e.id === selectedElementId.value);
      return validElem?.ref || { id: selectedElementId.value };
    }
  }
  return null;
});

// Filter choices based on filterBy, dependsOn, and previous selections
// Also excludes choices that were already selected in previous choice selections
const filteredChoices = computed(() => {
  if (!currentSelection.value) return [];

  let choices: ChoiceWithRefs[] = [];

  // For repeating selections, use dynamic choices from server if available
  if (isRepeatingSelection(currentSelection.value) && repeatingState.value?.currentChoices) {
    choices = repeatingState.value.currentChoices;
  }
  // Handle dependsOn: look up choices from choicesByDependentValue
  else if (currentSelection.value.dependsOn && currentSelection.value.choicesByDependentValue) {
    const dependentValue = currentArgs.value[currentSelection.value.dependsOn];
    if (dependentValue !== undefined) {
      const key = String(dependentValue);
      choices = currentSelection.value.choicesByDependentValue[key] || [];
    } else {
      // Dependent selection not yet made - no choices available
      return [];
    }
  } else if (currentSelection.value.choices) {
    // Regular choices
    choices = currentSelection.value.choices;
  } else {
    return [];
  }

  const filterBy = currentSelection.value.filterBy;

  // If filterBy is specified, filter to only matching choices
  if (filterBy) {
    const filterValue = currentArgs.value[filterBy.selectionName];
    if (filterValue !== undefined) {
      choices = choices.filter(choice => {
        const choiceValue = choice.value as Record<string, unknown>;
        return choiceValue[filterBy.key] === filterValue;
      });
    }
  }

  // Exclude choices that were already selected in previous choice selections
  // This handles sequential choice selections where user shouldn't pick the same thing twice
  if (currentActionMeta.value) {
    const alreadySelectedValues = new Set<unknown>();
    for (const sel of currentActionMeta.value.selections) {
      if (sel.type === 'choice' && sel.name !== currentSelection.value.name) {
        const selectedValue = currentArgs.value[sel.name];
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
  if (!currentSelection.value || currentSelection.value.type !== 'element') return [];
  if (!currentSelection.value.validElements) return [];

  // Get IDs of elements already selected in previous element selections
  const alreadySelectedIds = new Set<number>();
  if (currentActionMeta.value) {
    for (const sel of currentActionMeta.value.selections) {
      if (sel.type === 'element' && sel.name !== currentSelection.value.name) {
        const selectedId = currentArgs.value[sel.name];
        if (typeof selectedId === 'number') {
          alreadySelectedIds.add(selectedId);
        }
      }
    }
  }

  // Filter out already-selected elements
  if (alreadySelectedIds.size === 0) {
    return currentSelection.value.validElements;
  }

  return currentSelection.value.validElements.filter(elem => !alreadySelectedIds.has(elem.id));
});

// Skip an optional selection
function skipOptionalSelection() {
  if (!currentSelection.value || !currentSelection.value.optional) return;
  // Mark as explicitly skipped by setting to null (not undefined)
  currentArgs.value[currentSelection.value.name] = null;
}

// Select an element (from element selection buttons)
function selectElement(elementId: number, ref?: ElementRef) {
  if (!currentSelection.value || currentSelection.value.type !== 'element') return;

  // Get the selection name BEFORE calling setSelectionValue
  // (because setSelectionValue will change currentSelection)
  const selectionName = currentSelection.value.name;

  // Look up display from validElements
  const validElem = currentSelection.value.validElements?.find((e: ValidElement) => e.id === elementId);
  const display = validElem?.display || String(elementId);

  // Use setSelectionValue which handles auto-execute
  setSelectionValue(selectionName, elementId, display);

  // Note: We don't call boardInteraction.selectElement here because it triggers the watch
  // which would try to fill the NEXT selection with the same element
}

// Execute a choice directly (no confirm step for filtered selections)
// But for repeating selections, delegate to setSelectionValue to handle the repeat flow
function executeChoice(selectionName: string, choice: ChoiceWithRefs) {
  if (!currentAction.value) return;

  // Check if this is a repeating selection - if so, use setSelectionValue instead
  const selection = currentSelection.value;
  if (selection && isRepeatingSelection(selection)) {
    setSelectionValue(selectionName, choice.value, choice.display);
    return;
  }

  // Set the hovered choice to show on board briefly
  if (boardInteraction) {
    boardInteraction.setHoveredChoice({
      value: choice.value,
      display: choice.display,
      sourceRefs: choice.sourceRef ? [choice.sourceRef] : [],
      targetRefs: choice.targetRef ? [choice.targetRef] : [],
    });
  }

  // Execute the action with this choice
  executeAction(currentAction.value, { ...currentArgs.value, [selectionName]: choice.value });
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
function getSelectionDisplay(selectionName: string, value: unknown): string {
  // First check cache (preserves display even after game state changes filter out the element)
  const cacheKey = `${selectionName}:${JSON.stringify(value)}`;
  if (displayCache[cacheKey]) {
    return displayCache[cacheKey];
  }

  if (!currentActionMeta.value) return String(value);

  // Find the selection definition
  const selection = currentActionMeta.value.selections.find(s => s.name === selectionName);
  if (!selection) return String(value);

  // For player selections, look up player name by position
  if (selection.type === 'player') {
    const playerPosition = value as number;
    const player = props.players.find(p => p.position === playerPosition);
    return player?.name || String(value);
  }

  // For element selections, look up display in validElements
  if (selection.type === 'element' && selection.validElements) {
    const elem = selection.validElements.find(e => e.id === value);
    return elem?.display || String(value);
  }

  // For choice selections, look up display in choices
  if (selection.type === 'choice' && selection.choices) {
    const choice = selection.choices.find(c => c.value === value);
    return choice?.display || String(value);
  }

  return String(value);
}

// Cache a display value for a selection
function cacheSelectionDisplay(selectionName: string, value: unknown, display: string) {
  const cacheKey = `${selectionName}:${JSON.stringify(value)}`;
  displayCache[cacheKey] = display;
}

/**
 * Get display text for an accumulated value in a repeating selection
 */
function getAccumulatedDisplay(value: unknown): string {
  if (!currentSelection.value) return String(value);

  // For choice selections, look up display in choices
  if (currentSelection.value.type === 'choice') {
    const choices = repeatingState.value?.currentChoices || currentSelection.value.choices || [];
    const choice = choices.find((c: ChoiceWithRefs) => c.value === value);
    if (choice) return choice.display;

    // Value might be an object with name property
    if (value && typeof value === 'object' && 'name' in value) {
      return (value as { name: string }).name;
    }
  }

  return String(value);
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
    delete currentArgs.value[sel.name];
  }

  // Clear board interaction
  boardInteraction?.clear();
}

// Check if action is ready
const isActionReady = computed(() => {
  if (!currentActionMeta.value) return false;
  // Ready when all required selections have values AND no selection needs input
  // (currentSelection is null means all selections are filled or skipped)
  return currentSelection.value === null;
});

// Auto-start board-interactive actions on initial render
// (For subsequent actions after flow steps, auto-start is handled in the availableActions watch below)
watch([() => props.isMyTurn, actionsWithMetadata], ([myTurn, actions]) => {
  if (!myTurn || currentAction.value || actions.length === 0) return;

  // If there's exactly one action and it has board-interactive selections, auto-start it
  if (actions.length === 1) {
    const action = actions[0];

    // Don't auto-start an action we just executed - wait for availableActions to update
    if (action.name === lastExecutedAction.value) return;

    const firstSel = action.selections[0];

    // Auto-start if first selection is element, choice with board refs, or player with board refs
    const isBoardInteractive =
      firstSel?.type === 'element' ||
      (firstSel?.type === 'choice' && (firstSel as any).choices?.some((c: any) => c.sourceRef || c.targetRef)) ||
      (firstSel?.type === 'player' && (firstSel as any).playerChoices?.length > 0);

    if (isBoardInteractive) {
      startAction(action.name);
    }
  }
}, { immediate: true });

// Reset current action if it's no longer available (e.g., executed from custom UI)
// Also handles auto-start/auto-execute for single available actions when auto mode is enabled
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
    currentAction.value = null;
    clearActionState(currentArgs.value, displayCache);
    repeatingState.value = null;
    multiSelectState.value = null;
    boardInteraction?.clear();
  }

  // Clear lastExecutedAction when the action is no longer available OR when it
  // re-appears after being unavailable (indicating a new invocation cycle)
  if (lastExecutedAction.value) {
    if (!actions.includes(lastExecutedAction.value)) {
      // Action no longer available - clear tracking
      lastExecutedAction.value = null;
    } else if (oldActions && !oldActions.includes(lastExecutedAction.value)) {
      // Action was unavailable but is now available again - new invocation cycle
      lastExecutedAction.value = null;
    }
  }

  // Auto mode: when only one action is available, streamline the UX
  if (
    props.autoEndTurn !== false && // Auto mode enabled (default: true)
    props.isMyTurn &&
    actions.length === 1 &&
    !currentAction.value &&
    !isExecuting.value
  ) {
    const actionName = actions[0];

    // Don't auto-start an action we just executed - wait for availableActions to update
    if (actionName === lastExecutedAction.value) return;

    const actionMeta = actionsWithMetadata.value.find(a => a.name === actionName);

    if (actionMeta) {
      // If action has selections, auto-start it (show first selection prompt)
      if (actionMeta.selections.length > 0) {
        startAction(actionName);
      }
      // If action has no selections, auto-execute it
      else {
        executeAction(actionName, {});
      }
    }
  }
});

// Watch for pending action start from external UI (e.g., custom game board buttons)
watch(() => props.pendingActionStart, (actionName) => {
  if (actionName && props.availableActions.includes(actionName)) {
    startAction(actionName);
    // Apply initial args after clearing (avoids timing issues with write-then-start pattern)
    if (props.pendingActionArgs) {
      for (const [key, value] of Object.entries(props.pendingActionArgs)) {
        currentArgs.value[key] = value;
      }
    }
    emit('action-started');
  }
});

// Watch for current selection changes - update board interaction for element selections
// and choice selections with board refs
// Also watch filteredValidElements to update when selected elements change
watch([currentSelection, filteredValidElements], ([selection]) => {
  if (!selection || !boardInteraction) {
    boardInteraction?.setValidElements([], () => {});
    boardInteraction?.setDraggableSelectedElement(null);
    return;
  }

  let validElems: { id: number; ref: any }[] = [];
  let onSelect: ((id: number) => void) | null = null;

  // Handle element selections - always support board-direct clicking
  if (selection.type === 'element') {
    // Use filteredValidElements which excludes already-selected elements
    validElems = filteredValidElements.value.map(ve => ({
      id: ve.id,
      ref: ve.ref || { id: ve.id }
    }));

    onSelect = (elementId: number) => {
      setSelectionValue(selection.name, elementId);
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
      const refToChoice = new Map<number, { value: any; ref: any }>();

      choicesWithRefs.forEach((choice: any) => {
        // Use targetRef for clickable elements (destinations)
        // sourceRef is only for highlighting the source
        const ref = choice.targetRef || choice.sourceRef;
        if (ref?.id !== undefined) {
          refToChoice.set(ref.id, { value: choice.value, ref });
        }
      });

      validElems = Array.from(refToChoice.entries()).map(([id, { ref }]) => ({
        id,
        ref  // Include full ref with notation
      }));

      onSelect = (elementId: number) => {
        const entry = refToChoice.get(elementId);
        if (entry !== undefined) {
          setSelectionValue(selection.name, entry.value);
        }
      };
    }

    // If this choice selection has filterBy and previous element selection was auto-filled,
    // set the selected piece as draggable
    if (selection.filterBy && currentActionMeta.value) {
      const firstSel = currentActionMeta.value.selections[0];
      if (firstSel?.type === 'element' && currentArgs.value[firstSel.name] !== undefined) {
        const selectedPieceId = currentArgs.value[firstSel.name] as number;
        // Find the ref for this piece from the first selection's validElements
        const pieceRef = firstSel.validElements?.find(ve => ve.id === selectedPieceId)?.ref;
        boardInteraction.setDraggableSelectedElement(pieceRef || { id: selectedPieceId });
      }
    }
  }
  // Handle player selections with board refs - support board-direct clicking
  else if (selection.type === 'player') {
    const playerSel = selection as any;

    // Use pre-computed playerChoices from server (includes boardRefs already evaluated)
    if (playerSel.playerChoices && playerSel.playerChoices.length > 0) {
      const refToPlayer = new Map<number, any>();

      playerSel.playerChoices.forEach((choice: any) => {
        // Use targetRef for clickable elements (e.g., opponent's hand)
        const ref = choice.targetRef || choice.sourceRef;
        if (ref?.id !== undefined) {
          refToPlayer.set(ref.id, choice);
        }
      });

      validElems = Array.from(refToPlayer.entries()).map(([id, choice]) => ({
        id,
        ref: { id }
      }));

      onSelect = (elementId: number) => {
        const playerChoice = refToPlayer.get(elementId);
        if (playerChoice !== undefined) {
          setSelectionValue(selection.name, playerChoice.position);
        }
      };
    }
  }

  if (validElems.length > 0 && onSelect) {
    boardInteraction.setValidElements(validElems, onSelect);
  } else {
    boardInteraction?.setValidElements([], () => {});
  }
}, { immediate: true });

// Watch for board element selection - handle element selection from board clicks
watch(() => boardInteraction?.selectedElement, (selected) => {
  if (!selected) return;

  // If we're configuring an action with an element selection, update the arg
  if (currentSelection.value && currentSelection.value.type === 'element') {
    // Check if this element was already selected in a previous selection
    // (prevents double-selection bug when clicking elements)
    const alreadySelected = Object.values(currentArgs.value).includes(selected.id);
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
      setSelectionValue(currentSelection.value.name, validElem.id);
    }
    return;
  }

  // If not configuring, auto-start the first action that has an element selection
  // This handles clicking a piece on the board before clicking the action button
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
    clearActionState(currentArgs.value, displayCache);

    // Find and set the element in args
    const firstSel = elementAction.selections[0];
    const validElem = firstSel.validElements?.find(e => {
      if (selected.id !== undefined && e.id === selected.id) return true;
      if (selected.notation && e.ref?.notation === selected.notation) return true;
      return false;
    });

    if (validElem) {
      currentArgs.value[firstSel.name] = validElem.id;
      // Cache display for later lookup
      if (validElem.display) {
        cacheSelectionDisplay(firstSel.name, validElem.id, validElem.display);
      }
    }
  }
});

// Watch for drag start - set up drop targets for the dragged element
watch(() => boardInteraction?.isDragging, (isDragging) => {
  if (!isDragging || !boardInteraction?.draggedElement) {
    return;
  }

  const dragged = boardInteraction.draggedElement;

  // Case 1: Action already in progress with piece selected (e.g., skipIfOnlyOne triggered)
  // Check if the dragged element matches the already-selected piece
  if (currentAction.value && currentActionMeta.value) {
    const firstSel = currentActionMeta.value.selections[0];
    const secondSel = currentActionMeta.value.selections[1];

    // If first selection is element and already filled, and second is choice with filterBy
    if (firstSel?.type === 'element' &&
        currentArgs.value[firstSel.name] !== undefined &&
        secondSel?.type === 'choice' &&
        secondSel.filterBy) {

      const selectedPieceId = currentArgs.value[firstSel.name] as number;

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
              ...currentArgs.value,
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

  if (!dragAction) return;

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
  clearActionState(currentArgs.value, displayCache);
  currentArgs.value[firstSel.name] = validPiece.id;
  // Cache display for later lookup
  if (validPiece.display) {
    cacheSelectionDisplay(firstSel.name, validPiece.id, validPiece.display);
  }

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
        ...currentArgs.value,
        [secondSel.name]: choice.value
      });
    }
  });
});

// Watch for external element selection prop
watch(() => props.selectedElementId, (newId) => {
  if (newId !== undefined && currentSelection.value?.type === 'element') {
    currentArgs.value[currentSelection.value.name] = newId;
    // Cache display from validElements
    const validElem = currentSelection.value.validElements?.find((e: ValidElement) => e.id === newId);
    if (validElem?.display) {
      cacheSelectionDisplay(currentSelection.value.name, newId, validElem.display);
    }
  }
});

function formatActionName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

/**
 * Check if a selection is repeating
 */
function isRepeatingSelection(sel: Selection): boolean {
  return sel.repeat !== undefined;
}

/**
 * Check if an action has any repeating selections
 */
function hasRepeatingSelections(meta: ActionMetadata): boolean {
  return meta.selections.some(s => isRepeatingSelection(s));
}

/**
 * Check if a selection is multi-select
 */
function isMultiSelectSelection(sel: Selection): boolean {
  return sel.multiSelect !== undefined;
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
  if (!currentSelection.value || !multiSelect) return;

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
      // Cache display
      if (display) {
        cacheSelectionDisplay(selectionName, value, display);
      }
    }
  }
}

/**
 * Confirm multi-select and move to next selection or execute action
 */
function confirmMultiSelect() {
  if (!currentSelection.value) return;

  const selectionName = currentSelection.value.name;
  const values = multiSelectState.value?.selectedValues ? [...multiSelectState.value.selectedValues] : [];

  // Set the selection value as an array
  currentArgs.value[selectionName] = values;

  // Clear multi-select state
  multiSelectState.value = null;

  // Auto-execute if action is now complete
  if (currentAction.value && isActionReady.value) {
    executeAction(currentAction.value, { ...currentArgs.value });
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

function startAction(actionName: string) {
  const meta = actionsWithMetadata.value.find(a => a.name === actionName);

  if (!meta || meta.selections.length === 0) {
    executeAction(actionName, {});
    return;
  }

  currentAction.value = actionName;
  clearActionState(currentArgs.value, displayCache);
  repeatingState.value = null;
  multiSelectState.value = null;
  boardInteraction?.clear();

  const firstSel = meta.selections[0];
  if (firstSel.type === 'element') {
    emit('selectingElement', firstSel.name, firstSel.elementClassName);
  }
}

function cancelAction() {
  // If there's a repeating selection in progress, notify server to cancel
  if (repeatingState.value) {
    emit('cancel-action', props.playerPosition);
  }
  currentAction.value = null;
  repeatingState.value = null;
  multiSelectState.value = null;
  clearActionState(currentArgs.value, displayCache);
  boardInteraction?.clear();
  emit('cancelSelection');
}

async function setSelectionValue(name: string, value: unknown, display?: string) {
  const selection = currentSelection.value;

  // Handle repeating selections
  if (selection && isRepeatingSelection(selection) && selection.name === name) {
    // Check if we have the required function injected
    if (!selectionStepFn) {
      console.error('selectionStepFn not injected - repeating selections require parent to provide this');
      return;
    }

    if (!currentAction.value) {
      console.error('No current action for repeating selection');
      return;
    }

    // Initialize repeating state if needed
    if (!repeatingState.value || repeatingState.value.selectionName !== name) {
      repeatingState.value = {
        selectionName: name,
        accumulated: [],
        awaitingServer: false,
        currentChoices: selection.choices,
      };
    }

    // Add to accumulated values
    repeatingState.value.accumulated.push(value);
    repeatingState.value.awaitingServer = true;

    try {
      // Call server to process this selection step via injected function
      // Pass currentArgs as initialArgs so server knows about prior selections (e.g., actingMerc)
      const result = await selectionStepFn(props.playerPosition, name, value, currentAction.value, { ...currentArgs.value });

      if (!result.success) {
        // Error - remove from accumulated and show error
        repeatingState.value.accumulated.pop();
        console.error('Selection step failed:', result.error);
        return;
      }

      // Check if action is complete (termination condition met)
      if (result.actionComplete) {
        // Action completed - clear everything
        repeatingState.value = null;
        currentAction.value = null;
        clearActionState(currentArgs.value, displayCache);
        boardInteraction?.clear();
        emit('cancelSelection');
        return;
      }

      // Check if this repeating selection is done but action continues
      if (result.done) {
        // Move accumulated to args and clear repeating state
        currentArgs.value[name] = repeatingState.value.accumulated;
        repeatingState.value = null;

        // Check if action is ready to execute
        if (currentAction.value && isActionReady.value) {
          executeAction(currentAction.value, { ...currentArgs.value });
        }
        return;
      }

      // For selections with onEach, clear accumulated since items are processed immediately
      // (they're not "pending" - they've already been applied to game state)
      if (selection.repeat?.hasOnEach) {
        repeatingState.value.accumulated = [];
      }

      // More iterations needed - update choices if provided
      if (result.nextChoices) {
        // Convert raw choices to ChoiceWithRefs format
        repeatingState.value.currentChoices = result.nextChoices.map((choice: unknown) => {
          // If already a ChoiceWithRefs object, use as-is
          if (typeof choice === 'object' && choice !== null && 'value' in choice && 'display' in choice) {
            return choice as ChoiceWithRefs;
          }
          // Convert primitive to ChoiceWithRefs
          return {
            value: choice,
            display: String(choice),
          };
        });
      }
    } finally {
      if (repeatingState.value) {
        repeatingState.value.awaitingServer = false;
      }
    }
    return;
  }

  // Normal (non-repeating) selection handling
  currentArgs.value[name] = value;

  // Cache display for later lookup (important for element selections that may be filtered out later)
  if (display) {
    cacheSelectionDisplay(name, value, display);
  }

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
  // Don't clear - instead set this as the "hovered" choice so it stays visible
  if (boardInteraction && display) {
    boardInteraction.setHoveredChoice({
      value,
      display,
    });
  }

  if (selection?.type === 'element') {
    emit('selectingElement', selection.name, selection.elementClassName);
  }

  // Auto-execute if action is now complete (all required selections filled)
  // This creates a 1:1 relationship between flow actions and UI - no extra "Confirm" step
  if (currentAction.value && isActionReady.value) {
    executeAction(currentAction.value, { ...currentArgs.value });
  }
}

async function executeAction(actionName: string, args: Record<string, unknown>) {
  isExecuting.value = true;
  try {
    // Filter out null values (explicitly skipped optional selections)
    // Server expects undefined for missing optional args, not null
    const filteredArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (value !== null) {
        filteredArgs[key] = value;
      }
    }
    emit('execute', actionName, filteredArgs);
  } finally {
    isExecuting.value = false;
    currentAction.value = null;
    // Track last executed action to prevent auto-starting it before availableActions updates
    lastExecutedAction.value = actionName;
    clearActionState(currentArgs.value, displayCache);
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
  boardInteraction?.setHoveredChoice(null);
}

// Clear board selection
function clearBoardSelection() {
  boardInteraction?.selectElement(null);
}

const otherPlayers = computed(() => {
  return props.players.filter(p => p.position !== props.playerPosition);
});
</script>

<template>
  <div class="action-panel" v-if="isMyTurn">
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
      <div v-if="Object.keys(currentArgs).length > 0" class="selected-values">
        <template v-for="(value, key) in currentArgs" :key="key">
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
      <div v-if="currentSelection" class="selection-input">
        <!-- Element selection with validElements (shows buttons for each valid element) -->
        <template v-if="currentSelection.type === 'element' && currentSelection.validElements?.length">
          <div class="selection-prompt">
            {{ currentSelection.prompt || `Select ${currentSelection.elementClassName || 'element'}` }}
            <span v-if="currentSelection.optional" class="optional-label">(optional)</span>
          </div>
          <div class="choice-buttons element-selection">
            <button
              v-for="element in filteredValidElements"
              :key="element.id"
              class="choice-btn element-btn"
              @click="selectElement(element.id, element.ref)"
              @mouseenter="handleElementHover(element)"
              @mouseleave="handleElementLeave"
            >
              {{ element.display || element.id }}
            </button>
            <button
              v-if="currentSelection.optional"
              class="choice-btn skip-btn"
              @click="skipOptionalSelection"
            >
              Skip
            </button>
          </div>
        </template>

        <!-- Multi-select choice selection (checkboxes with Done button) - MUST come before dependsOn template -->
        <template v-else-if="currentSelection.type === 'choice' && currentMultiSelect && (currentSelection.choices || currentSelection.choicesByDependentValue)">
          <div class="selection-prompt">
            {{ currentSelection.prompt || `Select ${currentSelection.name}` }}
            <span class="multi-select-count">{{ multiSelectCountDisplay }}</span>
          </div>
          <div class="choice-buttons multi-select-choices">
            <label
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="multi-select-choice"
              :class="{ selected: isMultiSelectValueSelected(choice.value) }"
              @mouseenter="handleChoiceHover(choice)"
              @mouseleave="handleChoiceLeave"
            >
              <input
                type="checkbox"
                :checked="isMultiSelectValueSelected(choice.value)"
                @change="toggleMultiSelectValue(currentSelection.name, choice.value, choice.display)"
                :disabled="!isMultiSelectValueSelected(choice.value) && currentMultiSelect?.max !== undefined && (multiSelectState?.selectedValues?.length ?? 0) >= currentMultiSelect.max"
              />
              <span class="checkbox-label">{{ choice.display }}</span>
            </label>
            <span v-if="filteredChoices.length === 0" class="no-choices">
              No options available
            </span>
            <button
              class="multi-select-done-btn"
              :disabled="!isMultiSelectReady"
              @click="confirmMultiSelect"
            >
              Done
            </button>
          </div>
        </template>

        <!-- Choice selection with filterBy or dependsOn (shows filtered choices, executes immediately) -->
        <!-- This comes AFTER multi-select so multiSelect+dependsOn uses multi-select template above -->
        <template v-else-if="currentSelection.type === 'choice' && (currentSelection.filterBy || currentSelection.dependsOn)">
          <div class="selection-prompt">
            {{ currentSelection.prompt || `Select ${currentSelection.name}` }}
          </div>
          <div class="choice-buttons">
            <button
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="choice-btn filtered-choice-btn"
              @click="executeChoice(currentSelection.name, choice)"
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
        <template v-else-if="currentSelection.type === 'choice' && currentSelection.choices">
          <div class="selection-prompt">
            {{ currentSelection.prompt || `Select ${currentSelection.name}` }}
          </div>
          <div class="choice-buttons">
            <button
              v-for="choice in filteredChoices"
              :key="String(choice.value)"
              class="choice-btn"
              @click="setSelectionValue(currentSelection.name, choice.value, choice.display)"
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

        <!-- Player selection -->
        <div v-else-if="currentSelection.type === 'player'" class="player-buttons">
          <button
            v-for="player in otherPlayers"
            :key="player.position"
            class="player-btn"
            @click="setSelectionValue(currentSelection.name, player.position)"
          >
            {{ player.name }}
          </button>
        </div>

        <!-- Element selection -->
        <div v-else-if="currentSelection.type === 'element'" class="element-instruction">
          <span class="instruction-text">
            Click on a {{ currentSelection.elementClassName || 'element' }} to select it
          </span>
        </div>

        <!-- Number input -->
        <div v-else-if="currentSelection.type === 'number'" class="number-input">
          <input
            type="number"
            :min="currentSelection.min"
            :max="currentSelection.max"
            :step="currentSelection.integer ? 1 : 'any'"
            @change="(e) => setSelectionValue(currentSelection!.name, Number((e.target as HTMLInputElement).value))"
          />
        </div>

        <!-- Text input -->
        <div v-else-if="currentSelection.type === 'text'" class="text-input">
          <input
            type="text"
            :minlength="currentSelection.minLength"
            :maxlength="currentSelection.maxLength"
            :pattern="currentSelection.pattern"
            @change="(e) => setSelectionValue(currentSelection!.name, (e.target as HTMLInputElement).value)"
          />
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

.choice-buttons,
.player-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.choice-btn,
.player-btn {
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.choice-btn:hover,
.player-btn:hover {
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

.multi-select-choice:hover {
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

.multi-select-done-btn {
  padding: 10px 24px;
  background: linear-gradient(90deg, #00d9ff, #00ff88);
  color: #1a1a2e;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  align-self: center;
}

.multi-select-done-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 217, 255, 0.4);
}

.multi-select-done-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: rgba(128, 128, 128, 0.3);
}
</style>
