/**
 * `test-step-mutation.ts` — the mutation half of `boardsmith test-step-check` (#290), and the
 * mutation check of `boardsmith verify` (#452, `runDiffMutationCheck` at the end of this file).
 *
 * A test that cannot fail proves nothing. The only way to know a test can fail is to break the
 * code it tests and watch. So this module makes small, single changes ("mutants") to the lines the
 * chunk added — flip a comparison, negate a condition, drop a statement, return `undefined` — and
 * runs the chunk's own test files against each one. A test that fails under at least one mutant
 * has been shown able to catch a regression; a test that no mutant disturbs is asserting nothing
 * the chunk's code controls (the sotf#29 tautology), and a claim none of whose tests ever fail is
 * a claim with no real test.
 *
 * Mutants never touch the source on disk. Each run uses a generated vitest config that extends
 * the project's own and serves the mutated text for one file through a Vite `load` hook, so an
 * interrupted run leaves the project exactly as it was. The generated files live in the project's
 * scratch directory and are removed when the check ends.
 *
 * Credit is strict: a mutant only "kills" a test that vitest reports as a failed test. A mutant
 * that breaks the whole file on import fails no individual test and credits nobody, because a
 * tautology in that file would otherwise be credited too.
 *
 * One kind of test file is mutated differently: the `none (regression)` row of an exempt chunk
 * (#485), marked `ChunkTestFile.pin`. Such a chunk adds no game behaviour, so its own lines give no
 * mutant that could reach what the row pins, an earlier chunk's behaviour. Its mutants are made
 * instead from the game code the test runs, found by running it once with V8 coverage
 * (`test-step-coverage.ts`), leaving out the modules it mocks: at most `PIN_MUTANT_CAP` per such file,
 * shared between its tests (`killPinTests`). Those mutants run only against that file.
 */
import { spawn } from 'node:child_process';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  parseSource,
  walk,
  findTestBlocks,
  UnreadableSourceError,
  type AstNode,
  type ParsedSource,
  type TestBlock,
} from './test-step-ast.js';
import { codeRegions } from './test-step-sfc.js';
import type { ChunkTestFile, TestStepFinding } from './test-step-check.js';
import { COVERAGE_SETUP, coverageEnv, readCoverage, testKeyOf, type FileCoverage } from './test-step-coverage.js';
import type { MutantCache } from '../lib/mutant-cache.js';
import { scratchDir } from '../lib/project-paths.js';
import { VITEST_CONFIG_NAMES } from '../lib/test-run-scope.js';

// -------------------------------------------------------------------------------------------
// generateMutants
// -------------------------------------------------------------------------------------------

interface Mutant {
  /** Project-relative path of the mutated file. */
  file: string;
  line: number;
  description: string;
  /** The whole file's text with this one change applied. */
  source: string;
}

const OPERATOR_SWAPS: Readonly<Record<string, string>> = Object.freeze({
  '===': '!==',
  '!==': '===',
  '==': '!=',
  '!=': '==',
  '<': '<=',
  '<=': '<',
  '>': '>=',
  '>=': '>',
  '+': '-',
  '-': '+',
  '*': '/',
  '/': '*',
  '%': '*',
  '&&': '||',
  '||': '&&',
});

/** Node types that put a literal inside a type, where changing it changes no behavior. */
const TYPE_CONTEXTS = new Set([
  'TSLiteralType',
  'TSTypeAnnotation',
  'TSTypeParameterInstantiation',
  'TSTypeAliasDeclaration',
  'TSInterfaceDeclaration',
]);

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** One change: replace `source[from, to)` with `replacement`. */
type Edit = [from: number, to: number, replacement: string];

/** What a mutator sees of the node it is asked about. */
interface MutationSite {
  node: AstNode;
  ancestors: AstNode[];
  source: string;
  tokens: ParsedSource['tokens'];
}

/** A mutator returns the one change it makes to a node, or nothing when that node has none. */
type Mutator = (site: MutationSite) => { description: string; edit: Edit } | undefined;

const nodeText = ({ node, source }: MutationSite, target: AstNode = node) => source.slice(target.range[0], target.range[1]);

/** Flips a comparison, arithmetic or logical operator. */
const swapOperator: Mutator = ({ node, tokens }) => {
  const operator = node.operator as string;
  const swap = OPERATOR_SWAPS[operator];
  if (!swap) return undefined;
  const [left, right] = [node.left as AstNode, node.right as AstNode];
  const token = tokens.find((t) => t.value === operator && t.range[0] >= left.range[1] && t.range[1] <= right.range[0]);
  return token ? { description: `${operator} -> ${swap}`, edit: [token.range[0], token.range[1], swap] } : undefined;
};

/** Flips a boolean, or adds one to a number, outside types and object keys. */
const changeLiteral: Mutator = (site) => {
  const { node, ancestors } = site;
  const parent = ancestors[ancestors.length - 1];
  if (ancestors.some((a) => TYPE_CONTEXTS.has(a.type)) || (parent?.type === 'Property' && parent.key === node)) {
    return undefined;
  }
  if (typeof node.value === 'boolean') {
    return { description: `${node.value} -> ${!node.value}`, edit: [node.range[0], node.range[1], String(!node.value)] };
  }
  if (typeof node.value !== 'number') return undefined;
  const next = node.value + 1;
  return { description: `${nodeText(site)} -> ${next}`, edit: [node.range[0], node.range[1], String(next)] };
};

