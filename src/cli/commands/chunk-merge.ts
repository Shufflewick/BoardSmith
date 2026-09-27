/**
 * `boardsmith chunk-merge <slug>` (#294): the one way a chunk built on its own branch reaches the
 * main line, and the gate that merge passes through.
 *
 * WHY THIS IS CODE AND NOT SKILL TEXT
 *
 * The sotf run built independent chunks at the same time, in separate worktrees, and merged them
 * by hand. Each branch passed its own checks, and the combined tree was never checked: two
 * branches took the same next ruling number (sotf#32), each chunk measured only its own growth in
 * a shared partition and nobody measured the total (sotf#24, #25), and chunks that referenced each
 * other's state were never reviewed together. That run was driven by a harness that does not
 * follow skill prose exactly, so the rules live here, and a merge that skips them is not possible
 * by running this command:
 *
 *   1. Merges are serial: a lock in the git directory refuses a second merge while one runs.
 *   2. A branch may not add a real ledger number (it writes `Ruling @<slug>.<n>`), may not write
 *      RUN.md, and may not write another chunk's run log. Real numbers are allocated here, on the
 *      combined tree, and every citation of each provisional id is rewritten.
 *   3. On the combined tree, before anything is committed, it re-runs every tree-wide check:
 *      the chunk is verified; the chunks really built alongside it were allowed to be (the
 *      `parallel-check` pair rule); `ledger-check`; `constraint-check` with its measurement tests;
 *      every verified chunk's sign-off still stands for its code (`assessSignoffs`); and the
 *      project's whole test suite.
 *      Any failure aborts the merge and leaves the main line exactly as it was.
 *   3a. A source file this branch and the main line both edited since the branch left (#403) is
 *      code no designer signed off: each chunk's sign-off saw only its own side. The merge vouches
 *      for it by re-running the own checks of every chunk involved (this one and those built
 *      alongside it whose Build Manifest names the file) on the combined tree: their tests,
 *      `chunk-check` and `claim-quote-check`. If all pass, it records the file, its content hash,
 *      those chunks and the merge in design/MERGE-SIGNOFFS.md, which the sign-off check accepts;
 *      if any fails, the merge is refused naming the check and the chunk. No designer is asked.
 *      A source file whose provisional ledger ids step 2 rewrote is code the merge itself changed
 *      after its chunks signed it off, so it is vouched for the same way (#435).
 *   4. It lists every reference between the merged chunk's changes and what the main line gained
 *      while it was being built, in design/CROSS-CHUNK.md, pending the audit's ruling;
 *      `ledger-check` fails until the audit rules, so the next close and merge wait for it.
 *
 * Conflicts in design documents that are only two appends at the same place, or the session lock
 * line, are resolved here (keep both; keep the main line's lock). Any other conflict aborts the
 * merge: merge the main line into the chunk's branch in its own worktree, resolve it there, re-run
 * the chunk's tests, and run this again.
 */
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, posix, resolve } from 'node:path';
import chalk from 'chalk';
import { createHash } from 'node:crypto';
import {
  CROSS_CHUNK_MD,
  DESIGN_DIR,
  MERGE_SIGNOFFS_MD,
  RUN_LOG_DIR,
  RUN_MD,
  SKETCH_MD,
  chunkMdPath,
  designPath,
} from '../lib/project-paths.js';
import { type MergeSignoff, appendMergeSignoffs } from '../lib/merge-signoffs.js';
import { assertBareName } from '../lib/user-name.js';
import {
  NUMBERED_LEDGER_SPECS,
  allocateProvisional,
  plainNumbersAdded,
  provisionalReferences,
} from '../lib/ledger-allocation.js';
import { ledgerCheck } from './ledger-check.js';
import { type TestRunner, checkConstraints, runVitest } from './constraint-check.js';
import { assessSignoffs, checkSignoff, chunkCodeFiles } from './chunk-signoff.js';
import { verifiedAgainstIsCurrent } from './chunk-provenance.js';
import { checkClaimQuotes } from './claim-quotes.js';
import { parseSpecManifest } from './test-step-check.js';
import { chunkCitations, pairProblems, readSketchChunks } from './parallel-check.js';
import { appendCrossChunkEntry, changedSide, crossReferences } from './cross-chunk.js';

