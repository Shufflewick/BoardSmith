import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, effectScope } from 'vue';
import { useGame } from './vue.js';
import { MeepleClient } from './client.js';

/**
 * Minimal fake WebSocket, mirroring game-connection.test.ts's pattern, plus
 * an instance counter so tests can assert exactly how many sockets a given
 * useGame() call sequence opened.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { wasClean: boolean; code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

function makeClient(): MeepleClient {
  return new MeepleClient({
    baseUrl: 'http://localhost:3000',
    playerId: 'player-1',
  });
}

describe('useGame connection setup (SDK-01/SDK-02)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens NO socket when autoConnect is false (connectImmediately threaded, no open-and-kill)', () => {
    // Route MeepleClient.connect() through the fake transport by monkeypatching
    // connect() the same way the real call site threads wsImplementation: via
    // client.connect()'s options. useGame doesn't accept wsImplementation
    // directly, so we spy on MeepleClient.connect to inject it, mirroring how
    // a Node caller would configure their own client.
    const client = makeClient();
    const connectSpy = vi.spyOn(client, 'connect');
    const scope = effectScope();

    scope.run(() => {
      useGame(client, ref('game-1'), { autoConnect: false });
    });

    expect(connectSpy).toHaveBeenCalledWith(
      'game-1',
      expect.objectContaining({ connectImmediately: false })
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
    scope.stop();
  });

  it('isSettingUp clears only when the connection opened promise resolves, not after a fixed delay', async () => {
    const client = new MeepleClient({
      baseUrl: 'http://localhost:3000',
      playerId: 'player-1',
    });
    // Inject the fake transport by wrapping connect() so every GameConnection
    // constructed by useGame uses FakeWebSocket instead of a real socket.
    const originalConnect = client.connect.bind(client);
    vi.spyOn(client, 'connect').mockImplementation((gameId, options) =>
      originalConnect(gameId, {
        ...options,
        wsImplementation: FakeWebSocket as unknown as typeof WebSocket,
      })
    );

    const playerSeat = ref<number | undefined>(1);
    const scope = effectScope();

    scope.run(() => {
      useGame(client, ref('game-1'), { autoConnect: true, playerSeat });
    });

    // Socket dialed but not yet open.
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Advance well past the deleted 100ms fixed-delay hack, without ever
    // firing onopen. Under the old setTimeout(100) implementation,
    // isSettingUp would incorrectly clear here even though the socket never
    // opened, letting the playerSeat watcher below race ahead.
    await vi.advanceTimersByTimeAsync(150);

    playerSeat.value = 2;
    await vi.advanceTimersByTimeAsync(60); // past the 50ms debounce

    // isSettingUp is still true (opened never resolved) so the playerSeat
    // watcher must have skipped reconnecting — still exactly one socket.
    expect(FakeWebSocket.instances).toHaveLength(1);

    // Now let the socket actually open, resolving `opened`.
    FakeWebSocket.instances[0].open();
    await vi.advanceTimersByTimeAsync(0);

    playerSeat.value = 3;
    await vi.advanceTimersByTimeAsync(60);

    // Now that isSettingUp cleared (driven by `opened`, not a timer), the
    // playerSeat watcher was free to reconnect.
    expect(FakeWebSocket.instances).toHaveLength(2);

    scope.stop();
  });
});
