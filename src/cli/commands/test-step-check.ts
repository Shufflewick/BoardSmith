/**
 * `boardsmith test-step-check <slug>` — the gate `build/test.md` item 3 runs (#290).
 *
 * A green suite says the tests pass. It does not say they would fail if the code were wrong, or
 * that they test what CHUNK.md claims they test. A build run (Shufflewick/sotf#29, #34, #35, #36)
 * passed its test step with tautological tests, a Spec Manifest claiming coverage no test gave,
 * two verbs never dispatched through the engine, and an "unreachable" guard that was reachable.
 * Every one of those is decidable from the files on disk, so this command decides them instead
 * of asking the session to remember to look:
 *
 *   1. Every `## Spec Manifest` row names a test file that exists, whose RED was observed, and in
 *      which a test that is not skipped cites each claim the row lists.
 *   2. Every live `## Interpretation` claim is listed by some row (or the chunk is exempt and
 *      has no claims).
 *   3. Every verb the chunk added (`Action.create('<verb>')`) is dispatched through the engine by
 *      one of the chunk's test files — calling the rules function directly does not count.
 *   4. No line the chunk added calls a guard unreachable.
 *   5. Mutation: every claim and every test is shown able to fail (`test-step-mutation.ts`).
 *
 * "The chunk added" means the lines whose last change is one of the chunk's own
 * `chunk-<slug>/` commits, or is not committed yet (`addedImplementationLines`).
 *
 * Any finding exits non-zero. There is no flag that skips a check.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';
import {
  claimsInForce,
  extractSection,
  parseSupersededClaims,
  resolveManifestPath,
} from './build-manifest.js';
import {
  DISPATCH_FORMS,
  findDefinedVerbs,
  findDispatchWrappers,
  findDispatchedVerbs,
  findTestBlocks,
  findUnreachableGuards,
  findVerbWrappers,
  mentionsAny,
  VERB_FACTORY_NAMES,
  type SourceFile,
} from './test-step-ast.js';
import { runMutationCheck, type MutationSummary } from './test-step-mutation.js';
import { chunkMdPath, relChunkMdPath } from '../lib/project-paths.js';
import { assertBareName } from '../lib/user-name.js';

const execFileAsync = promisify(execFile);

const TEST_STEP_FINDING_KINDS = Object.freeze([
  'spec-manifest-empty',
  'exemption-with-claims',
  'red-not-observed',
  'test-file-missing',
  'claim-not-live',
  'claim-test-missing',
  'claim-uncovered',
  'verb-not-dispatched',
  'unreachable-guard',
  'suite-not-green',
  'test-not-run',
  'claim-survives-mutation',
  'test-survives-mutation',
] as const);

type TestStepFindingKind = (typeof TEST_STEP_FINDING_KINDS)[number];

/** `kind`/`subject` are for machines; `detail` says what is wrong and what to do about it. */
export interface TestStepFinding {
  kind: TestStepFindingKind;
  subject: string;
  detail: string;
}

// -------------------------------------------------------------------------------------------
// parseSpecManifest
// -------------------------------------------------------------------------------------------

interface SpecManifestRow {
  testFile: string;
  claims: number[];
  redObserved: string;
}

interface SpecManifest {
  rows: SpecManifestRow[];
  /** The reason given on an `| exempt | <reason> | n/a |` row, when the chunk has one. */
  exemption?: string;
}

const stripCell = (cell: string | undefined) => (cell ?? '').trim().replace(/^`+|`+$/g, '').trim();

/**
 * The claim numbers a Claims Covered cell lists. Real cells carry notes around the numbers, so
 * only standalone numbers count: "21 (12 superseded by 21)" lists 21, "[[Ruling 92]]" is a ruling
 * and not a claim, neither "a11y" nor "SKILLAUTO-08" names one, "1-3" is 1, 2 and 3, and
 * "16→32/33" says claim 16 is now carried by 32 and 33.
 */
function parseClaimsCell(cell: string): number[] {
  const text = cell
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/(?<![\w-])\d+\s*→/g, ' ')
    .replace(/(?<![\w-])(\d+)\s*[-–]\s*(\d+)(?![\w-])/g, (_, from: string, to: string) => {
      const numbers: number[] = [];
      for (let n = Number(from); n <= Number(to); n++) numbers.push(n);
      return ` ${numbers.join(' ')} `;
    });
  return [...text.matchAll(/(?<![\w-])\d+(?![\w-])/g)].map((m) => Number(m[0]));
}

