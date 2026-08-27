import { describe, it, expect, vi } from 'vitest';
import { createDebugBridge, type PlatformRequest } from './useDebugBridge.js';

function bridgeWith(handler: PlatformRequest) {
  const platformRequest = vi.fn(handler);
  return { bridge: createDebugBridge(platformRequest), platformRequest };
}

const ok: PlatformRequest = async () => ({ success: true });

describe('createDebugBridge without a host', () => {
  const bridge = createDebugBridge(null);

  it('says how to get one rather than failing obscurely', async () => {
    await expect(bridge.history()).rejects.toThrow(
      'DebugPanel requires a host bridge (mount it inside GameShell in platform mode).'
    );
  });

  it('refuses every op, including the ones that tolerate a refusal', async () => {
    await expect(bridge.flowState(1)).rejects.toThrow('requires a host bridge');
    await expect(bridge.stateDiff(0, 1, 1)).rejects.toThrow('requires a host bridge');
    await expect(bridge.shuffleDeck(2)).rejects.toThrow('requires a host bridge');
  });
});

describe('debug bridge op names and payloads', () => {
  it('sends each op exactly once, under its own name, with its own payload', async () => {
    const { bridge, platformRequest } = bridgeWith(ok);
    await bridge.actionTraces(3);
    await bridge.flowState(3);
    await bridge.history();
    await bridge.logs();
    await bridge.stateAt(5, 3);
    await bridge.stateDiff(4, 5, 3);
    await bridge.rewind(5);
    await bridge.moveCardToTop(10);
    await bridge.reorderCard(10, 2);
    await bridge.transferCard(10, 7, 'last');
    await bridge.shuffleDeck(2);

    expect(platformRequest.mock.calls).toEqual([
      ['debug:action-traces', { player: 3 }],
      ['debug:flow-state', { player: 3 }],
      ['debug:history', {}],
      ['debug:logs', {}],
      ['debug:state-at', { actionIndex: 5, player: 3 }],
      ['debug:state-diff', { fromIndex: 4, toIndex: 5, player: 3 }],
      ['debug:rewind', { actionIndex: 5 }],
      ['debug:move-to-top', { cardId: 10 }],
      ['debug:reorder-card', { cardId: 10, targetIndex: 2 }],
      ['debug:transfer-card', { cardId: 10, targetDeckId: 7, position: 'last' }],
      ['debug:shuffle-deck', { deckId: 2 }],
    ]);
  });
});

describe('debug bridge failure messages', () => {
  it('prefers the host error string', async () => {
    const { bridge } = bridgeWith(async () => ({ success: false, error: 'card is face down' }));
    await expect(bridge.moveCardToTop(1)).rejects.toThrow('card is face down');
  });

  it('gives each op its own fallback when the host says only "no"', async () => {
    const { bridge } = bridgeWith(async () => ({ success: false }));
    await expect(bridge.actionTraces(1)).rejects.toThrow('Failed to fetch action traces');
    await expect(bridge.history()).rejects.toThrow('Failed to fetch history');
    await expect(bridge.logs()).rejects.toThrow('Failed to fetch logs');
    await expect(bridge.stateAt(1, 1)).rejects.toThrow('Failed to fetch state');
    await expect(bridge.rewind(1)).rejects.toThrow('Rewind failed');
    await expect(bridge.moveCardToTop(1)).rejects.toThrow('Failed to move card');
    await expect(bridge.reorderCard(1, 0)).rejects.toThrow('Failed to reorder card');
    await expect(bridge.transferCard(1, 2, 'first')).rejects.toThrow('Failed to transfer card');
    await expect(bridge.shuffleDeck(1)).rejects.toThrow('Failed to shuffle deck');
  });

  it('lets a broken transport through untouched, so it is not mistaken for a refusal', async () => {
    const { bridge } = bridgeWith(async () => { throw new Error('socket closed'); });
    await expect(bridge.history()).rejects.toThrow('socket closed');
    await expect(bridge.flowState(1)).rejects.toThrow('socket closed');
    await expect(bridge.stateDiff(0, 1, 1)).rejects.toThrow('socket closed');
  });
});

describe('debug bridge response validation', () => {
  it('degrades a non-array traces payload to an empty list', async () => {
    const { bridge } = bridgeWith(async () => ({ success: true, traces: 'nope' }));
    expect((await bridge.actionTraces(1)).traces).toEqual([]);
  });

  it('keeps a well-formed flow context', async () => {
    const context = { flowAllowedActions: ['play'], isMyTurn: true, currentPlayer: 1 };
    const { bridge } = bridgeWith(async () => ({ success: true, flowContext: context }));
    expect((await bridge.actionTraces(1)).flowContext).toEqual(context);
  });

  it('rejects a flow context missing either required field, rather than half-populating one', async () => {
    for (const flowContext of [
      { isMyTurn: true },
      { flowAllowedActions: ['play'] },
      { flowAllowedActions: 'play', isMyTurn: true },
      null,
      'nope',
      ['play'],
    ]) {
      const { bridge } = bridgeWith(async () => ({ success: true, flowContext }));
      expect((await bridge.actionTraces(1)).flowContext).toBeNull();
    }
  });

  it('returns an empty history and an empty log when the host sends neither', async () => {
    const { bridge } = bridgeWith(ok);
    expect(await bridge.history()).toEqual([]);
    expect(await bridge.logs()).toEqual([]);
  });
});

describe('debug bridge refusals that are answers, not failures', () => {
  it('reports no flow position when the host declines to give one', async () => {
    const { bridge } = bridgeWith(async () => ({ success: false, error: 'no flow' }));
    expect(await bridge.flowState(1)).toBeNull();
  });

  it('reports no flow position when the host succeeds but sends nothing', async () => {
    const { bridge } = bridgeWith(ok);
    expect(await bridge.flowState(1)).toBeNull();
  });

  it('returns the flow description when the host has one', async () => {
    const info = { path: [0], awaiting: {}, description: 'phase: play' };
    const { bridge } = bridgeWith(async () => ({ success: true, flowDebugInfo: info }));
    expect(await bridge.flowState(1)).toEqual(info);
  });

  it('reports no diff when the host declines to produce one', async () => {
    const { bridge } = bridgeWith(async () => ({ success: false }));
    expect(await bridge.stateDiff(0, 1, 1)).toBeNull();
  });

  it('returns the diff when the host has one', async () => {
    const diff = { added: [1], removed: [], changed: [], fromIndex: 0, toIndex: 1 };
    const { bridge } = bridgeWith(async () => ({ success: true, diff }));
    expect(await bridge.stateDiff(0, 1, 1)).toEqual(diff);
  });

  it('hands back whatever state the host reports, including nothing', async () => {
    const { bridge } = bridgeWith(async () => ({ success: true, state: { phase: 'play' } }));
    expect(await bridge.stateAt(1, 1)).toEqual({ phase: 'play' });
    const { bridge: empty } = bridgeWith(ok);
    expect(await empty.stateAt(1, 1)).toBeUndefined();
  });
});

describe('debug bridge transfer position', () => {
  it('carries the caller-chosen end of the destination', async () => {
    const { bridge, platformRequest } = bridgeWith(ok);
    await bridge.transferCard(1, 2, 'first');
    expect(platformRequest.mock.calls[0][1]).toMatchObject({ position: 'first' });
  });
});
