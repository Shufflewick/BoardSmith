import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { chunkHistory, chunkPins, fileAtCommit, findChunkCommits } from './chunk-commits.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * A chunk's own commits are the ones whose message starts `chunk-<slug>/` (state-machine.md "Git
 * Protocol"); its base commit is the first parent of the oldest of them. Together they are the
 * chunk's history, the only commits a claim may pin a quote to (`path@<commit>:N-M`, #426).
 */

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
}

async function commit(dir: string, message: string, files: Record<string, string>): Promise<string> {
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(join(dir, rel, '..'), { recursive: true });
    await fs.writeFile(join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

async function repo(): Promise<string> {
  const tree = tempTree('bs-chunk-commits-');
  const dir = join(tree, 'game');
  await fs.mkdir(dir, { recursive: true });
  git(dir, 'init', '-q');
  return dir;
}

describe('the chunk\'s history (#426)', () => {
  it('is the chunk\'s own commits, newest first, then its base, the parent of the oldest of them', async () => {
    const dir = await repo();
    const older = await commit(dir, 'initial', { 'src/a.ts': 'one\n' });
    const base = await commit(dir, 'chunk-setup/step-close: done', { 'src/a.ts': 'two\n' });
    const investigate = await commit(dir, 'chunk-combat/step-investigate: claims', { 'design/x.md': 'x\n' });
    const unrelated = await commit(dir, 'unrelated', { 'README.md': 'r\n' });
    const build = await commit(dir, 'chunk-combat/step-build: green', { 'src/a.ts': 'three\n' });
    expect(await chunkHistory(dir, 'combat')).toEqual([
      { hash: build, label: 'chunk-combat/step-build: green' },
      { hash: investigate, label: 'chunk-combat/step-investigate: claims' },
      { hash: base, label: 'base of chunk-combat' },
    ]);
    expect([...(await findChunkCommits(dir, 'combat'))].sort()).toEqual([investigate, build].sort());
    expect(await chunkPins(dir, 'combat')(base.slice(0, 7))).toEqual({ ok: true, commit: { hash: base, label: 'base of chunk-combat' } });
    expect(await chunkPins(dir, 'combat')(investigate)).toMatchObject({ ok: true, commit: { hash: investigate } });
    for (const outside of [older, unrelated]) {
      const refused = await chunkPins(dir, 'combat')(outside.slice(0, 7));
      expect(refused).toMatchObject({ ok: false });
      expect(!refused.ok && refused.problem).toMatch(/is not a commit of chunk "combat".*base of chunk-combat/);
    }
    expect(await fileAtCommit(dir, base, 'src/a.ts')).toBe('two\n');
    expect(await fileAtCommit(dir, base, 'src/missing.ts')).toBeUndefined();
  });

  it('has no base when the chunk\'s first commit is the repository\'s first', async () => {
    const dir = await repo();
    const first = await commit(dir, 'chunk-combat/step-investigate: claims', { 'src/a.ts': 'one\n' });
    expect(await chunkHistory(dir, 'combat')).toEqual([{ hash: first, label: 'chunk-combat/step-investigate: claims' }]);
  });

  it('refuses a pin, saying how to commit, when the chunk has no commit yet', async () => {
    const dir = await repo();
    const initial = await commit(dir, 'initial', { 'src/a.ts': 'one\n' });
    const refused = await chunkPins(dir, 'combat')(initial);
    expect(!refused.ok && refused.problem).toMatch(/No commit for chunk "combat" yet.*chunk-combat\/step-<name>/);
  });
});

describe('the chunk\'s history while a merge is in progress (#435)', () => {
  it('includes the commits being merged, so a check run on the combined tree sees the branch\'s chunk', async () => {
    const dir = await repo();
    git(dir, 'checkout', '-q', '-b', 'main');
    await commit(dir, 'initial', { 'src/a.ts': 'one\n' });
    const earlier = await commit(dir, 'chunk-setup/step-close: done', { 'src/a.ts': 'two\n' });
    git(dir, 'checkout', '-q', '-b', 'chunk/combat');
    const investigate = await commit(dir, 'chunk-combat/step-investigate: claims', { 'design/x.md': 'x\n' });
    const build = await commit(dir, 'chunk-combat/step-build: green', { 'src/b.ts': 'three\n' });
    git(dir, 'checkout', '-q', 'main');
    const mainLine = await commit(dir, 'chunk-trade/step-close: done', { 'src/c.ts': 'four\n' });
    git(dir, 'merge', '-q', '--no-ff', '--no-commit', 'chunk/combat');

    expect(await chunkHistory(dir, 'combat')).toEqual([
      { hash: build, label: 'chunk-combat/step-build: green' },
      { hash: investigate, label: 'chunk-combat/step-investigate: claims' },
      { hash: earlier, label: 'base of chunk-combat' },
    ]);
    expect(await chunkPins(dir, 'combat')(build.slice(0, 10))).toMatchObject({ ok: true, commit: { hash: build } });
    // The main line's own chunks are still found: the combined tree is both histories.
    expect([...(await findChunkCommits(dir, 'trade'))]).toEqual([mainLine]);
  });
});
