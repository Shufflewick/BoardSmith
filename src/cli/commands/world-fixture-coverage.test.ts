import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findFixtureWrappers, findStartedFixtures } from './test-step-ast.js';
import { projectRules, validateWorldFixtures } from './validate.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

describe('findStartedFixtures: which world fixtures a test file starts a world from (#1825)', () => {
  it('counts createTestWorld({ fixture }) and runner.fixture(name), and nothing else', () => {
    const source = `
const world = await createTestWorld({ definition: gameDefinition, fixture: 'allied' });
await runner.fixture('besieged');
await runner.genesis();
const fixture = { name: 'notStarted' };
`;
    expect(findStartedFixtures(source, 'tests/a.test.ts').sort()).toEqual(['allied', 'besieged']);
  });

  it('reads the name through it.each rows and a project helper under tests/', () => {
    const helper = `
export function alliedWorld(name: string) {
  return createTestWorld({ definition: gameDefinition, fixture: name });
}
`;
    const wrappers = findFixtureWrappers([{ path: 'tests/support/worlds.ts', text: helper }]);
    const source = `
it.each(['dawn', 'dusk'])('starts %s', async (name) => { await runner.fixture(name); });
it('helper', async () => { await alliedWorld('allied'); });
`;
    expect(findStartedFixtures(source, 'tests/a.test.ts', wrappers).sort()).toEqual(['allied', 'dawn', 'dusk']);
  });

  it('does not count a fixture started only inside a skipped test', () => {
    expect(findStartedFixtures("it.skip('later', () => runner.fixture('allied'));\n", 'tests/a.test.ts')).toEqual([]);
  });
});

describe('validateWorldFixtures: every declared fixture is started by a test (#1825)', () => {
  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../lib/choice-cardinality.fixture.ts');

  function project(tests: Record<string, string>): string {
    const cwd = tempTree('bs-validate-fixtures-');
    writeFileSync(join(cwd, 'boardsmith.json'), JSON.stringify({ name: 'fixture', backend: 'world' }));
    mkdirSync(join(cwd, 'src', 'rules'), { recursive: true });
    writeFileSync(
      join(cwd, 'src', 'rules', 'index.ts'),
      [
        `import { cardinalityWorld } from ${JSON.stringify(fixture)};`,
        "const base = cardinalityWorld(['nod']);",
        'export const gameDefinition = { ...base, world: { ...base.world, fixtures: { allied: () => ({}), lonely: () => ({}) } } };',
      ].join('\n'),
    );
    mkdirSync(join(cwd, 'tests'), { recursive: true });
    for (const [name, text] of Object.entries(tests)) writeFileSync(join(cwd, 'tests', name), text);
    execFileSync('git', ['init', '-q'], { cwd });
    return cwd;
  }

  const rulesOf = (cwd: string) => projectRules(cwd, { name: 'fixture', backend: 'world' });

  it('refuses a fixture no test starts a world from, naming it and how to start one', async () => {
    const cwd = project({ 'allied.test.ts': "it('x', () => createTestWorld({ definition, fixture: 'allied' }));\n" });
    const result = await validateWorldFixtures(rulesOf(cwd));
    expect(result.passed).toBe(false);
    expect(result.severity).toBeUndefined();
    expect(result.message).toContain('"lonely"');
    expect(result.message).not.toContain('"allied"');
    expect(result.message).toContain('createTestWorld');
  }, 30_000);

  it('passes once every declared fixture is started by some test file', async () => {
    const cwd = project({
      'allied.test.ts': "it('x', () => createTestWorld({ definition, fixture: 'allied' }));\n",
      'lonely.test.ts': "it('y', () => runner.fixture('lonely'));\n",
    });
    expect(await validateWorldFixtures(rulesOf(cwd))).toMatchObject({ passed: true });
  }, 30_000);
});
