import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { BOOKKEEPING_RECORDS, mutantCachePath, openMutantCache, toolRevision } from './mutant-cache.js';
import { commitAll, initRepo, writeFiles as write } from './verify-result.test-helper.js';

const RULES = 'export const fee = (price: number) => price * 2;\n';
const MUTANT = { file: 'src/rules.ts', source: 'export const fee = (price: number) => price / 2;\n' };

/** A committed game project with a rule, its test, and the design records the bs- skills keep. */
async function project(): Promise<string> {
  const dir = join(tempTree('bs-mutant-cache-'), 'game');
  await write(dir, {
    '.gitignore': '.boardsmith/\n',
    'src/rules.ts': RULES,
    'src/other.ts': 'export const other = 1;\n',
    'tests/rules.test.ts': "it('fee', () => {});\n",
    'design/SKETCH.md': 'Session Lock: none\n',
    'design/DESIGN.md': 'the look of the game\n',
    'design/chunks/deal/CHUNK.md': 'Status: built\n',
  });
  initRepo(dir);
  commitAll(dir, 'base');
  return dir;
}

/** Records `outcome` for MUTANT under `revision`, as a verify run of HEAD would, and saves it. */
async function record(dir: string, outcome: 'killed' | 'survived', revision = 'rev-1'): Promise<void> {
  const cache = await openMutantCache(dir, revision);
  cache.set(MUTANT, outcome);
  await cache.save();
}

const lookup = async (dir: string, revision = 'rev-1') => (await openMutantCache(dir, revision)).get(MUTANT);

