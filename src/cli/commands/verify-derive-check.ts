import {
  DESIGN_DIR,
  designDir,
  designRulebookDir,
} from '../lib/project-paths.js';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { atomicWriteFile } from './verify-run.js';
import { isPresentationLine } from './verify-classify.js';
import { DERIVED_LINE_RE, annotationLineStartRe } from './derived-line-pattern.js';
import {
  createEnumeratedFact,
  validateGrounding,
  composeArithmeticClaim,
  composeArithmeticChain,
  classifyDerivedLines,
  buildEnumeratorPayload,
  QuoteVerifiedProvenance,
  type DerivedLineClassification,
  type NumericValue,
  type EnumeratedFact,
  type ArithmeticOp,
  type ArithmeticChainStep,
  type ReconcilerBothClaim,
  type ReconcilerDerivedLineClaim,
  type GroundedBothFact,
  type GroundingResult,
  type GroundingRejection,
  type ComposedFact,
  type ComposeOutcome,
  type ComposeChainOutcome,
  type DerivedLineClassificationResult,
  type MissedFact,
} from './verify-enumerate.js';

/**
 * The three pinned model ids the SKILL orchestrator dispatches (177.1-CONTEXT.md decision 4) —
 * exactly what `177-22-MEASUREMENT/driver.mjs:17-19` dispatched. Cross-family independence
 * between the two enumerators was load-bearing in every CHECK-04 measurement; pinning these here
 * means an orchestrator can never silently substitute a different model and quietly weaken that
 * independence premise.
 */
export const DERIVE_CHECK_MODELS = Object.freeze({
  enumeratorA: 'claude-opus-5',
  enumeratorB: 'claude-haiku-4-5-20251001',
  reconciler: 'claude-sonnet-5',
} as const);

/**
 * `verify-derive-check.ts` — CHECK-04's mechanical core, RETARGETED onto the closed
 * dual-enumeration design (177.1-CONTEXT.md decision 2). This module owns the same four
 * guarantees the retired blind-derivation ledger proved across an 18-finding review
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
// readLiveSlices / annotationBody / quoteLinesOnly / enumerateDerivedLines — MOVED wholesale from
// the retired blind-derivation module (177.1-CONTEXT.md decision 6; the module itself, and every
// symbol not moved here, was deleted outright in 177.1-07). These are the design-agnostic parts
// the CHECK-04 closure note already named as carrying forward unchanged: the live-tree read, the
// decoration-normalization choke point, the quote-only payload filter, and candidate enumeration.
// The targeting-specific machinery (the opaque-handle/focus-window/payload-construction/
// per-slice-payload-set functions, plus the retired per-line judgment field) is NOT moved — it
// was specific to the retired design and no longer exists anywhere in the tree.
// -------------------------------------------------------------------------------------------

/**
 * Reads the LIVE `rulebook/*.md` tree directly — the same source `verify-classify.ts`'s
 * `computeRunPairs` already reads (excluding `INDEX.md`, the archive manifest, and
 * `00-visual-survey.md`, `ingest-archive.ts`'s presentation-by-design UI-ask handoff artifact).
 * This is the correct "which files are slices" definition for a source-free, run-less check
 * (decision 14): CHECK-04 targets live slices with NO staged prerequisite and never constructs a
 * `.verify/<runId>/` staging path — proven behaviorally by
 * `verifyDeriveCheckCommand`'s own `.verify/` decoy test.
 */
export async function readLiveSlices(
  projectDir: string,
): Promise<{ path: string; text: string }[]> {
  const rulebookDir = designRulebookDir(projectDir);
  let names: string[];
  try {
    const entries = await fs.readdir(rulebookDir, { withFileTypes: true });
    names = entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith('.md') &&
          e.name !== 'INDEX.md' &&
          e.name !== '00-visual-survey.md',
      )
      .map((e) => e.name)
      .sort();
  } catch (err) {
    // (WR-02/WR-10): this is the ONE "no rulebook/" message in the module — only ENOENT means
    // "does not exist"; any other errno (EACCES, ENOTDIR, ...) is a real, different condition and
    // must say so, never be reported as a missing directory.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `No rulebook/ directory in ${projectDir}.\n` +
          `Pass --project <dir> to target the bs-project this check should read.`,
      );
    }
    throw new Error(
      `rulebook/ exists at ${rulebookDir} but could not be read (${code ?? 'unknown error'}).\n` +
        `Pass --project <dir> to target the bs-project this check should read, and confirm the ` +
        `directory is accessible.`,
    );
  }
  return Promise.all(
    names.map(async (name) => ({
      path: `rulebook/${name}`,
      text: await fs.readFile(join(rulebookDir, name), 'utf-8'),
    })),
  );
}

/**
 * Leading blockquote markers, list bullets, and ordered-list markers, repeatable (a line can be
 * both quoted AND bulleted, e.g. `> - Derived (p.1): ...`) — stripped before every prefix test.
 * This is the ONE decoration-normalization site (`annotationBody`, immediately below); no caller
 * re-derives its own trim/strip logic.
 */
const LINE_DECORATION_RE = /^(?:[>\-*+]\s*|\d+\.\s+)*/;

/**
 * Trims `line` and strips any leading markdown decoration (blockquote markers, list bullets,
 * ordered-list markers), returning the annotation-testable body. `quoteLinesOnly` and
 * `enumerateDerivedLines` both route through this single function before testing any of the three
 * prefix regexes below, so the two can never diverge on what counts as decoration (CR-01). Not
 * applied to anything else — a directly-quoted sentence's own leading `"` is never decoration and
 * must never be stripped.
 */
export function annotationBody(line: string): string {
  return line.trim().replace(LINE_DECORATION_RE, '');
}

/**
 * Built via the shared `annotationLineStartRe` factory (`derived-line-pattern.ts`) rather than a
 * hand-spelled literal — equivalent to the former `/^Visual \(p\.[^)]*\)/i`.
 *
 * Exported (178-01 Task 3): plan 178-02's example-extraction payload needs `Visual (p.N):` lines
 * — `seven`'s Run-example contradiction (text "5, 6, 7" vs. card art 1, 2, 3) is recorded ONLY in
 * a `Visual (p.1):` line, not a `Derived` line, so extraction cannot rely on `Derived` alone.
 */
