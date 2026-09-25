import { designChunksDir, designRulebookDir } from '../lib/project-paths.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { atomicWriteFile } from './verify-run.js';
import { readFencedJsonLedger, type FencedJsonLedgerFile } from '../lib/fenced-json-ledger.js';
import {
  readLiveSlices,
  readSliceArgument,
  parseSubagentJsonInput,
  type SubagentJsonParseResult,
} from './verify-derive-check.js';
import { resolveCitedSlices } from './chunk-provenance.js';
import { QuoteVerifiedProvenance } from './verify-enumerate.js';
import {
  WORKED_EXAMPLE_KINDS,
  workedExampleId,
  buildExampleExtractionPayload,
  buildExampleTranslationPayload,
  collectGameApiSurface,
  createWorkedExampleSpec,
  collectWorkedExampleSpecs,
  assertValidExampleLineNumbers,
  type ExampleExtractionPayload,
  type WorkedExampleKind,
  type WorkedExampleSpec,
} from './example-derivation.js';

/**
 * `verify-example-replay.ts` — CHECK-06's ledger + read/report command, mirroring the LIVE
 * CHECK-04 pairing (`verify-derive-check.ts`) in structure: a frozen verdict enum, ONE
 * choke-point constructor (`createExampleReplayRecord`), an atomic upsert-append ledger triad,
 * and a read-only `--json` command that exits 0 unconditionally.
 *
 * This module copies the STRUCTURE 177.1's code review verified intact on the CHECK-04 ledger —
 * atomic upsert-append (CR-06), fence-injection rejection at the single construction site
 * (CR-04), read-path revalidation through that same choke point (CR-02), and an evidence
 * requirement so a verdict citing nothing is never a valid record (WR-05 analog). It does NOT
 * import any of the retired blind-derivation module's per-line judgment machinery — that solved
 * a different problem (178-RESEARCH Pitfall 3): CHECK-04 re-derives a value; CHECK-06 replays a
 * worked example's expected outcome against the real engine.
 *
 * Two commands write the ledger: `verify-example-record` records what the extractor and
 * translator returned (a slice with no worked example as a `SliceWithoutExamplesRecord`, #370), and `verify-example-run` (`example-test-run.ts`) records what running the
 * emitted tests observed. `ingest-check` only moves a record to the line its text is now on
 * (`reanchorExampleLedger`, #350). This module's own
 * `verifyExampleReplayCommand` is read-only: it never dispatches a subagent and never assigns
 * `process.exitCode`, including when every recorded verdict is `disagrees` (178-CONTEXT.md
 * decision 11 — CHECK-06 REPORTS, exit 0, and never gates).
 */

// -------------------------------------------------------------------------------------------
// Task 1 — EXAMPLE_REPLAY_VERDICTS + createExampleReplayRecord (the record choke point)
// -------------------------------------------------------------------------------------------

/**
 * The frozen verdict set. Unlike `DERIVE_CHECK_VERDICTS` (`verify-derive-check.ts`),
 * which is compile-time tied to an EXTERNALLY-imported `DerivedLineClassification` union, this
 * set has no external type to drift from — it IS the canonical source of truth for
 * `ExampleReplayVerdict`, and the type below is derived directly from it (`(typeof
 * EXAMPLE_REPLAY_VERDICTS)[number]`), which is definitionally exhaustive by construction: there
 * is no second declaration of the union anywhere in this module for the array to drift against.
 *
 * Each example moves through these explicitly (#319):
 *
 *   - `example-inconsistent` — decided by the extractor; final.
 *   - `unexecutable` — decided by the translator, with a named reason; final.
 *   - `not-run` — the translator wrote a test, `verify-example-record` stored it, and nothing
 *     has run it yet. It is not an outcome: `verify-example-run` runs the emitted test and
 *     replaces it with `agrees` (the test passed) or `disagrees` (it failed). Those two are
 *     only ever observed, never taken from the translator's `verdictHint`.
 */
export const EXAMPLE_REPLAY_VERDICTS = Object.freeze([
  'agrees',
  'disagrees',
  'example-inconsistent',
  'unexecutable',
  'not-run',
] as const);

export type ExampleReplayVerdict = (typeof EXAMPLE_REPLAY_VERDICTS)[number];

/** The verdicts whose record carries a translated test (`ExampleReplayRecord.translation`). */
const TRANSLATED_VERDICTS: readonly ExampleReplayVerdict[] = Object.freeze([
  'not-run',
  'agrees',
  'disagrees',
]);

function isExampleReplayVerdict(value: string): value is ExampleReplayVerdict {
  return (EXAMPLE_REPLAY_VERDICTS as readonly string[]).includes(value);
}

/** The two provenance states plan 178-04's `QuoteVerifiedProvenance` gating decides between. */
export type ExampleReplayProvenance = 'quote-verified' | 'quote-unverified';

const EXAMPLE_REPLAY_PROVENANCE_VALUES: readonly ExampleReplayProvenance[] = Object.freeze([
  'quote-verified',
  'quote-unverified',
]);

