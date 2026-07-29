import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import chalk from 'chalk';

/**
 * `verify-run.ts` — the mechanical half of VERIFY-02 and VERIFY-08: a non-destructive staging
 * tree allocator plus an append-only, machine-owned `RUN.md` resume ledger.
 *
 * WHY THIS IS CODE AND NOT SKILL TEXT
 *
 * 173-CONTEXT.md decision 11 applies Phase 170's central finding directly: a resume ledger is
 * pure mechanics (allocate a path, append a record, read records back), and instruction-shaped
 * mechanics get skipped by a live session working from recall. Skill text's only job is to
 * invoke these three commands; it never reasons about where staging lives or what "recorded"
 * means.
 *
 * LEDGER FORMAT (resolves 173-RESEARCH.md Open Question 1)
 *
 * ONE fence pair (`RUN_LEDGER_BEGIN`/`RUN_LEDGER_END`) wraps the whole ledger — the same shape
 * `GAPS_BEGIN`/`GAPS_END` (ingest-archive.ts) and `VERIFIED_AGAINST_BEGIN`/`END`
 * (chunk-provenance.ts) already use, so this pipeline has exactly ONE fencing convention rather
 * than a second one invented for per-record framing. Each record is a SELF-DELIMITING single-line
 * JSON object.
 *
 * CRASH SAFETY (CR-01 — corrects this comment's own prior, false claim): crash safety for the
 * ledger comes from writing the WHOLE FILE atomically on every mutation — a temp file in the same
 * directory, `fsync`'d, then `rename()`'d over the target — never from `fs.writeFile`'s default
 * behavior, which truncates on open and is not append-safe on its own. POSIX `rename()` within
 * one filesystem is atomic, so a crash at any point in a `verify-run-record` call leaves `RUN.md`
 * either byte-identical to its pre-call state (every previously-recorded unit intact) or
 * containing the fully-written new line — never a torn mix, and never a file with earlier records
 * lost. This module's prior doc comment claimed "a torn append can damage at most the final
 * line," which described what a true `O_APPEND` write would guarantee, not what the actual
 * read-modify-rewrite-via-`fs.writeFile` implementation did — see 173-REVIEW.md CR-01 and
 * `173-PROOF.md` §4 Finding 2 for the full account of why that claim was false. A line that does
 * not parse as a well-formed record (the one torn shape still reachable — a crash that killed a
 * process while the TEMP file itself was mid-write, which is simply an orphan, never the live
 * `RUN.md`) is read as NOT recorded rather than as an error or as complete — this is what makes
 * resume safe (T-173-13).
 *
 * This module mints its OWN fence pair. It never reuses `GAPS_BEGIN` or `VERIFIED_AGAINST_BEGIN`
 * — two unrelated machine-owned sections sharing one fence pair is a corruption vector, not a
 * convenience (173-PATTERNS.md, `chunk-provenance.ts` is the precedent for a second section
 * getting its own constants).
 *
 * SCOPE FENCE: this module classifies nothing and compares nothing. It allocates paths and
 * records completion. Phase 174 owns classification.
 */

export interface VerifyRunOptions {
  /** Project directory to operate in. Defaults to cwd. */
  project?: string;
  /** Emit machine-readable JSON instead of human output. */
  json?: boolean;
}

/**
 * The exact run-id shape (T-173-11's mitigation): UTC, fixed-width, `date -u
 * +%Y-%m-%dT%H:%M:%SZ` with `:` replaced by `-` because the value becomes a directory name.
 * Fixed-width and lexicographically sortable is what makes `verify-run-status`'s "most recent
 * run" lookup (L6) a plain string sort rather than a parse-and-compare.
 */
export const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

/**
 * Fences delimiting the machine-owned body of `RUN.md`. Minted fresh for this section — never
 * shared with `GAPS_BEGIN`/`GAPS_END` or `VERIFIED_AGAINST_BEGIN`/`END`.
 */
export const RUN_LEDGER_BEGIN = '<!-- boardsmith:verify-run:begin -->';
export const RUN_LEDGER_END = '<!-- boardsmith:verify-run:end -->';