interface ChunkMergeOptions {
  /** The chunk's branch. Defaults to `chunk/<slug>`, the branch the dispatch contract names. */
  branch?: string;
  /** Runs the measurement tests and the whole suite. Defaults to the project's own vitest. */
  runTests?: TestRunner;
}

interface ChunkMergeResult {
  merged: boolean;
  /** Every reason the merge was refused, as sentences to act on. Empty when it merged. */
  refusals: string[];
  /** Each provisional id and the real id it was given, e.g. `{ 'Ruling @a.1': 'Ruling 12' }`. */
  allocated: Record<string, string>;
  /** The chunks the main line gained while this branch was being built. */
  alongside: string[];
  /** `pending` when references were recorded for the audit, `none` when nothing was shared. */
  crossChunk: 'pending' | 'none' | 'not built alongside';
  /** Source files the merge vouched for (#403, #435), each with its chunks and why it needed to. */
  vouched: SharedFile[];
}

interface GitResult {
  code: number;
  out: string;
}

function run(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((done) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      done({ code, out: code === 0 ? stdout.toString() : `${stdout}${stderr}` });
    });
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await run(cwd, args);
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.out.trim()}`);
  return result.out;
}

/** The merge's fixed facts, read once. Paths in git are repository-relative; `prefix` makes them. */
interface MergeContext {
  projectDir: string;
  /** The repository's top level; pathspecs are given from here. */
  top: string;
  /** The git directory every worktree shares, where the merge lock lives. */
  common: string;
  slug: string;
  branch: string;
  /** The project's path inside its repository, `''` or ending in `/`. */
  prefix: string;
  /** The merge base of the main line and the branch. */
  base: string;
  /** Where the branch first left the main line, even if the main line was merged into it since. */
  fork: string;
  /** Every repository-relative path the branch changed since `base`, read once for every check. */
  changed: string[];
}

const refused = (refusals: string[]): ChunkMergeResult => ({
  merged: false,
  refusals,
  allocated: {},
  alongside: [],
  crossChunk: 'not built alongside',
  vouched: [],
});

async function showAt(ctx: MergeContext, rev: string, designRel: string): Promise<string> {
  const result = await run(ctx.projectDir, ['show', `${rev}:${ctx.prefix}${DESIGN_DIR}/${designRel}`]);
  return result.code === 0 ? result.out : '';
}

// ---------------------------------------------------------------------------------------------
// Before merging: what a branch may and may not carry
// ---------------------------------------------------------------------------------------------

async function realNumbersAdded(ctx: MergeContext): Promise<string[]> {
  const refusals: string[] = [];
  // A ledger the branch did not change cannot have gained a number on it.
  for (const spec of NUMBERED_LEDGER_SPECS.filter((s) => ctx.changed.includes(`${ctx.prefix}${DESIGN_DIR}/${s.file}`))) {
    const added = plainNumbersAdded(await showAt(ctx, ctx.base, spec.file), await showAt(ctx, ctx.branch, spec.file), spec);
    for (const id of added) {
      refusals.push(
        `${ctx.branch} adds ${id} to ${DESIGN_DIR}/${spec.file}. A chunk built alongside others never takes ` +
          `a real number, because another branch can take the same one. Renumber it on the branch as ` +
          `${spec.kind}${spec.sep}@${ctx.slug}.1 (then .2, ...), update its citations, commit, and merge again; ` +
          `this command allocates the real number.`,
      );
    }
  }
  return refusals;
}

function sharedRunFiles(ctx: MergeContext): string[] {
  const design = `${ctx.prefix}${DESIGN_DIR}/`;
  const own = `${design}${RUN_LOG_DIR}/${ctx.slug}.md`;
  const mainLineOnly = [`${design}${RUN_MD}`, `${design}${MERGE_SIGNOFFS_MD}`];
  return ctx.changed
    .filter((name) => (mainLineOnly.includes(name) || name.startsWith(`${design}${RUN_LOG_DIR}/`)) && name !== own)
    .map(
      (name) =>
        `${ctx.branch} changes ${name.slice(ctx.prefix.length)}. A chunk's branch writes only its own run log, ` +
        `${DESIGN_DIR}/${RUN_LOG_DIR}/${ctx.slug}.md; ${RUN_MD}, ${MERGE_SIGNOFFS_MD} and other chunks' logs ` +
        `belong to the main line. Undo that change on the branch and merge again.`,
    );
}

