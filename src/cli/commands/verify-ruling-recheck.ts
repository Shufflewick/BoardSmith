import { promises as fs } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { parseRulings } from './build-manifest.js';
import { atomicWriteFile, RUN_ID_RE, runRootDir, stagingSlicesDir } from './verify-run.js';

/**
 * `verify-ruling-recheck.ts` — CHECK-01's mechanical half (176-CONTEXT.md decision 2): the CLI
 * enumerates every `RULINGS.md` entry with its full body text and records one of four enumerated
 * verdicts through the single atomic ledger write path. The CLI never judges — a fresh-context
 * subagent reads a ruling's body plus the fresh staged transcription and returns exactly one
 * verdict plus reasoning; this module only validates that verdict against the frozen enum and
 * persists it. In particular, this module contains NO absence-detecting keyword list and NO
 * verdict heuristic (176-RESEARCH.md Pitfall 4) — recognizing that a ruling's Citation records a
 * source absence (decision 4, `seven`'s Ruling 1) is subagent judgment, never a string match here.
 */

// -------------------------------------------------------------------------------------------
// RULING_VERDICTS — the frozen four-member enum (176-CONTEXT.md decision 1)
// -------------------------------------------------------------------------------------------

/**
 * The verdict set is FOUR, not three: `undetermined` is a first-class case for when the
 * comparison genuinely cannot be made — the same first-class-blindness principle this milestone
 * has already applied to `drift-unknown`, `unknown` provenance, `unclassified`, and
 * `unknown-drift`. Never collapse `undetermined` into one of the other three.
 */
export const RULING_VERDICTS = Object.freeze([
  'still-needed',
  'resolved-by-source',
  'contradicted',
  'undetermined',
] as const);

export type RulingVerdict = (typeof RULING_VERDICTS)[number];

function isRulingVerdict(value: string): value is RulingVerdict {
  return (RULING_VERDICTS as readonly string[]).includes(value);
}

// -------------------------------------------------------------------------------------------
// RULING_VERDICTS_LEDGER_BEGIN / END — the ledger's own fence markers
// -------------------------------------------------------------------------------------------

/**
 * Exported as constants, not inlined at the write site, for the same reason CHECK-04/CHECK-06
 * export theirs: the read path has to locate the very same markers the write path emitted, and
 * `createRulingVerdictRecord` has to reject a field that would smuggle one into the body.
 */
export const RULING_VERDICTS_LEDGER_BEGIN = '<!-- boardsmith:ruling-verdicts:begin -->';
export const RULING_VERDICTS_LEDGER_END = '<!-- boardsmith:ruling-verdicts:end -->';

// -------------------------------------------------------------------------------------------
// RulingVerdictRecord — the CLI-validated, subagent-supplied verdict record
// -------------------------------------------------------------------------------------------

export interface RulingVerdictRecord {
  number: number;
  verdict: RulingVerdict;
  /** The reasoning IS the artifact (decision 4) — never just the label. */
  reasoning: string;
  supersededBy?: number;
}

/**
 * Validates and constructs a `RulingVerdictRecord` from a subagent's returned verdict. Throws if
 * the verdict is outside `RULING_VERDICTS`, if `reasoning` is empty — a labeled verdict with no
 * recorded reasoning is not a valid record (decision 4) — if `number` is not a positive integer,
 * or if `reasoning` contains one of the ledger's own fence markers. This is the ONLY place a
 * verdict string is checked against the enum; every recording path in this module AND the read
 * path (`readRulingVerdicts`) route through it.
 */
export function createRulingVerdictRecord(input: {
  number: number;
  verdict: string;
  reasoning: string;
  supersededBy?: number;
}): RulingVerdictRecord {
  if (!Number.isInteger(input.number) || input.number < 1) {
    throw new Error(
      `Invalid ruling number "${input.number}".\n` +
        `Expected a positive whole number naming a RULINGS.md entry.`,
    );
  }
  if (!isRulingVerdict(input.verdict)) {
    throw new Error(
      `Invalid verdict "${input.verdict}" for Ruling ${input.number}.\n` +
        `Expected one of: ${RULING_VERDICTS.join(', ')}.`,
    );
  }
  if (input.reasoning.trim().length === 0) {
    throw new Error(
      `Ruling ${input.number}'s verdict has no recorded reasoning.\n` +
        `The reasoning is the artifact this check exists to produce — a verdict label with no ` +
        `reasoning is not a valid record.`,
    );
  }
  // A reasoning string carrying the ledger's own end fence would terminate the fenced body early
  // and silently orphan every record after it. Reject at construction, where the message can name
  // the offending field, rather than discovering a truncated ledger at read time.
  for (const marker of [RULING_VERDICTS_LEDGER_BEGIN, RULING_VERDICTS_LEDGER_END]) {
    if (input.reasoning.includes(marker)) {
      throw new Error(
        `Ruling ${input.number}'s reasoning contains the ledger's own fence marker ` +
          `("${marker}").\n` +
          `Remove it from the reasoning text — it would corrupt the RULING-VERDICTS ledger.`,
      );
    }
  }
  return {
    number: input.number,
    verdict: input.verdict,
    reasoning: input.reasoning,
    ...(input.supersededBy !== undefined ? { supersededBy: input.supersededBy } : {}),
  };
}

