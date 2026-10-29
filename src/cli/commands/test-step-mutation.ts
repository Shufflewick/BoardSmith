/**
 * `test-step-mutation.ts` — the mutation half of `boardsmith test-step-check` (#290), and
 * `boardsmith mutate` (#1496, `runDiffMutationCheck` at the end of this file).
 *
 * A test that cannot fail proves nothing. The only way to know a test can fail is to break the
 * code it tests and watch. So this module makes small, single changes ("mutants") to the lines the
 * chunk added — flip a comparison, negate a condition, drop a statement, return `undefined` — and
 * runs the chunk's own test files against each one. Both checks try a sample of the changed lines'
 * mutants, picked by the HEAD commit (`sampleMutants`, #1486): at most 30 for the chunk check, 3 for
 * `boardsmith mutate`. The chunk check does not judge
 * a test file that loads a changed file but none a sampled mutant is in (#1487). A test that fails
 * under at least one mutant has been shown able to catch a regression; a test that no mutant disturbs is asserting nothing
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
 * tautology in that file would otherwise be credited too. Each run reports through a reporter of
 * our own (`wrapperConfig`), which records for every test how it ended and, when it failed, whether
 * an assertion of its own failed or only the code it ran threw (`isAssertionFailure`).
 *
 * One kind of test file is mutated differently: the `none (regression)` row of an exempt chunk
 * (#485), marked `ChunkTestFile.pin`. Such a chunk adds no game behaviour, so its own lines give no
 * mutant that could reach what the row pins, an earlier chunk's behaviour. Its mutants are made
 * instead from the game code the test runs, found by running it once with V8 coverage
 * (`test-step-coverage.ts`): at most `PIN_MUTANT_CAP` per such file, shared between its tests
 * (`killPinTests`). Those mutants run only against that file, and credit a test only when it fails
 * on an assertion of its own: a pin runs all of the game's setup, so a mutant that makes setup throw
 * fails any test in the file, which shows the code ran, not that the test checks what it does.
 */
import { spawn } from 'node:child_process';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
import { GLOBAL_SETUP_MARK, REACH_SETUP, reachEnv, readReach } from './test-step-reach.js';
import type { MutationBudget } from '../lib/mutation-budget.js';
import { withCommandBuildDir } from '../lib/command-build-dir.js';
import { readIfExists } from '../lib/read-if-exists.js';
import { VITEST_CONFIG_NAMES } from '../lib/test-run-scope.js';
import { toolCommand } from '../lib/run-tool.js';
import { SeededRandom } from '../../utils/random.js';

// -------------------------------------------------------------------------------------------
// generateMutants
// -------------------------------------------------------------------------------------------

interface Mutant {
  /** Project-relative path of the mutated file. */
  file: string;
  line: number;
  description: string;
  change: { offset: number; before: string; after: string };
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
  change: { offset: from, before: source.slice(from, to), after: replacement },
});

/** Every mutant of `source` whose change starts on one of `addedLines`, in source order (`mutationSites`). */
export function generateMutants(file: string, source: string, addedLines: ReadonlySet<number>): Mutant[] {
  return mutationSites(file, source, addedLines).map((site) => mutantAt(file, source, site));
}

/**
 * The most mutants of the changed lines a check tries (#1486, #1496). Each exists to show the tests
 * can fail, which a sample shows; trying every mutant made a first publish of a real game take hours.
 * `boardsmith mutate` runs at every merge, which must stay fast, so it tries 3.
 */
const CHUNK_SAMPLE_SIZE = 30;
const MUTATE_SAMPLE_SIZE = 3;

/**
 * At most `size` of `mutants`, in their order, picked by `seed`: the same seed picks the same ones.
 * Files take turns, one mutant each per round, so every changed file is tried (up to `size` of them)
 * and a file no test loads is still found.
 */
