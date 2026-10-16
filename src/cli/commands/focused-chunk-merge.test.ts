import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import { linkGameModules } from '../../testing/installed-modules.test-helper.js';
import { readMergeSignoffs } from '../lib/merge-signoffs.js';
import { GAME_VITE_CONFIG } from '../lib/test-run-scope.js';
import { git, initRepo, recordPassingVerify, writeFiles } from '../lib/verify-result.test-helper.js';
import { chunkMerge } from './chunk-merge.js';
import { recordVerifiedAgainst } from './chunk-provenance.js';
import { recordSignoff } from './chunk-signoff.js';
import { makeChunkProject } from './chunk-project.test-helper.js';

vi.setConfig({ testTimeout: 120_000 });

const policy = {
  verify: [{ name: 'full', run: 'boardsmith verify --base HEAD' }],
  focused: {
    selection: 'authored-selection.json', fullEvery: 5,
    verify: [{ name: 'authored-tests', run: 'boardsmith verify --selection authored-selection.json' }],
  },
};

async function fixture({ focused = true, status = { repository: 'shufflewick/boardsmith', closedSinceFull: 0, fullEvery: 5, fullDue: false } }: { focused?: boolean; status?: unknown } = {}) {
  const sandbox = fixtureSandbox('bs-focused-merge-', { tools: ['git'] });
  const project = await makeChunkProject(sandbox.root, [{
    slug: 'deal', ui: 'none', milestone: 'none',
    manifest: { 'src/rules.ts': 'export const ruling = "base";\n' },
    interpretation: '1. **A deal draws one card.**\n   > A deal draws one card.\n   Source: rulebook/01-dealing.md §"Dealing"',
  }]);
  await writeFiles(project, {
    '.gitignore': '.boardsmith/\nnode_modules/\nexecuted.txt\n',
    'package.json': '{"name":"focused-merge-fixture","type":"module"}\n',
    'boardsmith.json': '{"name":"focused-merge-fixture","backend":"table"}\n',
    'vite.config.ts': GAME_VITE_CONFIG,
    'CLAUDE.md': '# Game\n\n## Hard constraints\n\n- A deal draws at most one card.\n',
    'design/CONSTRAINTS.md': '# Constraints\n\n## Hard Constraints\n\n### C1\n- Quote: A deal draws at most one card.\n- Source: CLAUDE.md\n- Kind: measured\n- Test: tests/budget.test.ts\n\n## Growing Structures\n',
    'design/rulebook/01-dealing.md': '# Dealing\n\nA deal draws one card.\n',
    'design/MERGE-SIGNOFFS.md': `# Merge Sign-offs

<!-- MACHINE-OWNED. Written by \`boardsmith chunk-merge\` and by nothing else. Each entry is a
     source file the merge changed after its chunks signed it off (two chunks built at the same
     time both edited it, the merge renumbered its ledger citations, or only its vitest test
     collection changed since a chunk signed it off), as the merge left it.
     The merge re-ran every named chunk's own checks on the combined file and they passed, so the
     sign-off check accepts that edit for each chunk whose sign-off names the file. -->
`,
    'tests/budget.test.ts': focused
      ? "import { it } from 'vitest';\nit('an earlier measurement', () => { throw new Error('Undeclared measurement executed.'); });\n"
      : "import { appendFileSync } from 'node:fs';\nimport { it } from 'vitest';\nit('an earlier measurement', () => { appendFileSync('executed.txt', 'measurement\\n'); });\n",
    'tests/earlier.test.ts': focused
      ? "import { it } from 'vitest';\nit('an earlier chunk case', () => { throw new Error('Undeclared own check executed.'); });\n"
      : "import { appendFileSync } from 'node:fs';\nimport { it } from 'vitest';\nit('an earlier chunk case', () => { appendFileSync('executed.txt', 'own\\n'); });\n",
  });
  const chunkPath = join(project, 'design/chunks/deal/CHUNK.md');
  const chunk = await fs.readFile(chunkPath, 'utf8');
  await fs.writeFile(chunkPath, chunk
    .replace('<!-- | src/...test.ts | 1, 3, 4 | pending / yes | -->', '| tests/earlier.test.ts | 1 | yes |')
    .replace(/(## Constraints Review\n(?:<!--[\s\S]*?-->\n)?)/, '$1- C1: held. tests/budget.test.ts\n'));
  linkGameModules(project);
  initRepo(project);
  git(project, 'add', '.gitignore', 'package.json', 'boardsmith.json', 'vite.config.ts', 'CLAUDE.md', 'design', 'src/rules.ts', 'tests/budget.test.ts', 'tests/earlier.test.ts');
  git(project, 'commit', '-qm', 'Before focused policy');
  const adoptionBase = git(project, 'rev-parse', 'HEAD').trim();
  await writeFiles(project, {
    '.agent-policy.json': JSON.stringify(focused ? policy : { verify: policy.verify }),
    'tests/previous-authored.test.ts': "import { it } from 'vitest';\nit('previous ticket case', () => {});\n",
    'authored-selection.json': JSON.stringify({ ticket: 'Shufflewick/BoardSmith#950', base: adoptionBase, tests: [{ file: 'tests/previous-authored.test.ts', names: ['previous ticket case'] }] }),
  });
  git(project, 'add', '.agent-policy.json', 'authored-selection.json', 'tests/previous-authored.test.ts');
  git(project, 'commit', '-qm', 'Trusted focused policy');
  const mainCommit = git(project, 'rev-parse', 'HEAD').trim();
  git(project, 'checkout', '-qb', 'chunk/deal');
  await writeFiles(project, {
    'src/rules.ts': 'export const ruling = "Ruling @deal.1";\n',
    'design/RULINGS.md': '# Rulings\n\n### Ruling @deal.1\n- Decision: A deal draws one card.\n',
    'tests/authored.test.ts': "import { appendFileSync } from 'node:fs';\nimport { expect, it } from 'vitest';\nimport { ruling } from '../src/rules.js';\nit('sees the allocated ruling', () => { expect(ruling).toBe('Ruling 1'); appendFileSync('executed.txt', 'ran\\n'); });\n",
    'authored-selection.json': JSON.stringify({ ticket: 'Shufflewick/BoardSmith#951', base: mainCommit, tests: [{ file: 'tests/authored.test.ts', names: ['sees the allocated ruling'] }] }),
  });
  await recordPassingVerify(project, { chunk: 'deal', message: 'chunk-deal/build' });
  await recordSignoff('deal', { project, automated: 'fixture sign-off', now: new Date('2026-10-16T00:00:00Z') });
  await recordVerifiedAgainst('deal', { project });
  git(project, 'add', 'design/chunks/deal/CHUNK.md', 'design/SKETCH.md');
  git(project, 'commit', '-qm', 'chunk-deal/close');
  const branchTip = git(project, 'rev-parse', 'HEAD').trim();
  git(project, 'checkout', '-q', 'main');
  await fs.writeFile(join(sandbox.root, 'bin/agent-policy'), `#!/usr/bin/env node\nif (process.argv.slice(2).join(" ") !== "ticket status --json") throw new Error("Unexpected authority command");\nconsole.log(${JSON.stringify(JSON.stringify(status))});\n`, { mode: 0o755 });
  return { project, sandbox, mainCommit, branchTip };
}

async function inFixture(run: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>, options: Parameters<typeof fixture>[0] = {}) {
  const value = await fixture(options);
  for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, value.sandbox.env[key]!);
  vi.stubEnv('NODE_OPTIONS', `${value.sandbox.env.NODE_OPTIONS} --allow-child-process --allow-worker --allow-addons`);
  try { await run(value); } finally { vi.unstubAllEnvs(); }
}

function expectRestored(project: string, mainCommit: string): void {
  expect(git(project, 'rev-parse', 'HEAD').trim()).toBe(mainCommit);
  expect(git(project, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  expect(() => git(project, 'rev-parse', '--verify', 'MERGE_HEAD')).toThrow();
}

async function changeBranch(project: string, files: Record<string, string>): Promise<void> {
  git(project, 'checkout', '-q', 'chunk/deal');
  await writeFiles(project, files);
  git(project, 'add', ...Object.keys(files));
  git(project, 'commit', '-qm', 'chunk-deal/update');
  git(project, 'checkout', '-q', 'main');
}

describe('focused chunk merge (#951)', () => {
  it('runs authored cases once on the allocated combined tree and records their honest scope', async () => {
    await inFixture(async ({ project, mainCommit, branchTip }) => {
      const result = await chunkMerge(project, 'deal');
      expect(result.refusals).toEqual([]);
      expect(result.merged).toBe(true);
      expect(await fs.readFile(join(project, 'executed.txt'), 'utf8')).toBe('ran\n');
      expect(git(project, 'rev-parse', 'HEAD^1', 'HEAD^2').trim().split('\n')).toEqual([mainCommit, branchTip]);
      const [entry] = await readMergeSignoffs(project);
      expect(entry).toMatchObject({
        path: 'src/rules.ts', chunks: ['deal'],
        scope: { kind: 'focused', selection: { path: 'authored-selection.json', ticket: 'Shufflewick/BoardSmith#951', base: mainCommit, tests: [{ file: 'tests/authored.test.ts', names: ['sees the allocated ruling'] }] } },
      });
      const ledger = await fs.readFile(join(project, 'design/MERGE-SIGNOFFS.md'), 'utf8');
      expect(ledger).toMatch(/^- Scope: focused [0-9a-f]{64}$/m);
      expect(ledger).toMatch(/^- Checks: authored tests, chunk-check, claim-quote-check$/m);
      expect(ledger).toMatch(/^- Deferred: .*measurement.*chunk.*full/m);
      expect(ledger).not.toContain('re-ran every named chunk\'s own checks');
      await fs.writeFile(join(project, 'authored-selection.json'), JSON.stringify({ ticket: 'Shufflewick/BoardSmith#999' }));
      expect(await readMergeSignoffs(project)).toEqual([entry]);
    });
  });

  it('refuses the full-run deadline before running authored tests and restores main', async () => {
    await inFixture(async ({ project, mainCommit }) => {
      const result = await chunkMerge(project, 'deal');
      expect(result.merged).toBe(false);
      expect(result.refusals).toEqual([expect.stringMatching(/five implementation tickets.*full verification/i)]);
      expectRestored(project, mainCommit);
      await expect(fs.stat(join(project, 'executed.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    }, { status: { repository: 'shufflewick/boardsmith', closedSinceFull: 5, fullEvery: 5, fullDue: true } });
  });

  it('refuses inconsistent or unrelated authority status before running tests', async () => {
    for (const status of [
      { repository: 'shufflewick/boardsmith', closedSinceFull: 5, fullEvery: 5, fullDue: false },
      { repository: 'shufflewick/another-game', closedSinceFull: 0, fullEvery: 5, fullDue: false },
    ]) {
      await inFixture(async ({ project, mainCommit }) => {
        const result = await chunkMerge(project, 'deal');
        expect(result.refusals).toEqual([expect.stringMatching(/invalid ticket verification status/i)]);
        expectRestored(project, mainCommit);
        await expect(fs.stat(join(project, 'executed.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      }, { status });
    }
  });

  it('requires the incoming branch to retain the trusted focused opt-in', async () => {
    await inFixture(async ({ project, mainCommit }) => {
      await changeBranch(project, { '.agent-policy.json': JSON.stringify({ verify: policy.verify }) });
      const result = await chunkMerge(project, 'deal');
      expect(result.refusals).toEqual([expect.stringMatching(/committed policy must explicitly opt into focused verification/i)]);
      expectRestored(project, mainCommit);
      await expect(fs.stat(join(project, 'executed.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('retains structural constraint checks and rolls back their prospective signoff records', async () => {
    await inFixture(async ({ project, mainCommit }) => {
      const constraints = await fs.readFile(join(project, 'design/CONSTRAINTS.md'), 'utf8');
      await changeBranch(project, { 'design/CONSTRAINTS.md': constraints.replace('- Kind: measured', '- Kind: unverified') });
      const result = await chunkMerge(project, 'deal');
      expect(result.merged).toBe(false);
      expect(result.refusals.join('\n')).toMatch(/C1 has Kind "unverified"/);
      expectRestored(project, mainCommit);
      expect(await readMergeSignoffs(project)).toEqual([]);
      await expect(fs.stat(join(project, 'executed.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('rolls back a failing actual authored case without recording a completed merge', async () => {
    await inFixture(async ({ project, mainCommit }) => {
      const authored = git(project, 'show', 'chunk/deal:tests/authored.test.ts');
      await changeBranch(project, { 'tests/authored.test.ts': authored.replace("toBe('Ruling 1')", "toBe('Ruling 2')") });
      const result = await chunkMerge(project, 'deal');
      expect(result.merged).toBe(false);
      expect(result.refusals.join('\n')).toMatch(/Authored tests could not verify the combined tree/);
      expectRestored(project, mainCommit);
      expect(await readMergeSignoffs(project)).toEqual([]);
    });
  });

  it('keeps measurement, own and whole-suite tests for a project without a trusted opt-in', async () => {
    await inFixture(async ({ project }) => {
      await changeBranch(project, { '.agent-policy.json': JSON.stringify(policy) });
      const result = await chunkMerge(project, 'deal');
      expect(result.refusals).toEqual([]);
      expect(result.scope).toBeUndefined();
      expect((await fs.readFile(join(project, 'executed.txt'), 'utf8')).trim().split('\n').sort()).toEqual(['measurement', 'measurement', 'own', 'own', 'ran']);
      const [entry] = await readMergeSignoffs(project);
      expect(entry.scope).toBeUndefined();
      const ledger = await fs.readFile(join(project, 'design/MERGE-SIGNOFFS.md'), 'utf8');
      expect(ledger).toMatch(/^- Checks: tests, chunk-check, claim-quote-check$/m);
      expect(ledger).not.toMatch(/^- Scope: focused/m);
    }, { focused: false });
  });
});