export const VISUAL_LINE_RE = annotationLineStartRe('Visual');
/**
 * A `Named-but-undefined` line is an ingest-time INFERENCE about undefined terminology, not
 * directly-quoted rulebook prose — excluded from every "quote lines only" payload alongside
 * `Derived`/`Visual`/`Example`.
 *
 * Built via the shared `annotationLineStartRe` factory rather than a hand-spelled literal —
 * equivalent to the former `/^Named-but-undefined \(p\.[^)]*\)/i`.
 */
const NAMED_BUT_UNDEFINED_LINE_RE = annotationLineStartRe('Named-but-undefined');

/**
 * A `Example (p.N):` line marks a worked-example annotation (178-01, closing WR-07 by Option B —
 * see `178-WR07-DECISION.md`) — added to `quoteLinesOnly`'s deny-list alongside the other three
 * family forms rather than treated as directly-quoted content. CHECK-06 (plan 178-02+) needs the
 * lines this excludes, so it builds its OWN separate extraction payload rather than reusing
 * `quoteLinesOnly` — this module's "quote lines only" payload stays CHECK-04's, unchanged in
 * composition on every reference game (178-01-MEASUREMENT/RESULTS.md: zero `Example (p.` lines
 * exist today, so this exclusion is measured zero-behavior-change).
 *
 * Built via the shared `annotationLineStartRe` factory rather than a hand-spelled literal —
 * equivalent to `/^Example \(p\.[^)]*\)/i`. Exported: `verify-derive-check.test.ts` and plan
 * 178-02's extraction module both need it.
 */
export const EXAMPLE_LINE_RE = annotationLineStartRe('Example');

/**
 * True when `line` (already `.trim()`ed) belongs in a "quote lines only" payload: not blank, not
 * a markdown heading, and not one of the four annotation-family lines (via `annotationBody`, the
 * single decoration-normalization site).
 */
function isQuoteLine(line: string): boolean {
  if (line.length === 0 || line.startsWith('#')) return false;
  const body = annotationBody(line);
  return (
    !DERIVED_LINE_RE.test(body) &&
    !VISUAL_LINE_RE.test(body) &&
    !NAMED_BUT_UNDEFINED_LINE_RE.test(body) &&
    !EXAMPLE_LINE_RE.test(body)
  );
}

/**
 * Selects ONLY directly-quoted rulebook content and its citation headers from `sliceText` — the
 * deliberate INVERSE of `ruleBearingLines()` (`verify-classify.ts`), which KEEPS unqualified
 * `Derived` lines because they are rule-bearing for classification purposes. Every enumerator
 * payload `buildEnumeratorPayload` (`verify-enumerate.ts`) builds is assembled from exactly this
 * filter's output — reused rather than re-derived, so the two modules can never diverge on what
 * counts as a quote line. This IS WR-07's deny-list; WR-07 was RESOLVED by 178-01 Task 2 as
 * Option B — keep the deny-list (do NOT invert to an allow-list), and add `Example` to it
 * (`EXAMPLE_LINE_RE`, above) rather than treat `Example (p.N):` as quotable content. See
 * `.planning/phases/178-worked-example-tests/178-WR07-DECISION.md` for the full evidence.
 *
 * Drops blank lines and markdown headings (`#`). Bare `p.N, <label>:` citation headers are
 * RETAINED (they carry no rule content of their own, but an enumerator needs them to know which
 * page a quote comes from) along with the directly-quoted prose beneath them.
 *
 * This is the single construction site for what counts as a "quote line" in this module — no
 * caller re-derives its own subset of a slice's content.
 */
export function quoteLinesOnly(sliceText: string): string[] {
  return sliceText
    .split('\n')
    .map((line) => line.trim())
    .filter(isQuoteLine);
}

// -------------------------------------------------------------------------------------------
// enumerateDerivedLines — enumerate-and-report, never silently drop
// -------------------------------------------------------------------------------------------

export interface DerivedLineEntry {
  slicePath: string;
  /** 1-based, matching the file's own line numbering. */
  lineNumber: number;
  /** The line's own verbatim, trimmed text. */
  text: string;
}

export interface EnumerateDerivedLinesResult {
  /** Every `Derived (p.` line surviving `isPresentationLine` exclusion — reaches the subagent. */
  candidates: DerivedLineEntry[];
  /** `Derived (p.` lines the mechanical presentation filter excluded, reported not dropped. */
  excluded: DerivedLineEntry[];
}

/**
 * A `Derived (p.N):` occurrence whose citation body contains NO digit at all — the literal
 * annotation-convention LEGEND text some rulebooks (e.g. `doom-machine/rulebook/CARDS.md`) write
 * to explain the `Derived (p.N):` convention itself, using the letter `N` as a placeholder, not a
 * real page citation. `DERIVED_LINE_RE`'s citation body (`[^)]*`) matches this literal text same
 * as a real citation would — it is NOT a real annotation and must never become a candidate. This
 * is the harness's own disclosed 177-21 fix (`extract-corpus.mjs`'s `DERIVED_ANYWHERE_RE`,
 * `/Derived\s*\(p\.\d/i`, requiring an actual digit), carried into the product path here rather
 * than left as a measurement-only patch: the retired blind-derivation module never carried
 * this fix, because its own real `buildEnumeratorPayload`/`quoteLinesOnly` pipeline happened never
 * to be exercised against a slice where the legend line escapes its usual backtick/quote
 * decoration. A future rulebook writing that legend WITHOUT decoration must still yield zero
 * candidates for it, mechanically, not by accident of formatting.
 */
const DERIVED_CITATION_LEGEND_PLACEHOLDER_RE = /^Derived \(p\.[^0-9)]*\)/i;

/**
 * Enumerates every `Derived (p.` line in the live tree, split into the mechanically-excluded
 * presentation subset and the surviving candidates a judgment subagent evaluates. The
 * annotation-convention legend placeholder (`Derived (p.N):`, no digit) is recognized and
 * excluded from BOTH `candidates` and `excluded` — it is not a real annotation of either kind, so
 * it is silently skipped from this function's accounting entirely, exactly as the real
 * `buildEnumeratorPayload`/`quoteLinesOnly` pipeline already treats it (it is never a quote line
 * either).
 *
 * Does NOT decide rule-bearingness here — that is the reconciler's job. `isPresentationLine` only
 * catches the QUALIFIED presentation forms (`— diagram description:`, `— art:`, `Visual (p.N):`);
 * an unqualified presentation-shaped line reaches `candidates` by design, depending entirely on a
 * competent reconciler dispatch returning `uncorroborated`/similar for it.
 */