export function sampleMutants<T extends { file: string }>(mutants: readonly T[], seed: string, size: number): T[] {
  if (mutants.length <= size) return [...mutants];
  const random = new SeededRandom(seed);
  const byFile = new Map<string, number[]>();
  mutants.forEach((mutant, i) => byFile.set(mutant.file, [...(byFile.get(mutant.file) ?? []), i]));
  const turns = random.shuffle([...byFile.values()]).map((indexes) => random.shuffle(indexes));
  const picked = new Set<number>();
  for (let round = 0; picked.size < size; round++) {
    for (const indexes of turns) if (round < indexes.length && picked.size < size) picked.add(indexes[round]);
  }
  return mutants.filter((_, i) => picked.has(i));
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
const PIN_MUTANT_CAP = 100;

/** The coverage setup file's name in the run's scratch directory (`test-step-coverage.ts`). */
const COVERAGE_SETUP_NAME = 'coverage-setup.mjs';

/** The setup file's name in the run's scratch directory that records which test files load which files (`test-step-reach.ts`). */
const REACH_SETUP_NAME = 'reach-setup.mjs';

/** The generated modules that carry the mutant into every project of the run (`overlayModule`, `workspaceModule`). */
const OVERLAY_NAME = 'overlay.mjs';
const WORKSPACE_NAME = 'workspace.mjs';

/** The workspace files Vitest 3 looks for beside the root config, in its order (Vitest 4 reads none). */
const VITEST_WORKSPACE_NAMES = ['vitest.workspace', 'vitest.projects'].flatMap((base) =>
  ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'].map((ext) => base + ext),
);

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

/** The report the generated reporter writes, in the run's scratch directory (`wrapperConfig`). */
const REPORT_NAME = 'report.json';

/**
 * What every Vite server of the run is extended with: the mutant loader, test locations, and the
 * coverage setup file (`COVERAGE_SETUP`) on a run that records which game code a pin runs. Vitest
 * gives each workspace project its own Vite server from its own config, which inherits nothing from
 * the root config (#937), so the root config and each inline project (`hookProjects`) are extended
 * alike. A project named by a path is left as it is, for the reporter to refuse.
 */
function overlayModule(workDir: string): string {
  return `// Generated by boardsmith test-step-check or boardsmith verify; removed when the check ends.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mergeConfig } from 'vitest/config';

const mutantPath = process.env.BOARDSMITH_MUTANT;
export const mutant = mutantPath ? JSON.parse(readFileSync(mutantPath, 'utf-8')) : null;

export const overlay = () => ({
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
    ...(process.env.BOARDSMITH_REACH ? { setupFiles: [${JSON.stringify(join(workDir, REACH_SETUP_NAME))}] } : {}),
  },
});

export const hookProjects = (entries, base) => {
  const hooked = (project) => mergeConfig({
    ...project,
    ...(typeof project.extends === 'string' ? { extends: resolve(base, project.extends) } : {}),
    ...(typeof project.root === 'string' ? { root: resolve(base, project.root) } : {}),
  }, overlay());
  return entries.map((entry) =>
    typeof entry === 'string' ? entry : typeof entry === 'function' ? async (env) => hooked(await entry(env)) : Promise.resolve(entry).then(hooked),
  );
};
`;
}

/**
 * The game's workspace file (`BOARDSMITH_WORKSPACE`, set by `wrapperConfig`) with `hookProjects`
 * applied. Its `extends` and `root` are relative to the game's workspace file, not this one.
 */
function workspaceModule(): string {
  return `// Generated by boardsmith test-step-check or boardsmith verify; removed when the check ends.
import { dirname } from 'node:path';
import { hookProjects } from './${OVERLAY_NAME}';

const path = process.env.BOARDSMITH_WORKSPACE;
const { default: entries } = await import(path);

export default hookProjects(entries, dirname(path));
`;
}

/**
 * The project's own vitest config, extended with `overlayModule`, its inline projects with
 * `hookProjects`, its workspace file replaced by `workspaceModule`, and the reporter that writes
 * `REPORT_NAME` (replacing the project's reporters, whose output goes nowhere here). The reporter
 * refuses a run with a project whose Vite server lacks the mutant loader, since its tests would run
 * the original code, and on a run that records what each test file loads, marks one with a global
 * setup (`GLOBAL_SETUP_MARK`). It records each test's name the way vitest's JSON reporter does (its describe
 * titles and its own, joined by spaces), since `testKeyOf` matches that name to the coverage run's.
 */
function wrapperConfig(workDir: string, projectDir: string, projectConfig: string | undefined, vitestMajor: number): string {
  const importBase = projectConfig
    ? `import base from ${JSON.stringify(relative(workDir, projectConfig).split(sep).join('/'))};`
    : 'const base = {};';
  // Vitest looks for a workspace file beside the root config, which here is in `workDir`.
  const gameWorkspace = VITEST_WORKSPACE_NAMES.map((n) => join(projectDir, n)).find((p) => existsSync(p));
  return `// Generated by boardsmith test-step-check or boardsmith verify; removed when the check ends.
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import { hookProjects, mutant, overlay } from './${OVERLAY_NAME}';
${importBase}

const projectDir = ${JSON.stringify(projectDir)};
const writeReport = (report) => writeFileSync(${JSON.stringify(join(workDir, REPORT_NAME))}, JSON.stringify(report));
const STATUS = { pass: 'passed', fail: 'failed' };
// Vitest 3 sizes each pool from the root poolOptions before maxWorkers, and runs each pool's files at once (#955).
// Vitest 4 runs a project's files with that project's own maxWorkers.
const budgetProblems = (ctx, configs) => {
  const budget = Number(process.env.BOARDSMITH_WORKERS);
  if (!budget) return undefined;
  const settings = configs.flatMap((config) => [${vitestMajor >= 4 ? "\n    ...(config.maxWorkers > budget ? ['maxWorkers'] : [])," : ''}
    ...Object.entries(config.poolOptions ?? {}).flatMap(([pool, options]) =>
      ['maxThreads', 'maxForks', 'minThreads', 'minForks'].filter((key) => options?.[key] !== undefined).map((key) => \`poolOptions.\${pool}.\${key}\`)),
    ...(config.poolMatchGlobs?.length > 0 ? ['poolMatchGlobs'] : []),
    ...(config.typecheck?.enabled ? ['typecheck.enabled'] : []),
    ...(config.browser?.enabled ? ['browser.enabled'] : []),
  ]);
  const pools = new Set(ctx.projects.map((project) => project.config.pool));
  if (pools.size > 1) settings.push(\`a different pool per project (\${[...pools].join(', ')})\`);
  const custom = [...pools].filter((pool) => !['forks', 'threads', 'vmForks', 'vmThreads'].includes(pool));
  if (custom.length > 0) settings.push(\`the custom pool \${custom.join(', ')}\`);
  if (settings.length === 0) return undefined;
  return \`boardsmith.json "mutation" gives each Vitest run a budget of \${budget} test workers, but the project's Vitest config (or an environment variable such as VITEST_MAX_FORKS or VITEST_MAX_WORKERS) sets \${[...new Set(settings)].join(', ')}, \` +
    'which Vitest uses to run workers outside that budget. Remove those settings from the Vitest config and environment, or remove "mutation" from boardsmith.json to run mutants one at a time.';
};
const testsIn = (tasks) => tasks.flatMap((task) => (task.type === 'suite' ? testsIn(task.tasks) : [task]));
const reporter = {
  onInit(ctx) {
    this.ctx = ctx;
    const configs = [ctx.config, ...ctx.projects.map((project) => project.config)];
    if (process.env.BOARDSMITH_REACH && configs.some((config) => config.globalSetup?.length > 0)) {
      writeFileSync(process.env.BOARDSMITH_REACH + '/${GLOBAL_SETUP_MARK}', '');
    }
    const overBudget = budgetProblems(ctx, configs);
    if (overBudget) {
      this.refused = true;
      writeReport({ refused: overBudget });
      throw new Error(overBudget);
    }
    const unhooked = ctx.projects.filter((project) => !(project.vite ?? project.server).config.plugins.some((p) => p.name === 'boardsmith-mutant'));
    if (unhooked.length === 0) return;
    const refused = unhooked.map((project) => {
      const { configFile, root } = (project.vite ?? project.server).config;
      const where = './' + relative(projectDir, configFile || root).split('\\\\').join('/');
      return \`Vitest project "\${project.name ?? project.getName()}" (\${where.slice(2)}) does not load the mutation check's mutant, so its tests would run against the original code. \` +
        \`Name it in the workspace as an inline project, { \${configFile ? 'extends' : 'root'}: '\${where}' }, and run the check again.\`;
    }).join('\\n');
    this.refused = true;
    writeReport({ refused });
    throw new Error(refused);
  },
  onTaskUpdate(packs) {
    if (!mutant || !process.send || this.stopped) return;
    // Vitest sets duration only after retries, repeats and expected-failure inversion finish.
    const failed = new Set(packs.filter(([, result]) => result?.state === 'fail' && typeof result.duration === 'number').map(([id]) => id));
    if (failed.size === 0) return;
    const files = this.ctx.state.getFiles();
    if (!files.some((file) => testsIn(file.tasks).some((test) => failed.has(test.id)))) return;
    this.onFinished(files);
    this.stopped = true;
    process.send({ type: 'boardsmith-mutant-failed' });
  },
  onFinished(files = [], errors = []) {
    if (this.refused) return;
    const report = files.map((file) => ({
      path: file.filepath,
      failed: file.result?.state === 'fail',
      errors: (file.result?.errors ?? []).map((error) => String(error.message).split('\\n')[0]),
      tests: testsIn(file.tasks).map((test) => {
        const titles = [];
        for (let suite = test.suite; suite; suite = suite.suite) titles.unshift(suite.name);
        return {
          fullName: (test.name ? [...titles, test.name] : titles).join(' '),
          line: test.location?.line,
          status: STATUS[test.result?.state] ?? 'skipped',
          // What the mutation check needs of each error: its name, its first line, and whether vitest printed
          // an expected/actual diff for it, which it does only for an error that carried both values.
          errors: (test.result?.errors ?? []).map((error) => ({ name: error.nameStr ?? error.name, message: String(error.message).split('\\n')[0], diff: error.diff !== undefined })),
        };
      }),
    }));
    writeReport({ files: report, errors: errors.filter((error) => error?.message).map((error) => [error.name, String(error.message).split('\\n')[0]].filter(Boolean).join(': ')) });
  },
};

export default defineConfig(async (env) => {
  const config = mergeConfig(typeof base === 'function' ? await base(env) : base, overlay());
  // Vitest 3 reads inline projects from \`test.projects\` or an array \`test.workspace\`, relative to the root.
  for (const key of ['projects', 'workspace']) {
    if (Array.isArray(config.test[key])) config.test[key] = hookProjects(config.test[key], projectDir);
  }
  // Vitest 3 reads no workspace file once the config lists its projects.
  const workspace = config.test.projects || Array.isArray(config.test.workspace) ? null
    : typeof config.test.workspace === 'string' ? resolve(projectDir, config.test.workspace) : ${JSON.stringify(gameWorkspace ?? null)};
  if (workspace) {
    process.env.BOARDSMITH_WORKSPACE = workspace;
    config.test.workspace = ${JSON.stringify(join(workDir, WORKSPACE_NAME))};
  }
  config.test.reporters = [reporter];
  return config;
});
`;
}

/** What the generated reporter records of one error a failed test reported. */
interface ReportedError {
  /** The error's name (`Error`, `AssertionError`, a game's own class); none for a thrown non-error. */
  name: string | undefined;
  /** The first line of its message. */
  message: string;
  /** Whether vitest printed an expected/actual diff for it: the error carried both values. */
  diff: boolean;
}

/**
 * Whether an error a test failed with is an assertion failure, raised by the test's own check, rather
 * than one thrown by the code it ran. It is when vitest's `expect` or `assert` raised it (every
 * matcher, `toThrow` and `rejects` included, and `expect.fail`), when Node's `assert` did (both are
 * named `AssertionError`), or when it carried an expected and an actual value, which a snapshot
 * mismatch (`toMatchSnapshot`, `toMatchInlineSnapshot`) reports as a plain error. An error thrown by
 * game code carries neither: it shows the code ran, not that the test checks what it does. Nor does
 * a count of assertions (`expect.assertions`, `expect.hasAssertions`), which is not a check on an
 * outcome. Game code must never throw an `AssertionError` of its own; the engine does not.
 */
export const isAssertionFailure = ({ name, diff }: Pick<ReportedError, 'name' | 'diff'>): boolean => name === 'AssertionError' || diff;

/** One test file's entry in the report (`wrapperConfig`), with the project's absolute path of the file. */
interface ReportedFile {
  path: string;
  /** The file failed as a whole or holds a failed test. */
  failed: boolean;
  /** The first line of each error vitest reported for the file as a whole. */
  errors: string[];
  tests: Array<{ fullName: string; line?: number; status: Outcome['status']; errors: ReportedError[] }>;
}

interface Outcome {
  /** Manifest path of the test file. */
  path: string;
  fullName: string;
  line: number | undefined;
  status: 'passed' | 'failed' | 'skipped';
  /** Of a failed test: whether it failed on an assertion of its own (`isAssertionFailure`), not only on an error the code it ran threw. */
  failedOnAssertion: boolean;
  /** Of a failed test: the first line of its first error. */
  reason?: string;
}

type RunResult =
  | {
      kind: 'ran';
      outcomes: Outcome[];
      filesRun: Set<string>;
      /** Test files that failed as a whole, such as one that could not be imported. */
      failedFiles: FailedFile[];
      /** The first line of each error vitest reported outside any test file, such as an unhandled rejection. */
      unhandled: string[];
      exitCode: number | null;
      ms: number;
    }
  | { kind: 'timed-out' };

/** A test file that failed as a whole, with the first error vitest gave, project paths made relative. */
interface FailedFile {
  path: string;
  reason: string | undefined;
}

/**
 * Which tests a run runs: the named test files, or the test files the project's config collects that
 * import one of the `related` project files, directly or through other files (`vitest related`).
 */
type RunScope = ReadonlyArray<Pick<ChunkTestFile, 'absPath'>> | { related: string[] };

interface Runner {
  /** The run's own directory (`withCommandBuildDir`), which holds its generated files. */
  workDir: string;
  /** Waits for the active process group to stop and disappear; refuses any later run. */
  stop(): Promise<void>;
  /**
   * With `bail`, a mutant's run stops after a confirmed test failure, including running workers. With
   * `coverage`, each test file writes which game code it ran into that directory (`readCoverage`);
   * with `reach`, which project files its worker loaded (`readReach`). With `workers`, vitest runs at
   * most that many test workers, and the reporter refuses a config that would run more (#955).
   */
  run(
    scope: RunScope,
    mutant: { absPath: string; source: string } | null,
    timeoutMs: number,
    options?: { bail?: boolean; coverage?: string; reach?: string; workers?: number },
  ): Promise<RunResult>;
}

/**
 * Runs vitest to its end, or kills it and every worker it started once `timeoutMs` passes (a mutant
 * can turn a loop infinite). Resolves with its exit code, or false when it was killed. Not
 * `runVitestRecorded` (lib/vitest-run.ts): a mutant run needs that timeout and the kill of the
 * whole process group, and prints nothing. A mutant run with `bail` also stops on the reporter's
 * confirmed failure, after its partial report is written, and waits for its process group to disappear.
 */
function runVitest(
  bin: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; stopOnFailure: boolean },
): { finished: Promise<{ exitCode: number | null } | false>; stop: () => Promise<void> } {
  const child = spawn(bin, args, {
    cwd: options.cwd, env: options.env, detached: true,
    stdio: options.stopOnFailure ? ['ignore', 'ignore', 'ignore', 'ipc'] : 'ignore',
  });
  let killed = false;
  let groupKilled = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    try {
      process.kill(-child.pid!, 'SIGKILL');
      groupKilled = true;
    } catch {
      child.kill('SIGKILL');
    }
  };
  const closed = new Promise<void>((done) => child.once('close', () => done()));
  const reaped = closed.then(async () => {
    if (!groupKilled) return;
    // The leader's close can precede the OS reaping its orphaned workers.
    for (;;) {
      try {
        process.kill(-child.pid!, 0);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') return;
        if (code !== 'EPERM') {
          throw new Error(`Could not confirm that Vitest process group ${child.pid} stopped: ${String(error)}. Check the system process status before running mutation verification again.`);
        }
      }
      await delay(10);
    }
  });
  const finished = new Promise<{ exitCode: number | null } | false>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    child.on('message', (message) => {
      if (!options.stopOnFailure || (message as { type?: unknown })?.type !== 'boardsmith-mutant-failed') return;
      clearTimeout(timer);
      kill();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not run vitest in ${options.cwd}: ${err.message}`));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve(timedOut ? false : { exitCode });
    });
  });
  return {
    finished: finished.then(async (result) => { await reaped; return result; }),
    stop: async () => { kill(); await reaped; },
  };
}

/** The run's report as the reporter wrote it; throws when vitest left none, or one cut short. */
async function reportOnFile(reportPath: string): Promise<{ files: ReportedFile[]; errors: string[] } | { refused: string }> {
  const text = await readIfExists(reportPath, (p) => fs.readFile(p, 'utf-8'));
  try {
    if (text !== undefined) return JSON.parse(text);
  } catch {
    // A report cut short reads the same as none: the run did not finish writing it.
  }
  throw new Error(
    'vitest exited without writing its report, so the test run could not be read.\n' +
      'Run `boardsmith test` in the project to see why the suite does not start, fix that, and run this check again.',
  );
}

/**
 * The outcomes in the run's report, for the test files `pathOf` names (it returns undefined for a
 * file the run is not about). A file that failed with no failing test, such as one that could not
 * be imported, is in `failedFiles`.
 */
async function readReport(
  reportPath: string,
  projectDir: string,
  pathOf: (realPath: string) => string | undefined,
): Promise<{ outcomes: Outcome[]; filesRun: Set<string>; failedFiles: FailedFile[]; unhandled: string[] }> {
  const report = await reportOnFile(reportPath);
  if ('refused' in report) throw new Error(report.refused);
  const outcomes: Outcome[] = [];
  const filesRun = new Set<string>();
  const failedFiles: FailedFile[] = [];
  for (const file of report.files) {
    const path = pathOf(realpathSync(file.path));
    if (path === undefined) continue;
    filesRun.add(path);
    if (file.failed && !file.tests.some((t) => t.status === 'failed')) {
      failedFiles.push({ path, reason: file.errors[0]?.replaceAll(projectDir + sep, '') });
    }
    for (const test of file.tests) {
      outcomes.push({
        path,
        fullName: test.fullName,
        line: test.line,
        status: test.status,
        failedOnAssertion: test.status === 'failed' && test.errors.some(isAssertionFailure),
        reason: test.errors[0]?.message.replaceAll(projectDir + sep, ''),
      });
    }
  }
  return { outcomes, filesRun, failedFiles, unhandled: report.errors.map((error) => error.replaceAll(projectDir + sep, '')) };
}

/** Writes the generated vitest config of a run and the modules it loads; returns the config's path. */
export async function writeRunConfig(projectDir: string, workDir: string, vitestMajor: number): Promise<string> {
  const configPath = join(workDir, 'vitest.config.mts');
  const projectConfig = VITEST_CONFIG_NAMES.map((n) => join(projectDir, n)).find((p) => existsSync(p));
  await fs.writeFile(configPath, wrapperConfig(workDir, projectDir, projectConfig, vitestMajor));
  await fs.writeFile(join(workDir, OVERLAY_NAME), overlayModule(workDir));
  await fs.writeFile(join(workDir, WORKSPACE_NAME), workspaceModule());
  return configPath;
}

/**
 * The major version of the vitest that `node_modules/.bin/vitest` runs. npm, pnpm and yarn all link
 * a project's bin to the package at `node_modules/<name>`, and pnpm's bin is a script, not a link.
 * Refuses Vitest 2, which BoardSmith no longer supports (#1435).
 */
async function installedVitestMajor(projectDir: string): Promise<number> {
  const manifest = join('node_modules', 'vitest', 'package.json');
  let version: unknown;
  try {
    version = JSON.parse(await fs.readFile(join(projectDir, manifest), 'utf-8')).version;
  } catch {
    // A missing or unparsable manifest gets the same answer as a bad version: reinstall.
  }
  const major = typeof version === 'string' ? /^(\d+)\./.exec(version)?.[1] : undefined;
  if (major === undefined) {
    throw new Error(
      `Could not read the installed Vitest version from ${manifest}, so the mutation check cannot tell how Vitest will read the project's config.\n`
      + "Reinstall the project's dependencies with: npm install",
    );
  }
  if (Number(major) < 3) {
    throw new Error(
      `The mutation check needs Vitest 3 or later, and this project has Vitest ${String(version)} installed.\n`
      + 'Upgrade it with: npm install -D vitest@3',
    );
  }
  return Number(major);
}