const removeNot: Mutator = ({ node }) =>
  node.operator === '!' ? { description: 'removed !', edit: [node.range[0], node.range[0] + 1, ''] } : undefined;

const negateCondition: Mutator = (site) => {
  const test = site.node.test as AstNode;
  const description = site.node.type === 'IfStatement' ? 'if condition negated' : 'condition negated';
  return { description, edit: [test.range[0], test.range[1], `!(${nodeText(site, test)})`] };
};

const replaceReturn: Mutator = ({ node }) => {
  const argument = node.argument as AstNode | null;
  if (!argument || (argument.type === 'Identifier' && argument.name === 'undefined')) return undefined;
  return { description: 'return value replaced with undefined', edit: [argument.range[0], argument.range[1], 'undefined'] };
};

/** Removes a statement inside a function; a module's top-level statements run on import. */
const removeStatement: Mutator = ({ node, ancestors }) => {
  if (typeof node.directive === 'string') return undefined;
  const expression = node.expression as AstNode;
  if (expression.type === 'CallExpression' && (expression.callee as AstNode).type === 'Super') return undefined;
  if (!ancestors.some((a) => FUNCTION_TYPES.has(a.type))) return undefined;
  return { description: 'statement removed', edit: [node.range[0], node.range[1], ';'] };
};

const MUTATORS: Readonly<Record<string, Mutator>> = Object.freeze({
  BinaryExpression: swapOperator,
  LogicalExpression: swapOperator,
  Literal: changeLiteral,
  UnaryExpression: removeNot,
  IfStatement: negateCondition,
  ConditionalExpression: negateCondition,
  ReturnStatement: replaceReturn,
  ExpressionStatement: removeStatement,
});

/** One mutant before its text is built: where it is, what it changes, and the change. */
interface MutantSite {
  line: number;
  /** The 0-based column of the start of the code it changes (on `line`). */
  column: number;
  description: string;
  edit: Edit;
}

/**
 * Every change a mutant can make to `source` that starts on one of `lines`, in source order. A Vue
 * component's script blocks and template expressions are mutated; the rest of it is markup (#425).
 */
function mutationSites(file: string, source: string, lines: ReadonlySet<number>): MutantSite[] {
  const found: Array<Omit<MutantSite, 'column'> & { start: number; order: number }> = [];
  for (const region of codeRegions(file, source)) {
    const { ast, tokens } = parseSource(region.text, file);
    walk(ast, (node, ancestors) => {
      const line = region.firstLine + node.loc.start.line - 1;
      const mutator = MUTATORS[node.type];
      if (!mutator || !lines.has(line)) return;
      const change = mutator({ node, ancestors, source: region.text, tokens });
      if (!change) return;
      const [from, to, replacement] = change.edit;
      found.push({
        start: region.offset + node.range[0],
        order: found.length,
        line,
        description: change.description,
        edit: [region.offset + from, region.offset + to, replacement],
      });
    });
  }
  return found
    .sort((a, b) => a.line - b.line || a.start - b.start || a.order - b.order)
    .map(({ line, start, description, edit }) => ({ line, column: start - source.lastIndexOf('\n', start - 1) - 1, description, edit }));
}

/** The mutant a site makes: the whole file's text with that one change applied. */
const mutantAt = (file: string, source: string, { line, description, edit: [from, to, replacement] }: MutantSite): Mutant => ({
  file,
  line,
  description,
  source: source.slice(0, from) + replacement + source.slice(to),
});

/** Every mutant of `source` whose change starts on one of `addedLines`, in source order (`mutationSites`). */
export function generateMutants(file: string, source: string, addedLines: ReadonlySet<number>): Mutant[] {
  return mutationSites(file, source, addedLines).map((site) => mutantAt(file, source, site));
}

// -------------------------------------------------------------------------------------------
// orderPinSites: the order a test pinning earlier behaviour is tried in
// -------------------------------------------------------------------------------------------

/**
 * The most mutants a `none (regression)` row of an exempt chunk is run against. A whole game can give
 * thousands; each mutant is one vitest run of the row's file, so this bounds the check to a hundred
 * runs of that file, each under the same time limit as any other mutant. The check stops once every
 * test in the file has failed, so a file whose tests pin something real usually needs far fewer.
 */
export const PIN_MUTANT_CAP = 100;

/** The coverage setup file's name in the run's scratch directory (`test-step-coverage.ts`). */
const COVERAGE_SETUP_NAME = 'coverage-setup.mjs';

/** A game module a pinning test runs, with the places of one rank in it, in source order. */
interface PinModule<T> {
  path: string;
  /** Lower ranks come first (`pinSites` says what a rank is). */
  rank: number;
  mutants: T[];
}

/**
 * Every module's mutants in the order a pin tries them, the same every time: ranks in order, lowest
 * first, all of one before any of the next. Within a rank, one mutant per module per round (modules
 * by path), and each module's mutants in an order that spreads any first few across its whole length
 * (`spreadOrder`) rather than taking them from its top.
 */
