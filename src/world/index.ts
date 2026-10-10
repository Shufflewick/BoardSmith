/**
 * `boardsmith/world` -- THE PERSISTENT-WORLD RUNTIME CORE.
 *
 * A persistent world is the other backend. Where a table holds its whole
 * element tree resident, snapshots per action and keeps history, undo, bots and
 * spectators, a world keeps only NAMED PARTITIONS resident, checkpoints what a
 * command dirtied, and drives itself with scheduled events. Same engine, same
 * element tree, different storage and checkpoint policy -- the way two storage
 * engines sit under one database.
 *
 * This module is the part of that runtime that is model-independent: residency
 * bookkeeping, declare-then-run, rollback baselines, dirty-set accumulation,
 * per-seat views, event routing by scope, the drift-free recurrence and keyed
 * schedule semantics, the partition-store contract, the read-only projection a
 * declaration sees, and every way a world can refuse.
 *
 * ## PURE ONLY, and the rule is the same one `boardsmith/persistence` keeps
 *
 * Nothing reachable from this barrel may import `node:fs`, `cloudflare:workers`,
 * `ws`, a socket, or a timer-driven clock. A hosting platform imports it inside
 * a Cloudflare Worker bundle and `boardsmith dev` imports it inside a Node
 * process, and the two must get the same world. TIME ARRIVES AS AN ARGUMENT --
 * a command's stamped `arrivedAt`, a scheduled event's own `due` -- and STORAGE
 * ARRIVES AS AN INTERFACE (`WorldPartitionStore`, `WorldPartitionWriter`). A
 * world that read a clock would compute a different state depending on how busy
 * its host was; one that opened a file could not run in a Worker at all.
 *
 * ## The host half lives in `./host/`, and is not re-exported here
 *
 * `boardsmith/world/host` carries `ResidentWorld` -- the loop every host runs
 * over a world: genesis, migration, declare-then-run-then-checkpoint, the
 * per-seat projection, the offer walk, the drain. It is the OTHER SIDE of the
 * two seams this barrel promises are interfaces, because it is the thing that
 * takes a clock and a store and drives them, so importing it is a decision a
 * host makes on purpose rather than something a `world` import drags in.
 *
 * ## What is NOT here, and why
 *
 * Every host's own lifecycle policy. Sockets and transport, hibernation and
 * eviction timing, rate limits, presence ledgers, dead letters, ejection, the
 * park ladder, and the CPU budget one drain may spend holding a world lock.
 * Those are answers about a place: a laptop with one browser tab and a Durable
 * Object holding 500 sockets answer them differently and should. What they must
 * NOT answer differently is what a world IS, which is what this module is.
 *
 * ## Budgets are parameters, not constants
 *
 * `worldBudgets()` carries the defaults and a host overrides what it needs.
 * Nothing in here reads a ceiling it was not passed, because a ceiling read
 * rather than passed is one two hosts can silently disagree about -- and a
 * laptop running different budgets from production makes a game's local
 * behaviour a poor guide to its published behaviour.
 *
 * ## The list is explicit, and `world-exports.test.ts` pins it (#539)
 *
 * Every name below is one a host or a game reaches for. A helper a module
 * exports for the rest of this package -- a refusal sentence, a budget check,
 * the runner's own constructor -- stays exported from its module and is left
 * off this list, so it is not public by accident. Adding a name here is a
 * decision, and the test makes it one.
 */
