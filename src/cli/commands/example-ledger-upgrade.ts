import { promises as fs } from 'node:fs';
import { relative, resolve } from 'node:path';
import chalk from 'chalk';
import { readFencedJsonLedger } from '../lib/fenced-json-ledger.js';
import { readLiveSlices } from './verify-derive-check.js';
import { buildExampleExtractionPayload, isCitationHeaderLine } from './example-derivation.js';
import {
  exampleReplayLedgerFile,
  findUnanchoredExamples,
  isPreLineTextRecord,
  moveUnanchoredExamples,
  partitionLedgerLines,
  readLedgerLine,
  writeExampleReplayLedger,
  type ExampleReplayRecord,
  type ReanchorResult,
  type SliceWithoutExamplesRecord,
} from './verify-example-replay.js';

/**
 * `boardsmith verify-example-ledger-upgrade` — the one-time upgrade of an example-replay ledger
 * written before #350 gave every record its `lineText` (#371). Every other reader refuses such a
 * ledger and names this command; the ledger format itself stays strict.
 *
 * For each record without `lineText`, it looks for the record's own quotes
 * (`supportingQuoteLines`, the translated test's `sourceText`, or a contradiction excerpt) in the
 * lines the extractor reads from its slice:
 *
 *   - the line its `lineNumber` names still carries one: that line's text becomes its `lineText`;
 *   - otherwise, exactly one line carries one (not counting a bare citation header the record
 *     also quotes, which is never an example's own line): that line's text becomes its `lineText`, and the
 *     record is moved there by the rule `ingest-check` re-anchors with (`findUnanchoredExamples`,
 *     `moveUnanchoredExamples`), so a line inserted above it (a `Source:` line) costs nothing;
 *   - no line does (`quote-gone`), or several do, or the one that does is another record's line
 *     or repeated elsewhere in the slice (`quote-ambiguous`): the record is dropped and named, and
 *     so is every other record of its slice, since `verify-example-record` replaces a whole slice.
 *     That slice is recorded again; `verify-example-replay` reports it pending until it is.
 *
 * A record whose slice no longer exists is dropped and named too. Every kept record keeps its
 * verdict and every other field. Everything is decided before anything is written, in one ledger
 * write, and nothing is written when there is nothing to upgrade. A record that is malformed for
 * any other reason refuses the whole upgrade.
 */

type DropReason = 'quote-gone' | 'quote-ambiguous' | 'slice-gone' | 'slice-recorded-again';

interface DroppedRecord {
  exampleId: string;
  reason: DropReason;
}

interface ExampleLedgerUpgradeResult {
  ledgerPath: string;
  /** Records that now carry `lineText`, by the id they had, in ledger order. */
  upgraded: string[];
  /** Upgraded records moved to the line their example is now on. */
  reanchored: ReanchorResult['moved'];
  dropped: DroppedRecord[];
  /** Slices whose worked examples must be recorded again, in path order. */
  slicesToRecordAgain: string[];
}

type LedgerLine = ExampleReplayRecord | SliceWithoutExamplesRecord;

interface DroppedDecision {
  kind: 'dropped';
  exampleId: string;
  slicePath: string;
  reason: DropReason;
}

/** What the upgrade decided for one ledger line, before anything is written. */
type Decision = { kind: 'keep'; line: LedgerLine } | { kind: 'upgraded'; line: ExampleReplayRecord } | DroppedDecision;

export async function exampleLedgerUpgradeCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<ExampleLedgerUpgradeResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const file = exampleReplayLedgerFile(projectDir);
  const ledgerPath = relative(projectDir, file.path);
  const liveSlices = await readLiveSlices(projectDir);
  const slices = new Map(liveSlices.map((s) => [s.path, s.text]));

  const raw = await readFencedJsonLedger(file, (r) => r);
  const decisions = dropSlicesToRecordAgain(
    dropUnplaceable(raw.map((r, i) => decide(r, i, slices)), liveSlices),
  );

  const upgraded = decisions.flatMap((d) => (d.kind === 'upgraded' ? [d.line.exampleId] : []));
  const dropped = decisions.flatMap((d) => (d.kind === 'dropped' ? [{ exampleId: d.exampleId, reason: d.reason }] : []));
  const slicesToRecordAgain = [
    ...new Set(decisions.flatMap((d) => (d.kind === 'dropped' && isUnplaceable(d.reason) ? [d.slicePath] : []))),
  ].sort();

  const kept = decisions.flatMap((d) => (d.kind === 'dropped' ? [] : [d.line]));
  const keptRecords = kept.filter((l): l is ExampleReplayRecord => 'exampleId' in l);
  const upgradedIds = new Set(upgraded);
  const { rewritten, moved } = moveUnanchoredExamples(
    keptRecords,
    findUnanchoredExamples(keptRecords, liveSlices).filter((u) => upgradedIds.has(u.exampleId)),
  );
  if (upgraded.length > 0 || dropped.length > 0) {
    const withoutExamples = kept.filter((l) => !('exampleId' in l));
    await writeExampleReplayLedger(projectDir, partitionLedgerLines([...rewritten, ...withoutExamples], ledgerPath));
  }

  const result: ExampleLedgerUpgradeResult = { ledgerPath, upgraded, reanchored: moved, dropped, slicesToRecordAgain };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    await printUpgrade(projectDir, result, decisions);
  }
  return result;
}

function isUnplaceable(reason: DropReason): boolean {
  return reason === 'quote-gone' || reason === 'quote-ambiguous';
}

/**
 * Drops each upgraded record the re-anchoring rule cannot place: its text is on several lines of
 * its slice, or on one another record already holds.
 */
function dropUnplaceable(decisions: Decision[], liveSlices: { path: string; text: string }[]): Decision[] {
  const records = decisions.flatMap((d) => (d.kind === 'dropped' || !('exampleId' in d.line) ? [] : [d.line]));
  const unplaceable = new Set(
    findUnanchoredExamples(records, liveSlices).flatMap((u) => (u.reason === 'moved' ? [] : [u.exampleId])),
  );
  return decisions.map((d) =>
    d.kind === 'upgraded' && unplaceable.has(d.line.exampleId) ? droppedLine(d.line, 'quote-ambiguous') : d,
  );
}

/** Drops every other record of a slice one of whose records could not be placed. */
function dropSlicesToRecordAgain(decisions: Decision[]): Decision[] {
  const again = new Set(
    decisions.flatMap((d) => (d.kind === 'dropped' && isUnplaceable(d.reason) ? [d.slicePath] : [])),
  );
  return decisions.map((d) =>
    d.kind !== 'dropped' && again.has(d.line.slicePath) ? droppedLine(d.line, 'slice-recorded-again') : d,
  );
}

function droppedLine(line: LedgerLine, reason: DropReason): DroppedDecision {
  const exampleId = 'exampleId' in line ? line.exampleId : line.slicePath;
  return { kind: 'dropped', exampleId, slicePath: line.slicePath, reason };
}

/** The upgrade's decision for ledger line `i`; throws, naming it, for a line malformed otherwise. */
function decide(r: Record<string, unknown>, i: number, slices: ReadonlyMap<string, string>): Decision {
  try {
    return isPreLineTextRecord(r) ? upgradeRecord(r, slices) : { kind: 'keep', line: readLedgerLine(r) };
  } catch (err) {
    throw new Error(
      `Record ${i + 1} of the example-replay ledger cannot be upgraded: ${(err as Error).message}\n` +
        `Nothing was written.`,
    );
  }
}

/**
 * A pre-lineText record with the text of the line that carries its quote: the line it names when
 * that one does, or else the one line that does, which `dropUnplaceable` and the move then place.
 */