export function enumerateDerivedLines(
  slices: { path: string; text: string }[],
): EnumerateDerivedLinesResult {
  const candidates: DerivedLineEntry[] = [];
  const excluded: DerivedLineEntry[] = [];

  for (const slice of slices) {
    const rawLines = slice.text.split('\n');
    rawLines.forEach((rawLine, index) => {
      const line = rawLine.trim();
      const body = annotationBody(line);
      if (!DERIVED_LINE_RE.test(body)) return;
      if (DERIVED_CITATION_LEGEND_PLACEHOLDER_RE.test(body)) return;
      const entry: DerivedLineEntry = {
        slicePath: slice.path,
        lineNumber: index + 1,
        text: line,
      };
      if (isPresentationLine(body)) {
        excluded.push(entry);
      } else {
        candidates.push(entry);
      }
    });
  }

  return { candidates, excluded };
}

// -------------------------------------------------------------------------------------------
// DERIVE_CHECK_VERDICTS — compile-time tied to DerivedLineClassification (177.1-02)
// -------------------------------------------------------------------------------------------

/**
 * The eight-member dual-enumeration verdict set, in the order `DerivedLineClassification`
 * declares it (`verify-enumerate.ts`). This is NOT a re-spelling of the retired four-member
 * blind-derivation verdict enum — it is the closed design's own classification set, imported by
 * type so this array and the union it must exactly cover can never silently diverge.
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
// (moved from the retired blind-derivation module, CR-02/CR-04/CR-06)
// -------------------------------------------------------------------------------------------

/**
 * The project-level ledger path — `rulebook/.derive-check/verdicts.md`. No `.verify/` segment,
 * no `runId` anywhere in this path: CHECK-04 has nothing to scope to a run.
 */