describe('the mutant cache: a mutant outcome is reused only when nothing it could depend on changed', () => {
  it('reuses an outcome for the same mutant, code, tests and BoardSmith, and after a bookkeeping-only commit', async () => {
    const dir = await project();
    await record(dir, 'killed');
    expect(await lookup(dir)).toBe('killed');

    await write(dir, {
      'design/SKETCH.md': 'Session Lock: none\n\n1. deal - verified\n',
      'design/chunks/deal/CHUNK.md': 'Status: verified\n\n## Verified Commit Hash\nabc\n',
      'design/DECISIONS.md': '## Decision 1\n',
      'design/RULINGS.md': '## Ruling 1\n',
      'design/QUESTIONS.md': '## Q1\n',
      'design/FILINGS.md': '## F1\n',
      'design/ASSETS.md': '## Ledger\n',
      'design/RUN.md': 'Run Status: running\n',
      'design/MERGE-SIGNOFFS.md': '# Merge sign-offs\n',
      'design/GATE-TRANSITION.md': '# Gate transition\n',
      'design/run-log/deal.md': '### Dispatch 1\nOutcome: closed\n',
    });
    commitAll(dir, 'chunk-deal/step-close');
    expect(await lookup(dir)).toBe('killed');
  });

  it('runs the mutant again when a test, other code, a non-bookkeeping design file, or evidence changed', async () => {
    const changes: Array<Record<string, string>> = [
      { 'tests/rules.test.ts': "it('fee', () => { expect(1).toBe(1); });\n" },
      { 'tests/new.test.ts': "it('new', () => {});\n" },
      { 'src/other.ts': 'export const other = 2;\n' },
      { 'src/rules.ts': `${RULES}export const tax = 1;\n` },
      { 'design/DESIGN.md': 'a test may read this\n' },
      { 'design/chunks/deal/evidence/probe.mjs': 'export {};\n' },
      { 'package-lock.json': '{}\n' },
    ];
    for (const change of changes) {
      const dir = await project();
      await record(dir, 'survived');
      await write(dir, change);
      commitAll(dir, 'change');
      expect({ change: Object.keys(change)[0], outcome: await lookup(dir) }).toEqual({
        change: Object.keys(change)[0],
        outcome: undefined,
      });
    }
  });

  it('runs the mutant again under a different BoardSmith, or when the mutant itself differs', async () => {
    const dir = await project();
    await record(dir, 'killed');
    expect(await lookup(dir, 'rev-2')).toBeUndefined();
    const cache = await openMutantCache(dir, 'rev-1');
    expect(cache.get({ ...MUTANT, source: 'export const fee = (price: number) => price * 3;\n' })).toBeUndefined();
    expect(cache.get({ ...MUTANT, file: 'src/other.ts' })).toBeUndefined();
  });

  it('keeps only the outcomes the last saved run looked up or recorded, so it never grows past one run', async () => {
    const dir = await project();
    const other = { file: 'src/other.ts', source: 'export const other = 0;\n' };
    const first = await openMutantCache(dir, 'rev-1');
    first.set(MUTANT, 'killed');
    first.set(other, 'survived');
    await first.save();

    const second = await openMutantCache(dir, 'rev-1');
    expect(second.get(MUTANT)).toBe('killed');
    await second.save();

    const third = await openMutantCache(dir, 'rev-1');
    expect(third.get(MUTANT)).toBe('killed');
    expect(third.get(other)).toBeUndefined();
  });

  it('starts empty, without failing, when the file on disk is unreadable', async () => {
    const dir = await project();
    await fs.mkdir(dirname(mutantCachePath(dir)), { recursive: true });
    await fs.writeFile(mutantCachePath(dir), 'not json');
    expect(await lookup(dir)).toBeUndefined();
    await record(dir, 'killed');
    expect(await lookup(dir)).toBe('killed');
  });

  it('measures a game in a subfolder of its repository by its own files only', async () => {
    const root = join(tempTree('bs-mutant-cache-'), 'repo');
    await write(root, {
      '.gitignore': '.boardsmith/\n',
      'games/bid/src/rules.ts': RULES,
      'games/bid/tests/rules.test.ts': "it('fee', () => {});\n",
      'games/other/src/rules.ts': 'export const o = 1;\n',
    });
    initRepo(root);
    commitAll(root, 'base');
    const dir = join(root, 'games', 'bid');
    await record(dir, 'killed');
    await write(root, { 'games/other/src/rules.ts': 'export const o = 2;\n' });
    commitAll(root, 'another game changed');
    expect(await lookup(dir)).toBe('killed');
    await write(dir, { 'tests/rules.test.ts': "it('fee 2', () => {});\n" });
    commitAll(root, 'this game changed');
    expect(await lookup(dir)).toBeUndefined();
  });

  it('leaves out exactly the design records the bs- skills write after the code is verified', () => {
    const left = (path: string) => BOOKKEEPING_RECORDS.some((re) => re.test(path));
    expect(left('design/SKETCH.md')).toBe(true);
    expect(left('design/chunks/deal/CHUNK.md')).toBe(true);
    expect(left('design/run-log/deal.md')).toBe(true);
    expect(left('design/DESIGN.md')).toBe(false);
    expect(left('design/BRIEF.md')).toBe(false);
    expect(left('design/rulebook/01-setup.md')).toBe(false);
    expect(left('design/chunks/deal/evidence/probe.mjs')).toBe(false);
    expect(left('design/chunks/deal/notes/CHUNK.md')).toBe(false);
    expect(left('src/SKETCH.md')).toBe(false);
    expect(left('tests/design/SKETCH.md')).toBe(false);
  });
});

describe('toolRevision: which BoardSmith produced an outcome', () => {
  it('names a checkout by its commit and its uncommitted changes, so an edit to BoardSmith is a new revision', async () => {
    const root = join(tempTree('bs-mutant-cache-tool-'), 'boardsmith');
    await write(root, { 'src/engine.ts': 'export const e = 1;\n' });
    initRepo(root);
    commitAll(root, 'engine');
    const clean = await toolRevision(root);
    expect(await toolRevision(root)).toBe(clean);

    await write(root, { 'src/engine.ts': 'export const e = 2;\n' });
    const edited = await toolRevision(root);
    expect(edited).not.toBe(clean);

    await write(root, { 'src/engine.ts': 'export const e = 1;\n', 'src/new.ts': 'export const n = 1;\n' });
    const untracked = await toolRevision(root);
    expect(untracked).not.toBe(clean);
    expect(untracked).not.toBe(edited);

    await fs.rm(join(root, 'src/new.ts'));
    expect(await toolRevision(root)).toBe(clean);
    commitAll(root, 'engine 2');
    expect(await toolRevision(root)).not.toBe(clean);
  });

  it('names an installed copy, which has no git of its own, by its version and engine revision', async () => {
    const root = join(tempTree('bs-mutant-cache-tool-'), 'installed');
    await write(root, { 'package.json': '{}\n' });
    expect(await toolRevision(root)).toMatch(/^boardsmith@.+ engine \d+$/);
  });
});
