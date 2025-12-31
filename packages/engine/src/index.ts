// Element system
export {
  GameElement,
  Space,
  Piece,
  Card,
  Hand,
  Deck,
  Die,
  DicePool,
  Grid,
  GridCell,
  HexGrid,
  HexCell,
  Game,
  ElementCollection,
  PersistentMap,
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
  DieSides,
} from './element/index.js';

// Player system
export {
  Player,
  PlayerCollection,
  AbilityManager,
} from './player/index.js';

export type { Ability } from './player/index.js';

// Scoring system (tracks for dice/roll-and-write games)
export {
  Track,
  MonotonicTrack,
  UniqueTrack,
  CounterTrack,
} from './scoring/index.js';

export type {
  TrackEntry,
  TrackConfig,
  MonotonicTrackConfig,
  UniqueTrackConfig,
  CounterTrackConfig,
} from './scoring/index.js';

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
export { Action, ActionExecutor, ConditionTracer } from './action/index.js';

// Filter helpers for multi-step selections
export {
  dependentFilter,
  adjacentToSelection,
  excludeAlreadySelected,
  allOf,
  anyOf,
  not,
} from './action/index.js';

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
  DependentFilterOptions,
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
  turnLoop,
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

// Utilities (serialization, snapshots, replays, action helpers)
export {
  serializeValue,
  deserializeValue,
  serializeAction,
  deserializeAction,
  isSerializedReference,
  createSnapshot,
  createPlayerView,
  createAllPlayerViews,
  createReplayFile,
  validateReplayFile,
  parseReplayFile,
  resolveElementArg,
  isResolvedElement,
} from './utils/index.js';

export type {
  SerializedReference,
  SerializeOptions,
  GameStateSnapshot,
  PlayerStateView,
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
