import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  generateMutants,
  isAssertionFailure,
  orderPinSites,
  PIN_MUTANT_CAP,
  runDiffMutationCheck,
  runMutationCheck,
  spreadOrder,
} from './test-step-mutation.js';
import { parseSource } from './test-step-ast.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { designProjectFixtures } from './design-project.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';

const lines = (...n: number[]) => new Set(n);

describe('generateMutants', () => {
  const source = `export function score(hand: number[], bonus: boolean): number {
  let total = 0;
  for (const card of hand) total = total + card;
  if (total > 21 && !bonus) return 0;
  record(total);
  return bonus ? total * 2 : total;
}
const LIMIT: 3 = 3;
`;

  it('makes one small change per mutant, only on the lines given, and each mutant still parses', () => {
    const mutants = generateMutants('src/score.ts', source, lines(2, 3, 4, 5, 6));
    expect(mutants.map((m) => `${m.line}: ${m.description}`)).toEqual([
      '2: 0 -> 1',
      '3: statement removed',
      '3: + -> -',
      '4: if condition negated',
      '4: && -> ||',
      '4: > -> >=',
      '4: 21 -> 22',
      '4: removed !',
      '4: return value replaced with undefined',
      '4: 0 -> 1',
      '5: statement removed',
      '6: return value replaced with undefined',
      '6: condition negated',
      '6: * -> /',
      '6: 2 -> 3',
    ]);
    for (const m of mutants) {
      expect(m.source).not.toBe(source);
      expect(() => parseSource(m.source)).not.toThrow();
    }
    expect(mutants.find((m) => m.description === '+ -> -')!.source).toContain('total = total - card');
  });

  it('never mutates a line it was not given, or a literal inside a type', () => {
    expect(generateMutants('src/score.ts', source, lines(1, 7, 8))).toEqual([
      expect.objectContaining({ line: 8, description: '3 -> 4' }),
    ]);
    expect(generateMutants('src/score.ts', source, lines(8))[0].source).toContain('const LIMIT: 3 = 4;');
  });
});

/**
 * #425: a chunk's `.vue` changes were never mutated, so a test that pinned only component code
 * was blamed for asserting nothing the chunk controls. The script blocks are mutated like any
 * TypeScript, and so are the expressions of template bindings, conditions and interpolations.
 */
