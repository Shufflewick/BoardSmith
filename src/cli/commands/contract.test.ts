import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { diffContract, nextContract, recordable, unmintedPackedChanges } from './contract.js';
import { createProgram } from '../cli.js';
import type { EngineContract } from '../../contract/index.js';

const BASE: EngineContract = {
  revision: 4,
  surfaceHash: 'aaaa',
  payloadHash: 'bbbb',
  formatHash: 'ffff',
  history: [
    {
      revision: 4,
      date: '2026-01-01',
      surfaceHash: 'aaaa',
      payloadHash: 'bbbb',
      formatHash: 'ffff',
      summary: 'the previous revision, long enough to be useful to a reader',
    },
  ],
};

describe('diffContract', () => {
  it('reports no drift when both fingerprints match', () => {
    expect(diffContract(BASE, { surfaceHash: 'aaaa', payloadHash: 'bbbb', formatHash: 'ffff' }))
      .toEqual({
        surfaceChanged: false,
        payloadChanged: false,
        formatChanged: false,
        drifted: false,
      });
  });

  it('reports drift when the committed contract declares no format at all', () => {
    // Every revision before r61 is in this state and cannot leave it: their
    // engines cannot be rebuilt, so nothing can compute a format for them. A
    // contract being recorded NOW has one, and reading absence as "unchanged"
    // is how it would go on being absent.
    const undeclared = { ...BASE, formatHash: undefined } as unknown as EngineContract;
    expect(diffContract(undeclared, { surfaceHash: 'aaaa', payloadHash: 'bbbb', formatHash: 'ffff' }))
      .toMatchObject({ formatChanged: true, drifted: true });
  });

  it('separates a format change from a payload change', () => {
    // A world's STORED BYTES and what a seat SEES are different promises. The
    // platform may run a live world on another engine when the format matches
    // and the payload does not; the reverse is corruption.
    expect(diffContract(BASE, { surfaceHash: 'aaaa', payloadHash: 'zzzz', formatHash: 'ffff' }))
      .toMatchObject({ formatChanged: false, payloadChanged: true, drifted: true });
    expect(diffContract(BASE, { surfaceHash: 'aaaa', payloadHash: 'bbbb', formatHash: 'zzzz' }))
      .toMatchObject({ formatChanged: true, payloadChanged: false, drifted: true });
  });

  it('distinguishes a surface change from a payload change', () => {
    // The two dimensions mean different things to the platform — an API change
    // can break a game outright, a payload change alters what players see — so
    // collapsing them into one boolean would lose the part worth reading.
    expect(diffContract(BASE, { surfaceHash: 'zzzz', payloadHash: 'bbbb', formatHash: 'ffff' }))
      .toMatchObject({ surfaceChanged: true, payloadChanged: false, drifted: true });
    expect(diffContract(BASE, { surfaceHash: 'aaaa', payloadHash: 'zzzz', formatHash: 'ffff' }))
      .toMatchObject({ surfaceChanged: false, payloadChanged: true, drifted: true });
  });
});

describe('nextContract', () => {
  const computed = { surfaceHash: 'cccc', payloadHash: 'dddd', formatHash: 'eeee' };

  it('bumps the revision and appends history', () => {
    const next = nextContract(BASE, computed, {
      summary: 'a normal engine change that keeps old bundles running',
      date: '2026-02-02',
    });

    expect(next.revision).toBe(5);
    expect(next.surfaceHash).toBe('cccc');
    expect(next.history).toHaveLength(2);
    expect(next.history[1]).toMatchObject({ revision: 5, date: '2026-02-02' });
  });

  it('keeps the head of history in sync with the top-level fields', () => {
    // The platform reads the top-level fields but shows a human the history
    // summaries. If those disagree, someone re-vendors on the strength of a
    // changelog entry describing a different engine.
    const next = nextContract(BASE, computed, {
      summary: 'a change whose head entry must mirror the top-level fields',
      date: '2026-02-02',
    });
    const head = next.history[next.history.length - 1]!;

    expect({
      revision: head.revision,
      surfaceHash: head.surfaceHash,
      payloadHash: head.payloadHash,
      formatHash: head.formatHash,
    }).toEqual({
      revision: next.revision,
      surfaceHash: next.surfaceHash,
      payloadHash: next.payloadHash,
      formatHash: next.formatHash,
    });
  });

  it('never rewrites earlier history entries', () => {
    const next = nextContract(BASE, computed, {
      summary: 'a change that must leave the historical record alone',
      date: '2026-02-02',
    });

    expect(next.history[0]).toEqual(BASE.history[0]);
  });
});