export function orderPinSites<T>(modules: ReadonlyArray<PinModule<T>>): T[] {
  const ordered: T[] = [];
  for (const rank of [...new Set(modules.map((m) => m.rank))].sort((a, b) => a - b)) {
    const lists = modules
      .filter((m) => m.rank === rank)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((m) => spreadOrder(m.mutants.length).map((k) => m.mutants[k]));
    for (let round = 0; round < Math.max(0, ...lists.map((l) => l.length)); round++) {
      for (const list of lists) if (round < list.length) ordered.push(list[round]);
    }
  }
  return ordered;
}

/** `0..count-1` in an order whose every prefix is spread across the range: halves, then quarters, and so on. */
export function spreadOrder(count: number): number[] {
  const order: number[] = [];
  const queue: Array<[number, number]> = [[0, count]];
  while (queue.length > 0) {
    const [from, to] = queue.shift()!;
    if (from >= to) continue;
    const middle = (from + to) >> 1;
    order.push(middle);
    queue.push([from, middle], [middle + 1, to]);
  }
  return order;
}

// -------------------------------------------------------------------------------------------
// Running vitest with one mutant in place
// -------------------------------------------------------------------------------------------

/**
 * The project's own vitest config, extended with the mutant loader and test locations, and with the
 * coverage setup file (`COVERAGE_SETUP`) on a run that records which game code a pin runs.
 */
function wrapperConfig(workDir: string, projectConfig: string | undefined): string {
  const importBase = projectConfig
    ? `import base from ${JSON.stringify(relative(workDir, projectConfig).split(sep).join('/'))};`
    : 'const base = {};';
  return `// Generated by boardsmith test-step-check or boardsmith verify; removed when the check ends.
import { readFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vitest/config';
${importBase}

const mutantPath = process.env.BOARDSMITH_MUTANT;
const mutant = mutantPath ? JSON.parse(readFileSync(mutantPath, 'utf-8')) : null;

export default defineConfig(async (env) =>
  mergeConfig(typeof base === 'function' ? await base(env) : base, {
    plugins: [
      {
        name: 'boardsmith-mutant',
        enforce: 'pre',
        load(id) {
          return mutant && id.split('?')[0] === mutant.file ? mutant.source : null;
        },
      },
    ],
    test: {
      includeTaskLocation: true,
      ...(process.env.BOARDSMITH_COVERAGE ? { setupFiles: [${JSON.stringify(join(workDir, COVERAGE_SETUP_NAME))}] } : {}),
    },
  }),
);
`;
}

interface Outcome {
  /** Manifest path of the test file. */
  path: string;
  fullName: string;
  line: number | undefined;
  status: string;
}

type RunResult =
  | {
      kind: 'ran';
      outcomes: Outcome[];
      filesRun: Set<string>;
      /** Test files that failed as a whole, such as one that could not be imported. */
      failedFiles: string[];
      exitCode: number | null;
      ms: number;
    }
  | { kind: 'timed-out' };

/** Which tests a run runs: the named chunk test files, or everything the project's config collects. */
type RunScope = ChunkTestFile[] | 'whole-suite';

interface Runner {
  /**
   * With `bail`, vitest stops at the first failing test: enough to know a mutant was caught. With
   * `coverage`, each test file writes which game code it ran into that directory (`readCoverage`).
   */
  run(
    scope: RunScope,
    mutant: { absPath: string; source: string } | null,
    timeoutMs: number,
    options?: { bail?: boolean; coverage?: string },
  ): Promise<RunResult>;
  dispose(): Promise<void>;
}

/**
 * Runs vitest to its end, or kills it and every worker it started once `timeoutMs` passes (a mutant
 * can turn a loop infinite). Resolves with its exit code, or false when it was killed.
 */
