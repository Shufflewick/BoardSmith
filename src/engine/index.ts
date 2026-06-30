/// <reference path="../types/node-globals.d.ts" />
/// <reference path="../ui/global.d.ts" />

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
  DEFAULT_COLOR_PALETTE,
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
  AnimationEvent,
} from './element/index.js';


// Player system
export {
  Player,
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
  TrackCommandEmitter,
} from './scoring/index.js';

// Command system (event sourcing)
export {
  executeCommand,
  undoCommand,
  createInverseCommand,
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
  TrackAddCommand,
  TrackRemoveLastCommand,
  AnimateCommand,
  TrackOwner,
  VisibilityConfig,
  VisibilityMode,
  VisibilityState,
} from './command/index.js';

// Action system
export { Action, ActionExecutor, evaluateCondition } from './action/index.js';

// Filter helpers for multi-step selections
export {
  dependentFilter,
  not,
} from './action/index.js';

// Action temp state helper (for choices → execute state persistence)
export { actionTempState, type ActionTempState } from './action/index.js';

export type {
  AnnotatedChoice,
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
  RefWithRole,
  ChoiceBoardRefs,
  DependentFilter,
  DependentFilterOptions,
  // Debug tracing types
  ConditionDetail,
  PickTrace,
  ActionTrace,
  // Human-readable debug types
  PickDebugInfo,
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
  dueSeats,
  canSeatAct,
  availableActionsForSeat,
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
  SeatActivityState,
} from './flow/index.js';

// Utilities (serialization, snapshots, replays, action helpers, dev state)
export {
  buildActionArgs,
  enumerateLegalMoves,
  serializeValue,
  deserializeValue,
  serializeAction,
  deserializeAction,
  isSerializedReference,
  createSnapshot,
  createActionCheckpoint,
  createPlayerView,
  createAllPlayerViews,
  // Dev state transfer (for HMR)
  captureDevState,
  restoreDevState,
  validateDevSnapshot,
  formatValidationErrors,
  validateFlowPosition,
  formatFlowRecovery,
  getSnapshotElementCount,
  // Dev checkpoints for fast HMR recovery
  createDevCheckpoint,
  restoreFromDevCheckpoint,
} from './utils/index.js';

export type {
  BuildActionArgsOptions,
  SerializedReference,
  SerializeOptions,
  GameStateSnapshot,
  ActionCheckpoint,
  PlayerStateView,
  // Dev state types
  DevSnapshot,
  RestoreDevStateOptions,
  ValidationResult as DevValidationResult,
  ValidationError as DevValidationError,
  ValidationWarning as DevValidationWarning,
  FlowPositionValidation,
  // Dev checkpoint types
  DevCheckpoint,
  RestoreFromDevCheckpointOptions,
  DevCheckpointRestoreResult,
} from './utils/index.js';

// Tutorial predicate helpers (TUT-03)
export { afterFirstTurn, afterTurns, whenForced } from './tutorial/predicates.js';

export type {
  SelectionMatcher,
  TutorialGateContext,
  TutorialAdvanceCondition,
  TutorialGateCondition,
  TutorialGate,
  TutorialGateAllowList,
  TutorialStep,
  TutorialDefinition,
  TutorialProgress,
  TutorialStepView,
  Annotation,
  AnnotationTarget,
  AnnotationPlacement,
  ElementRef,
} from './tutorial/types.js';
