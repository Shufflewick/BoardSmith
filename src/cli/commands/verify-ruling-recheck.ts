import { promises as fs } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import { parseRulings } from './build-manifest.js';
import { atomicWriteFile, RUN_ID_RE, stagingSlicesDir } from './verify-run.js';

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
 * the verdict is outside `RULING_VERDICTS` or if `reasoning` is empty — a labeled verdict with no
 * recorded reasoning is not a valid record (decision 4). This is the ONLY place a verdict string
 * is checked against the enum; every recording path in this module routes through it.
 */
export function createRulingVerdictRecord(input: {
  number: number;
  verdict: string;
  reasoning: string;
  supersededBy?: number;
}): RulingVerdictRecord {
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
  supersededBy?: number;
}

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
 * `options.verdicts` carries whatever the judgment subagent has already returned for this run
 * (keyed by ruling number); a ruling with no entry reports `pending`, never a manufactured
 * default verdict.
 *
 * This command is READ-ONLY against `RULINGS.md`: it enumerates and reports, it never writes a
 * verdict into the file itself (decision 16 — this phase reports, it does not repair reference
 * content). Recording a subagent's returned verdicts durably is `recordRulingVerdicts`, below,
 * which persists through `atomicWriteFile` — the ONE atomic ledger write path in the repo.
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

  const supersededByNumber = new Map(skipped.map((s) => [s.number, s.supersededBy] as const));
  const verdictCounts = emptyVerdictCounts();
  const rows: RulingRecheckReportRow[] = enumerated.map((entry) => {
    const supplied = options.verdicts?.get(entry.number);
    if (supplied) {
      verdictCounts[supplied.verdict]++;
      return {
        number: entry.number,
        verdict: supplied.verdict,
        reasoning: supplied.reasoning,
        supersededBy: supersededByNumber.get(entry.number),
      };
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
 * Persists a batch of subagent-returned verdicts to this run's own
 * `rulebook/.verify/<runId>/RULING-VERDICTS.md` ledger, through `atomicWriteFile` — the ONE
 * atomic ledger write path in the repo (`verify-run.ts`). Never `fs.writeFile`/`writeFileSync`
 * directly, and never a write into `RULINGS.md` itself (decision 16).
 */
export async function recordRulingVerdicts(
  projectDir: string,
  runId: string,
  records: RulingVerdictRecord[],
): Promise<{ ledgerPath: string }> {
  const runRoot = join(stagingSlicesDir(projectDir, runId), '..');
  const ledgerPath = join(runRoot, 'RULING-VERDICTS.md');
  const lines = records.map((r) => JSON.stringify(r));
  const content =
    `# Ruling Verdicts — run ${runId}\n\n` +
    `<!-- boardsmith:ruling-verdicts:begin -->\n` +
    lines.join('\n') +
    (lines.length > 0 ? '\n' : '') +
    `<!-- boardsmith:ruling-verdicts:end -->\n`;
  await atomicWriteFile(ledgerPath, content);
  return { ledgerPath: relative(projectDir, ledgerPath) };
}
