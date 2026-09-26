/**
 * `boardsmith ledger-check` (#293): the mechanical integrity check for a game project's design
 * ledgers and its orchestrated-run journal.
 *
 * The templates state these rules in prose, and a real run (Shufflewick/sotf#32, #37) broke every
 * one of them while the prose sat there: a ruling number used twice, a decision superseded with
 * no pointer on the old entry, a filing whose banner said posted while its fields said recorded,
 * and run-log timestamps typed by hand that the git history contradicts. A rule that lives only
 * in Markdown is followed by some models and not others, so this runs as code and fails loudly.
 *
 * It checks, in `design/`:
 *   - RULINGS.md, DECISIONS.md, FILINGS.md, QUESTIONS.md: no entry number, and no provisional id
 *     (`Ruling @<slug>.<n>`, #294), used twice; every `supersedes X N` is matched by
 *     `- Superseded by: X M` on entry N itself, and every pointer names a real entry.
 *   - Every numbered ledger, CONSTRAINTS.md included: no provisional id in the main checkout. Only a
 *     chunk's own worktree holds them, and `boardsmith chunk-merge` allocates them as it merges.
 *   - FILINGS.md: each entry's `Reported:`, `Issue:` and any status banner agree.
 *   - run-log/<slug>.md, one per chunk (#294): every `Dispatched at` / `Finished at` is a
 *     `date -u` clock read, in order, and no later than the commit that recorded that line (or
 *     than now, for a line not yet committed). RUN.md holds no dispatch entries of its own.
 *   - CROSS-CHUNK.md (#294): every merge of a chunk built alongside others has a ruling from the
 *     audit's cross-chunk lens, not `pending`.
 *   - RULINGS.md, DECISIONS.md and every verified `chunks/<slug>/CHUNK.md` (its sign-off
 *     included): every script or capture they cite is in git (#292). A cited file that is
 *     missing, untracked, gitignored (the scratch folder) or outside the project is not evidence.
 *     One cited by line (`path:N`, `path:N-M`, #414) must also have those lines in the version
 *     the citing line was written against. A file of BoardSmith's own, cited from the installed
 *     package (`../node_modules/boardsmith/src/...`, #432), is in no commit of the game, so it
 *     must instead be in the package as installed, with the lines cited.
 *
 * It reads the working tree as it stands, so the same command checks one branch at close time
 * and a combined tree at merge time. READ-ONLY: it never writes a file, and the only git
 * subcommands it runs are `rev-parse`, `ls-files`, `blame` and `check-ignore`.
 */

import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { join as pathJoin, resolve as pathResolve } from 'node:path';
import {
  CROSS_CHUNK_MD,
  DECISIONS_MD,
  DESIGN_DIR,
  FILINGS_MD,
  QUESTIONS_MD,
  RULINGS_MD,
  RUN_LOG_DIR,
  RUN_MD,
  chunkSlugs,
  designPath,
  INSTALLED_BOARDSMITH_DIR,
  designRecordPath,
  installedBoardSmithPath,
  relChunkMdPath,
} from '../lib/project-paths.js';
import { CHUNK_EVIDENCE_DIR, citedEvidencePaths } from '../lib/cited-evidence.js';
import { LINE_LOCATION_HINT, type LineRange, fileLines, lineRangeProblem } from '../lib/line-location.js';
import { type LedgerEntry, parseLedgerEntries, supersessionPatterns } from '../lib/ledger-entries.js';
import { NUMBERED_LEDGER_SPECS, duplicateProvisionalIds, provisionalHeadings } from '../lib/ledger-allocation.js';
import { checkCrossChunkLedger } from './cross-chunk.js';

export type LedgerFindingKind =
  | 'duplicate-number'
  | 'superseded-without-pointer'
  | 'supersession-target-missing'
  | 'filing-status-conflict'
  | 'filing-status-invalid'
  | 'run-timestamp'
  | 'run-log-misplaced'
  | 'cross-chunk-unreviewed'
  | 'provisional-on-main-line'
  | 'evidence-not-committed'
  | 'cited-lines-missing';

export interface LedgerFinding {
  ledger: string;
  /** The entry the finding is about, e.g. `Ruling 138`. */
  entry: string;
  kind: LedgerFindingKind;
  /** What is wrong and what to change, in plain language. */
  detail: string;
}

export interface LedgerCheckResult {
  /** Ledgers found and checked, in check order. */
  checked: string[];
  /** Ledgers this project does not have yet (not a finding). */
  absent: string[];
  findings: LedgerFinding[];
}

/** The numbered ledgers, in check order, and the heading kind each one's entries use. */
const NUMBERED_LEDGERS = [
  { file: RULINGS_MD, kind: 'Ruling' },
  { file: DECISIONS_MD, kind: 'Decision' },
  { file: FILINGS_MD, kind: 'Filing' },
  { file: QUESTIONS_MD, kind: 'Question' },
] as const;