/**
 * The vitest flags that hold a run to `workers` test workers, with `env` telling the reporter to
 * refuse a config that would run more (#955). Vitest 4 removed `--minWorkers` and rejects it.
 */
export function limitWorkers(workers: number | undefined, vitestMajor: number, env: NodeJS.ProcessEnv): string[] {
  if (!workers) return [];
  env.BOARDSMITH_WORKERS = String(workers);
  return vitestMajor >= 4 ? [`--maxWorkers=${workers}`] : [`--maxWorkers=${workers}`, '--minWorkers=1'];
}

/** The real paths of the test files a run asked for; undefined for a `related` run, which picks its own. */
function realPaths(scope: RunScope): string[] | undefined {
  return 'related' in scope ? undefined : scope.map((f) => realpathSync(f.absPath));
}

/** A reported file's manifest path, else its project path when the run asked for it; undefined for a file the run is not about. */
function pathInRun(projectDir: string, byRealPath: ReadonlyMap<string, string>, scopePaths: string[] | undefined): (realPath: string) => string | undefined {
  const inScope = scopePaths && new Set(scopePaths);
  return (realPath) => byRealPath.get(realPath) ?? (inScope?.has(realPath) === false ? undefined : relative(projectDir, realPath).split(sep).join('/'));
}

/**
 * `testFiles` names the chunk's test files by their manifest paths; a file outside them is named by
 * its path in the project. `workDir` is the directory this run of the check made for its generated
 * files (`withCommandBuildDir`), so two checks in one project never share one, and it removes it.
 */