function runVitest(
  bin: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ exitCode: number | null } | false> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: options.cwd, env: options.env, stdio: 'ignore', detached: true });
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      resolve(false);
    }, options.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not run vitest in ${options.cwd}: ${err.message}`));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode });
    });
  });
}

/**
 * The outcomes in vitest's JSON report, for the test files `pathOf` names (it returns undefined for
 * a file the run is not about). A file that failed with no failing test, such as one that could not
 * be imported, is in `failedFiles`.
 */
async function readReport(
  reportPath: string,
  pathOf: (realPath: string) => string | undefined,
): Promise<{ outcomes: Outcome[]; filesRun: Set<string>; failedFiles: string[] }> {
  let report: {
    testResults?: Array<{ name: string; status?: string; assertionResults: Array<Record<string, unknown>> }>;
  };
  try {
    report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
  } catch {
    throw new Error(
      'vitest exited without writing its report, so the test run could not be read.\n' +
        'Run `boardsmith test` in the project to see why the suite does not start, fix that, and run this check again.',
    );
  }
  const outcomes: Outcome[] = [];
  const filesRun = new Set<string>();
  const failedFiles: string[] = [];
  for (const fileResult of report.testResults ?? []) {
    const path = pathOf(realpathSync(fileResult.name));
    if (path === undefined) continue;
    filesRun.add(path);
    const assertions = fileResult.assertionResults;
    if (fileResult.status === 'failed' && !assertions.some((a) => a.status === 'failed')) failedFiles.push(path);
    for (const a of assertions) {
      outcomes.push({
        path,
        fullName: a.fullName as string,
        line: (a.location as { line: number } | null | undefined)?.line,
        status: a.status as string,
      });
    }
  }
  return { outcomes, filesRun, failedFiles };
}

/**
 * `testFiles` names the chunk's test files by their manifest paths; a file outside them is named by
 * its path in the project. `workName` is the scratch directory the run's generated files live in,
 * one per kind of check, so two checks in one project never share one.
 */
async function createRunner(projectDir: string, testFiles: ChunkTestFile[], workName: string): Promise<Runner> {
  const vitestBin = join(projectDir, 'node_modules', '.bin', 'vitest');
  if (!existsSync(vitestBin)) {
    throw new Error(
      `vitest is not installed in ${projectDir}.\n` +
        'Run `npm install` in the project (vitest is one of its devDependencies), then run this check again.',
    );
  }
  const workDir = join(scratchDir(projectDir), workName);
  await fs.mkdir(workDir, { recursive: true });
  const configPath = join(workDir, 'vitest.config.mts');
  const mutantPath = join(workDir, 'mutant.json');
  const reportPath = join(workDir, 'report.json');
  const projectConfig = VITEST_CONFIG_NAMES.map((n) => join(projectDir, n)).find((p) => existsSync(p));
  await fs.writeFile(configPath, wrapperConfig(workDir, projectConfig));
  await fs.writeFile(join(workDir, COVERAGE_SETUP_NAME), COVERAGE_SETUP);

  const byRealPath = new Map(testFiles.map((f) => [realpathSync(f.absPath), f.path]));

  return {
    async run(scope, mutant, timeoutMs, options = {}) {
      await fs.rm(reportPath, { force: true });
      const env = { ...process.env };
      delete env.BOARDSMITH_MUTANT;
      delete env.BOARDSMITH_COVERAGE;
      if (options.coverage) Object.assign(env, coverageEnv(options.coverage, projectDir));
      if (mutant) {
        await fs.writeFile(mutantPath, JSON.stringify({ file: realpathSync(mutant.absPath), source: mutant.source }));
        env.BOARDSMITH_MUTANT = mutantPath;
      }
      const args = [
        'run',
        '--root', projectDir,
        '--config', configPath,
        '--reporter=json',
        `--outputFile=${reportPath}`,
        ...(options.bail ? ['--bail=1'] : []),
        ...(scope === 'whole-suite'
          ? []
          : scope.map((f) => relative(projectDir, realpathSync(f.absPath)).split(sep).join('/'))),
      ];
      const started = Date.now();
      const finished = await runVitest(vitestBin, args, { cwd: projectDir, env, timeoutMs });
      if (!finished) return { kind: 'timed-out' };

      const read = await readReport(reportPath, (realPath) =>
        byRealPath.get(realPath) ??
        (scope === 'whole-suite' ? relative(projectDir, realPath).split(sep).join('/') : undefined),
      );
      return { kind: 'ran', ...read, exitCode: finished.exitCode, ms: Date.now() - started };
    },
    async dispose() {
      await fs.rm(workDir, { recursive: true, force: true });
    },
  };
}

// -------------------------------------------------------------------------------------------
// runMutationCheck
// -------------------------------------------------------------------------------------------

export interface MutationSummary {
  /** Files that were mutated: the code the chunk changed, and the game code a pin runs. */
  files: number;
  mutants: number;
  /** Mutants that made at least one chunk test fail. */
  killed: number;
  survived: number;
  timedOut: number;
}

interface MutationCheckInput {
  projectDir: string;
  testFiles: ChunkTestFile[];
  /** Implementation files the chunk changed, with the lines it added (`addedImplementationLines`). */
  added: ReadonlyMap<string, ReadonlySet<number>>;
  /** The chunk's live Interpretation claims. */
  claims: number[];
  log: (line: string) => void;
}

const testKey = (o: { path: string; fullName: string }) => `${o.path} > ${o.fullName}`;

/** The test block a reported location belongs to. */
function blockAt(blocks: TestBlock[], line: number | undefined): TestBlock | undefined {
  if (line === undefined) return undefined;
  return blocks.find((b) => b.line <= line && line <= b.endLine);
}

/** The unmutated run must reach every chunk test file and pass every test in it. */
function baselineFindings(testFiles: ChunkTestFile[], baseline: RunResult & { kind: 'ran' }): TestStepFinding[] {
  const notRun = testFiles
    .filter((f) => !baseline.filesRun.has(f.path))
    .map((f) => ({
      kind: 'test-not-run' as const,
      subject: f.path,
      detail: `vitest did not run ${f.path}. Check that the project's vitest config includes it, then run this check again.`,
    }));
  const red = baseline.outcomes
    .filter((o) => o.status === 'failed')
    .map((o) => ({
      kind: 'suite-not-green' as const,
      subject: testKey(o),
      detail: "This test fails before anything is mutated. Make the chunk's tests pass first; mutation only means something on a green suite.",
    }));
  return [...notRun, ...red];
}

type LocatedMutant = Mutant & { absPath: string };

/** A mutant of the chunk check, and the manifest paths of the test files it runs against. */
type TargetedMutant = LocatedMutant & { targets: ReadonlySet<string> };

/** Whether a test file pins earlier behaviour, so its mutants come from the game code it runs. */
const isPin = (file: ChunkTestFile) => file.pin !== undefined;