// ---------------------------------------------------------------------------------------------
// Numbering and supersession
// ---------------------------------------------------------------------------------------------

function groupByNumber(entries: LedgerEntry[]): Map<number, LedgerEntry[]> {
  const byNumber = new Map<number, LedgerEntry[]>();
  for (const entry of entries) {
    const list = byNumber.get(entry.number) ?? [];
    list.push(entry);
    byNumber.set(entry.number, list);
  }
  return byNumber;
}

function duplicateFindings(
  byNumber: Map<number, LedgerEntry[]>,
  kind: string,
  ledger: string,
): LedgerFinding[] {
  const findings: LedgerFinding[] = [];
  for (const [number, list] of byNumber) {
    if (list.length < 2) continue;
    const lines = list.map((e) => e.line);
    findings.push({
      ledger,
      entry: `${kind} ${number}`,
      kind: 'duplicate-number',
      detail:
        `${kind} ${number} is used ${list.length} times, at lines ${lines.slice(0, -1).join(', ')} and ` +
        `${lines[lines.length - 1]}. A citation of "${kind} ${number}" now means two things. Keep the ` +
        `first, give the later one the next unused number, and update every citation that meant it.`,
    });
  }
  return findings;
}

function allMatches(pattern: RegExp, text: string): number[] {
  return [...text.matchAll(new RegExp(pattern.source, 'gi'))].map((m) => Number(m[1]));
}

interface Supersession {
  kind: string;
  ledger: string;
  byNumber: Map<number, LedgerEntry[]>;
  supersedes: RegExp;
  supersededBy: RegExp;
}

/** Findings for every `supersedes <Kind> M` written on `entry`. */
function forwardSupersessionFindings(entry: LedgerEntry, s: Supersession): LedgerFinding[] {
  const { kind, ledger, byNumber } = s;
  const findings: LedgerFinding[] = [];
  for (const target of allMatches(s.supersedes, entry.body)) {
    const targets = byNumber.get(target);
    if (!targets) {
      findings.push({
        ledger,
        entry: `${kind} ${entry.number}`,
        kind: 'supersession-target-missing',
        detail:
          `${kind} ${entry.number} (line ${entry.line}) says it supersedes ${kind} ${target}, ` +
          `but there is no ${kind} ${target}. Correct the number it names.`,
      });
      continue;
    }
    const unmarked = targets.filter((old) => !allMatches(s.supersededBy, old.body).includes(entry.number));
    for (const old of unmarked) {
      findings.push({
        ledger,
        entry: `${kind} ${target}`,
        kind: 'superseded-without-pointer',
        detail:
          `${kind} ${entry.number} (line ${entry.line}) supersedes ${kind} ${target}, but ` +
          `${kind} ${target} (line ${old.line}) does not say so, so anyone reading it still ` +
          `takes it as current. Add the line "- Superseded by: ${kind} ${entry.number}" to ` +
          `${kind} ${target}.`,
      });
    }
  }
  return findings;
}

/** Findings for every in-place `Superseded by: <Kind> M` pointer on `entry` that names nothing. */
function pointerFindings(entry: LedgerEntry, s: Supersession): LedgerFinding[] {
  const { kind, ledger, byNumber } = s;
  return allMatches(s.supersededBy, entry.body)
    .filter((pointer) => !byNumber.has(pointer))
    .map((pointer) => ({
      ledger,
      entry: `${kind} ${entry.number}`,
      kind: 'supersession-target-missing' as const,
      detail:
        `${kind} ${entry.number} (line ${entry.line}) says it is superseded by ${kind} ${pointer}, ` +
        `but there is no ${kind} ${pointer}. Correct the number, or add the superseding entry.`,
    }));
}

/**
 * Duplicate numbers and supersession pointers for one numbered ledger (`RULINGS.md`,
 * `DECISIONS.md`, `FILINGS.md`). `kind` is the heading word, e.g. `Ruling`.
 */
export function checkNumberedLedger(text: string, kind: string, ledger: string): LedgerFinding[] {
  const entries = parseLedgerEntries(text, kind);
  const byNumber = groupByNumber(entries);
  const supersession: Supersession = { kind, ledger, byNumber, ...supersessionPatterns(kind) };
  const provisionalDupes = duplicateProvisionalIds(text, { file: ledger, kind, sep: ' ' }).map((id) => ({
    ledger,
    entry: id,
    kind: 'duplicate-number' as const,
    detail:
      `${id} is used as a heading more than once. A provisional id is allocated one real number at ` +
      `merge, so two entries under it would be merged into one citation. Give the later one the ` +
      `next unused provisional id for this chunk.`,
  }));
  return [
    ...provisionalDupes,
    ...duplicateFindings(byNumber, kind, ledger),
    ...entries.flatMap((entry) => [
      ...forwardSupersessionFindings(entry, supersession),
      ...pointerFindings(entry, supersession),
    ]),
  ];
}