async function createRunner(projectDir: string, testFiles: ChunkTestFile[], workDir: string): Promise<Runner> {
  // Resolved once, before any file is written: a project with no vitest of its own is refused here.
  const { command: vitestBin } = toolCommand('vitest', [], projectDir);
  const mutantPath = join(workDir, 'mutant.json');
  const reportPath = join(workDir, REPORT_NAME);
  const vitestMajor = await installedVitestMajor(projectDir);
  const configPath = await writeRunConfig(projectDir, workDir, vitestMajor);
  await fs.writeFile(join(workDir, COVERAGE_SETUP_NAME), COVERAGE_SETUP);
  await fs.writeFile(join(workDir, REACH_SETUP_NAME), REACH_SETUP);

  const byRealPath = new Map(testFiles.map((f) => [realpathSync(f.absPath), f.path]));
  let active: ReturnType<typeof runVitest> | undefined;
  let stopped = false;

  return {
    workDir,
    async stop() {
      stopped = true;
      await active?.stop();
    },
    async run(scope, mutant, timeoutMs, options = {}) {
      const checkStopped = () => {
        if (stopped) throw new Error('Mutation verification was interrupted. Run it again to finish the check.');
      };
      checkStopped();
      await fs.rm(reportPath, { force: true });
      const env = { ...process.env };
      delete env.BOARDSMITH_MUTANT;
      delete env.BOARDSMITH_COVERAGE;
      delete env.BOARDSMITH_REACH;
      delete env.BOARDSMITH_WORKERS;
      const workerFlags = limitWorkers(options.workers, vitestMajor, env);
      if (options.coverage) Object.assign(env, coverageEnv(options.coverage, projectDir));
      if (options.reach) Object.assign(env, reachEnv(options.reach, projectDir));
      if (mutant) {
        await fs.writeFile(mutantPath, JSON.stringify({ file: realpathSync(mutant.absPath), source: mutant.source }));
        env.BOARDSMITH_MUTANT = mutantPath;
      }
      const scopePaths = realPaths(scope);
      const args = [
        ...('related' in scope ? ['related', '--run', '--passWithNoTests', ...scope.related] : ['run']),
        '--root', projectDir,
        '--config', configPath,
        ...(options.bail ? ['--bail=1'] : []),
        ...workerFlags,
        ...(scopePaths ?? []).map((path) => relative(projectDir, path).split(sep).join('/')),
      ];
      const started = Date.now();
      checkStopped();
      active = runVitest(vitestBin, args, {
        cwd: projectDir, env, timeoutMs, stopOnFailure: mutant !== null && options.bail === true,
      });
      const finished = await active.finished;
      active = undefined;
      checkStopped();
      if (!finished) return { kind: 'timed-out' };

      const read = await readReport(reportPath, projectDir, pathInRun(projectDir, byRealPath, scopePaths));
      return { kind: 'ran', ...read, exitCode: finished.exitCode, ms: Date.now() - started };
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
  /** Mutants that made at least one chunk test fail; for a pin, fail on an assertion of its own (`killPinTests`). */
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
  /** Picks the sample of mutants tried (`sampleMutants`): the HEAD commit, so a re-run of it tries the same ones. */
  seed: string;
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
      detail: `This test fails before anything is mutated${o.reason ? `: ${o.reason}` : ''}. Make the chunk's tests pass first; mutation only means something on a green suite.`,
    }));
  const failedFiles = baseline.failedFiles.map(({ path, reason }) => ({
    kind: 'suite-not-green' as const,
    subject: path,
    detail:
      `${path} failed as a whole, so none of its tests passed${reason ? `: ${reason}` : ''}. ` +
      'Something outside a test failed: a beforeAll or afterAll hook, an import, or a file with no test in it. ' +
      'Run `boardsmith test` to see the full error, fix it, and run this check again.',
  }));
  // With every file run and none failed, redParts holds only why vitest still failed the run.
  const unexplained = notRun.length + red.length + failedFiles.length === 0 ? redParts(baseline) : [];
  const errored = unexplained.map((reason) => ({
    kind: 'suite-not-green' as const,
    subject: 'vitest',
    detail: `${reason}. Fix it so the unmutated run passes cleanly, then run this check again; mutation only means something on a green suite.`,
  }));
  return [...notRun, ...red, ...failedFiles, ...errored];
}

