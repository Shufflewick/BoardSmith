import { describe, expect, it } from 'vitest';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { focusedVerificationScope } from './authored-tests.js';
import { git, initRepo, writeFiles } from './verify-result.test-helper.js';

describe('committed authored-test scope (#951)', () => {
  it('rejects unknown manifest keys instead of silently ignoring a misspelled declaration', async () => {
    const sandbox = fixtureSandbox('bs-authored-manifest-', { tools: ['git'] });
    await writeFiles(sandbox.root, { 'tests/authored.test.ts': "import { it } from 'vitest';\nit('existing case', () => {});\n" });
    initRepo(sandbox.root);
    git(sandbox.root, 'add', 'tests/authored.test.ts');
    git(sandbox.root, 'commit', '-qm', 'Before authored change');
    const base = git(sandbox.root, 'rev-parse', 'HEAD').trim();
    await writeFiles(sandbox.root, {
      'tests/authored.test.ts': "import { it } from 'vitest';\nit('authored case', () => {});\n",
      '.agent-policy.json': JSON.stringify({ focused: { selection: 'selection.json', fullEvery: 5, verify: [{ name: 'authored', run: 'boardsmith test --selection selection.json' }] } }),
      'selection.json': JSON.stringify({
        ticket: 'Shufflewick/BoardSmith#951', base,
        tests: [{ file: 'tests/authored.test.ts', names: ['authored case'] }],
        testNames: ['a misspelled declaration must not be ignored'],
      }),
    });
    git(sandbox.root, 'add', 'tests/authored.test.ts', '.agent-policy.json', 'selection.json');
    git(sandbox.root, 'commit', '-qm', 'Declare authored change with an unknown manifest key');
    await expect(focusedVerificationScope(sandbox.root, 'selection.json')).rejects.toThrow(/unknown key.*testNames/);
  });
});
