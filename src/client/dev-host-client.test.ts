import { describe, expect, it, vi } from 'vitest';
// Through the package entry, `boardsmith/client`, as a game imports it.
import { createDevHostClient } from './index.js';
import { diffView, stampRev } from '../session/view-patch.js';

/** Minimal in-memory WebSocket: opens at once and records what the client sends. */
class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  static last: FakeSocket;
  readyState = FakeSocket.OPEN;
  sent: Record<string, unknown>[] = [];
  constructor(_url: string) {
    super();
    FakeSocket.last = this;
    queueMicrotask(() => this.dispatchEvent(new Event('open')));
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {}
  receive(msg: Record<string, unknown>): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) }));
  }
}

describe('createDevHostClient onMessage listeners (#741)', () => {
  it('answers the waiting request and reports the error when a listener throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = createDevHostClient('ws://test', {
      wsImplementation: FakeSocket as unknown as typeof WebSocket,
      requestTimeoutMs: 1000,
    });
    await client.opened;
    client.hello();
    client.onMessage(() => {
      throw new Error('listener broke');
    });

    const reply = client.serverRequest('action', { boundaryKey: 'k' });
    const { requestId } = FakeSocket.last.sent.at(-1)!;
    FakeSocket.last.receive({ type: 'server_response', requestId, result: { ok: true } });

    await expect(reply).resolves.toEqual({ ok: true });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('listener broke'));
    consoleError.mockRestore();
  });
});

// #1616: after the first game_state, the host pushes a patch against the view
// this connection holds; a subscriber is handed the whole view, and a
// connection that does not hold the patch's base asks for the whole view.
describe('createDevHostClient game_state patches', () => {
  const v1 = stampRev({ state: { board: 'a' } });
  const v2 = stampRev({ state: { board: 'b' } });
  const v3 = stampRev({ state: { board: 'c' } });

  async function connected() {
    const client = createDevHostClient('ws://test', { wsImplementation: FakeSocket as unknown as typeof WebSocket });
    await client.opened;
    client.hello();
    const views: unknown[] = [];
    client.onMessage((msg) => {
      if (msg.type === 'game_state') views.push(msg.view);
    });
    return views;
  }

  it('hands subscribers the whole view a patch makes of the one it holds', async () => {
    const views = await connected();
    FakeSocket.last.receive({ type: 'game_state', view: v1 });
    FakeSocket.last.receive({ type: 'game_state', patch: { base: v1.rev, ops: diffView(v1, v2) } });
    expect(views).toEqual([v1, v2]);
  });

  it('applies the next patch to the view it was sent, whatever a subscriber did to its copy (#1616 review F1)', async () => {
    const views = await connected();
    FakeSocket.last.receive({ type: 'game_state', view: v1 });
    (views[0] as { state: Record<string, unknown> }).state.scribbled = true;
    FakeSocket.last.receive({ type: 'game_state', patch: { base: v1.rev, ops: diffView(v1, v2) } });
    expect(views[1]).toEqual(v2);
  });

  it('asks for the whole view when a patch cannot be applied to the view it holds, rather than throw', async () => {
    const views = await connected();
    FakeSocket.last.receive({ type: 'game_state', view: v1 });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    FakeSocket.last.receive({ type: 'game_state', patch: { base: v1.rev, ops: [['set', ['state', 'missing', 'deep'], 1]] } });
    expect(views).toEqual([v1]);
    expect(FakeSocket.last.sent.at(-1)).toEqual({ type: 'getState' });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('asks for the whole view when it missed a push, and hands subscribers that', async () => {
    const views = await connected();
    FakeSocket.last.receive({ type: 'game_state', view: v1 });
    // The push from v1 to v2 never arrived.
    FakeSocket.last.receive({ type: 'game_state', patch: { base: v2.rev, ops: diffView(v2, v3) } });
    expect(views).toEqual([v1]);
    expect(FakeSocket.last.sent.at(-1)).toEqual({ type: 'getState' });
    FakeSocket.last.receive({ type: 'game_state', view: v3, requestId: null });
    expect(views).toEqual([v1, v3]);
  });
});