/** Reads the `| Test File | Claims Covered | RED Observed |` table. */
export function parseSpecManifest(chunkText: string): SpecManifest {
  const body = extractSection(chunkText, '## Spec Manifest');
  if (body === undefined) {
    throw new Error(
      'This CHUNK.md has no `## Spec Manifest` section.\n' +
        'Add it (see templates/CHUNK.template.md) with one row per test file the spec step wrote.',
    );
  }
  const rows: SpecManifestRow[] = [];
  let exemption: string | undefined;
  // HTML comments hold the template's guidance, including an example row; none of it is data.
  for (const line of body.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    if (/^[|\-:\s]+$/.test(trimmed)) continue;
    const cells = trimmed.split('|').slice(1);
    const testFile = stripCell(cells[0]);
    if (/^test file$/i.test(testFile)) continue;
    if (/^exempt\b/i.test(testFile)) {
      exemption = stripCell(cells[1]);
      continue;
    }
    rows.push({
      testFile,
      claims: parseClaimsCell(cells[1] ?? ''),
      redObserved: stripCell(cells[2]).toLowerCase(),
    });
  }
  return { rows, exemption };
}

// -------------------------------------------------------------------------------------------
// git: which lines this chunk wrote
// -------------------------------------------------------------------------------------------

async function git(projectDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: projectDir, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

/** The hash git blame gives a line that is not committed yet. */
const UNCOMMITTED = '0'.repeat(40);

/** Every commit whose message starts with `chunk-<slug>/` (state-machine.md "Git Protocol"). */
async function findChunkCommits(projectDir: string, slug: string): Promise<Set<string>> {
  let log: string;
  try {
    log = await git(projectDir, ['log', '--format=%H%x09%s']);
  } catch {
    throw new Error(
      `${projectDir} is not a git repository with commits.\n` +
        'The build skill commits every step (state-machine.md "Git Protocol"); initialise git and commit first.',
    );
  }
  const prefix = `chunk-${slug}/`;
  const commits = new Set(
    log
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([, subject]) => subject?.startsWith(prefix))
      .map(([hash]) => hash),
  );
  if (commits.size === 0) {
    throw new Error(
      `No commit for chunk "${slug}" yet: none of its commit messages starts with "${prefix}step-".\n` +
        `Commit each finished step as "chunk-${slug}/step-<name>" (state-machine.md "Git Protocol"), then run this again.`,
    );
  }
  return commits;
}

const IMPLEMENTATION_FILE = /\.(ts|mts|cts|js|mjs)$/;
const isImplementation = (path: string) =>
  path.startsWith('src/') && IMPLEMENTATION_FILE.test(path) && !/\.(test|spec)\.[a-z]+$/.test(path);

/** Line numbers of `path` as it is now whose last change is one of `owners`. */
async function ownedLines(projectDir: string, path: string, owners: ReadonlySet<string>): Promise<Set<number>> {
  const lines = new Set<number>();
  const blame = await git(projectDir, ['blame', '--porcelain', '--', path]);
  for (const line of blame.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (header && owners.has(header[1])) lines.add(Number(header[2]));
  }
  return lines;
}

/**
 * Implementation files under `src/`, each with the line numbers this chunk wrote: lines whose
 * last change is one of the chunk's own commits, or not committed yet. Attributing by blame, not
 * by a diff from where the chunk started, keeps another chunk's work committed in between (a
 * parallel run, or a revise round after later chunks) from being counted as this one's.
 */
async function addedImplementationLines(
  projectDir: string,
  chunkCommits: ReadonlySet<string>,
): Promise<Map<string, Set<number>>> {
  const touched = new Set<string>();
  const committed = await git(projectDir, ['log', '--no-walk', '--format=', '--name-only', ...chunkCommits]);
  const uncommitted = await git(projectDir, ['diff', 'HEAD', '--name-only', '--', 'src']);
  for (const path of [...committed.split('\n'), ...uncommitted.split('\n')]) {
    if (isImplementation(path)) touched.add(path);
  }

  const owners = new Set([...chunkCommits, UNCOMMITTED]);
  const added = new Map<string, Set<number>>();
  for (const path of [...touched].sort()) {
    try {
      await fs.access(join(projectDir, path));
    } catch {
      continue; // deleted since
    }
    const lines = await ownedLines(projectDir, path, owners);
    if (lines.size > 0) added.set(path, lines);
  }
  const untracked = await git(projectDir, ['ls-files', '--others', '--exclude-standard', '--', 'src']);
  for (const path of untracked.split('\n').filter(isImplementation)) {
    const text = await fs.readFile(join(projectDir, path), 'utf-8');
    added.set(path, new Set(text.split('\n').map((_, i) => i + 1)));
  }
  return added;
}