// ---------------------------------------------------------------------------------------------
// FILINGS.md status fields
// ---------------------------------------------------------------------------------------------

type Reported = 'recorded' | 'posted' | 'posted-by-designer' | 'declined';
const REPORTED_VALUE = /^(recorded|posted-by-designer|posted|declined)\b/i;
/** A status line that is not the `Reported:` field, e.g. a `**POSTED 2026-09-22: ...**` banner. */
const STATUS_BANNER = /^[\s>*_#-]*(POSTED|RECORDED|DECLINED)\b/;
const URL = /https?:\/\//;
const STATUSES = 'recorded, posted, posted-by-designer or declined';

function fieldValues(body: string, field: string): string[] {
  const pattern = new RegExp(`^\\s*-\\s*${field}:[ \\t]*(.*)$`, 'gm');
  return [...body.matchAll(pattern)].map((m) => m[1].trim());
}

function isPosted(value: Reported): boolean {
  return value === 'posted' || value === 'posted-by-designer';
}

type Problem = { kind: LedgerFindingKind; detail: string };

/** The entry's one `Reported:` status, or the problem that stops it having one. */
function reportedStatus(body: string, where: string): Reported | Problem {
  const raw = fieldValues(body, 'Reported');
  if (raw.length === 0) {
    return { kind: 'filing-status-invalid', detail: `${where} has no "- Reported:" field. Add one: ${STATUSES}.` };
  }
  const unknown = raw.find((v) => !REPORTED_VALUE.test(v));
  if (unknown !== undefined) {
    return {
      kind: 'filing-status-invalid',
      detail: `${where} has "Reported: ${unknown}", which is not a status. Use ${STATUSES}.`,
    };
  }
  const distinct = [...new Set(raw.map((v) => REPORTED_VALUE.exec(v)![1].toLowerCase() as Reported))];
  if (distinct.length > 1) {
    return {
      kind: 'filing-status-conflict',
      detail:
        `${where} has ${raw.length} "Reported:" fields that disagree (${distinct.join(', ')}). ` +
        `Keep one field, holding the status that is true now.`,
    };
  }
  return distinct[0];
}

/** Whether the `Issue:` field agrees with `status`. */
function issueProblem(body: string, where: string, status: Reported): Problem | undefined {
  const issues = fieldValues(body, 'Issue');
  if (issues.length !== 1) {
    return {
      kind: 'filing-status-invalid',
      detail: `${where} has ${issues.length} "- Issue:" fields; it needs exactly one: the issue URL, or "n/a — not posted".`,
    };
  }
  const hasUrl = URL.test(issues[0]);
  if (isPosted(status) && !hasUrl) {
    return {
      kind: 'filing-status-conflict',
      detail:
        `${where} says "Reported: ${status}" but its Issue field holds no URL. Put the issue URL in ` +
        `"- Issue:", or set Reported back to recorded if it was never posted.`,
    };
  }
  if (!isPosted(status) && hasUrl) {
    return {
      kind: 'filing-status-conflict',
      detail:
        `${where} says "Reported: ${status}" but its Issue field holds a URL. If it was posted, set ` +
        `"- Reported: posted"; if not, set "- Issue: n/a — not posted".`,
    };
  }
  return undefined;
}

/** Every status banner line in the entry that contradicts `status`. */
function bannerProblems(body: string, where: string, status: Reported): Problem[] {
  return body
    .split('\n')
    .filter((line) => !/^\s*-\s*Reported:/.test(line))
    .filter((line) => {
      const banner = STATUS_BANNER.exec(line)?.[1].toLowerCase();
      if (!banner) return false;
      return banner === 'posted' ? !isPosted(status) : banner !== status;
    })
    .map((line) => ({
      kind: 'filing-status-conflict' as const,
      detail:
        `${where} carries the line "${line.trim()}" but its field says "Reported: ${status}". ` +
        `The fields are what every reader acts on: make "- Reported:" and "- Issue:" true, and ` +
        `remove the line that contradicts them.`,
    }));
}

function filingProblems(entry: LedgerEntry): Problem[] {
  const where = `Filing ${entry.number} (line ${entry.line})`;
  const status = reportedStatus(entry.body, where);
  if (typeof status !== 'string') return [status];
  const issue = issueProblem(entry.body, where, status);
  if (issue) return [issue];
  return bannerProblems(entry.body, where, status);
}

/** Checks that each filing's `Reported:`, `Issue:` and any status banner tell one story. */
export function checkFilingStatus(text: string): LedgerFinding[] {
  return parseLedgerEntries(text, 'Filing').flatMap((entry) =>
    filingProblems(entry).map((p) => ({ ledger: FILINGS_MD, entry: `Filing ${entry.number}`, ...p })),
  );
}

// ---------------------------------------------------------------------------------------------
// RUN.md timestamps
// ---------------------------------------------------------------------------------------------

/** The exact shape `date -u +%Y-%m-%dT%H:%M:%SZ` prints. */
const CLOCK_READ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CLOCK_COMMAND = '`date -u +%Y-%m-%dT%H:%M:%SZ`';

interface RunField {
  value: string;
  line: number;
}

function runField(entry: LedgerEntry, field: string): RunField | undefined {
  const lines = entry.body.split('\n');
  const pattern = new RegExp(`^\\s*-\\s*${field}:[ \\t]*(.*?)\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const match = pattern.exec(lines[i]);
    if (match) return { value: match[1], line: entry.bodyLine + i };
  }
  return undefined;
}

function isoOf(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.000Z$/, 'Z');
}

interface Clock {
  commitTimeOfLine: (line: number) => number | null;
  nowSeconds: number;
}

/**
 * Parses one clock-read field and holds it to the commit that recorded it (or to now, when not
 * committed). Returns the time, or undefined when it is not a clock read at all.
 */
function readClock(name: string, field: string, f: RunField, clock: Clock, out: string[]): number | undefined {
  if (!CLOCK_READ.test(f.value)) {
    out.push(
      `${name} "${field}: ${f.value}" (line ${f.line}) is not a clock read. Run ${CLOCK_COMMAND} ` +
        `and write exactly what it prints; never type or estimate a time.`,
    );
    return undefined;
  }
  const at = Date.parse(f.value) / 1000;
  const bound = clock.commitTimeOfLine(f.line);
  if (bound === null && at > clock.nowSeconds) {
    out.push(`${name} "${field}: ${f.value}" (line ${f.line}) is in the future. Replace it with a real ${CLOCK_COMMAND} read.`);
  } else if (bound !== null && at > bound) {
    out.push(
      `${name} ${field} ${f.value} (line ${f.line}) is later than the commit that recorded it ` +
        `(${isoOf(bound)}), so it was not read from the clock when it was written. Replace it ` +
        `with the time it actually happened, from ${CLOCK_COMMAND} or the git history.`,
    );
  }
  return at;
}

/** Outcome and Finished at must agree about whether the dispatch has returned. */
function pendingMismatch(name: string, outcome: string | undefined, finished: RunField): string | undefined {
  const outcomePending = outcome === 'pending';
  const finishPending = finished.value === 'pending';
  if (outcomePending && !finishPending) {
    return (
      `${name} has "Outcome: pending" but "Finished at: ${finished.value}" (line ${finished.line}). ` +
      `A dispatch that has not returned has "Finished at: pending"; fill both when it returns.`
    );
  }
  if (!outcomePending && finishPending) {
    return (
      `${name} has "Outcome: ${outcome ?? '(missing)'}" but "Finished at: pending" (line ${finished.line}). ` +
      `Run ${CLOCK_COMMAND} when the dispatch returns and write that.`
    );
  }
  return undefined;
}

/** The finish-side rules: Finished at agrees with Outcome, and is not before the dispatch. */
function finishProblems(
  name: string,
  entry: LedgerEntry,
  dispatched: { field: RunField; at: number } | undefined,
  clock: Clock,
  out: string[],
): void {
  const finished = runField(entry, 'Finished at');
  if (!finished) {
    out.push(
      `${name} (line ${entry.line}) has no "- Finished at:" field. Add "- Finished at: pending" ` +
        `while it runs, and a ${CLOCK_COMMAND} read once it returns.`,
    );
    return;
  }
  const outcome = runField(entry, 'Outcome')?.value.split(/\s/)[0];
  const mismatch = pendingMismatch(name, outcome, finished);
  if (mismatch) {
    out.push(mismatch);
    return;
  }
  if (outcome === 'pending') return;
  const at = readClock(name, 'Finished at', finished, clock, out);
  if (at !== undefined && dispatched && at < dispatched.at) {
    out.push(
      `${name} Finished at ${finished.value} is earlier than its Dispatched at ` +
        `${dispatched.field.value}. A dispatch cannot return before it was sent; replace the ` +
        `finish time with the real one.`,
    );
  }
}

/** The dispatch-side rules; returns the dispatch time for the ordering check. */
function dispatchProblems(
  name: string,
  entry: LedgerEntry,
  clock: Clock,
  out: string[],
): { field: RunField; at: number } | undefined {
  const field = runField(entry, 'Dispatched at');
  if (!field) {
    out.push(`${name} (line ${entry.line}) has no "- Dispatched at:" field. Add the ${CLOCK_COMMAND} read taken before it was launched.`);
    return undefined;
  }
  const at = readClock(name, 'Dispatched at', field, clock, out);
  return at === undefined ? undefined : { field, at };
}

/**
 * Checks one chunk's run log (`run-log/<slug>.md`, named by `ledger`). `commitTimeOfLine(n)` returns the committer time (epoch seconds) of
 * the commit that recorded line `n`, or null when that line is not committed yet; such a line is
 * held to `nowSeconds` instead. A clock read taken when the line was written can never be later
 * than the commit that recorded it.
 */
export function checkRunLog(
  text: string,
  ledger: string,
  commitTimeOfLine: (line: number) => number | null,
  nowSeconds: number,
): LedgerFinding[] {
  const entries = parseLedgerEntries(text, 'Dispatch');
  const findings = duplicateFindings(groupByNumber(entries), 'Dispatch', ledger);
  const clock: Clock = { commitTimeOfLine, nowSeconds };
  let previous: { number: number; at: number } | undefined;

  for (const entry of entries) {
    const name = `Dispatch ${entry.number}`;
    const out: string[] = [];
    const dispatched = dispatchProblems(name, entry, clock, out);
    if (dispatched && previous && dispatched.at < previous.at) {
      out.push(
        `${name} Dispatched at ${dispatched.field.value} is earlier than Dispatch ${previous.number}, ` +
          `which was logged before it. The log is append-only, so dispatch times only move forward.`,
      );
    }
    if (dispatched) previous = { number: entry.number, at: dispatched.at };
    finishProblems(name, entry, dispatched, clock, out);
    findings.push(...out.map((detail) => ({ ledger, entry: name, kind: 'run-timestamp' as const, detail })));
  }
  return findings;
}

/** True in a repository's main checkout; false in a linked worktree (`git worktree add`). */
async function isMainCheckout(projectDir: string): Promise<boolean> {
  const [gitDir, commonDir] = (await git(projectDir, ['rev-parse', '--git-dir', '--git-common-dir'])).trim().split('\n');
  return pathResolve(projectDir, gitDir) === pathResolve(projectDir, commonDir);
}

/**
 * A provisional id (`Ruling @<slug>.<n>`) is written on a chunk's parallel branch, in its own
 * worktree, and `boardsmith chunk-merge` turns it into a real number as it lands (#294). One in the
 * main checkout means a branch was merged some other way, skipping the allocation and every
 * combined-tree check that goes with it.
 */
async function provisionalOnMainLine(projectDir: string): Promise<LedgerFinding[]> {
  const found: LedgerFinding[] = [];
  for (const spec of NUMBERED_LEDGER_SPECS) {
    const text = await readLedger(projectDir, spec.file);
    for (const id of text === undefined ? [] : provisionalHeadings(text, spec)) {
      found.push({
        ledger: spec.file,
        entry: id,
        kind: 'provisional-on-main-line',
        detail:
          `${id} is a provisional id, which only a chunk's own worktree may hold; it reached the main ` +
          `checkout without \`boardsmith chunk-merge\`, so no real number was allocated and the ` +
          `combined tree was never checked. Give it the next unused number, update every citation of ` +
          `it, and run \`boardsmith ledger-check\` and \`boardsmith constraint-check\` on this tree.`,
      });
    }
  }
  if (found.length === 0) return [];
  await requireGitRepo(projectDir, 'tells a chunk worktree, where provisional ids belong, from the main checkout');
  return (await isMainCheckout(projectDir)) ? found : [];
}