/** Every line number of `source`. */
const allLines = (source: string) => new Set(source.split('\n').map((_, i) => i + 1));

async function collectMutants(
  projectDir: string,
  added: ReadonlyMap<string, ReadonlySet<number>>,
  summary: MutationSummary,
): Promise<LocatedMutant[]> {
  const mutants: LocatedMutant[] = [];
  for (const [file, lines] of added) {
    const absPath = join(projectDir, file);
    const fileMutants = generateMutants(file, await fs.readFile(absPath, 'utf-8'), lines);
    if (fileMutants.length > 0) summary.files++;
    mutants.push(...fileMutants.map((m) => ({ ...m, absPath })));
  }
  return mutants;
}

/**
 * The chunk check's mutants of the lines the chunk added, each with the test files it runs against:
 * every file that is not a pin (a pin is tried on the game code it runs, `killPinTests`). A mutant
 * two files share runs once, against both.
 */
async function chunkMutants(projectDir: string, input: MutationCheckInput, files: Set<string>): Promise<TargetedMutant[]> {
  const unpinned = new Set(input.testFiles.filter((f) => !isPin(f)).map((f) => f.path));
  if (unpinned.size === 0) return [];
  const mutants: TargetedMutant[] = [];
  for (const [file, lines] of input.added) {
    const absPath = join(projectDir, file);
    for (const mutant of generateMutants(file, await fs.readFile(absPath, 'utf-8'), lines)) {
      mutants.push({ ...mutant, absPath, targets: unpinned });
      files.add(file);
    }
  }
  return mutants;
}

/** A module under `src/` a mutant can change: a script or component that is not a test. */
const isGameModule = (path: string) =>
  path.startsWith('src/') && /\.(ts|mts|cts|js|mjs|vue)$/.test(path) && !/\.(test|spec|d)\.[a-z]+$/.test(path);

/** A place a pin runs that a mutant can change, and the tests that run it (indexes into `FileCoverage.tests`). */
interface PinSite {
  path: string;
  text: string;
  site: MutantSite;
  tests: number[];
}

/** What a pin was tried against, for the finding when one of its tests survives. */
interface PinPlan {
  /** By test key (`testKeyOf`): how many places it runs that a mutant can change, and how many were broken. */
  perTest: Map<string, { runnable: number; tried: number }>;
  /** Game modules it runs that the check could not read, with why. */
  unreadable: Array<{ path: string; reason: string }>;
  /** Game modules it runs that it mocks, so their code is not what it pins. */
  mocked: string[];
}

/**
 * Every place in the game code a pin runs (`coverage`) that a mutant can change, in the order it is
 * tried (`orderPinSites`), leaving out modules it mocks and any module the check cannot read (named
 * instead of stopping the check). Ranks, lowest first:
 *
 *   - 0: places on a line this chunk changed, which is what a pin in a refactor exists to hold;
 *   - n: places n of the file's tests run, so code a test runs on its own comes before setup every
 *     test shares;
 *   - last: places that run only while the file loads or between tests (module-level data and
 *     set-up hooks), which any test may read.
 */
async function pinSites(
  projectDir: string,
  test: ChunkTestFile,
  coverage: FileCoverage,
  added: ReadonlyMap<string, ReadonlySet<number>>,
): Promise<{ sites: PinSite[]; unreadable: PinPlan['unreadable']; mocked: string[] }> {
  const unreadable: PinPlan['unreadable'] = [];
  const mocked: string[] = [];
  const modules: Array<PinModule<PinSite>> = [];
  for (const path of coverage.modules.filter(isGameModule)) {
    if (test.pin!.mocked.includes(path)) {
      mocked.push(path);
      continue;
    }
    const text = await fs.readFile(join(projectDir, path), 'utf-8');
    let sites: MutantSite[];
    try {
      sites = mutationSites(path, text, allLines(text));
    } catch (error) {
      if (!(error instanceof UnreadableSourceError)) throw error;
      unreadable.push({ path, reason: error.reason });
      continue;
    }
    const changed = added.get(path) ?? new Set<number>();
    const byRank = new Map<number, PinSite[]>();
    for (const site of sites) {
      const runs = coverage.runs(path, site.line, site.column);
      if (!runs.ran) continue;
      const rank = changed.has(site.line) ? 0 : runs.tests.length > 0 ? runs.tests.length : coverage.tests.length + 1;
      byRank.set(rank, [...(byRank.get(rank) ?? []), { path, text, site, tests: runs.tests }]);
    }
    for (const [rank, mutants] of byRank) modules.push({ path, rank, mutants });
  }
  return { sites: orderPinSites(modules), unreadable, mocked };
}

/**
 * Tries a pin's tests on the game code they run: in turn, each test that no mutant has yet made fail
 * gets the next place it runs, in `pinSites` order (a place that runs only while the file loads
 * counts as run by every test), until every test has failed or `PIN_MUTANT_CAP` mutants have run.
 * Each mutant runs against the whole file, and any test it makes fail is credited. Taking turns gives
 * every test still standing its own share of the cap, most specific to it first.
 */