/** Every implementation file in the working tree, with its text. */
async function implementationNow(projectDir: string): Promise<SourceFile[]> {
  const listed = await git(projectDir, ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src']);
  const files: SourceFile[] = [];
  for (const path of listed.split('\n').filter(isImplementation)) {
    try {
      files.push({ path, text: await fs.readFile(join(projectDir, path), 'utf-8') });
    } catch {
      continue; // listed by git but deleted in the working tree
    }
  }
  return files;
}

/** Every `.ts` file under `tests/`, where a project keeps its test harness. */
async function testSupportSources(projectDir: string): Promise<SourceFile[]> {
  const listed = await git(projectDir, ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'tests']);
  const sources: SourceFile[] = [];
  for (const path of listed.split('\n').filter((p) => /\.(ts|mts|js|mjs)$/.test(p))) {
    try {
      sources.push({ path, text: await fs.readFile(join(projectDir, path), 'utf-8') });
    } catch {
      continue; // listed by git but deleted in the working tree
    }
  }
  return sources;
}

// -------------------------------------------------------------------------------------------
// checkTestStep — the static checks
// -------------------------------------------------------------------------------------------

export interface TestStepCheckResult {
  slug: string;
  /** Verbs this chunk added. */
  verbs: string[];
  findings: TestStepFinding[];
  /** Present when the static checks passed and the mutation check ran. */
  mutation?: MutationSummary;
}

/** The chunk's test files that exist, keyed by manifest path, with their absolute paths. */
export interface ChunkTestFile {
  path: string;
  absPath: string;
  source: string;
}

async function readChunk(projectDir: string, slug: string): Promise<string> {
  try {
    return await fs.readFile(chunkMdPath(projectDir, slug), 'utf-8');
  } catch {
    throw new Error(
      `No ${relChunkMdPath(slug)} in ${projectDir}.\n` +
        'Check the chunk slug (it is the directory name under design/chunks/), or pass --project <dir>.',
    );
  }
}

/** The claims a chunk owes tests for, and the ones it no longer does. */
interface ChunkClaims {
  inForce: number[];
  superseded: number[];
}

/** An exempt chunk must have no claims; a chunk that is not exempt must list its test files. */
function manifestShapeFindings(manifest: SpecManifest, claims: ChunkClaims): TestStepFinding[] {
  if (manifest.exemption !== undefined && claims.inForce.length > 0) {
    return [{
      kind: 'exemption-with-claims',
      subject: 'Spec Manifest',
      detail:
        `The Spec Manifest marks this chunk exempt ("${manifest.exemption}"), but its Interpretation has ` +
        `claims ${claims.inForce.join(', ')}. A chunk with claims needs a test for each one: replace the ` +
        'exempt row with one row per test file (build/spec.md "Exemptions").',
    }];
  }
  if (manifest.exemption === undefined && manifest.rows.length === 0) {
    return [{
      kind: 'spec-manifest-empty',
      subject: 'Spec Manifest',
      detail:
        'The Spec Manifest has no rows. Add one row per test file the spec step wrote, or a single ' +
        '`| exempt | <reason> | n/a |` row for a chunk with no new game behavior (build/spec.md "Exemptions").',
    }];
  }
  return [];
}

/** The test file a row names, read from disk, or undefined when it is not there. */
async function readRowFile(projectDir: string, row: SpecManifestRow): Promise<ChunkTestFile | undefined> {
  const absPath = resolveManifestPath(projectDir, row.testFile);
  if (absPath === 'escapes') return undefined;
  try {
    return { path: row.testFile, absPath, source: await fs.readFile(absPath, 'utf-8') };
  } catch {
    return undefined;
  }
}

