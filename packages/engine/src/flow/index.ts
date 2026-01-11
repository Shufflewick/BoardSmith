// Flow engine
export { FlowEngine } from './engine.js';

// Builder functions
export {
  sequence,
  namedSequence,
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

// Types
export type {
  FlowNodeType,
  FlowStepResult,
  FlowPosition,
  FlowContext,
  FlowNode,
  FlowState,
  FlowDefinition,
  BaseFlowConfig,
  SequenceConfig,
  LoopConfig,
  EachPlayerConfig,
  ForEachConfig,
  ActionStepConfig,
  SimultaneousActionStepConfig,
  SwitchConfig,
  IfConfig,
  ExecuteConfig,
  PhaseConfig,
  PlayerAwaitingState,
} from './types.js';
