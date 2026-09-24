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
 *      every verified chunk's sign-off still matches its code; and the project's whole test suite.
 *      Any failure aborts the merge and leaves the main line exactly as it was.
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
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import {
  CROSS_CHUNK_MD,
  DESIGN_DIR,
  RUN_LOG_DIR,
  RUN_MD,
  SKETCH_MD,
  chunkMdPath,
  chunkSlugs,
  designPath,
} from '../lib/project-paths.js';
import { assertBareName } from '../lib/user-name.js';
import {
  NUMBERED_LEDGER_SPECS,
  allocateProvisional,
  plainNumbersAdded,
  provisionalReferences,
} from '../lib/ledger-allocation.js';
import { ledgerCheck } from './ledger-check.js';
import { type TestRunner, checkConstraints, runVitest } from './constraint-check.js';
import { checkSignoff } from './chunk-signoff.js';
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
  slug: string;
  branch: string;
  /** The project's path inside its repository, `''` or ending in `/`. */
  prefix: string;
  /** The merge base of the main line and the branch. */
  base: string;
  /** Where the branch first left the main line, even if the main line was merged into it since. */
  fork: string;
}

const refused = (refusals: string[]): ChunkMergeResult => ({
  merged: false,
  refusals,
  allocated: {},
  alongside: [],
  crossChunk: 'not built alongside',
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
  for (const spec of NUMBERED_LEDGER_SPECS) {
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

async function sharedRunFiles(ctx: MergeContext): Promise<string[]> {
  const design = `${ctx.prefix}${DESIGN_DIR}/`;
  const names = await git(ctx.top, ['diff', '--name-only', ctx.base, ctx.branch, '--', `${design}${RUN_MD}`, `${design}${RUN_LOG_DIR}/`]);
  const own = `${design}${RUN_LOG_DIR}/${ctx.slug}.md`;
  return names
    .split('\n')
    .filter((name) => name && name !== own)
    .map(
      (name) =>
        `${ctx.branch} changes ${name.slice(ctx.prefix.length)}. A chunk's branch writes only its own run log, ` +
        `${DESIGN_DIR}/${RUN_LOG_DIR}/${ctx.slug}.md; ${RUN_MD} and other chunks' logs belong to the main line. ` +
        `Undo that change on the branch and merge again.`,
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

async function allocate(ctx: MergeContext): Promise<{ allocated: Record<string, string>; refusals: string[] }> {
  const top = ctx.top;
  const changed = (await git(top, ['diff', '--name-only', ctx.base, ctx.branch])).split('\n').filter(Boolean);
  const ledgers = NUMBERED_LEDGER_SPECS.map((spec) => ({ spec, path: `${ctx.prefix}${DESIGN_DIR}/${spec.file}` }));
  const files: Record<string, string> = {};
  for (const name of new Set([...changed, ...ledgers.map((l) => l.path)])) {
    const text = await readText(join(top, name));
    if (text !== undefined) files[name] = text;
  }
  const { files: rewritten, mapping } = allocateProvisional(files, ledgers);
  const refusals: string[] = [];
  for (const [name, text] of Object.entries(rewritten)) {
    if (text !== files[name]) {
      await fs.writeFile(join(top, name), text);
      await git(top, ['add', '--', name]);
    }
    for (const id of provisionalReferences(text)) {
      refusals.push(`${name} cites ${id}, but no ledger entry is headed ${id}. Correct the citation on the branch.`);
    }
  }
  return { allocated: mapping, refusals };
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
  const problems: string[] = [];
  for (const slug of await chunkSlugs(projectDir)) {
    const exists = await fs.stat(chunkMdPath(projectDir, slug)).then(() => true, () => false);
    if (exists) problems.push(...(await checkSignoff(projectDir, slug)));
  }
  return problems;
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
  const top = await run(projectDir, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return `${projectDir} is not in a git repository. Run chunk-merge from the game project's main checkout.`;
  if ((await run(projectDir, ['rev-parse', '--verify', '--quiet', `${branch}^{commit}`])).code !== 0) {
    return `There is no branch ${branch}. A chunk built alongside others lives on chunk/<slug>; pass --branch if it is elsewhere.`;
  }
  if ((await git(projectDir, ['status', '--porcelain', '--untracked-files=no'])).trim() !== '') {
    return 'The main checkout has uncommitted changes. Commit or remove them first, so a refused merge can put everything back.';
  }
  const own = (await git(projectDir, ['rev-list', '--first-parent', branch, '^HEAD'])).split('\n').filter(Boolean);
  if (own.length === 0) return `${branch} has nothing the main line does not already have.`;
  return {
    projectDir,
    top: top.out.trim(),
    slug,
    branch,
    prefix: (await git(projectDir, ['rev-parse', '--show-prefix'])).trim(),
    base: (await git(projectDir, ['merge-base', 'HEAD', branch])).trim(),
    fork: (await git(projectDir, ['rev-parse', `${own[own.length - 1]}^1`])).trim(),
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

/** Merges with the lock held; aborts the merge, restoring the main line, on any refusal. */
async function mergeLocked(ctx: MergeContext, runTests: TestRunner): Promise<ChunkMergeResult> {
  const before = [...(await realNumbersAdded(ctx)), ...(await sharedRunFiles(ctx))];
  if (before.length) return refused(before);

  const left = await startMerge(ctx);
  if (left.length) {
    await run(ctx.top, ['merge', '--abort']);
    return refused([
      `Merging ${ctx.branch} conflicts in ${left.join(', ')}. Merge the main line into ${ctx.branch} in the ` +
        `chunk's own worktree, resolve the conflicts there, re-run its tests, commit, and run chunk-merge again.`,
    ]);
  }
  const { allocated, refusals } = await allocate(ctx);
  const alongside = await builtAlongside(ctx);
  const problems = [...refusals, ...(await combinedTreeProblems(ctx, alongside, runTests))];
  if (problems.length) {
    await run(ctx.top, ['merge', '--abort']);
    return refused(problems);
  }
  const crossChunk = await recordCrossChunk(ctx, alongside);
  await git(ctx.top, ['commit', '-q', '-m', commitMessage(ctx, allocated, alongside)]);
  return { merged: true, refusals: [], allocated, alongside, crossChunk };
}

async function withLock<T>(projectDir: string, work: () => Promise<T>): Promise<T | string> {
  const common = resolve(projectDir, (await git(projectDir, ['rev-parse', '--git-common-dir'])).trim());
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
  const result = await withLock(dir, () => mergeLocked(ctx, options.runTests ?? runVitest));
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
