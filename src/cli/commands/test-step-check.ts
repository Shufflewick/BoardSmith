/**
 * `boardsmith test-step-check <slug>` — the gate `build/test.md` item 2 runs (#290).
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
 *   5. No test file the chunk wrote or changed provides, by hand, a key only one shell provides
 *      (`test-step-shell-context.ts`): it mounts with the shell-context stubs instead (#453).
 *   6. Every new test file the chunk wrote anywhere in the project that runs the game's code is a
 *      Spec Manifest row, so the mutation check runs it (#485). A file moved or rewritten from another
 *      counts as new. Exempt: files vitest never collects (the browser smoke test under
 *      `tests/browser/` among them), generated example tests (`tests/examples/<slug>.examples.test.ts`),
 *      measurement harnesses under `design/chunks/<slug>/evidence/`, guards (below), and earlier
 *      chunks' test files this chunk edits.
 *   7. Mutation: every claim and every test is shown able to fail (`test-step-mutation.ts`).
 *
 * A file under `tests/guards/` is a guard: a test that reads source as text, such as the a11y
 * floor's colour-literal and asset scans (`build/test.md`). No code mutant can make a scan fail, so
 * a guard is never a Spec Manifest file and is never mutation-tested; the full suite runs it. A guard
 * the chunk wrote or changed that runs the game's code is a finding, since it would be a behaviour test
 * hidden from the mutation check (`test-step-code-run.ts` says what counts, #443, #485).
 *
 * "The chunk added" means the lines whose last change is one of the chunk's own
 * `chunk-<slug>/` commits, or is not committed yet (`addedImplementationLines`).
 *
 * Any finding exits non-zero. There is no flag that skips a check.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, relative, resolve as pathResolve, sep } from 'node:path';
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
import { scriptRegions } from './test-step-sfc.js';
import { findCodeRun, type CodeRunContext } from './test-step-code-run.js';
import { findHandBuiltShellContext } from './test-step-shell-context.js';
import { findChunkCommits } from '../lib/chunk-commits.js';
import { chunkMdPath, relChunkMdPath } from '../lib/project-paths.js';
import { assertBareName } from '../lib/user-name.js';

const execFileAsync = promisify(execFile);

const TEST_STEP_FINDING_KINDS = Object.freeze([
  'spec-manifest-empty',
  'exemption-with-claims',
  'red-not-observed',
  'test-file-missing',
  'guard-in-manifest',
  'guard-runs-code',
  'test-not-in-manifest',
  'claim-not-live',
  'claim-test-missing',
  'claim-uncovered',
  'verb-not-dispatched',
  'unreachable-guard',
  'hand-built-shell-context',
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
  /** Claims Covered reads exactly `none (regression)`: the row pins behaviour, not a claim. */
  regression: boolean;
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
      regression: /^none\s*\(regression\)$/i.test(stripCell(cells[1])),
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

const IMPLEMENTATION_FILE = /\.(ts|mts|cts|js|mjs)$/;
/** A script file under `src/`: where verbs are defined. */
const isImplementation = (path: string) =>
  path.startsWith('src/') && IMPLEMENTATION_FILE.test(path) && !/\.(test|spec)\.[a-z]+$/.test(path);
/**
 * Code a chunk writes: a script file, or a Vue component whose script and template are code too (#425).
 * `boardsmith verify` mutates the same kind of file.
 */