async function killPinTests(
  runner: Runner,
  input: MutationCheckInput,
  pin: ChunkTestFile,
  tracked: Outcome[],
  coverage: FileCoverage,
  timeoutMs: number,
  summary: MutationSummary,
  files: Set<string>,
): Promise<{ killed: Set<string>; plan: PinPlan }> {
  const { sites, unreadable, mocked } = await pinSites(realpathSync(input.projectDir), pin, coverage, input.added);
  const tests = tracked.filter((o) => o.path === pin.path);
  const queues = new Map(
    tests.map((o) => {
      const index = coverage.tests.indexOf(testKeyOf(o.fullName, o.line));
      if (index < 0) {
        throw new Error(
          `The run that records which game code ${pin.path} runs has no record of its test "${o.fullName}", so the ` +
            'mutation check cannot tell what that test pins. This is a BoardSmith bug: file an issue with the test file attached.',
        );
      }
      return [testKey(o), sites.filter((s) => s.tests.length === 0 || s.tests.includes(index))] as const;
    }),
  );
  const plan: PinPlan = {
    perTest: new Map([...queues].map(([key, queue]) => [key, { runnable: queue.length, tried: 0 }])),
    unreadable,
    mocked,
  };
  const killed = new Set<string>();
  const tried = new Set<PinSite>();
  const limit = Math.min(PIN_MUTANT_CAP, sites.length);
  while (tried.size < limit) {
    let ranThisRound = false;
    for (const [key, queue] of queues) {
      if (tried.size >= limit) break;
      if (killed.has(key)) continue;
      const next = queue.find((s) => !tried.has(s));
      if (!next) continue;
      tried.add(next);
      ranThisRound = true;
      const mutant = { ...mutantAt(next.path, next.text, next.site), absPath: join(realpathSync(input.projectDir), next.path) };
      files.add(next.path);
      input.log(`mutant ${tried.size}/${limit}: ${mutant.file}:${mutant.line} ${mutant.description}`);
      const result = await runner.run([pin], mutant, timeoutMs);
      summary.mutants++;
      if (result.kind === 'timed-out') {
        summary.timedOut++;
        continue;
      }
      const failed = result.outcomes.filter((o) => o.status === 'failed');
      summary[failed.length > 0 ? 'killed' : 'survived']++;
      failed.forEach((o) => killed.add(testKey(o)));
    }
    if (!ranThisRound) break;
  }
  for (const [key, queue] of queues) plan.perTest.get(key)!.tried = queue.filter((s) => tried.has(s)).length;
  return { killed, plan };
}

/**
 * Runs each mutant against the test files it targets that still hold a test no mutant has failed,
 * and returns the keys of every test some mutant made fail. Stops once every test has failed.
 */
async function killTests(
  runner: Runner,
  input: MutationCheckInput,
  tracked: Outcome[],
  mutants: TargetedMutant[],
  timeoutMs: number,
  summary: MutationSummary,
): Promise<Set<string>> {
  const killed = new Set<string>();
  for (const [i, mutant] of mutants.entries()) {
    const remaining = tracked.filter((o) => !killed.has(testKey(o)));
    if (remaining.length === 0) break;
    const files = input.testFiles.filter((f) => mutant.targets.has(f.path) && remaining.some((o) => o.path === f.path));
    if (files.length === 0) continue;
    input.log(`mutant ${i + 1}/${mutants.length}: ${mutant.file}:${mutant.line} ${mutant.description}`);
    const result = await runner.run(files, mutant, timeoutMs);
    summary.mutants++;
    if (result.kind === 'timed-out') {
      summary.timedOut++;
      continue;
    }
    const failed = result.outcomes.filter((o) => o.status === 'failed');
    summary[failed.length > 0 ? 'killed' : 'survived']++;
    failed.forEach((o) => killed.add(testKey(o)));
  }
  return killed;
}

/** Every claim none of whose tests ever failed, then every test that never failed. */
function survivorFindings(
  input: MutationCheckInput,
  tracked: Outcome[],
  killed: ReadonlySet<string>,
  mutantCount: number,
  plans: ReadonlyMap<string, PinPlan>,
): TestStepFinding[] {
  const blocksByPath = new Map(input.testFiles.map((f) => [f.path, findTestBlocks(f.source, f.path)]));
  const claimTests = new Map<number, Outcome[]>();
  for (const o of tracked) {
    for (const c of blockAt(blocksByPath.get(o.path) ?? [], o.line)?.claims ?? []) {
      claimTests.set(c, [...(claimTests.get(c) ?? []), o]);
    }
  }
  const claimFindings = input.claims
    .filter((claim) => claimTests.has(claim) && !claimTests.get(claim)!.some((o) => killed.has(testKey(o))))
    .map((claim) => ({
      kind: 'claim-survives-mutation' as const,
      subject: `claim ${claim}`,
      detail:
        mutantCount === 0
          ? `This chunk added no implementation line that could be changed, so nothing shows the tests for claim ${claim} can fail. A claim needs code that implements it.`
          : `None of the ${claimTests.get(claim)!.length} test(s) citing claim ${claim} failed under any of ${mutantCount} small breaks ` +
            "of this chunk's code. They do not pin the claim: assert on the outcome the claim describes, reached through the game.",
    }));
  const pins = new Map(input.testFiles.filter(isPin).map((f) => [f.path, f]));
  const testFindings = tracked
    .filter((o) => !killed.has(testKey(o)))
    .map((o) => ({
      kind: 'test-survives-mutation' as const,
      subject: testKey(o),
      detail: pins.has(o.path) ? pinSurvivorDetail(pins.get(o.path)!, plans.get(o.path)!, testKey(o)) : CHUNK_SURVIVOR_DETAIL,
    }));
  return [...claimFindings, ...testFindings];
}