describe('generateMutants on a single-file component (#425)', () => {
  const sfc = `<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ n: number }>();
const big = computed(() => props.n > 3);
</script>

<template>
  <p v-if="!big" :title="big ? 'big' : 'small'">{{ props.n + 1 }}</p>
  <Child :flag="true" @click="go(1)" v-for="i in [1, 2]" :key="i" />
</template>
`;

  it('mutates the script block and the template expressions, at their lines in the .vue file', () => {
    const mutants = generateMutants('src/ui/Count.vue', sfc, lines(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
    expect(mutants.map((m) => `${m.line}: ${m.description}`)).toEqual([
      '4: > -> >=',
      '4: 3 -> 4',
      '8: removed !',
      '8: condition negated',
      '8: + -> -',
      '8: 1 -> 2',
      '9: true -> false',
    ]);
    // Each mutant is the whole component with one change, so the Vue plugin compiles it as usual.
    const change = (description: string) => mutants.find((m) => m.description === description)!.source;
    expect(change('> -> >=')).toBe(sfc.replace('props.n > 3', 'props.n >= 3'));
    expect(change('removed !')).toBe(sfc.replace('v-if="!big"', 'v-if="big"'));
    expect(change('condition negated')).toBe(sfc.replace(":title=\"big ?", ":title=\"!(big) ?"));
    expect(change('+ -> -')).toBe(sfc.replace('{{ props.n + 1 }}', '{{ props.n - 1 }}'));
    expect(change('true -> false')).toBe(sfc.replace(':flag="true"', ':flag="false"'));
  });

  it('leaves event handlers, loops and lines the chunk did not write alone', () => {
    // Line 9 holds a handler (`go(1)`) and a loop (`[1, 2]`): neither is a value a mutant can flip.
    expect(generateMutants('src/ui/Count.vue', sfc, lines(9)).map((m) => m.description)).toEqual(['true -> false']);
    expect(generateMutants('src/ui/Count.vue', sfc, lines(1, 2, 3, 5, 6, 7, 10))).toEqual([]);
  });

  it('mutates a plain <script> block too', () => {
    const plain = '<template><p>{{ label }}</p></template>\n<script lang="ts">\nexport const limit = 5;\n</script>\n';
    expect(generateMutants('src/ui/Plain.vue', plain, lines(3)).map((m) => `${m.line}: ${m.description}`)).toEqual([
      '3: 5 -> 6',
    ]);
  });
});

/**
 * #485 ruling (2026-10-03): an exempt chunk's `none (regression)` row is mutation-tested on the game
 * code it runs, in an order that puts what a test runs on its own before setup every test shares,
 * the same way every time.
 */
describe('orderPinSites', () => {
  const mutantsOf = (file: string, count: number) => Array.from({ length: count }, (_, i) => ({ file, line: i + 1 }));
  const named = (mutants: Array<{ file: string; line: number }>) => mutants.map((m) => `${m.file}:${m.line}`);

  it('puts lower ranks first, alternating between the modules of a rank, and spreads each module', () => {
    const modules = [
      { path: 'src/shared.ts', rank: 2, mutants: mutantsOf('src/shared.ts', 2) },
      { path: 'src/b.ts', rank: 1, mutants: mutantsOf('src/b.ts', 3) },
      { path: 'src/a.ts', rank: 1, mutants: mutantsOf('src/a.ts', 2) },
    ];
    const ordered = orderPinSites(modules);
    expect(named(ordered)).toEqual(['src/a.ts:2', 'src/b.ts:2', 'src/a.ts:1', 'src/b.ts:1', 'src/b.ts:3', 'src/shared.ts:2', 'src/shared.ts:1']);
    expect(named(orderPinSites([...modules].reverse()))).toEqual(named(ordered));
  });

  it('spreads any first few of a module across its whole length', () => {
    expect(spreadOrder(0)).toEqual([]);
    expect(spreadOrder(10)).toEqual([5, 2, 8, 1, 4, 7, 9, 0, 3, 6]);
    for (const n of [1, 7, 211, 367]) expect([...spreadOrder(n)].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
  });
});

/**
 * #485: a test that pins earlier behaviour runs all of the game's setup, so a mutant that makes
 * setup throw fails it without its assertions ever running. Such a failure is not credited: only
 * one raised by the test's own check is. The shapes here are what vitest reports for each kind.
 */
describe('isAssertionFailure', () => {
  it('counts what expect, assert and expect.fail raise, and a snapshot mismatch', () => {
    expect(isAssertionFailure({ name: 'AssertionError', diff: true })).toBe(true); // expect(x).toBe(y)
    expect(isAssertionFailure({ name: 'AssertionError', diff: false })).toBe(true); // expect(fn).toThrow(), expect.fail()
    expect(isAssertionFailure({ name: 'Error', diff: true })).toBe(true); // toMatchSnapshot, toMatchInlineSnapshot
  });

  it('does not count an error thrown by the code the test ran', () => {
    expect(isAssertionFailure({ name: 'Error', diff: false })).toBe(false);
    expect(isAssertionFailure({ name: 'RulesError', diff: false })).toBe(false);
    expect(isAssertionFailure({ name: undefined, diff: false })).toBe(false); // throw 'a string'
  });
});

// -------------------------------------------------------------------------------------------
// runMutationCheck — a real vitest run in a generated project
// -------------------------------------------------------------------------------------------

async function makeProject(files: Record<string, string>): Promise<string> {
  const tree = tempTree('bs-mutation-');
  const project = await designProjectFixtures(() => tree).makeProject(files);
  await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
  return project;
}

const RULES = `export function bid(high: number, offer: number): boolean {
  return offer > high;
}
`;

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
`;

async function check(project: string, testSource: string, claims = [1, 2]) {
  const testPath = join(project, 'tests/auction.test.ts');
  await fs.mkdir(dirname(testPath), { recursive: true });
  await fs.writeFile(testPath, testSource);
  return runMutationCheck({
    projectDir: project,
    testFiles: [{ path: 'tests/auction.test.ts', absPath: testPath, source: testSource }],
    added: new Map([['src/rules.ts', lines(1, 2, 3)]]),
    claims,
    log: () => {},
  });
}

describe('runMutationCheck', () => {
  it('passes tests that fail when the implementation is broken', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES });
    const result = await check(
      project,
      `import { it, expect } from 'vitest';
import { bid } from '../src/rules';
it('claim 1 — a higher offer wins', () => { expect(bid(3, 4)).toBe(true); });
// Claim 2: an equal offer does not.
it('equal offer', () => { expect(bid(3, 3)).toBe(false); });
`,
    );
    expect(result.findings).toEqual([]);
    expect(result.summary.killed).toBeGreaterThan(0);
    // The check never leaves its scratch files behind, and never touches the source.
    await expect(fs.readdir(join(project, '.boardsmith/scratch'))).resolves.toEqual([]);
    expect(await fs.readFile(join(project, 'src/rules.ts'), 'utf-8')).toBe(RULES);
  }, 60_000);

  it('reports a tautological test and the claim it was the only test for', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES });
    const result = await check(
      project,
      `import { it, expect } from 'vitest';
import { bid } from '../src/rules';
it('claim 1 — a higher offer wins', () => { expect(bid(3, 4)).toBe(true); });
it('claim 2 — tautology', () => { const high = 3; expect(high).toBe(3); });
`,
    );
    expect(result.findings.map((f) => `${f.kind} ${f.subject}`)).toEqual([
      'claim-survives-mutation claim 2',
      'test-survives-mutation tests/auction.test.ts > claim 2 — tautology',
    ]);
    expect(result.findings[1].detail).toMatch(/asserts|fail/);
    // A source scan (the a11y floor's colour or asset scan) cannot be failed by a mutant either:
    // the finding says where such a test belongs instead (#443).
    expect(result.findings[1].detail).toContain('tests/guards/');
  }, 60_000);

  it('refuses to mutate on top of a red suite', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES });
    const result = await check(
      project,
      `import { it, expect } from 'vitest';
it('claim 1 — red', () => { expect(1).toBe(2); });
`,
      [1],
    );
    expect(result.findings.map((f) => f.kind)).toEqual(['suite-not-green']);
    expect(result.summary.mutants).toBe(0);
  }, 60_000);

  it('mutates a component the chunk changed, so a mounted test of it is credited and a tautology is not (#425)', async () => {
    const component = `<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ score: number }>();
const verdict = computed(() => (props.score > 10 ? 'won' : 'lost'));
</script>

<template>
  <p class="result">{{ verdict }}</p>
  <p class="double">{{ props.score * 2 }}</p>
</template>
`;
    const project = await makeProject({
      'vitest.config.ts': `import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] } });
