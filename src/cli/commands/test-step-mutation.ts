/**
 * `test-step-mutation.ts` — the mutation half of `boardsmith test-step-check` (#290).
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
 */
import { spawn } from 'node:child_process';
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseSource, walk, findTestBlocks, type AstNode, type ParsedSource, type TestBlock } from './test-step-ast.js';
import type { ChunkTestFile, TestStepFinding } from './test-step-check.js';
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

/** Every mutant of `source` whose change starts on one of `addedLines`, in source order. */
export function generateMutants(file: string, source: string, addedLines: ReadonlySet<number>): Mutant[] {
  const { ast, tokens } = parseSource(source, file);
  const found: Array<{ start: number; order: number; line: number; description: string; edit: Edit }> = [];
  walk(ast, (node, ancestors) => {
    const mutator = MUTATORS[node.type];
    if (!mutator || !addedLines.has(node.loc.start.line)) return;
    const change = mutator({ node, ancestors, source, tokens });
    if (change) found.push({ start: node.range[0], order: found.length, line: node.loc.start.line, ...change });
  });
  return found
    .sort((a, b) => a.line - b.line || a.start - b.start || a.order - b.order)
    .map(({ line, description, edit: [from, to, replacement] }) => ({
      file,
      line,
      description,
      source: source.slice(0, from) + replacement + source.slice(to),
    }));
}

// -------------------------------------------------------------------------------------------
// Running vitest with one mutant in place
// -------------------------------------------------------------------------------------------

/** The project's own vitest config, extended with the mutant loader and test locations. */
function wrapperConfig(workDir: string, projectConfig: string | undefined): string {
  const importBase = projectConfig
    ? `import base from ${JSON.stringify(relative(workDir, projectConfig).split(sep).join('/'))};`
    : 'const base = {};';
  return `// Generated by boardsmith test-step-check; removed when the check ends.
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
    test: { includeTaskLocation: true },
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
  | { kind: 'ran'; outcomes: Outcome[]; filesRun: Set<string>; ms: number }
  | { kind: 'timed-out' };

interface Runner {
  run(files: ChunkTestFile[], mutant: { absPath: string; source: string } | null, timeoutMs: number): Promise<RunResult>;
  dispose(): Promise<void>;
}

async function createRunner(projectDir: string, testFiles: ChunkTestFile[]): Promise<Runner> {
  const vitestBin = join(projectDir, 'node_modules', '.bin', 'vitest');
  if (!existsSync(vitestBin)) {
    throw new Error(
      `vitest is not installed in ${projectDir}.\n` +
        'Run `npm install` in the project (vitest is one of its devDependencies), then run this check again.',
    );
  }
  const workDir = join(scratchDir(projectDir), 'test-step-check');
  await fs.mkdir(workDir, { recursive: true });
  const configPath = join(workDir, 'vitest.config.mts');
  const mutantPath = join(workDir, 'mutant.json');
  const reportPath = join(workDir, 'report.json');
  const projectConfig = VITEST_CONFIG_NAMES.map((n) => join(projectDir, n)).find((p) => existsSync(p));
  await fs.writeFile(configPath, wrapperConfig(workDir, projectConfig));

  const byRealPath = new Map(testFiles.map((f) => [realpathSync(f.absPath), f.path]));

  return {
    async run(files, mutant, timeoutMs) {
      await fs.rm(reportPath, { force: true });
      const env = { ...process.env };
      delete env.BOARDSMITH_MUTANT;
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
        ...files.map((f) => relative(projectDir, realpathSync(f.absPath)).split(sep).join('/')),
      ];
      const started = Date.now();
      const finished = await new Promise<boolean>((resolve, reject) => {
        const child = spawn(vitestBin, args, { cwd: projectDir, env, stdio: 'ignore', detached: true });
        const timer = setTimeout(() => {
          // A mutant can turn a loop infinite; kill vitest and every worker it started.
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
          resolve(false);
        }, timeoutMs);
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(new Error(`Could not run vitest in ${projectDir}: ${err.message}`));
        });
        child.on('close', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      if (!finished) return { kind: 'timed-out' };

      let report: { testResults?: Array<{ name: string; assertionResults: Array<Record<string, unknown>> }> };
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
      for (const fileResult of report.testResults ?? []) {
        const path = byRealPath.get(realpathSync(fileResult.name));
        if (path === undefined) continue;
        filesRun.add(path);
        for (const a of fileResult.assertionResults) {
          outcomes.push({
            path,
            fullName: a.fullName as string,
            line: (a.location as { line: number } | null | undefined)?.line,
            status: a.status as string,
          });
        }
      }
      return { kind: 'ran', outcomes, filesRun, ms: Date.now() - started };
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
  /** Changed implementation files that were mutated. */
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
 * Runs each mutant against the chunk test files that still hold a test no mutant has failed,
 * and returns the keys of every test some mutant made fail. Stops once every test has failed.
 */
async function killTests(
  runner: Runner,
  input: MutationCheckInput,
  tracked: Outcome[],
  mutants: LocatedMutant[],
  timeoutMs: number,
  summary: MutationSummary,
): Promise<Set<string>> {
  const killed = new Set<string>();
  for (const [i, mutant] of mutants.entries()) {
    const remaining = tracked.filter((o) => !killed.has(testKey(o)));
    if (remaining.length === 0) break;
    const files = input.testFiles.filter((f) => remaining.some((o) => o.path === f.path));
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
  const testFindings = tracked
    .filter((o) => !killed.has(testKey(o)))
    .map((o) => ({
      kind: 'test-survives-mutation' as const,
      subject: testKey(o),
      detail:
        "This test passed under every small break of this chunk's code, so it cannot fail when the code is wrong. " +
        'It asserts something the chunk does not control (a value it set up itself, a mock, a constant). Rewrite it ' +
        'to assert what the game does, or delete it if another test already pins that.',
    }));
  return [...claimFindings, ...testFindings];
}

/**
 * Runs the chunk's tests once unmutated (they must all pass), then once per mutant, and reports
 * every claim and every test that no mutant made fail.
 */
export async function runMutationCheck(
  input: MutationCheckInput,
): Promise<{ findings: TestStepFinding[]; summary: MutationSummary }> {
  const projectDir = realpathSync(input.projectDir);
  const summary: MutationSummary = { files: 0, mutants: 0, killed: 0, survived: 0, timedOut: 0 };
  const runner = await createRunner(projectDir, input.testFiles);
  try {
    const baseline = await runner.run(input.testFiles, null, 10 * 60_000);
    if (baseline.kind !== 'ran') throw new Error('The unmutated test run did not finish within 10 minutes.');
    const notGreen = baselineFindings(input.testFiles, baseline);
    if (notGreen.length > 0) return { findings: notGreen, summary };

    const tracked = baseline.outcomes.filter((o) => o.status === 'passed');
    const mutants = await collectMutants(projectDir, input.added, summary);
    const killed = await killTests(runner, input, tracked, mutants, Math.max(30_000, baseline.ms * 10), summary);
    return { findings: survivorFindings(input, tracked, killed, mutants.length), summary };
  } finally {
    await runner.dispose();
  }
}
