import type { WebSocket } from 'ws';
import type { MultiplayerHost } from './multiplayer-host.js';

/**
 * Per-connection WebSocket handler for the dev host.
 *
 * Reads `clientId` from the `hello` message body (NOT assigned per-connection),
 * so a page reload's NEW socket can present the same persisted clientId
 * (localStorage, DevHost.vue) — a reconnect, not a new client. Routes every
 * message to the MultiplayerHost, and on `close` tears down session state ONLY
 * if this socket is still the registered connection for its clientId.
 *
 * The close guard is the DEF-C fix: a page reload opens a new socket whose
 * `hello` can be processed BEFORE the older socket's `close` fires (Node gives
 * no ordering guarantee). Without the `clients.get(clientId) === socket` check,
 * that stale close marks the just-reconnected client disconnected and silently
 * orphans every future broadcast/response to its seat.
 *
 * Exported and shared by the real dev server (`dev.ts`) and the DEF-C
 * regression test so the guard has exactly ONE implementation — the test
 * exercises the literal code the server runs, with no hand-mirrored copy to
 * drift out of sync.
 */
export function createDevHostConnectionHandler(opts: {
  mpHost: Pick<MultiplayerHost, 'handleMessage' | 'disconnect'>;
  clients: Map<string, WebSocket>;
  /** Called when an async message dispatch rejects; receives the failing message type. */
  onError: (err: unknown, msgType: string) => void;
}): (socket: WebSocket) => void {
  const { mpHost, clients, onError } = opts;

  const dispatch = (clientId: string, msg: Parameters<typeof mpHost.handleMessage>[1]) => {
    Promise.resolve(mpHost.handleMessage(clientId, msg)).catch((err) =>
      onError(err, (msg as { type?: string }).type ?? 'unknown'),
    );
  };

  return (socket: WebSocket) => {
    let clientId: string | null = null;

    socket.on('message', (raw) => {
      let msg: { type?: string; clientId?: unknown; [key: string]: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        clientId =
          typeof msg.clientId === 'string' ? msg.clientId : `anon-${Math.random().toString(36).slice(2)}`;
        clients.set(clientId, socket);
        dispatch(clientId, { type: 'hello' });
        return;
      }
      if (!clientId) return; // a client must identify itself via `hello` first
      dispatch(clientId, msg as Parameters<typeof mpHost.handleMessage>[1]);
    });

    socket.on('close', () => {
      // Only tear down if THIS socket still owns the clientId mapping. A stale
      // close from a superseded (reloaded) socket must not disconnect the
      // reconnected client — that would orphan every future broadcast/response
      // to its seat (DEF-C).
      if (clientId && clients.get(clientId) === socket) {
        clients.delete(clientId);
        mpHost.disconnect(clientId);
      }
    });
  };
}
