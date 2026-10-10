/**
 * #539: `boardsmith/world` EXPORTS AN EXPLICIT LIST, AND THIS PINS IT.
 *
 * The barrel was sixteen `export *` lines, so every helper in those modules
 * was public whether a host needed it or not. It now names each export, and
 * this test fails when a name is added to or removed from the public surface
 * without being added to or removed from the lists below -- so widening the
 * surface is a decision somebody made, not a side effect of exporting a helper
 * for in-package use.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const INDEX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.ts');

// Built once, at the top of the file, where no test timeout applies.
const program = ts.createProgram([INDEX], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(INDEX)!)!);
const isValue = (symbol: ts.Symbol): boolean =>
  ((symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol).flags &
    ts.SymbolFlags.Value) !==
  0;
const names = (values: boolean): string[] =>
  exported
    .filter((symbol) => isValue(symbol) === values)
    .map((symbol) => symbol.name)
    .sort();

const VALUES = [
  'BoardSmithWorldEngine',
  'EMPTY_NOTICE_BOX',
  'WORLD_ENGINE_METHODS',
  'WORLD_OWNER',
  'WORLD_PRESENCE_DEFAULT_GRACE_MS',
  'WORLD_PRESENCE_MAX_GRACE_MS',
  'WORLD_PRESENCE_MIN_GRACE_MS',
  'WORLD_REFUSALS',
  'WorldAction',
  'WorldClockAction',
  'WorldRefusal',
  'applyNoticeWrite',
  'applyNoticeWrites',
  'assertPartitionWithinBudget',
  'assertSeatWithinWorld',
  'assertStorablePartitionName',
  'assertWorldAction',
  'assertWorldOrder',
  'catchUpPlan',
  'createWorld',
  'dispatchStep',
  'isEmptyNoticeBox',
  'migratedArgs',
  'mintWorldElementIdKey',
  'nextDueBatch',
  'occurrencesDue',
  'ownerOf',
  'partitionBytes',
  'planMigration',
  'planSchedules',
  'presenceDepartGraceMs',
  'readWorldDefinition',
  'rearmAt',
  'receiptFloor',
  'resolveOrder',
  'resumeDueOf',
  'runDueOccurrences',
  'scheduleBudget',
  'settleDeclaration',
  'walkDeclaration',
  'worldAction',
  'worldBudgets',
  'worldClockAction',
  'worldColorPalette',
  'worldIdAllocationOf',
  'worldMigration',
  'worldRefusal',
  'worldSeatCount',
  'worldStateUnreadable',
  'worldStorageUnavailable',
  'worldVacateAction',
];

const TYPES = [
  'BoardSmithWorldEngineOptions',
  'CreditConversion',
  'DeclaredNoticeBox',
  'DeclaredSeatActivity',
  'DeclaredSeatActivityStamp',
  'DueOccurrenceRan',
  'DueOccurrencesOutcome',
  'InlinedPartitionStore',
  'MigratableEvent',
  'MigrationPlan',
  'NoticeWhenFull',
  'OrderDecision',
  'PlannedEvent',
  'RoutedEvent',
  'ScheduleAllowance',
  'ScheduleArm',
  'ScheduleCancel',
  'ScheduleRequest',
  'ScheduledEvent',
  'SeatActivity',
  'SeatActivityStamp',
  'SeatTenancy',
  'SettledNoticeBox',
  'StoredPartition',
  'WorldActionBlock',
  'WorldActionContext',
  'WorldActionOffer',
  'WorldActivityRound',
  'WorldAllocation',
  'WorldApplyRequest',
  'WorldAudienceSeat',
  'WorldAudienceViews',
  'WorldBudgetOverrides',
  'WorldBudgets',
  'WorldChoiceOptions',
  'WorldClockContext',
  'WorldClockFacilities',
  'WorldClockNeedsContext',
  'WorldCommand',
  'WorldCommandResult',
  'WorldCommandStamp',
  'WorldCreatedPartition',
  'WorldDeclaration',
  'WorldDeclarationFacilities',
  'WorldDefinition',
  'WorldDispatchDeclaration',
  'WorldDispatchHost',
  'WorldDispatchNeeds',
  'WorldDispatchRequest',
  'WorldDispatchStepResult',
  'WorldDispatchWhen',
  'WorldElementOptions',
  'WorldEngine',
  'WorldEventStamp',
  'WorldFacilities',
  'WorldGenesis',
  'WorldMigrateContext',
  'WorldMigratePass',
  'WorldMigrated',
  'WorldMigration',
  'WorldMigrationContext',
  'WorldMigrationCreateContext',
  'WorldMigrationDeriveContext',
  'WorldMigrationFinalizeContext',
  'WorldMigrationHooks',
  'WorldMigrationJoin',
  'WorldMigrationJoins',
  'WorldMigrationShape',
  'WorldMigrationSourcesContext',
  'WorldMigrationSurvey',
  'WorldMultiSelect',
  'WorldNarrationLine',
  'WorldNeeds',
  'WorldNeedsContext',
  'WorldNeedsRound',
  'WorldNotice',
  'WorldNoticeBox',
  'WorldNoticeBoxRound',
  'WorldNoticeRequest',
  'WorldNoticeSeatNeeds',
  'WorldNoticeWrite',
  'WorldNoticeWrites',
  'WorldOfferStamp',
  'WorldOrder',
  'WorldOrderedList',
  'WorldOrdering',
  'WorldPartitionSource',
  'WorldPartitionStore',
  'WorldPartitionWriter',
  'WorldPartitionsRound',
  'WorldPresenceDeclaration',
  'WorldQuote',
  'WorldReceipt',
  'WorldReferralDeclaration',
  'WorldRefusalCode',
  'WorldRefusalOwner',
  'WorldResidency',
  'WorldRunner',
  'WorldRunnerHandle',
  'WorldRunnerOptions',
  'WorldSeatNeeds',
  'WorldSerialized',
  'WorldTiming',
  'WorldViewDeclaration',
  'WorldViewNeeds',
  'WorldViewRefusal',
  'WorldViews',
  'WorldWalkAnswers',
];

describe('boardsmith/world export list (#539)', () => {
  it('names every export, with no wildcard re-export', () => {
    expect(fs.readFileSync(INDEX, 'utf8')).not.toMatch(/export \*/);
  });

  it('exports exactly the pinned values', () => {
    expect(names(true)).toEqual(VALUES);
  });

  it('exports exactly the pinned types', () => {
    expect(names(false)).toEqual(TYPES);
  });
});
