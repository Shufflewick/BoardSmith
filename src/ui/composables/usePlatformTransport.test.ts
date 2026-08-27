// @vitest-environment jsdom
/**
 * THE ONE OUTBOUND CHOKEPOINT (#41).
 *
 * Every server call GameShell makes in platform mode -- actions, choices,
 * selection steps, cancel, undo, demo control, and all eleven `debug:*` ops --
 * goes through one request/response bridge over postMessage. It lived inside
 * GameShell.vue as a closure over a module-level counter and a pending map, so
 * the only way to exercise a timeout, a late response, or unmount-while-pending
 * was to mount the whole shell and drive it end to end. None of those three
 * paths had a test.
 *
 * These pin the wire contract as it shipped, before the extraction moved it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlatformTransport } from './usePlatformTransport.js';

function makeTransport(overrides: Partial<Parameters<typeof usePlatformTransport>[0]> = {}) {
  const posted: unknown[] = [];
  const transport = usePlatformTransport({
    boundaryState: () => null,
    post: (message) => posted.push(message),
    ...overrides,
  });
  return { transport, posted };
}

describe('usePlatformTransport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('posts the host request envelope, with a per-instance request id', () => {
    const { transport, posted } = makeTransport();

    void transport.request('undo', { player: 2 });
    void transport.request('action', { actionName: 'move', args: {} });

    expect(posted).toEqual([
      {
        source: 'shufflewick-game',
        type: 'server_request',
        requestId: 'req-0',
        op: 'undo',
        // The boundary key rides on EVERY op, not just the submitting ones, and
        // reads `flow:unknown` when there is no rendered flow state to stamp from.
        payload: { player: 2, boundaryKey: 'flow:unknown' },
      },
      {
        source: 'shufflewick-game',
        type: 'server_request',
        requestId: 'req-1',
        op: 'action',
        payload: { actionName: 'move', args: {}, boundaryKey: 'flow:unknown' },
      },
    ]);
  });

  it('stamps the boundary key from the state the shell rendered', () => {
    const { transport, posted } = makeTransport({
      boundaryState: () => ({ position: { path: [0], iterations: {}, variables: {} } } as never),
    });

    void transport.request('action', { actionName: 'play', args: {} });

    const payload = (posted[0] as { payload: Record<string, unknown> }).payload;
    // The key rides on the payload rather than being added per call site, which
    // is how a submission ends up carrying no key and landing in the wrong round.
    expect(Object.keys(payload)).toContain('boundaryKey');
  });

  it('resolves the pending request when its response arrives', async () => {
    const { transport } = makeTransport();
    const pending = transport.request('resolve_choices', {});

    transport.handleResponse({ requestId: 'req-0', result: { success: true, choices: [1, 2] } });

    await expect(pending).resolves.toEqual({ success: true, choices: [1, 2] });
    expect(transport.pendingCount()).toBe(0);
  });

  it('falls back to the message itself when the host sends no result envelope', async () => {
    const { transport } = makeTransport();
    const pending = transport.request('undo', {});

    transport.handleResponse({ requestId: 'req-0', success: true });

    await expect(pending).resolves.toMatchObject({ success: true });
  });

  it('resolves a timed-out request as a failure naming the op', async () => {
    const { transport } = makeTransport();
    const pending = transport.request('debug:state', {});

    vi.advanceTimersByTime(20_000);

    await expect(pending).resolves.toEqual({ success: false, error: "Timed out on 'debug:state'" });
    expect(transport.pendingCount()).toBe(0);
  });

  it('ignores a response that arrives after its timeout', async () => {
    const { transport } = makeTransport();
    const pending = transport.request('undo', {});
    vi.advanceTimersByTime(20_000);

    // No throw, no second resolution: the entry is already gone.
    transport.handleResponse({ requestId: 'req-0', result: { success: true } });

    await expect(pending).resolves.toEqual({ success: false, error: "Timed out on 'undo'" });
  });

  it('ignores a response for a request id it never issued', async () => {
    const { transport } = makeTransport();
    expect(() => transport.handleResponse({ requestId: 'req-999', result: {} })).not.toThrow();
  });

  it('fails every pending request when the shell goes away', async () => {
    const { transport } = makeTransport();
    const a = transport.request('action', {});
    const b = transport.request('undo', {});

    transport.rejectAll('GameShell unmounted');

    await expect(a).resolves.toEqual({ success: false, error: 'GameShell unmounted' });
    await expect(b).resolves.toEqual({ success: false, error: 'GameShell unmounted' });
    expect(transport.pendingCount()).toBe(0);
    // The timers are cleared with them: no stray callback fires afterwards.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('strips Vue reactivity so a natural someRef.value argument survives the clone', async () => {
    const { transport, posted } = makeTransport();
    const { ref, reactive } = await import('vue');

    void transport.request('action', {
      actionName: 'play',
      args: { cards: ref([1, 2]), where: reactive({ zone: 'table' }) },
    });

    const payload = (posted[0] as { payload: { args: Record<string, unknown> } }).payload;
    expect(payload.args).toEqual({ cards: [1, 2], where: { zone: 'table' } });
    expect(() => structuredClone(payload)).not.toThrow();
  });

  it('fails loudly when a live element leaks into the args', () => {
    const { transport } = makeTransport();
    class LiveElement { constructor(public fn = () => {}) {} }

    expect(() => transport.request('action', { args: { piece: new LiveElement() } }))
      .toThrow(/not structured-cloneable/);
  });
});
