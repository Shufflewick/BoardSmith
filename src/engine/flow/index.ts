// Flow engine
export { FlowEngine, FlowHaltedError } from './engine.js';

// Builder functions
export {
  sequence,
  phase,
  loop,
  repeat,
  eachPlayer,
  forEach,
  actionStep,
  simultaneousActionStep,
  switchOn,
  ifThen,
  execute,
  setVar,
} from './builders.js';

// Turn order presets
export { TurnOrder } from './turn-order.js';
export type { TurnOrderConfig } from './turn-order.js';

// Canonical "who can act now?" predicates
export { dueSeats, canSeatAct, availableActionsForSeat, followUpForSeat, turnSequence, orderSeatsByTurn } from './seat-activity.js';
export type { SeatActivityState } from './seat-activity.js';

// Canonical "WHICH turn/round is this?" identity — the one primitive every
// consumer must compare instead of comparing due-seat sets.
export { flowBoundaryKey } from './boundary-key.js';
export type { BoundaryKeyState } from './boundary-key.js';
export { toPublicFlowState } from './public-flow-state.js';
export type { PublicFlowState } from './public-flow-state.js';

// Types
export type {
  FlowNodeType,
  FlowPosition,
  FlowContext,
  FlowNode,
  FlowState,
  PublishedFollowUp,
  FlowDebugInfo,
  FlowDefinition,
  BaseFlowConfig,
  SequenceConfig,
  LoopConfig,
  RepeatNodeConfig,
  EachPlayerConfig,
  ForEachConfig,
  ActionStepConfig,
  TurnScope,
  TurnRun,
  SimultaneousActionStepConfig,
  SwitchConfig,
  IfConfig,
  ExecuteConfig,
  PhaseConfig,
  PlayerAwaitingState,
} from './types.js';