// -------------------------------------------------------------------------------------------
// enumerateRulingsForRecheck — the supersession skip/report split (176-CONTEXT.md decision 3)
// -------------------------------------------------------------------------------------------

export interface RulingEnumerationEntry {
  number: number;
  body: string;
}

export interface SkippedRuling {
  number: number;
  supersededBy: number;
}

export interface UnparsedSupersessionEntry {
  number: number;
  sentences: string[];
}

export interface RulingEnumerationResult {
  /** Every non-superseded ruling, carrying its full body for the judgment subagent to read. */
  enumerated: RulingEnumerationEntry[];
  /** Superseded rulings, excluded from re-validation, naming which ruling superseded them. */
  skipped: SkippedRuling[];
  /**
   * Rulings whose own body contains a supersede-verb sentence that could not be resolved to a
   * target ruling. These are reported, never assumed — and critically, a ruling landing here is
   * NOT skipped: it still appears in `enumerated` unless it separately has a resolved
   * `supersededBy` of its own (decision 3).
   */
  unparsedSupersession: UnparsedSupersessionEntry[];
}

/**
 * Enumerates `RULINGS.md`'s entries for CHECK-01's re-check, using the single existing parser
 * (`parseRulings`, `build-manifest.ts`) — no second ruling parse path. Mirrors
 * `trace-check.ts`'s exact supersession skip condition (`ruling.supersededBy !== undefined`).
 */
export function enumerateRulingsForRecheck(rulingsText: string): RulingEnumerationResult {
  const parsed = parseRulings(rulingsText);

  const enumerated: RulingEnumerationEntry[] = [];
  const skipped: SkippedRuling[] = [];
  const unparsedSupersession: UnparsedSupersessionEntry[] = [];

  for (const ruling of parsed) {
    if (ruling.supersededBy !== undefined) {
      skipped.push({ number: ruling.number, supersededBy: ruling.supersededBy });
    } else {
      enumerated.push({ number: ruling.number, body: ruling.body });
    }
    if (ruling.unparsedSupersession.length > 0) {
      unparsedSupersession.push({
        number: ruling.number,
        sentences: [...ruling.unparsedSupersession],
      });
    }
  }

  return { enumerated, skipped, unparsedSupersession };
}

// -------------------------------------------------------------------------------------------
// resolveFreshTranscription — scope-limited detection (176-CONTEXT.md decisions 9, 10)
// -------------------------------------------------------------------------------------------

export type FreshTranscriptionResolution =
  | { scopeLimited: false; runId: string; stagingDir: string; slicePaths: string[] }
  | { scopeLimited: true; reason: string; missingPath: string };

