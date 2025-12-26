export { Action, ActionExecutor, ConditionTracer } from './action.js';
export type {
  SelectionType,
  Selection,
  BaseSelection,
  ChoiceSelection,
  ElementSelection,
  TextSelection,
  NumberSelection,
  ActionContext,
  ActionDefinition,
  ActionResult,
  SerializedAction,
  ValidationResult,
  BoardElementRef,
  ChoiceBoardRefs,
  DependentFilter,
  // Debug tracing types
  ConditionDetail,
  SelectionTrace,
  ActionTrace,
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
