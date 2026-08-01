import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { atomicWriteFile } from './verify-run.js';
import {
  readLiveSlices,
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

export interface ExampleReplayRecord {
  /** Caller-assigned (`workedExampleId({ slicePath, lineNumber })`) — never a model-returned field. */
  readonly exampleId: string;
  readonly slicePath: string;
  /** 1-based, matching the slice file's own line numbering. */
  readonly lineNumber: number;
  readonly kind: WorkedExampleKind | 'example-inconsistent';
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
  const relLedgerPath = relative(projectDir, ledgerPath);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `Malformed example-replay ledger at ${relLedgerPath}: missing begin/end fence.`,
    );
  }
  // WR-02 (178-REVIEW.md): the two markers were located independently; a hand-edited or
  // corrupted ledger with the end fence BEFORE the begin fence (or a doubled begin marker) would
  // silently slice a negative-length/nonsensical body instead of hitting the "malformed ledger"
  // error this function's own doc comment promises for "unbalanced" fences.
  if (beginIdx > endIdx) {
    throw new Error(
      `Malformed example-replay ledger at ${relLedgerPath}: the end fence appears before the ` +
        `begin fence.`,
    );
  }
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
  /**
   * Root-level files that LOOK like rulebook source documents but are neither the project's
   * primary archived source nor a hash-verified `## Additional Sources` entry
   * (`QuoteVerifiedProvenance.unarchivedSources`, project-level). Surfaced here rather than
   * swallowed (178-CONTEXT.md decision 12's "never swallow `unarchivedSources`" requirement) —
   * empty for the common single-source project.
   */
  unarchivedSources: readonly string[];
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
        const { payload, lines } = buildExampleExtractionPayload({ path: s.path, text: s.text });
        // 178-12: a zero-content slice never gets an `extractionPayload` — see
        // `notDispatchable`'s own doc comment for why this is reported, not thrown.
        if (lines.length === 0) {
          return {
            slicePath: s.path,
            notDispatchable: 'no-extractable-content' as const,
            pending,
          };
        }
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
    unarchivedSources,
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
  const otherFindings = verdicts.filter((v) => v.verdict !== 'agrees' && v.verdict !== 'disagrees');

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
// Task 1/2 (178-04) — verifyExampleRecordCommand — the sole write surface, provenance-gated
// -------------------------------------------------------------------------------------------

export interface VerifyExampleRecordOptions {
  project?: string;
  slicePath?: string;
  extraction?: string;
  translation?: string;
  json?: boolean;
}

export interface VerifyExampleRecordResult {
  records: ExampleReplayRecord[];
  ledgerPath: string;
  /** The single provenance value applied to EVERY record this invocation wrote (decision 12). */
  provenance: ExampleReplayProvenance;
  /**
   * Every JSON-transport repair `parseSubagentJsonInput` performed across `--extraction`/
   * `--translation` (180-01 finding 5) — logged, never silent. Empty when both files parsed as
   * bare JSON.
   */
  repairs: string[];
}

/**
 * A raw entry from the extractor's `--extraction` JSON return, as consumed by
 * `verifyExampleRecordCommand`. Mirrors `RawExampleTranslateExtractionEntry` below in shape
 * (`extract-example.md`'s own RETURN contract governs both): most entries carry `kind:
 * 'transition' | 'predicate'` and the full spec field set; an entry the extractor already judged
 * `example-inconsistent` (decision 4) instead carries only `pageCitation`, `reason`, and
 * `supportingQuoteLines` — `sourceText`/`setup`/`expected` are therefore optional here, not
 * required, matching what the contract actually returns for that kind.
 */
interface RawExampleExtractionEntry {
  slicePath: string;
  lineNumber: number;
  pageCitation: string;
  kind: string;
  sourceText?: string;
  setup?: string;
  action?: string;
  expected?: string;
  supportingQuoteLines?: string[];
  /** Required when `kind === 'example-inconsistent'`; ignored otherwise. */
  reason?: string;
}

interface RawExampleTranslationEntry {
  slicePath: string;
  lineNumber: number;
  verdict: string;
  reason: string;
  expected?: string;
  observed?: string;
  contradictionA?: string;
  contradictionB?: string;
  testFilePath?: string;
}

