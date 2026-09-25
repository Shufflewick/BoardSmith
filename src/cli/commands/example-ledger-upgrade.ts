import { promises as fs } from 'node:fs';
import { relative, resolve } from 'node:path';
import chalk from 'chalk';
import { readFencedJsonLedger } from '../lib/fenced-json-ledger.js';
import { readLiveSlices } from './verify-derive-check.js';
import { buildExampleExtractionPayload } from './example-derivation.js';
import {
  exampleReplayLedgerFile,
  isPreLineTextRecord,
  partitionLedgerLines,
  readLedgerLine,
  writeExampleReplayLedger,
  type ExampleReplayRecord,
  type SliceWithoutExamplesRecord,
} from './verify-example-replay.js';

/**
 * `boardsmith verify-example-ledger-upgrade` — the one-time upgrade of an example-replay ledger
 * written before #350 gave every record its `lineText` (#371). Every other reader refuses such a
 * ledger and names this command; the ledger format itself stays strict.
 *
 * For each record without `lineText`, it reads the slice line the record's `lineNumber` names. When
 * that line still carries one of the record's own quotes (`supportingQuoteLines`, the translated
 * test's `sourceText`, or a contradiction excerpt), the line's text becomes its `lineText` and
 * every other field is kept. Otherwise the record is dropped and named, and so is every other
 * record of its slice: `verify-example-record` replaces a whole slice, so that slice is simply
 * recorded again, and `verify-example-replay` reports it pending until it is. A record whose slice
 * no longer exists is dropped and named too.
 *
 * Everything is decided before anything is written, in one ledger write, and nothing is written
 * when there is nothing to upgrade. A record that is malformed for any other reason refuses the
 * whole upgrade.
 */

type DropReason = 'line-changed' | 'slice-gone' | 'slice-recorded-again';

interface DroppedRecord {
  exampleId: string;
  reason: DropReason;
}

interface ExampleLedgerUpgradeResult {
  ledgerPath: string;
  /** Records that now carry `lineText`, in ledger order. */
  upgraded: string[];
  dropped: DroppedRecord[];
  /** Slices whose worked examples must be recorded again, in path order. */
  slicesToRecordAgain: string[];
}

type LedgerLine = ExampleReplayRecord | SliceWithoutExamplesRecord;

/** What the upgrade decided for one ledger line, before anything is written. */
type Decision =
  | { kind: 'keep'; line: LedgerLine }
  | { kind: 'upgraded'; line: ExampleReplayRecord }
  | { kind: 'dropped'; exampleId: string; slicePath: string; lineNumber: number; reason: DropReason };

export async function exampleLedgerUpgradeCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<ExampleLedgerUpgradeResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const file = exampleReplayLedgerFile(projectDir);
  const ledgerPath = relative(projectDir, file.path);
  const slices = new Map((await readLiveSlices(projectDir)).map((s) => [s.path, s.text]));

  const raw = await readFencedJsonLedger(file, (r) => r);
  const decisions = raw.map((r, i) => decide(r, i, slices));

  const slicesToRecordAgain = [
    ...new Set(decisions.flatMap((d) => (d.kind === 'dropped' && d.reason === 'line-changed' ? [d.slicePath] : []))),
  ].sort();
  const final = decisions.map((d): Decision => {
    if (d.kind === 'dropped' || !slicesToRecordAgain.includes(d.line.slicePath)) return d;
    const exampleId = 'exampleId' in d.line ? d.line.exampleId : d.line.slicePath;
    const lineNumber = 'lineNumber' in d.line ? d.line.lineNumber : 0;
    return { kind: 'dropped', exampleId, slicePath: d.line.slicePath, lineNumber, reason: 'slice-recorded-again' };
  });

  const upgraded = final.flatMap((d) => (d.kind === 'upgraded' ? [d.line.exampleId] : []));
  const dropped = final.flatMap((d) => (d.kind === 'dropped' ? [{ exampleId: d.exampleId, reason: d.reason }] : []));
  if (upgraded.length > 0 || dropped.length > 0) {
    const kept = final.flatMap((d) => (d.kind === 'dropped' ? [] : [d.line]));
    await writeExampleReplayLedger(projectDir, partitionLedgerLines(kept, ledgerPath));
  }

  const result: ExampleLedgerUpgradeResult = { ledgerPath, upgraded, dropped, slicesToRecordAgain };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    await printUpgrade(projectDir, result, final);
  }
  return result;
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

/** A pre-lineText record, upgraded from the slice line it names, or dropped with the reason. */
function upgradeRecord(r: Record<string, unknown>, slices: ReadonlyMap<string, string>): Decision {
  const slicePath = String(r.slicePath ?? '');
  const lineNumber = Number(r.lineNumber);
  const dropped = (reason: DropReason): Decision => ({
    kind: 'dropped',
    exampleId: String(r.exampleId ?? ''),
    slicePath,
    lineNumber,
    reason,
  });
  const sliceText = slices.get(slicePath);
  if (sliceText === undefined) return dropped('slice-gone');
  const lineText = extractionLineText(slicePath, sliceText, lineNumber);
  if (lineText === undefined || !recordQuotes(r).some((q) => lineText.includes(q))) {
    return dropped('line-changed');
  }
  const line = readLedgerLine({ ...r, lineText });
  if (!('exampleId' in line)) throw new Error('it is not an example record.');
  return { kind: 'upgraded', line };
}

/** The text of `lineNumber` as the extractor was shown it, if the extractor is shown that line. */
function extractionLineText(slicePath: string, sliceText: string, lineNumber: number): string | undefined {
  return buildExampleExtractionPayload({ path: slicePath, text: sliceText }).lines.find(
    (l) => l.lineNumber === lineNumber,
  )?.text;
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

const DROP_REASONS: Record<DropReason, (d: { slicePath: string; lineNumber: number }) => string> = {
  'line-changed': (d) => `line ${d.lineNumber} of ${d.slicePath} no longer carries the example it recorded.`,
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
