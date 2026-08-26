/**
 * Node-capable protocol client for `boardsmith dev`'s multiplayer WebSocket
 * host (DRIVE-02). This is a SEPARATE sibling of `GameConnection` — it speaks
 * the dev host's own wire protocol (`hello`/`join`/`server_request`/`getState`/
 * `getLobby`/`debugToggle`/`uiSwitch`, see `multiplayer-host.ts`), which is
 * NOT compatible with `GameConnection`'s production `/games/:gameId` protocol.
 * Do not extend or fold this into `GameConnection`.
 *
 * Lets a scripted agent drive `boardsmith dev` end-to-end from Node without a
 * browser: connect, take a seat, read state, perform actions, and exercise
 * dev-only affordances (debug panel toggle, UI switcher) — the acceptance
 * proof for the whole "scriptable dev host" phase.
 */

import { resolveWsCtor } from './ws-ctor.js';

/**
 * Default timeout for requestId-correlated requests. A named constant (rather
 * than a bare `10000` literal) so this file's intent reads independently from
 * `game-connection.ts`'s unrelated 10s action/pong timeouts — three separate
 * design choices that happen to share a number, not one shared value.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** One seat's lobby info, mirroring `multiplayer-host.ts`'s `SeatInfo`. */
export interface DevHostSeatInfo {
  seat: number;
  clientId: string | null;
  name: string;
  color?: string;
  connected: boolean;
}

/** Reply shape for `getLobby()` — same fields as the `lobby` broadcast, minus wire framing. */
export interface DevHostLobbyReply {
  phase: 'lobby' | 'playing';
  seats: DevHostSeatInfo[];
  minPlayers: number;
  playerCount: number;
}

/** Reply shape for `getState()` — the caller's own seat view, same as a `game_state` broadcast. */
export interface DevHostStateReply {
  view: unknown;
  isComplete: boolean;
  winners: number[];
}

/** Any message the dev host sends, as delivered to `onMessage` subscribers. */
export interface DevHostInboundMessage {
  type: string;
  requestId?: string | null;
  [key: string]: unknown;
}

export interface DevHostClientOptions {
  /** Override for runtimes without a global `WebSocket` (Node <22.4). */
  wsImplementation?: typeof WebSocket;
  /** Timeout (ms) for requestId-correlated requests before rejecting. Default 10000. */
  requestTimeoutMs?: number;
}

export interface DevHostClient {
  /** Resolves once the underlying socket has opened. Await before sending anything. */
  readonly opened: Promise<void>;
  /** Identify this connection to the host — the FIRST client to do so auto-seats and starts the game. */
  hello(): void;
  /** Take over an open/bot seat (works mid-game). */
  join(seat: number, opts?: { name?: string; color?: string }): void;
  /** Give up the currently held seat — it reverts to bot. */
  leave(): void;
  /** Restart the game with the same seats and a fresh seed. */
  restart(): void;
  /** Toggle "follow active seat" mode. */
  follow(enabled: boolean): void;
  /** Fetch this connection's own seat view (DRIVE-01). Rejects on host-reported error or timeout. */
  getState(): Promise<DevHostStateReply>;
  /** Fetch the lobby payload, in any phase (DRIVE-01). Rejects on host-reported error or timeout. */
  getLobby(): Promise<DevHostLobbyReply>;
  /**
   * Perform a server op (e.g. `action`) and resolve with its result payload.
   *
   * A SUBMISSION op (`action`, `selection_step`) must carry
   * `payload.boundaryKey` — the identity of the flow position it was composed
   * against, read off the last `game_state` this client received
   * (`flowBoundaryKey(view.flowState)`). It is not defaulted for you: an
   * absent key names no round, and the host refuses it with "The round you
   * acted in has closed; reload to see the current round." Nothing is stamped
   * on a caller's behalf here precisely because this client can be driven
   * hours after it read its state. See
   * `docs/simultaneous-and-interrupt-semantics.md`.
   */
  serverRequest(op: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Relay-only: fan out a debug-panel toggle to every connected client (DRIVE-03). */
  debugToggle(): void;
  /** Relay-only: fan out a UI-switch request to every connected client (DRIVE-03). */
  uiSwitch(name: string): void;
  /** Subscribe to every inbound message (including non-correlated broadcasts). Returns an unsubscribe function. */
  onMessage(handler: (msg: DevHostInboundMessage) => void): () => void;
  /** Close the underlying socket. */
  close(): void;
}

interface PendingRequest {
  resolve: (msg: DevHostInboundMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Connect a scripted Node (or browser) client to a `boardsmith dev` host.
 *
 * @param url - The dev host's WebSocket URL (e.g. `ws://localhost:5173/__boardsmith/ws`).
 */
export function createDevHostClient(url: string, opts: DevHostClientOptions = {}): DevHostClient {
  const wsCtor = resolveWsCtor(opts.wsImplementation, 'createDevHostClient');
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const socket = new wsCtor(url);

  let requestIdCounter = 0;
  const pending = new Map<string, PendingRequest>();
  const listeners = new Set<(msg: DevHostInboundMessage) => void>();

  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener(
      'error',
      () => {
        if (socket.readyState !== wsCtor.OPEN) {
          reject(new Error(`createDevHostClient: WebSocket connection to '${url}' failed before opening.`));
        }
      },
      { once: true },
    );
    socket.addEventListener(
      'close',
      () => {
        reject(new Error(`createDevHostClient: connection to '${url}' closed before opening.`));
      },
      { once: true },
    );
  });
  // Prevent an unhandled-rejection crash for callers who rely on send()'s
  // synchronous not-open guard instead of awaiting/catching `opened` directly
  // (Node marks a promise "handled" once ANY handler is attached, regardless
  // of how many — external callers can still await/catch the same promise).
  opened.catch(() => {});