/**
 * The SINGLE `--slice-path` containment guard for every CHECK-06 command in this module that
 * accepts a `--slice-path` option (`verifyExampleRecordCommand` and, from plan 178-05,
 * `verifyExampleTranslateCommand`) — mirrors `verify-derive-record`'s CR-04 fix /
 * `verify-classify.ts`'s `--live-slice` guard verbatim in shape and message. Resolves `slicePath`
 * against `projectDir` and throws, naming `rulebook/`, BEFORE any read when the resolved path
 * escapes `projectDir/rulebook` — a second, differently-shaped copy of this check is exactly the
 * class of drift 177.1's code review found at this same trust boundary.
 */
function resolveSlicePathWithinRulebook(projectDir: string, slicePath: string): string {
  const rulebookDir = join(projectDir, 'rulebook');
  const sliceAbsPath = resolve(projectDir, slicePath);
  const sliceRelToRulebook = relative(rulebookDir, sliceAbsPath);
  if (
    sliceRelToRulebook === '' ||
    sliceRelToRulebook.startsWith('..') ||
    isAbsolute(sliceRelToRulebook)
  ) {
    throw new Error(
      `--slice-path "${slicePath}" resolves outside ${relative(projectDir, rulebookDir)}.\n` +
        `Pass a path relative to the project root, of the form "rulebook/<file>.md".`,
    );
  }
  return sliceAbsPath;
}

/**
 * Mirrors `verify-derive-check.ts`'s module-private `readRequiredJsonFile` (per this plan's
 * `<interfaces>` — reimplemented here, not imported, since that function is not exported).
 */
async function readRequiredExampleJsonFile(
  filePath: string,
  flagLabel: string,
): Promise<SubagentJsonParseResult> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`verify-example-record could not read ${flagLabel} at "${filePath}".`);
  }
  return parseSubagentJsonInput(text, flagLabel, filePath);
}

/** A short, non-identifying preview of a colliding entry's text for an error message. */
function shortEntryPreview(text: string, maxLen = 80): string {
  const trimmed = (text ?? '').toString().trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

/**
 * Keys a raw returned-array entry by `workedExampleId({ slicePath, lineNumber })` — the caller's
 * OWN `slicePath` (this invocation's `--slice-path`), never a model-returned field — and throws,
 * naming BOTH colliding entries via `preview`, rather than silently overwriting. Direct inheritance
 * of 177.1's CR-01/CR-02 fix: two returned entries must never collapse onto one record just
 * because they resolve to the same `slicePath`+`lineNumber`.
 */
function keyRawExampleEntriesByLocation<T extends { lineNumber: number }>(
  entries: T[],
  slicePath: string,
  flagLabel: string,
  preview: (entry: T) => string,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) {
    const id = workedExampleId({ slicePath, lineNumber: entry.lineNumber });
    const existing = map.get(id);
    if (existing) {
      throw new Error(
        `${flagLabel} contains two entries resolving to the same slicePath+lineNumber ("${id}").\n` +
          `Existing: ${shortEntryPreview(preview(existing))}\n` +
          `New:      ${shortEntryPreview(preview(entry))}\n` +
          `Entries are keyed by slicePath+lineNumber, never by returned prose — remove or merge ` +
          `the duplicate before recording. Writing nothing.`,
      );
    }
    map.set(id, entry);
  }
  return map;
}