// ---------------------------------------------------------------------------------------------
// Merging: the conflicts design documents are allowed to have
// ---------------------------------------------------------------------------------------------

const CONFLICT = /^<<<<<<< [^\n]*\n([\s\S]*?)^\|\|\|\|\|\|\| [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*\n/gm;
const LOCK_ONLY = (block: string) => block.split('\n').every((line) => line === '' || line.startsWith('Session Lock:'));

/**
 * Resolves the two conflicts a design document is expected to have when chunks are built at
 * once, given diff3 conflict markers: both sides appended at the same place (keep both, main
 * line first), and the session lock line (keep the main line's; the run there holds the lock).
 * Every other conflict is left in place and counted.
 */
export function resolveDesignConflicts(text: string): { text: string; unresolved: number } {
  let unresolved = 0;
  const resolved = text.replace(CONFLICT, (whole, ours: string, base: string, theirs: string) => {
    if (LOCK_ONLY(ours) && LOCK_ONLY(base) && LOCK_ONLY(theirs)) return ours;
    if (base === '') return ours + theirs;
    unresolved++;
    return whole;
  });
  return { text: resolved, unresolved };
}

async function resolveConflicts(ctx: MergeContext): Promise<string[]> {
  const top = ctx.top;
  const conflicted = (await git(top, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
  const left: string[] = [];
  for (const name of conflicted) {
    const inDesign = name.startsWith(`${ctx.prefix}${DESIGN_DIR}/`) && name.endsWith('.md');
    const path = join(top, name);
    const outcome = inDesign ? resolveDesignConflicts(await fs.readFile(path, 'utf-8')) : undefined;
    if (!outcome || outcome.unresolved > 0) {
      left.push(name);
      continue;
    }
    await fs.writeFile(path, outcome.text);
    await git(top, ['add', '--', name]);
  }
  return left;
}

/** The main line's run holds the session lock; a branch's close released only its own copy. */
async function keepMainLock(ctx: MergeContext): Promise<void> {
  const lock = /^Session Lock:.*$/m.exec(await showAt(ctx, 'HEAD', SKETCH_MD))?.[0];
  const path = designPath(ctx.projectDir, SKETCH_MD);
  const sketch = await fs.readFile(path, 'utf-8').catch(() => undefined);
  if (lock === undefined || sketch === undefined) return;
  const kept = sketch.replace(/^Session Lock:.*$/m, lock);
  if (kept === sketch) return;
  await fs.writeFile(path, kept);
  await git(ctx.projectDir, ['add', '--', path]);
}

// ---------------------------------------------------------------------------------------------
// Allocation: provisional ids become real numbers on the combined tree
// ---------------------------------------------------------------------------------------------

async function readText(path: string): Promise<string | undefined> {
  const buffer = await fs.readFile(path).catch(() => undefined);
  if (buffer === undefined || buffer.includes(0)) return undefined;
  return buffer.toString('utf-8');
}

/**
 * Gives every provisional id a real number on the combined tree and rewrites its citations.
 * `renumbered` is each source file (outside design/, project-relative) whose text that changed.
 */
async function allocate(
  ctx: MergeContext,
): Promise<{ allocated: Record<string, string>; refusals: string[]; renumbered: string[] }> {
  const top = ctx.top;
  const ledgers = NUMBERED_LEDGER_SPECS.map((spec) => ({ spec, path: `${ctx.prefix}${DESIGN_DIR}/${spec.file}` }));
  const files: Record<string, string> = {};
  for (const name of new Set([...ctx.changed, ...ledgers.map((l) => l.path)])) {
    const text = await readText(join(top, name));
    if (text !== undefined) files[name] = text;
  }
  const { files: rewritten, mapping } = allocateProvisional(files, ledgers);
  const refusals: string[] = [];
  const renumbered: string[] = [];
  const design = `${ctx.prefix}${DESIGN_DIR}/`;
  for (const [name, text] of Object.entries(rewritten)) {
    if (text !== files[name]) {
      await fs.writeFile(join(top, name), text);
      await git(top, ['add', '--', name]);
      if (name.startsWith(ctx.prefix) && !name.startsWith(design)) renumbered.push(name.slice(ctx.prefix.length));
    }
    for (const id of provisionalReferences(text)) {
      refusals.push(`${name} cites ${id}, but no ledger entry is headed ${id}. Correct the citation on the branch.`);
    }
  }
  return { allocated: mapping, refusals, renumbered };
}

// ---------------------------------------------------------------------------------------------
// The combined tree: every tree-wide check, run again
// ---------------------------------------------------------------------------------------------

/** The chunks whose design files the main line changed after this branch left it. */
async function builtAlongside(ctx: MergeContext): Promise<string[]> {
  const design = `${ctx.prefix}${DESIGN_DIR}/`;
  const names = await git(ctx.top, ['diff', '--name-only', ctx.fork, 'HEAD', '--', `${design}chunks/`, `${design}${RUN_LOG_DIR}/`]);
  const slugs = names
    .split('\n')
    .map((name) => new RegExp(`^${design}(?:chunks/([^/]+)/|${RUN_LOG_DIR}/([^/]+)\\.md$)`).exec(name))
    .map((m) => m?.[1] ?? m?.[2])
    .filter((s): s is string => s !== undefined && s !== ctx.slug);
  return [...new Set(slugs)].sort();
}

async function verifiedProblem(ctx: MergeContext): Promise<string[]> {
  const text = await fs.readFile(chunkMdPath(ctx.projectDir, ctx.slug), 'utf-8').catch(() => '');
  const status = /^Status:\s*(.*)$/m.exec(text)?.[1].trim() ?? 'missing';
  if (status.startsWith('verified')) return [];
  return [
    `${ctx.slug} is "${status}", not verified. A chunk's branch is merged once the chunk has closed; ` +
      `finish it on its branch first.`,
  ];
}

async function concurrencyProblems(ctx: MergeContext, alongside: string[]): Promise<string[]> {
  if (alongside.length === 0) return [];
  const chunks = await readSketchChunks(ctx.projectDir);
  const bySlug = new Map(chunks.map((c) => [c.slug, c]));
  const self = bySlug.get(ctx.slug);
  if (!self) return [`${SKETCH_MD} has no entry for ${ctx.slug}.`];
  const mine = await chunkCitations(ctx.projectDir, self);
  const problems: string[] = [];
  for (const other of alongside) {
    const chunk = bySlug.get(other);
    if (chunk) problems.push(...pairProblems(chunks, mine, await chunkCitations(ctx.projectDir, chunk)));
  }
  return problems;
}

async function signoffProblems(projectDir: string): Promise<string[]> {
  return [...(await assessSignoffs(projectDir)).values()].flatMap((a) => a.problems);
}

const tail = (output: string) => output.trimEnd().split('\n').slice(-25).join('\n');

/** Every tree-wide check on the combined tree. The whole suite runs last, only if the rest pass. */
async function combinedTreeProblems(ctx: MergeContext, alongside: string[], runTests: TestRunner): Promise<string[]> {
  const ledgers = await ledgerCheck(ctx.projectDir);
  const problems = [
    ...(await verifiedProblem(ctx)),
    ...(await concurrencyProblems(ctx, alongside)),
    ...ledgers.findings.map((f) => `${DESIGN_DIR}/${f.ledger}, ${f.entry}: ${f.detail}`),
    ...(await checkConstraints(ctx.projectDir, { runTests })).refusals,
    ...(await signoffProblems(ctx.projectDir)),
  ];
  if (problems.length > 0) return problems;
  const suite = await runTests(ctx.projectDir, []);
  if ('refused' in suite) return [suite.refused];
  return suite.ok ? [] : [`The project's test suite fails on the combined tree:\n${tail(suite.output)}`];
}

// ---------------------------------------------------------------------------------------------
// A source file the merge changed after its chunks signed it off: the merge vouches for it
// ---------------------------------------------------------------------------------------------

/**
 * A source file the combined tree has in a form no chunk signed off, the chunks involved whose
 * Build Manifest names it, and why: both sides edited it (#403), or the merge rewrote its
 * provisional ledger citations to real numbers (#435).
 */
interface SharedFile {
  path: string;
  chunks: string[];
  why: 'both-edited' | 'renumbered';
}

async function manifestPaths(projectDir: string, slug: string): Promise<Set<string>> {
  const text = await fs.readFile(chunkMdPath(projectDir, slug), 'utf-8').catch(() => undefined);
  if (text === undefined) return new Set();
  return new Set(Object.keys(await chunkCodeFiles(projectDir, text)).map((p) => posix.normalize(p)));
}

/**
 * Each source file (outside design/) that the branch changed and the main line also changed after
 * the branch left it, then each one the allocation renumbered, with the chunks, this one or one
 * built alongside it, whose Build Manifest names it. A file no such chunk names has no sign-off
 * for the merge to vouch for.
 */
async function sharedSourceFiles(ctx: MergeContext, alongside: string[], renumbered: string[]): Promise<SharedFile[]> {
  const mainChanged = new Set((await git(ctx.top, ['diff', '--name-only', ctx.fork, 'HEAD'])).split('\n'));
  const design = `${ctx.prefix}${DESIGN_DIR}/`;
  const both = ctx.changed
    .filter((name) => mainChanged.has(name) && name.startsWith(ctx.prefix) && !name.startsWith(design))
    .map((name) => name.slice(ctx.prefix.length));
  const files = [
    ...both.map((path) => ({ path, why: 'both-edited' as const })),
    ...renumbered.filter((path) => !both.includes(path)).map((path) => ({ path, why: 'renumbered' as const })),
  ];
  if (files.length === 0) return [];
  const manifests: Array<[string, Set<string>]> = [];
  for (const slug of [ctx.slug, ...alongside]) manifests.push([slug, await manifestPaths(ctx.projectDir, slug)]);
  return files
    .map((file) => ({ ...file, chunks: manifests.filter(([, paths]) => paths.has(file.path)).map(([slug]) => slug).sort() }))
    .filter((file) => file.chunks.length > 0);
}

/** Why the merge had to vouch for `file`, as a clause after its path. */
function vouchReason(ctx: MergeContext, file: SharedFile): string {
  return file.why === 'both-edited'
    ? `which ${ctx.branch} and the main line both edited`
    : `whose provisional ledger citations this merge renumbered`;
}

/** The test files a chunk's Spec Manifest lists, or the sentence that says why there are none to run. */
function ownTestFiles(chunkText: string): string[] | string {
  try {
    return parseSpecManifest(chunkText).rows.map((row) => row.testFile);
  } catch (error) {
    return (error as Error).message.split('\n')[0];
  }
}

/**
 * What fails when one chunk's own checks run on the combined tree, each as `[what failed, why]`,
 * where `what failed` names the check and the chunk ("claim-quote-check fails for trading").
 */
async function ownCheckFailures(projectDir: string, slug: string, runTests: TestRunner): Promise<Array<[string, string]>> {
  const text = await fs.readFile(chunkMdPath(projectDir, slug), 'utf-8');
  const failures: Array<[string, string]> = [];
  const tests = ownTestFiles(text);
  if (typeof tests === 'string') {
    failures.push([`${slug}'s own tests cannot be found`, tests]);
  } else if (tests.length > 0) {
    const run = await runTests(projectDir, tests);
    const what = `${slug}'s own tests (${tests.join(', ')}) fail`;
    if ('refused' in run) failures.push([what, run.refused]);
    else if (!run.ok) failures.push([what, tail(run.output)]);
  }
  const quotes = (await checkClaimQuotes(projectDir, slug)).refusals;
  if (quotes.length) failures.push([`claim-quote-check fails for ${slug}`, quotes.join(' ')]);
  if (!(await verifiedAgainstIsCurrent(projectDir, slug))) {
    failures.push([
      `chunk-check fails for ${slug}`,
      `its "## Verified Against" block is out of date, so chunk-check would have to repair it.`,
    ]);
  }
  return failures;
}

function vouchRefusal(ctx: MergeContext, shared: SharedFile[], slug: string, [what, detail]: [string, string]): string {
  const files = shared
    .filter((f) => f.chunks.includes(slug))
    .map((f) => `${f.path} (${vouchReason(ctx, f)})`)
    .join(', ');
  return (
    `${what} on the combined tree, so this merge cannot vouch for ${files}: ${detail} Merge the main ` +
    `line into ${ctx.branch} in its worktree, fix it there, re-run the chunk's checks, commit, and run ` +
    `chunk-merge again.`
  );
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Records every shared file as the merge combined it, in design/MERGE-SIGNOFFS.md, staged. */
async function recordMergeSignoffs(ctx: MergeContext, shared: SharedFile[]): Promise<void> {
  const merge = `${ctx.branch} ${(await git(ctx.top, ['rev-parse', ctx.branch])).trim()} into ${(await git(ctx.top, ['rev-parse', 'HEAD'])).trim()}`;
  const when = new Date().toISOString();
  const entries: MergeSignoff[] = [];
  for (const file of shared) {
    const content = await fs.readFile(join(ctx.projectDir, file.path)).catch(() => undefined);
    // A file the merge deleted has no code to vouch for; its chunks' manifests answer for that.
    if (content !== undefined) entries.push({ path: file.path, content: sha256(content), chunks: file.chunks, merge, when });
  }
  const path = designPath(ctx.projectDir, MERGE_SIGNOFFS_MD);
  const existing = await fs.readFile(path, 'utf-8').catch(() => undefined);
  await fs.writeFile(path, appendMergeSignoffs(existing, entries));
  await git(ctx.projectDir, ['add', '--', path]);
}

/**
 * Vouches for every source file the merge changed after its chunks signed it off (both sides
 * edited it, or the allocation renumbered it): each involved chunk's tests, claim-quote-check
 * and chunk-check (its Verified Against block, then, once the record is written, its sign-off)
 * must pass on the combined tree. Returns every failure, naming the check and the chunk.
 */
async function vouchForSharedFiles(ctx: MergeContext, shared: SharedFile[], runTests: TestRunner): Promise<string[]> {
  if (shared.length === 0) return [];
  const chunks = [...new Set(shared.flatMap((f) => f.chunks))].sort();
  const problems: string[] = [];
  for (const slug of chunks) {
    for (const failure of await ownCheckFailures(ctx.projectDir, slug, runTests)) {
      problems.push(vouchRefusal(ctx, shared, slug, failure));
    }
  }
  if (problems.length) return problems;
  await recordMergeSignoffs(ctx, shared);
  for (const slug of chunks) {
    for (const problem of await checkSignoff(ctx.projectDir, slug)) {
      problems.push(vouchRefusal(ctx, shared, slug, [`chunk-check fails for ${slug}`, problem]));
    }
  }
  return problems;
}

/** Records where this chunk's changes meet what the main line gained while it was built. */
async function recordCrossChunk(ctx: MergeContext, alongside: string[]): Promise<ChunkMergeResult['crossChunk']> {
  if (alongside.length === 0) return 'not built alongside';
  const branchDiff = await git(ctx.top, ['diff', '--unified=0', ctx.base, ctx.branch]);
  const mainDiff = await git(ctx.top, ['diff', '--unified=0', ctx.fork, 'HEAD']);
  const refs = crossReferences(changedSide(branchDiff), changedSide(mainDiff));
  const path = designPath(ctx.projectDir, CROSS_CHUNK_MD);
  const existing = await fs.readFile(path, 'utf-8').catch(() => undefined);
  await fs.writeFile(path, appendCrossChunkEntry(existing, { chunk: ctx.slug, alongside, refs }));
  await git(ctx.projectDir, ['add', '--', path]);
  return refs.sharedFiles.length + refs.sharedNames.length > 0 ? 'pending' : 'none';
}

// ---------------------------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------------------------

/** The merge's facts, or the reason there is nothing that can be merged. */
async function readContext(projectDir: string, slug: string, branch: string): Promise<MergeContext | string> {
  // One process for all three: --show-prefix prints an empty line at the top level.
  const where = await run(projectDir, ['rev-parse', '--show-toplevel', '--show-prefix', '--git-common-dir']);
  if (where.code !== 0) return `${projectDir} is not in a git repository. Run chunk-merge from the game project's main checkout.`;
  if ((await run(projectDir, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`])).code !== 0) {
    return `There is no branch ${branch}. A chunk built alongside others lives on chunk/<slug>; pass --branch if it is elsewhere.`;
  }
  if ((await git(projectDir, ['status', '--porcelain', '--untracked-files=no'])).trim() !== '') {
    return 'The main checkout has uncommitted changes. Commit or remove them first, so a refused merge can put everything back.';
  }
  const own = (await git(projectDir, ['rev-list', '--first-parent', branch, '^HEAD'])).split('\n').filter(Boolean);
  if (own.length === 0) return `${branch} has nothing the main line does not already have.`;
  const [top, prefix, common] = where.out.split('\n');
  const base = (await git(projectDir, ['merge-base', 'HEAD', branch])).trim();
  return {
    projectDir,
    top,
    common: resolve(projectDir, common),
    slug,
    branch,
    prefix,
    base,
    fork: (await git(projectDir, ['rev-parse', `${own[own.length - 1]}^1`])).trim(),
    changed: (await git(top, ['diff', '--name-only', base, branch])).split('\n').filter(Boolean),
  };
}

/** Starts the merge without committing it; returns the files whose conflicts remain. */
async function startMerge(ctx: MergeContext): Promise<string[]> {
  const merge = await run(ctx.top, ['-c', 'merge.conflictStyle=diff3', 'merge', '--no-ff', '--no-commit', ctx.branch]);
  const left = merge.code === 0 ? [] : await resolveConflicts(ctx);
  if (left.length === 0) await keepMainLock(ctx);
  return left;
}

function commitMessage(ctx: MergeContext, allocated: Record<string, string>, alongside: string[]): string {
  const lines = [`Merge chunk ${ctx.slug} (${ctx.branch})`, ''];
  if (alongside.length) lines.push(`Built alongside: ${alongside.join(', ')}.`);
  for (const [from, to] of Object.entries(allocated)) lines.push(`Allocated ${to} for ${from}.`);
  return lines.join('\n');
}

/** Runs each stage in turn and returns the first one's problems; later stages build on earlier ones. */
async function firstProblems(stages: Array<() => Promise<string[]>>): Promise<string[]> {
  for (const stage of stages) {
    const problems = await stage();
    if (problems.length) return problems;
  }
  return [];
}

/** Merges with the lock held; aborts the merge, restoring the main line, on any refusal. */
async function mergeLocked(ctx: MergeContext, runTests: TestRunner): Promise<ChunkMergeResult> {
  const before = [...(await realNumbersAdded(ctx)), ...sharedRunFiles(ctx)];
  if (before.length) return refused(before);

  const left = await startMerge(ctx);
  if (left.length) {
    await run(ctx.top, ['merge', '--abort']);
    return refused([
      `Merging ${ctx.branch} conflicts in ${left.join(', ')}. Merge the main line into ${ctx.branch} in the ` +
        `chunk's own worktree, resolve the conflicts there, re-run its tests, commit, and run chunk-merge again.`,
    ]);
  }
  const { allocated, refusals, renumbered } = await allocate(ctx);
  const alongside = await builtAlongside(ctx);
  const shared = await sharedSourceFiles(ctx, alongside, renumbered);
  const problems = [
    ...refusals,
    ...(await firstProblems([
      () => vouchForSharedFiles(ctx, shared, runTests),
      () => combinedTreeProblems(ctx, alongside, runTests),
    ])),
  ];
  if (problems.length) {
    await run(ctx.top, ['merge', '--abort']);
    return refused(problems);
  }
  const crossChunk = await recordCrossChunk(ctx, alongside);
  await git(ctx.top, ['commit', '-q', '-m', commitMessage(ctx, allocated, alongside)]);
  return { merged: true, refusals: [], allocated, alongside, crossChunk, vouched: shared };
}

async function withLock<T>(common: string, work: () => Promise<T>): Promise<T | string> {
  const lock = join(common, 'boardsmith-chunk-merge.lock');
  try {
    await fs.mkdir(lock);
  } catch {
    return `Another chunk-merge holds ${lock}. Merges run one at a time; wait for it. If no merge is running, remove that directory.`;
  }
  try {
    return await work();
  } finally {
    await fs.rm(lock, { recursive: true, force: true });
  }
}

/**
 * Merges chunk `slug`'s branch into the checked-out main line through the gate described at the
 * top of this file. Returns what happened; `refusals` says why when it did not merge.
 */
export async function chunkMerge(projectDir: string, slug: string, options: ChunkMergeOptions = {}): Promise<ChunkMergeResult> {
  const dir = resolve(projectDir);
  const ctx = await readContext(dir, slug, options.branch ?? `chunk/${slug}`);
  if (typeof ctx === 'string') return refused([ctx]);
  const result = await withLock(ctx.common, () => mergeLocked(ctx, options.runTests ?? runVitest));
  return typeof result === 'string' ? refused([result]) : result;
}

function report(slug: string, result: ChunkMergeResult): void {
  if (!result.merged) {
    console.error(chalk.red(`${slug} was not merged. The main line is unchanged. Fix each of these, then run chunk-merge again:`));
    for (const refusal of result.refusals) console.error(`  • ${refusal}`);
    return;
  }
  console.log(chalk.green(`✓ ${slug} merged; every tree-wide check passed on the combined tree.`));
  for (const [from, to] of Object.entries(result.allocated)) console.log(`  ${from} is now ${to}.`);
  for (const { path, chunks, why } of result.vouched) {
    const changed = why === 'both-edited' ? 'was edited on both sides' : 'had its ledger citations renumbered';
    console.log(
      `  ${path} ${changed}; the own checks of ${chunks.join(' and ')} passed on the combined ` +
        `file, recorded in ${DESIGN_DIR}/${MERGE_SIGNOFFS_MD}.`,
    );
  }
  if (result.crossChunk === 'pending') {
    console.log(
      `  ${slug} and ${result.alongside.join(', ')} share code or names, listed in ${DESIGN_DIR}/${CROSS_CHUNK_MD}. ` +
        `Run the audit's cross-chunk lens on them next; no chunk closes and no merge lands until it rules.`,
    );
  }
}

/** `boardsmith chunk-merge <slug> [--branch <name>] [--project <dir>] [--json]`. Exits 1 when refused. */
export async function chunkMergeCommand(
  slug: string,
  options: { branch?: string; project?: string; json?: boolean } = {},
): Promise<void> {
  try {
    assertBareName('<slug>', slug, "Pass the slug of the chunk whose branch to merge, as SKETCH.md's Ordered Chunk List names it.");
  } catch (error) {
    console.error(chalk.red((error as Error).message));
    process.exitCode = 1;
    return;
  }
  const result = await chunkMerge(options.project ?? process.cwd(), slug, { branch: options.branch });
  if (!result.merged) process.exitCode = 1;
  if (options.json) console.log(JSON.stringify({ slug, ...result }, null, 2));
  else report(slug, result);
}