/**
 * RUN.md holds only run-level lines (#294). A dispatch entry there is a log two chunks built at
 * once would both append to, which is how sotf's run log came to carry conflicting times.
 */
function misplacedRunLog(text: string): LedgerFinding[] {
  const entries = parseLedgerEntries(text, 'Dispatch');
  if (entries.length === 0) return [];
  return [
    {
      ledger: RUN_MD,
      entry: `Dispatch ${entries[0].number}`,
      kind: 'run-log-misplaced',
      detail:
        `RUN.md holds ${entries.length} dispatch entr${entries.length === 1 ? 'y' : 'ies'}, starting at ` +
        `line ${entries[0].line}. Each chunk's dispatches belong in its own ` +
        `${DESIGN_DIR}/${RUN_LOG_DIR}/<slug>.md, so chunks built at the same time never write one ` +
        `file. Move each entry into the file for the chunk it dispatched, numbered from 1 there.`,
    },
  ];
}

/** Every chunk run log, design-relative (`run-log/<slug>.md`), sorted. */
async function runLogFiles(projectDir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(designPath(projectDir, RUN_LOG_DIR));
    return names.filter((n) => n.endsWith('.md')).sort().map((n) => `${RUN_LOG_DIR}/${n}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Git: the commit time of each line of a run log
// ---------------------------------------------------------------------------------------------

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout.toString());
    });
  });
}

const UNCOMMITTED = /^0{40}$/;

async function requireGitRepo(projectDir: string, why: string): Promise<void> {
  try {
    await git(projectDir, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error(
      `${projectDir} is not a git repository (or git is not installed).\n` +
        `ledger-check ${why}, so it needs the game's git history. Run it from inside the game ` +
        `project, or pass --project <dir>.`,
    );
  }
}