/**
 * `boardsmith verify-example-record` — the ONLY write surface for CHECK-06's ledger. Reads the
 * extractor's and translator's already-dispatched structured JSON returns
 * (`--extraction`/`--translation`), assigns EVERY example's identity itself via
 * `workedExampleId({ slicePath: --slice-path, lineNumber: <the returned lineNumber> })` — never a
 * model-supplied field, the direct continuation of 177.1's CR-01/CR-02 fix — and
 * VALIDATES-EVERYTHING-THEN-WRITES: every `WorkedExampleSpec` and every `ExampleReplayRecord` is
 * built and checked before the single `recordExampleReplayVerdicts` call at the very end. A
 * rejection anywhere in that validation throws before any write, leaving the ledger byte-identical
 * to its pre-call state.
 *
 * PROVENANCE GATING (178-CONTEXT.md decision 12, this milestone's hardest-won lesson): resolved
 * ONCE per invocation — never per example — via `QuoteVerifiedProvenance.obtain(projectDir)` +
 * `.covers(slicePath)`. `'quote-verified'` only when an archived, hash-verified source exists AND
 * can honestly be said to cover THIS `--slice-path`; `'quote-unverified'` in every other case
 * (including no archived source at all). `createExampleReplayRecord` REQUIRES this field on every
 * record it constructs — a caller cannot omit the gate, and the downgrade NEVER rewrites `verdict`
 * itself (a `disagrees` stays `disagrees`), only its confidence label at the report layer
 * (`verifyExampleReplayCommand`'s two named buckets).
 *
 * `--slice-path` is validated against `projectDir/rulebook` BEFORE any read — mirrors
 * `verify-derive-record`'s CR-04 fix / `verify-classify.ts`'s `--live-slice` guard verbatim in
 * shape and message.
 *
 * No run identifier flag, and no bypass option of any kind, exists anywhere on this command —
 * CHECK-06 is project-level and source-free by construction, the same discipline `verify-derive-
 * record` holds.
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
  if (!options.translation) {
    throw new Error('verify-example-record requires --translation <file>.');
  }

  const slicePath = options.slicePath;
  const sliceAbsPath = resolveSlicePathWithinRulebook(projectDir, slicePath);

  let sliceText: string;
  try {
    sliceText = await fs.readFile(sliceAbsPath, 'utf-8');
  } catch {
    throw new Error(
      `verify-example-record could not read --slice-path "${slicePath}" (looked for it at ` +
        `${sliceAbsPath}).`,
    );
  }

  const extractionParsed = await readRequiredExampleJsonFile(options.extraction, '--extraction');
  const extractionRaw = extractionParsed.value as RawExampleExtractionEntry[];
  if (!Array.isArray(extractionRaw)) {
    throw new Error(`--extraction at "${options.extraction}" must contain a JSON array.`);
  }
  const translationParsed = await readRequiredExampleJsonFile(options.translation, '--translation');
  const translationRaw = translationParsed.value as RawExampleTranslationEntry[];
  if (!Array.isArray(translationRaw)) {
    throw new Error(`--translation at "${options.translation}" must contain a JSON array.`);
  }
  const repairs = [...extractionParsed.repairs, ...translationParsed.repairs];

  // CR-03 fix: every raw lineNumber is cross-validated against buildExampleExtractionPayload's
  // own retained-line set for this slice BEFORE it is ever used to build a workedExampleId — a
  // fabricated or off-by-one lineNumber must fail closed here, never reach the ledger.
  assertValidExampleLineNumbers({ path: slicePath, text: sliceText }, extractionRaw, '--extraction');
  assertValidExampleLineNumbers(
    { path: slicePath, text: sliceText },
    translationRaw,
    '--translation',
  );

  // Collision guard on BOTH raw returns, keyed by slicePath+lineNumber — never by prose. Preview
  // falls back to `reason` for an `example-inconsistent` entry, which carries no `sourceText`.
  keyRawExampleEntriesByLocation(
    extractionRaw,
    slicePath,
    '--extraction',
    (e) => e.sourceText ?? e.reason ?? '',
  );
  const translationByLocation = keyRawExampleEntriesByLocation(
    translationRaw,
    slicePath,
    '--translation',
    (e) => e.reason ?? '',
  );

  // `example-inconsistent` entries (decision 4) never become a `WorkedExampleSpec`
  // (`createWorkedExampleSpec` only accepts `WORKED_EXAMPLE_KINDS`) and were never dispatched for
  // translation (`verifyExampleTranslateCommand` routes them to `notTranslated[]` instead) — split
  // them off BEFORE spec construction so the extractor's own already-decided contradiction is
  // recorded directly, never re-judged and never routed through the transition/predicate path.
  const inconsistentEntries = extractionRaw.filter((raw) => raw.kind === 'example-inconsistent');
  const consistentEntries = extractionRaw.filter((raw) => raw.kind !== 'example-inconsistent');

  for (const raw of inconsistentEntries) {
    if ((raw.reason ?? '').trim().length === 0) {
      throw new Error(
        `${slicePath}:${raw.lineNumber} is marked "example-inconsistent" but carries no reason.\n` +
          `Deciding it is inconsistent already happened at extraction time; this command never ` +
          `re-judges it, so it cannot proceed without the reason the extractor recorded. Writing ` +
          `nothing.`,
      );
    }
  }

  // Build specs through the ONE shared choke point (example-derivation.ts) — never re-validated
  // here. `returned.slicePath` is overridden with THIS invocation's own --slice-path: identity is
  // assigned from the caller, never trusted from the model's own return.
  const specs: WorkedExampleSpec[] = consistentEntries.map((raw) => {
    const id = workedExampleId({ slicePath, lineNumber: raw.lineNumber });
    return createWorkedExampleSpec({
      id,
      sliceText,
      returned: {
        slicePath,
        lineNumber: raw.lineNumber,
        pageCitation: raw.pageCitation ?? '',
        kind: raw.kind,
        sourceText: raw.sourceText ?? '',
        setup: raw.setup ?? '',
        action: raw.action,
        expected: raw.expected ?? '',
        supportingQuoteLines: raw.supportingQuoteLines,
      },
    });
  });
  const specsById = collectWorkedExampleSpecs(specs);

  // Validate-everything-then-write: every consistent extracted example must have a matching
  // translation, and every translation must correspond to an extracted example — before any write.
  // `example-inconsistent` entries are exempt from this pairing (they were never dispatched for
  // translation) and are validated separately above.
  for (const [id, spec] of specsById) {
    if (!translationByLocation.has(id)) {
      throw new Error(
        `No --translation entry for the worked example at ${spec.slicePath}:${spec.lineNumber} ` +
          `(id "${id}").\nEvery extracted example must have a matching translation entry before ` +
          `recording. Writing nothing.`,
      );
    }
  }
  for (const [id] of translationByLocation) {
    if (!specsById.has(id)) {
      throw new Error(
        `--translation contains an entry for "${id}" with no matching --extraction entry.\n` +
          `A translation entry must correspond to an extracted worked example. Writing nothing.`,
      );
    }
  }

  // Provenance resolved ONCE per invocation (decision 12), never per example.
  const provenanceInstance = await QuoteVerifiedProvenance.obtain(projectDir);
  const provenance: ExampleReplayProvenance =
    provenanceInstance && provenanceInstance.covers(slicePath) ? 'quote-verified' : 'quote-unverified';

  const translatedRecords: ExampleReplayRecord[] = [...specsById.values()].map((spec) => {
    const translated = translationByLocation.get(spec.id)!;
    return createExampleReplayRecord({
      exampleId: spec.id,
      slicePath: spec.slicePath,
      lineNumber: spec.lineNumber,
      kind: spec.kind,
      verdict: translated.verdict,
      reason: translated.reason,
      expected: translated.expected,
      observed: translated.observed,
      contradictionA: translated.contradictionA,
      contradictionB: translated.contradictionB,
      supportingQuoteLines: [...spec.supportingQuoteLines],
      provenance,
      testFilePath: translated.testFilePath,
    });
  });

  // `example-inconsistent` records go straight from the extractor's own return to the ledger — no
  // translation dispatch happened for them, and none is needed: the verdict IS
  // `example-inconsistent`, decided at extraction time. `supportingQuoteLines` already carries BOTH
  // contradicting excerpts verbatim (`extract-example.md`'s own instruction) — the first two lines
  // map onto `contradictionA`/`contradictionB`, the two fields `createExampleReplayRecord` requires
  // non-empty for this verdict; that constructor is still the ONLY place either is validated.
  const inconsistentRecords: ExampleReplayRecord[] = inconsistentEntries.map((raw) => {
    const id = workedExampleId({ slicePath, lineNumber: raw.lineNumber });
    const quotes = raw.supportingQuoteLines ?? [];
    return createExampleReplayRecord({
      exampleId: id,
      slicePath,
      lineNumber: raw.lineNumber,
      kind: 'example-inconsistent',
      verdict: 'example-inconsistent',
      reason: raw.reason ?? '',
      contradictionA: quotes[0] ?? '',
      contradictionB: quotes[1] ?? '',
      supportingQuoteLines: quotes,
      provenance,
    });
  });

  const records: ExampleReplayRecord[] = [...translatedRecords, ...inconsistentRecords].sort(
    (a, b) => a.lineNumber - b.lineNumber,
  );

  // The ONE mutation this function performs — everything above is validation.
  const { ledgerPath } = await recordExampleReplayVerdicts(projectDir, records);

  const result: VerifyExampleRecordResult = { records, ledgerPath, provenance, repairs };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  console.log(
    chalk.green(
      `✓ Recorded ${records.length} example-replay verdict(s) for ${slicePath} ` +
        `(provenance: ${provenance}).`,
    ),
  );
  console.log(`  Ledger: ${ledgerPath}`);
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
  /** Caller-assigned (`workedExampleId({ slicePath, lineNumber })`) — never a model-returned field. */
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
 * A raw entry from the extractor's `--extraction` JSON return, as consumed by
 * `verifyExampleTranslateCommand`. Most entries carry `kind: 'transition' | 'predicate'` and the
 * full `WorkedExampleSpec` field set (178-CONTEXT.md decision 5). An entry the extractor already
 * judged inconsistent against its own source (decision 4) instead carries `kind:
 * 'example-inconsistent'` plus a required `reason` — every other field is optional for that shape,
 * since this command never builds a spec for it.
 */