export function deriveCheckLedgerPath(projectDir: string): string {
  return join(designRulebookDir(projectDir), '.derive-check', 'verdicts.md');
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
// verifyDeriveCheckCommand — the read/report surface (177.1-04)
// -------------------------------------------------------------------------------------------

export interface VerifyDeriveCheckOptions {
  project?: string;
  json?: boolean;
}

export interface VerifyDeriveCheckSlice {
  slicePath: string;
  /** Count of candidates surviving `isPresentationLine` exclusion in this slice. */
  candidates: number;
  /**
   * Emitted ONLY when this slice has at least one pending candidate (not yet ledger-recorded, or
   * stale) — a fully-recorded slice does not need re-dispatching, and emitting its payload would
   * put quote lines on stdout for no reason. The exact `buildEnumeratorPayload` output bytes.
   */
  enumeratorPayload?: string;
  /** Names the slice `buildEnumeratorPayload` threw for; the slice is never dispatched when set. */
  payloadError?: string;
  /** lineNumber + verbatim text for every surviving candidate in this slice, for the reconciler. */
  derivedLines: { lineNumber: number; text: string }[];
}

export interface VerifyDeriveCheckFinding {
  slicePath: string;
  lineNumber: number;
  derivedLineText: string;
  verdict: DeriveCheckVerdict | 'pending';
  reason: string;
  citedFactIds: string[];
  status: 'recorded' | 'pending';
}

export interface VerifyDeriveCheckResult {
  projectDir: string;
  models: typeof DERIVE_CHECK_MODELS;
  slices: VerifyDeriveCheckSlice[];
  findings: VerifyDeriveCheckFinding[];
  verdictCounts: Record<DeriveCheckVerdict, number>;
  pendingCount: number;
  staleRecords: string[];
  orphanedRecords: string[];
  /**
   * Always empty: this is a READ/REPORT command — it never dispatches an enumerator or
   * reconciler and never runs `reconcileSlice`/`validateGrounding` itself, so it has no grounding
   * rejections of its own to report. Present for `--json` shape stability with the write
   * surface's own `rejected` field (`verifyDeriveRecordCommand`); a fabricating reconciler's
   * rejections are surfaced there, at record time, not re-derived here from a ledger that does
   * not persist them.
   */
  groundingRejections: GroundingRejection[];
  /** Always 0, for the same reason as `groundingRejections` above. */
  missedFactCount: number;
}

function emptyDeriveCheckVerdictCounts(): Record<DeriveCheckVerdict, number> {
  const counts = {} as Record<DeriveCheckVerdict, number>;
  for (const v of DERIVE_CHECK_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * `boardsmith verify-derive-check` — CHECK-04's read/report surface: enumerates every live-tree
 * `Derived` line PROJECT-WIDE (never scoped to stale chunks, never reading a `rulebook/.verify/`
 * staging path — `readLiveSlices` reads only `rulebook/*.md`), joins each surviving candidate to
 * whatever `verify-derive-record` has already persisted to the project-level ledger, and hands
 * back the exact `buildEnumeratorPayload` bytes for every slice with at least one pending
 * candidate so the orchestrator can dispatch it without re-deriving anything itself.
 *
 * ADVISORY, EXIT 0, NEVER GATES (177.1-CONTEXT.md decision 14): this function never assigns
 * `process.exitCode` anywhere, including when the ledger contains a `contradicted` record — a
 * rewiring is exactly the kind of change that could silently flip a gate, so this posture is
 * pinned by a behavioral test asserting `process.exitCode` stays `undefined` even then. A
 * non-corroboration is reported to a human as "worth a glance", never as a verdict of failure.
 *
 * Only an unreadable project/rulebook throws (via `readLiveSlices`), with a single actionable
 * line naming `--project` — no stack frame, no `.ts:` reference.
 */
export async function verifyDeriveCheckCommand(
  options: VerifyDeriveCheckOptions = {},
): Promise<VerifyDeriveCheckResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  const liveSlices = await readLiveSlices(projectDir);
  const { candidates } = enumerateDerivedLines(liveSlices);
  const sliceTextByPath = new Map(liveSlices.map((s) => [s.path, s.text] as const));

  const recorded = await readDeriveCheckVerdicts(projectDir);
  const recordedByLocation = new Map(recorded.map((r) => [deriveCheckKey(r), r] as const));
  const candidateLocations = new Set(candidates.map((c) => deriveCheckKey(c)));

  const candidatesBySlice = new Map<string, DerivedLineEntry[]>();
  for (const c of candidates) {
    const list = candidatesBySlice.get(c.slicePath) ?? [];
    list.push(c);
    candidatesBySlice.set(c.slicePath, list);
  }

  const verdictCounts = emptyDeriveCheckVerdictCounts();
  const staleRecords: string[] = [];
  let pendingCount = 0;

  const findings: VerifyDeriveCheckFinding[] = candidates.map((entry) => {
    const record = recordedByLocation.get(deriveCheckKey(entry));
    // CR-03: the join is on LOCATION + TEXT, never location alone. A record whose
    // `derivedLineText` no longer matches the current candidate's text was recorded against text
    // that has since been edited or shifted — inheriting its verdict would report a false
    // corroboration/contradiction of text that was never reconciled. Report it `pending` and
    // surface the mismatch in `staleRecords` instead of silently reusing the stale verdict.
    if (record && record.derivedLineText === entry.text) {
      verdictCounts[record.verdict]++;
      return {
        slicePath: entry.slicePath,
        lineNumber: entry.lineNumber,
        derivedLineText: entry.text,
        verdict: record.verdict,
        reason: record.reason,
        citedFactIds: record.citedFactIds,
        status: 'recorded' as const,
      };
    }
    if (record) {
      staleRecords.push(
        `${entry.slicePath}:${entry.lineNumber} has a recorded verdict for different text ` +
          `("${record.derivedLineText}") — reporting it pending, never inheriting a verdict for ` +
          `a line that changed.`,
      );
    }
    pendingCount++;
    return {
      slicePath: entry.slicePath,
      lineNumber: entry.lineNumber,
      derivedLineText: entry.text,
      verdict: 'pending' as const,
      reason: '',
      citedFactIds: [],
      status: 'pending' as const,
    };
  });

  // WR-03: a ledger record whose location matches no current candidate (a deleted slice, a moved
  // line, a line the presentation filter now excludes) is reported as an orphan, never silently
  // discarded.
  const orphanedRecords = recorded
    .filter((r) => !candidateLocations.has(deriveCheckKey(r)))
    .map(
      (r) =>
        `${r.slicePath}:${r.lineNumber} has a recorded verdict ("${r.verdict}") for a location ` +
        `that matches no current candidate.`,
    );

  const slices: VerifyDeriveCheckSlice[] = [];
  for (const [slicePath, sliceCandidates] of candidatesBySlice) {
    const hasPending = sliceCandidates.some((c) => {
      const record = recordedByLocation.get(deriveCheckKey(c));
      return !record || record.derivedLineText !== c.text;
    });
    const derivedLines = sliceCandidates
      .slice()
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((c) => ({ lineNumber: c.lineNumber, text: c.text }));

    const sliceEntry: VerifyDeriveCheckSlice = {
      slicePath,
      candidates: sliceCandidates.length,
      derivedLines,
    };

    // Emit `enumeratorPayload` ONLY for slices with pending candidates — a fully-recorded slice
    // does not need re-dispatching.
    if (hasPending) {
      const sliceText = sliceTextByPath.get(slicePath) ?? '';
      try {
        sliceEntry.enumeratorPayload = buildEnumeratorPayload({ path: slicePath, text: sliceText });
      } catch (err) {
        // A slice whose payload throws is reported with `payloadError` naming the slice, never
        // silently skipped and never dispatched.
        sliceEntry.payloadError = `${slicePath}: ${(err as Error).message}`;
      }
    }

    slices.push(sliceEntry);
  }
  slices.sort((a, b) => a.slicePath.localeCompare(b.slicePath));

  const result: VerifyDeriveCheckResult = {
    projectDir,
    models: DERIVE_CHECK_MODELS,
    slices,
    findings,
    verdictCounts,
    pendingCount,
    staleRecords,
    orphanedRecords,
    groundingRejections: [],
    missedFactCount: 0,
  };

  // `--json` emits the result and nothing else on stdout.
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    chalk.green(
      `✓ Derive check — ${candidates.length} rule-bearing candidate(s) across ${slices.length} ` +
        `slice(s), ${pendingCount} pending`,
    ),
  );
  for (const v of DERIVE_CHECK_VERDICTS) {
    console.log(`  ${v}: ${verdictCounts[v]}`);
  }
  for (const finding of findings) {
    if (
      finding.status === 'pending' ||
      finding.verdict === 'corroborated' ||
      finding.verdict === 'corroborated-by-composition'
    ) {
      continue;
    }
    console.log(
      chalk.yellow(
        `  ⚠ ${finding.verdict} (worth a human glance, never a verdict) — ` +
          `${finding.slicePath}:${finding.lineNumber}`,
      ),
    );
    console.log(`    Reason: ${finding.reason}`);
  }
  for (const stale of staleRecords) {
    console.log(chalk.yellow(`  ⚠ STALE — ${stale}`));
  }
  for (const orphan of orphanedRecords) {
    console.log(chalk.yellow(`  ⚠ ORPHANED — ${orphan}`));
  }

  return result;
}

// -------------------------------------------------------------------------------------------
// reconcileSlice() — the compute pipeline (177.1-03)
// -------------------------------------------------------------------------------------------

/**
 * One enumerator's already-parsed structured return — the `verify/enumerate-facts.md` RETURN
 * shape, exactly. Never a raw dispatch envelope: a Task-tool dispatch returns already-structured
 * output, so there is no `raw`/fenced-text layer to unwrap here (unlike the `.planning/`
 * measurement harness's `analyze.mjs`, which parsed manual `--output-format json` captures).
 */
export interface EnumeratorFactInput {
  statement: string;
  sourceSentence: string;
  numericValue?: NumericValue;
}

export interface EnumeratorReturn {
  facts: EnumeratorFactInput[];
}

/** One leaf/step-result reference inside an `arithmeticSpec` chain step (reconcile-facts.md). */
export type ArithmeticSpecOperandRef =
  | { kind: 'fact'; statement: string }
  | { kind: 'stepResult'; index: number };

export interface ArithmeticSpecStep {
  operation: ArithmeticOp;
  operandRefs: ArithmeticSpecOperandRef[];
}

export interface ArithmeticSpecSingle {
  kind: 'single';
  operation: ArithmeticOp;
  operandStatements: string[];
  claimedResult: NumericValue;
}

export interface ArithmeticSpecChain {
  kind: 'chain';
  steps: ArithmeticSpecStep[];
  claimedResult: NumericValue;
}

/**
 * The machine-readable pointer `reconcile-facts.md` (177.1-03 Task 1) instructs the reconciler to
 * populate for every `corroborated-by-composition` proposal, additive to the free-prose
 * `arithmeticNote`. Code — never the reconciler — performs the arithmetic and rejects a wrong
 * `claimedResult`; this type only carries WHICH facts and WHICH operation the reconciler is
 * pointing at.
 */
export type ArithmeticSpec = ArithmeticSpecSingle | ArithmeticSpecChain;

export interface ReconcilerDerivedLineProposal {
  lineNumber: number;
  derivedLineText: string;
  proposedClassification:
    | 'corroborated'
    | 'corroborated-by-composition'
    | 'uncorroborated'
    | 'contradicted'
    | 'absence';
  citedBothStatements: string[];
  arithmeticNote?: string;
  arithmeticSpec?: ArithmeticSpec;
  absenceTargets?: string[];
}

/** The `verify/reconcile-facts.md` RETURN shape, exactly — one reconciler dispatch, one slice. */
export interface ReconcilerReturn {
  both: ReconcilerBothClaim[];
  aOnly: { statement: string; sourceSentence: string }[];
  bOnly: { statement: string; sourceSentence: string }[];
  derivedLineProposals: ReconcilerDerivedLineProposal[];
}

export interface ReconcileSliceComposeAttempt {
  lineNumber: number;
  outcome: ComposeOutcome | ComposeChainOutcome;
}

export interface ReconcileSliceResult {
  listA: EnumeratedFact[];
  listB: EnumeratedFact[];
  grounding: GroundingResult;
  composed: ComposedFact[];
  composeAttempts: ReconcileSliceComposeAttempt[];
  classifications: DerivedLineClassificationResult[];
  missed: MissedFact[];
  aOnly: { statement: string; sourceSentence: string }[];
  bOnly: { statement: string; sourceSentence: string }[];
}

/**
 * Sentinel stored in {@link buildGroundedByStatement}'s map when two DISTINCT grounded facts in
 * the same slice share identical `statement` text — CR-01 (177.1 code review). Nothing enforces
 * `statement` uniqueness across a slice's "both" claims; it is model-authored prose. Composing
 * from whichever fact happened to be inserted last (the prior behavior) can silently substitute a
 * different fact's magnitude into an arithmetic operand than the reconciler actually intended —
 * fail-closed instead: a collision resolves to this sentinel, never to either fact.
 */
const AMBIGUOUS_OPERAND_STATEMENT = Symbol('ambiguous-operand-statement');
type GroundedLookupValue = GroundedBothFact | typeof AMBIGUOUS_OPERAND_STATEMENT;

/**
 * Builds the `statement -> GroundedBothFact` lookup `resolveArithmeticSpec` resolves operand
 * pointers through, refusing (never last-write-wins) when two distinct grounded facts in
 * `grounded` share identical `statement` text (CR-01). A collision maps to
 * `AMBIGUOUS_OPERAND_STATEMENT`, which every lookup site below must check for explicitly and
 * report as an unresolvable operand — the same posture as "no match at all", never treated as a
 * usable operand.
 */
function buildGroundedByStatement(
  grounded: readonly GroundedBothFact[],
): Map<string, GroundedLookupValue> {
  const map = new Map<string, GroundedLookupValue>();
  for (const g of grounded) {
    map.set(g.statement, map.has(g.statement) ? AMBIGUOUS_OPERAND_STATEMENT : g);
  }
  return map;
}

/**
 * Resolves ONE `arithmeticSpec` against this proposal's grounding-validated "both" facts, and
 * performs the actual composition check through the real, unmodified `composeArithmeticClaim`/
 * `composeArithmeticChain` (`verify-enumerate.ts`) — this function's ONLY job is turning the
 * reconciler's verbatim-statement pointers into the `GroundedBothFact[]`/`ArithmeticChainStep[]`
 * shapes those functions require; it never itself computes or judges an arithmetic result.
 *
 * A `chain` spec with more than `MAX_ARITHMETIC_CHAIN_DEPTH` steps is NOT checked here — that
 * bound is `composeArithmeticChain`'s own refusal, reached unmodified, never re-implemented as a
 * second check in this module.
 */
function resolveArithmeticSpec(
  spec: ArithmeticSpec,
  derivedLineText: string,
  groundedByStatement: Map<string, GroundedLookupValue>,
): ComposeOutcome | ComposeChainOutcome {
  if (spec.kind === 'single') {
    const operands: (GroundedLookupValue | undefined)[] = spec.operandStatements.map((s) =>
      groundedByStatement.get(s),
    );
    const ambiguousIndex = operands.findIndex((o) => o === AMBIGUOUS_OPERAND_STATEMENT);
    if (ambiguousIndex !== -1) {
      return {
        ok: false,
        reason:
          `arithmeticSpec.operandStatements[${ambiguousIndex}] ("${spec.operandStatements[ambiguousIndex]}") ` +
          `matches more than one distinct grounding-validated "both" fact for this slice (two "both" ` +
          `claims share identical statement text) — code cannot tell which one this operand means, ` +
          `and refuses to guess rather than silently pick either.`,
      };
    }
    const missingIndex = operands.findIndex((o) => !o);
    if (missingIndex !== -1) {
      return {
        ok: false,
        reason:
          `arithmeticSpec.operandStatements[${missingIndex}] ` +
          `("${spec.operandStatements[missingIndex]}") does not match any grounding-validated ` +
          `"both" statement for this proposal — code cannot resolve it to an operand.`,
      };
    }
    return composeArithmeticClaim({
      derivedLineText,
      operation: spec.operation,
      operands: operands as GroundedBothFact[],
      claimedResult: spec.claimedResult,
    });
  }

  // 'chain': flatten every 'fact' operand ref, across every step, into ONE ordered operand array
  // (deduplicated by statement, first-occurrence order), then resolve each step's operandRefs
  // against that array's indices — 'stepResult' refs pass through untouched, exactly as
  // `composeArithmeticChain` expects.
  const operandIndexByStatement = new Map<string, number>();
  const operands: GroundedBothFact[] = [];
  for (const step of spec.steps) {
    for (const ref of step.operandRefs) {
      if (ref.kind !== 'fact') continue;
      if (operandIndexByStatement.has(ref.statement)) continue;
      const fact = groundedByStatement.get(ref.statement);
      if (fact === AMBIGUOUS_OPERAND_STATEMENT) {
        return {
          ok: false,
          reason:
            `arithmeticSpec chain step references statement "${ref.statement}", which matches more ` +
            `than one distinct grounding-validated "both" fact for this slice (two "both" claims ` +
            `share identical statement text) — code cannot tell which one this operand means, and ` +
            `refuses to guess rather than silently pick either.`,
        };
      }
      if (!fact) {
        return {
          ok: false,
          reason:
            `arithmeticSpec chain step references statement "${ref.statement}", which does not ` +
            `match any grounding-validated "both" statement for this proposal — code cannot ` +
            `resolve it to an operand.`,
        };
      }
      operandIndexByStatement.set(ref.statement, operands.length);
      operands.push(fact);
    }
  }

  const steps: ArithmeticChainStep[] = spec.steps.map((step) => ({
    operation: step.operation,
    operandRefs: step.operandRefs.map((ref) =>
      ref.kind === 'fact'
        ? { kind: 'fact' as const, index: operandIndexByStatement.get(ref.statement)! }
        : { kind: 'stepResult' as const, index: ref.index },
    ),
  }));

  return composeArithmeticChain({
    derivedLineText,
    steps,
    operands,
    claimedResult: spec.claimedResult,
  });
}

/**
 * The CLI's compute pipeline for ONE slice: ingests the two enumerator returns and the reconciler
 * return, and runs `validateGrounding` -> arithmetic composition -> `classifyDerivedLines` — the
 * exact order `.planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/analyze.mjs`
 * (the reference implementation CHECK-04's closure was measured against) runs the same real,
 * unmodified `verify-enumerate.ts` functions in. This function calls NO subagent and reads NO
 * file — every argument is an already-parsed object; dispatching and file I/O are the CALLER's
 * job (the skill orchestrator dispatches, `verifyDeriveRecordCommand` — Task 3 — reads files).
 *
 * The ONE deliberate deviation from `analyze.mjs`: arithmetic operand resolution goes through
 * `arithmeticSpec` (177.1-03 Task 1's machine-readable pointer), not `analyze.mjs`'s hand-curated
 * `ARITHMETIC_LINES` table — the product has no hand list a live reconciler dispatch could ever
 * populate. See `resolveArithmeticSpec` above.
 */
export function reconcileSlice(input: {
  projectDir: string;
  slicePath: string;
  sliceText: string;
  enumeratorA: EnumeratorReturn;
  enumeratorB: EnumeratorReturn;
  reconciler: ReconcilerReturn;
  provenance: QuoteVerifiedProvenance | null;
}): ReconcileSliceResult {
  const { slicePath, sliceText, enumeratorA, enumeratorB, reconciler, provenance } = input;

  const listA = enumeratorA.facts.map((f) => createEnumeratedFact({ ...f, slicePath }));
  const listB = enumeratorB.facts.map((f) => createEnumeratedFact({ ...f, slicePath }));

  const claimedBoth: ReconcilerBothClaim[] = reconciler.both.map((b) => ({
    statement: b.statement,
    quotedFromA: b.quotedFromA,
    quotedFromB: b.quotedFromB,
  }));

  const grounding = validateGrounding(listA, listB, claimedBoth);
  const groundedByStatement = buildGroundedByStatement(grounding.grounded);

  const composed: ComposedFact[] = [];
  const composeAttempts: ReconcileSliceComposeAttempt[] = [];
  // CR-02: carries EACH proposal's own identity (its index in `derivedLineProposals`) through to
  // its composed fact, if any — never re-derived afterward via a `claimText === derivedLineText`
  // text lookup. `composed` is a flat pool accumulated across every `corroborated-by-composition`
  // proposal in the slice; two different proposals can carry byte-identical `derivedLineText`
  // (a repeated legend line, a duplicated annotation, two occurrences of the same templated
  // sentence — all plausible in real rulebooks), and a text-keyed `.find()` would then hand a
  // proposal whose OWN arithmetic was rejected the citation evidence of a DIFFERENT proposal that
  // merely happens to share its line's wording.
  const composedFactIdByIndex = new Map<number, string>();

  reconciler.derivedLineProposals.forEach((prop, index) => {
    if (prop.proposedClassification !== 'corroborated-by-composition') return;
    if (!prop.arithmeticSpec) {
      composeAttempts.push({
        lineNumber: prop.lineNumber,
        outcome: {
          ok: false,
          reason:
            'No arithmeticSpec was supplied for a corroborated-by-composition proposal — code ' +
            'has nothing to check, so the proposal falls through to uncorroborated.',
        },
      });
      return;
    }
    const outcome = resolveArithmeticSpec(
      prop.arithmeticSpec,
      prop.derivedLineText,
      groundedByStatement,
    );
    composeAttempts.push({ lineNumber: prop.lineNumber, outcome });
    if (outcome.ok) {
      composed.push(outcome.composed);
      composedFactIdByIndex.set(index, outcome.composed.id);
    }
  });

  const claims: ReconcilerDerivedLineClaim[] = reconciler.derivedLineProposals.map((prop, index) => {
    // CR-01: an ambiguous (collided) statement lookup is never a usable citation, same posture as
    // "not found" — filtered out below rather than propagating the sentinel as a fact id.
    const citedFactIds = prop.citedBothStatements
      .map((s) => groundedByStatement.get(s))
      .filter((g): g is GroundedBothFact => g !== undefined && g !== AMBIGUOUS_OPERAND_STATEMENT)
      .map((g) => g.id);
    const composedFactId =
      prop.proposedClassification === 'corroborated-by-composition'
        ? composedFactIdByIndex.get(index)
        : undefined;
    return {
      slicePath,
      lineNumber: prop.lineNumber,
      derivedLineText: prop.derivedLineText,
      proposedClassification: prop.proposedClassification,
      citedFactIds,
      composedFactId,
      absenceTargets: prop.absenceTargets,
    };
  });

  const { classifications, missed } = classifyDerivedLines({
    claims,
    groundedBoth: grounding.grounded,
    composed,
    provenance,
    passages: { [slicePath]: sliceText },
  });

  return {
    listA,
    listB,
    grounding,
    composed,
    composeAttempts,
    classifications,
    missed,
    aOnly: reconciler.aOnly,
    bOnly: reconciler.bOnly,
  };
}

/**
 * `parseSubagentJsonInput`'s return shape: the parsed value, plus a human-readable log of every
 * transport-artifact repair it took to get there. `repairs` is EMPTY when `text` parsed as JSON
 * on the first attempt — a repair is only ever reported when one actually ran, never emitted
 * speculatively (180-01 finding 5: "reports what it repaired... never a silent fix").
 */
export interface SubagentJsonParseResult {
  value: unknown;
  repairs: string[];
}

/**
 * Matches a markdown code fence wrapping the ENTIRE document — ``` or ```json on its own opening
 * line, a closing ``` on its own line, nothing outside either fence line but surrounding
 * whitespace. Deliberately narrow: this only recognizes a fence that wraps the *whole* return,
 * the transport artifact 180-PROOF.md finding 5 observed live (enumerator B's dispatch). It is
 * NOT the same guard as CR-04's `DERIVE_CHECK_LEDGER_BEGIN`/`END` fence-marker rejection in
 * `createDeriveCheckRecord` — that guard polices ledger-corruption inside a already-parsed
 * record's OWN field values and stays exactly as strict; this one only ever strips a fence
 * surrounding the raw bytes read off disk, before JSON.parse ever runs.
 */
const WRAPPING_MARKDOWN_FENCE_RE = /^\s*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/;

/**
 * Finds the outermost `{...}`/`[...]` span in `text` by locating the first `{` or `[` and the
 * LAST occurrence of that bracket's matching close character, and returns just that span when it
 * is a strict subset of `text` (i.e. there is prose to discard on at least one side). Returns
 * `null` when there is no bracket to anchor on, or when the span is the entirety of `text.trim()`
 * (nothing to repair). This is deliberately a byte-span heuristic, not a JSON tokenizer — good
 * enough to discard a prose PREFIX/SUFFIX around one JSON document (180-PROOF.md finding 7: the
 * reconciler's "```json is forbidden, returning raw JSON." line ahead of its actual return), not
 * meant to repair malformed JSON *inside* the span.
 */
function stripSurroundingProse(text: string): string | null {
  const firstBracket = text.search(/[{[]/);
  if (firstBracket === -1) return null;
  const openChar = text[firstBracket];
  const closeChar = openChar === '{' ? '}' : ']';
  const lastClose = text.lastIndexOf(closeChar);
  if (lastClose === -1 || lastClose <= firstBracket) return null;
  const span = text.slice(firstBracket, lastClose + 1);
  if (span === text.trim()) return null;
  return span;
}

/**
 * Parses one subagent-return JSON input file's already-read text, throwing ONE actionable
 * message naming the flag and the file path on failure — never a raw `SyntaxError`. Shared by
 * `verifyDeriveRecordCommand`/`verifyExampleRecordCommand`/`verifyExampleTranslateCommand` for
 * every `--enumerator-a`/`--enumerator-b`/`--reconciler`/`--extraction`/`--translation` file
 * input, so no call site can drift on error shape or repair behavior (SC-3: exactly one export
 * site — `example-derivation.test.ts`'s own duplicate-export guard covers this module too).
 *
 * A live dispatch's structured "return" is not always bare JSON on disk (180-01 finding 5): a
 * model can wrap its object in a ` ```json ` fence, or prefix/suffix it with prose. Before
 * failing, this function tries — in order, each attempt building on the last, each ONLY reported
 * in `repairs` when it actually changes the candidate text — (1) parsing `text` as-is, (2)
 * stripping a whole-document wrapping markdown fence, (3) discarding prose before the first
 * bracket and after the last matching one. A repair is a logged fact about a transport artifact,
 * never a silent rewrite: `repairs` always reaches the caller (via `readRequiredJsonFile`/
 * `readRequiredExampleJsonFile`) and from there into the command's own `--json` output.
 */
export function parseSubagentJsonInput(
  text: string,
  flagLabel: string,
  filePath: string,
): SubagentJsonParseResult {
  const repairs: string[] = [];

  try {
    return { value: JSON.parse(text), repairs };
  } catch {
    // fall through to repair attempts below
  }

  let candidate = text;

  const fenceMatch = candidate.match(WRAPPING_MARKDOWN_FENCE_RE);
  if (fenceMatch) {
    candidate = fenceMatch[1];
    repairs.push(
      `${flagLabel}: stripped a markdown code fence wrapping the whole JSON document.`,
    );
    try {
      return { value: JSON.parse(candidate), repairs };
    } catch {
      // fall through to prose-stripping below, against the fence-stripped candidate
    }
  }

  const stripped = stripSurroundingProse(candidate);
  if (stripped !== null) {
    repairs.push(
      `${flagLabel}: discarded prose surrounding the JSON document (before the first bracket ` +
        `and/or after the last matching one).`,
    );
    try {
      return { value: JSON.parse(stripped), repairs };
    } catch {
      // falls through to the actionable failure below
    }
  }

  throw new Error(
    `Failed to parse ${flagLabel} JSON at ${filePath}: the file does not contain valid JSON, ` +
      `even after stripping a wrapping markdown code fence and surrounding prose.\n` +
      `Re-dispatch the subagent and write its structured return to this file, unmodified.`,
  );
}

// -------------------------------------------------------------------------------------------
// verifyDeriveRecordCommand — the write surface, retargeted onto reconcileSlice (177.1-03 Task 3)
// -------------------------------------------------------------------------------------------

async function readRequiredJsonFile(
  filePath: string,
  flagLabel: string,
): Promise<SubagentJsonParseResult> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`verify-derive-record could not read ${flagLabel} at "${filePath}".`);
  }
  return parseSubagentJsonInput(text, flagLabel, filePath);
}

