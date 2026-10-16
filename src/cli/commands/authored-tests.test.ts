import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { git, initRepo, writeFiles } from '../lib/verify-result.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';

vi.setConfig({ testTimeout: 120_000 });

describe('authored test selection (#951)', () => {
  it('typechecks a library workspace and runs only its declared full test name', async () => {
    const sandbox = fixtureSandbox('bs-authored-tests-', { tools: ['git'] });
    const project = join(sandbox.root, 'library');
    await writeFiles(project, {
      '.gitignore': 'node_modules/\n.boardsmith/\n',
      'package.json': '{"name":"authored-tests-library-fixture","type":"module"}\n',
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          strict: true, skipLibCheck: true, noEmit: true, types: [],
        },
        include: ['src/**/*.ts'],
      }),
      'vitest.config.ts': `export default { test: {
  include: ['src/**/*.test.ts'], pool: 'forks', minWorkers: 1, maxWorkers: 1, cache: false,
} };\n`,
      'src/engine/answer.ts': 'export const answer: number = 42;\n',
    });
    await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
    initRepo(project);
    git(project, 'add', '.gitignore', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'src/engine/answer.ts');
    git(project, 'commit', '-qm', 'Existing library before the ticket');
    const base = git(project, 'rev-parse', 'HEAD').trim();
    await writeFiles(project, {
      'src/engine/answer.test.ts': `import { describe, expect, it } from 'vitest';
import { answer } from './answer.js';
describe('library answer', () => {
  it('handles [one] (exact)', () => { expect(answer).toBe(42); });
  it('handles [one] (exact)\\n', () => { throw new Error('A newline suffix ran an undeclared test.'); });
  it('belongs to an earlier ticket', () => { throw new Error('An undeclared test executed.'); });
});\n`,
      'authored-selection.json': JSON.stringify({
        ticket: 'Shufflewick/BoardSmith#951', base,
        tests: [{ file: 'src/engine/answer.test.ts', names: ['library answer handles [one] (exact)'] }],
      }),
    });
    git(project, 'add', 'src/engine/answer.test.ts', 'authored-selection.json');
    git(project, 'commit', '-qm', 'Declare the authored library test');
    for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, sandbox.env[key]!);
    vi.stubEnv('NODE_OPTIONS', `${sandbox.env.NODE_OPTIONS} --allow-child-process --allow-worker --allow-addons`);
    try {
      const run = await spawnCli(['test', '--selection', 'authored-selection.json'], project);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain('Type-checking with vue-tsc');
      expect(run.stdout + run.stderr).not.toContain('An undeclared test executed.');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('runs an exact declared file even when another test filename contains its whole path', async () => {
    const sandbox = fixtureSandbox('bs-authored-file-', { tools: ['git'] });
    const project = join(sandbox.root, 'library');
    await writeFiles(project, {
      'package.json': '{"name":"authored-file-fixture","type":"module"}\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true, skipLibCheck: true, module: 'ESNext', moduleResolution: 'bundler', types: [] }, include: ['src'] }),
      'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'], pool: 'forks', minWorkers: 1, maxWorkers: 1, cache: false } };\n",
      'src/engine/selected.test.ts': "import { expect, it } from 'vitest';\nit('selected case', () => { expect(42).toBe(42); });\n",
      'src/engine/selected.test.ts.extra.test.ts': "import { it } from 'vitest';\nit('selected case', () => { throw new Error('A filename substring ran an undeclared file.'); });\n",
    });
    await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
    initRepo(project);
    git(project, 'add', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'src/engine/selected.test.ts', 'src/engine/selected.test.ts.extra.test.ts');
    git(project, 'commit', '-qm', 'Existing files before exact-file verification');
    const base = git(project, 'rev-parse', 'HEAD').trim();
    await writeFiles(project, { 'authored-selection.json': JSON.stringify({ ticket: 'Shufflewick/BoardSmith#951', base, tests: [{ file: 'src/engine/selected.test.ts', names: ['selected case'] }] }) });
    for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, sandbox.env[key]!);
    vi.stubEnv('NODE_OPTIONS', `${sandbox.env.NODE_OPTIONS} --allow-child-process --allow-worker --allow-addons`);
    try {
      const run = await spawnCli(['test', '--selection', 'authored-selection.json'], project);
      expect(run.code, run.stdout + run.stderr).toBe(0);
      expect(run.stdout + run.stderr).not.toContain('A filename substring ran an undeclared file.');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses empty, missing, skipped and unexecuted authored declarations', async () => {
    const sandbox = fixtureSandbox('bs-authored-refusals-', { tools: ['git'] });
    const project = join(sandbox.root, 'library');
    await writeFiles(project, {
      'package.json': '{"name":"authored-refusals-fixture","type":"module"}\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { noEmit: true, skipLibCheck: true, module: 'ESNext', moduleResolution: 'bundler', types: [] }, include: ['src'] }),
      'vitest.config.ts': "export default { test: { include: ['src/**/*.test.ts'], pool: 'forks', minWorkers: 1, maxWorkers: 1, cache: false } };\n",
      'src/engine/authored.test.ts': `import { it } from 'vitest';
import { kill, pid } from 'node:process';
it.skip('skipped case', () => { throw new Error('A skipped case executed.'); });
it('unexecuted case', () => { kill(pid, 'SIGTERM'); });
`,
    });
    await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
    initRepo(project);
    git(project, 'add', 'package.json', 'tsconfig.json', 'vitest.config.ts', 'src/engine/authored.test.ts');
    git(project, 'commit', '-qm', 'Files before refusal checks');
    const base = git(project, 'rev-parse', 'HEAD').trim();
    const selections = [
      { tests: [], problem: /non-empty tests list/ },
      { tests: [{ file: 'src/engine/missing.test.ts', names: ['missing case'] }], problem: /existing regular test file/ },
      { tests: [{ file: 'src/engine/authored.test.ts', names: ['missing case'] }], problem: /declared tests did not pass/ },
      { tests: [{ file: 'src/engine/authored.test.ts', names: ['skipped case'] }], problem: /declared tests did not pass/ },
      { tests: [{ file: 'src/engine/authored.test.ts', names: ['unexecuted case'] }], problem: /never reported a result|before it finished|exited/ },
    ];
    for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, sandbox.env[key]!);
    vi.stubEnv('NODE_OPTIONS', `${sandbox.env.NODE_OPTIONS} --allow-child-process --allow-worker --allow-addons`);
    try {
      for (const selection of selections) {
        await writeFiles(project, { 'authored-selection.json': JSON.stringify({ ticket: 'Shufflewick/BoardSmith#951', base, tests: selection.tests }) });
        const run = await spawnCli(['test', '--selection', 'authored-selection.json'], project);
        expect(run.code, run.stdout + run.stderr).not.toBe(0);
        expect(run.stdout + run.stderr).toMatch(selection.problem);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