  socket.addEventListener(
    'close',
    () => {
      const closeErr = new Error(`createDevHostClient: connection to '${url}' closed.`);
      for (const entry of pending.values()) {
        clearTimeout(entry.timeout);
        entry.reject(closeErr);
      }
      pending.clear();
    },
    { once: true },
  );

  socket.addEventListener('message', (event: MessageEvent) => {
    let msg: DevHostInboundMessage;
    try {
      msg = JSON.parse(String(event.data));
    } catch (error) {
      // #43: dropping this in silence hid the bug in the tool built to surface
      // bugs. A pending request tied to the frame then died as a generic
      // timeout pointing nowhere near the cause. The frame IS the bug report,
      // so say so before dropping it.
      const raw = String(event.data);
      console.error(
        `createDevHostClient: dropping a malformed dev-host frame — it is not valid JSON. ` +
        `A request waiting on it will now time out instead.\n` +
        `  Frame (${raw.length} chars): ${raw.length > 500 ? `${raw.slice(0, 500)}…` : raw}\n` +
        `  Parse error: ${error instanceof Error ? error.message : String(error)}`
      );
      return;
    }
    for (const listener of listeners) listener(msg);

    const requestId = msg.requestId;
    if (typeof requestId !== 'string' || !pending.has(requestId)) return;
    const entry = pending.get(requestId)!;
    pending.delete(requestId);
    clearTimeout(entry.timeout);
    if (msg.type === 'error') {
      entry.reject(new Error(`createDevHostClient: dev host reported an error: ${String(msg.message)}`));
      return;
    }
    entry.resolve(msg);
  });

  function send(message: Record<string, unknown>): void {
    if (socket.readyState !== wsCtor.OPEN) {
      throw new Error(
        `createDevHostClient: cannot send '${String(message.type)}' — socket is not open ` +
          `(readyState=${socket.readyState}). Await \`client.opened\` before sending.`,
      );
    }
    socket.send(JSON.stringify(message));
  }

  function requestWithId(message: Record<string, unknown>, requestId: string): Promise<DevHostInboundMessage> {
    return new Promise<DevHostInboundMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(
          new Error(
            `createDevHostClient: '${String(message.type)}' (requestId=${requestId}) timed out after ` +
              `${requestTimeoutMs}ms waiting for a dev host response.`,
          ),
        );
      }, requestTimeoutMs);
      pending.set(requestId, { resolve, reject, timeout });
      try {
        send(message);
      } catch (err) {
        clearTimeout(timeout);
        pending.delete(requestId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function nextRequestId(prefix: string): string {
    return `${prefix}-${++requestIdCounter}-${Date.now()}`;
  }

  /**
   * Minimal runtime shape guard (WR-01): a correlated reply that isn't
   * `'error'` (already rejected before this is reached, see the message
   * listener) must still be the EXPECTED reply type before its fields are
   * trusted — a malformed or version-skewed host response should fail loud
   * with an actionable message, not silently produce garbage typed as valid.
   */
  function expectType(msg: DevHostInboundMessage, expected: string): void {
    if (msg.type !== expected) {
      throw new Error(
        `createDevHostClient: expected a '${expected}' reply but received '${String(msg.type)}'.`,
      );
    }
  }

  return {
    opened,
    hello() {
      send({ type: 'hello' });
    },
    join(seat, joinOpts = {}) {
      send({ type: 'join', seat, name: joinOpts.name, color: joinOpts.color });
    },
    leave() {
      send({ type: 'leave' });
    },
    restart() {
      send({ type: 'restart' });
    },
    follow(enabled) {
      send({ type: 'follow', enabled });
    },
    async getState() {
      const requestId = nextRequestId('getState');
      const msg = await requestWithId({ type: 'getState', requestId }, requestId);
      expectType(msg, 'game_state');
      return { view: msg.view, isComplete: msg.isComplete as boolean, winners: msg.winners as number[] };
    },
    async getLobby() {
      const requestId = nextRequestId('getLobby');
      const msg = await requestWithId({ type: 'getLobby', requestId }, requestId);
      expectType(msg, 'lobby');
      return {
        phase: msg.phase as 'lobby' | 'playing',
        seats: msg.seats as DevHostSeatInfo[],
        minPlayers: msg.minPlayers as number,
        playerCount: msg.playerCount as number,
      };
    },
    async serverRequest(op, payload) {
      const requestId = nextRequestId('req');
      const msg = await requestWithId({ type: 'server_request', requestId, op, payload }, requestId);
      expectType(msg, 'server_response');
      return msg.result as Record<string, unknown>;
    },
    debugToggle() {
      send({ type: 'debugToggle' });
    },
    uiSwitch(name) {
      send({ type: 'uiSwitch', name });
    },
    onMessage(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    close() {
      socket.close();
    },
  };
}