/** All run-ids present under this project's `rulebook/.verify/`, sorted (empty if none). */
async function listRunIds(projectDir: string): Promise<string[]> {
  const verifyRoot = join(projectDir, 'rulebook', '.verify');
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(verifyRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Resolves the fresh STAGED transcription a re-check judgment reads against — never the live
 * `rulebook/` slices (decision 9: auditing against the pass-1 slices would re-check code against
 * the very text staleness was computed from). If no run is staged, an explicit `--run-id` does
 * not resolve, or the staged slices directory exists but is empty, this reports SCOPE-LIMITED
 * (PROV-02's pattern) — it never throws and never silently falls back to a live slice path.
 * Every path this function can return is rooted at the dot-prefixed `rulebook/.verify/` staging
 * tree (`stagingSlicesDir`'s own convention: "dot-prefixed so no walker mistakes a staged slice
 * for a live one") — never a bare `rulebook/<file>.md` live-slice path.
 *
 * A retired `slices/superseded/` subfolder (real data: `one-two-punch`'s committed
 * `174-07-contradictory` fixture) is EXCLUDED from the returned `slicePaths` — a judgment
 * subagent must never be handed stale, deliberately-retired transcription content alongside the
 * current staged slices (176-06 ADDED ITEM 1; found and reported, not yet fixed, by 176-05).
 */
export async function resolveFreshTranscription(
  projectDir: string,
  runId?: string,
): Promise<FreshTranscriptionResolution> {
  if (runId !== undefined && !RUN_ID_RE.test(runId)) {
    return {
      scopeLimited: true,
      reason:
        `"--run-id ${runId}" is not a valid verify run id (expected the shape ` +
        `YYYY-MM-DDTHH-MM-SSZ) — no fresh transcription can be resolved from it.`,
      missingPath: relative(projectDir, join(projectDir, 'rulebook', '.verify', runId)),
    };
  }

  let resolvedRunId = runId;
  if (resolvedRunId === undefined) {
    const runIds = await listRunIds(projectDir);
    if (runIds.length === 0) {
      return {
        scopeLimited: true,
        reason:
          'No verify run has been staged under rulebook/.verify/ — a fresh transcription has ' +
          'never been produced for this project. Run `boardsmith verify-run-init` first.',
        missingPath: relative(projectDir, join(projectDir, 'rulebook', '.verify')),
      };
    }
    resolvedRunId = runIds[runIds.length - 1];
  }

  const stagingDir = stagingSlicesDir(projectDir, resolvedRunId);
  let entryNames: string[];
  try {
    entryNames = await fs.readdir(stagingDir, { recursive: true });
  } catch {
    entryNames = [];
  }
  // Exclude any path with a `superseded/` directory component (176-06 ADDED ITEM 1, promoted
  // from 176-05's reported finding). A staged tree MAY retain a `slices/superseded/` subfolder
  // for retired transcription drafts — real data confirmed on `one-two-punch`'s committed
  // 174-07-contradictory fixture. Handing that content to a judgment subagent alongside the
  // CURRENT staged transcription would let it check code/rulings against text the project
  // itself has already marked retired, which can only produce confidently-wrong findings.
  // Filtered on path segments, not a substring match, so a real slice legitimately named e.g.
  // `01-superseded-cards.md` (no `superseded/` directory component) is never excluded.
  const slicePaths = entryNames
    .filter((n) => n.endsWith('.md'))
    .filter((n) => !n.split(/[\\/]/).includes('superseded'))
    .sort();

  if (slicePaths.length === 0) {
    return {
      scopeLimited: true,
      reason:
        `The staged slices directory for run "${resolvedRunId}" exists but contains no fresh ` +
        `transcription — nothing to re-check a ruling against.`,
      missingPath: relative(projectDir, stagingDir),
    };
  }

  return {
    scopeLimited: false,
    runId: resolvedRunId,
    stagingDir: relative(projectDir, stagingDir),
    slicePaths,
  };
}

// -------------------------------------------------------------------------------------------
// verifyRulingRecheckCommand — report + record (176-CONTEXT.md decisions 14, 16)
// -------------------------------------------------------------------------------------------

export interface RulingRecheckReportRow {
  number: number;
  verdict: RulingVerdict | 'pending';
  reasoning: string;
}
// No `supersededBy` here by construction: a row exists only for an ENUMERATED ruling, and
// `enumerateRulingsForRecheck` puts a ruling in `enumerated` or in `skipped`, never both. The
// superseding relationship is reported once, on `skipped`, where it is always populated.

export interface VerifyRulingRecheckResult {
  runId?: string;
  scopeLimited: boolean;
  scopeLimitedReason?: string;
  rows: RulingRecheckReportRow[];
  skipped: SkippedRuling[];
  unparsedSupersession: UnparsedSupersessionEntry[];
  verdictCounts: Record<RulingVerdict, number>;
}

function emptyVerdictCounts(): Record<RulingVerdict, number> {
  const counts = {} as Record<RulingVerdict, number>;
  for (const v of RULING_VERDICTS) counts[v] = 0;
  return counts;
}

/**
 * `boardsmith verify-ruling-recheck` — CHECK-01's report: one row per non-superseded ruling
 * (number, verdict-or-`pending`, reasoning), the skipped/unparsed-supersession sets, and
 * `verdictCounts` computed here so a caller never has to count a measured distribution by hand
 * (PROV-03's compute/format split). Uncapped — never truncated (decision 15).
 *
 * A row's verdict comes from one of two sources: `options.verdicts`, carrying whatever the
 * judgment subagent has returned in THIS process (keyed by ruling number), or the run's
 * `RULING-VERDICTS.md` ledger, carrying what `boardsmith verify-ruling-record` durably recorded in
 * an earlier one. In-memory wins where both exist. A ruling in neither reports `pending`, never a
 * manufactured default verdict.
 *
 * This command is READ-ONLY against every file it touches: it enumerates and reports, and it never
 * writes a verdict into `RULINGS.md` (decision 16 — this phase reports, it does not repair
 * reference content) nor into the ledger it reads. Writing a verdict is
 * `verifyRulingRecordCommand`'s job alone, through `recordRulingVerdicts` → `atomicWriteFile`.
 *
 * Findings exit 0 (never sets `process.exitCode`). Tool failure (missing project, unreadable
 * `RULINGS.md`) throws with a single actionable line naming the directory and `--project` — no
 * stack frame, no `.ts:` reference, no repo `src/` path.
 */
export async function verifyRulingRecheckCommand(
  options: {
    project?: string;
    runId?: string;
    verdicts?: Map<number, { verdict: RulingVerdict; reasoning: string }>;
    json?: boolean;
  } = {},
): Promise<VerifyRulingRecheckResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const rulingsPath = join(projectDir, 'RULINGS.md');

  let rulingsText: string;
  try {
    rulingsText = await fs.readFile(rulingsPath, 'utf-8');
  } catch {
    throw new Error(
      `No RULINGS.md found in this project directory.\n` +
        `Pass --project <dir> to target the bs-project this run should read.`,
    );
  }

  const { enumerated, skipped, unparsedSupersession } = enumerateRulingsForRecheck(rulingsText);
  const transcription = await resolveFreshTranscription(projectDir, options.runId);

  // The durable half of the verdict source (the defect this command was filed for): verdicts
  // recorded by `verify-ruling-record` in an earlier process are read back here, so a re-run
  // reports real recorded work instead of resetting every row to `pending`. An in-memory
  // `options.verdicts` still wins where both exist — a caller holding a subagent's return this
  // very session is reporting something strictly fresher than the ledger. Under `scopeLimited`
  // there is no resolved run to read a ledger from, so rows correctly stay `pending`.
  const recorded = new Map<number, { verdict: RulingVerdict; reasoning: string }>();
  if (!transcription.scopeLimited) {
    for (const r of await readRulingVerdicts(projectDir, transcription.runId)) {
      recorded.set(r.number, { verdict: r.verdict, reasoning: r.reasoning });
    }
  }

  const verdictCounts = emptyVerdictCounts();
  const rows: RulingRecheckReportRow[] = enumerated.map((entry) => {
    const supplied = options.verdicts?.get(entry.number) ?? recorded.get(entry.number);
    if (supplied) {
      verdictCounts[supplied.verdict]++;
      return { number: entry.number, verdict: supplied.verdict, reasoning: supplied.reasoning };
    }
    return { number: entry.number, verdict: 'pending', reasoning: '' };
  });

  const result: VerifyRulingRecheckResult = {
    runId: transcription.scopeLimited ? undefined : transcription.runId,
    scopeLimited: transcription.scopeLimited,
    scopeLimitedReason: transcription.scopeLimited ? transcription.reason : undefined,
    rows,
    skipped,
    unparsedSupersession,
    verdictCounts,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  if (transcription.scopeLimited) {
    console.log(chalk.yellow(`⚠ Scope-limited: ${transcription.reason}`));
  }
  console.log(
    chalk.green(`✓ Ruling re-check — ${rows.length} ruling(s), ${skipped.length} skipped`),
  );
  for (const row of rows) {
    console.log(`  Ruling ${row.number}: ${row.verdict}`);
  }
  return result;
}

/**
 * This run's own ledger path — `rulebook/.verify/<runId>/RULING-VERDICTS.md`. Run-scoped, unlike
 * CHECK-04's and CHECK-06's project-level ledgers: a ruling's verdict is a judgment against ONE
 * run's fresh transcription, so it cannot outlive the run that produced it.
 */
export function rulingVerdictsLedgerPath(projectDir: string, runId: string): string {
  return join(runRootDir(projectDir, runId), 'RULING-VERDICTS.md');
}

/**
 * Persists verdicts to this run's ledger through `atomicWriteFile` — the ONE atomic ledger write
 * path in the repo (`verify-run.ts`). Never `fs.writeFile`/`writeFileSync` directly, and never a
 * write into `RULINGS.md` itself (decision 16).
 *
 * REPLACES the entire ledger body with exactly the `records` supplied — a full rewrite. This is
 * NOT the callable a recording workflow wants per batch; use `recordRulingVerdicts`, which upserts
 * through this one. Exported for the legitimate full-rewrite case and for that upsert's own use.
 */
export async function replaceRulingVerdicts(
  projectDir: string,
  runId: string,
  records: RulingVerdictRecord[],
): Promise<{ ledgerPath: string }> {
  const ledgerPath = rulingVerdictsLedgerPath(projectDir, runId);
  const lines = records.map((r) => JSON.stringify(r));
  const content =
    `# Ruling Verdicts — run ${runId}\n\n` +
    `${RULING_VERDICTS_LEDGER_BEGIN}\n` +
    lines.join('\n') +
    (lines.length > 0 ? '\n' : '') +
    `${RULING_VERDICTS_LEDGER_END}\n`;
  await fs.mkdir(dirname(ledgerPath), { recursive: true });
  await atomicWriteFile(ledgerPath, content);
  return { ledgerPath: relative(projectDir, ledgerPath) };
}

/**
 * Records a batch of verdicts, upserting each by ruling `number`: reads what the ledger already
 * holds, drops only the records this batch re-states, keeps every other record in its existing
 * order, and appends the new ones last so the ledger diff stays reviewable. Recording ruling N
 * never destroys ruling N−1's verdict — the defect this command was filed for.
 */
export async function recordRulingVerdicts(
  projectDir: string,
  runId: string,
  records: RulingVerdictRecord[],
): Promise<{ ledgerPath: string }> {
  const existing = await readRulingVerdicts(projectDir, runId);
  const incoming = new Set(records.map((r) => r.number));
  const merged = [...existing.filter((r) => !incoming.has(r.number)), ...records];
  return replaceRulingVerdicts(projectDir, runId, merged);
}

/**
 * Round-trips exactly what `recordRulingVerdicts`/`replaceRulingVerdicts` wrote. Returns an empty
 * array (never throws) when no ledger has been written yet — a run whose CHECK-01 has not recorded
 * anything has nothing recorded, which is not a tool failure.
 *
 * RE-ENTERS `createRulingVerdictRecord` on every parsed line: the ledger is a second entry path
 * into `RulingVerdictRecord`, never a bypass of its validation — no `as RulingVerdictRecord` cast
 * appears in this module. A hand-edited out-of-enum verdict, an emptied reasoning, or a malformed
 * JSON line throws one actionable message naming the ledger's relative path and the 1-based record
 * index, rather than reaching the report unvalidated.
 */
export async function readRulingVerdicts(
  projectDir: string,
  runId: string,
): Promise<RulingVerdictRecord[]> {
  const ledgerPath = rulingVerdictsLedgerPath(projectDir, runId);
  let text: string;
  try {
    text = await fs.readFile(ledgerPath, 'utf-8');
  } catch {
    return [];
  }
  const relLedgerPath = relative(projectDir, ledgerPath);
  const beginIdx = text.indexOf(RULING_VERDICTS_LEDGER_BEGIN);
  const endIdx = text.indexOf(RULING_VERDICTS_LEDGER_END);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(`Malformed ruling-verdicts ledger at ${relLedgerPath}: missing begin/end fence.`);
  }
  if (beginIdx > endIdx) {
    throw new Error(
      `Malformed ruling-verdicts ledger at ${relLedgerPath}: the end fence appears before the ` +
        `begin fence.`,
    );
  }
  const body = text.slice(beginIdx + RULING_VERDICTS_LEDGER_BEGIN.length, endIdx);
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
        `Malformed ruling-verdicts ledger at ${relLedgerPath} (record ${i + 1}): not valid JSON.\n` +
          `Delete the file to re-record this run's CHECK-01 verdicts from scratch.`,
      );
    }
    const r = raw as Record<string, unknown>;
    try {
      return createRulingVerdictRecord({
        number: Number(r.number),
        verdict: String(r.verdict ?? ''),
        reasoning: String(r.reasoning ?? ''),
        supersededBy: r.supersededBy !== undefined ? Number(r.supersededBy) : undefined,
      });
    } catch (err) {
      throw new Error(
        `Malformed ruling-verdicts ledger at ${relLedgerPath} (record ${i + 1}): ` +
          `${(err as Error).message}\n` +
          `Delete the file to re-record this run's CHECK-01 verdicts from scratch.`,
      );
    }
  });
}