/** What a surviving test of a `none (regression)` row was tried against, and what to do. */
function pinSurvivorDetail(file: ChunkTestFile, plan: PinPlan, key: string): string {
  const fix = 'assert the outcome the pinned behaviour produces, reached by running the game, not a value the test set up itself, a mock or a constant.';
  const skipped = [
    ...plan.unreadable.map(({ path, reason }) => `${path} (${reason})`),
    ...plan.mocked.map((path) => `${path} (mocked by this file)`),
  ];
  const left = skipped.length > 0 ? ` Not mutated: ${skipped.join(', ')}.` : '';
  const { runnable, tried } = plan.perTest.get(key)!;
  if (runnable === 0) {
    return (
      `${file.path} pins earlier behaviour (its row is none (regression)), but this test runs no game code under src/ ` +
      `that a mutant can change, so nothing shows it can fail.${left} Import the game module whose behaviour it ` +
      `pins, run it, and ${fix}`
    );
  }
  const sample =
    tried === runnable
      ? `all ${tried} places in the game code it runs that a mutant can change`
      : `${tried} of the ${runnable} places in the game code it runs that a mutant can change (the other ` +
        `${runnable - tried} were not tried: the check runs at most ${PIN_MUTANT_CAP} mutants per file, shared ` +
        "between the tests still passing, each test's most specific code first)";
  return `This test passed with each of ${sample} broken in turn, so it did not fail when that code was wrong.${left} ` +
    `It pins earlier behaviour: ${fix}`;
}

const CHUNK_SURVIVOR_DETAIL =
        "This test passed under every small break of this chunk's code, so it cannot fail when the code is wrong. " +
        'It asserts something the chunk does not control (a value it set up itself, a mock, a constant). Rewrite it ' +
        'to assert what the game does, or delete it if another test already pins that. A test that scans source ' +
        'as text (the a11y floor\'s colour-literal or asset scan) is a guard: move it to tests/guards/ and take it ' +
        'out of the Spec Manifest (build/test.md "The A11y Floor").';