/** One recorded slice-unit. Each ledger line is exactly one `JSON.stringify(LedgerRecord)`. */
export interface LedgerRecord {
  unitId: string;
  /** Path to the slice, relative to the run's staging dir (`stagingSlicesDir()`'s return value). */
  slicePath: string;
  sha256: string;
  recordedAt: string;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** `date -u +%Y-%m-%dT%H:%M:%SZ`-shaped, with `:` replaced by `-`. Minted BY THIS COMMAND. */
function mintRunId(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}T` +
    `${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}Z`
  );
}

function assertValidRunId(runId: string): void {
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(
      `Invalid --run-id "${runId}".\n` +
        `Expected the shape YYYY-MM-DDTHH-MM-SSZ (UTC, colons replaced by "-"), e.g.\n` +
        `2026-07-28T22-18-00Z. Omit --run-id to mint a fresh one, or pass the exact value\n` +
        `\`boardsmith verify-run-init\` printed for the run you want to resume.`,
    );
  }
}

/**
 * The single path-computation authority for a run's staging tree (173-CONTEXT.md decision 5):
 * `<projectDir>/rulebook/.verify/<run-id>/slices/`. Dot-prefixed so no walker mistakes a staged
 * slice for a live one; run-scoped so two passes cannot collide.
 *
 * Validates `runId` against `RUN_ID_RE` and then `resolve()`s the built path and asserts it is a
 * child of `<projectDir>/rulebook/.verify/` before returning (T-173-11) — belt-and-suspenders
 * over the regex, since a fixed-shape id cannot itself contain a path separator.
 */
export function stagingSlicesDir(projectDir: string, runId: string): string {
  assertValidRunId(runId);
  const verifyRoot = resolve(projectDir, 'rulebook', '.verify');
  const dir = resolve(verifyRoot, runId, 'slices');
  const rel = relative(verifyRoot, dir);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(
      `Resolved staging path for run-id "${runId}" escapes ${verifyRoot}. Refusing to create it.`,
    );
  }
  return dir;
}

function runRootDir(projectDir: string, runId: string): string {
  return dirname(stagingSlicesDir(projectDir, runId));
}

function ledgerFilePath(projectDir: string, runId: string): string {
  return join(runRootDir(projectDir, runId), 'RUN.md');
}

/**
 * Atomically replaces `filePath`'s contents (CR-01's fix): write to a same-directory temp file,
 * `fsync` it, then `rename()` over the target. POSIX `rename()` within one filesystem is atomic,
 * so a crash at any point — including mid-write of the temp file itself, or between the temp
 * write completing and the rename executing — leaves `filePath` either byte-identical to its
 * pre-call state or containing the fully-written new content. Never a torn mix, never a
 * zero-byte/truncated target.
 *
 * The temp name embeds the pid and a random suffix (T-173-08-02) so two calls — even concurrent
 * runs whose ledgers happen to live in the same directory — can never collide on one temp path.
 * If `rename()` itself fails (including a failure injected to simulate the crash window), the
 * orphaned temp file is best-effort cleaned up and the error is re-thrown rather than swallowed —
 * fail loud, per this project's error-handling contract. An orphan that outlives a real crash is
 * harmless (T-173-08-04): its name is never `RUN.md`, so `ledgerFilePath`/`locateFences` and every
 * other reader in this module can never mistake it for the ledger.
 */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/** The freshly-minted RUN.md contents: a title, an explanatory machine-owned comment, and an empty fence pair. */
function renderEmptyRunMd(runId: string): string {
  return (
    `# Verify Run Ledger — ${runId}\n\n` +
    `<!-- MACHINE-OWNED. Do not write between the fences below by hand, and do not move or\n` +
    `     delete them. This file is written by \`boardsmith verify-run-record\` and read by\n` +
    `     \`boardsmith verify-run-status\`. Each line between the fences is one self-delimiting\n` +
    `     JSON record for one completed slice-unit — append-only, one line per unit. -->\n\n` +
    `${RUN_LEDGER_BEGIN}\n${RUN_LEDGER_END}\n`
  );
}

/** Locates the fence pair, or throws the actionable "missing its machine-owned fences" error (L9). */
function locateFences(
  ledgerText: string,
  relLedgerPath: string,
): { beginIdx: number; endIdx: number } {
  const beginIdx = ledgerText.indexOf(RUN_LEDGER_BEGIN);
  const endIdx = ledgerText.indexOf(RUN_LEDGER_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(
      `${relLedgerPath} is missing its machine-owned fences.\n` +
        `Expected ${RUN_LEDGER_BEGIN} ... ${RUN_LEDGER_END}.\n` +
        `This file is written by \`boardsmith verify-run-init\`/\`verify-run-record\`, never by\n` +
        `hand. Restore it by re-running \`boardsmith verify-run-init --run-id <id>\`, then re-run\n` +
        `this command.`,
    );
  }
  return { beginIdx, endIdx };
}

