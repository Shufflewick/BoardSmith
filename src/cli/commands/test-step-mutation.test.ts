import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateMutants, runMutationCheck } from './test-step-mutation.js';
import { parseSource } from './test-step-ast.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
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

// -------------------------------------------------------------------------------------------
// runMutationCheck — a real vitest run in a generated project
// -------------------------------------------------------------------------------------------

async function makeProject(files: Record<string, string>): Promise<string> {
  const tree = tempTree('bs-mutation-');
  const project = join(tree, 'project');
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(project, rel)), { recursive: true });
    await fs.writeFile(join(project, rel), text);
  }
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

  it('says how to install vitest when the project has none', async () => {
    const tree = tempTree('bs-mutation-');
    const project = join(tree, 'project');
    await fs.mkdir(join(project, 'tests'), { recursive: true });
    await expect(check(project, "it('x', () => {});\n")).rejects.toThrow(/npm install/);
  });
});
