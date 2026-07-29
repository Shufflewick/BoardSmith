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
 * invoke these commands; it never reasons about where staging lives, what "recorded" means, or
 * how the page-range dispatch plan is decomposed.
 *
 * LEDGER FORMAT (resolves 173-RESEARCH.md Open Question 1)
 *
 * `RUN.md` carries TWO machine-owned fenced sections, each with its own fence pair — the same
 * shape `GAPS_BEGIN`/`GAPS_END` (ingest-archive.ts) and `VERIFIED_AGAINST_BEGIN`/`END`
 * (chunk-provenance.ts) already use, so a second section gets its own constants rather than a
 * second fencing convention (173-PATTERNS.md):
 *
 *  - `RUN_MANIFEST_BEGIN`/`END` — the page-range dispatch-plan manifest, written ONCE by
 *    `verify-run-init` and never rewritten by any later command (173-08 Task 2 / PROOF.md §4
 *    Finding 1). Persisting it here, at init time, is what makes the range decomposition a
 *    durable fact for the whole run rather than something re-derived every resume.
 *  - `RUN_LEDGER_BEGIN`/`END` — the append-only unit/range-marker ledger described below.
 *
 * Each line in either section is a SELF-DELIMITING single-line JSON object — no second fence
 * pair per record. A crash can therefore damage AT MOST the bytes it was writing at the instant
 * it landed, and CRASH SAFETY FOR THE LEDGER ITSELF is provided by writing the WHOLE FILE
 * atomically (temp file in the same directory, `fsync`, then `rename()` over the target — 173-08
 * Task 1 / CR-01) rather than by any property of `fs.writeFile`'s default flag, which truncates
 * on open and is NOT append-safe on its own. POSIX `rename()` within one filesystem is atomic, so
 * a crash at any point in a `verify-run-record` call leaves `RUN.md` either byte-identical to its
 * pre-call state (every previously-recorded unit and range marker intact) or containing the fully
 * new line — never a torn mix of the two, and never a file with earlier records lost.
 *
 * A line that does not parse as a well-formed record (the one shape a torn write CAN still
 * produce, if a process is killed while the temp file itself was being written — that torn temp
 * file is simply an orphan, per T-173-08-04 below, never the live `RUN.md`) is read as NOT
 * recorded rather than as an error or as complete — this is what makes resume safe (T-173-13).
 * The one case this does NOT cover: a crash that destroys the ledger's OWN fences (not just a
 * record line) is unreachable under the atomic-write scheme, because `RUN.md` is never partially
 * rewritten in place — the file readers see is always either the last fully-committed version or
 * (impossible in practice, since the temp file is never renamed until it is complete) never
 * observed mid-write at all.
 *
 * RANGE-LEVEL RESUME DETERMINISM (173-08 Task 2 / PROOF.md §4 Finding 1)
 *
 * `verify-run-status`'s `recorded[]`/`count` answer "which UNITS are recorded" — unchanged from
 * 173-07. Resume dispatch decisions, though, are made at RANGE granularity against `rangesPending`
 * (this run's persisted manifest ranges minus `rangesRecorded`), not by inspecting individual
 * units: a range is either fully covered (marked `range-complete`, after which none of its units
 * are ever re-dispatched) or it is pending. A range interrupted mid-dispatch (some units recorded,
 * no `range-complete` marker) is NOT resumed by re-dispatching alongside its stale partial output
 * — the stale units are first superseded with a `range-reset` marker (an APPENDED tombstone, never
 * a rewrite or deletion of the stale lines — the append-only discipline holds for markers too),
 * which excludes them from `recorded[]` from that point forward, and then the whole range is
 * dispatched fresh. This is what keeps a resumed pass's unit set from re-fragmenting into
 * additional, overlapping content alongside the original partial attempt (the observed 9-vs-4 gap
 * in `173-PROOF.md` §4).
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
 * A page-range id's shape (T-173-08-03): letters, digits, `.`/`_`/`-` only — never a path
 * separator, `.`/`..` segment, or anything else that could be composed into a filesystem path.
 * The manifest is persisted, untrusted input on every read after the first write, so this is
 * enforced both when a fresh manifest is written and every time an existing one is parsed back.
 */
export const RANGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Fences delimiting the machine-owned body of `RUN.md`. Minted fresh for this section — never
 * shared with `GAPS_BEGIN`/`GAPS_END` or `VERIFIED_AGAINST_BEGIN`/`END`.
 */
export const RUN_LEDGER_BEGIN = '<!-- boardsmith:verify-run:begin -->';
export const RUN_LEDGER_END = '<!-- boardsmith:verify-run:end -->';

/**
 * Fences delimiting the machine-owned dispatch-plan manifest — a distinct section, its own fence
 * pair (never shared with `RUN_LEDGER_BEGIN`/`END`), written once at `verify-run-init` time.
 */
export const RUN_MANIFEST_BEGIN = '<!-- boardsmith:verify-run:manifest:begin -->';
export const RUN_MANIFEST_END = '<!-- boardsmith:verify-run:manifest:end -->';

/** One recorded slice-unit. Each ledger line is exactly one `JSON.stringify(LedgerRecord)`. */
export interface LedgerRecord {
  /** Absent on every record written before 173-08 — treated identically to `'unit'`. */
  kind?: 'unit';
  unitId: string;
  /** Path to the slice, relative to the run's staging dir (`stagingSlicesDir()`'s return value). */
  slicePath: string;
  sha256: string;
  recordedAt: string;
  /** The manifest range this unit was transcribed under, if the caller supplied one. */
  rangeId?: string;
}

/**
 * A range-level marker line — `range-complete` (this range's dispatch is fully covered; never
 * re-dispatched again) or `range-reset` (this range's PRIOR unit records, up to and including the
 * point of this marker, are superseded and must read as NOT recorded — written immediately before
 * re-dispatching a range that was interrupted mid-coverage, per PROOF.md §4 Finding 1).
 */
export interface RangeMarkerRecord {
  kind: 'range-complete' | 'range-reset';
  rangeId: string;
  recordedAt: string;
}

/**
 * One recorded classification verdict for a live↔staged slice-pair GROUP (174-CONTEXT.md decision
 * 4/6, amended). `units`, `liveSlices`, and `stagedSlices` are all ARRAYS — the pairing is m:n, and
 * `units` mirrors `SlicePair.stagedUnits[]` (plan 174-03) field-for-field, with no collapsing step.
 * `stale` is DERIVED from `ruleDelta` alone (decision 3) — never accepted as a caller-supplied
 * field by the record command that will populate this (plan 174-04).
 */
export interface ClassificationRecord {
  kind: 'classification';
  pairId: string;
  units: string[];
  liveSlices: string[];
  stagedSlices: string[];
  provenance: 'source-changed' | 'source-unchanged' | 'unknown';
  ruleDelta: 'cosmetic' | 'sharper' | 'contradictory' | 'unclassified';
  stale: boolean;
  evidence: string;
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

/** T-173-08-03: validated both when a fresh manifest is written and every time one is read back. */
function assertValidRangeId(rangeId: string): void {
  if (!RANGE_ID_RE.test(rangeId)) {
    throw new Error(
      `Invalid range id "${rangeId}".\n` +
        `Expected letters, digits, ".", "_", or "-" only (no path separators) — e.g. "1-1" or\n` +
        `"9-16".`,
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

/**
 * The single path-computation authority for a run's ledger file. Exported (174-02) so
 * `verify-classify.ts` — the second caller sharing this ledger — can locate the SAME `RUN.md`
 * `verify-run.ts` reads and writes, rather than re-deriving the path.
 */
export function ledgerFilePath(projectDir: string, runId: string): string {
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
 *
 * Exported (174-02) — this is the ONE atomic ledger write path in the repo. `verify-classify.ts`
 * is the second caller sharing it, never a second implementation of temp-file+fsync+rename.
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
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

/**
 * The freshly-minted RUN.md contents: a title, explanatory machine-owned comments, the manifest
 * fence pair (populated with `ranges` — empty body when the caller supplies none), and an empty
 * ledger fence pair. Both sections are written together, in the one atomic init write.
 */
function renderEmptyRunMd(runId: string, ranges: string[]): string {
  const manifestBody = ranges.map((r) => JSON.stringify({ rangeId: r })).join('\n');
  return (
    `# Verify Run Ledger — ${runId}\n\n` +
    `<!-- MACHINE-OWNED. Do not write between the fences below by hand, and do not move or\n` +
    `     delete them. This file is written by \`boardsmith verify-run-init\`/\`verify-run-record\`\n` +
    `     and read by \`boardsmith verify-run-status\`. -->\n\n` +
    `<!-- The manifest below is the page-range dispatch plan, decided ONCE at verify-run-init\n` +
    `     time and never rewritten — resume reads it rather than re-deriving the range\n` +
    `     decomposition. -->\n\n` +
    `${RUN_MANIFEST_BEGIN}\n${manifestBody}${manifestBody ? '\n' : ''}${RUN_MANIFEST_END}\n\n` +
    `<!-- The ledger below is append-only. Each line between the fences is one self-delimiting\n` +
    `     JSON record for one completed slice-unit, or one range-level marker\n` +
    `     (range-complete/range-reset). -->\n\n` +
    `${RUN_LEDGER_BEGIN}\n${RUN_LEDGER_END}\n`
  );
}

/**
 * Locates the ledger fence pair, or throws the actionable "missing its machine-owned fences" error
 * (L9). Exported (174-02) so `verify-classify.ts` can share this fence-location logic rather than
 * re-deriving it.
 */
export function locateFences(
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
 * Locates the manifest fence pair. Unlike `locateFences`, absence is not an error — a ledger
 * written before 173-08, or one initialized with no `--ranges`, has no manifest section at all,
 * and that is a valid, supported shape (this project makes no backward-compatibility promise
 * about the ON-DISK format, but there is no reason to force a migration for something read-only
 * and purely advisory to resume's dispatch decision).
 */
function locateManifestFences(ledgerText: string): { beginIdx: number; endIdx: number } | undefined {
  const beginIdx = ledgerText.indexOf(RUN_MANIFEST_BEGIN);
  const endIdx = ledgerText.indexOf(RUN_MANIFEST_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return undefined;
  return { beginIdx, endIdx };
}

/**
 * Reads the persisted manifest back. T-173-08-03: a persisted file is untrusted input on every
 * later read, so every `rangeId` is re-validated against `RANGE_ID_RE` here — a line that fails
 * validation, or is not well-formed JSON with a string `rangeId`, is silently skipped rather than
 * thrown, since the manifest is advisory to dispatch decisions, not load-bearing for crash safety.
 */
function parseManifest(ledgerText: string): string[] {
  const fences = locateManifestFences(ledgerText);
  if (!fences) return [];
  const body = ledgerText.slice(fences.beginIdx + RUN_MANIFEST_BEGIN.length, fences.endIdx);
  const ranges: string[] = [];
  for (const raw of body.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && typeof obj.rangeId === 'string' && RANGE_ID_RE.test(obj.rangeId)) {
        ranges.push(obj.rangeId);
      }
    } catch {
      // Malformed manifest line — skip it. See doc comment above.
    }
  }
  return ranges;
}

/**
 * Appends one line before the END fence, preserving everything else byte-for-byte. Never rewrites
 * or "cleans up" any existing line — including a torn one, or a superseded unit/range marker —
 * because that is a read-time concern (`resolveLedgerState`/`verifyRunStatusCommand`), not a
 * write-time repair this append-only command performs. The returned text is written to disk by
 * the caller via `atomicWriteFile`, never `fs.writeFile` directly (CR-01).
 *
 * Exported (174-02) — `verify-classify.ts` shares this append helper (and `atomicWriteFile` above)
 * so a classification record lands through the exact same crash-safe path a unit/marker record
 * does, never a second append implementation.
 */
export function appendLedgerLine(ledgerText: string, relLedgerPath: string, newLine: string): string {
  const { beginIdx, endIdx } = locateFences(ledgerText, relLedgerPath);
  const bodyStart = beginIdx + RUN_LEDGER_BEGIN.length;
  let body = ledgerText.slice(bodyStart, endIdx);
  if (body.length > 0 && !body.endsWith('\n')) body += '\n';
  body += `${newLine}\n`;
  return ledgerText.slice(0, bodyStart) + body + ledgerText.slice(endIdx);
}

/** Exported (174-02) — `verify-classify.ts` extends this discriminated union, never a second parser. */
export interface ParsedUnitLine {
  type: 'unit';
  index: number;
  record: LedgerRecord;
}
/** Exported (174-02) — see `ParsedUnitLine`. */
export interface ParsedMarkerLine {
  type: 'marker';
  index: number;
  record: RangeMarkerRecord;
}
/** Exported (174-02) — a fourth ledger-line kind, `classification`, in the SAME fence pair. */
export interface ParsedClassificationLine {
  type: 'classification';
  index: number;
  record: ClassificationRecord;
}
/** Exported (174-02) — see `ParsedUnitLine`. Widened to include `ParsedClassificationLine`. */
export type ParsedLine = ParsedUnitLine | ParsedMarkerLine | ParsedClassificationLine;

/**
 * Parses every in-fence line as either a `LedgerRecord` (unit) or a `RangeMarkerRecord`
 * (range-complete/range-reset), preserving file order via `index` — order matters because a
 * `range-reset` marker only supersedes unit records that appear BEFORE it in the file; units
 * recorded by a subsequent, fresh dispatch (appended after the reset) are unaffected.
 *
 * A line that does not parse as JSON, or that parses but matches neither shape, is dropped into
 * `malformedLines` rather than thrown — per T-173-13, an unparseable line (most likely a torn
 * temp-file write from a crash BEFORE the atomic rename ever ran — see CR-01's fix, which makes
 * a torn LIVE ledger unreachable) must read as NOT recorded so resume re-dispatches that unit,
 * never as an error that halts status.
 *
 * Exported (174-02) — `verify-classify.ts` is the second caller of this parser, sharing the SAME
 * discriminated union and malformed-line discipline rather than re-implementing a parallel parse.
 */
export function parseLedgerBody(
  ledgerText: string,
  relLedgerPath: string,
): { lines: ParsedLine[]; malformedLines: string[] } {
  const { beginIdx, endIdx } = locateFences(ledgerText, relLedgerPath);
  const body = ledgerText.slice(beginIdx + RUN_LEDGER_BEGIN.length, endIdx);
  const rawLines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const lines: ParsedLine[] = [];
  const malformedLines: string[] = [];
  rawLines.forEach((line, index) => {
    try {
      const obj: unknown = JSON.parse(line);
      if (!obj || typeof obj !== 'object') {
        malformedLines.push(line);
        return;
      }
      const rec = obj as Record<string, unknown>;
      if (rec.kind === 'range-complete' || rec.kind === 'range-reset') {
        if (typeof rec.rangeId === 'string' && typeof rec.recordedAt === 'string') {
          lines.push({
            type: 'marker',
            index,
            record: { kind: rec.kind, rangeId: rec.rangeId, recordedAt: rec.recordedAt },
          });
        } else {
          malformedLines.push(line);
        }
        return;
      }
      if (rec.kind === 'classification') {
        // T-174-04/LEDGER-2: every field type-validated; a torn or malformed classification line
        // lands in malformedLines and is never thrown, exactly the T-173-13 discipline the unit
        // and marker branches above already follow. Enum-membership of provenance/ruleDelta is NOT
        // validated here (that is the record command's normalization job, decision 8) — only that
        // both are strings.
        const isStringArray = (v: unknown): v is string[] =>
          Array.isArray(v) && v.every((x) => typeof x === 'string');
        if (
          typeof rec.pairId === 'string' &&
          isStringArray(rec.units) &&
          isStringArray(rec.liveSlices) &&
          isStringArray(rec.stagedSlices) &&
          typeof rec.provenance === 'string' &&
          typeof rec.ruleDelta === 'string' &&
          typeof rec.stale === 'boolean' &&
          typeof rec.evidence === 'string' &&
          typeof rec.recordedAt === 'string'
        ) {
          lines.push({
            type: 'classification',
            index,
            record: {
              kind: 'classification',
              pairId: rec.pairId,
              units: rec.units,
              liveSlices: rec.liveSlices,
              stagedSlices: rec.stagedSlices,
              provenance: rec.provenance as ClassificationRecord['provenance'],
              ruleDelta: rec.ruleDelta as ClassificationRecord['ruleDelta'],
              stale: rec.stale,
              evidence: rec.evidence,
              recordedAt: rec.recordedAt,
            },
          });
        } else {
          malformedLines.push(line);
        }
        return;
      }
      if (
        (rec.kind === undefined || rec.kind === 'unit') &&
        typeof rec.unitId === 'string' &&
        typeof rec.slicePath === 'string' &&
        typeof rec.sha256 === 'string' &&
        typeof rec.recordedAt === 'string' &&
        (rec.rangeId === undefined || typeof rec.rangeId === 'string')
      ) {
        lines.push({
          type: 'unit',
          index,
          record: {
            unitId: rec.unitId,
            slicePath: rec.slicePath,
            sha256: rec.sha256,
            recordedAt: rec.recordedAt,
            ...(typeof rec.rangeId === 'string' ? { rangeId: rec.rangeId } : {}),
          },
        });
      } else {
        malformedLines.push(line);
      }
    } catch {
      malformedLines.push(line);
    }
  });
  return { lines, malformedLines };
}

/**
 * Resolves the ledger's file-ordered lines into the two facts every caller needs: which unit
 * records are still active (not superseded by a later `range-reset` of their `rangeId`), and
 * which ranges are complete (a `range-complete` marker exists AFTER that range's last
 * `range-reset`, if any). This is the one place reset/complete semantics are computed — both
 * `verifyRunRecordCommand` (idempotency + refusing to reset a complete range) and
 * `verifyRunStatusCommand` (the reported `recorded[]`/`rangesRecorded[]`) call this rather than
 * re-deriving it.
 *
 * Exported (174-02) — `verify-classify.ts` shares this resolution logic (widened in Task 2 below
 * to also resolve classification records) rather than re-deriving reset/complete semantics.
 *
 * `classifications` (174-02 Task 2) resolves to one `ClassificationRecord` per `pairId`,
 * last-write-wins — a later record for the same `pairId` supersedes an earlier one (the
 * append-only ledger's re-classification path). Classification lines are a DISTINCT kind from
 * unit lines: they are never counted in `recorded[]`, and a `range-reset` marker — which is
 * unit-scoped only — never supersedes one, matching decision 4/6's kind-isolation requirement.
 */
export function resolveLedgerState(lines: ParsedLine[]): {
  recorded: LedgerRecord[];
  completeRanges: Set<string>;
  classifications: ClassificationRecord[];
} {
  const lastResetIndex = new Map<string, number>();
  const lastCompleteIndex = new Map<string, number>();
  for (const line of lines) {
    if (line.type !== 'marker') continue;
    if (line.record.kind === 'range-reset') {
      lastResetIndex.set(line.record.rangeId, line.index);
    } else {
      lastCompleteIndex.set(line.record.rangeId, line.index);
    }
  }

  const recorded: LedgerRecord[] = [];
  for (const line of lines) {
    if (line.type !== 'unit') continue;
    const { rangeId } = line.record;
    if (rangeId) {
      const resetAt = lastResetIndex.get(rangeId);
      if (resetAt !== undefined && line.index < resetAt) continue; // superseded
    }
    recorded.push(line.record);
  }

  const completeRanges = new Set<string>();
  for (const [rangeId, completeIdx] of lastCompleteIndex) {
    const resetIdx = lastResetIndex.get(rangeId) ?? -1;
    if (completeIdx > resetIdx) completeRanges.add(rangeId);
  }

  // Last-write-wins per pairId — a later classification line for the same pair supersedes an
  // earlier one. File order (`index`) is the ledger's own append order, so the later `Map.set`
  // for a repeated `pairId` always wins.
  const classificationsByPairId = new Map<string, ClassificationRecord>();
  for (const line of lines) {
    if (line.type !== 'classification') continue;
    classificationsByPairId.set(line.record.pairId, line.record);
  }

  return { recorded, completeRanges, classifications: [...classificationsByPairId.values()] };
}

// -------------------------------------------------------------------------------------------
// verifyRunInitCommand
// -------------------------------------------------------------------------------------------

export interface VerifyRunInitResult {
  runId: string;
  stagingDir: string;
  ledgerPath: string;
  created: boolean;
  /**
   * The run's persisted page-range dispatch-plan manifest (173-08 Task 2). On a fresh run this
   * echoes back whatever `ranges` was passed (or `[]` if omitted). On a RESUMED run this is
   * always the manifest as it was originally persisted — any `ranges` passed to this resuming
   * call is ignored, because the decomposition is decided once, at first init, and is never
   * re-derived.
   */
  ranges: string[];
}

/**
 * `boardsmith verify-run-init` — allocate (or resume) a run's staging tree, RUN.md ledger, and
 * (on first init only) its page-range dispatch-plan manifest.
 *
 * Idempotent on a supplied `--run-id`: re-running with the SAME id never truncates RUN.md and
 * never deletes staged slices (S3) — this is the resume entry point. `--run-id` exists ONLY to
 * target an existing run; a fresh run-id is always minted by this command when omitted
 * (173-CONTEXT.md decision 11 / specifics — removes the instruction-shaped `date -u` step).
 */
export async function verifyRunInitCommand(
  options: VerifyRunOptions & { runId?: string; ranges?: string[] } = {},
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
  const ledgerFile = ledgerFilePath(projectDir, runId);

  // Non-destructive: mkdir recursive never truncates an existing tree.
  await fs.mkdir(stagingDir, { recursive: true });

  let created: boolean;
  let ranges: string[];
  try {
    const existingText = await fs.readFile(ledgerFile, 'utf-8');
    created = false;
    // Resume: the manifest was decided at first init and is never re-derived — whatever
    // `options.ranges` this resuming call carries is ignored, matching Task 2's guarantee.
    ranges = parseManifest(existingText);
  } catch {
    const requested = (options.ranges ?? []).map((r) => r.trim()).filter((r) => r.length > 0);
    for (const r of requested) assertValidRangeId(r);
    ranges = requested;
    await atomicWriteFile(ledgerFile, renderEmptyRunMd(runId, ranges));
    created = true;
  }

  const result: VerifyRunInitResult = {
    runId,
    stagingDir: relative(projectDir, stagingDir),
    ledgerPath: relative(projectDir, ledgerFile),
    created,
    ranges,
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(chalk.green(created ? '✓ Allocated verify run' : '✓ Resuming existing verify run'));
  console.log(`  ${chalk.gray('run-id:')} ${runId}`);
  console.log(`  ${chalk.gray('staging:')} ${result.stagingDir}`);
  console.log(`  ${chalk.gray('ledger:')} ${result.ledgerPath}`);
  if (ranges.length > 0) {
    console.log(`  ${chalk.gray('ranges:')} ${ranges.join(', ')}`);
  }
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
  rangeId?: string;
}

export interface VerifyRunRangeActionResult {
  runId: string;
  rangeId: string;
  action: 'range-complete' | 'range-reset';
  alreadyRecorded: boolean;
}

/**
 * Reads the ledger file or throws the actionable "no verify run found" error. Exported (174-02) —
 * `verify-classify.ts` is the second caller of this read helper, sharing the same error message
 * and the same "run must be initialized first" contract.
 */
export async function readLedgerOrThrow(
  ledgerFile: string,
  runId: string,
  projectDir: string,
): Promise<string> {
  try {
    return await fs.readFile(ledgerFile, 'utf-8');
  } catch {
    throw new Error(
      `No verify run "${runId}" found in ${projectDir}.\n` +
        `Run \`boardsmith verify-run-init --run-id ${runId}\` first.`,
    );
  }
}

/** Shared by the range-complete and range-reset actions below. */
async function recordRangeMarker(
  kind: 'range-complete' | 'range-reset',
  options: { project?: string; runId: string; rangeId: string; json?: boolean },
): Promise<VerifyRunRangeActionResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const { runId, rangeId } = options;
  assertValidRunId(runId);
  assertValidRangeId(rangeId);

  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);

  const manifestRanges = parseManifest(ledgerText);
  if (manifestRanges.length > 0 && !manifestRanges.includes(rangeId)) {
    throw new Error(
      `Range "${rangeId}" is not in run "${runId}"'s persisted manifest (${manifestRanges.join(', ')}).\n` +
        `The manifest is decided once at \`verify-run-init\` — pass a range id it actually lists.`,
    );
  }

  const { lines, malformedLines } = parseLedgerBody(ledgerText, relLedgerPath);
  void malformedLines; // a marker action never depends on unrelated malformed lines
  const { completeRanges } = resolveLedgerState(lines);

  if (kind === 'range-complete') {
    if (completeRanges.has(rangeId)) {
      const result: VerifyRunRangeActionResult = { runId, rangeId, action: kind, alreadyRecorded: true };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else console.log(chalk.gray(`= range "${rangeId}" was already complete for run ${runId} — no-op`));
      return result;
    }
  } else {
    // range-reset: refuse to reset a range that is already fully recorded — that would discard
    // already-verified work and enable exactly the wasteful re-dispatch this mechanism exists to
    // prevent. Resetting is only ever for a range interrupted mid-coverage.
    if (completeRanges.has(rangeId)) {
      throw new Error(
        `Range "${rangeId}" is already fully recorded for run "${runId}".\n` +
          `Refusing to reset a complete range — that would discard already-verified work.\n` +
          `Resetting exists only to supersede a range interrupted mid-dispatch (some units\n` +
          `recorded, no range-complete marker) before redispatching it fresh.`,
      );
    }
  }

  const marker: RangeMarkerRecord = { kind, rangeId, recordedAt: new Date().toISOString() };
  const newText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(marker));
  await atomicWriteFile(ledgerFile, newText);

  const result: VerifyRunRangeActionResult = { runId, rangeId, action: kind, alreadyRecorded: false };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (kind === 'range-complete') {
    console.log(chalk.green(`✓ Range "${rangeId}" marked complete`));
  } else {
    console.log(chalk.yellow(`↺ Range "${rangeId}" reset — its prior units will read as NOT recorded`));
  }
  return result;
}

/**
 * `boardsmith verify-run-record --run-id <id> --unit <unit-id> --slice <path>` — append one
 * ledger record for a completed slice-unit, strictly between the fences. Optionally tags the
 * record with `--range <rangeId>` (the manifest range this unit belongs to).
 *
 * `--complete-range <rangeId>` and `--reset-range <rangeId>` are the two range-level actions
 * described in this module's doc comment; exactly one of `--unit`, `--complete-range`, or
 * `--reset-range` must be supplied per call.
 *
 * Write ordering (T-173-13 / 173-RESEARCH.md assumption A1): the slice file is confirmed on disk
 * — exists, non-empty, resolves inside the run's staging dir — BEFORE anything is appended. A
 * record must never outrun the write it describes; that is exactly the bug that would make resume
 * skip real, uncompleted work.
 *
 * Idempotent (L4): recording the same unit twice is a no-op that returns `alreadyRecorded: true`
 * — resume must never double-append. (A unit superseded by a `range-reset` is, by definition, no
 * longer "recorded" — re-recording the same unitId after a reset is a fresh record, not a no-op.)
 *
 * Every write in this function goes through `atomicWriteFile` (CR-01) — never `fs.writeFile`
 * directly against the ledger.
 */
export async function verifyRunRecordCommand(
  options: VerifyRunOptions & {
    runId?: string;
    unit?: string;
    slice?: string;
    range?: string;
    completeRange?: string;
    resetRange?: string;
  } = {},
): Promise<VerifyRunRecordResult | VerifyRunRangeActionResult> {
  const { runId } = options;
  if (!runId) throw new Error('verify-run-record requires --run-id <id>.');
  assertValidRunId(runId);

  const modeCount = [options.unit, options.completeRange, options.resetRange].filter(
    (v) => v !== undefined,
  ).length;
  if (modeCount === 0) {
    throw new Error(
      'verify-run-record requires exactly one of: --unit <id> (with --slice), --complete-range <id>,\n' +
        'or --reset-range <id>.',
    );
  }
  if (modeCount > 1) {
    throw new Error(
      'verify-run-record accepts only one of --unit, --complete-range, --reset-range per call.',
    );
  }

  if (options.completeRange) {
    return recordRangeMarker('range-complete', {
      project: options.project,
      runId,
      rangeId: options.completeRange,
      json: options.json,
    });
  }
  if (options.resetRange) {
    return recordRangeMarker('range-reset', {
      project: options.project,
      runId,
      rangeId: options.resetRange,
      json: options.json,
    });
  }

  const { unit, slice } = options;
  if (!unit) throw new Error('verify-run-record requires --unit <unit-id>.');
  if (!slice) throw new Error('verify-run-record requires --slice <path>.');

  const projectDir = resolve(options.project ?? process.cwd());
  const stagingDir = stagingSlicesDir(projectDir, runId);
  const ledgerFile = ledgerFilePath(projectDir, runId);
  const relLedgerPath = relative(projectDir, ledgerFile);

  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);

  if (options.range) {
    assertValidRangeId(options.range);
    const manifestRanges = parseManifest(ledgerText);
    if (manifestRanges.length > 0 && !manifestRanges.includes(options.range)) {
      throw new Error(
        `Range "${options.range}" is not in run "${runId}"'s persisted manifest (${manifestRanges.join(', ')}).\n` +
          `The manifest is decided once at \`verify-run-init\` — pass a range id it actually lists.`,
      );
    }
  }

  const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
  const { recorded } = resolveLedgerState(lines);
  const existing = recorded.find((r) => r.unitId === unit);
  if (existing) {
    const result: VerifyRunRecordResult = {
      runId,
      unitId: unit,
      slicePath: existing.slicePath,
      sha256: existing.sha256,
      alreadyRecorded: true,
      ...(existing.rangeId ? { rangeId: existing.rangeId } : {}),
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
    ...(options.range ? { rangeId: options.range } : {}),
  };

  const newText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(record));
  await atomicWriteFile(ledgerFile, newText);

  const result: VerifyRunRecordResult = {
    runId,
    unitId: unit,
    slicePath: relToStaging,
    sha256: hash,
    alreadyRecorded: false,
    ...(options.range ? { rangeId: options.range } : {}),
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
  /** The run's persisted dispatch-plan manifest (`[]` if none was supplied at init). */
  ranges: string[];
  /** Manifest ranges with a `range-complete` marker not superseded by a later reset. */
  rangesRecorded: string[];
  /** Manifest ranges NOT in `rangesRecorded` — what resume should dispatch, in manifest order. */
  rangesPending: string[];
}

/**
 * `boardsmith verify-run-status` — the single CLI call that answers "which units are already
 * recorded" and "which manifest ranges are still pending", as machine-readable JSON, per the
 * must-have truth that this is never a prose read.
 *
 * Re-hashes every recorded slice against the file on disk (L8/T-173-12): a unit whose stored
 * sha256 no longer matches is demoted to NOT recorded, with a warning naming the unit — tamper or
 * hand-edit detection, never a silent trust of the ledger's own claim. A malformed/unparseable
 * ledger line (L7/T-173-13) is likewise reported NOT recorded, with a warning — never a throw,
 * never a ledger rewrite. A unit superseded by a `range-reset` (173-08 Task 2) is excluded from
 * `recorded[]` the same way, silently — it was never a crash/tamper case, so it does not warrant
 * a warning of its own.
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

  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, projectDir);

  const manifestRanges = parseManifest(ledgerText);
  const { lines, malformedLines } = parseLedgerBody(ledgerText, relLedgerPath);
  const { recorded: activeRecords, completeRanges } = resolveLedgerState(lines);

  const recorded: string[] = [];
  const warnings: string[] = [];

  for (const rec of activeRecords) {
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

  const rangesRecorded = manifestRanges.filter((r) => completeRanges.has(r));
  const rangesPending = manifestRanges.filter((r) => !completeRanges.has(r));

  const result: VerifyRunStatusResult = {
    runId,
    stagingDir: relative(projectDir, stagingDir),
    recorded,
    count: recorded.length,
    ranges: manifestRanges,
    rangesRecorded,
    rangesPending,
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
  if (manifestRanges.length > 0) {
    console.log(`  ${chalk.gray('ranges recorded:')} ${rangesRecorded.join(', ') || '(none)'}`);
    console.log(`  ${chalk.gray('ranges pending:')} ${rangesPending.join(', ') || '(none)'}`);
  }
  return result;
}