function upgradeRecord(r: Record<string, unknown>, slices: ReadonlyMap<string, string>): Decision {
  const slicePath = String(r.slicePath ?? '');
  const dropped = (reason: DropReason): Decision => ({
    kind: 'dropped',
    exampleId: String(r.exampleId ?? ''),
    slicePath,
    reason,
  });
  const sliceText = slices.get(slicePath);
  if (sliceText === undefined) return dropped('slice-gone');
  const lines = buildExampleExtractionPayload({ path: slicePath, text: sliceText }).lines;
  const quotes = recordQuotes(r);
  const carries = (text: string) => quotes.some((q) => text.includes(q));
  const own = lines.find((l) => l.lineNumber === Number(r.lineNumber));
  const texts = exampleLineCandidates(lines, carries);
  const candidates = own !== undefined && texts.includes(own.text) ? [own.text] : texts;
  if (candidates.length === 0) return dropped('quote-gone');
  if (candidates.length > 1) return dropped('quote-ambiguous');
  const line = readLedgerLine({ ...r, lineText: candidates[0] });
  if (!('exampleId' in line)) throw new Error('it is not an example record.');
  return { kind: 'upgraded', line };
}

/**
 * The distinct texts of the lines carrying one of a record's quotes. A record often quotes the
 * section's citation header beside its example; when other lines carry a quote too, a bare header
 * is left out, since it is never the example's own line.
 */
function exampleLineCandidates(lines: readonly { text: string }[], carries: (text: string) => boolean): string[] {
  const texts = [...new Set(lines.filter((l) => carries(l.text)).map((l) => l.text))];
  const content = texts.filter((t) => !isCitationHeaderLine(t));
  return content.length > 0 ? content : texts;
}

/** The verbatim slice text a record quotes, trimmed, empties left out. */
function recordQuotes(r: Record<string, unknown>): string[] {
  const translation = r.translation as { sourceText?: unknown } | undefined;
  const quotes = [
    ...(Array.isArray(r.supportingQuoteLines) ? r.supportingQuoteLines : []),
    translation?.sourceText,
    r.contradictionA,
    r.contradictionB,
  ];
  return quotes.flatMap((q) => (typeof q === 'string' && q.trim().length > 0 ? [q.trim()] : []));
}

const DROP_REASONS: Record<DropReason, (d: { slicePath: string }) => string> = {
  'quote-gone': (d) => `its quote is no longer in ${d.slicePath}.`,
  'quote-ambiguous': (d) =>
    `its quote is on several lines of ${d.slicePath}, or on a line another record holds, so which ` +
    `line is its example cannot be told.`,
  'slice-gone': (d) => `its slice ${d.slicePath} no longer exists.`,
  'slice-recorded-again': (d) => `${d.slicePath} is recorded again, which replaces this record too.`,
};

async function printUpgrade(
  projectDir: string,
  result: ExampleLedgerUpgradeResult,
  decisions: readonly Decision[],
): Promise<void> {
  const exists = await fs.access(resolve(projectDir, result.ledgerPath)).then(
    () => true,
    () => false,
  );
  if (result.upgraded.length === 0 && result.dropped.length === 0) {
    console.log(
      chalk.green(
        exists
          ? `✓ Nothing to upgrade: every record in ${result.ledgerPath} already carries lineText.`
          : `✓ Nothing to upgrade: this project has no example-replay ledger.`,
      ),
    );
    return;
  }
  console.log(
    chalk.green(
      `✓ Upgraded ${result.upgraded.length} record(s) in ${result.ledgerPath}: each now carries the ` +
        `text of the slice line it cites, and keeps its verdict.`,
    ),
  );
  printMovedAndDropped(result, decisions);
}

/** The records the upgrade moved, and those it dropped with why and what to record again. */
function printMovedAndDropped(result: ExampleLedgerUpgradeResult, decisions: readonly Decision[]): void {
  if (result.reanchored.length > 0) {
    console.log(`  Moved ${result.reanchored.length} of them to the line their example is now on:`);
    for (const m of result.reanchored) console.log(`    ${m.from} → ${m.to}`);
  }
  if (result.dropped.length === 0) return;
  console.log(chalk.yellow(`  ⚠ Dropped ${result.dropped.length} record(s) it could not upgrade:`));
  for (const d of decisions) {
    if (d.kind === 'dropped') console.log(`    ${d.exampleId}: ${DROP_REASONS[d.reason](d)}`);
  }
  if (result.slicesToRecordAgain.length > 0) {
    console.log(
      `  Record the worked examples of ${result.slicesToRecordAgain.join(', ')} again: ` +
        '`boardsmith verify-example-replay` lists them as pending.',
    );
  }
}