export {
  worldBudgets,
} from './budgets.js';
export type {
  WorldBudgetOverrides,
  WorldBudgets,
} from './budgets.js';
export {
  WORLD_REFUSALS,
  WorldRefusal,
  ownerOf,
  worldRefusal,
  worldStateUnreadable,
  worldStorageUnavailable,
} from './refusals.js';
export type {
  WorldRefusalCode,
  WorldRefusalOwner,
} from './refusals.js';
export {
  WorldAction,
  WorldClockAction,
  assertWorldAction,
  worldAction,
  worldClockAction,
} from './action.js';
export type {
  CreditConversion,
  WorldActionBlock,
  WorldActionContext,
  WorldActivityRound,
  WorldChoiceOptions,
  WorldClockContext,
  WorldClockFacilities,
  WorldClockNeedsContext,
  WorldElementOptions,
  WorldFacilities,
  WorldMultiSelect,
  WorldNeeds,
  WorldNeedsContext,
  WorldNeedsRound,
  WorldNoticeBoxRound,
  WorldNoticeSeatNeeds,
  WorldOrderedList,
  WorldPartitionsRound,
  WorldQuote,
  WorldSeatNeeds,
} from './action.js';
export {
  WORLD_ENGINE_METHODS,
} from './contract.js';
export type {
  DeclaredSeatActivity,
  DeclaredSeatActivityStamp,
  RoutedEvent,
  SeatActivity,
  SeatActivityStamp,
  SeatTenancy,
  StoredPartition,
  WorldActionOffer,
  WorldAudienceSeat,
  WorldAudienceViews,
  WorldCommand,
  WorldCommandResult,
  WorldCommandStamp,
  WorldDispatchNeeds,
  WorldDispatchWhen,
  WorldEngine,
  WorldEventStamp,
  WorldNarrationLine,
  WorldOfferStamp,
  WorldPartitionSource,
  WorldPartitionStore,
  WorldWalkAnswers,
} from './contract.js';
export {
  assertPartitionWithinBudget,
  assertStorablePartitionName,
  partitionBytes,
} from './partition-store.js';
export type {
  WorldPartitionWriter,
} from './partition-store.js';
export {
  settleDeclaration,
  walkDeclaration,
} from './declaration.js';
export {
  catchUpPlan,
  nextDueBatch,
  occurrencesDue,
  rearmAt,
  resumeDueOf,
  runDueOccurrences,
} from './schedule.js';
export type {
  DueOccurrenceRan,
  DueOccurrencesOutcome,
  ScheduledEvent,
} from './schedule.js';
export {
  WORLD_OWNER,
  WORLD_SCHEDULE_ACTION_MAX_BYTES,
  WORLD_SCHEDULE_ARGS_MAX_BYTES,
  WORLD_SCHEDULE_KEY_MAX_BYTES,
  planSchedules,
  scheduleBudget,
} from './schedule-api.js';
export type {
  PlannedEvent,
  ScheduleAllowance,
  ScheduleArm,
  ScheduleCancel,
  ScheduleRequest,
} from './schedule-api.js';
export {
  dispatchStep,
} from './dispatch.js';
export type {
  WorldDispatchHost,
  WorldDispatchRequest,
  WorldDispatchStepResult,
} from './dispatch.js';
export {
  BoardSmithWorldEngine,
} from './engine.js';
export type {
  BoardSmithWorldEngineOptions,
  WorldDeclarationFacilities,
  WorldResidency,
  WorldViewDeclaration,
} from './engine.js';
export type {
  InlinedPartitionStore,
  WorldAllocation,
  WorldApplyRequest,
  WorldCreatedPartition,
  WorldDeclaration,
  WorldDispatchDeclaration,
  WorldGenesis,
  WorldMigrateContext,
  WorldMigratePass,
  WorldMigrated,
  WorldMigrationHooks,
  WorldMigrationJoins,
  WorldMigrationShape,
  WorldMigrationSourcesContext,
  WorldRunnerHandle,
  WorldSerialized,
  WorldTiming,
  WorldViewNeeds,
  WorldViewRefusal,
  WorldViews,
} from './runner.js';
export {
  assertSeatWithinWorld,
  createWorld,
  mintWorldElementIdKey,
  readWorldDefinition,
  worldColorPalette,
  worldIdAllocationOf,
  worldSeatCount,
  worldVacateAction,
} from './definition.js';
export type {
  WorldDefinition,
  WorldOrdering,
  WorldPresenceDeclaration,
  WorldReferralDeclaration,
  WorldRunner,
  WorldRunnerOptions,
} from './definition.js';
export {
  WORLD_PRESENCE_DEFAULT_GRACE_MS,
  WORLD_PRESENCE_MAX_GRACE_MS,
  WORLD_PRESENCE_MIN_GRACE_MS,
  presenceDepartGraceMs,
} from './presence.js';
export {
  EMPTY_NOTICE_BOX,
  applyNoticeWrite,
  applyNoticeWrites,
  isEmptyNoticeBox,
} from './notices.js';
export type {
  DeclaredNoticeBox,
  NoticeWhenFull,
  SettledNoticeBox,
  WorldNotice,
  WorldNoticeBox,
  WorldNoticeRequest,
  WorldNoticeWrite,
  WorldNoticeWrites,
} from './notices.js';
export {
  assertWorldOrder,
  receiptFloor,
  resolveOrder,
} from './orders.js';
export type {
  OrderDecision,
  WorldOrder,
  WorldReceipt,
} from './orders.js';
export {
  migratedArgs,
  planMigration,
  worldMigration,
} from './migration.js';
export type {
  MigratableEvent,
  MigrationPlan,
  WorldMigration,
  WorldMigrationContext,
  WorldMigrationCreateContext,
  WorldMigrationDeriveContext,
  WorldMigrationFinalizeContext,
  WorldMigrationJoin,
  WorldMigrationSurvey,
} from './migration.js';