type LocatedMutant = Mutant & { absPath: string };

/** A mutant of the chunk check, and the manifest paths of the test files it runs against. */
type TargetedMutant = LocatedMutant & { targets: ReadonlySet<string> };

/** Whether a test file pins earlier behaviour, so its mutants come from the game code it runs. */
const isPin = (file: ChunkTestFile) => file.pin === true;

/** Every line number of `source`. */
const allLines = (source: string) => new Set(source.split('\n').map((_, i) => i + 1));

/** Every mutant of `added`'s lines, in file order. */
export async function collectMutants(projectDir: string, added: ReadonlyMap<string, ReadonlySet<number>>): Promise<LocatedMutant[]> {
  const mutants: LocatedMutant[] = [];
  for (const [file, lines] of added) {
    const absPath = join(projectDir, file);
    mutants.push(...generateMutants(file, await fs.readFile(absPath, 'utf-8'), lines).map((m) => ({ ...m, absPath })));
  }
  return mutants;
}

/**
 * The chunk check's sample of mutants of the lines the chunk added (`sampleMutants`), each with the test files it runs against:
 * every file that is not a pin (a pin is tried on the game code it runs, `killPinTests`). A mutant
 * two files share runs once, against both. `left` names the files with mutants none of which was sampled.
 */
async function chunkMutants(projectDir: string, input: MutationCheckInput, files: Set<string>): Promise<{ mutants: TargetedMutant[]; left: string[] }> {
  const unpinned = new Set(input.testFiles.filter((f) => !isPin(f)).map((f) => f.path));
  if (unpinned.size === 0) return { mutants: [], left: [] };
  const all = await collectMutants(projectDir, input.added);
  const mutants = sampleMutants(all, input.seed, CHUNK_SAMPLE_SIZE);
  for (const mutant of mutants) files.add(mutant.file);
  const left = [...new Set(all.map((m) => m.file))].filter((file) => !files.has(file));
  return { mutants: mutants.map((mutant) => ({ ...mutant, targets: unpinned })), left };
}

/**
 * The chunk test files the sample left out (#1487): each loads a changed file whose mutants were not
 * sampled and no file a sampled mutant is in, so its passing every mutant shows nothing.
 */
async function leftOutFiles(reachDir: string, projectDir: string, testFiles: Iterable<string>, mutants: TargetedMutant[], left: string[]): Promise<Set<string>> {
  const { testsLoading } = await readReach(reachDir, projectDir, testFiles);
  const reached = new Set(mutants.flatMap((m) => testsLoading(m.file)));
  return new Set(left.flatMap((file) => testsLoading(file)).filter((abs) => !reached.has(abs)).map((abs) => relative(projectDir, abs).split(sep).join('/')));
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
}

/**
 * Every place in the game code a pin runs (`coverage`) that a mutant can change, in the order it is
 * tried (`orderPinSites`), leaving out any module the check cannot read (named instead of stopping
 * the check). What the file mocks needs no rule of its own: coverage holds only what ran, so an
 * automocked module's functions are never here, and what a spy or partial mock lets run is. Ranks,
 * lowest first:
 *
 *   - 0: places on a line this chunk changed, which is what a pin in a refactor exists to hold;
 *   - n: places n of the file's tests run, so code a test runs on its own comes before setup every
 *     test shares;
 *   - last: places that run only while the file loads or between tests (module-level data and
 *     set-up hooks), which any test may read.
 */
async function pinSites(
  projectDir: string,
  coverage: FileCoverage,
  added: ReadonlyMap<string, ReadonlySet<number>>,
): Promise<{ sites: PinSite[]; unreadable: PinPlan['unreadable'] }> {
  const unreadable: PinPlan['unreadable'] = [];
  const modules: Array<PinModule<PinSite>> = [];
  for (const path of coverage.modules.filter(isGameModule)) {
    const text = await fs.readFile(join(projectDir, path), 'utf-8');
    let sites: MutantSite[];
    try {
      sites = mutationSites(path, text, allLines(text));
    } catch (error) {
      if (!(error instanceof UnreadableSourceError)) throw error;
      unreadable.push({ path, reason: error.reason });
      continue;
    }
    const byRank = rankPinSites(path, text, sites, coverage, added.get(path) ?? new Set<number>());
    for (const [rank, mutants] of byRank) modules.push({ path, rank, mutants });
  }
  return { sites: orderPinSites(modules), unreadable };
}

/** The sites of the module `path` a pin runs, by rank (`pinSites` says what a rank is). */
function rankPinSites(
  path: string,
  text: string,
  sites: MutantSite[],
  coverage: FileCoverage,
  changed: ReadonlySet<number>,
): Map<number, PinSite[]> {
  const byRank = new Map<number, PinSite[]>();
  for (const site of sites) {
    const runs = coverage.runs(path, site.line, site.column);
    if (!runs.ran) continue;
    const rank = changed.has(site.line) ? 0 : runs.tests.length > 0 ? runs.tests.length : coverage.tests.length + 1;
    const ranked = byRank.get(rank) ?? [];
    ranked.push({ path, text, site, tests: runs.tests });
    byRank.set(rank, ranked);
  }
  return byRank;
}