// -------------------------------------------------------------------------------------------
// verifyRulingRecordCommand — the ONLY write surface for CHECK-01's ledger
// -------------------------------------------------------------------------------------------

export interface VerifyRulingRecordResult {
  runId: string;
  number: number;
  verdict: RulingVerdict;
  ledgerPath: string;
  /** Total records in the ledger after this upsert — the caller's proof nothing was destroyed. */
  recordCount: number;
}

/**
 * `boardsmith verify-ruling-record` — records ONE dispatched ruling's re-check verdict, the
 * missing half of CHECK-01. Every sibling check already had its paired record command
 * (`verify-classify-record`, `verify-derive-record`, `verify-example-record`); this one's write
 * path existed but was never registered, so a verdict could be judged and never recorded.
 *
 * Validation is delegated entirely to `createRulingVerdictRecord` — the enum and the non-empty
 * reasoning rule live in exactly one place. Note the deliberate divergence from
 * `verify-classify-record`, which softens an unrecognized `--label` to `unclassified`: CHECK-01's
 * enum has no such member, so an out-of-enum `--verdict` must throw rather than be coerced into a
 * verdict the judge did not return. `undetermined` is a real judgment, not a fallback.
 *
 * The `--number` is checked against the run's own enumeration so a typo cannot silently record a
 * verdict for a ruling nobody dispatched.
 */