/** Whether each claim the row lists is in force and cited by a test in the file that runs. */
function rowClaimFindings(row: SpecManifestRow, file: ChunkTestFile | undefined, claims: ChunkClaims): TestStepFinding[] {
  const findings: TestStepFinding[] = [];
  const blocks = file ? findTestBlocks(file.source, file.path) : [];
  // A superseded claim demands no test, so listing one alongside its replacement is harmless.
  for (const claim of row.claims.filter((c) => !claims.superseded.includes(c))) {
    if (!claims.inForce.includes(claim)) {
      findings.push({
        kind: 'claim-not-live',
        subject: `claim ${claim} in ${row.testFile}`,
        detail:
          `The Spec Manifest says ${row.testFile} covers claim ${claim}, but the Interpretation has no claim ${claim} ` +
          `(it has ${claims.inForce.join(', ') || 'none'} in force). Fix the row.`,
      });
    } else if (file && !blocks.some((b) => !b.skipped && b.claims.includes(claim))) {
      findings.push({
        kind: 'claim-test-missing',
        subject: `claim ${claim} in ${row.testFile}`,
        detail:
          `The Spec Manifest says ${row.testFile} covers claim ${claim}, but no test in it that runs cites ` +
          `claim ${claim}. Write the test, naming "claim ${claim}" in its title or in a comment directly above it.`,
      });
    }
  }
  return findings;
}

/** Check 1: every row's file exists, its RED was observed, and its claims have citing tests. */
async function manifestRowFindings(
  projectDir: string,
  manifest: SpecManifest,
  claims: ChunkClaims,
): Promise<{ findings: TestStepFinding[]; testFiles: ChunkTestFile[] }> {
  const findings: TestStepFinding[] = [];
  const testFiles: ChunkTestFile[] = [];
  for (const row of manifest.rows) {
    if (!/^yes\b/.test(row.redObserved)) {
      findings.push({
        kind: 'red-not-observed',
        subject: row.testFile,
        detail:
          `RED Observed is "${row.redObserved || 'blank'}" for ${row.testFile}. Run the spec step's tests before ` +
          'the implementation exists, see them fail, then set it to yes (build/spec.md).',
      });
    }
    const file = await readRowFile(projectDir, row);
    if (file) testFiles.push(file);
    else {
      findings.push({
        kind: 'test-file-missing',
        subject: row.testFile,
        detail: `The Spec Manifest names ${row.testFile}, but there is no such file in the project. Restore it or fix the row.`,
      });
    }
    findings.push(...rowClaimFindings(row, file, claims));
  }
  return { findings, testFiles };
}

/** Check 2: every claim in force is listed by some row. */
function uncoveredClaimFindings(manifest: SpecManifest, claims: ChunkClaims): TestStepFinding[] {
  if (manifest.exemption !== undefined || manifest.rows.length === 0) return [];
  return claims.inForce
    .filter((claim) => !manifest.rows.some((r) => r.claims.includes(claim)))
    .map((claim) => ({
      kind: 'claim-uncovered' as const,
      subject: `claim ${claim}`,
      detail: `No Spec Manifest row covers Interpretation claim ${claim}. Write a test for it and list it in the row for its file.`,
    }));
}

/** The verbs defined on lines this chunk wrote. */
async function chunkVerbs(projectDir: string, added: ReadonlyMap<string, ReadonlySet<number>>): Promise<string[]> {
  const implementation = await implementationNow(projectDir);
  const wrappers = findVerbWrappers(implementation);
  const names = [...VERB_FACTORY_NAMES, ...wrappers.keys()];
  const verbs = new Set<string>();
  for (const { path, text } of implementation) {
    const lines = added.get(path);
    if (lines && mentionsAny(text, names)) findDefinedVerbs(text, path, wrappers, lines).forEach((v) => verbs.add(v));
  }
  return [...verbs];
}

/** Check 3: every verb the chunk added is dispatched through the engine by one of its tests. */
async function verbFindings(projectDir: string, verbs: string[], testFiles: ChunkTestFile[]): Promise<TestStepFinding[]> {
  const wrappers = findDispatchWrappers([
    ...(await testSupportSources(projectDir)),
    ...testFiles.map((f) => ({ path: f.path, text: f.source })),
  ]);
  const dispatched = new Set(testFiles.flatMap((f) => findDispatchedVerbs(f.source, f.path, wrappers)));
  return verbs
    .filter((verb) => !dispatched.has(verb))
    .map((verb) => ({
      kind: 'verb-not-dispatched' as const,
      subject: verb,
      detail:
        `This chunk adds the verb "${verb}", but none of its test files dispatches it through the engine. ` +
        `Calling the rules function directly skips the engine's selections, conditions and flow. Add a test that ` +
        `runs it with ${DISPATCH_FORMS}.`,
    }));
}

