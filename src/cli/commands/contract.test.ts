import { describe, it, expect } from 'vitest';

import { diffContract, nextContract, recordable } from './contract.js';
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