export interface VerifyDeriveRecordOptions {
  project?: string;
  slicePath?: string;
  enumeratorA?: string;
  enumeratorB?: string;
  reconciler?: string;
  json?: boolean;
}

/**
 * The exact, documented `--json` output shape — `records`, `ledgerPath`, and `rejected`, and
 * nothing else. `rejected` is NEVER omitted or silently dropped, even when empty: a fabricating
 * reconciler's grounding rejections are a signal worth surfacing (177.1-CONTEXT.md decision 3),
 * not a detail this command hides from its own output.
 */
export interface VerifyDeriveRecordResult {
  records: DeriveCheckRecord[];
  ledgerPath: string;
  rejected: GroundingRejection[];
  /**
   * Every JSON-transport repair `parseSubagentJsonInput` performed across the three subagent
   * input files (180-01 finding 5) — a fence-wrapped or prose-wrapped return that still parsed,
   * logged rather than silently fixed. Empty when all three files parsed as bare JSON.
   */
  repairs: string[];
}

/**
 * `boardsmith verify-derive-record` — the ONLY write surface for CHECK-04's ledger, retargeted
 * onto the closed dual-enumeration design (177.1-CONTEXT.md decisions 1/3). Reads the THREE
 * subagent-return JSON files the skill orchestrator dispatched (`--enumerator-a`/`--enumerator-b`/
 * `--reconciler`), runs `reconcileSlice` — the CLI classifies; it never dispatches a model itself
 * (no `claude -p`/`execFile`/`spawn` call appears anywhere in this module) — and records EVERY
 * classification from that one reconciler return in ONE `recordDeriveCheckVerdicts` call.
 *
 * `--verdict` is DELIBERATELY NOT AN OPTION on this command (177.1-CONTEXT.md decision 1 vs
 * decision 3, reconciled): the verdict is COMPUTED by `reconcileSlice`/`classifyDerivedLines`, not
 * asserted by the caller. Registers no `--force`/`--skip`/`--overwrite`/`--run-id` or any other
 * bypass of any kind, matching every sibling write command's posture.
 *
 * Validation is delegated entirely to `createDeriveCheckRecord` (the one choke point) and to
 * `reconcileSlice`'s own grounding/composition checks — this function adds no second validator.
 */