export async function verifyRulingRecordCommand(
  options: {
    project?: string;
    runId?: string;
    number?: string | number;
    verdict?: string;
    reasoning?: string;
    json?: boolean;
  } = {},
): Promise<VerifyRulingRecordResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  const runId = options.runId;
  if (runId === undefined || !RUN_ID_RE.test(runId)) {
    throw new Error(
      `"--run-id ${runId ?? '<missing>'}" is not a valid verify run id (expected the shape ` +
        `YYYY-MM-DDTHH-MM-SSZ).\n` +
        `Pass the run id this verdict was judged against — the one \`boardsmith ` +
        `verify-ruling-recheck\` reports.`,
    );
  }

  const number = Number(options.number);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(
      `"--number ${options.number ?? '<missing>'}" is not a RULINGS.md entry number.\n` +
        `Pass the positive whole number of the ruling this verdict is for.`,
    );
  }

  const rulingsPath = join(projectDir, 'RULINGS.md');
  let rulingsText: string;
  try {
    rulingsText = await fs.readFile(rulingsPath, 'utf-8');
  } catch {
    throw new Error(
      `No RULINGS.md found in this project directory.\n` +
        `Pass --project <dir> to target the bs-project this run should read.`,
    );
  }

  const { enumerated, skipped } = enumerateRulingsForRecheck(rulingsText);
  if (!enumerated.some((e) => e.number === number)) {
    const supersededBy = skipped.find((s) => s.number === number)?.supersededBy;
    if (supersededBy !== undefined) {
      throw new Error(
        `Ruling ${number} is superseded by Ruling ${supersededBy}, so it is not dispatched for ` +
          `re-check and carries no verdict.\n` +
          `Record a verdict for Ruling ${supersededBy} instead.`,
      );
    }
    throw new Error(
      `Ruling ${number} is not an entry in this project's RULINGS.md.\n` +
        `Valid ruling numbers for re-check: ${enumerated.map((e) => e.number).join(', ')}.\n` +
        `Run \`boardsmith verify-ruling-recheck --run-id ${runId}\` to see the dispatch list.`,
    );
  }

  const record = createRulingVerdictRecord({
    number,
    verdict: String(options.verdict ?? ''),
    reasoning: String(options.reasoning ?? ''),
  });

  const { ledgerPath } = await recordRulingVerdicts(projectDir, runId, [record]);
  const recordCount = (await readRulingVerdicts(projectDir, runId)).length;

  const result: VerifyRulingRecordResult = {
    runId,
    number: record.number,
    verdict: record.verdict,
    ledgerPath,
    recordCount,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(
    chalk.green(`✓ Ruling ${record.number}: ${record.verdict}`) +
      chalk.dim(` — recorded in ${ledgerPath} (${recordCount} verdict(s) total)`),
  );
  return result;
}
