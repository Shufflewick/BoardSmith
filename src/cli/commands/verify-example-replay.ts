import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { atomicWriteFile } from './verify-run.js';
import { readLiveSlices } from './verify-derive-check.js';
import { resolveCitedSlices } from './chunk-provenance.js';
import {
  WORKED_EXAMPLE_KINDS,
  workedExampleId,
  buildExampleExtractionPayload,
  type WorkedExampleKind,
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
 * The WRITE surface (`verify-example-record`, plan 178-04) is the ONLY place a subagent's raw
 * verdict reaches `createExampleReplayRecord` for the first time. This module's own
 * `verifyExampleReplayCommand` is read-only: it never dispatches a subagent and never assigns
 * `process.exitCode`, including when every recorded verdict is `disagrees` (178-CONTEXT.md
 * decision 11 — CHECK-06 REPORTS, exit 0, and never gates).
 */

// -------------------------------------------------------------------------------------------
// Task 1 — EXAMPLE_REPLAY_VERDICTS + createExampleReplayRecord (the record choke point)
// -------------------------------------------------------------------------------------------

/**
 * The frozen four-member verdict set. Unlike `DERIVE_CHECK_VERDICTS` (`verify-derive-check.ts`),
 * which is compile-time tied to an EXTERNALLY-imported `DerivedLineClassification` union, this
 * set has no external type to drift from — it IS the canonical source of truth for
 * `ExampleReplayVerdict`, and the type below is derived directly from it (`(typeof
 * EXAMPLE_REPLAY_VERDICTS)[number]`), which is definitionally exhaustive by construction: there
 * is no second declaration of the union anywhere in this module for the array to drift against.
 */
export const EXAMPLE_REPLAY_VERDICTS = Object.freeze([
  'agrees',
  'disagrees',
  'example-inconsistent',
  'unexecutable',
] as const);

export type ExampleReplayVerdict = (typeof EXAMPLE_REPLAY_VERDICTS)[number];

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

export interface ExampleReplayRecord {
  /** Caller-assigned (`workedExampleId({ slicePath, lineNumber })`) — never a model-returned field. */
  readonly exampleId: string;
  readonly slicePath: string;
  /** 1-based, matching the slice file's own line numbering. */
  readonly lineNumber: number;
  readonly kind: WorkedExampleKind;
  readonly verdict: ExampleReplayVerdict;
  /** The reasoning IS the artifact — required for every verdict, not only `unexecutable`. */
  readonly reason: string;
  /** `disagrees` only (required, non-empty); '' for every other verdict. */
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
}

/**
 * Validates and constructs an `ExampleReplayRecord`. This is the ONLY place a verdict string is
 * checked against `EXAMPLE_REPLAY_VERDICTS`; every recording path AND the read path
 * (`readExampleReplayVerdicts`, CR-02) route through it. Throws when:
 *
 *   - `verdict` is outside `EXAMPLE_REPLAY_VERDICTS` (message names all four legal verdicts)
 *   - `kind` is outside `WORKED_EXAMPLE_KINDS`
 *   - `provenance` is outside the two legal provenance values
 *   - `reason` is empty or whitespace-only — the reason IS the artifact, required for every
 *     verdict (a strict superset of the `unexecutable`-only requirement this check exists to
 *     satisfy)
 *   - `verdict === 'disagrees'` and `expected` or `observed` is empty
 *   - `verdict === 'example-inconsistent'` and `contradictionA` or `contradictionB` is empty
 *   - `reason`, `expected`, `observed`, `contradictionA`, `contradictionB`, `testFilePath`, or any
 *     `supportingQuoteLines` string contains the ledger's own begin/end fence marker (CR-04),
 *     naming the offending field
 *   - `exampleId` does not equal `workedExampleId({ slicePath, lineNumber })` for the record's
 *     own fields — identity is caller-assigned, never model-supplied
 *
 * Modeled as additional `if` blocks inside this same function — never a second validator
 * elsewhere in the module.
 */
export function createExampleReplayRecord(input: {
  exampleId: string;
  slicePath: string;
  lineNumber: number;
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
}): ExampleReplayRecord {
  const location = `${input.slicePath}:${input.lineNumber}`;

  if (!isExampleReplayVerdict(input.verdict)) {
    throw new Error(
      `Invalid verdict "${input.verdict}" for ${location}.\n` +
        `Expected one of: ${EXAMPLE_REPLAY_VERDICTS.join(', ')}.`,
    );
  }
  if (!(WORKED_EXAMPLE_KINDS as readonly string[]).includes(input.kind)) {
    throw new Error(
      `Invalid kind "${input.kind}" for the example-replay record at ${location}.\n` +
        `Expected one of: ${WORKED_EXAMPLE_KINDS.join(', ')}.`,
    );
  }
  if (!isExampleReplayProvenance(input.provenance)) {
    throw new Error(
      `Invalid provenance "${input.provenance}" for ${location}.\n` +
        `Expected one of: ${EXAMPLE_REPLAY_PROVENANCE_VALUES.join(', ')}.`,
    );
  }
  if (input.reason.trim().length === 0) {
    throw new Error(
      `${location}'s verdict has no recorded reason.\n` +
        `The reason is the artifact this check exists to produce — a verdict label with no ` +
        `reason is not a valid record.`,
    );
  }

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

  const fenceCheckFields: [string, string][] = [
    ['reason', input.reason],
    ['expected', expected],
    ['observed', observed],
    ['contradictionA', contradictionA],
    ['contradictionB', contradictionB],
    ...(input.testFilePath ? ([['testFilePath', input.testFilePath]] as [string, string][]) : []),
    ...supportingQuoteLines.map((line, i): [string, string] => [`supportingQuoteLines[${i}]`, line]),
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
    kind: input.kind as WorkedExampleKind,
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
  return join(projectDir, 'rulebook', '.example-replay', 'EXAMPLE-VERDICTS.md');
}

function exampleReplayKey(r: Pick<ExampleReplayRecord, 'exampleId'>): string {
  return r.exampleId;
}

/**
 * Persists a batch of already-validated `ExampleReplayRecord`s to the project-level ledger,
 * through `atomicWriteFile` — the ONE atomic write path in the repo. REPLACES the ENTIRE ledger
 * body with exactly the `records` array supplied — a full rewrite, never the callable the
 * workflow uses per-batch (see `recordExampleReplayVerdicts` for that). Exported for the one
 * legitimate full-rewrite use case and for `recordExampleReplayVerdicts`'s own use.
 */
export async function replaceExampleReplayVerdicts(
  projectDir: string,
  records: ExampleReplayRecord[],
): Promise<{ ledgerPath: string }> {
  const ledgerPath = exampleReplayLedgerPath(projectDir);
  const lines = records.map((r) => JSON.stringify(r));
  const content =
    `# Example Replay Verdicts (CHECK-06) — project-level, no run-id\n\n` +
    `${EXAMPLE_REPLAY_LEDGER_BEGIN}\n` +
    lines.join('\n') +
    (lines.length > 0 ? '\n' : '') +
    `${EXAMPLE_REPLAY_LEDGER_END}\n`;
  await fs.mkdir(dirname(ledgerPath), { recursive: true });
  await atomicWriteFile(ledgerPath, content);
  return { ledgerPath: relative(projectDir, ledgerPath) };
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
 * Round-trips exactly what `replaceExampleReplayVerdicts`/`recordExampleReplayVerdicts` wrote.
 * Returns an empty array (never throws) when no ledger has been written yet — a project that has
 * never run CHECK-06's recording step has nothing recorded, which is not a tool failure.
 *
 * RE-ENTERS `createExampleReplayRecord` ON EVERY PARSED LINE (CR-02): the ledger is a second
 * entry path into `ExampleReplayRecord`, not a bypass of the type — no `as ExampleReplayRecord`
 * cast may appear anywhere in this module. A hand-edited or out-of-enum ledger record throws
 * through `createExampleReplayRecord`'s own checks rather than reaching the report unvalidated. A
 * malformed JSON line, or a ledger whose fence markers are absent or unbalanced, throws one
 * actionable message naming the ledger's relative path — never silently returns `[]`.
 */
export async function readExampleReplayVerdicts(
  projectDir: string,
): Promise<ExampleReplayRecord[]> {
  const ledgerPath = exampleReplayLedgerPath(projectDir);
  let text: string;
  try {
    text = await fs.readFile(ledgerPath, 'utf-8');
  } catch {
    return [];
  }
  const beginIdx = text.indexOf(EXAMPLE_REPLAY_LEDGER_BEGIN);
  const endIdx = text.indexOf(EXAMPLE_REPLAY_LEDGER_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `Malformed example-replay ledger at ${relative(projectDir, ledgerPath)}: missing begin/end ` +
        `fence.`,
    );
  }
  const relLedgerPath = relative(projectDir, ledgerPath);
  const body = text.slice(beginIdx + EXAMPLE_REPLAY_LEDGER_BEGIN.length, endIdx);
  const rawLines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return rawLines.map((line, i) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(
        `Malformed example-replay ledger at ${relLedgerPath} (record ${i + 1}): not valid JSON.\n` +
          `Delete the file to re-run CHECK-06 from scratch.`,
      );
    }
    const r = raw as Record<string, unknown>;
    try {
      return createExampleReplayRecord({
        exampleId: String(r.exampleId ?? ''),
        slicePath: String(r.slicePath ?? ''),
        lineNumber: Number(r.lineNumber),
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
      });
    } catch (err) {
      throw new Error(
        `Malformed example-replay ledger at ${relLedgerPath} (record ${i + 1}): ` +
          `${(err as Error).message}\nDelete the file to re-run CHECK-06 from scratch.`,
      );
    }
  });
}

