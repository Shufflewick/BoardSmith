/**
 * The gate that makes the engine contract impossible to forget.
 *
 * Everything else in this system is tooling someone has to remember to run.
 * This test runs on every `npm test`, so an engine change that alters the
 * platform-reachable surface or the player-view payload cannot reach a commit
 * without either updating the contract or deliberately deleting this test.
 */

import { describe, it, expect } from 'vitest';

import { ENGINE_CONTRACT } from './index.js';
import { computeFingerprints, PLATFORM_ENTRYPOINTS } from './fingerprint.js';

const UPDATE_HINT = (dimension: string) =>
  `The engine's ${dimension} no longer matches src/contract/engine-contract.json.\n\n`
  + 'If that is intentional, record it so the platform learns about it:\n'
  + '  boardsmith contract --update --summary "<one sentence for the platform team>"\n\n'
  + 'ShufflewickPub runs a vendored copy of this engine, and published games run on '
  + 'THAT copy rather than the one they were built against. An unrecorded change ships '
  + 'silently and shows up as a game misbehaving in production.\n\n'
  + 'See docs/engine-contract.md.';

describe('engine contract', () => {
  it('matches the committed surface fingerprint', async () => {
    const { surfaceHash } = await computeFingerprints();
    expect(surfaceHash, UPDATE_HINT('exported API surface')).toBe(ENGINE_CONTRACT.surfaceHash);
  });

  it('matches the committed player-view payload fingerprint', async () => {
    const { payloadHash } = await computeFingerprints();
    expect(payloadHash, UPDATE_HINT('player-view payload')).toBe(ENGINE_CONTRACT.payloadHash);
  });

  it('is deterministic across runs', async () => {
    // A fingerprint that drifts on its own would be worse than none: it would
    // train everyone to re-run `contract:update` reflexively until the test
    // went green, which is indistinguishable from ignoring it.
    const first = await computeFingerprints();
    const second = await computeFingerprints();
    expect(second).toEqual(first);
  });

  it('covers exactly the entrypoints the platform can reach', async () => {
    // Guards against someone widening the executor's `sandboxedRequire` or the
    // games worker's imports without widening the contract — the fingerprint
    // would keep passing while no longer describing what the platform uses.
    expect(PLATFORM_ENTRYPOINTS.map((e) => e.specifier)).toEqual([
      'boardsmith',
      'boardsmith/session',
      'boardsmith/session-host',
      'boardsmith/persistence',
    ]);
  });

  it('records a usable summary for every revision', async () => {
    for (const entry of ENGINE_CONTRACT.history) {
      expect(entry.summary.length, `revision ${entry.revision} has no usable summary`)
        .toBeGreaterThan(20);
    }
  });

  it('has a monotonic, gap-free history ending at the current revision', async () => {
    const revisions = ENGINE_CONTRACT.history.map((entry) => entry.revision);
    expect(revisions).toEqual(revisions.map((_, index) => index + 1));
    expect(ENGINE_CONTRACT.revision).toBe(revisions[revisions.length - 1]);
  });

  it('agrees with the head of its own history', async () => {
    const head = ENGINE_CONTRACT.history[ENGINE_CONTRACT.history.length - 1]!;
    expect({
      surfaceHash: head.surfaceHash,
      payloadHash: head.payloadHash,
      bundleProtocol: head.bundleProtocol,
    }).toEqual({
      surfaceHash: ENGINE_CONTRACT.surfaceHash,
      payloadHash: ENGINE_CONTRACT.payloadHash,
      bundleProtocol: ENGINE_CONTRACT.bundleProtocol,
    });
  });
});
