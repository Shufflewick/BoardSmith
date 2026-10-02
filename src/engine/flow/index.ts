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
  playerActions,
  switchOn,
  ifThen,
  defineFlow,
  noop,
  execute,
  setVar,
  turnLoop,
  stateAwareLoop,
} from './builders.js';

// Turn order presets
export { TurnOrder } from './turn-order.js';
export type { TurnOrderConfig } from './turn-order.js';

// Canonical "who can act now?" predicates
export { dueSeats, canSeatAct, availableActionsForSeat, turnSequence, orderSeatsByTurn } from './seat-activity.js';
export type { SeatActivityState } from './seat-activity.js';

// Canonical "WHICH turn/round is this?" identity — the one primitive every
// consumer must compare instead of comparing due-seat sets.
export { flowBoundaryKey } from './boundary-key.js';
export type { BoundaryKeyState } from './boundary-key.js';
export { toPublicFlowState } from './public-flow-state.js';
export type { PublicFlowState } from './public-flow-state.js';

// The shortest window a step's timeLimitMs may declare.
export { MIN_STEP_TIME_LIMIT_MS } from './step-time-limit.js';

// Types
export type {
  FlowNodeType,
  FlowStepResult,
  FlowPosition,
  FlowContext,
  FlowNode,
  FlowState,
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
  StepTimeLimit,
  TurnRun,
  SimultaneousActionStepConfig,
  SwitchConfig,
  IfConfig,
  ExecuteConfig,
  PhaseConfig,
  PlayerAwaitingState,
} from './types.js';