/**
 * Appends one line before the END fence, preserving everything else byte-for-byte. Never rewrites
 * or "cleans up" any existing line — including a torn one — because that is a read-time concern
 * (`parseLedgerBody`/`verifyRunStatusCommand`), not a write-time repair this append-only command
 * performs.
 */
function appendLedgerLine(ledgerText: string, relLedgerPath: string, newLine: string): string {
  const { beginIdx, endIdx } = locateFences(ledgerText, relLedgerPath);
  const bodyStart = beginIdx + RUN_LEDGER_BEGIN.length;
  let body = ledgerText.slice(bodyStart, endIdx);
  if (body.length > 0 && !body.endsWith('\n')) body += '\n';
  body += `${newLine}\n`;
  return ledgerText.slice(0, bodyStart) + body + ledgerText.slice(endIdx);
}

/**
 * Parses every in-fence line as a `LedgerRecord`. A line that does not parse as JSON, or that
 * parses but is missing a required field, is dropped into `malformedLines` rather than thrown —
 * per T-173-13, an unparseable line (most likely a torn final append from a crash mid-write) must
 * read as NOT recorded so resume re-dispatches that unit, never as an error that halts status.
 */
function parseLedgerBody(
  ledgerText: string,
  relLedgerPath: string,
): { records: LedgerRecord[]; malformedLines: string[] } {
  const { beginIdx, endIdx } = locateFences(ledgerText, relLedgerPath);
  const body = ledgerText.slice(beginIdx + RUN_LEDGER_BEGIN.length, endIdx);
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const records: LedgerRecord[] = [];
  const malformedLines: string[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (
        obj &&
        typeof obj === 'object' &&
        typeof obj.unitId === 'string' &&
        typeof obj.slicePath === 'string' &&
        typeof obj.sha256 === 'string' &&
        typeof obj.recordedAt === 'string'
      ) {
        records.push(obj as LedgerRecord);
      } else {
        malformedLines.push(line);
      }
    } catch {
      malformedLines.push(line);
    }
  }
  return { records, malformedLines };
}

// -------------------------------------------------------------------------------------------
// verifyRunInitCommand
// -------------------------------------------------------------------------------------------

export interface VerifyRunInitResult {
  runId: string;
  stagingDir: string;
  ledgerPath: string;
  created: boolean;
}

/**
 * `boardsmith verify-run-init` — allocate (or resume) a run's staging tree and RUN.md ledger.
 *
 * Idempotent on a supplied `--run-id`: re-running with the SAME id never truncates RUN.md and
 * never deletes staged slices (S3) — this is the resume entry point. `--run-id` exists ONLY to
 * target an existing run; a fresh run-id is always minted by this command when omitted
 * (173-CONTEXT.md decision 11 / specifics — removes the instruction-shaped `date -u` step).
 */
export async function verifyRunInitCommand(
  options: VerifyRunOptions & { runId?: string } = {},
): Promise<VerifyRunInitResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const rulebookDir = join(projectDir, 'rulebook');

  try {
    await fs.access(rulebookDir);
  } catch {
    throw new Error(
      `No rulebook/ directory in ${projectDir}.\n` +
        `A verify run re-transcribes an existing rulebook — run \`boardsmith ingest-archive\`\n` +
        `first, or pass --project <dir> to target a different project.`,
    );
  }

  const runId = options.runId ? (assertValidRunId(options.runId), options.runId) : mintRunId(new Date());

  const stagingDir = stagingSlicesDir(projectDir, runId);
  const runDir = runRootDir(projectDir, runId);
  const ledgerFile = ledgerFilePath(projectDir, runId);

  // Non-destructive: mkdir recursive never truncates an existing tree.
  await fs.mkdir(stagingDir, { recursive: true });

  let created: boolean;
  try {
    await fs.access(ledgerFile);
    created = false;
  } catch {
    await atomicWriteFile(ledgerFile, renderEmptyRunMd(runId));
    created = true;
  }

  const result: VerifyRunInitResult = {
    runId,
    stagingDir: relative(projectDir, stagingDir),
    ledgerPath: relative(projectDir, ledgerFile),
    created,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(chalk.green(created ? '✓ Allocated verify run' : '✓ Resuming existing verify run'));
  console.log(`  ${chalk.gray('run-id:')} ${runId}`);
  console.log(`  ${chalk.gray('staging:')} ${result.stagingDir}`);
  console.log(`  ${chalk.gray('ledger:')} ${result.ledgerPath}`);
  void runDir;
  return result;
}

