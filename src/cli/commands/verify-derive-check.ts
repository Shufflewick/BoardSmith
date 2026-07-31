import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { atomicWriteFile } from './verify-run.js';
import type { DerivedLineClassification } from './verify-enumerate.js';

/**
 * `verify-derive-check.ts` — CHECK-04's mechanical core, RETARGETED onto the closed
 * dual-enumeration design (177.1-CONTEXT.md decision 2). This module owns the same four
 * guarantees the retired `verify-derive-recheck.ts` ledger proved across an 18-finding review
 * (177-09/177-10): atomic upsert-append (CR-06), fence-injection rejection at the single
 * construction site (CR-04), read-path revalidation through that same choke point (CR-02), and
 * an evidence requirement so a corroboration/contradiction citing nothing is never a valid
 * record (WR-05 analog). The machinery is MOVED, not rewritten — only the verdict enum and the
 * record's judgment fields change.
 *
 * DELIBERATE, DOCUMENTED SEMANTIC CHANGE (177.1-02): the retired record's `rederivedValue`/
 * `originalReading`/`rederivedReading`/`factAlignment` fields, and the WR-04 pass-through
 * cross-check between `rederivedValue` and `verdict`, have NO analogue under dual enumeration —
 * there is no second BLIND reading of the same line to align against the first. Dual enumeration
 * instead produces `groundedQuotes`: verbatim passages independently found by BOTH enumerators
 * and cross-checked by a reconciler, which is the evidence artifact that replaces them. Nothing
 * in this module is a "silent adaptation" of the retired fields — they are dropped entirely,
 * recorded here and in the plan's SUMMARY as a finding, not carried forward under a new name.
 *
 * The verdict set is NOT re-spelled here — it is imported from `verify-enumerate.ts`, the single
 * source of truth for `DerivedLineClassification`, and `DERIVE_CHECK_VERDICTS` is compile-time
 * tied to it (see the exhaustiveness guard immediately below the array) so the two can never
 * silently drift apart.
 *
 * The ledger this module writes (`recordDeriveCheckVerdicts`/`replaceDeriveCheckVerdicts`/
 * `readDeriveCheckVerdicts`) stays PROJECT-LEVEL — `rulebook/.derive-check/verdicts.md`, no
 * `.verify/<runId>/` segment, no `runId` parameter anywhere in any function's signature — CHECK-04
 * has nothing to scope to a run: it is source-free by construction, exactly like its retired
 * predecessor and CHECK-03/CHECK-05. Every durable write in this module goes through
 * `atomicWriteFile` (`verify-run.ts`) — the ONE atomic write path in the repo — never a second
 * `fs.writeFile`/`writeFileSync` call.
 */

// -------------------------------------------------------------------------------------------
// DERIVE_CHECK_VERDICTS — compile-time tied to DerivedLineClassification (177.1-02)
// -------------------------------------------------------------------------------------------

/**
 * The eight-member dual-enumeration verdict set, in the order `DerivedLineClassification`
 * declares it (`verify-enumerate.ts`). This is NOT a re-spelling of the retired four-member
 * `DERIVE_VERDICTS` — it is the closed design's own classification set, imported by type so this
 * array and the union it must exactly cover can never silently diverge.
 */
export const DERIVE_CHECK_VERDICTS = Object.freeze([
  'corroborated',
  'corroborated-by-composition',
  'uncorroborated',
  'contradicted',
  'quote-unverified',
  'absence-corroborated',
  'absence-contradicted',
  'absence-unverifiable',
] as const satisfies readonly DerivedLineClassification[]);

export type DeriveCheckVerdict = (typeof DERIVE_CHECK_VERDICTS)[number];

// Exhaustiveness guard: if `DerivedLineClassification` (verify-enumerate.ts) ever gains a member
// not present in `DERIVE_CHECK_VERDICTS`, this type resolves to something other than `never` and
// the assignment below fails to compile. Widening the union without widening the array is a
// compile error, not a runtime surprise discovered later.
type _MissingFromDeriveCheckVerdicts = Exclude<
  DerivedLineClassification,
  (typeof DERIVE_CHECK_VERDICTS)[number]
>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _deriveCheckVerdictsExhaustive: _MissingFromDeriveCheckVerdicts extends never
  ? true
  : never = true;

