export { Action, ActionExecutor, ConditionTracer } from './action.js';
export type {
  SelectionType,
  Selection,
  BaseSelection,
  ChoiceSelection,
  ElementSelection,
  ElementsSelection,
  TextSelection,
  NumberSelection,
  ActionContext,
  ActionDefinition,
  ActionResult,
  FollowUpAction,
  SerializedAction,
  ValidationResult,
  BoardElementRef,
  ChoiceBoardRefs,
  DependentFilter,
  // Debug tracing types
  ConditionDetail,
  SelectionTrace,
  ActionTrace,
  // Human-readable debug types
  SelectionDebugInfo,
  ActionDebugInfo,
  // Repeating selections types
  RepeatConfig,
  RepeatingSelectionState,
  PendingActionState,
} from './types.js';

// Filter helpers for multi-step selections
export {
  dependentFilter,
  adjacentToSelection,
  excludeAlreadySelected,
  allOf,
  anyOf,
  not,
  type DependentFilterOptions,
} from './helpers.js';