describe('recordable', () => {
  const still = { surfaceChanged: false, payloadChanged: false, formatChanged: false, drifted: false };
  const moved = { surfaceChanged: true, payloadChanged: false, formatChanged: false, drifted: true };

  it('records a revision whenever a fingerprint moved', () => {
    expect(recordable(moved, { adopt: false })).toEqual({ record: true, reason: 'drift' });
  });

  it('refuses a revision that would mean nothing', () => {
    // A revision nobody can read a change out of trains the platform team to
    // stop reading them, which is the whole system defeated.
    expect(recordable(still, { adopt: false })).toEqual({
      record: false,
      reason: 'nothing',
    });
  });

  it('records a revision the platform must ADOPT though no fingerprint can see it', () => {
    // ShufflewickPub #409. The platform archives an engine BUILD under its
    // revision number and refuses to overwrite one, on the rule that a revision
    // identifies exactly one engine. So a change no fingerprint can see -- a
    // performance fix, which by definition alters no surface, no payload and no
    // stored byte -- cannot reach a live world at all unless it can be given a
    // number of its own.
    expect(recordable(still, { adopt: true })).toEqual({
      record: true,
      reason: 'adopt',
    });
  });

  it('refuses --adopt when the contract moved on its own', () => {
    // Then it is an ordinary revision and says so in its hashes. Accepting the
    // flag anyway would let "the platform must adopt this" become the sentence
    // every revision carries, which is how it would come to mean nothing.
    expect(recordable(moved, { adopt: true })).toEqual({
      record: false,
      reason: 'adopt-not-needed',
    });
  });
});

describe('boardsmith contract options (#524)', () => {
  it('has no --breaking: a true ABI break is an ordinary revision the platform answers by raising its minimum', () => {
    const contract = createProgram().commands.find((c) => c.name() === 'contract')!;
    expect(contract.options.map((o) => o.long)).not.toContain('--breaking');
  });
});

describe('unmintedPackedChanges (#1534)', () => {
  // ShufflewickPub archives one engine per revision and refuses a BoardSmith main
  // that packs different files under the revision it vendored, so a merge that
  // changes a packed file must mint one.
  const repos: string[] = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
  });

  const git = (repo: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' }).trim();

  function write(repo: string, files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
  }

  /** A repo packing `src` minus tests, at revision 1; returns it and its first commit. */
  function repoAtRevision1(): { repo: string; base: string } {
    const repo = mkdtempSync(join(tmpdir(), 'bs-unminted-'));
    repos.push(repo);
    git(repo, 'init', '-q');
    write(repo, {
      'package.json': JSON.stringify({ name: 'engine', version: '0.0.1', files: ['src', '!src/**/*.test.ts'] }),
      'src/contract/engine-contract.json': JSON.stringify({ revision: 1 }),
      'src/ui.ts': 'export const label = 1;\n',
      'src/gone.ts': 'export const gone = 1;\n',
      'src/ui.test.ts': 'test\n',
      'notes.md': 'not packed\n',
    });
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    return { repo, base: git(repo, 'rev-parse', 'HEAD') };
  }

  function commit(repo: string, files: Record<string, string>, remove: string[] = []): void {
    write(repo, files);
    for (const path of remove) git(repo, 'rm', '-q', path);
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'change');
  }

  it('names a packed file changed, and one deleted, with no new revision', async () => {
    const { repo, base } = repoAtRevision1();
    commit(repo, { 'src/ui.ts': 'export const label = 2;\n' }, ['src/gone.ts']);
    expect(await unmintedPackedChanges(repo, base)).toEqual(['src/gone.ts', 'src/ui.ts']);
  });

  it('passes a change to files the package does not pack', async () => {
    const { repo, base } = repoAtRevision1();
    commit(repo, { 'notes.md': 'edited\n', 'src/ui.test.ts': 'edited\n' });
    expect(await unmintedPackedChanges(repo, base)).toEqual([]);
  });

  it('passes a packed change that mints a revision', async () => {
    const { repo, base } = repoAtRevision1();
    commit(repo, {
      'src/ui.ts': 'export const label = 2;\n',
      'src/contract/engine-contract.json': JSON.stringify({ revision: 2 }),
    });
    expect(await unmintedPackedChanges(repo, base)).toEqual([]);
  });

  it('is what `boardsmith contract --minted-since` checks in this repository', async () => {
    process.exitCode = undefined;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createProgram().parseAsync(['node', 'boardsmith', 'contract', '--minted-since', 'HEAD']);
    expect(log.mock.calls.flat().join('')).toContain('No file the platform packs changed since HEAD');
    log.mockRestore();
    expect(process.exitCode).toBeUndefined();
  });
});
