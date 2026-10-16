import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { linkGameModules } from '../../testing/installed-modules.test-helper.js';
import { GAME_VITE_CONFIG } from '../lib/test-run-scope.js';
import { git, initRepo, writeFiles } from '../lib/verify-result.test-helper.js';
import type { VerifyResult } from '../lib/verify-result.js';
import { spawnCli } from '../spawn-cli.test-helper.js';
import { makeChunkProject } from './chunk-project.test-helper.js';

vi.setConfig({ testTimeout: 120_000 });

describe('focused game verification (#951)', () => {
  it('records authored-test scope and opens its chunk review without claiming full or mutation verification', async () => {
    const sandbox = fixtureSandbox('bs-focused-game-', { tools: ['git', 'agent-policy'] });
    const project = await makeChunkProject(sandbox.root, [{ slug: 'deal', ui: 'none' }]);
    await writeFiles(project, {
      '.gitignore': '.boardsmith/\nnode_modules/\n',
      'package.json': '{"name":"focused-game-fixture","type":"module"}\n',
      'boardsmith.json': '{"name":"focused-game-fixture","backend":"table"}\n',
      'vite.config.ts': GAME_VITE_CONFIG,
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          strict: true, skipLibCheck: true, noEmit: true,
        },
        include: ['src', 'tests'],
      }),
      'src/rules.ts': 'export const answer = 42;\n',
      'tests/existing.test.ts': "import { it } from 'vitest';\nit('belongs to an earlier ticket', () => { throw new Error('An undeclared game test executed.'); });\n",
    });
    linkGameModules(project);
    initRepo(project);
    git(project, 'remote', 'add', 'origin', 'https://github.com/Shufflewick/BoardSmith.git');
    git(project, 'add', '.gitignore', 'package.json', 'boardsmith.json', 'vite.config.ts', 'tsconfig.json', 'src/rules.ts', 'tests/existing.test.ts', 'design');
    git(project, 'commit', '-qm', 'Before the deal ticket');
    const base = git(project, 'rev-parse', 'HEAD').trim();
    git(project, 'checkout', '-qb', 'chunk/deal');
    await writeFiles(project, {
      'src/rules.ts': 'export const answer = 42;\nexport const doubled = answer * 2;\n',
      'tests/authored.test.ts': "import { expect, it } from 'vitest';\nimport { doubled } from '../src/rules.js';\nit('doubles the answer', () => { expect(doubled).toBe(84); });\n",
      'authored-selection.json': JSON.stringify({
        ticket: 'Shufflewick/BoardSmith#951', base,
        tests: [{ file: 'tests/authored.test.ts', names: ['doubles the answer'] }],
      }),
      '.agent-policy.json': JSON.stringify({
        verify: [{ name: 'full', run: 'npx boardsmith verify --base {changeBase}' }],
        focused: {
          selection: 'authored-selection.json', fullEvery: 5,
          verify: [{ name: 'authored-tests', run: 'npx boardsmith verify --chunk deal --selection authored-selection.json' }],
        },
      }),
    });
    git(project, 'add', 'src/rules.ts', 'tests/authored.test.ts', 'authored-selection.json', '.agent-policy.json');
    git(project, 'commit', '-qm', 'chunk-deal/build');
    const commit = git(project, 'rev-parse', 'HEAD').trim();
    for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, sandbox.env[key]!);
    vi.stubEnv('NODE_OPTIONS', `${sandbox.env.NODE_OPTIONS} --allow-child-process --allow-worker --allow-addons`);
    vi.stubEnv('AGENT_POLICY_HOME', join(sandbox.root, 'policy-home'));
    try {
      const verified = await spawnCli(['verify', '--chunk', 'deal', '--selection', 'authored-selection.json'], project);
      expect(verified.code, verified.stdout + verified.stderr).toBe(0);
      const result: VerifyResult = JSON.parse(await fs.readFile(join(project, '.boardsmith', 'verify', `${commit}.json`), 'utf8'));
      expect(result).toMatchObject({
        commit, passed: true, cleanTree: true, chunk: 'deal', base: { commit: base },
        scope: { kind: 'focused', selection: { path: 'authored-selection.json', ticket: 'Shufflewick/BoardSmith#951', base } },
      });
      expect(result.checks.map((check) => check.name)).toEqual(['test', 'typecheck']);
      expect(result.checks[0]).toMatchObject({ passed: true, counts: { files: 1, tests: 1, passed: 1 } });
      expect(verified.stdout + verified.stderr).not.toContain('An undeclared game test executed.');
      const checked = await spawnCli(['verify', '--check', '--chunk', 'deal'], project);
      expect(checked.code, checked.stdout + checked.stderr).toBe(0);
      expect(checked.stdout).toMatch(/focused/i);
      const review = await spawnCli(['review-gate', 'deal'], project);
      expect(review.code, review.stdout + review.stderr).toBe(0);
      expect(review.stdout).toMatch(/authored tests/i);
      expect(review.stdout).toMatch(/mutation.*deferred|deferred.*mutation/i);
      expect(review.stdout).not.toContain('verify did all of that');
      await fs.writeFile(join(sandbox.root, 'bin', 'agent-policy'), '#!/bin/sh\nprintf \'%s\\n\' \'{"repository":"Shufflewick/BoardSmith","closedSinceFull":5,"fullEvery":5,"fullDue":true}\'\n', { mode: 0o755 });
      for (const args of [
        ['verify', '--chunk', 'deal', '--selection', 'authored-selection.json'],
        ['verify', '--check', '--chunk', 'deal'],
        ['review-gate', 'deal'],
        ['chunk-signoff', 'deal', '--automated', 'Fixture authored-test evidence'],
      ]) {
        const due = await spawnCli(args, project);
        expect(due.code, due.stdout + due.stderr).toBe(1);
        expect(due.stdout + due.stderr).toMatch(/five.*tickets|full.run deadline/i);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