/** The subset of `relPaths` that git tracks, in one `ls-files` for all of them. */
async function trackedFiles(projectDir: string, relPaths: string[]): Promise<Set<string>> {
  if (relPaths.length === 0) return new Set();
  const listed = await git(projectDir, ['--literal-pathspecs', 'ls-files', '-z', '--', ...relPaths]);
  return new Set(listed.split('\0').filter(Boolean));
}

/** The commit that recorded a line: its hash and its committer time in epoch seconds. */
interface LineCommit {
  sha: string;
  time: number;
}

/**
 * The commit that recorded each line of the tracked file `relPath`, indexed by 1-based line
 * number; null for a line not committed yet.
 */
async function lineCommits(projectDir: string, relPath: string): Promise<Array<LineCommit | null>> {
  const porcelain = await git(projectDir, ['blame', '--line-porcelain', '--', relPath]);
  const commits: Array<LineCommit | null> = [];
  let sha = '';
  let finalLine = 0;
  let time = 0;
  for (const line of porcelain.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (header) {
      sha = header[1];
      finalLine = Number(header[2]);
    } else if (line.startsWith('committer-time ')) {
      time = Number(line.slice('committer-time '.length));
    } else if (line.startsWith('\t')) {
      commits[finalLine] = UNCOMMITTED.test(sha) ? null : { sha, time };
    }
  }
  return commits;
}