function isDeriveCheckVerdict(value: string): value is DeriveCheckVerdict {
  return (DERIVE_CHECK_VERDICTS as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------------------------
// DERIVE_CHECK_LEDGER_BEGIN / END — the ledger's own fence markers (CR-04)
// -------------------------------------------------------------------------------------------

export const DERIVE_CHECK_LEDGER_BEGIN = '<!-- boardsmith:derive-check-verdicts:begin -->';
export const DERIVE_CHECK_LEDGER_END = '<!-- boardsmith:derive-check-verdicts:end -->';

// -------------------------------------------------------------------------------------------
// DeriveCheckRecord — the CLI-validated, subagent-supplied verdict record
// -------------------------------------------------------------------------------------------

export interface DeriveCheckGroundedQuote {
  statement: string;
  quotedFromA: string;
  quotedFromB: string;
}

export interface DeriveCheckRecord {
  slicePath: string;
  lineNumber: number;
  /** The original `Derived (p.N): ...` line, verbatim — never mutated. */
  derivedLineText: string;
  verdict: DeriveCheckVerdict;
  /** The reasoning IS the artifact, mirroring every sibling ledger's decision. */
  reason: string;
  /** Grounded-both-bucket (or composed) fact ids the classification cites as support/conflict. */
  citedFactIds: string[];
  /**
   * The dual-enumeration evidence artifact that replaces the retired `originalReading`/
   * `rederivedReading` pair: verbatim passages independently found by both enumerators and
   * cross-checked by the reconciler. May be empty for a verdict with nothing to cite (mirrors
   * `citedFactIds`'s own honest-empty-state rule below).
   */
  groundedQuotes: DeriveCheckGroundedQuote[];
  /** ISO 8601, UTC. */
  recordedAt: string;
}

/**
 * Validates and constructs a `DeriveCheckRecord` from a subagent/reconciler-derived
 * classification. This is the ONLY place a verdict string is checked against
 * `DERIVE_CHECK_VERDICTS`; every recording path AND the read path
 * (`readDeriveCheckVerdicts`, CR-02) route through it. Throws when:
 *
 *   - the verdict is outside `DERIVE_CHECK_VERDICTS` (message names all eight legal verdicts)
 *   - `reason` is empty or whitespace-only — the reason IS the artifact
 *   - `reason`, `derivedLineText`, or any `groundedQuotes` string contains the ledger's own
 *     begin/end fence marker (CR-04 — `reason` is model-controlled free prose and
 *     `JSON.stringify` does not escape `<`, so an unrejected fence permanently corrupts the
 *     ledger), naming the offending field
 *   - the verdict is `corroborated`/`corroborated-by-composition`/`contradicted` and
 *     `citedFactIds` has no entry (WR-05 analog — a corroboration or contradiction citing
 *     nothing is not a valid record)
 *
 * `uncorroborated`, `quote-unverified`, `absence-corroborated`, `absence-contradicted`, and
 * `absence-unverifiable` construct successfully with empty `citedFactIds` — nothing to cite is
 * the honest state for those verdicts, never an error.
 *
 * Modeled as additional `if` blocks inside this same function — never a second validator
 * elsewhere in the module.
 */
export function createDeriveCheckRecord(input: {
  slicePath: string;
  lineNumber: number;
  derivedLineText: string;
  verdict: string;
  reason: string;
  citedFactIds?: string[];
  groundedQuotes?: DeriveCheckGroundedQuote[];
  recordedAt?: string;
}): DeriveCheckRecord {
  const location = `${input.slicePath}:${input.lineNumber}`;

  if (!isDeriveCheckVerdict(input.verdict)) {
    throw new Error(
      `Invalid verdict "${input.verdict}" for ${location}.\n` +
        `Expected one of: ${DERIVE_CHECK_VERDICTS.join(', ')}.`,
    );
  }
  if (input.reason.trim().length === 0) {
    throw new Error(
      `${location}'s verdict has no recorded reason.\n` +
        `The reason is the artifact this check exists to produce — a verdict label with no ` +
        `reason is not a valid record.`,
    );
  }

  const citedFactIds = input.citedFactIds ?? [];
  const groundedQuotes = input.groundedQuotes ?? [];

  // CR-04: reject any field carrying the ledger's own fence marker at the one construction site —
  // the read path (`readDeriveCheckVerdicts`) re-enters this same choke point, so a fence can
  // never reach a ledger, written by any caller, through any path.
  const fenceCheckFields: [string, string][] = [
    ['reason', input.reason],
    ['derivedLineText', input.derivedLineText],
    ...groundedQuotes.flatMap(
      (q, i): [string, string][] => [
        [`groundedQuotes[${i}].statement`, q.statement],
        [`groundedQuotes[${i}].quotedFromA`, q.quotedFromA],
        [`groundedQuotes[${i}].quotedFromB`, q.quotedFromB],
      ],
    ),
  ];
  for (const [field, value] of fenceCheckFields) {
    if (
      value.includes(DERIVE_CHECK_LEDGER_BEGIN) ||
      value.includes(DERIVE_CHECK_LEDGER_END)
    ) {
      throw new Error(
        `${location}'s ${field} contains a ledger fence marker.\n` +
          `Re-dispatch the subagent; a verdict field may never carry the ledger's own delimiters.`,
      );
    }
  }

  // WR-05 analog: a corroboration or contradiction citing no material is not a valid record.
  if (
    (input.verdict === 'corroborated' ||
      input.verdict === 'corroborated-by-composition' ||
      input.verdict === 'contradicted') &&
    citedFactIds.length === 0
  ) {
    throw new Error(
      `${location}'s "${input.verdict}" verdict has no citedFactIds.\n` +
        `A corroborated/corroborated-by-composition/contradicted verdict must cite at least one ` +
        `fact id — a classification citing nothing is not a valid record.`,
    );
  }

  return {
    slicePath: input.slicePath,
    lineNumber: input.lineNumber,
    derivedLineText: input.derivedLineText,
    verdict: input.verdict,
    reason: input.reason,
    citedFactIds,
    groundedQuotes,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
}

// -------------------------------------------------------------------------------------------
// deriveCheckLedgerPath / deriveCheckKey / replaceDeriveCheckVerdicts /
// recordDeriveCheckVerdicts / readDeriveCheckVerdicts — the PROJECT-LEVEL ledger
// (moved from verify-derive-recheck.ts, CR-02/CR-04/CR-06)
// -------------------------------------------------------------------------------------------

/**
 * The project-level ledger path — `rulebook/.derive-check/verdicts.md`. No `.verify/` segment,
 * no `runId` anywhere in this path: CHECK-04 has nothing to scope to a run.
 */
export function deriveCheckLedgerPath(projectDir: string): string {
  return join(projectDir, 'rulebook', '.derive-check', 'verdicts.md');
}

function deriveCheckKey(r: Pick<DeriveCheckRecord, 'slicePath' | 'lineNumber'>): string {
  return `${r.slicePath}:${r.lineNumber}`;
}

/**
 * Persists a batch of already-validated `DeriveCheckRecord`s (every record MUST have already
 * passed through `createDeriveCheckRecord` — this function accepts validated records and does not
 * re-parse verdict strings) to the project-level ledger, through `atomicWriteFile` — the ONE
 * atomic write path in the repo. `atomicWriteFile`'s temp-write-then-rename means no partial file
 * is ever observable.
 *
 * REPLACES the ENTIRE ledger body with exactly the `records` array supplied — this is a full
 * rewrite, not the callable the workflow uses. The dual-enumeration unit of work is a SLICE (all
 * its lines classified from one reconciler return), so the obvious per-slice call pattern against
 * this function would silently destroy every previously-recorded verdict from every OTHER slice on
 * each call. Use `recordDeriveCheckVerdicts` (plural, array-shaped) for that — it upserts through
 * this function rather than replacing directly. This function remains exported for the one
 * legitimate full-rewrite use case (e.g. re-seeding a ledger from a fresh batch) and for
 * `recordDeriveCheckVerdicts`'s own use.
 *
 * Accepts no `runId` parameter (2-arity: `projectDir`, `records`) — the ledger path contains no
 * run-id segment.
 */
export async function replaceDeriveCheckVerdicts(
  projectDir: string,
  records: DeriveCheckRecord[],
): Promise<{ ledgerPath: string }> {
  const ledgerPath = deriveCheckLedgerPath(projectDir);
  const lines = records.map((r) => JSON.stringify(r));
  const content =
    `# Derive Check Verdicts (CHECK-04) — project-level, no run-id\n\n` +
    `${DERIVE_CHECK_LEDGER_BEGIN}\n` +
    lines.join('\n') +
    (lines.length > 0 ? '\n' : '') +
    `${DERIVE_CHECK_LEDGER_END}\n`;
  await fs.mkdir(dirname(ledgerPath), { recursive: true });
  await atomicWriteFile(ledgerPath, content);
  return { ledgerPath: relative(projectDir, ledgerPath) };
}

/**
 * Records a BATCH of verdicts, upserting each by `slicePath:lineNumber` (CR-06): reads the
 * ledger's existing records, replaces any record already recorded for the same location (keeping
 * every other record untouched, in existing order), appends new keys last (so the ledger diff
 * stays reviewable), then writes the merged set through `replaceDeriveCheckVerdicts` — so there is
 * still exactly ONE durable write path in the module, just no longer the destructive default.
 *
 * SHAPE CHANGE FROM THE RETIRED PER-LINE API (177.1-02, per the plan's own note): this takes an
 * ARRAY, because the dual-enumeration unit of work is a SLICE (all its lines classified from one
 * reconciler return), not a single line recorded independently. The upsert-append guarantee is
 * unchanged — recording slice B's records never destroys slice A's: calling this twice for two
 * different slices leaves BOTH readable; calling it twice for the SAME `slicePath:lineNumber`
 * leaves exactly one record, carrying the second call's content.
 */
export async function recordDeriveCheckVerdicts(
  projectDir: string,
  records: DeriveCheckRecord[],
): Promise<{ ledgerPath: string }> {
  const existing = await readDeriveCheckVerdicts(projectDir);
  const incomingKeys = new Set(records.map((r) => deriveCheckKey(r)));
  const merged = [...existing.filter((r) => !incomingKeys.has(deriveCheckKey(r))), ...records];
  return replaceDeriveCheckVerdicts(projectDir, merged);
}

/**
 * Round-trips exactly what `replaceDeriveCheckVerdicts`/`recordDeriveCheckVerdicts` wrote,
 * including every one of the eight verdicts. Returns an empty array (never throws) when no ledger
 * has been written yet — a project that has never run CHECK-04's recording step has nothing
 * recorded, which is not a tool failure. Accepts no `runId` parameter (1-arity: `projectDir`).
 *
 * RE-ENTERS `createDeriveCheckRecord` ON EVERY PARSED LINE (CR-02): the ledger is a second entry
 * path into `DeriveCheckRecord`, not a bypass of the type — no `as DeriveCheckRecord` cast may
 * appear anywhere in this module. A hand-edited or out-of-enum ledger record throws through
 * `createDeriveCheckRecord`'s own checks (out-of-set verdict, missing evidence, a forged fence)
 * rather than reaching the report unvalidated and corrupting a verdict count with a `NaN`/`null`
 * key. A malformed JSON line throws one actionable message naming the ledger's relative path and
 * the 1-based record index — never a raw `SyntaxError`.
 */
export async function readDeriveCheckVerdicts(projectDir: string): Promise<DeriveCheckRecord[]> {
  const ledgerPath = deriveCheckLedgerPath(projectDir);
  let text: string;
  try {
    text = await fs.readFile(ledgerPath, 'utf-8');
  } catch {
    return [];
  }
  const beginIdx = text.indexOf(DERIVE_CHECK_LEDGER_BEGIN);
  const endIdx = text.indexOf(DERIVE_CHECK_LEDGER_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `Malformed derive-check ledger at ${relative(projectDir, ledgerPath)}: missing begin/end ` +
        `fence.`,
    );
  }
  const relLedgerPath = relative(projectDir, ledgerPath);
  const body = text.slice(beginIdx + DERIVE_CHECK_LEDGER_BEGIN.length, endIdx);
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
        `Malformed derive-check ledger at ${relLedgerPath} (record ${i + 1}): not valid JSON.\n` +
          `Delete the file to re-run CHECK-04 from scratch.`,
      );
    }
    const r = raw as Record<string, unknown>;
    try {
      return createDeriveCheckRecord({
        slicePath: String(r.slicePath ?? ''),
        lineNumber: Number(r.lineNumber),
        derivedLineText: String(r.derivedLineText ?? ''),
        verdict: String(r.verdict ?? ''),
        reason: String(r.reason ?? ''),
        citedFactIds: Array.isArray(r.citedFactIds) ? (r.citedFactIds as string[]) : [],
        groundedQuotes: Array.isArray(r.groundedQuotes)
          ? (r.groundedQuotes as DeriveCheckGroundedQuote[])
          : [],
        recordedAt: r.recordedAt !== undefined ? String(r.recordedAt) : undefined,
      });
    } catch (err) {
      throw new Error(
        `Malformed derive-check ledger at ${relLedgerPath} (record ${i + 1}): ` +
          `${(err as Error).message}\nDelete the file to re-run CHECK-04 from scratch.`,
      );
    }
  });
}

// -------------------------------------------------------------------------------------------
// Not yet defined in this module (177.1-03's job)
// -------------------------------------------------------------------------------------------

// The write-surface command (`verify-derive-record`), `reconcileSlice()`, and the CLI retarget
// that dispatches enumerator/reconciler subagents and calls `recordDeriveCheckVerdicts` are
// 177.1-03's job — this plan delivers only the data layer (verdict set, single construction
// site, and the ledger) those later pieces will build on.