// -------------------------------------------------------------------------------------------
// verifyRunRecordCommand
// -------------------------------------------------------------------------------------------

export interface VerifyRunRecordResult {
  runId: string;
  unitId: string;
  slicePath: string;
  sha256: string;
  alreadyRecorded: boolean;
}

/**
 * `boardsmith verify-run-record --run-id <id> --unit <unit-id> --slice <path>` — append one
 * ledger record for a completed slice-unit, strictly between the fences.
 *
 * Write ordering (T-173-13 / 173-RESEARCH.md assumption A1): the slice file is confirmed on disk
 * — exists, non-empty, resolves inside the run's staging dir — BEFORE anything is appended. A
 * record must never outrun the write it describes; that is exactly the bug that would make resume
 * skip real, uncompleted work.
 *
 * Idempotent (L4): recording the same unit twice is a no-op that returns `alreadyRecorded: true`
 * — resume must never double-append.
 */
export async function verifyRunRecordCommand(
  options: VerifyRunOptions & { runId?: string; unit?: string; slice?: string } = {},
): Promise<VerifyRunRecordResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const { runId, unit, slice } = options;

  if (!runId) throw new Error('verify-run-record requires --run-id <id>.');
  if (!unit) throw new Error('verify-run-record requires --unit <unit-id>.');
  if (!slice) throw new Error('verify-run-record requires --slice <path>.');
  assertValidRunId(runId);

  const stagingDir = stagingSlicesDir(projectDir, runId);
  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);

  let ledgerText: string;
  try {
    ledgerText = await fs.readFile(ledgerFile, 'utf-8');
  } catch {
    throw new Error(
      `No verify run "${runId}" found in ${projectDir}.\n` +
        `Run \`boardsmith verify-run-init --run-id ${runId}\` first.`,
    );
  }

  const { records } = parseLedgerBody(ledgerText, relLedgerPath);
  const existing = records.find((r) => r.unitId === unit);
  if (existing) {
    const result: VerifyRunRecordResult = {
      runId,
      unitId: unit,
      slicePath: existing.slicePath,
      sha256: existing.sha256,
      alreadyRecorded: true,
    };
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.gray(`= unit "${unit}" was already recorded for run ${runId} — no-op`));
    }
    return result;
  }

  // T-173-14: --slice must resolve inside this run's staging dir. Validated BEFORE any read, so
  // a path pointing outside the run is refused rather than hashed.
  const sliceAbs = resolve(stagingDir, slice);
  const relToStaging = relative(stagingDir, sliceAbs);
  if (relToStaging === '' || relToStaging.startsWith('..') || isAbsolute(relToStaging)) {
    throw new Error(
      `--slice "${slice}" resolves outside run "${runId}"'s staging dir (${relative(projectDir, stagingDir)}).\n` +
        `Pass a path relative to the staging dir that a subagent actually wrote to.`,
    );
  }

  let stat: import('node:fs').Stats;
  try {
    stat = await fs.stat(sliceAbs);
  } catch {
    throw new Error(
      `Slice not found: ${relative(projectDir, sliceAbs)}.\n` +
        `verify-run-record only records a slice-unit AFTER its file is confirmed written — write\n` +
        `the slice first, then record it.`,
    );
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(
      `Slice at ${relative(projectDir, sliceAbs)} is empty or not a regular file.\n` +
        `Refusing to record an empty/partial slice as complete — write ordering must hold: the\n` +
        `slice write is confirmed done before its record is appended.`,
    );
  }

  const bytes = await fs.readFile(sliceAbs);
  const hash = sha256(bytes);
  const record: LedgerRecord = {
    unitId: unit,
    slicePath: relToStaging,
    sha256: hash,
    recordedAt: new Date().toISOString(),
  };

  const newText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(record));
  await atomicWriteFile(ledgerFile, newText);

  const result: VerifyRunRecordResult = {
    runId,
    unitId: unit,
    slicePath: relToStaging,
    sha256: hash,
    alreadyRecorded: false,
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(chalk.green(`✓ Recorded unit "${unit}"`));
    console.log(`  ${chalk.gray('slice:')} ${relToStaging}`);
    console.log(`  ${chalk.gray('sha256:')} ${hash}`);
  }
  return result;
}