/**
 * For each of `pin`'s tests, by `testKey`, the sites it runs, in `pinSites` order; a site that runs
 * only while the file loads counts as run by every test.
 */
function pinQueues(
  pin: ChunkTestFile,
  tracked: Outcome[],
  coverage: FileCoverage,
  sites: PinSite[],
): Map<string, PinSite[]> {
  return new Map(
    tracked
      .filter((o) => o.path === pin.path)
      .map((o) => {
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
}

/**
 * Runs one mutant against `scope`, counts it in `summary` (timed out, killed or survived), and
 * returns the outcomes `credit` counts as catching it: none when the run timed out. A `scope` of
 * fewer than all the chunk's test files must pass unmutated on its own (`redApart`, #1340).
 */
async function runCounted(
  run: ApartRunner,
  scope: ChunkTestFile[],
  mutant: { absPath: string; source: string },
  summary: MutationSummary,
  credit: (outcome: Outcome) => boolean,
): Promise<Outcome[]> {
  const red = await redApart(run, scope.map((f) => f.absPath));
  if (red.length > 0) {
    throw apartError(
      `The chunk test files ${scope.map((f) => f.path).join(', ')} fail when run without the chunk's other test files, though together they pass`,
      red,
      '`boardsmith test-step-check <slug>`',
    );
  }
  const result = await run.runner.run(scope, mutant, run.timeoutMs);
  summary.mutants++;
  if (result.kind === 'timed-out') {
    summary.timedOut++;
    return [];
  }
  const credited = result.outcomes.filter(credit);
  summary[credited.length > 0 ? 'killed' : 'survived']++;
  return credited;
}

/**
 * Tries a pin's tests on the game code they run: in turn, each test no mutant has yet been credited
 * to gets the next place it runs, in `pinSites` order (a place that runs only while the file loads
 * counts as run by every test), until every test is credited or `PIN_MUTANT_CAP` mutants have run.
 * Each mutant runs against the whole file, and any test it makes fail on an assertion of its own is
 * credited (`isAssertionFailure`); a test it fails only by making the game throw is not, since every
 * pin runs setup. Taking turns gives every test still standing its own share of the cap, most
 * specific to it first.
 */
async function killPinTests(
  run: ApartRunner,
  input: MutationCheckInput,
  pin: ChunkTestFile,
  tracked: Outcome[],
  coverage: FileCoverage,
  summary: MutationSummary,
  files: Set<string>,
): Promise<{ killed: Set<string>; plan: PinPlan }> {
  const { sites, unreadable } = await pinSites(realpathSync(input.projectDir), coverage, input.added);
  const queues = pinQueues(pin, tracked, coverage, sites);
  const plan: PinPlan = {
    perTest: new Map([...queues].map(([key, queue]) => [key, { runnable: queue.length, tried: 0 }])),
    unreadable,
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
      const credited = await runCounted(run, [pin], mutant, summary, (o) => o.failedOnAssertion);
      credited.forEach((o) => killed.add(testKey(o)));
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
  run: ApartRunner,
  input: MutationCheckInput,
  tracked: Outcome[],
  mutants: TargetedMutant[],
  summary: MutationSummary,
): Promise<Set<string>> {
  const killed = new Set<string>();
  for (const [i, mutant] of mutants.entries()) {
    const remaining = tracked.filter((o) => !killed.has(testKey(o)));
    if (remaining.length === 0) break;
    const files = input.testFiles.filter((f) => mutant.targets.has(f.path) && remaining.some((o) => o.path === f.path));
    if (files.length === 0) continue;
    input.log(`mutant ${i + 1}/${mutants.length}: ${mutant.file}:${mutant.line} ${mutant.description}`);
    const failed = await runCounted(run, files, mutant, summary, (o) => o.status === 'failed');
    failed.forEach((o) => killed.add(testKey(o)));
  }
  return killed;
}

/** Every claim none of whose tests ever failed, then every test that never failed, but for those in `leftOut` files (`leftOutFiles`). */
function survivorFindings(
  input: MutationCheckInput,
  tracked: Outcome[],
  killed: ReadonlySet<string>,
  mutantCount: number,
  plans: ReadonlyMap<string, PinPlan>,
  leftOut: ReadonlySet<string>,
): TestStepFinding[] {
  const blocksByPath = new Map(input.testFiles.map((f) => [f.path, findTestBlocks(f.source, f.path)]));
  const claimTests = new Map<number, Outcome[]>();
  for (const o of tracked) {
    for (const c of blockAt(blocksByPath.get(o.path) ?? [], o.line)?.claims ?? []) {
      claimTests.set(c, [...(claimTests.get(c) ?? []), o]);
    }
  }
  const claimFindings = input.claims
    .filter((claim) => !claimTests.get(claim)?.some((o) => killed.has(testKey(o))))
    .filter((claim) => !claimTests.get(claim)?.every((o) => leftOut.has(o.path)))
    .map((claim) => ({
      kind: 'claim-survives-mutation' as const,
      subject: `claim ${claim}`,
      detail: !claimTests.has(claim)
        ? `No test citing claim ${claim} ran and passed, so nothing shows the claim is tested. ` +
          'Check for a skipped test or a stray .only, and that a test names the claim.'
        : mutantCount === 0
          ? `This chunk added no implementation line that could be changed, so nothing shows the tests for claim ${claim} can fail. A claim needs code that implements it.`
          : `None of the ${claimTests.get(claim)!.length} test(s) citing claim ${claim} failed under any of ${mutantCount} small breaks ` +
            "of this chunk's code. They do not pin the claim: assert on the outcome the claim describes, reached through the game.",
    }));
  const pins = new Map(input.testFiles.filter(isPin).map((f) => [f.path, f]));
  const testFindings = tracked
    .filter((o) => !killed.has(testKey(o)) && !leftOut.has(o.path))
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
  const skipped = plan.unreadable.map(({ path, reason }) => `${path} (${reason})`);
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
  return `With each of ${sample} broken in turn, this test never failed on an assertion of its own: it passed, or ` +
    'failed only because the broken code threw, which shows the code ran, not that the test checks what it does. ' +
    `(An expect, assert, toThrow or snapshot failure counts; an error thrown from the game or its setup does not.)${left} ` +
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
  const dir = join(runner.workDir, 'coverage');
  await fs.mkdir(dir);
  const run = await runner.run(pins, null, 10 * 60_000, { coverage: dir });
  if (run.kind !== 'ran') throw new Error('The run that records which game code the pinning tests run did not finish within 10 minutes.');
  for (const pin of pins) coverage.set(pin.path, await readCoverage(dir, projectDir, pin.absPath, pin.path));
  return coverage;
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
  let runner: Runner | undefined;
  return withCommandBuildDir(projectDir, 'test-step-check', async (workDir) => {
    runner = await createRunner(projectDir, input.testFiles, workDir);
    const reachDir = join(workDir, 'reach');
    await fs.mkdir(reachDir);
    const baseline = await runner.run(input.testFiles, null, 10 * 60_000, { reach: reachDir });
    if (baseline.kind !== 'ran') throw new Error('The unmutated test run did not finish within 10 minutes.');
    const notGreen = baselineFindings(input.testFiles, baseline);
    if (notGreen.length > 0) return { findings: notGreen, summary };

    const tracked = baseline.outcomes.filter((o) => o.status === 'passed');
    const run: ApartRunner = {
      runner,
      // Unresolved, as the test files' absPaths are, so a message names them by their project paths.
      projectDir: input.projectDir,
      timeoutMs: Math.max(30_000, baseline.ms * 10),
      suiteSize: input.testFiles.length,
      apart: new Map(),
    };
    const files = new Set<string>();
    const { mutants, left } = await chunkMutants(projectDir, input, files);
    const unpinned = new Set(input.testFiles.filter((f) => !isPin(f)).map((f) => f.path));
    const leftOut = await leftOutFiles(reachDir, projectDir, unpinned, mutants, left);
    if (leftOut.size > 0) input.log(`Not judged, as no sampled mutant was in a changed file they load: ${[...leftOut].join(', ')}`);
    const killed = await killTests(run, input, tracked.filter((o) => unpinned.has(o.path)), mutants, summary);
    const pins = input.testFiles.filter(isPin);
    const coverage = await pinCoverage(runner, projectDir, pins);
    const plans = new Map<string, PinPlan>();
    for (const pin of pins) {
      const result = await killPinTests(run, input, pin, tracked, coverage.get(pin.path)!, summary, files);
      result.killed.forEach((key) => killed.add(key));
      plans.set(pin.path, result.plan);
    }
    summary.files = files.size;
    return { findings: survivorFindings(input, tracked, killed, mutants.length, plans, leftOut), summary };
  }, () => runner?.stop());
}

// -------------------------------------------------------------------------------------------
// runDiffMutationCheck: `boardsmith mutate` (#452, #1496)
// -------------------------------------------------------------------------------------------

/** A mutant every test that loads its file passed under, or one in a file no test loads. */
interface SurvivingMutant {
  file: string;
  line: number;
  description: string;
}

interface DiffMutationInput {
  projectDir: string;
  /** Code files changed since the base, with the lines that changed (`changedSince` in verify.ts). */
  added: ReadonlyMap<string, ReadonlySet<number>>;
  log: (line: string) => void;
  /** How many mutants run at once and the test workers they share (boardsmith.json "mutation", #955); every sampled mutant at once without it. */
  budget?: MutationBudget;
}

interface DiffMutationResult {
  summary: MutationSummary & { unreached: number };
  survivors: SurvivingMutant[];
  /** Mutants in a file no test loads, so no test could catch them: neither killed nor survived. */
  unreached: SurvivingMutant[];
  /** Mutants whose run went past its time limit: not shown caught, since a busy machine looks the same. */
  timedOut: SurvivingMutant[];
  notGreen?: string[];
}

/** Whether a finished run shows the suite noticed the change: a test or a file failed, vitest exited non-zero, or it reported an unhandled error. */
function suiteNoticed(result: RunResult & { kind: 'ran' }): boolean {
  return result.exitCode !== 0 || result.unhandled.length > 0 || result.failedFiles.length > 0 || result.outcomes.some((o) => o.status === 'failed');
}

/** The tests and files of an unmutated run that failed, as `file > test: reason` and `file`, or why vitest failed the run without one. */
function redParts(result: RunResult & { kind: 'ran' }): string[] {
  const red = [...result.outcomes.filter((o) => o.status === 'failed').map((o) => (o.reason ? `${testKey(o)}: ${o.reason}` : testKey(o))), ...result.failedFiles.map((f) => f.path)];
  if (red.length === 0 && (result.exitCode !== 0 || result.unhandled.length > 0)) {
    red.push(result.unhandled.length > 0
      ? `vitest exited with code ${result.exitCode} with no failing test, on an unhandled error: ${result.unhandled.join('; ')}`
      : `vitest exited with code ${result.exitCode} with no failing test: look for "Unhandled Errors" in \`boardsmith test\``);
  }
  return red;
}

type DiffOutcome = 'killed' | 'survived' | 'timed-out' | 'unreached';

/** The summary count each outcome adds to. */
const COUNTED: Readonly<Record<DiffOutcome, 'killed' | 'survived' | 'timedOut' | 'unreached'>> = Object.freeze({
  killed: 'killed',
  survived: 'survived',
  'timed-out': 'timedOut',
  unreached: 'unreached',
});

/** A runner whose unmutated run of a whole set of test files passed, and what `redApart` needs to run part of it. */
interface ApartRunner {
  runner: Runner;
  projectDir: string;
  timeoutMs: number;
  /** How many test files the unmutated run ran. */
  suiteSize: number;
  /** What fails in an unmutated run of a set of test files without the rest of the suite (`redApart`), by their sorted paths. */
  apart: Map<string, Promise<string[]>>;
}

/** A runner whose unmutated run of `scope` passed, and the time limit and test workers a mutant's run of it gets. */
interface GreenRunner {
  runner: Runner;
  scope: RunScope;
  timeoutMs: number;
  workers?: number;
  /** The absolute paths of the test files that load the project file `file` (`readReach`). */
  testsLoading(file: string): string[];
}

/**
 * Runs the test files that import a file of `mutants` once unmutated, recording which project files
 * each loads (`test-step-reach.ts`). Only those test files: they are the ones a mutant can change,
 * and the whole suite was most of the time a few mutants took. Returns the runner, with its share of
 * the workers for each of `trials` mutants run at once, when they passed; otherwise names what
 * failed, since a mutant proves nothing on a red run.
 */
async function greenRunner(runner: Runner, projectDir: string, mutants: LocatedMutant[], trials: number, log: (line: string) => void, budget?: MutationBudget): Promise<GreenRunner | { notGreen: string[] }> {
  const reachDir = join(runner.workDir, 'reach');
  await fs.mkdir(reachDir);
  const scope = { related: [...new Set(mutants.map((m) => m.file))] };
  const baseline = await runner.run(scope, null, 10 * 60_000, { reach: reachDir, workers: budget?.workers });
  if (baseline.kind !== 'ran') throw new Error('The unmutated test run did not finish within 10 minutes.');
  if (suiteNoticed(baseline)) return { notGreen: redParts(baseline) };
  const { testsLoading, unrecorded } = await readReach(reachDir, projectDir, baseline.filesRun);
  if (unrecorded.length > 0) {
    log(`${unrecorded.length} of ${baseline.filesRun.size} test files count as loading every file, since what they load could not be told apart: ${unrecorded.join(', ')}`);
  }
  // A trial has 1/trials of the workers the baseline had.
  const workers = budget && Math.floor(budget.workers / trials);
  return { runner, scope, timeoutMs: Math.max(30_000, baseline.ms * 10 * trials), workers, testsLoading };
}

/**
 * Runs `mutant` against the test files the unmutated run passed, stopping at the first failure;
 * `unreached` when none of them loads its file. The same files, so a failure is the mutant's, not
 * that of a test missing what a test file left out of the run would have set up.
 */
async function runMutant(run: GreenRunner, mutant: LocatedMutant): Promise<DiffOutcome> {
  if (run.testsLoading(mutant.file).length === 0) return 'unreached';
  const result = await run.runner.run(run.scope, mutant, run.timeoutMs, { bail: true, workers: run.workers });
  if (result.kind === 'timed-out') return 'timed-out';
  return suiteNoticed(result) ? 'killed' : 'survived';
}

/**
 * What fails when `tests` run unmutated without the rest of the chunk's test files, as `redParts`
 * names it: none for all of them, whose unmutated run passed. Each set of files runs once per check,
 * so a failure under a mutant there is trusted only when the files pass on their own (#1329, #1340).
 */
function redApart(run: ApartRunner, tests: string[]): Promise<string[]> {
  if (tests.length === run.suiteSize) return Promise.resolve([]);
  const key = [...tests].sort().join('\0');
  const known = run.apart.get(key);
  if (known) return known;
  const red = run.runner.run(tests.map((absPath) => ({ absPath })), null, run.timeoutMs, { bail: true }).then((result) => {
    if (result.kind === 'timed-out') {
      const names = tests.map((path) => relative(run.projectDir, path).split(sep).join('/')).join(', ');
      throw new Error(`The unmutated run of ${names} did not finish within ${Math.round(run.timeoutMs / 1000)} seconds, though the whole suite did. Run \`boardsmith test\` on those files to see why.`);
    }
    return suiteNoticed(result) ? redParts(result) : [];
  });
  run.apart.set(key, red);
  return red;
}

/** Refuses a mutation check whose test files fail unmutated apart (`redApart`): `what` names them, `red` what failed. */
function apartError(what: string, red: string[], rerun: string): Error {
  return new Error(
    `${what}: ${red.join('; ')}. ` +
      'A test there depends on what another test file leaves behind (shared state under isolate: false, or the order files run in), ' +
      'so the mutation check cannot tell a failure the mutant caused from one it did not. ' +
      `Make each of those test files set up what it needs itself, then run ${rerun} again.`,
  );
}

/**
 * Mutates a sample of `MUTATE_SAMPLE_SIZE` of the changed lines' mutants, one change at a time, and
 * runs against each the test files the project's config collects that import a sampled mutant's
 * file (`vitest related`), stopping a run at its first failure. A sim is never one of them: the
 * game's config leaves sims out of every run but `--sims` (#1494). Any of those tests may catch a
 * mutant, and a mutant none catches is reported by file and line. A mutant in a file none of them
 * loads (`test-step-reach.ts`, #981) is reported as unreached, since no test could catch it; that
 * includes a file a test reaches only by a path built at run time or through a setup file, which
 * `vitest related` cannot follow (it walks only each test file's own imports, #1499). A mutant that
 * makes its run go past its time limit (an infinite loop, or a busy machine) is counted as timed
 * out, neither survivor nor caught: `timedOut` names it, for the caller to judge.
 *
 * Those test files first run once unmutated and must pass: `notGreen` then names what failed, and
 * no mutant is tried. The mutants then run side by side, as many at once as `budget` allows, or all of them.
 */
export async function runDiffMutationCheck(
  input: DiffMutationInput,
): Promise<DiffMutationResult> {
  const projectDir = realpathSync(input.projectDir);
  const summary = { files: 0, mutants: 0, killed: 0, survived: 0, timedOut: 0, unreached: 0 };
  const all = await collectMutants(projectDir, input.added);
  // Seeded by what the mutants change, not where or in which commit, so the branch tip and the merge commit that lands it try the same ones (#1500).
  const seed = all.map((m) => [m.file, m.description, m.change.before, m.change.after].join('\0')).join('\n');
  const mutants = sampleMutants(all, seed, MUTATE_SAMPLE_SIZE);
  summary.files = new Set(mutants.map((m) => m.file)).size;
  if (mutants.length === 0) return { summary, survivors: [], unreached: [], timedOut: [] };

  const runners: Runner[] = [];
  return withCommandBuildDir(projectDir, 'mutate', async (workDir) => {
    // Each trial owns a runner, so its mutant input, report and process group are its own; all are made before any runs, for the stop below.
    runners.push(await createRunner(projectDir, [], workDir));
    const trials = Math.min(input.budget?.trials ?? mutants.length, mutants.length);
    for (let trial = 2; trial <= trials; trial++) {
      const trialDir = join(workDir, `trial-${trial}`);
      await fs.mkdir(trialDir);
      runners.push(await createRunner(projectDir, [], trialDir));
    }
    const started = await greenRunner(runners[0], projectDir, mutants, trials, input.log, input.budget);
    if ('notGreen' in started) return { summary, survivors: [], unreached: [], timedOut: [], notGreen: started.notGreen };
    const share = started.workers === undefined ? '' : `, each with ${started.workers} test worker${started.workers === 1 ? '' : 's'}, of a budget of ${input.budget!.workers}`;
    input.log(`Running ${trials} mutant${trials === 1 ? '' : 's'} at a time${share}.`);
    return tallyMutants(mutants, await outcomesOf(input, mutants, runners.map((runner) => ({ ...started, runner }))), summary);
  }, () => stopAll(runners));
}

/** Counts each mutant's outcome into `summary`, in the order the mutants were made, and names the survivors, the mutants no test loads and those that timed out. */
function tallyMutants(mutants: LocatedMutant[], outcomes: DiffOutcome[], summary: DiffMutationResult['summary']): DiffMutationResult {
  const result: DiffMutationResult = { summary, survivors: [], unreached: [], timedOut: [] };
  for (const [i, mutant] of mutants.entries()) {
    summary.mutants++;
    summary[COUNTED[outcomes[i]]]++;
    const where = { file: mutant.file, line: mutant.line, description: mutant.description };
    if (outcomes[i] === 'survived') result.survivors.push(where);
    if (outcomes[i] === 'unreached') result.unreached.push(where);
    if (outcomes[i] === 'timed-out') result.timedOut.push(where);
  }
  return result;
}

async function stopAll(runners: Runner[]): Promise<void> {
  await Promise.all(runners.map((runner) => runner.stop()));
}

/**
 * Each mutant's outcome, in the order the mutants were made. Each of `runs` takes the next mutant as
 * it finishes one, so as many run at once as there are runs. The first failure starts no more, stops
 * every run still going, waits for every run to end, and is thrown; a failure to stop is logged, not
 * thrown in its place.
 */
async function outcomesOf(input: DiffMutationInput, mutants: LocatedMutant[], runs: GreenRunner[]): Promise<DiffOutcome[]> {
  const outcomes: DiffOutcome[] = [];
  let next = 0;
  let failure: { error: unknown } | undefined;
  const work = async (run: GreenRunner) => {
    while (!failure && next < mutants.length) {
      const i = next++;
      const mutant = mutants[i];
      input.log(`mutant ${i + 1}/${mutants.length}: ${mutant.file}:${mutant.line} ${mutant.description}`);
      outcomes[i] = await runMutant(run, mutant);
    }
  };
  await Promise.all(runs.map((run) => work(run).catch(async (error: unknown) => {
    if (failure) return;
    failure = { error };
    await stopAll(runs.map((r) => r.runner)).catch((stopError: unknown) => input.log((stopError as Error).message));
  })));
  if (failure) throw failure.error;
  return outcomes;
}