`,
      'src/ui/Result.vue': component,
    });
    const testSource = `import { it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Result from '../src/ui/Result.vue';
it('claim 1 — a score over ten wins', () => {
  expect(mount(Result, { props: { score: 11 } }).find('.result').text()).toBe('won');
});
it('claim 2 — tautology', () => { const score = 11; expect(score).toBe(11); });
// Only a template mutant can make this fail: the script never touches the doubled score.
it('claim 3 — the doubled score is shown', () => {
  expect(mount(Result, { props: { score: 11 } }).find('.double').text()).toBe('22');
});
`;
    const testPath = join(project, 'tests/result.test.ts');
    await fs.mkdir(dirname(testPath), { recursive: true });
    await fs.writeFile(testPath, testSource);

    const result = await runMutationCheck({
      projectDir: project,
      testFiles: [{ path: 'tests/result.test.ts', absPath: testPath, source: testSource }],
      added: new Map([['src/ui/Result.vue', lines(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)]]),
      claims: [1, 2, 3],
      log: () => {},
    });

    expect(result.summary.files).toBe(1);
    expect(result.summary.killed).toBeGreaterThan(0);
    expect(result.findings.map((f) => `${f.kind} ${f.subject}`)).toEqual([
      'claim-survives-mutation claim 2',
      'test-survives-mutation tests/result.test.ts > claim 2 — tautology',
    ]);
    expect(await fs.readFile(join(project, 'src/ui/Result.vue'), 'utf-8')).toBe(component);
  }, 120_000);

  // #485 ruling (2026-10-03): an exempt chunk adds no game behaviour, so a `none (regression)` row that
  // pins an earlier chunk's is mutation-tested on the game code it runs, found by running it with coverage.
  describe('a test file that pins earlier behaviour (#485)', () => {
    async function pinCheck(
      testSource: string,
      files: Record<string, string> = { 'src/rules.ts': RULES },
      options: { added?: Map<string, Set<number>> } = {},
    ) {
      const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, ...files });
      const testPath = join(project, 'tests/pin.test.ts');
      await fs.mkdir(dirname(testPath), { recursive: true });
      await fs.writeFile(testPath, testSource);
      const logged: string[] = [];
      const result = await runMutationCheck({
        projectDir: project,
        testFiles: [{ path: 'tests/pin.test.ts', absPath: testPath, source: testSource, pin: true }],
        added: options.added ?? new Map(),
        claims: [],
        log: (line) => logged.push(line),
      });
      return { project, result, logged };
    }
    const mutatedLines = (logged: string[]) => logged.map((l) => /: (src\/\S+:\d+) /.exec(l)![1]);

    it('mutates the game code it runs, which the chunk never touched, and credits a test that pins it', async () => {
      const { project, result } = await pinCheck(`import { it, expect } from 'vitest';
import { bid } from '../src/rules';
it('a higher offer still wins', () => { expect(bid(3, 4)).toBe(true); expect(bid(3, 3)).toBe(false); });
`);
      expect(result.findings).toEqual([]);
      expect(result.summary).toMatchObject({ files: 1 });
      expect(result.summary.killed).toBeGreaterThan(0);
      expect(await fs.readFile(join(project, 'src/rules.ts'), 'utf-8')).toBe(RULES);
      await expect(fs.readdir(join(project, '.boardsmith/scratch'))).resolves.toEqual([]);
    }, 60_000);

    it('reports a pin no break of the code it runs can fail, saying exactly what was broken, and never breaks code it does not run', async () => {
      const rules = `${RULES}export function fee(n: number): number {\n  if (n > 10) return n * 2;\n  return n + 1;\n}\n`;
      const { result, logged } = await pinCheck(
        `import { it, expect } from 'vitest';\nimport { bid } from '../src/rules';\nit('bid runs', () => { bid(3, 4); expect(1).toBe(1); });\n`,
        { 'src/rules.ts': rules },
      );
      expect(result.findings.map((f) => `${f.kind} ${f.subject}`)).toEqual(['test-survives-mutation tests/pin.test.ts > bid runs']);
      expect(result.findings[0].detail).toMatch(/each of all 2 places in the game code it runs that a mutant can change/);
      expect(mutatedLines(logged)).toEqual(['src/rules.ts:2', 'src/rules.ts:2']);
    }, 60_000);

    it('breaks the lines the chunk changed in code it runs first', async () => {
      const rules = `export function fee(n: number): number {\n  return n + 1;\n}\n${RULES}`;
      const { result, logged } = await pinCheck(
        `import { it, expect } from 'vitest';
import { bid, fee } from '../src/rules';
it('a higher offer still wins', () => { expect(fee(1)).toBeGreaterThan(0); expect(bid(3, 4)).toBe(true); expect(bid(3, 3)).toBe(false); });
`,
        { 'src/rules.ts': rules },
        { added: new Map([['src/rules.ts', lines(5)]]) },
      );
      expect(result.findings).toEqual([]);
      expect(mutatedLines(logged)[0]).toBe('src/rules.ts:5');
    }, 60_000);

    it('gives each test a turn on the code it runs, what it runs on its own first, under the cap', async () => {
      const files: Record<string, string> = {
        'src/special.ts': 'export function special(total: number): boolean {\n  return total > 40;\n}\n',
      };
      const modules = Array.from({ length: 40 }, (_, i) => `m${String(i).padStart(2, '0')}`);
      for (const [i, name] of modules.entries()) files[`src/${name}.ts`] = `export function ${name}(x: number): number {\n  return x + ${i};\n}\n`;
      const imports = modules.map((name) => `import { ${name} } from '../src/${name}';`).join('\n');
      const sum = `[${modules.join(', ')}].reduce((total, f) => total + f(1), 0)`;
      const { result, logged } = await pinCheck(
        `import { it, expect } from 'vitest';
${imports}
import { special } from '../src/special';
it('the shared total', () => { expect(${sum}).toBe(820); });
it('the special rule', () => { expect(special(${sum})).toBe(true); expect(special(40)).toBe(false); });
`,
        files,
      );
      // Each test still passing takes a turn: the shared total's first place breaks it, then the
      // special rule's first is the code only it runs, not the shared setup.
      expect(result.findings).toEqual([]);
      expect(mutatedLines(logged).slice(0, 2)).toEqual(['src/m00.ts:2', 'src/special.ts:2']);
      expect(logged[0]).toMatch(/^mutant 1\/100: /);
      expect(result.summary.mutants).toBeLessThan(5);
    }, 120_000);

    it('carries on past a module it cannot read, naming it', async () => {
      const { result, logged } = await pinCheck(
        `import { it, expect } from 'vitest';
import { NAMES } from '../src/names';
import { fee } from '../src/fee';
it('runs', () => { fee(NAMES.length); expect(1).toBe(1); });
`,
        {
          'src/names.ts': `export const NAMES = "a"${' + "b"'.repeat(20_000)};\n`,
          'src/fee.ts': 'export function fee(n: number): number {\n  return n + 1;\n}\n',
        },
      );
      expect(result.findings.map((f) => f.kind)).toEqual(['test-survives-mutation']);
      expect(result.findings[0].detail).toMatch(/Not mutated: src\/names\.ts \(nested too deeply for the parser\)/);
      expect(new Set(mutatedLines(logged).map((l) => l.split(':')[0]))).toEqual(new Set(['src/fee.ts']));
    }, 60_000);

    // What a mock lets run is decided by what ran, not by the vi.mock call: an automock never runs
    // the module's functions, and a spy mock runs the real ones.
    it('mutates what a mocked module still ran: nothing of an automock, all of a spy', async () => {
      const { result, logged } = await pinCheck(
        `import { it, expect, vi } from 'vitest';
import { bid } from '../src/rules';
import { fee } from '../src/fee';
vi.mock('../src/rules');
vi.mock('../src/fee', { spy: true });
it('runs', () => { bid(3, 4); fee(1); expect(1).toBe(1); });
`,
        { 'src/rules.ts': RULES, 'src/fee.ts': 'export function fee(n: number): number {\n  return n + 1;\n}\n' },
      );
      expect(result.findings.map((f) => f.kind)).toEqual(['test-survives-mutation']);
      expect(new Set(mutatedLines(logged).map((l) => l.split(':')[0]))).toEqual(new Set(['src/fee.ts']));
    }, 60_000);

    // A pin runs all of the game's setup, so a mutant that makes setup throw fails it with no
    // assertion run. Only a failure the test's own check raises is credited (`isAssertionFailure`).
    describe('is credited only for a failure on its own assertion', () => {
      const GAME = `export class Game {
  readonly actions: string[] = [];
  constructor(readonly players: number) {
    if (players < 2) throw new Error('A game needs at least two players.');
    this.register('bid');
    this.register('pass');
  }
  register(name: string): void {
    if (this.actions.includes(name)) throw new Error(\`\${name} is registered twice.\`);
    this.actions.push(name);
  }
}
`;

      it('refuses a pin that only sets a game up: every break that fails it does so by throwing', async () => {
        const { result } = await pinCheck(
          `import { it, expect } from 'vitest';
import { Game } from '../src/game';
it('a two-player game sets up', () => { const game = new Game(2); expect(game).toBeTruthy(); });
`,
          { 'src/game.ts': GAME },
        );
        expect(result.findings.map((f) => `${f.kind} ${f.subject}`)).toEqual(['test-survives-mutation tests/pin.test.ts > a two-player game sets up']);
        expect(result.findings[0].detail).toMatch(/never failed on an assertion of its own/);
        expect(result.summary.killed).toBe(0);
        expect(result.summary.survived).toBe(result.summary.mutants);
      }, 60_000);

      it('credits an expect on the outcome, an expected throw, and a snapshot', async () => {
        const { result } = await pinCheck(
          `import { it, expect } from 'vitest';
import { Game } from '../src/game';
it('a two-player game offers bid and pass', () => { expect(new Game(2).actions).toEqual(['bid', 'pass']); });
it('a one-player game is refused', () => { expect(() => new Game(1)).toThrow('two players'); });
it('the actions match the snapshot', () => { expect(new Game(2).actions).toMatchSnapshot(); });
`,
          {
            'src/game.ts': GAME,
            'tests/__snapshots__/pin.test.ts.snap': `// Vitest Snapshot v1, https://vitest.dev/guide/snapshot

exports[\`the actions match the snapshot 1\`] = \`
[
  "bid",
  "pass",
]
\`;
`,
          },
        );
        expect(result.findings).toEqual([]);
        expect(result.summary.killed).toBeGreaterThan(0);
      }, 120_000);
    });

    it('reads what a mounted component runs, its template included', async () => {
      const { result, logged } = await pinCheck(
        `import { it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Result from '../src/ui/Result.vue';
it('the doubled score is shown', () => { expect(mount(Result, { props: { score: 11 } }).find('.double').text()).toBe('22'); });
`,
        {
          'vitest.config.ts': `import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ plugins: [vue()], test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] } });
`,
          'src/ui/Result.vue': `<script setup lang="ts">
const props = defineProps<{ score: number }>();
</script>

<template>
  <p class="double">{{ props.score * 2 }}</p>
</template>
`,
        },
      );
      expect(result.findings).toEqual([]);
      expect(mutatedLines(logged)).toContain('src/ui/Result.vue:6');
    }, 120_000);

    it('says so when a pin runs no game code a mutant can change', async () => {
      const { result } = await pinCheck(
        `import { it, expect } from 'vitest';\nimport { noop } from '../src/rules';\nit('noop exists', () => { noop(); expect(typeof noop).toBe('function'); });\n`,
        { 'src/rules.ts': 'export function noop(): void {}\n' },
      );
      expect(result.findings.map((f) => f.kind)).toEqual(['test-survives-mutation']);
      expect(result.findings[0].detail).toMatch(/runs no game code under src\/ that a mutant can change[^]*Import the game module/);
    }, 60_000);
  });

  it('says how to install vitest when the project has none', async () => {
    const tree = tempTree('bs-mutation-');
    const project = join(tree, 'project');
    await fs.mkdir(join(project, 'tests'), { recursive: true });
    await expect(check(project, "it('x', () => {});\n")).rejects.toThrow(/npm install/);
  });
});