interface RawExampleTranslateExtractionEntry {
  slicePath: string;
  lineNumber: number;
  pageCitation?: string;
  kind: string;
  sourceText?: string;
  setup?: string;
  action?: string;
  expected?: string;
  supportingQuoteLines?: string[];
  /** Required when `kind === 'example-inconsistent'`; ignored otherwise. */
  reason?: string;
}

/**
 * `boardsmith verify-example-translate` — the SECOND dispatch's byte source (178-CONTEXT.md
 * decisions 6 and 9): reads the extractor's already-dispatched `--extraction` return for ONE
 * `--slice-path`, assigns EVERY surviving entry's identity itself via `workedExampleId({
 * slicePath: --slice-path, lineNumber: <the returned lineNumber> })` — never a model-supplied
 * field, the same CR-01/CR-02 continuation `verifyExampleRecordCommand` already holds — builds
 * each into a `WorkedExampleSpec` through the ONE shared choke point (`createWorkedExampleSpec` /
 * `collectWorkedExampleSpecs`, `example-derivation.ts`), collects the generated project's real
 * exported API surface EXACTLY ONCE per invocation (`collectGameApiSurface`), and maps every
 * surviving spec through `buildExampleTranslationPayload` — never composing that prompt text
 * itself. A caller that describes `GameApiSurface` in its own prose instead of citing this
 * command's bytes is re-deriving the exact thing this command exists to make unnecessary.
 *
 * An entry the extractor already marked `example-inconsistent` is NOT translated — deciding it is
 * inconsistent already happened at extraction time, and this command never re-judges it. It is
 * reported in `notTranslated[]` with its reason instead, and never reaches
 * `buildExampleTranslationPayload`.
 *
 * READ-ONLY: this command writes nothing — no ledger, no test file, no scratch file. Its entire
 * output is stdout (or the returned result object). Exit discipline mirrors its
 * `verifyExampleReplayCommand`/`verifyExampleRecordCommand` siblings: a finding (zero payloads, a
 * non-empty `notTranslated[]`) never sets `process.exitCode` — only a tool failure does (an
 * unreadable or unparseable `--extraction` file, a containment violation, an id collision, or a
 * spec that fails `createWorkedExampleSpec`).
 *
 * `--slice-path` is validated through the SAME `resolveSlicePathWithinRulebook` guard
 * `verifyExampleRecordCommand` uses — not a second copy of it.
 *
 * No run identifier flag, and no bypass option of any kind, exists anywhere on this command —
 * CHECK-06's translation half is project-level and source-free by construction, matching every
 * other command in this module.
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
  const sliceAbsPath = resolveSlicePathWithinRulebook(projectDir, slicePath);

  let sliceText: string;
  try {
    sliceText = await fs.readFile(sliceAbsPath, 'utf-8');
  } catch {
    throw new Error(
      `verify-example-translate could not read --slice-path "${slicePath}" (looked for it at ` +
        `${sliceAbsPath}).`,
    );
  }

  const extractionParsed = await readRequiredExampleJsonFile(options.extraction, '--extraction');
  const extractionRaw = extractionParsed.value as RawExampleTranslateExtractionEntry[];
  if (!Array.isArray(extractionRaw)) {
    throw new Error(`--extraction at "${options.extraction}" must contain a JSON array.`);
  }
  const repairs = [...extractionParsed.repairs];

  // CR-03 fix: every raw lineNumber is cross-validated against buildExampleExtractionPayload's
  // own retained-line set for this slice BEFORE it is ever used to build a workedExampleId — a
  // fabricated or off-by-one lineNumber must fail closed here, never reach a payload or the
  // ledger.
  assertValidExampleLineNumbers({ path: slicePath, text: sliceText }, extractionRaw, '--extraction');

  // Collision guard on the FULL raw return, before any entry is split into
  // translatable/notTranslated — two entries at the same slicePath+lineNumber collide regardless
  // of which bucket they would otherwise fall into. Reuses the same helper
  // `verifyExampleRecordCommand` uses, never a second copy of it.
  keyRawExampleEntriesByLocation(
    extractionRaw,
    slicePath,
    '--extraction',
    (e) => e.sourceText ?? e.reason ?? '',
  );

  const notTranslated: VerifyExampleTranslateNotTranslatedEntry[] = [];
  const translatable: RawExampleTranslateExtractionEntry[] = [];
  for (const raw of extractionRaw) {
    if (raw.kind === 'example-inconsistent') {
      const reason = (raw.reason ?? '').trim();
      if (reason.length === 0) {
        throw new Error(
          `${slicePath}:${raw.lineNumber} is marked "example-inconsistent" but carries no reason.\n` +
            `Deciding it is inconsistent already happened at extraction time; this command never ` +
            `re-judges it, so it cannot proceed without the reason the extractor recorded.`,
        );
      }
      notTranslated.push({ lineNumber: raw.lineNumber, reason });
      continue;
    }
    translatable.push(raw);
  }

  // Build specs through the ONE shared choke point (example-derivation.ts) — never re-validated
  // here. `raw.slicePath` is overridden with THIS invocation's own --slice-path: identity is
  // assigned from the caller, never trusted from the model's own return.
  const specs: WorkedExampleSpec[] = translatable.map((raw) => {
    const id = workedExampleId({ slicePath, lineNumber: raw.lineNumber });
    return createWorkedExampleSpec({
      id,
      sliceText,
      returned: {
        slicePath,
        lineNumber: raw.lineNumber,
        pageCitation: raw.pageCitation ?? '',
        kind: raw.kind,
        sourceText: raw.sourceText ?? '',
        setup: raw.setup ?? '',
        action: raw.action,
        expected: raw.expected ?? '',
        supportingQuoteLines: raw.supportingQuoteLines,
      },
    });
  });
  const specsById = collectWorkedExampleSpecs(specs);

  // `collectGameApiSurface` called EXACTLY ONCE per invocation (178-CONTEXT.md decision, this
  // plan's <behavior>) — the same surface object is passed to every `buildExampleTranslationPayload`
  // call below, never re-collected per example.
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
    notTranslated: notTranslated.sort((a, b) => a.lineNumber - b.lineNumber),
    repairs,
  };

  // `--json` emits the result and nothing else on stdout. This command writes NOTHING to disk —
  // no ledger, no test file, no scratch file — its entire output is stdout.
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
  for (const repair of repairs) {
    console.log(chalk.yellow(`  ⚠ JSON transport repair — ${repair}`));
  }

  return result;
}
