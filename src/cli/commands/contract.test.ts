import { describe, it, expect } from 'vitest';

import { diffContract, nextContract } from './contract.js';
import type { EngineContract } from '../../contract/index.js';

const BASE: EngineContract = {
  revision: 4,
  bundleProtocol: 2,
  surfaceHash: 'aaaa',
  payloadHash: 'bbbb',
  history: [
    {
      revision: 4,
      date: '2026-01-01',
      bundleProtocol: 2,
      surfaceHash: 'aaaa',
      payloadHash: 'bbbb',
      summary: 'the previous revision, long enough to be useful to a reader',
    },
  ],
};

describe('diffContract', () => {
  it('reports no drift when both fingerprints match', () => {
    expect(diffContract(BASE, { surfaceHash: 'aaaa', payloadHash: 'bbbb' })).toEqual({
      surfaceChanged: false,
      payloadChanged: false,
      drifted: false,
    });
  });

  it('distinguishes a surface change from a payload change', () => {
    // The two dimensions mean different things to the platform — an API change
    // can break a game outright, a payload change alters what players see — so
    // collapsing them into one boolean would lose the part worth reading.
    expect(diffContract(BASE, { surfaceHash: 'zzzz', payloadHash: 'bbbb' }))
      .toMatchObject({ surfaceChanged: true, payloadChanged: false, drifted: true });
    expect(diffContract(BASE, { surfaceHash: 'aaaa', payloadHash: 'zzzz' }))
      .toMatchObject({ surfaceChanged: false, payloadChanged: true, drifted: true });
  });
});

describe('nextContract', () => {
  const computed = { surfaceHash: 'cccc', payloadHash: 'dddd' };

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
    }).toEqual({
      revision: next.revision,
      bundleProtocol: next.bundleProtocol,
      surfaceHash: next.surfaceHash,
      payloadHash: next.payloadHash,
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