export const isChunkCode = (path: string) => isImplementation(path) || (path.startsWith('src/') && path.endsWith('.vue'));

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
 * Implementation files and components under `src/`, each with the line numbers this chunk wrote: lines whose
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
    if (isChunkCode(path)) touched.add(path);
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
  for (const path of untracked.split('\n').filter(isChunkCode)) {
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

/** Where a game keeps its guard tests (see the file comment). */
const GUARD_TEST_DIR = 'tests/guards/';

/** Whether a manifest path names a file under `GUARD_TEST_DIR`. */
function isGuardFile(projectDir: string, testFile: string): boolean {
  const absPath = resolveManifestPath(projectDir, testFile);
  return absPath !== 'escapes' && absPath.startsWith(join(projectDir, GUARD_TEST_DIR));
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
    if (isGuardFile(projectDir, row.testFile)) {
      findings.push({
        kind: 'guard-in-manifest',
        subject: row.testFile,
        detail:
          `The Spec Manifest lists ${row.testFile}, a guard test. A guard reads source as text, so no change to the ` +
          "chunk's code can make it fail, and the mutation check would report every test in it. Remove the row: the " +
          `full suite runs ${GUARD_TEST_DIR} on its own. A test that cites a claim belongs in a chunk test file ` +
          'outside that folder (build/test.md "The A11y Floor").',
      });
      continue;
    }
    if (!/^yes\b/.test(row.redObserved) && !(manifest.exemption !== undefined && row.regression)) {
      findings.push({
        kind: 'red-not-observed',
        subject: row.testFile,
        detail:
          `RED Observed is "${row.redObserved || 'blank'}" for ${row.testFile}. Run its tests before the change ` +
          'that makes them pass (the implementation, for a file the spec step wrote; the fix, for a regression or ' +
          'measurement test build or repair added), see them fail, then set it to yes (build/spec.md "Persistence").',
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

/** The "unreachable" guards on `lines` of a file, read in each of its script regions, at their file lines. */
function unreachableGuardsIn(path: string, text: string, lines: ReadonlySet<number>): Array<{ line: number; text: string }> {
  return scriptRegions(path, text).flatMap((region) => {
    const regionLines = new Set([...lines].map((line) => line - region.firstLine + 1));
    return findUnreachableGuards(region.text, regionLines, path).map((guard) => ({
      line: guard.line + region.firstLine - 1,
      text: guard.text,
    }));
  });
}

/** Check 4: no line the chunk wrote calls a guard unreachable. */
async function guardFindings(
  projectDir: string,
  added: ReadonlyMap<string, ReadonlySet<number>>,
): Promise<TestStepFinding[]> {
  const findings: TestStepFinding[] = [];
  for (const [path, lines] of added) {
    const text = await fs.readFile(join(projectDir, path), 'utf-8');
    for (const { line, text: guardText } of unreachableGuardsIn(path, text, lines)) {
      findings.push({
        kind: 'unreachable-guard',
        subject: `${path}:${line}`,
        detail:
          `Line ${line} of ${path} calls a guard unreachable ("${guardText}"). Either let the compiler prove ` +
          'it (assign the value to a variable typed `never`, so a new case fails tsc) and drop the wording, or ' +
          'treat it as reachable: write the error for the person who hits it (what happened and what to do) and ' +
          'add a test that reaches it and asserts that message.',
      });
    }
  }
  return findings;
}

/** The test files a chunk wrote or changed, and what a check needs to read them. */
interface ChunkTestScope {
  /** Its manifest's files, then every other file under `tests/` it wrote or changed. */
  touched: SourceFile[];
  /** The paths under `tests/` the chunk created, committed or not. */
  created: ReadonlySet<string>;
  /** What `findCodeRun` reads beyond the file in hand: the project's scripts and dispatch helpers. */
  context: CodeRunContext;
}

const lines = (output: string) => output.split('\n').filter(Boolean);

/** The project-relative paths of the manifest's files, as git writes them, however a row spells one. */
const manifestPaths = (projectDir: string, testFiles: ChunkTestFile[]) =>
  new Set(testFiles.map((f) => relative(projectDir, f.absPath).split(sep).join('/')));

/**
 * Where vitest never collects a test file in a game project: its own default exclusions, and the
 * two the project's config adds (`test-run-scope.ts`), the chunk worktrees under `.boardsmith/` and
 * the browser tests under `tests/browser/`, which only Playwright runs.
 */
const NOT_COLLECTED = Object.freeze([
  /(^|\/)(node_modules|dist|cypress)\//,
  /(^|\/)\.(idea|git|cache|output|temp)\//,
  /^\.boardsmith\//,
  /(^|\/)tests\/browser\//,
]);

/** A file vitest collects as a test, by its default pattern and the exclusions above. */
const isTestFile = (path: string) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) && !NOT_COLLECTED.some((excluded) => excluded.test(path));

/** Every script in the project outside `node_modules/`, with its text. */
async function projectScripts(projectDir: string): Promise<SourceFile[]> {
  const listed = await git(projectDir, ['ls-files', '--cached', '--others', '--exclude-standard']);
  const scripts: SourceFile[] = [];
  for (const path of lines(listed).filter((p) => /\.[cm]?[jt]sx?$/.test(p) && !/(^|\/)node_modules\//.test(p))) {
    try {
      scripts.push({ path, text: await fs.readFile(join(projectDir, path), 'utf-8') });
    } catch {
      continue; // listed by git but deleted in the working tree
    }
  }
  return scripts;
}

/**
 * The chunk's test files: its manifest's, then every script under `tests/` and every test file
 * anywhere that one of its commits touched or that is not committed yet. A file counts as created
 * by the chunk when one of its commits added it, or it is added but not committed, or untracked.
 * Rename detection is off, so a file the chunk moved or rewrote from another counts as created:
 * the new path is the chunk's (#485).
 */
async function chunkTestScope(
  projectDir: string,
  chunkCommits: ReadonlySet<string>,
  testFiles: ChunkTestFile[],
): Promise<ChunkTestScope> {
  const log = async (...filter: string[]) =>
    lines(await git(projectDir, ['log', '--no-walk', '--no-renames', '--format=', '--name-only', ...filter, ...chunkCommits]));
  const diff = async (...filter: string[]) =>
    lines(await git(projectDir, ['diff', 'HEAD', '--no-renames', '--name-only', ...filter]));
  const untracked = lines(await git(projectDir, ['ls-files', '--others', '--exclude-standard']));
  const touched = new Set([...(await log()), ...(await diff()), ...untracked]);
  const created = new Set([...(await log('--diff-filter=A')), ...(await diff('--diff-filter=A')), ...untracked]);

  const scripts = await projectScripts(projectDir);
  const support = scripts.filter((f) => f.path.startsWith('tests/'));
  const text = new Map(scripts.map((f) => [f.path, f.text]));
  const manifest = manifestPaths(projectDir, testFiles);
  return {
    touched: [
      ...testFiles.map((f) => ({ path: f.path, text: f.source })),
      ...scripts.filter(
        (f) => touched.has(f.path) && !manifest.has(f.path) && (f.path.startsWith('tests/') || isTestFile(f.path)),
      ),
    ],
    created,
    context: { text: (path) => text.get(path), wrappers: findDispatchWrappers(support) },
  };
}

/** Check 5: no test file the chunk wrote or changed provides a one-shell key by hand. */
function shellContextFindings(scope: ChunkTestScope): TestStepFinding[] {
  return scope.touched.flatMap(({ path, text }) =>
    findHandBuiltShellContext(text, path).map(({ line, key }) => ({
      kind: 'hand-built-shell-context' as const,
      subject: `${path}:${line}`,
      detail:
        `Line ${line} of ${path} provides ${key} by hand, and only one of the two shells (a table's GameShell, a ` +
        "world's WorldShell) provides it. A board that reads it then passes this test and throws in the other " +
        'shell, as a world board once did in play with every test green. Mount with `renderAsSeat`, or pass the ' +
        '`provide` of `tableShellContext(...)` or `worldShellContext(...)` (all from boardsmith/testing): each gives ' +
        'exactly what the real shell gives and refuses a key it does not. Put any value you need to replace in their ' +
        '`provide` option.',
    })),
  );
}

/** A guard the chunk wrote or changed that runs the game's code (see the file comment). */
function guardRunsCodeFindings(scope: ChunkTestScope): TestStepFinding[] {
  return scope.touched
    .filter(({ path }) => path.startsWith(GUARD_TEST_DIR))
    .flatMap(({ path, text }) => {
      const run = findCodeRun(text, path, scope.context);
      if (run === undefined) return [];
      return [
        {
          kind: 'guard-runs-code' as const,
          subject: `${path}:${run.line}`,
          detail:
            `Line ${run.line} of ${path} ${run.what}. A file under ${GUARD_TEST_DIR} holds scans only (tests that read ` +
            'source as text, with `readFileSync` or an import ending `?raw`): it is never mutation-tested, so a test ' +
            'there that runs the game could pass whatever the code does. The one game module a scan may import is ' +
            'literal constants under src/ui/, such as the theme colours a contrast check needs. Move this test to ' +
            "the chunk's own test file and list that file in the Spec Manifest " +
            '(build/test.md "The A11y Floor").',
        },
      ];
    });
}

/**
 * A test file a chunk writes outside its manifest that need not be a row (see the file comment): a
 * generated example test, and a measurement harness under the chunk's `evidence/`
 * (`state-machine.md` "Project Layout"). The smoke test is under `tests/browser/`, which vitest
 * never collects (`NOT_COLLECTED`).
 */
const UNLISTED_TEST_EXEMPTIONS = Object.freeze([
  /^tests\/examples\/[^/]+\.examples\.test\.ts$/,
  /^design\/chunks\/[^/]+\/evidence\//,
]);

/** Check 6: every new test file the chunk wrote that runs the game's code is a Spec Manifest row. */
function unlistedTestFindings(scope: ChunkTestScope, projectDir: string, testFiles: ChunkTestFile[]): TestStepFinding[] {
  const manifest = manifestPaths(projectDir, testFiles);
  return scope.touched
    .filter(
      ({ path }) =>
        scope.created.has(path) &&
        isTestFile(path) &&
        !manifest.has(path) &&
        !path.startsWith(GUARD_TEST_DIR) &&
        !UNLISTED_TEST_EXEMPTIONS.some((exempt) => exempt.test(path)),
    )
    .flatMap(({ path, text }) => {
      const run = findCodeRun(text, path, scope.context);
      if (run === undefined) return [];
      return [
        {
          kind: 'test-not-in-manifest' as const,
          subject: path,
          detail:
            `This chunk wrote ${path}, and it runs the game's code (line ${run.line} ${run.what}), but no Spec ` +
            'Manifest row lists it, so the mutation check never runs it and nothing shows its tests can fail. ' +
            `Add a Spec Manifest row for it: \`| ${path} | <the claims it pins, or none> | yes |\`, with yes only once ` +
            'you have seen its tests fail before the change that makes them pass. A test you cannot see fail that ' +
            "way belongs in one of the chunk's existing Spec Manifest files instead. A file that only reads source as " +
            `text belongs under ${GUARD_TEST_DIR} (build/spec.md "Persistence").`,
        },
      ];
    });
}

/**
 * Runs checks 1-6 (see the file comment). Never runs a test; `testStepCheckCommand` runs the
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
  const chunkCommits = await findChunkCommits(dir, slug);
  const added = await addedImplementationLines(dir, chunkCommits);
  const rows = await manifestRowFindings(dir, manifest, claims);
  const verbs = await chunkVerbs(dir, added);
  const findings = [
    ...manifestShapeFindings(manifest, claims),
    ...rows.findings,
    ...uncoveredClaimFindings(manifest, claims),
    ...(await verbFindings(dir, verbs, rows.testFiles)),
    ...(await guardFindings(dir, added)),
  ];
  const scope = await chunkTestScope(dir, chunkCommits, rows.testFiles);
  findings.push(
    ...shellContextFindings(scope),
    ...guardRunsCodeFindings(scope),
    ...unlistedTestFindings(scope, dir, rows.testFiles),
  );
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
