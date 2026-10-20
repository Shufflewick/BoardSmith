/**
 * `payloadHash` must see the flow state each seat and the spectator are sent,
 * not only the whole-game flow state the server keeps (#968). #778 changed
 * that cut and the contract did not move.
 */
import { describe, expect, it, vi } from 'vitest';

import { computePayloadHash } from './fingerprint.js';

// Slow one-time setup lives here, where no test timeout applies (#354, #1194).
const before = await computePayloadHash();

// Every viewer is cut as if it were seat 1, so the spectator and seat 2 are
// sent seat 1's actions: the leak #778 closed, reopened.
vi.doMock('../engine/flow/public-flow-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/flow/public-flow-state.js')>();
  return { ...actual, toPublicFlowState: (flowState: never) => actual.toPublicFlowState(flowState, 1) };
});
vi.resetModules();
const leaking = await import('./fingerprint.js');
const after = await leaking.computePayloadHash();
vi.doUnmock('../engine/flow/public-flow-state.js');

describe('the payload fingerprint covers the flow state each seat is sent', () => {
  it('moves when a seat is sent a different cut of the flow state', () => {
    expect(after).not.toBe(before);
  });
});
