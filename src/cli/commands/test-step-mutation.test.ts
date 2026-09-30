import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateMutants, runDiffMutationCheck, runMutationCheck } from './test-step-mutation.js';
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

  async function suite(project: string, files: Record<string, string>): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
      await fs.mkdir(dirname(join(project, path)), { recursive: true });
      await fs.writeFile(join(project, path), text);
    }
  }

  it('runs the whole suite against each mutant and reports every mutant no test caught, by file and line', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES_TWO });
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

    const result = await runDiffMutationCheck({ projectDir: project, added: new Map([['src/rules.ts', lines(2, 5)]]), log: () => {} });

    expect(result.notGreen).toBeUndefined();
    expect(result.summary.mutants).toBe(5);
    expect(result.summary.killed).toBe(2);
    expect(result.summary.survived).toBe(3);
    expect(result.survivors).toEqual([
      { file: 'src/rules.ts', line: 5, description: 'return value replaced with undefined' },
      { file: 'src/rules.ts', line: 5, description: '* -> /' },
      { file: 'src/rules.ts', line: 5, description: '2 -> 3' },
    ]);
    expect(await fs.readFile(join(project, 'src/rules.ts'), 'utf-8')).toBe(RULES_TWO);
    await expect(fs.readdir(join(project, '.boardsmith/scratch'))).resolves.toEqual([]);
  }, 120_000);

  it('tries no mutant on a red suite, and names the failing tests', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES });
    await suite(project, {
      'tests/red.test.ts': "import { it, expect } from 'vitest';\nit('is red', () => { expect(1).toBe(2); });\n",
    });
    const result = await runDiffMutationCheck({ projectDir: project, added: new Map([['src/rules.ts', lines(2)]]), log: () => {} });
    expect(result.notGreen).toEqual(['tests/red.test.ts > is red']);
    expect(result.summary.mutants).toBe(0);
  }, 60_000);

  it('runs nothing when no changed line can be mutated', async () => {
    const project = await makeProject({ 'vitest.config.ts': VITEST_CONFIG, 'src/rules.ts': RULES });
    const result = await runDiffMutationCheck({ projectDir: project, added: new Map([['src/rules.ts', lines(3)]]), log: () => {} });
    expect(result).toEqual({ summary: { files: 0, mutants: 0, killed: 0, survived: 0, timedOut: 0 }, survivors: [] });
  });
});
