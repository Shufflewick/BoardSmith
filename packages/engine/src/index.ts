// Element system
export {
  GameElement,
  Space,
  Piece,
  Card,
  Hand,
  Deck,
  Grid,
  GridCell,
  HexGrid,
  HexCell,
  Game,
  ElementCollection,
} from './element/index.js';

export type {
  ElementClass,
  ElementContext,
  ElementTree,
  ElementJSON,
  ElementFinder,
  ElementAttributes,
  Sorter,
  GameOptions,
  GamePhase,
  PlayerViewFunction,
  ElementLayout,
  HexOrientation,
  HexCoordSystem,
  LayoutDirection,
  LayoutAlignment,
} from './element/index.js';

// Player system
export { Player, PlayerCollection } from './player/index.js';

// Command system (event sourcing)
export {
  executeCommand,
  canPlayerSee,
  visibilityFromMode,
  resolveVisibility,
  DEFAULT_VISIBILITY,
} from './command/index.js';

export type {
  GameCommand,
  CommandResult,
  BaseCommand,
  CreateElementCommand,
  CreateManyCommand,
  MoveCommand,
  RemoveCommand,
  ShuffleCommand,
  SetAttributeCommand,
  SetVisibilityCommand,
  AddVisibleToCommand,
  SetCurrentPlayerCommand,
  MessageCommand,
  StartGameCommand,
  EndGameCommand,
  SetOrderCommand,
  VisibilityConfig,
  VisibilityMode,
  VisibilityState,
} from './command/index.js';

// Action system
export { Action, ActionExecutor } from './action/index.js';

export type {
  SelectionType,
  Selection,
  BaseSelection,
  ChoiceSelection,
  PlayerSelection,
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
} from './action/index.js';

// Flow system
export {
  FlowEngine,
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
  TurnOrder,
} from './flow/index.js';

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
  TurnOrderConfig,
} from './flow/index.js';

// Utilities (serialization, snapshots, replays)
export {
  serializeValue,
  deserializeValue,
  serializeAction,
  deserializeAction,
  isSerializedReference,
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
  computeDiff,
  createReplayFile,
  validateReplayFile,
  parseReplayFile,
} from './utils/index.js';

export type {
  SerializedReference,
  SerializeOptions,
  GameStateSnapshot,
  PlayerStateView,
  StateDiff,
  ReplayFile,
} from './utils/index.js';

// Sandbox (execution limits and security)
export {
  ExecutionContext,
  ExecutionLimitError,
  withLimits,
  withLimitsAsync,
  guard,
  validateCode,
  DEFAULT_LIMITS,
} from './sandbox/index.js';

export type {
  ExecutionLimits,
} from './sandbox/index.js';