/**
 * #452: `boardsmith verify` mutates the lines changed since a base commit, with no chunk and no
 * Spec Manifest, and runs the whole suite against each mutant. What it reports is each mutant no
 * test caught, by file and line.
 */
describe('runDiffMutationCheck', () => {
  const RULES_TWO = `export function bid(high: number, offer: number): boolean {
  return offer > high;
}
export function fee(price: number): number {
  return price * 2;
}
`;

  /** A cache that holds nothing and keeps what it is given, standing in for `openMutantCache`. */
  function memoryCache(held: Map<string, 'killed' | 'survived'> = new Map()) {
    const key = (m: { file: string; source: string }) => `${m.file}\0${m.source}`;
    return {
      held,
      get: (m: { file: string; source: string }) => held.get(key(m)),
      set: (m: { file: string; source: string }, outcome: 'killed' | 'survived') => void held.set(key(m), outcome),
      save: async () => {},
    };
  }

  async function suite(project: string, files: Record<string, string>): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
      await fs.mkdir(dirname(join(project, path)), { recursive: true });
      await fs.writeFile(join(project, path), text);
    }
  }

  it('runs the whole suite against each mutant and reports every mutant no test caught, by file and line', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES_TWO });
    const cache = memoryCache();
    // Two test files: the one that catches the bid mutants is not the one "near" the change.
    await suite(project, {
      'tests/bid.test.ts': `import { it, expect } from 'vitest';
import { bid } from '../src/rules';
it('a higher offer wins', () => { expect(bid(3, 4)).toBe(true); });
it('an equal offer loses', () => { expect(bid(3, 3)).toBe(false); });
`,
      'tests/fee.test.ts': `import { it, expect } from 'vitest';
import { fee } from '../src/rules';
it('a fee exists', () => { expect(typeof fee).toBe('function'); });
`,
    });

    const result = await runDiffMutationCheck({ projectDir: project, added: new Map([['src/rules.ts', lines(2, 5)]]), cache, log: () => {} });

    expect(result.notGreen).toBeUndefined();
    expect(result.summary.mutants).toBe(5);
    expect(result.summary.killed).toBe(2);
    expect(result.summary.survived).toBe(3);
    expect(result.survivors).toEqual([
      { file: 'src/rules.ts', line: 5, description: 'return value replaced with undefined' },
      { file: 'src/rules.ts', line: 5, description: '* -> /' },
      { file: 'src/rules.ts', line: 5, description: '2 -> 3' },
    ]);
    expect(result.reused).toBe(0);
    expect([...cache.held.values()].sort()).toEqual(['killed', 'killed', 'survived', 'survived', 'survived']);
    expect(await fs.readFile(join(project, 'src/rules.ts'), 'utf-8')).toBe(RULES_TWO);
    await expect(fs.readdir(join(project, '.boardsmith/scratch'))).resolves.toEqual([]);

    // Run again with every outcome held: no vitest run at all, and the same report.
    const logged: string[] = [];
    const again = await runDiffMutationCheck({
      projectDir: project,
      added: new Map([['src/rules.ts', lines(2, 5)]]),
      cache,
      log: (line) => logged.push(line),
    });
    expect(again.reused).toBe(5);
    expect(again.summary).toEqual(result.summary);
    expect(again.survivors).toEqual(result.survivors);
    expect(logged.every((line) => line.includes('(reused: '))).toBe(true);
    expect(logged).toHaveLength(5);
    await expect(fs.readdir(join(project, '.boardsmith/scratch'))).resolves.toEqual([]);
  }, 120_000);

  it('tries no mutant on a red suite, and names the failing tests', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES });
    await suite(project, {
      'tests/red.test.ts': "import { it, expect } from 'vitest';\nit('is red', () => { expect(1).toBe(2); });\n",
    });
    const result = await runDiffMutationCheck({ projectDir: project, added: new Map([['src/rules.ts', lines(2)]]), cache: memoryCache(), log: () => {} });
    expect(result.notGreen).toEqual(['tests/red.test.ts > is red']);
    expect(result.summary.mutants).toBe(0);
  }, 60_000);

  it('runs nothing when no changed line can be mutated', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES });
    const result = await runDiffMutationCheck({ projectDir: project, added: new Map([['src/rules.ts', lines(3)]]), cache: memoryCache(), log: () => {} });
    expect(result).toEqual({ summary: { files: 0, mutants: 0, killed: 0, survived: 0, timedOut: 0 }, reused: 0, survivors: [] });
  });
});
