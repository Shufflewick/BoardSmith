/// <reference path="../types/node-globals.d.ts" />
/// <reference path="../ui/global.d.ts" />

// Bundle protocol (game↔engine ABI) version — stamped into manifests at build,
// enforced by the executor. See protocol-version.ts.
export { BUNDLE_PROTOCOL_VERSION } from './protocol-version.js';

// The engine contract: ENGINE_REVISION moves whenever the platform-reachable
// surface or the player-view payload changes, so the platform can detect an
// engine it has not vendored yet. See docs/engine-contract.md.
export { ENGINE_CONTRACT, ENGINE_REVISION } from '../contract/index.js';
export type { EngineContract, EngineContractRevision } from '../contract/index.js';

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
  WORLD_PARTITION_ID_FLOOR,
  RandomnessForbiddenError,
  GAME_ROOT_FIELD_AUDIENCE,
  GAME_SELF_SERIALIZED_FIELDS,
  isEngineRootField,
  engineRootFieldAudience,
} from './element/index.js';

export type {
  GameRootFieldAudience,
  PlayerOf,
  MessageEntry,
  MessageOptions,
  FormattedMessage,
  ElementClass,
  ElementContext,
  ElementTree,
  ElementJSON,
  ElementFinder,
  ElementAttributes,
  SeatAttributeDerivation,
  Sorter,
  GameOptions,
  RandomnessPolicy,
  GamePhase,
  PlayerViewFunction,
  // The type of `Game.random`, which rules and tests may replace -- a game that
  // may set the field must be able to name what it is setting it to.
  SeededRandom,
  ElementLayout,
  HexOrientation,
  HexCoordSystem,
  LayoutDirection,
  LayoutAlignment,
  DieSides,
  AnimationEvent,
  // INTRO-01/02: action-space introspection view types
  ActionSpaceView,
  ActionSchemaView,
  ArgTemplate,
} from './element/index.js';


// Player system
export {
  Player,
  AbilityManager,
} from './player/index.js';

export type { Ability, PlayerStatus } from './player/index.js';

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

// Default ceiling applied to every `enterText()` selection (see docs/state-size.md)
export { DEFAULT_TEXT_MAX_LENGTH } from './action/index.js';

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
  FlowHaltedError,
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
  TurnOrder,
  dueSeats,
  canSeatAct,
  availableActionsForSeat,
  turnSequence,
  orderSeatsByTurn,
  flowBoundaryKey,
  MIN_STEP_TIME_LIMIT_MS,
} from './flow/index.js';

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
  TurnOrderConfig,
  SeatActivityState,
  BoundaryKeyState,
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
  checkpointAt,
  checkpointCount,
  createPlayerView,
  createAllPlayerViews,
  // Dev state transfer (for HMR)
  captureDevState,
  restoreDevState,
  validateDevSnapshot,
  formatValidationErrors,
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
  ActionCheckpointWindow,
  CheckpointAbsence,
  CheckpointPolicy,
  UndoPolicy,
  PlayerStateView,
  // Dev state types
  DevSnapshot,
  RestoreDevStateOptions,
  ValidationResult as DevValidationResult,
  ValidationError as DevValidationError,
  ValidationWarning as DevValidationWarning,
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

/**
 * Base class for a throw whose message is meant to be read (see errors.ts).
 * A game extends it when its error text is the actionable next step; a plain
 * `Error` is sanitized at the action boundary instead.
 */
export { PlayerFacingError, NotSimulableError, RedactedAttributeError } from './errors.js';

/**
 * The engine's one diagnostic channel: a warning an author sees in development
 * and a shipped game never pays for, printed once per key.
 *
 * Exported from the barrel because `boardsmith/world` may reach the engine and
 * itself at runtime and nothing else (see `src/world/purity.test.ts`), and a
 * world drops an action for exactly one reason -- its first question having no
 * answer -- which it must say out loud rather than leaving a verb missing from
 * a seat's panel (#270).
 */
export { devWarn } from '../utils/dev.js';