// -------------------------------------------------------------------------------------------
// verifyRunStatusCommand
// -------------------------------------------------------------------------------------------

export interface VerifyRunStatusResult {
  runId: string;
  stagingDir: string;
  recorded: string[];
  count: number;
}

/**
 * `boardsmith verify-run-status` — the single CLI call that answers "which units are already
 * recorded", as machine-readable JSON, per the must-have truth that this is never a prose read.
 *
 * Re-hashes every recorded slice against the file on disk (L8/T-173-12): a unit whose stored
 * sha256 no longer matches is demoted to NOT recorded, with a warning naming the unit — tamper or
 * hand-edit detection, never a silent trust of the ledger's own claim. A malformed/unparseable
 * ledger line (L7/T-173-13) is likewise reported NOT recorded, with a warning — never a throw,
 * never a ledger rewrite.
 *
 * With no `--run-id`, reports the most recent run — run-ids sort lexicographically because the
 * format is fixed-width UTC (L6).
 */
export async function verifyRunStatusCommand(
  options: VerifyRunOptions & { runId?: string } = {},
): Promise<VerifyRunStatusResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const verifyRoot = join(projectDir, 'rulebook', '.verify');

  let runId = options.runId;
  if (runId) {
    assertValidRunId(runId);
  } else {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fs.readdir(verifyRoot, { withFileTypes: true });
    } catch {
      throw new Error(
        `No verify runs found under rulebook/.verify/ in ${projectDir}.\n` +
          `Run \`boardsmith verify-run-init\` first.`,
      );
    }
    const runIds = entries
      .filter((e) => e.isDirectory() && RUN_ID_RE.test(e.name))
      .map((e) => e.name)
      .sort();
    if (runIds.length === 0) {
      throw new Error(
        `No verify runs found under rulebook/.verify/ in ${projectDir}.\n` +
          `Run \`boardsmith verify-run-init\` first.`,
      );
    }
    runId = runIds[runIds.length - 1];
  }

  const stagingDir = stagingSlicesDir(projectDir, runId);
  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);

  let ledgerText: string;
  try {
    ledgerText = await fs.readFile(ledgerFile, 'utf-8');
  } catch {
    throw new Error(
      `No verify run "${runId}" found in ${projectDir}.\n` +
        `Run \`boardsmith verify-run-init --run-id ${runId}\` first.`,
    );
  }

  const { records, malformedLines } = parseLedgerBody(ledgerText, relLedgerPath);
  const recorded: string[] = [];
  const warnings: string[] = [];

  for (const rec of records) {
    const sliceAbs = resolve(stagingDir, rec.slicePath);
    const relToStaging = relative(stagingDir, sliceAbs);
    if (relToStaging === '' || relToStaging.startsWith('..') || isAbsolute(relToStaging)) {
      warnings.push(
        `unit "${rec.unitId}"'s recorded slice path escapes the staging dir — treating as NOT recorded`,
      );
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(sliceAbs);
    } catch {
      warnings.push(
        `unit "${rec.unitId}"'s recorded slice ${rec.slicePath} was not found on disk — treating as NOT recorded`,
      );
      continue;
    }
    if (sha256(bytes) !== rec.sha256) {
      warnings.push(
        `unit "${rec.unitId}"'s recorded sha256 no longer matches ${rec.slicePath} on disk — ` +
          `treating as NOT recorded (hand-edit or tamper detected)`,
      );
      continue;
    }
    recorded.push(rec.unitId);
  }

  if (malformedLines.length > 0) {
    warnings.push(
      `${malformedLines.length} ledger line(s) in ${relLedgerPath} could not be parsed as a ` +
        `complete record — treating as NOT recorded (a crash mid-write torns the final append)`,
    );
  }

  const result: VerifyRunStatusResult = {
    runId,
    stagingDir: relative(projectDir, stagingDir),
    recorded,
    count: recorded.length,
  };

  for (const w of warnings) {
    console.error(chalk.yellow(`⚠ ${w}`));
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(chalk.green(`✓ Verify run ${runId} — ${result.count} unit(s) recorded`));
  console.log(`  ${chalk.gray('staging:')} ${result.stagingDir}`);
  for (const unitId of result.recorded) {
    console.log(`  ${chalk.gray('-')} ${unitId}`);
  }
  return result;
}