export async function verifyDeriveRecordCommand(
  options: VerifyDeriveRecordOptions = {},
): Promise<VerifyDeriveRecordResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  if (!options.slicePath) {
    throw new Error('verify-derive-record requires --slice-path <path>.');
  }
  if (!options.enumeratorA) {
    throw new Error('verify-derive-record requires --enumerator-a <file>.');
  }
  if (!options.enumeratorB) {
    throw new Error('verify-derive-record requires --enumerator-b <file>.');
  }
  if (!options.reconciler) {
    throw new Error('verify-derive-record requires --reconciler <file>.');
  }

  const slicePath = options.slicePath;

  // CR-04 (177.1 code review): `--slice-path` reaches `fs.readFile` directly off disk, and
  // `join()` collapses `..` segments — without this guard, `--slice-path
  // rulebook/../../../../etc/passwd` (or any path escaping `projectDir/rulebook`) is read without
  // complaint. `slicePath` is always caller-supplied as `rulebook/<file>` (the exact shape
  // `readLiveSlices`/`enumerateDerivedLines` report) — a citation, and citations are relative to
  // `design/` — so this resolves against the DESIGN directory (not `rulebook/` — that segment is
  // already part of `slicePath`) and requires the result stay inside `design/rulebook`. Mirrors
  // `verify-classify.ts`'s `--live-slice` guard (T-174-14), validated BEFORE any read.
  const rulebookDir = designRulebookDir(projectDir);
  const sliceAbsPath = resolve(designDir(projectDir), slicePath);
  const sliceRelToRulebook = relative(rulebookDir, sliceAbsPath);
  if (
    sliceRelToRulebook === '' ||
    sliceRelToRulebook.startsWith('..') ||
    isAbsolute(sliceRelToRulebook)
  ) {
    throw new Error(
      `--slice-path "${slicePath}" resolves outside ${relative(projectDir, rulebookDir)}.\n` +
        `Pass a path of the form "rulebook/<file>.md", relative to ${DESIGN_DIR}/.`,
    );
  }

  let sliceText: string;
  try {
    sliceText = await fs.readFile(sliceAbsPath, 'utf-8');
  } catch {
    throw new Error(
      `verify-derive-record could not read --slice-path "${slicePath}" (looked for it at ` +
        `${sliceAbsPath}).`,
    );
  }

  const enumeratorAParsed = await readRequiredJsonFile(options.enumeratorA, '--enumerator-a');
  const enumeratorBParsed = await readRequiredJsonFile(options.enumeratorB, '--enumerator-b');
  const reconcilerParsed = await readRequiredJsonFile(options.reconciler, '--reconciler');
  const enumeratorA = enumeratorAParsed.value as EnumeratorReturn;
  const enumeratorB = enumeratorBParsed.value as EnumeratorReturn;
  const reconciler = reconcilerParsed.value as ReconcilerReturn;
  const repairs = [
    ...enumeratorAParsed.repairs,
    ...enumeratorBParsed.repairs,
    ...reconcilerParsed.repairs,
  ];

  const provenance = await QuoteVerifiedProvenance.obtain(projectDir);

  const { classifications, grounding } = reconcileSlice({
    projectDir,
    slicePath,
    sliceText,
    enumeratorA,
    enumeratorB,
    reconciler,
    provenance,
  });

  const groundedById = new Map(grounding.grounded.map((g) => [g.id, g] as const));
  const records = classifications.map((c) => {
    const groundedQuotes: DeriveCheckGroundedQuote[] = c.citedFactIds
      .map((id) => groundedById.get(id))
      .filter((g): g is GroundedBothFact => Boolean(g))
      .map((g) => ({ statement: g.statement, quotedFromA: g.quotedFromA, quotedFromB: g.quotedFromB }));
    return createDeriveCheckRecord({
      slicePath: c.slicePath,
      lineNumber: c.lineNumber,
      derivedLineText: c.derivedLineText,
      verdict: c.classification,
      reason: c.reason,
      citedFactIds: c.citedFactIds,
      groundedQuotes,
    });
  });

  const { ledgerPath } = await recordDeriveCheckVerdicts(projectDir, records);

  const result: VerifyDeriveRecordResult = {
    records,
    ledgerPath,
    rejected: grounding.rejected,
    repairs,
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  console.log(
    chalk.green(
      `✓ Recorded ${records.length} derive-check verdict(s) for ${slicePath} ` +
        `(${grounding.rejected.length} grounding rejection(s)).`,
    ),
  );
  console.log(`  Ledger: ${ledgerPath}`);
  for (const repair of repairs) {
    console.log(chalk.yellow(`  ⚠ JSON transport repair — ${repair}`));
  }
  return result;
}