/** Runs the pins once more, unmutated, recording the game code each of their tests runs (`test-step-coverage.ts`). */
async function pinCoverage(runner: Runner, projectDir: string, pins: ChunkTestFile[]): Promise<Map<string, FileCoverage>> {
  const coverage = new Map<string, FileCoverage>();
  if (pins.length === 0) return coverage;
  const dir = await fs.mkdtemp(join(scratchDir(projectDir), 'coverage-'));
  try {
    const run = await runner.run(pins, null, 10 * 60_000, { coverage: dir });
    if (run.kind !== 'ran') throw new Error('The run that records which game code the pinning tests run did not finish within 10 minutes.');
    for (const pin of pins) coverage.set(pin.path, await readCoverage(dir, projectDir, pin.absPath, pin.path));
    return coverage;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Runs the chunk's tests once unmutated (they must all pass), then once per mutant, and reports
 * every claim and every test that no mutant made fail. A pin's mutants come from the game code it
 * runs (see the file comment).
 */
export async function runMutationCheck(
  input: MutationCheckInput,
): Promise<{ findings: TestStepFinding[]; summary: MutationSummary }> {
  const projectDir = realpathSync(input.projectDir);
  const summary: MutationSummary = { files: 0, mutants: 0, killed: 0, survived: 0, timedOut: 0 };
  const runner = await createRunner(projectDir, input.testFiles, 'test-step-check');
  try {
    const baseline = await runner.run(input.testFiles, null, 10 * 60_000);
    if (baseline.kind !== 'ran') throw new Error('The unmutated test run did not finish within 10 minutes.');
    const notGreen = baselineFindings(input.testFiles, baseline);
    if (notGreen.length > 0) return { findings: notGreen, summary };

    const tracked = baseline.outcomes.filter((o) => o.status === 'passed');
    const timeoutMs = Math.max(30_000, baseline.ms * 10);
    const files = new Set<string>();
    const mutants = await chunkMutants(projectDir, input, files);
    const unpinned = new Set(input.testFiles.filter((f) => !isPin(f)).map((f) => f.path));
    const killed = await killTests(runner, input, tracked.filter((o) => unpinned.has(o.path)), mutants, timeoutMs, summary);
    const pins = input.testFiles.filter(isPin);
    const coverage = await pinCoverage(runner, projectDir, pins);
    const plans = new Map<string, PinPlan>();
    for (const pin of pins) {
      const result = await killPinTests(runner, input, pin, tracked, coverage.get(pin.path)!, timeoutMs, summary, files);
      result.killed.forEach((key) => killed.add(key));
      plans.set(pin.path, result.plan);
    }
    summary.files = files.size;
    return { findings: survivorFindings(input, tracked, killed, mutants.length, plans), summary };
  } finally {
    await runner.dispose();
  }
}

// -------------------------------------------------------------------------------------------
// runDiffMutationCheck: `boardsmith verify`'s mutation check (#452)
// -------------------------------------------------------------------------------------------

/** A mutant the whole suite passed under: a change to the code no test noticed. */
interface SurvivingMutant {
  file: string;
  line: number;
  description: string;
}

interface DiffMutationInput {
  projectDir: string;
  /** Code files changed since the base, with the lines that changed (`changedSince` in verify.ts). */
  added: ReadonlyMap<string, ReadonlySet<number>>;
  /** Outcomes of earlier runs, reused where nothing the mutant depends on changed (`lib/mutant-cache.ts`). */
  cache: MutantCache;
  log: (line: string) => void;
}

/** Whether a finished run shows the suite noticed the change: a test or a file failed, or vitest exited non-zero. */
function suiteNoticed(result: RunResult & { kind: 'ran' }): boolean {
  return result.exitCode !== 0 || result.failedFiles.length > 0 || result.outcomes.some((o) => o.status === 'failed');
}

/** The tests and files of an unmutated run that failed, as `file > test` and `file`. */
function redParts(result: RunResult & { kind: 'ran' }): string[] {
  const red = [...result.outcomes.filter((o) => o.status === 'failed').map(testKey), ...result.failedFiles];
  if (red.length === 0 && result.exitCode !== 0) {
    red.push(`vitest exited with code ${result.exitCode} with no failing test: look for "Unhandled Errors" in \`boardsmith test\``);
  }
  return red;
}

type DiffOutcome = 'killed' | 'survived' | 'timed-out';

/** The summary count each outcome adds to. */
const COUNTED: Readonly<Record<DiffOutcome, 'killed' | 'survived' | 'timedOut'>> = Object.freeze({
  killed: 'killed',
  survived: 'survived',
  'timed-out': 'timedOut',
});

/** A whole-suite runner whose unmutated run passed, and the time limit a mutant's run gets. */
interface GreenRunner {
  runner: Runner;
  timeoutMs: number;
}

/**
 * Runs the whole suite once unmutated. Returns the runner when it passed; otherwise disposes of it
 * and names what failed, since a mutant proves nothing on a red suite.
 */
async function greenRunner(projectDir: string): Promise<GreenRunner | { notGreen: string[] }> {
  const runner = await createRunner(projectDir, [], 'verify-mutation');
  try {
    const baseline = await runner.run('whole-suite', null, 10 * 60_000);
    if (baseline.kind !== 'ran') throw new Error('The unmutated test run did not finish within 10 minutes.');
    if (!suiteNoticed(baseline)) return { runner, timeoutMs: Math.max(30_000, baseline.ms * 10) };
    await runner.dispose();
    return { notGreen: redParts(baseline) };
  } catch (error) {
    await runner.dispose();
    throw error;
  }
}

async function runMutant({ runner, timeoutMs }: GreenRunner, mutant: LocatedMutant): Promise<DiffOutcome> {
  const result = await runner.run('whole-suite', mutant, timeoutMs, { bail: true });
  if (result.kind === 'timed-out') return 'timed-out';
  return suiteNoticed(result) ? 'killed' : 'survived';
}

/**
 * Mutates the changed lines one change at a time and runs the whole suite against each mutant,
 * stopping a run at its first failure. Unlike the chunk check, nothing here is scoped to a chunk's
 * test files or claims: any test anywhere may catch a mutant, and a mutant none catches is reported
 * by file and line. A mutant that makes the suite run past its time limit (an infinite loop) is
 * counted as timed out, not as a survivor, since the suite did not pass.
 *
 * A mutant whose outcome `cache` holds is not run again (`reused` counts them). When any mutant
 * must run, the whole suite first runs once unmutated and must pass: `notGreen` then names what
 * failed, and no mutant is tried.
 */
export async function runDiffMutationCheck(
  input: DiffMutationInput,
): Promise<{ summary: MutationSummary; reused: number; survivors: SurvivingMutant[]; notGreen?: string[] }> {
  const projectDir = realpathSync(input.projectDir);
  const summary: MutationSummary = { files: 0, mutants: 0, killed: 0, survived: 0, timedOut: 0 };
  const mutants = await collectMutants(projectDir, input.added, summary);
  const known = mutants.map((m) => input.cache.get(m));

  let run: GreenRunner | undefined;
  if (known.includes(undefined)) {
    const started = await greenRunner(projectDir);
    if ('notGreen' in started) return { summary, reused: 0, survivors: [], notGreen: started.notGreen };
    run = started;
  }
  try {
    const survivors: SurvivingMutant[] = [];
    for (const [i, mutant] of mutants.entries()) {
      const stored = known[i];
      const label = `mutant ${i + 1}/${mutants.length}: ${mutant.file}:${mutant.line} ${mutant.description}`;
      input.log(stored === undefined ? label : `${label} (reused: ${stored})`);
      const outcome = stored ?? (await runMutant(run!, mutant));
      if (stored === undefined && outcome !== 'timed-out') input.cache.set(mutant, outcome);
      summary.mutants++;
      summary[COUNTED[outcome]]++;
      if (outcome === 'survived') survivors.push({ file: mutant.file, line: mutant.line, description: mutant.description });
    }
    return { summary, reused: known.filter((k) => k !== undefined).length, survivors };
  } finally {
    await run?.runner.dispose();
  }
}