// ---------------------------------------------------------------------------------------------
// Cited evidence (#292): every script or capture a design record cites is in git
// ---------------------------------------------------------------------------------------------

/** A design record whose citations are checked, named design-relative as in every message. */
interface EvidenceSource {
  file: string;
  text: string;
}

type EvidenceProblem = 'outside' | 'missing' | 'ignored' | 'untracked' | 'not-in-boardsmith';

const SCRATCH_DIR = '.boardsmith/scratch/';
const MOVE_TO_EVIDENCE =
  `Move it into ${CHUNK_EVIDENCE_DIR} for the chunk it proves, commit it, and cite that path.`;

function evidenceDetail(path: string, rel: string | undefined, problem: EvidenceProblem): string {
  switch (problem) {
    case 'outside':
      return `Cites ${path}, which is outside the project, so it is in no commit. ${MOVE_TO_EVIDENCE}`;
    case 'missing':
      return `Cites ${path}, which does not exist and was not in git when this line was committed. Commit the file it names, or correct the citation to the file that was really used.`;
    case 'ignored':
      return `Cites ${path}, which is gitignored, so it was never committed (${SCRATCH_DIR} is for throwaway scripts only). ${MOVE_TO_EVIDENCE}`;
    case 'untracked':
      return `Cites ${path}, which exists but is not in git. Run \`git add ${rel}\` and commit it.`;
    case 'not-in-boardsmith':
      return (
        `Cites ${path}, but the installed BoardSmith (${INSTALLED_BOARDSMITH_DIR}) has no ` +
        `${installedBoardSmithPath(rel ?? '')}. Correct the citation to the file as this project's ` +
        'BoardSmith has it, or run `npm install` if the package is missing.'
      );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isIgnored(projectDir: string, rel: string): Promise<boolean> {
  try {
    await git(projectDir, ['check-ignore', '-q', '--', rel]);
    return true;
  } catch {
    return false;
  }
}

/** Whether `rel` (project-relative) was a tracked file in commit `sha`. */
async function trackedAt(projectDir: string, sha: string, rel: string): Promise<boolean> {
  try {
    await git(projectDir, ['cat-file', '-e', `${sha}:./${rel}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * What is wrong with one citation, if anything. A file that is gone now but was in git at the
 * commit that recorded the citing line is not a problem: the design records are append-only, so
 * an entry that cited a file deleted on purpose later stays as it was written (#398).
 */
async function problemOf(
  projectDir: string,
  rel: string | undefined,
  tracked: Set<string>,
  citingCommit: () => Promise<string | null>,
): Promise<EvidenceProblem | undefined> {
  if (rel === undefined) return 'outside';
  if (installedBoardSmithPath(rel) !== undefined) {
    return (await fileExists(pathJoin(projectDir, rel))) ? undefined : 'not-in-boardsmith';
  }
  if (!(await fileExists(pathJoin(projectDir, rel)))) {
    const sha = await citingCommit();
    return sha !== null && (await trackedAt(projectDir, sha, rel)) ? undefined : 'missing';
  }
  if (tracked.has(rel)) return undefined;
  return (await isIgnored(projectDir, rel)) ? 'ignored' : 'untracked';
}

/** The copy of a cited file whose lines a citation is held to, and how a message names it. */
interface CitedCopy {
  key: string;
  text: () => Promise<string>;
  /** How the copy is named in a message that gives its line count. */
  hasLines: (count: number) => string;
}

/**
 * The copy of `rel` the citing line was written against: the file as it was in the commit that
 * recorded that line, or, when that line is not committed yet or its commit did not have the file
 * (it was committed later), the file as it is now, which is the copy the rest of this check
 * accepts. A file of the installed BoardSmith is in no commit of the game, so it is the package
 * as installed, the copy `claim-quote-check` reads (#432).
 */
async function citedCopy(projectDir: string, rel: string, citingCommit: () => Promise<string | null>): Promise<CitedCopy> {
  const now = { key: `:${rel}`, text: () => fs.readFile(pathJoin(projectDir, rel), 'utf-8') };
  const library = installedBoardSmithPath(rel);
  if (library !== undefined) return { ...now, hasLines: (n) => `the installed BoardSmith's ${library} has ${n} lines` };
  const sha = await citingCommit();
  if (sha !== null && (await trackedAt(projectDir, sha, rel))) {
    return {
      key: `${sha}:${rel}`,
      text: () => git(projectDir, ['show', `${sha}:./${rel}`]),
      hasLines: (n) => `${rel} had ${n} lines when this line was committed`,
    };
  }
  return { ...now, hasLines: (n) => `${rel} has ${n} lines` };
}

/** What is wrong with the lines a citation names, if anything (#414), read in `citedCopy`. */
async function citedLinesProblem(
  projectDir: string,
  written: string,
  rel: string,
  range: LineRange,
  citingCommit: () => Promise<string | null>,
  lineCounts: Map<string, Promise<number>>,
): Promise<string | undefined> {
  const copy = await citedCopy(projectDir, rel, citingCommit);
  if (!lineCounts.has(copy.key)) lineCounts.set(copy.key, copy.text().then((t) => fileLines(t).length));
  const count = await lineCounts.get(copy.key)!;
  switch (lineRangeProblem(range, count)) {
    case undefined:
      return undefined;
    case 'invalid':
      return `Cites ${written}, which is not a line range. ${LINE_LOCATION_HINT}`;
    case 'past-end':
      return (
        `Cites ${written}, line ${range[1]}, but ${copy.hasLines(count)}. ` +
        'Correct the citation to the lines that were meant.'
      );
  }
}

/** The citation as a location, `path:N` or `path:N-M`, for messages. */
function writtenLocation(path: string, [from, to]: LineRange): string {
  return from === to ? `${path}:${from}` : `${path}:${from}-${to}`;
}

/**
 * One finding per cited script or capture that is not a committed file in the project, and one
 * per citation of lines that file does not have (#414).
 */
async function checkCitedEvidence(projectDir: string, sources: EvidenceSource[]): Promise<LedgerFinding[]> {
  const cited = sources.flatMap((source) =>
    citedEvidencePaths(source.text).map((c) => ({ ...c, file: source.file, rel: designRecordPath(projectDir, c.path) })),
  );
  if (cited.length === 0) return [];
  await requireGitRepo(projectDir, 'checks that every script and capture the design records cite is committed');
  const rels = [...new Set(cited.flatMap((c) => (c.rel === undefined ? [] : [c.rel])))];
  const tracked = await trackedFiles(projectDir, rels);

  // Blamed only when a cited file is missing or lines of it are cited, and at most once per design record.
  const trackedSources = await trackedFiles(projectDir, sources.map((source) => `${DESIGN_DIR}/${source.file}`));
  const blames = new Map<string, Promise<Array<LineCommit | null>>>();
  const commitOfLine = async (file: string, line: number): Promise<string | null> => {
    const rel = `${DESIGN_DIR}/${file}`;
    if (!trackedSources.has(rel)) return null;
    if (!blames.has(rel)) blames.set(rel, lineCommits(projectDir, rel));
    return (await blames.get(rel)!)[line]?.sha ?? null;
  };

  const lineCounts = new Map<string, Promise<number>>();
  const findings: LedgerFinding[] = [];
  for (const c of cited) {
    const citingCommit = () => commitOfLine(c.file, c.line);
    const problem = await problemOf(projectDir, c.rel, tracked, citingCommit);
    if (problem) {
      findings.push({
        ledger: c.file,
        entry: `line ${c.line}`,
        kind: 'evidence-not-committed',
        detail: evidenceDetail(c.path, c.rel, problem),
      });
      continue;
    }
    if (!c.lines || c.rel === undefined) continue;
    const written = writtenLocation(c.path, c.lines);
    const detail = await citedLinesProblem(projectDir, written, c.rel, c.lines, citingCommit, lineCounts);
    if (detail) findings.push({ ledger: c.file, entry: `line ${c.line}`, kind: 'cited-lines-missing', detail });
  }
  return findings;
}

const VERIFIED_STATUS = /^Status:[ \t]*verified(?: \(user-waived\))?[ \t]*$/m;

/** Every chunk whose CHUNK.md says it is verified: the ones whose evidence must already be in git. */
async function verifiedChunks(projectDir: string): Promise<EvidenceSource[]> {
  const sources: EvidenceSource[] = [];
  for (const slug of await chunkSlugs(projectDir)) {
    const text = await readLedger(projectDir, relChunkMdPath(slug));
    if (text !== undefined && VERIFIED_STATUS.test(text)) sources.push({ file: relChunkMdPath(slug), text });
  }
  return sources;
}

// ---------------------------------------------------------------------------------------------
// The whole project
// ---------------------------------------------------------------------------------------------

async function readLedger(projectDir: string, file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(designPath(projectDir, file), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Runs every ledger rule against `projectDir`'s `design/` as it stands on disk. `checked` lists
 * the ledgers read, then each verified CHUNK.md whose cited evidence was checked.
 */
export async function ledgerCheck(projectDir: string): Promise<LedgerCheckResult> {
  const result: LedgerCheckResult = { checked: [], absent: [], findings: [] };
  // FILINGS.md is not an evidence source: a filing cites BoardSmith's own files, not the game's.
  const evidence: EvidenceSource[] = [];

  for (const { file, kind } of NUMBERED_LEDGERS) {
    const text = await readLedger(projectDir, file);
    if (text === undefined) {
      result.absent.push(file);
      continue;
    }
    result.checked.push(file);
    result.findings.push(...checkNumberedLedger(text, kind, file));
    if (file === FILINGS_MD) result.findings.push(...checkFilingStatus(text));
    else evidence.push({ file, text });
  }

  result.findings.push(...(await provisionalOnMainLine(projectDir)));

  const run = await readLedger(projectDir, RUN_MD);
  if (run === undefined) {
    result.absent.push(RUN_MD);
  } else {
    result.checked.push(RUN_MD);
    result.findings.push(...misplacedRunLog(run));
  }

  const logs = await runLogFiles(projectDir);
  if (logs.length > 0) {
    await requireGitRepo(projectDir, 'compares each run log\'s timestamps against the commits that recorded them');
  }
  // An untracked run log has no commit times: every line of it reads as not committed yet.
  const trackedLogs = await trackedFiles(projectDir, logs.map((log) => `${DESIGN_DIR}/${log}`));
  for (const log of logs) {
    const text = (await readLedger(projectDir, log))!;
    result.checked.push(log);
    const rel = `${DESIGN_DIR}/${log}`;
    const commits = trackedLogs.has(rel) ? await lineCommits(projectDir, rel) : [];
    result.findings.push(...checkRunLog(text, log, (line) => commits[line]?.time ?? null, Math.floor(Date.now() / 1000)));
  }

  const crossChunk = await readLedger(projectDir, CROSS_CHUNK_MD);
  if (crossChunk === undefined) {
    result.absent.push(CROSS_CHUNK_MD);
  } else {
    result.checked.push(CROSS_CHUNK_MD);
    const slugs = await chunkSlugs(projectDir);
    result.findings.push(
      ...checkCrossChunkLedger(crossChunk, slugs).map((p) => ({
        ledger: CROSS_CHUNK_MD,
        kind: 'cross-chunk-unreviewed' as const,
        ...p,
      })),
    );
  }

  const chunks = await verifiedChunks(projectDir);
  result.checked.push(...chunks.map((c) => c.file));
  result.findings.push(...(await checkCitedEvidence(projectDir, [...evidence, ...chunks])));
  return result;
}

/**
 * `boardsmith ledger-check [--project <dir>] [--json]`. Exits non-zero when any finding is
 * reported, so a skill step that runs it cannot pass over a broken ledger without noticing.
 */
export async function ledgerCheckCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  const projectDir = pathResolve(options.project ?? process.cwd());
  const result = await ledgerCheck(projectDir);
  if (result.findings.length > 0) process.exitCode = 1;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.checked.length === 0) {
    console.log(`No ledgers in ${DESIGN_DIR}/ yet, so there is nothing to check.`);
    return;
  }
  if (result.findings.length === 0) {
    console.log(`Ledgers consistent: ${result.checked.join(', ')}.`);
    return;
  }
  console.log(`Ledger check found ${result.findings.length} problem(s). Fix each one, then run \`boardsmith ledger-check\` again:`);
  for (const f of result.findings) {
    console.log(`  ${DESIGN_DIR}/${f.ledger}, ${f.entry}: ${f.detail}`);
  }
}
