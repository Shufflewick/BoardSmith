import { describe, it, expect, vi } from 'vitest';
import { GameConnection } from './game-connection.js';

/**
 * Minimal fake WebSocket sufficient for GameConnection's construction path:
 * readyState + OPEN/CONNECTING statics, no-op send/close, and the
 * onopen/onclose/onerror/onmessage handler slots GameConnection assigns.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { wasClean: boolean; code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {}

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

describe('GameConnection Node-capability (DRIVE-02)', () => {
  it('constructs and connects using an injected wsImplementation, not the global', () => {
    const connection = new GameConnection('http://localhost:3000', {
      gameId: 'game-1',
      playerId: 'player-1',
      wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
    });

    expect(() => connection.connect()).not.toThrow();

    // Reach into the private ws field only far enough to prove the injected
    // ctor was used (instanceof), not the browser global.
    const ws = (connection as unknown as { ws: FakeWebSocket | null }).ws;
    expect(ws).toBeInstanceOf(FakeWebSocket);

    connection.disconnect();
  });

  it('throws an actionable error naming Node 22.4 and wsImplementation when no WebSocket is available', () => {
    const original = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;

    try {
      expect(
        () =>
          new GameConnection('http://localhost:3000', {
            gameId: 'game-1',
            playerId: 'player-1',
          })
      ).toThrowError(/22\.4/);
      expect(
        () =>
          new GameConnection('http://localhost:3000', {
            gameId: 'game-1',
            playerId: 'player-1',
          })
      ).toThrowError(/wsImplementation/);
    } finally {
      if (original) {
        (globalThis as { WebSocket?: typeof WebSocket }).WebSocket = original;
      }
    }
  });

  it('resolves wsCtor to globalThis.WebSocket when no override is provided (Node >=22.4)', () => {
    expect(typeof globalThis.WebSocket).toBe('function');

    expect(
      () =>
        new GameConnection('http://localhost:3000', {
          gameId: 'game-1',
          playerId: 'player-1',
        })
    ).not.toThrow();
  });
});

describe('GameConnection.opened (SDK-01)', () => {
  it('resolves after the fake socket fires open', async () => {
    const connection = new GameConnection('http://localhost:3000', {
      gameId: 'game-1',
      playerId: 'player-1',
      wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
    });

    connection.connect();
    const ws = (connection as unknown as { ws: FakeWebSocket | null }).ws!;

    const openedPromise = (connection as unknown as { opened: Promise<void> }).opened;
    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.();

    await expect(openedPromise).resolves.toBeUndefined();
    connection.disconnect();
  });

  it('rejects with an actionable message if the socket fires error before opening', async () => {
    const connection = new GameConnection('http://localhost:3000', {
      gameId: 'game-1',
      playerId: 'player-1',
      wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
    });

    connection.connect();
    const ws = (connection as unknown as { ws: FakeWebSocket | null }).ws!;
    const openedPromise = (connection as unknown as { opened: Promise<void> }).opened;

    ws.onerror?.();

    await expect(openedPromise).rejects.toThrow(/failed|closed/i);
    connection.disconnect();
  });

  it('rejects with an actionable message if the socket fires close before opening', async () => {
    const connection = new GameConnection('http://localhost:3000', {
      gameId: 'game-1',
      playerId: 'player-1',
      wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
    });

    connection.connect();
    const ws = (connection as unknown as { ws: FakeWebSocket | null }).ws!;
    const openedPromise = (connection as unknown as { opened: Promise<void> }).opened;

    ws.onclose?.({ wasClean: false, code: 1006 });

    await expect(openedPromise).rejects.toThrow(/failed|closed/i);
  });
});

describe('GameConnection.action() awaits open (SDK-01, PROC-02 regression)', () => {
  it('sends the action after the socket opens and resolves with the server result, instead of silently resolving {success:false} for a not-yet-open socket', async () => {
    const connection = new GameConnection('http://localhost:3000', {
      gameId: 'game-1',
      playerId: 'player-1',
      wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
    });

    connection.connect();
    const ws = (connection as unknown as { ws: FakeWebSocket | null }).ws!;

    // Socket is still CONNECTING (not OPEN) when action() is called.
    const actionPromise = connection.action('doThing', { foo: 'bar' });

    // Now open the socket.
    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.();

    // Flush microtasks so action()'s internal await-then-send completes.
    // onopen also triggers requestState() ('getState'), so poll for the
    // 'action' message specifically rather than assuming send order.
    let sentAction: { requestId: string } | undefined;
    for (let i = 0; i < 10 && !sentAction; i++) {
      await Promise.resolve();
      sentAction = ws.sentMessages.map((m) => JSON.parse(m)).find((m) => m.type === 'action');
    }

    // Simulate the server's actionResult response for the request that was sent.
    const sent = sentAction!;
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'actionResult',
        requestId: sent.requestId,
        success: true,
        data: { ok: true },
      }),
    });

    const result = await actionPromise;
    expect(result).toEqual({ success: true, error: undefined, data: { ok: true }, message: undefined, followUp: undefined });
    connection.disconnect();
  });

  it('rejects loudly (does not hang, does not silently resolve) if the socket never opens within connectionTimeout', async () => {
    vi.useFakeTimers();
    try {
      const connection = new GameConnection('http://localhost:3000', {
        gameId: 'game-1',
        playerId: 'player-1',
        wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
        connectionTimeout: 50,
      });

      connection.connect();

      const actionPromise = connection.action('doThing');
      const assertion = expect(actionPromise).rejects.toThrow(/timed out|timeout/i);

      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GameConnection disconnect()/connect() symmetry (SDK-02, PROC-02 regression)', () => {
  it('restores auto-reconnect after disconnect() then connect(): a subsequent unclean close reschedules a reconnect', () => {
    vi.useFakeTimers();
    try {
      const connection = new GameConnection('http://localhost:3000', {
        gameId: 'game-1',
        playerId: 'player-1',
        wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
        autoReconnect: true,
        reconnectDelay: 10,
      });

      connection.connect();
      connection.disconnect();
      connection.connect();

      const ws = (connection as unknown as { ws: FakeWebSocket | null }).ws!;
      ws.readyState = FakeWebSocket.OPEN;
      ws.onopen?.();

      const scheduleReconnectSpy = vi.spyOn(connection, 'connect');

      // Unclean close should trigger scheduleReconnect (not suppressed by the
      // earlier disconnect(), since connect() should have restored it).
      ws.onclose?.({ wasClean: false, code: 1006 });

      vi.advanceTimersByTime(1000);

      expect(scheduleReconnectSpy).toHaveBeenCalled();
      connection.disconnect();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disconnect() never mutates config.autoReconnect', () => {
    const connection = new GameConnection('http://localhost:3000', {
      gameId: 'game-1',
      playerId: 'player-1',
      wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
      autoReconnect: true,
    });

    connection.connect();
    connection.disconnect();

    const config = (connection as unknown as { config: { autoReconnect: boolean } }).config;
    expect(config.autoReconnect).toBe(true);
  });

  it('while #userDisconnected is set (after disconnect, before connect), scheduleReconnect does not schedule', () => {
    vi.useFakeTimers();
    try {
      const connection = new GameConnection('http://localhost:3000', {
        gameId: 'game-1',
        playerId: 'player-1',
        wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
        autoReconnect: true,
        reconnectDelay: 10,
      });

      connection.connect();
      const ws = (connection as unknown as { ws: FakeWebSocket | null }).ws!;
      ws.readyState = FakeWebSocket.OPEN;
      ws.onopen?.();

      connection.disconnect();

      const connectSpy = vi.spyOn(connection, 'connect');
      // Directly invoke the private scheduleReconnect to prove the guard bails.
      (connection as unknown as { scheduleReconnect: () => void }).scheduleReconnect();
      vi.advanceTimersByTime(60000);

      expect(connectSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('constructing/connecting with connectImmediately:false opens no socket', () => {
    const connection = new GameConnection('http://localhost:3000', {
      gameId: 'game-1',
      playerId: 'player-1',
      wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
      connectImmediately: false,
    });

    connection.connect();

    const ws = (connection as unknown as { ws: FakeWebSocket | null }).ws;
    expect(ws).toBeNull();
  });
});