// -------------------------------------------------------------------------------------------
// Task 3 — verifyExampleReplayCommand — the read/report surface
// -------------------------------------------------------------------------------------------

export interface VerifyExampleReplayOptions {
  project?: string;
  json?: boolean;
  chunk?: string;
}

export interface VerifyExampleReplaySlice {
  slicePath: string;
  /** The exact `buildExampleExtractionPayload(...).payload` bytes for this slice. */
  extractionPayload?: string;
  /** Names the slice `buildExampleExtractionPayload` threw for; never dispatched when set. */
  extractionError?: string;
  /** `true` when the ledger has no recorded verdict yet whose `slicePath` matches this slice. */
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
 * No `--run-id`, no bypass/force/skip option of any kind — this command is source-free and
 * run-less by construction, exactly like its `verify-derive-check` sibling.
 */
export async function verifyExampleReplayCommand(
  options: VerifyExampleReplayOptions = {},
): Promise<VerifyExampleReplayResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  let liveSlices = await readLiveSlices(projectDir);

  if (options.chunk !== undefined) {
    // Path containment guard — mirrors `verify-classify.ts`'s `--live-slice` guard (~line 700):
    // 177.1's code review found a traversal exactly at an unvalidated `--*` option reaching
    // `fs.readFile`. `--chunk` resolves into `chunks/<chunk>/CHUNK.md`; validate BEFORE any read.
    const chunksDir = join(projectDir, 'chunks');
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

  const allVerdicts = await readExampleReplayVerdicts(projectDir);
  const selectedPaths = new Set(liveSlices.map((s) => s.path));
  const verdicts = allVerdicts.filter((v) => selectedPaths.has(v.slicePath));

  const slices: VerifyExampleReplaySlice[] = liveSlices
    .map((s) => {
      const pending = !verdicts.some((v) => v.slicePath === s.path);
      try {
        const { payload } = buildExampleExtractionPayload({ path: s.path, text: s.text });
        return { slicePath: s.path, extractionPayload: payload, pending };
      } catch (err) {
        return { slicePath: s.path, extractionError: (err as Error).message, pending };
      }
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
  for (const finding of verdicts) {
    if (finding.verdict === 'agrees') continue;
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
