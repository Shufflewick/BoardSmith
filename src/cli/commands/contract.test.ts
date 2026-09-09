import { describe, it, expect } from 'vitest';

import { diffContract, nextContract, recordable } from './contract.js';
import type { EngineContract } from '../../contract/index.js';

const BASE: EngineContract = {
  revision: 4,
  bundleProtocol: 2,
  surfaceHash: 'aaaa',
  payloadHash: 'bbbb',
  formatHash: 'ffff',
  history: [
    {
      revision: 4,
      date: '2026-01-01',
      bundleProtocol: 2,
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

  it('bumps the revision and appends history without touching bundleProtocol', () => {
    const next = nextContract(BASE, computed, {
      summary: 'a normal engine change that keeps old bundles running',
      breaking: false,
      date: '2026-02-02',
    });

    expect(next.revision).toBe(5);
    expect(next.bundleProtocol).toBe(2);
    expect(next.surfaceHash).toBe('cccc');
    expect(next.history).toHaveLength(2);
    expect(next.history[1]).toMatchObject({ revision: 5, date: '2026-02-02', bundleProtocol: 2 });
  });

  it('bumps bundleProtocol only when the change is declared breaking', () => {
    const next = nextContract(BASE, computed, {
      summary: 'an ABI change that stops already-built bundles from running',
      breaking: true,
      date: '2026-02-02',
    });

    expect(next.bundleProtocol).toBe(3);
    expect(next.history[1]!.bundleProtocol).toBe(3);
  });

  it('keeps the head of history in sync with the top-level fields', () => {
    // The platform reads the top-level fields but shows a human the history
    // summaries. If those disagree, someone re-vendors on the strength of a
    // changelog entry describing a different engine.
    const next = nextContract(BASE, computed, {
      summary: 'a change whose head entry must mirror the top-level fields',
      breaking: true,
      date: '2026-02-02',
    });
    const head = next.history[next.history.length - 1]!;

    expect({
      revision: head.revision,
      bundleProtocol: head.bundleProtocol,
      surfaceHash: head.surfaceHash,
      payloadHash: head.payloadHash,
      formatHash: head.formatHash,
    }).toEqual({
      revision: next.revision,
      bundleProtocol: next.bundleProtocol,
      surfaceHash: next.surfaceHash,
      payloadHash: next.payloadHash,
      formatHash: next.formatHash,
    });
  });

  it('never rewrites earlier history entries', () => {
    const next = nextContract(BASE, computed, {
      summary: 'a change that must leave the historical record alone',
      breaking: true,
      date: '2026-02-02',
    });

    expect(next.history[0]).toEqual(BASE.history[0]);
  });
});

describe('recordable', () => {
  const still = { surfaceChanged: false, payloadChanged: false, formatChanged: false, drifted: false };
  const moved = { surfaceChanged: true, payloadChanged: false, formatChanged: false, drifted: true };

  it('records a revision whenever a fingerprint moved', () => {
    expect(recordable(moved, { breaking: false, adopt: false })).toEqual({ record: true, reason: 'drift' });
  });

  it('refuses a revision that would mean nothing', () => {
    // A revision nobody can read a change out of trains the platform team to
    // stop reading them, which is the whole system defeated.
    expect(recordable(still, { breaking: false, adopt: false })).toEqual({
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
    expect(recordable(still, { breaking: false, adopt: true })).toEqual({
      record: true,
      reason: 'adopt',
    });
  });

  it('refuses --adopt when the contract moved on its own', () => {
    // Then it is an ordinary revision and says so in its hashes. Accepting the
    // flag anyway would let "the platform must adopt this" become the sentence
    // every revision carries, which is how it would come to mean nothing.
    expect(recordable(moved, { breaking: false, adopt: true })).toEqual({
      record: false,
      reason: 'adopt-not-needed',
    });
  });

  it('records a breaking bump with no drift, because the protocol IS the change', () => {
    expect(recordable(still, { breaking: true, adopt: false })).toEqual({
      record: true,
      reason: 'breaking',
    });
  });
});
