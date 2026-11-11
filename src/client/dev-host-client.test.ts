import { describe, expect, it, vi } from 'vitest';
// Through the package entry, `boardsmith/client`, as a game imports it.
import { createDevHostClient } from './index.js';

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

// #1614: the host pushes only the log lines a connection was not sent; a
// subscriber is handed the whole log.
describe('createDevHostClient game_state log', () => {
  it('hands subscribers each game_state with the whole log', async () => {
    const client = createDevHostClient('ws://test', { wsImplementation: FakeSocket as unknown as typeof WebSocket });
    await client.opened;
    const logs: unknown[] = [];
    client.onMessage((msg) => {
      if (msg.type === 'game_state') logs.push((msg.view as { state: { messages?: unknown[] } }).state.messages);
    });
    FakeSocket.last.receive({ type: 'game_state', view: { state: { messages: [{ text: 'a' }] } } });
    FakeSocket.last.receive({ type: 'game_state', view: { state: { messages: [{ text: 'b' }], messagesFrom: 1 } } });
    expect(logs).toEqual([[{ text: 'a' }], [{ text: 'a' }, { text: 'b' }]]);
  });
});