/** Check 4: no line the chunk wrote calls a guard unreachable. */
async function guardFindings(
  projectDir: string,
  added: ReadonlyMap<string, ReadonlySet<number>>,
): Promise<TestStepFinding[]> {
  const findings: TestStepFinding[] = [];
  for (const [path, lines] of added) {
    const text = await fs.readFile(join(projectDir, path), 'utf-8');
    for (const guard of findUnreachableGuards(text, lines, path)) {
      findings.push({
        kind: 'unreachable-guard',
        subject: `${path}:${guard.line}`,
        detail:
          `Line ${guard.line} of ${path} calls a guard unreachable ("${guard.text}"). Either let the compiler prove ` +
          'it (assign the value to a variable typed `never`, so a new case fails tsc) and drop the wording, or ' +
          'treat it as reachable: write the error for the person who hits it (what happened and what to do) and ' +
          'add a test that reaches it and asserts that message.',
      });
    }
  }
  return findings;
}

/**
 * Runs checks 1-4 (see the file comment). Never runs a test; `testStepCheckCommand` runs the
 * mutation check once these pass.
 */
export async function checkTestStep(
  projectDir: string,
  slug: string,
): Promise<TestStepCheckResult & { testFiles: ChunkTestFile[]; added: Map<string, Set<number>> }> {
  assertBareName('Chunk slug', slug, 'Pass the directory name under design/chunks/, e.g. `auction`.');
  const dir = pathResolve(projectDir);
  const chunkText = await readChunk(dir, slug);
  const claims: ChunkClaims = { inForce: claimsInForce(chunkText), superseded: parseSupersededClaims(chunkText) };
  const manifest = parseSpecManifest(chunkText);
  const added = await addedImplementationLines(dir, await findChunkCommits(dir, slug));
  const rows = await manifestRowFindings(dir, manifest, claims);
  const verbs = await chunkVerbs(dir, added);
  const findings = [
    ...manifestShapeFindings(manifest, claims),
    ...rows.findings,
    ...uncoveredClaimFindings(manifest, claims),
    ...(await verbFindings(dir, verbs, rows.testFiles)),
    ...(await guardFindings(dir, added)),
  ];
  return { slug, verbs, findings, testFiles: rows.testFiles, added };
}

// -------------------------------------------------------------------------------------------
// The command
// -------------------------------------------------------------------------------------------

/**
 * `boardsmith test-step-check <slug> [--project <dir>] [--json]`. Runs the static checks, then,
 * only if they pass, the mutation check. Sets a non-zero exit code on any finding; a tool failure
 * (no such chunk, no git history) throws a readable error.
 */
export async function testStepCheckCommand(
  slug: string,
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  const dir = pathResolve(options.project ?? process.cwd());
  const { testFiles, added, ...staticResult } = await checkTestStep(dir, slug);
  const result: TestStepCheckResult = { ...staticResult };

  if (result.findings.length === 0 && testFiles.length > 0) {
    const liveClaims = claimsInForce(await readChunk(dir, slug));
    const mutation = await runMutationCheck({
      projectDir: dir,
      testFiles,
      added,
      claims: liveClaims,
      log: options.json ? () => {} : (line) => console.error(chalk.dim(line)),
    });
    result.mutation = mutation.summary;
    result.findings.push(...mutation.findings);
  }

  if (result.findings.length > 0) process.exitCode = 1;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printReport(result);
}

function printReport(result: TestStepCheckResult): void {
  const verbs = result.verbs.length > 0 ? result.verbs.join(', ') : 'none';
  console.log(`Test step check for chunk "${result.slug}" (verbs added: ${verbs})`);
  if (result.mutation) {
    const m = result.mutation;
    console.log(
      `Mutation: ${m.mutants} mutants of ${m.files} changed file(s), ${m.killed} made a test fail, ` +
        `${m.survived} changed nothing any test noticed, ${m.timedOut} timed out.`,
    );
  }
  if (result.findings.length === 0) {
    console.log(chalk.green('Passed: every claim has a test that can fail, and every verb runs through the engine.'));
    return;
  }
  console.log(chalk.red(`${result.findings.length} finding(s). The test step does not pass until each is fixed:`));
  for (const f of result.findings) {
    console.log(`\n${chalk.bold(`${f.kind}: ${f.subject}`)}\n  ${f.detail}`);
  }
}
