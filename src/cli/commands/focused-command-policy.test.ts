import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { linkGameModules } from '../../testing/installed-modules.test-helper.js';
import { GAME_VITE_CONFIG } from '../lib/test-run-scope.js';
import { git, initRepo, writeFiles } from '../lib/verify-result.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';

vi.setConfig({ testTimeout: 120_000 });

async function focusedProject() {
  const sandbox = fixtureSandbox('bs-focused-command-', { tools: ['git'] });
  const project = join(sandbox.root, 'game');
  await writeFiles(project, {
    '.gitignore': 'node_modules/\n.boardsmith/\n',
    'package.json': '{"name":"focused-command-fixture","type":"module"}\n',
    'boardsmith.json': '{"name":"focused-command-fixture","backend":"table"}\n',
    'vite.config.ts': GAME_VITE_CONFIG,
    'src/rules/answer.ts': 'export function double(value: number) { return value * 2; }\n',
    'tests/measurement.test.ts': "import { it } from 'vitest';\nit('existing measurement', () => { throw new Error('An undeclared measurement executed.'); });\n",
    'design/CONSTRAINTS.md': '# Constraints\n\n## Hard Constraints\n\n## Growing Structures\n\n### G1\n- State: values\n- Grows with: rounds\n- Chunk: answer\n- Cap: double in src/rules/answer.ts\n- Measured by: tests/measurement.test.ts\n',
  });
  await fs.appendFile(join(project, 'tests/measurement.test.ts'), '// double\n');
  linkGameModules(project);
  initRepo(project);
  git(project, 'remote', 'add', 'origin', 'https://github.com/Shufflewick/BoardSmith.git');
  git(project, 'add', '.gitignore', 'package.json', 'boardsmith.json', 'vite.config.ts', 'src/rules/answer.ts', 'tests/measurement.test.ts', 'design/CONSTRAINTS.md');
  git(project, 'commit', '-qm', 'Existing game');
  const base = git(project, 'rev-parse', 'HEAD').trim();
  await writeFiles(project, {
    'tests/authored.test.ts': `import { expect, it } from 'vitest';
import { double } from '../src/rules/answer.js';
it('claim 1 doubles a value', () => { expect(double(21)).toBe(42); });
it('claim 1 belongs to another ticket', () => { expect(double(21)).toBe(42); throw new Error('An undeclared mutation test executed.'); });
`,
    'design/chunks/answer/CHUNK.md': '# Answer\n\n## Interpretation\n\n1. A value is doubled.\n\n## Spec Manifest\n\n| Test File | Claims Covered | RED Observed |\n|-----------|----------------|--------------|\n| tests/authored.test.ts | 1 | yes |\n\n## Build Manifest\n\n| File | Status |\n|------|--------|\n| src/rules/answer.ts | written |\n',
    'selection.json': JSON.stringify({ ticket: 'Shufflewick/BoardSmith#951', base, tests: [{ file: 'tests/authored.test.ts', names: ['claim 1 doubles a value'] }] }),
    '.agent-policy.json': JSON.stringify({ verify: [{ name: 'full', run: 'boardsmith verify' }], focused: { selection: 'selection.json', fullEvery: 5, verify: [{ name: 'authored', run: 'boardsmith test --selection selection.json' }] } }),
  });
  git(project, 'add', 'tests/authored.test.ts', 'design/chunks/answer/CHUNK.md', 'selection.json', '.agent-policy.json');
  git(project, 'commit', '-qm', 'chunk-answer/step-test');
  await fs.writeFile(join(sandbox.root, 'bin', 'agent-policy'), '#!/bin/sh\nprintf \'%s\\n\' \'{"repository":"Shufflewick/BoardSmith","closedSinceFull":0,"fullEvery":5,"fullDue":false}\'\n', { mode: 0o755 });
  for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, sandbox.env[key]!);
  vi.stubEnv('NODE_OPTIONS', `${sandbox.env.NODE_OPTIONS} --allow-child-process --allow-worker --allow-addons`);
  return { project, sandbox };
}

describe('focused standalone gates (#951)', () => {
  it('keeps unopted constraint checks available before the repository has a first commit', async () => {
    const sandbox = fixtureSandbox('bs-unopted-constraints-', { tools: ['git'] });
    const project = join(sandbox.root, 'game');
    await writeFiles(project, { 'design/CONSTRAINTS.md': '# Constraints\n\n## Hard Constraints\n\n## Growing Structures\n' });
    for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, sandbox.env[key]!);
    vi.stubEnv('NODE_OPTIONS', `${sandbox.env.NODE_OPTIONS} --allow-child-process --allow-worker --allow-addons`);
    try {
      for (const initialized of [false, true]) {
        if (initialized) initRepo(project);
        const run = await spawnCli(['constraint-check'], project);
        expect(run.code, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).toContain('0 hard constraint(s)');
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it('checks constraints structurally and runs authored cases without claiming deferred measurements passed', async () => {
    const { project } = await focusedProject();
    try {
      const run = await spawnCli(['constraint-check'], project);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toMatch(/authored.*1|1.*authored/i);
      expect(run.stdout).toMatch(/measurement.*deferred|deferred.*measurement/i);
      expect(run.stdout).not.toContain('measurement test file(s) passed');
      expect(run.stdout + run.stderr).not.toContain('An undeclared measurement executed.');
      await fs.writeFile(join(project, 'src/rules/answer.ts'), 'export const missing = 42;\n');
      const broken = await spawnCli(['constraint-check'], project);
      expect(broken.code).toBe(1);
      expect(broken.stdout + broken.stderr).toMatch(/double.*src\/rules\/answer.ts/);
    } finally { vi.unstubAllEnvs(); }
  });

  it('keeps static test-step findings and defers mutation execution under the committed focused policy', async () => {
    const { project } = await focusedProject();
    try {
      const run = await spawnCli(['test-step-check', 'answer', '--json'], project);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      const result = JSON.parse(run.stdout);
      expect(result.findings).toEqual([]);
      expect(result.scope.kind).toBe('focused');
      expect(result.mutation).toBeUndefined();
      expect(result.deferred).toMatch(/mutation/i);
      expect(run.stdout + run.stderr).not.toContain('An undeclared mutation test executed.');
      const chunk = join(project, 'design/chunks/answer/CHUNK.md');
      await fs.writeFile(chunk, (await fs.readFile(chunk, 'utf8')).replace('| tests/authored.test.ts | 1 | yes |', '| tests/authored.test.ts | 1 | pending |'));
      const broken = await spawnCli(['test-step-check', 'answer', '--json'], project);
      expect(broken.code).toBe(1);
      expect(JSON.parse(broken.stdout).findings.length).toBeGreaterThan(0);
    } finally { vi.unstubAllEnvs(); }
  });
});
