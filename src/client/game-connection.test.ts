import { describe, it, expect } from 'vitest';
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

  constructor(public url: string) {}

  send(): void {
    // no-op
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