function isExampleReplayProvenance(value: string): value is ExampleReplayProvenance {
  return (EXAMPLE_REPLAY_PROVENANCE_VALUES as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------------------------
// EXAMPLE_REPLAY_LEDGER_BEGIN / END — the ledger's own fence markers (CR-04)
// -------------------------------------------------------------------------------------------

export const EXAMPLE_REPLAY_LEDGER_BEGIN = '<!-- boardsmith:example-replay-verdicts:begin -->';
export const EXAMPLE_REPLAY_LEDGER_END = '<!-- boardsmith:example-replay-verdicts:end -->';

// -------------------------------------------------------------------------------------------
// ExampleReplayRecord
// -------------------------------------------------------------------------------------------

/**
 * The set of `kind` values a RECORD may carry — a strict superset of `WORKED_EXAMPLE_KINDS`
 * (`transition`/`predicate`, which is what a `WorkedExampleSpec` may be). An `example-inconsistent`
 * extraction entry never becomes a spec (`createWorkedExampleSpec` only accepts
 * `WORKED_EXAMPLE_KINDS`, deliberately — decision 4 forbids ever picking a side, and a spec implies
 * a single agreed-on example to build a test from) but IS a legitimate record: the extractor
 * already decided the example contradicts its own source, and that decision is exactly what this
 * record exists to preserve. This is the record-level (not spec-level) widening — it never loosens
 * `WORKED_EXAMPLE_KINDS` itself, so `createWorkedExampleSpec`/`buildExampleTranslationPayload` are
 * untouched.
 */
const EXAMPLE_REPLAY_RECORD_KINDS = Object.freeze([
  ...WORKED_EXAMPLE_KINDS,
  'example-inconsistent',
] as const);

/**
 * The test a translator wrote for one example, stored on its record so the emitted file can be
 * regenerated from the ledger alone. `pageCitation` and `sourceText` come from the extractor's
 * spec and head the emitted test as a comment, so a failing test traces back to its rulebook line.
 */
export interface ExampleTranslation {
  readonly pageCitation: string;
  readonly sourceText: string;
  /** One self-contained `it(...)` block, exactly as the translator returned it. */
  readonly testCode: string;
  /** Single-line `import ... ;` statements `testCode` depends on. */
  readonly imports: readonly string[];
}

export interface ExampleReplayRecord {
  /** Caller-assigned (`workedExampleId({ slicePath, lineNumber })`) — never a model-returned field. */
  readonly exampleId: string;
  readonly slicePath: string;
  /** 1-based, matching the slice file's own line numbering. */
  readonly lineNumber: number;
  /**
   * The trimmed text of line `lineNumber` when the example was recorded (#350). It is what ties
   * the record to its slice: a slice edited above the example moves the text to another line, and
   * `findUnanchoredExamples` finds it there, or reports that it is gone.
   */
  readonly lineText: string;
  readonly kind: WorkedExampleKind | 'example-inconsistent';
  readonly verdict: ExampleReplayVerdict;
  /** The reasoning IS the artifact — required for every verdict, not only `unexecutable`. */
  readonly reason: string;
  /**
   * The example's expected outcome, from the extractor's spec, on every translated record
   * (`not-run`/`agrees`/`disagrees`); required non-empty for `disagrees`; '' otherwise.
   */
  readonly expected: string;
  /** `disagrees` only (required, non-empty); '' for every other verdict. */
  readonly observed: string;
  /** `example-inconsistent` only (required, non-empty); '' for every other verdict. */
  readonly contradictionA: string;
  /** `example-inconsistent` only (required, non-empty); '' for every other verdict. */
  readonly contradictionB: string;
  readonly supportingQuoteLines: readonly string[];
  /** Set by plan 178-04's write surface — never inferred here. */
  readonly provenance: ExampleReplayProvenance;
  /** ISO 8601, UTC. */
  readonly recordedAt: string;
  /** Present only when a generated test file backs this record. */
  readonly testFilePath?: string;
  /** Present exactly when `verdict` is `not-run`, `agrees` or `disagrees`. */
  readonly translation?: ExampleTranslation;
}

/**
 * Validates and constructs an `ExampleReplayRecord`. This is the ONLY place a verdict string is
 * checked against `EXAMPLE_REPLAY_VERDICTS`; every recording path AND the read path
 * (`readExampleReplayVerdicts`, CR-02) route through it. Throws when:
 *
 *   - `verdict` is outside `EXAMPLE_REPLAY_VERDICTS` (message names every legal verdict)
 *   - `kind` is outside `WORKED_EXAMPLE_KINDS`
 *   - `provenance` is outside the two legal provenance values
 *   - `reason` is empty or whitespace-only — the reason IS the artifact, required for every
 *     verdict (a strict superset of the `unexecutable`-only requirement this check exists to
 *     satisfy)
 *   - `lineText` is empty — a record that cannot say which text it cites cannot be checked
 *     against its slice (#350)
 *   - `verdict === 'disagrees'` and `expected` or `observed` is empty
 *   - `verdict === 'example-inconsistent'` and `contradictionA` or `contradictionB` is empty
 *   - `reason`, `lineText`, `expected`, `observed`, `contradictionA`, `contradictionB`, `testFilePath`, or any
 *     `supportingQuoteLines` string contains the ledger's own begin/end fence marker (CR-04),
 *     naming the offending field
 *   - `exampleId` does not equal `workedExampleId({ slicePath, lineNumber })` for the record's
 *     own fields — identity is caller-assigned, never model-supplied
 *
 * Modeled as `if` blocks inside this function and the private helpers only it calls — never a
 * second validator elsewhere in the module.
 */
export function createExampleReplayRecord(input: {
  exampleId: string;
  slicePath: string;
  lineNumber: number;
  lineText: string;
  kind: string;
  verdict: string;
  reason: string;
  expected?: string;
  observed?: string;
  contradictionA?: string;
  contradictionB?: string;
  supportingQuoteLines?: string[];
  provenance: string;
  recordedAt?: string;
  testFilePath?: string;
  translation?: ExampleTranslation;
}): ExampleReplayRecord {
  const location = `${input.slicePath}:${input.lineNumber}`;

  if (!isExampleReplayVerdict(input.verdict)) {
    throw new Error(
      `Invalid verdict "${input.verdict}" for ${location}.\n` +
        `Expected one of: ${EXAMPLE_REPLAY_VERDICTS.join(', ')}.`,
    );
  }
  if (!(EXAMPLE_REPLAY_RECORD_KINDS as readonly string[]).includes(input.kind)) {
    throw new Error(
      `Invalid kind "${input.kind}" for the example-replay record at ${location}.\n` +
        `Expected one of: ${EXAMPLE_REPLAY_RECORD_KINDS.join(', ')}.`,
    );
  }
  if (!isExampleReplayProvenance(input.provenance)) {
    throw new Error(
      `Invalid provenance "${input.provenance}" for ${location}.\n` +
        `Expected one of: ${EXAMPLE_REPLAY_PROVENANCE_VALUES.join(', ')}.`,
    );
  }
  assertReasonAndLineText(location, input.reason, input.lineText);

  const expected = input.expected ?? '';
  const observed = input.observed ?? '';
  const contradictionA = input.contradictionA ?? '';
  const contradictionB = input.contradictionB ?? '';
  const supportingQuoteLines = input.supportingQuoteLines ?? [];

  if (
    input.verdict === 'disagrees' &&
    (expected.trim().length === 0 || observed.trim().length === 0)
  ) {
    throw new Error(
      `${location}'s "disagrees" verdict is missing its expected/observed outcome.\n` +
        `A disagreement must cite BOTH the expected outcome and the observed outcome, verbatim ` +
        `— a disagreement citing neither is not a valid record.`,
    );
  }
  if (
    input.verdict === 'example-inconsistent' &&
    (contradictionA.trim().length === 0 || contradictionB.trim().length === 0)
  ) {
    throw new Error(
      `${location}'s "example-inconsistent" verdict is missing one of its contradicting excerpts.\n` +
        `An example-inconsistent finding must cite BOTH contradicting verbatim excerpts ` +
        `(contradictionA and contradictionB) — citing only one is not a valid record.`,
    );
  }

  const translation = input.translation;
  assertTranslationFitsVerdict(location, input.verdict, translation);

  const fenceCheckFields: [string, string][] = [
    ['reason', input.reason],
    ['lineText', input.lineText],
    ['expected', expected],
    ['observed', observed],
    ['contradictionA', contradictionA],
    ['contradictionB', contradictionB],
    ...(input.testFilePath ? ([['testFilePath', input.testFilePath]] as [string, string][]) : []),
    ...supportingQuoteLines.map((line, i): [string, string] => [`supportingQuoteLines[${i}]`, line]),
    ...translationFenceFields(translation),
  ];
  for (const [field, value] of fenceCheckFields) {
    if (value.includes(EXAMPLE_REPLAY_LEDGER_BEGIN) || value.includes(EXAMPLE_REPLAY_LEDGER_END)) {
      throw new Error(
        `${location}'s ${field} contains a ledger fence marker.\n` +
          `Re-dispatch the subagent; an example-replay field may never carry the ledger's own ` +
          `delimiters.`,
      );
    }
  }

  const expectedId = workedExampleId({ slicePath: input.slicePath, lineNumber: input.lineNumber });
  if (input.exampleId !== expectedId) {
    throw new Error(
      `The example-replay record's exampleId "${input.exampleId}" does not match ` +
        `workedExampleId({ slicePath: "${input.slicePath}", lineNumber: ${input.lineNumber} }) ` +
        `("${expectedId}").\n` +
        `exampleId must be caller-assigned from the example's own slicePath/lineNumber — never a ` +
        `model-supplied value.`,
    );
  }

  return Object.freeze({
    exampleId: input.exampleId,
    slicePath: input.slicePath,
    lineNumber: input.lineNumber,
    lineText: input.lineText,
    kind: input.kind as WorkedExampleKind | 'example-inconsistent',
    verdict: input.verdict,
    reason: input.reason,
    expected,
    observed,
    contradictionA,
    contradictionB,
    supportingQuoteLines: Object.freeze([...supportingQuoteLines]),
    provenance: input.provenance,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    ...(input.testFilePath ? { testFilePath: input.testFilePath } : {}),
    ...(translation ? { translation: frozenTranslation(translation) } : {}),
  });
}

/** Every record says why it has its verdict, and which slice text it cites (#350). */
function assertReasonAndLineText(location: string, reason: string, lineText: string): void {
  if (reason.trim().length === 0) {
    throw new Error(
      `${location}'s verdict has no recorded reason.\n` +
        `The reason is the artifact this check exists to produce — a verdict label with no ` +
        `reason is not a valid record.`,
    );
  }
  if (lineText.trim().length === 0) {
    throw new Error(
      `${location} carries no lineText, the text of the slice line the example was recorded on.\n` +
        `Without it a record cannot be checked against its slice once the slice changes. Record ` +
        `the slice again with verify-example-record, which stores it.`,
    );
  }
}

/** A translated test belongs on a not-run, agrees or disagrees record, and only there. */
function assertTranslationFitsVerdict(
  location: string,
  verdict: ExampleReplayVerdict,
  translation: ExampleTranslation | undefined,
): void {
  const translated = TRANSLATED_VERDICTS.includes(verdict);
  if (translated && translation === undefined) {
    throw new Error(
      `${location}'s "${verdict}" verdict carries no translated test.\n` +
        `A "${verdict}" record is about a test the translator wrote, so it must carry that test ` +
        `(its testCode and imports) — record it through verify-example-record.`,
    );
  }
  if (!translated && translation !== undefined) {
    throw new Error(
      `${location}'s "${verdict}" verdict carries a translated test.\n` +
        `Only a not-run, agrees or disagrees record is backed by a test.`,
    );
  }
}

function translationFenceFields(translation: ExampleTranslation | undefined): [string, string][] {
  if (translation === undefined) return [];
  return [
    ['translation.pageCitation', translation.pageCitation],
    ['translation.sourceText', translation.sourceText],
    ['translation.testCode', translation.testCode],
    ...translation.imports.map((imp, i): [string, string] => [`translation.imports[${i}]`, imp]),
  ];
}

function frozenTranslation(translation: ExampleTranslation): ExampleTranslation {
  return Object.freeze({
    pageCitation: translation.pageCitation,
    sourceText: translation.sourceText,
    testCode: translation.testCode,
    imports: Object.freeze([...translation.imports]),
  });
}

// -------------------------------------------------------------------------------------------
// SliceWithoutExamplesRecord — a slice checked and found to hold no worked example (#370)
// -------------------------------------------------------------------------------------------

/**
 * A slice whose extraction returned `{ "examples": [] }`. It has no example records to say it was
 * checked, so without this it would be reported pending forever. `extractionHash` fingerprints the
 * lines the extractor was shown (`sliceExtractionHash`): when they change, the slice may have
 * gained an example, and `verify-example-replay` reports it pending again. A slice never has both
 * this record and example records.
 */
export interface SliceWithoutExamplesRecord {
  readonly slicePath: string;
  readonly noWorkedExamples: true;
  readonly extractionHash: string;
  /** ISO 8601, UTC. */
  readonly recordedAt: string;
}

/**
 * The SHA-256 of the text of every line `buildExampleExtractionPayload` retains, in order and
 * without line numbers, so a line added the extractor never reads (a `Source:` line) or a line
 * moving leaves it unchanged, and any change to what the extractor reads changes it.
 */
function sliceExtractionHash(slice: { path: string; text: string }): string {
  const { lines } = buildExampleExtractionPayload(slice);
  return createHash('sha256')
    .update(lines.map((l) => l.text).join('\n'))
    .digest('hex');
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Validates and constructs a `SliceWithoutExamplesRecord`, on the write path and the read path. */
function createSliceWithoutExamplesRecord(input: {
  slicePath: string;
  extractionHash: string;
  recordedAt?: string;
}): SliceWithoutExamplesRecord {
  if (input.slicePath.trim().length === 0) {
    throw new Error('A no-worked-examples record names no slicePath.');
  }
  if (!SHA256_HEX_RE.test(input.extractionHash)) {
    throw new Error(
      `${input.slicePath}'s no-worked-examples record has no valid extractionHash.\n` +
        `Record the slice again with verify-example-record, which computes it.`,
    );
  }
  return Object.freeze({
    slicePath: input.slicePath,
    noWorkedExamples: true,
    extractionHash: input.extractionHash,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  });
}

// -------------------------------------------------------------------------------------------
// Task 2 — exampleReplayLedgerPath / replaceExampleReplayVerdicts / recordExampleReplayVerdicts /
// readExampleReplayVerdicts — the atomic upsert-append ledger triad (CR-02/CR-04/CR-06)
// -------------------------------------------------------------------------------------------

/**
 * The project-level ledger path — `rulebook/.example-replay/EXAMPLE-VERDICTS.md`. No `.verify/`
 * segment, no `runId` anywhere in this path: CHECK-06 has nothing to scope to a run, exactly
 * like its CHECK-04 sibling.
 */
export function exampleReplayLedgerPath(projectDir: string): string {
  return join(designRulebookDir(projectDir), '.example-replay', 'EXAMPLE-VERDICTS.md');
}

function exampleReplayKey(r: Pick<ExampleReplayRecord, 'exampleId'>): string {
  return r.exampleId;
}

/** Everything the ledger holds: example records, and the slices recorded as having none (#370). */
interface ExampleReplayLedger {
  records: ExampleReplayRecord[];
  slicesWithoutExamples: SliceWithoutExamplesRecord[];
}

/**
 * Throws when the ledger would say two things about one slice: that it has examples and that it
 * has none, or that it has none twice. Checked on every write and every read.
 */
function assertOneAnswerPerSlice(ledger: ExampleReplayLedger, where: string): void {
  const withExamples = new Set(ledger.records.map((r) => r.slicePath));
  const seen = new Set<string>();
  for (const { slicePath } of ledger.slicesWithoutExamples) {
    if (withExamples.has(slicePath) || seen.has(slicePath)) {
      throw new Error(
        `${where} records ${slicePath} both as having worked examples and as having none, or as ` +
          `having none twice.\nRecord the slice again with verify-example-record, which replaces ` +
          `everything the ledger holds for it.`,
      );
    }
    seen.add(slicePath);
  }
}

/**
 * The ONE durable write: the whole ledger, through `atomicWriteFile`. Example records keep the
 * order given; the no-examples records follow them, in slice order.
 */
export async function writeExampleReplayLedger(
  projectDir: string,
  ledger: ExampleReplayLedger,
): Promise<{ ledgerPath: string }> {
  const ledgerPath = exampleReplayLedgerPath(projectDir);
  assertOneAnswerPerSlice(ledger, `The example-replay ledger write to ${relative(projectDir, ledgerPath)}`);
  const lines = [
    ...ledger.records,
    ...[...ledger.slicesWithoutExamples].sort((a, b) => a.slicePath.localeCompare(b.slicePath)),
  ].map((r) => JSON.stringify(r));
  const content =
    `# Example Replay Verdicts (CHECK-06) — project-level, not scoped to any run\n\n` +
    `${EXAMPLE_REPLAY_LEDGER_BEGIN}\n` +
    lines.join('\n') +
    (lines.length > 0 ? '\n' : '') +
    `${EXAMPLE_REPLAY_LEDGER_END}\n`;
  await fs.mkdir(dirname(ledgerPath), { recursive: true });
  await atomicWriteFile(ledgerPath, content);
  return { ledgerPath: relative(projectDir, ledgerPath) };
}

/**
 * Replaces every example record in the ledger with exactly `records`, keeping the slices recorded
 * as having no worked examples. A full rewrite, never the callable the workflow uses per-batch
 * (see `recordExampleReplayVerdicts` for that).
 */
export async function replaceExampleReplayVerdicts(
  projectDir: string,
  records: ExampleReplayRecord[],
): Promise<{ ledgerPath: string }> {
  const { slicesWithoutExamples } = await readExampleReplayLedger(projectDir);
  return writeExampleReplayLedger(projectDir, { records, slicesWithoutExamples });
}

/**
 * Records a BATCH of verdicts, upserting each by `exampleId` (CR-06): reads the ledger's
 * existing records, replaces any record already recorded for the same `exampleId` (keeping every
 * other record untouched, in existing order), appends new ids last (so the ledger diff stays
 * reviewable), then writes the merged set through `replaceExampleReplayVerdicts` — so there is
 * still exactly ONE durable write path in the module. Recording example B's verdict never
 * destroys example A's; re-recording example A replaces A's entry in place.
 */
export async function recordExampleReplayVerdicts(
  projectDir: string,
  records: ExampleReplayRecord[],
): Promise<{ ledgerPath: string }> {
  const existing = await readExampleReplayVerdicts(projectDir);
  const incomingKeys = new Set(records.map((r) => exampleReplayKey(r)));
  const merged = [
    ...existing.filter((r) => !incomingKeys.has(exampleReplayKey(r))),
    ...records,
  ];
  return replaceExampleReplayVerdicts(projectDir, merged);
}

/**
 * Replaces everything the ledger holds for `slicePath` with `records`, or, when there are none,
 * with a record that the slice has no worked examples (`noExamples`, #370). Every other slice is
 * left untouched and in order. `verify-example-record` writes through this because an extraction
 * covers its whole slice: an example recorded earlier at a line the new extraction does not name
 * (a line that has since moved, say) is no longer one of the slice's examples, and an upsert by id
 * would leave it behind (#350).
 */
async function replaceSliceExampleReplayVerdicts(
  projectDir: string,
  slicePath: string,
  recorded: { records: ExampleReplayRecord[] } | { noExamples: SliceWithoutExamplesRecord },
): Promise<{ ledgerPath: string }> {
  const existing = await readExampleReplayLedger(projectDir);
  return writeExampleReplayLedger(projectDir, {
    records: [
      ...existing.records.filter((r) => r.slicePath !== slicePath),
      ...('records' in recorded ? recorded.records : []),
    ],
    slicesWithoutExamples: [
      ...existing.slicesWithoutExamples.filter((s) => s.slicePath !== slicePath),
      ...('noExamples' in recorded ? [recorded.noExamples] : []),
    ],
  });
}

/**
 * Round-trips exactly what the ledger writers wrote. Returns an empty ledger (never throws) when
 * none has been written yet — a project that has never run CHECK-06's recording step has nothing
 * recorded, which is not a tool failure.
 *
 * RE-ENTERS `createExampleReplayRecord` (or `createSliceWithoutExamplesRecord`) ON EVERY PARSED
 * LINE (CR-02): the ledger is a second entry path into those types, not a bypass of them — no
 * `as ExampleReplayRecord` cast may appear anywhere in this module. A hand-edited or out-of-enum
 * ledger record throws through the constructor's own checks rather than reaching the report
 * unvalidated. A malformed JSON line, or a ledger whose fence markers are absent or unbalanced,
 * throws one actionable message naming the ledger's relative path (`readFencedJsonLedger`).
 */
async function readExampleReplayLedger(projectDir: string): Promise<ExampleReplayLedger> {
  const file = exampleReplayLedgerFile(projectDir);
  const relLedgerPath = relative(projectDir, file.path);
  const lines = await readFencedJsonLedger(file, (r) =>
    isPreLineTextRecord(r) ? PRE_LINE_TEXT : readLedgerLine(r),
  );
  const preLineText = lines.filter((line) => line === PRE_LINE_TEXT).length;
  if (preLineText > 0) {
    throw new Error(
      `The example-replay ledger at ${relLedgerPath} has ${preLineText} record(s) written before ` +
        `records carried lineText, the text of the slice line each example cites.\n` +
        `Run \`npx boardsmith verify-example-ledger-upgrade\` once. It fills lineText in from the ` +
        `slices, keeps every recorded verdict it can, and names the records it cannot, whose slices ` +
        `you then record again.`,
    );
  }
  return partitionLedgerLines(lines.filter((line) => line !== PRE_LINE_TEXT), relLedgerPath);
}

/** Stands in for a pre-lineText record while `readExampleReplayLedger` counts them. */
const PRE_LINE_TEXT = Symbol('pre-lineText record');

/**
 * A ledger line written before #350 gave every example record its `lineText`. Only
 * `verify-example-ledger-upgrade` (`example-ledger-upgrade.ts`) reads one; every other reader
 * refuses the ledger and names that command.
 */
export function isPreLineTextRecord(r: Record<string, unknown>): boolean {
  return !isSliceWithoutExamplesLine(r) && r.lineText === undefined;
}

/** One validated ledger line: an example record, or a slice recorded as having none. */
export function readLedgerLine(
  r: Record<string, unknown>,
): ExampleReplayRecord | SliceWithoutExamplesRecord {
  return isSliceWithoutExamplesLine(r) ? readSliceWithoutExamplesLine(r) : readExampleRecordLine(r);
}

/** Sorts validated ledger lines into an `ExampleReplayLedger`, refusing two answers for a slice. */
export function partitionLedgerLines(
  lines: readonly (ExampleReplayRecord | SliceWithoutExamplesRecord)[],
  relLedgerPath: string,
): ExampleReplayLedger {
  const ledger: ExampleReplayLedger = { records: [], slicesWithoutExamples: [] };
  for (const line of lines) {
    if ('noWorkedExamples' in line) ledger.slicesWithoutExamples.push(line);
    else ledger.records.push(line);
  }
  assertOneAnswerPerSlice(ledger, `The example-replay ledger at ${relLedgerPath}`);
  return ledger;
}

export function exampleReplayLedgerFile(projectDir: string): FencedJsonLedgerFile {
  return {
    projectDir,
    path: exampleReplayLedgerPath(projectDir),
    begin: EXAMPLE_REPLAY_LEDGER_BEGIN,
    end: EXAMPLE_REPLAY_LEDGER_END,
    name: 'example-replay',
    remedy: 'Delete the file to re-run CHECK-06 from scratch.',
  };
}

/** A ledger line that records a slice as having no worked examples, not one example (#370). */
function isSliceWithoutExamplesLine(r: Record<string, unknown>): boolean {
  return r.noWorkedExamples !== undefined;
}

/** The example records `readExampleReplayLedger` returns. */
export async function readExampleReplayVerdicts(
  projectDir: string,
): Promise<ExampleReplayRecord[]> {
  return (await readExampleReplayLedger(projectDir)).records;
}

/** The slices `readExampleReplayLedger` returns as recorded with no worked examples (#370). */
export async function readSlicesWithoutExamples(
  projectDir: string,
): Promise<SliceWithoutExamplesRecord[]> {
  return (await readExampleReplayLedger(projectDir)).slicesWithoutExamples;
}

function readSliceWithoutExamplesLine(r: Record<string, unknown>): SliceWithoutExamplesRecord {
  if (r.noWorkedExamples !== true) {
    throw new Error('its noWorkedExamples must be true.');
  }
  return createSliceWithoutExamplesRecord({
    slicePath: String(r.slicePath ?? ''),
    extractionHash: String(r.extractionHash ?? ''),
    recordedAt: r.recordedAt !== undefined ? String(r.recordedAt) : undefined,
  });
}

function readExampleRecordLine(r: Record<string, unknown>): ExampleReplayRecord {
  return createExampleReplayRecord({
    exampleId: String(r.exampleId ?? ''),
    slicePath: String(r.slicePath ?? ''),
    lineNumber: Number(r.lineNumber),
    lineText: String(r.lineText ?? ''),
    kind: String(r.kind ?? ''),
    verdict: String(r.verdict ?? ''),
    reason: String(r.reason ?? ''),
    expected: r.expected !== undefined ? String(r.expected) : '',
    observed: r.observed !== undefined ? String(r.observed) : '',
    contradictionA: r.contradictionA !== undefined ? String(r.contradictionA) : '',
    contradictionB: r.contradictionB !== undefined ? String(r.contradictionB) : '',
    supportingQuoteLines: Array.isArray(r.supportingQuoteLines)
      ? (r.supportingQuoteLines as string[])
      : [],
    provenance: String(r.provenance ?? ''),
    recordedAt: r.recordedAt !== undefined ? String(r.recordedAt) : undefined,
    testFilePath: r.testFilePath !== undefined ? String(r.testFilePath) : undefined,
    translation: readLedgerTranslation(r.translation),
  });
}

/** A ledger line's `translation`, typed field by field so a hand-edited one fails loudly. */
function readLedgerTranslation(raw: unknown): ExampleTranslation | undefined {
  if (raw === undefined) return undefined;
  const t = (raw ?? {}) as Record<string, unknown>;
  if (
    typeof t.pageCitation !== 'string' ||
    typeof t.sourceText !== 'string' ||
    typeof t.testCode !== 'string' ||
    !Array.isArray(t.imports) ||
    !t.imports.every((imp) => typeof imp === 'string')
  ) {
    throw new Error(
      'its translation must carry string pageCitation, sourceText and testCode, and an imports ' +
        'array of strings.',
    );
  }
  return {
    pageCitation: t.pageCitation,
    sourceText: t.sourceText,
    testCode: t.testCode,
    imports: t.imports as string[],
  };
}

// -------------------------------------------------------------------------------------------
// Anchors (#350) — each record is tied to the text of its slice line, not only to its number
// -------------------------------------------------------------------------------------------

/**
 * A recorded example whose slice line no longer holds its `lineText`. `moved`: the text is now on
 * exactly one other line, `movedTo`, that no other record holds. `text-gone`: the slice no longer
 * contains it. `text-ambiguous`: it is on several other lines, or on one another record already
 * holds, so which one the example is cannot be told from the text.
 */
interface UnanchoredExample {
  exampleId: string;
  slicePath: string;
  lineText: string;
  reason: 'moved' | 'text-gone' | 'text-ambiguous';
  movedTo?: number;
}

/** An unanchored example that cannot be moved: its slice must be recorded again. */
type LostExample = Omit<UnanchoredExample, 'movedTo'> & {
  reason: 'text-gone' | 'text-ambiguous';
};

/**
 * Every record in `records` whose slice is among `slices` and whose line no longer reads its
 * `lineText`, in ledger order. A record whose slice is not among `slices` is not checked here.
 * Lines are compared trimmed, the way `buildExampleExtractionPayload` numbered them.
 */
export function findUnanchoredExamples(
  records: readonly ExampleReplayRecord[],
  slices: readonly { path: string; text: string }[],
): UnanchoredExample[] {
  const linesBySlice = new Map(slices.map((s) => [s.path, s.text.split('\n').map((l) => l.trim())]));
  const anchored = (r: ExampleReplayRecord) =>
    linesBySlice.get(r.slicePath)?.[r.lineNumber - 1] === r.lineText;
  const held = new Set(records.filter(anchored).map((r) => r.exampleId));

  const unanchored: UnanchoredExample[] = [];
  for (const r of records) {
    const lines = linesBySlice.get(r.slicePath);
    if (lines === undefined || anchored(r)) continue;
    const at = lines.flatMap((line, i) => (line === r.lineText ? [i + 1] : []));
    const base = { exampleId: r.exampleId, slicePath: r.slicePath, lineText: r.lineText };
    if (at.length === 0) {
      unanchored.push({ ...base, reason: 'text-gone' });
    } else if (at.length > 1 || held.has(workedExampleId({ slicePath: r.slicePath, lineNumber: at[0] }))) {
      unanchored.push({ ...base, reason: 'text-ambiguous' });
    } else {
      unanchored.push({ ...base, reason: 'moved', movedTo: at[0] });
    }
  }
  return unanchored;
}

function isLost(u: UnanchoredExample): u is LostExample {
  return u.reason !== 'moved';
}

export interface ReanchorResult {
  /** Each re-anchored record's old and new exampleId. */
  moved: { from: string; to: string }[];
  /** Records whose text could not be found once; left exactly as they were. */
  lost: LostExample[];
}

/**
 * Moves every recorded example whose text now sits on one other line of its slice to that line
 * (new `lineNumber` and `exampleId`, every other field unchanged), in one ledger write. Records it
 * cannot place are returned in `lost` and left as they are. `ingest-check` runs this, so a slice
 * edited after its examples were recorded (a `Source:` line from `ingest-slice-source`, #311)
 * keeps its ledger pointing at the right lines. Writes nothing when nothing moved.
 */
export async function reanchorExampleLedger(projectDir: string): Promise<ReanchorResult> {
  const records = await readExampleReplayVerdicts(projectDir);
  if (records.length === 0) return { moved: [], lost: [] };
  const unanchored = findUnanchoredExamples(records, await readLiveSlices(projectDir));
  const { rewritten, moved } = moveUnanchoredExamples(records, unanchored);
  if (moved.length > 0) await replaceExampleReplayVerdicts(projectDir, rewritten);
  return { moved, lost: unanchored.filter(isLost) };
}

/**
 * `records` with every `moved` example in `unanchored` moved to the line its text is now on (new
 * `lineNumber` and `exampleId`, every other field unchanged), in the same order. The one place a
 * record is re-anchored: `ingest-check` and `verify-example-ledger-upgrade` both move through it.
 */
export function moveUnanchoredExamples(
  records: readonly ExampleReplayRecord[],
  unanchored: readonly UnanchoredExample[],
): { rewritten: ExampleReplayRecord[]; moved: ReanchorResult['moved'] } {
  const movedTo = new Map<string, number>();
  for (const u of unanchored) if (u.movedTo !== undefined) movedTo.set(u.exampleId, u.movedTo);
  const moved: ReanchorResult['moved'] = [];
  const rewritten = records.map((r) => {
    const lineNumber = movedTo.get(r.exampleId);
    if (lineNumber === undefined) return r;
    const exampleId = workedExampleId({ slicePath: r.slicePath, lineNumber });
    moved.push({ from: r.exampleId, to: exampleId });
    return createExampleReplayRecord({
      ...r,
      exampleId,
      lineNumber,
      supportingQuoteLines: [...r.supportingQuoteLines],
    });
  });
  return { rewritten, moved };
}

/**
 * What to tell a person about unanchored examples, one line each plus the fix: a moved one is
 * re-anchored by `ingest-check`; a lost one needs its slice's examples recorded again.
 */
export function describeUnanchoredExamples(unanchored: readonly UnanchoredExample[]): string[] {
  const lines: string[] = [];
  for (const u of unanchored) {
    const where = u.exampleId;
    if (u.reason === 'moved') {
      lines.push(`  ${where} is now on line ${u.movedTo}.`);
    } else if (u.reason === 'text-gone') {
      lines.push(`  ${where}: its line "${u.lineText}" is no longer in the slice.`);
    } else {
      lines.push(`  ${where}: its line "${u.lineText}" is on several other lines, so it cannot be placed.`);
    }
  }
  if (unanchored.some((u) => u.reason === 'moved')) {
    lines.push('Run `npx boardsmith ingest-check`, which moves each example to the line its text is now on.');
  }
  const lostSlices = [...new Set(unanchored.filter(isLost).map((u) => u.slicePath))];
  if (lostSlices.length > 0) {
    lines.push(
      `Record the worked examples of ${lostSlices.join(', ')} again: \`boardsmith verify-example-replay\` ` +
        `lists ${lostSlices.length === 1 ? 'it' : 'them'} as pending, and verify-example-record replaces ` +
        `everything the slice held.`,
    );
  }
  return lines;
}

/** `verify-example-replay`'s lines about records whose slice line moved or lost their text. */
function printUnanchoredExamples(unanchored: readonly UnanchoredExample[]): void {
  if (unanchored.length === 0) return;
  console.log(
    chalk.yellow(`  ⚠ ${unanchored.length} recorded example(s) no longer sit on the line they cite:`),
  );
  for (const line of describeUnanchoredExamples(unanchored)) console.log(`  ${line}`);
}

/** `verify-example-replay`'s lines about slices recorded as having no worked examples (#370). */
function printSlicesWithoutExamples(slices: readonly VerifyExampleReplaySlice[]): void {
  const recorded = slices.filter((s) => s.noWorkedExamples === 'recorded');
  const changed = slices.filter((s) => s.noWorkedExamples === 'slice-changed');
  if (recorded.length > 0) {
    console.log(`  ${recorded.length} slice(s) checked and recorded as having no worked examples.`);
  }
  if (changed.length > 0) {
    console.log(
      chalk.yellow(
        `  ⚠ ${changed.length} slice(s) recorded as having no worked examples have changed since, ` +
          `so they are pending again: extract and record each once more.`,
      ),
    );
    for (const s of changed) console.log(`    ${s.slicePath}`);
  }
}

// -------------------------------------------------------------------------------------------
// Task 3 — verifyExampleReplayCommand — the read/report surface
// -------------------------------------------------------------------------------------------

export interface VerifyExampleReplayOptions {
  project?: string;
  json?: boolean;
  chunk?: string;
}

/**
 * The single named reason a slice is reported `notDispatchable` (178-12) — frozen to one member
 * today, declared as a union rather than a bare string so a future second reason has a home
 * without a shape change at every call site.
 */
export type ExampleReplayNotDispatchableReason = 'no-extractable-content';

export interface VerifyExampleReplaySlice {
  slicePath: string;
  /** The exact `buildExampleExtractionPayload(...).payload` bytes for this slice. */
  extractionPayload?: string;
  /** Names the slice `buildExampleExtractionPayload` threw for; never dispatched when set. */
  extractionError?: string;
  /**
   * Named, machine-readable reason this slice was NEVER offered an `extractionPayload` at all
   * (178-12) — distinct from `extractionError`: this is not a thrown defect, it is the normal,
   * expected state of a slice whose text carries zero lines `isExtractionLine` retains (a
   * `buildExampleExtractionPayload(...).lines.length === 0` slice). Dispatching such a slice's
   * near-empty payload (just the handshake token + `Slice:` header, no content) asks a model to
   * "extract" from nothing; the model's only correct response is to decline, which is exactly the
   * "malformed response" 178-11's live proof measured and mis-attributed to model unreliability —
   * see `178-PROOF.md` §11. Report it mechanically here instead of ever constructing that
   * dispatch. First-class-blindness discipline (this module's own `extractionError` precedent,
   * `verify-ruling-recheck.ts`'s `undetermined` verdict): NAME the state, never drop it silently.
   */
  notDispatchable?: ExampleReplayNotDispatchableReason;
  /**
   * Set when the ledger records this slice as having no worked examples (#370): `recorded` while
   * the lines the extractor reads are unchanged since, `slice-changed` once they have changed
   * (the slice is then pending again, since it may have gained an example).
   */
  noWorkedExamples?: 'recorded' | 'slice-changed';
  /**
   * `true` when the slice has something for the extractor to read and the ledger records neither
   * an example of it nor, for its current text, that it has none; or when one of its recorded
   * examples' text is no longer in it (`unanchored`, #350). A slice with nothing to extract
   * (`notDispatchable`) is pending only in that last case.
   */
  pending: boolean;
}

export interface VerifyExampleReplaySliceBreakdown {
  slicePath: string;
  verdictCounts: Record<ExampleReplayVerdict, number>;
}

export interface VerifyExampleReplayResult {
  projectDir: string;
  slices: VerifyExampleReplaySlice[];
  verdicts: ExampleReplayRecord[];
  /** Raw per-verdict integers — NEVER a percentage. */
  counts: Record<ExampleReplayVerdict, number>;
  perGameBreakdown: VerifyExampleReplaySliceBreakdown[];
  /**
   * Root-level files that LOOK like rulebook source documents but are neither the project's
   * primary archived source nor a hash-verified `## Additional Sources` entry
   * (`QuoteVerifiedProvenance.unarchivedSources`, project-level). Surfaced here rather than
   * swallowed (178-CONTEXT.md decision 12's "never swallow `unarchivedSources`" requirement) —
   * empty for the common single-source project.
   */
  unarchivedSources: readonly string[];
  /**
   * Recorded examples whose slice line no longer holds their text (#350). A slice with a lost
   * one (not merely moved) is reported pending, so its examples get recorded again.
   */
  unanchored: UnanchoredExample[];
}

function emptyExampleReplayVerdictCounts(): Record<ExampleReplayVerdict, number> {
  const counts = {} as Record<ExampleReplayVerdict, number>;
  for (const v of EXAMPLE_REPLAY_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * `boardsmith verify-example-replay` — CHECK-06's read/report surface: enumerates every live
 * rulebook slice PROJECT-WIDE (via `readLiveSlices`, never scoped to a `.verify/<runId>/`
 * staging path), builds each slice's extraction dispatch payload
 * (`buildExampleExtractionPayload`), and joins it to whatever `verify-example-record` (plan
 * 178-04) has already persisted to the project-level ledger.
 *
 * ADVISORY, EXIT 0, NEVER GATES (178-CONTEXT.md decision 11): this function never assigns
 * `process.exitCode` anywhere, including when every recorded verdict is `disagrees`. Only a
 * tool failure (an unreadable project/rulebook, an unresolvable `--chunk`, or a `--chunk` value
 * that escapes the project's `chunks/` directory) throws.
 *
 * No run identifier flag, and no bypass option of any kind — this command is source-free and
 * unscoped by construction, exactly like its `verify-derive-check` sibling.
 */
export async function verifyExampleReplayCommand(
  options: VerifyExampleReplayOptions = {},
): Promise<VerifyExampleReplayResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  // Project-level provenance (178-CONTEXT.md decision 12) — obtained once, purely for reporting
  // `unarchivedSources` here. The per-record `provenance` value each ExampleReplayRecord already
  // carries was decided at RECORD TIME by `verifyExampleRecordCommand` (obtain + `.covers()`
  // against that record's own slicePath) — this command never recomputes or overrides it.
  const provenanceInstance = await QuoteVerifiedProvenance.obtain(projectDir);
  const unarchivedSources: readonly string[] = provenanceInstance?.unarchivedSources ?? [];

  let liveSlices = await readLiveSlices(projectDir);

  if (options.chunk !== undefined) {
    // Path containment guard — mirrors `verify-classify.ts`'s `--live-slice` guard (~line 700):
    // 177.1's code review found a traversal exactly at an unvalidated `--*` option reaching
    // `fs.readFile`. `--chunk` resolves into `chunks/<chunk>/CHUNK.md`; validate BEFORE any read.
    const chunksDir = designChunksDir(projectDir);
    const abs = resolve(chunksDir, options.chunk);
    const rel = relative(chunksDir, abs);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(
        `--chunk "${options.chunk}" resolves outside ${relative(projectDir, chunksDir)}.\n` +
          `Pass a chunk slug relative to the project's chunks directory.`,
      );
    }
    const chunkPath = join(chunksDir, options.chunk, 'CHUNK.md');
    let chunkText: string;
    try {
      chunkText = await fs.readFile(chunkPath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(
        `No chunk named "${options.chunk}" under ${relative(projectDir, chunksDir)} in ` +
          `${projectDir} (${code ?? 'unknown error'}).\n` +
          `Pass a chunk slug matching a directory under chunks/ that contains a CHUNK.md.`,
      );
    }
    const sliceFilenames = liveSlices.map((s) => s.path.slice('rulebook/'.length));
    const { resolved } = resolveCitedSlices(chunkText, sliceFilenames);
    const resolvedSet = new Set(resolved);
    liveSlices = liveSlices.filter((s) => resolvedSet.has(s.path));
  }

  const ledger = await readExampleReplayLedger(projectDir);
  const selectedPaths = new Set(liveSlices.map((s) => s.path));
  const verdicts = ledger.records.filter((v) => selectedPaths.has(v.slicePath));
  const withoutExamples = new Map(ledger.slicesWithoutExamples.map((r) => [r.slicePath, r]));
  const unanchored = findUnanchoredExamples(verdicts, liveSlices);
  const slicesWithLostExamples = new Set(unanchored.filter(isLost).map((u) => u.slicePath));

  const slices: VerifyExampleReplaySlice[] = liveSlices
    .map((s): VerifyExampleReplaySlice => {
      const lost = slicesWithLostExamples.has(s.path);
      const hasExamples = verdicts.some((v) => v.slicePath === s.path);
      let extraction: ExampleExtractionPayload;
      try {
        extraction = buildExampleExtractionPayload({ path: s.path, text: s.text });
      } catch (err) {
        return { slicePath: s.path, extractionError: (err as Error).message, pending: lost || !hasExamples };
      }
      // 178-12: a zero-content slice never gets an `extractionPayload` — see
      // `notDispatchable`'s own doc comment for why this is reported, not thrown. With nothing
      // to extract there is nothing to check, so it is not pending (#370).
      if (extraction.lines.length === 0) {
        return { slicePath: s.path, notDispatchable: 'no-extractable-content', pending: lost };
      }
      const none = withoutExamples.get(s.path);
      if (none === undefined) {
        return { slicePath: s.path, extractionPayload: extraction.payload, pending: lost || !hasExamples };
      }
      const current = none.extractionHash === sliceExtractionHash({ path: s.path, text: s.text });
      return {
        slicePath: s.path,
        extractionPayload: extraction.payload,
        noWorkedExamples: current ? 'recorded' : 'slice-changed',
        pending: !current,
      };
    })
    .sort((a, b) => a.slicePath.localeCompare(b.slicePath));

  const counts = emptyExampleReplayVerdictCounts();
  for (const v of verdicts) counts[v.verdict]++;

  const breakdownBySlice = new Map<string, Record<ExampleReplayVerdict, number>>();
  for (const s of liveSlices) breakdownBySlice.set(s.path, emptyExampleReplayVerdictCounts());
  for (const v of verdicts) {
    const c = breakdownBySlice.get(v.slicePath) ?? emptyExampleReplayVerdictCounts();
    c[v.verdict]++;
    breakdownBySlice.set(v.slicePath, c);
  }
  const perGameBreakdown: VerifyExampleReplaySliceBreakdown[] = [...breakdownBySlice.entries()]
    .map(([slicePath, verdictCounts]) => ({ slicePath, verdictCounts }))
    .sort((a, b) => a.slicePath.localeCompare(b.slicePath));

  const result: VerifyExampleReplayResult = {
    projectDir,
    slices,
    verdicts,
    counts,
    perGameBreakdown,
    unarchivedSources,
    unanchored,
  };

  // `--json` emits the result and nothing else on stdout.
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    chalk.green(
      `✓ Example replay — ${slices.length} slice(s), ${verdicts.length} recorded verdict(s)`,
    ),
  );
  if (verdicts.length < 10) {
    console.log(
      chalk.yellow(
        `  n = ${verdicts.length} — too small to distinguish the mechanism working from luck; ` +
          `read the per-example rows, not the totals.`,
      ),
    );
  }
  for (const v of EXAMPLE_REPLAY_VERDICTS) {
    console.log(`  ${v}: ${counts[v]}`);
  }
  for (const breakdown of perGameBreakdown) {
    const total = Object.values(breakdown.verdictCounts).reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    console.log(`  ${breakdown.slicePath}:`);
    for (const v of EXAMPLE_REPLAY_VERDICTS) {
      if (breakdown.verdictCounts[v] > 0) console.log(`    ${v}: ${breakdown.verdictCounts[v]}`);
    }
  }
  if (unarchivedSources.length > 0) {
    console.log(
      chalk.yellow(
        `  ⚠ ${unarchivedSources.length} unarchived source document(s) present: ` +
          `${unarchivedSources.join(', ')} — a "disagrees" finding against a slice these may ` +
          `cover is downgraded to quote-unverified rather than reported as a confident accusation.`,
      ),
    );
  }

  printUnanchoredExamples(unanchored);
  printSlicesWithoutExamples(slices);

  // 178-CONTEXT.md decision 12: a replay mismatch is grouped into two explicitly-named buckets by
  // the PER-RECORD provenance `verifyExampleRecordCommand` already decided (never recomputed
  // here) — the downgrade never rewrites `verdict` itself, only which bucket/label it is reported
  // under.
  const disagreesVerified = verdicts.filter(
    (v) => v.verdict === 'disagrees' && v.provenance === 'quote-verified',
  );
  const disagreesUnverified = verdicts.filter(
    (v) => v.verdict === 'disagrees' && v.provenance === 'quote-unverified',
  );
  const notRun = verdicts.filter((v) => v.verdict === 'not-run');
  const otherFindings = verdicts.filter(
    (v) => v.verdict === 'unexecutable' || v.verdict === 'example-inconsistent',
  );

  if (disagreesVerified.length > 0) {
    console.log(chalk.yellow(`  mismatch, quotes source-verified:`));
    for (const finding of disagreesVerified) {
      console.log(`    ⚠ ${finding.slicePath}:${finding.lineNumber} — ${finding.reason}`);
    }
  }
  if (disagreesUnverified.length > 0) {
    console.log(
      chalk.yellow(
        `  mismatch, quotes NOT source-verified — read as a question about the quote, not an ` +
          `accusation against the code:`,
      ),
    );
    for (const finding of disagreesUnverified) {
      console.log(`    ⚠ ${finding.slicePath}:${finding.lineNumber} — ${finding.reason}`);
    }
  }
  if (notRun.length > 0) {
    console.log(
      chalk.yellow(
        `  translated but not run yet — run boardsmith verify-example-emit and then ` +
          `boardsmith verify-example-run for a chunk that cites each slice:`,
      ),
    );
    for (const record of notRun) console.log(`    ${record.slicePath}:${record.lineNumber}`);
  }
  for (const finding of otherFindings) {
    console.log(
      chalk.yellow(
        `  ⚠ ${finding.verdict} (worth a human glance, never a verdict) — ` +
          `${finding.slicePath}:${finding.lineNumber}`,
      ),
    );
    console.log(`    Reason: ${finding.reason}`);
  }

  return result;
}

// -------------------------------------------------------------------------------------------
// The extractor's and translator's returns, as the commands read them (#319)
// -------------------------------------------------------------------------------------------

/**
 * One entry of the extractor's return (`verify/extract-example.md` § RETURN). The extractor never
 * returns a slice path or an id: the slice is the caller's `--slice-path`, and the id is assigned
 * from it and `lineNumber`. An `example-inconsistent` entry carries `reason` and
 * `supportingQuoteLines` in place of the spec fields.
 */
interface RawExtractedExample {
  lineNumber: number;
  pageCitation?: string;
  kind: string;
  sourceText?: string;
  setup?: string;
  action?: string;
  expected?: string;
  supportingQuoteLines?: string[];
  reason?: string;
}

async function readSubagentJsonFile(
  filePath: string,
  flagLabel: string,
  command: string,
): Promise<SubagentJsonParseResult> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`${command} could not read ${flagLabel} at "${filePath}".`);
  }
  return parseSubagentJsonInput(text, flagLabel, filePath);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the extractor's return: exactly the one object `verify/extract-example.md` tells it to
 * return, `{ "examples": [...] }`. A bare array, or anything else, is refused with the shape
 * spelled out, because the contract and this reader are one agreement (#319).
 */
async function readExtractorReturn(
  filePath: string,
  command: string,
): Promise<{ examples: RawExtractedExample[]; repairs: string[] }> {
  const parsed = await readSubagentJsonFile(filePath, '--extraction', command);
  const value = parsed.value;
  if (!isPlainObject(value) || !Array.isArray(value.examples)) {
    throw new Error(
      `--extraction at "${filePath}" is not the extractor's return.\n` +
        `verify/extract-example.md has the extractor return one object, { "examples": [ ... ] } ` +
        `(an empty list when the slice has no worked example). Save that return to the file ` +
        `unchanged — do not unwrap it or rebuild it.`,
    );
  }
  value.examples.forEach((entry, i) => {
    if (!isPlainObject(entry) || typeof entry.lineNumber !== 'number' || typeof entry.kind !== 'string') {
      throw new Error(
        `--extraction at "${filePath}": examples[${i}] needs a numeric lineNumber and a kind, as ` +
          `verify/extract-example.md describes. Re-dispatch the extractor; writing nothing.`,
      );
    }
  });
  return { examples: value.examples as RawExtractedExample[], repairs: parsed.repairs };
}

/** A short, non-identifying preview of a colliding entry's text for an error message. */
function shortEntryPreview(text: string, maxLen = 80): string {
  const trimmed = text.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

interface InconsistentExample {
  id: string;
  lineNumber: number;
  reason: string;
  supportingQuoteLines: string[];
}

/**
 * Turns one slice's extractor return into the specs a translator can work from and the
 * `example-inconsistent` findings it cannot — the ONE place both `verify-example-translate` and
 * `verify-example-record` do this, so they can never disagree about an extraction.
 *
 * Identity is the caller's: every id is `workedExampleId({ slicePath: --slice-path, lineNumber })`,
 * and every `lineNumber` is first checked against the lines the extractor was actually shown
 * (CR-03). Two entries at the same line throw rather than replace one another (CR-01/CR-02). An
 * `example-inconsistent` entry must carry its reason; it is never re-judged here.
 */
function readSliceExamples(
  slicePath: string,
  sliceText: string,
  examples: RawExtractedExample[],
): { specsById: Map<string, WorkedExampleSpec>; inconsistent: InconsistentExample[] } {
  assertValidExampleLineNumbers({ path: slicePath, text: sliceText }, examples, '--extraction');

  const seen = new Map<string, RawExtractedExample>();
  for (const entry of examples) {
    const id = workedExampleId({ slicePath, lineNumber: entry.lineNumber });
    const existing = seen.get(id);
    if (existing) {
      throw new Error(
        `--extraction contains two entries resolving to the same slicePath+lineNumber ("${id}").\n` +
          `Existing: ${shortEntryPreview(existing.sourceText ?? existing.reason ?? '')}\n` +
          `New:      ${shortEntryPreview(entry.sourceText ?? entry.reason ?? '')}\n` +
          `Entries are keyed by slicePath+lineNumber, never by returned prose — remove or merge ` +
          `the duplicate before recording. Writing nothing.`,
      );
    }
    seen.set(id, entry);
  }

  const inconsistent: InconsistentExample[] = [];
  const specs: WorkedExampleSpec[] = [];
  for (const entry of examples) {
    const id = workedExampleId({ slicePath, lineNumber: entry.lineNumber });
    if (entry.kind === 'example-inconsistent') {
      const reason = (entry.reason ?? '').trim();
      if (reason.length === 0) {
        throw new Error(
          `${slicePath}:${entry.lineNumber} is marked "example-inconsistent" but carries no ` +
            `reason.\nDeciding it is inconsistent already happened at extraction time; this ` +
            `command never re-judges it, so it cannot proceed without the reason the extractor ` +
            `recorded. Writing nothing.`,
        );
      }
      inconsistent.push({
        id,
        lineNumber: entry.lineNumber,
        reason,
        supportingQuoteLines: entry.supportingQuoteLines ?? [],
      });
      continue;
    }
    specs.push(
      createWorkedExampleSpec({
        id,
        sliceText,
        returned: {
          slicePath,
          lineNumber: entry.lineNumber,
          pageCitation: entry.pageCitation ?? '',
          kind: entry.kind,
          sourceText: entry.sourceText ?? '',
          setup: entry.setup ?? '',
          action: entry.action,
          expected: entry.expected ?? '',
          supportingQuoteLines: entry.supportingQuoteLines,
        },
      }),
    );
  }
  return { specsById: collectWorkedExampleSpecs(specs), inconsistent };
}

/**
 * The translator's named reasons for declining (`verify/translate-example.md` § unexecutable),
 * each with the plain sentence the ledger records beside it.
 */
const UNEXECUTABLE_REASONS: Readonly<Record<string, string>> = Object.freeze({
  'no-matching-symbol': "no exported symbol expresses this example's action or predicate.",
  'unmodeled-component-state':
    'the example depends on component state the game does not model yet.',
  'image-derived-indeterminate':
    'the example comes from an image and is not specific enough to assert an outcome from.',
});

const TRANSLATOR_VERDICT_HINTS: readonly string[] = ['agrees', 'disagrees', 'unexecutable'];

/** What one translator return means for the ledger. */
type TranslatorOutcome =
  | { kind: 'translated'; testCode: string; imports: string[] }
  | { kind: 'unexecutable'; reason: string };

/**
 * Validates one translator return against `verify/translate-example.md` § RETURN — `testCode`,
 * `imports`, `verdictHint`, and `unexecutableReason` exactly when the hint is `unexecutable` —
 * and says what it means. `verdictHint` decides only whether a test exists; `agrees`/`disagrees`
 * is never taken from it, only observed by `verify-example-run`.
 */
function readTranslatorOutcome(exampleId: string, value: unknown): TranslatorOutcome {
  const where = `--translations entry "${exampleId}"`;
  if (!isTranslatorReturn(value)) {
    throw new Error(
      `${where} does not have the translator's return shape.\n` +
        'verify/translate-example.md has the translator return { "testCode": string, "imports": ' +
        'string[], "verdictHint": "agrees" | "disagrees" | "unexecutable", "unexecutableReason"?: ' +
        'string } — file that return unchanged under the exampleId it was dispatched for.',
    );
  }
  if (value.verdictHint === 'unexecutable') return readUnexecutableOutcome(where, value);
  if (value.unexecutableReason !== undefined) {
    throw new Error(
      `${where} names an unexecutableReason but its verdictHint is "${value.verdictHint}".\n` +
        `Only an "unexecutable" return names a reason. Re-dispatch the translator; writing nothing.`,
    );
  }
  if (value.testCode.trim().length === 0) {
    throw new Error(
      `${where} has verdictHint "${value.verdictHint}" but no testCode.\n` +
        `A translated example must carry its it(...) block. Re-dispatch the translator; writing ` +
        `nothing.`,
    );
  }
  return { kind: 'translated', testCode: value.testCode, imports: value.imports };
}

/** A translator return as `verify/translate-example.md` § RETURN shapes it. */
interface TranslatorReturn {
  testCode: string;
  imports: string[];
  verdictHint: string;
  unexecutableReason?: unknown;
}

function isTranslatorReturn(value: unknown): value is TranslatorReturn {
  return (
    isPlainObject(value) &&
    typeof value.testCode === 'string' &&
    Array.isArray(value.imports) &&
    value.imports.every((imp) => typeof imp === 'string') &&
    typeof value.verdictHint === 'string' &&
    TRANSLATOR_VERDICT_HINTS.includes(value.verdictHint)
  );
}

/** An `unexecutable` return: a named reason from the contract's list, and no test. */
function readUnexecutableOutcome(where: string, value: TranslatorReturn): TranslatorOutcome {
  const reason = value.unexecutableReason;
  const sentence = typeof reason === 'string' ? UNEXECUTABLE_REASONS[reason] : undefined;
  if (sentence === undefined) {
    throw new Error(
      `${where} is "unexecutable" without a named reason.\n` +
        `unexecutableReason must be one of: ${Object.keys(UNEXECUTABLE_REASONS).join(', ')}. ` +
        `Re-dispatch the translator; writing nothing.`,
    );
  }
  if (value.testCode !== '') {
    throw new Error(
      `${where} is "unexecutable" but carries testCode.\n` +
        `An unexecutable example has no test: testCode must be "". Re-dispatch the ` +
        `translator; writing nothing.`,
    );
  }
  return { kind: 'unexecutable', reason: `${reason}: ${sentence}` };
}

/**
 * Reads `--translations`: one JSON object per slice mapping each `exampleId`
 * `verify-example-translate` handed out to that example's translator return, unchanged.
 */
async function readTranslatorReturns(
  filePath: string,
): Promise<{ byId: Map<string, unknown>; repairs: string[] }> {
  const parsed = await readSubagentJsonFile(filePath, '--translations', 'verify-example-record');
  if (!isPlainObject(parsed.value)) {
    throw new Error(
      `--translations at "${filePath}" must be one JSON object keyed by exampleId: ` +
        `{ "<exampleId>": <that example's translator return, unchanged>, ... }, using the ` +
        `exampleIds verify-example-translate printed.`,
    );
  }
  return { byId: new Map(Object.entries(parsed.value)), repairs: parsed.repairs };
}

// -------------------------------------------------------------------------------------------
// verifyExampleRecordCommand — the extraction/translation write surface, provenance-gated
// -------------------------------------------------------------------------------------------

export interface VerifyExampleRecordOptions {
  project?: string;
  slicePath?: string;
  extraction?: string;
  translations?: string;
  json?: boolean;
}

export interface VerifyExampleRecordResult {
  records: ExampleReplayRecord[];
  ledgerPath: string;
  /** The single provenance value applied to EVERY record this invocation wrote (decision 12). */
  provenance: ExampleReplayProvenance;
  /**
   * Every JSON-transport repair `parseSubagentJsonInput` performed across `--extraction`/
   * `--translations` (180-01 finding 5) — logged, never silent. Empty when both files parsed as
   * bare JSON.
   */
  repairs: string[];
}

/**
 * `boardsmith verify-example-record` — writes one slice's extraction and translation results to
 * CHECK-06's ledger. Reads the extractor's return (`--extraction`, `{ "examples": [...] }`) and
 * the translator returns (`--translations`, keyed by the exampleIds `verify-example-translate`
 * handed out), then records each example as:
 *
 *   - `example-inconsistent` — the extractor found it contradicts its own source;
 *   - `unexecutable` — the translator declined, with its named reason;
 *   - `not-run` — the translator wrote a test. The record carries that test; `verify-example-emit`
 *     writes it into the chunk's file and `verify-example-run` observes `agrees`/`disagrees`.
 *
 * The records it writes REPLACE everything the ledger held for the slice (#350): an extraction
 * covers its whole slice, so an earlier record it does not name is no longer one of its examples.
 *
 * VALIDATES EVERYTHING, THEN WRITES: every spec, translator return and record is built and
 * checked before the single `replaceSliceExampleReplayVerdicts` call. Every consistent example needs a
 * translator return and every translator return needs an example, or nothing is written.
 *
 * PROVENANCE GATING (178-CONTEXT.md decision 12): resolved ONCE per invocation via
 * `QuoteVerifiedProvenance.obtain(projectDir)` + `.covers(slicePath)`, and carried on every
 * record, including the ones `verify-example-run` later rewrites.
 *
 * No run identifier flag, and no bypass option of any kind, exists anywhere on this command —
 * CHECK-06 is project-level and source-free by construction.
 */
export async function verifyExampleRecordCommand(
  options: VerifyExampleRecordOptions = {},
): Promise<VerifyExampleRecordResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  if (!options.slicePath) {
    throw new Error('verify-example-record requires --slice-path <path>.');
  }
  if (!options.extraction) {
    throw new Error('verify-example-record requires --extraction <file>.');
  }
  if (!options.translations) {
    throw new Error('verify-example-record requires --translations <file>.');
  }

  const slicePath = options.slicePath;
  const sliceText = await readSliceArgument(projectDir, slicePath, 'verify-example-record');
  const extraction = await readExtractorReturn(options.extraction, 'verify-example-record');
  const translations = await readTranslatorReturns(options.translations);
  const repairs = [...extraction.repairs, ...translations.repairs];

  const { specsById, inconsistent } = readSliceExamples(slicePath, sliceText, extraction.examples);

  for (const [id, spec] of specsById) {
    if (!translations.byId.has(id)) {
      throw new Error(
        `No --translations entry for the worked example at ${spec.slicePath}:${spec.lineNumber} ` +
          `(id "${id}").\nEvery extracted example must have its translator return filed under ` +
          `its exampleId before recording. Writing nothing.`,
      );
    }
  }
  for (const id of translations.byId.keys()) {
    if (!specsById.has(id)) {
      throw new Error(
        `--translations contains an entry for "${id}" with no matching translatable --extraction ` +
          `entry.\nKey each translator return by an exampleId verify-example-translate printed ` +
          `for this slice. Writing nothing.`,
      );
    }
  }

  const provenanceInstance = await QuoteVerifiedProvenance.obtain(projectDir);
  const provenance: ExampleReplayProvenance =
    provenanceInstance && provenanceInstance.covers(slicePath) ? 'quote-verified' : 'quote-unverified';

  // Every lineNumber is one of these retained lines (`readSliceExamples` checked), so each record
  // carries the exact text it cites (#350).
  const lineTextAt = new Map(
    buildExampleExtractionPayload({ path: slicePath, text: sliceText }).lines.map((l) => [l.lineNumber, l.text]),
  );
  const lineText = (lineNumber: number): string => lineTextAt.get(lineNumber) ?? '';

  const translatedRecords: ExampleReplayRecord[] = [...specsById.values()].map((spec) => {
    const outcome = readTranslatorOutcome(spec.id, translations.byId.get(spec.id));
    const common = {
      exampleId: spec.id,
      slicePath: spec.slicePath,
      lineNumber: spec.lineNumber,
      lineText: lineText(spec.lineNumber),
      kind: spec.kind,
      supportingQuoteLines: [...spec.supportingQuoteLines],
      provenance,
    };
    if (outcome.kind === 'unexecutable') {
      return createExampleReplayRecord({ ...common, verdict: 'unexecutable', reason: outcome.reason });
    }
    return createExampleReplayRecord({
      ...common,
      verdict: 'not-run',
      reason: 'Translated into a test that has not been run yet.',
      expected: spec.expected,
      translation: {
        pageCitation: spec.pageCitation,
        sourceText: spec.sourceText,
        testCode: outcome.testCode,
        imports: outcome.imports,
      },
    });
  });

  // `supportingQuoteLines` carries BOTH contradicting excerpts verbatim (`extract-example.md`);
  // the first two become contradictionA/B, which `createExampleReplayRecord` requires non-empty.
  const inconsistentRecords: ExampleReplayRecord[] = inconsistent.map((entry) =>
    createExampleReplayRecord({
      exampleId: entry.id,
      slicePath,
      lineNumber: entry.lineNumber,
      lineText: lineText(entry.lineNumber),
      kind: 'example-inconsistent',
      verdict: 'example-inconsistent',
      reason: entry.reason,
      contradictionA: entry.supportingQuoteLines[0] ?? '',
      contradictionB: entry.supportingQuoteLines[1] ?? '',
      supportingQuoteLines: entry.supportingQuoteLines,
      provenance,
    }),
  );

  const records: ExampleReplayRecord[] = [...translatedRecords, ...inconsistentRecords].sort(
    (a, b) => a.lineNumber - b.lineNumber,
  );

  // The ONE mutation this function performs — everything above is validation. An extraction
  // with no examples is recorded too, so the slice counts as checked (#370).
  const { ledgerPath } = await replaceSliceExampleReplayVerdicts(
    projectDir,
    slicePath,
    records.length > 0
      ? { records }
      : {
          noExamples: createSliceWithoutExamplesRecord({
            slicePath,
            extractionHash: sliceExtractionHash({ path: slicePath, text: sliceText }),
          }),
        },
  );

  const result: VerifyExampleRecordResult = { records, ledgerPath, provenance, repairs };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  console.log(
    chalk.green(
      records.length > 0
        ? `✓ Recorded ${records.length} worked example(s) for ${slicePath} (provenance: ${provenance}).`
        : `✓ Recorded ${slicePath} as having no worked examples; it stays checked until the lines ` +
            `the extractor reads change.`,
    ),
  );
  console.log(`  Ledger: ${ledgerPath}`);
  const notRun = records.filter((r) => r.verdict === 'not-run').length;
  if (notRun > 0) {
    console.log(
      `  ${notRun} translated test(s) not run yet: run boardsmith verify-example-emit, then ` +
        `boardsmith verify-example-run, for the chunk that cites this slice.`,
    );
  }
  for (const repair of repairs) {
    console.log(chalk.yellow(`  ⚠ JSON transport repair — ${repair}`));
  }
  return result;
}

// -------------------------------------------------------------------------------------------
// Plan 178-05 — verifyExampleTranslateCommand — the second dispatch's byte source
// -------------------------------------------------------------------------------------------

export interface VerifyExampleTranslateOptions {
  project?: string;
  slicePath?: string;
  extraction?: string;
  json?: boolean;
}

export interface VerifyExampleTranslatePayloadEntry {
  /**
   * Caller-assigned (`workedExampleId({ slicePath, lineNumber })`) — never a model-returned field.
   * The translator's return for this payload is filed under this id in `--translations`.
   */
  exampleId: string;
  lineNumber: number;
  kind: WorkedExampleKind;
  /** Byte-equal to `buildExampleTranslationPayload(spec, api)` — this command's entire purpose. */
  translationPayload: string;
}

export interface VerifyExampleTranslateNotTranslatedEntry {
  lineNumber: number;
  reason: string;
}

export interface VerifyExampleTranslateResult {
  slicePath: string;
  /** The size of the `GameApiSurface` every payload above was built against (a finding, not test data). */
  apiSurfaceSymbolCount: number;
  payloads: VerifyExampleTranslatePayloadEntry[];
  /** Entries the extractor already marked `example-inconsistent` — never translated, never re-judged. */
  notTranslated: VerifyExampleTranslateNotTranslatedEntry[];
  /**
   * Every JSON-transport repair `parseSubagentJsonInput` performed on `--extraction` (180-01
   * finding 5) — logged, never silent. Empty when the file parsed as bare JSON.
   */
  repairs: string[];
}

/**
 * `boardsmith verify-example-translate` — the SECOND dispatch's byte source (178-CONTEXT.md
 * decisions 6 and 9): reads the extractor's return (`--extraction`, `{ "examples": [...] }`) for
 * ONE `--slice-path`, turns it into specs through `readSliceExamples` (the same reading
 * `verify-example-record` does), collects the generated project's real exported API surface
 * EXACTLY ONCE per invocation (`collectGameApiSurface`), and maps every spec through
 * `buildExampleTranslationPayload` — never composing that prompt text itself.
 *
 * An entry the extractor already marked `example-inconsistent` is NOT translated; it is reported
 * in `notTranslated[]` with its reason.
 *
 * READ-ONLY: this command writes nothing. A finding (zero payloads, a non-empty
 * `notTranslated[]`) never sets `process.exitCode` — only a tool failure does.
 */
export async function verifyExampleTranslateCommand(
  options: VerifyExampleTranslateOptions = {},
): Promise<VerifyExampleTranslateResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  if (!options.slicePath) {
    throw new Error('verify-example-translate requires --slice-path <path>.');
  }
  if (!options.extraction) {
    throw new Error('verify-example-translate requires --extraction <file>.');
  }

  const slicePath = options.slicePath;
  const sliceText = await readSliceArgument(projectDir, slicePath, 'verify-example-translate');
  const extraction = await readExtractorReturn(options.extraction, 'verify-example-translate');
  const { specsById, inconsistent } = readSliceExamples(slicePath, sliceText, extraction.examples);

  // `collectGameApiSurface` called EXACTLY ONCE per invocation — the same surface object is
  // passed to every `buildExampleTranslationPayload` call below.
  const api = await collectGameApiSurface(projectDir);

  const payloads: VerifyExampleTranslatePayloadEntry[] = [...specsById.values()]
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((spec) => ({
      exampleId: spec.id,
      lineNumber: spec.lineNumber,
      kind: spec.kind,
      translationPayload: buildExampleTranslationPayload(spec, api),
    }));

  const result: VerifyExampleTranslateResult = {
    slicePath,
    apiSurfaceSymbolCount: api.exportedSymbols.length,
    payloads,
    notTranslated: inconsistent
      .map((entry) => ({ lineNumber: entry.lineNumber, reason: entry.reason }))
      .sort((a, b) => a.lineNumber - b.lineNumber),
    repairs: extraction.repairs,
  };

  // `--json` emits the result and nothing else on stdout. This command writes NOTHING to disk.
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    chalk.green(
      `✓ Example translate — ${slicePath}: ${payloads.length} payload(s), ` +
        `${result.notTranslated.length} not translated.`,
    ),
  );
  for (const p of payloads) {
    console.log(`  --- ${p.exampleId} (${p.kind}) ---`);
    console.log(p.translationPayload);
  }
  for (const nt of result.notTranslated) {
    console.log(`  ⚠ ${slicePath}:${nt.lineNumber} — not translated: ${nt.reason}`);
  }
  for (const repair of result.repairs) {
    console.log(chalk.yellow(`  ⚠ JSON transport repair — ${repair}`));
  }

  return result;
}
