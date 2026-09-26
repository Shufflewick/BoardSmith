import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { claimWebSocketPath } from '../commands/dev-server.js';
import type { ClientInbound, HostOutbound, MultiplayerHost } from './multiplayer-host.js';
import type { RulesReloadQueue } from './rules-reload-queue.js';
import { DEV_HOST_WS_PATH } from './socket-path.js';

/**
 * The messages that run the table's rules, and so are refused rather than run
 * when a saved edit they were held for does not load (#379). Everything else a
 * page sends (hello, the lobby, seats, the debug relay) still runs, on the
 * rules the table kept.
 */
const RUNS_THE_RULES: ReadonlySet<ClientInbound['type']> = new Set([
  'server_request',
  'restart',
  'configure',
  'fireDeadline',
]);

interface DevHostConnectionOptions {
  mpHost: Pick<MultiplayerHost, 'handleMessage' | 'disconnect'>;
  clients: Map<string, WebSocket>;
  queue: Pick<RulesReloadQueue, 'admit'>;
  /** Called when an async message dispatch rejects; receives the failing message type. */
  onError: (err: unknown, msgType: string) => void;
}

/**
 * The table socket exactly as `boardsmith dev` serves it: `DEV_HOST_WS_PATH`
 * claimed on the host's HTTP server, every connection handled by
 * `createDevHostConnectionHandler`. `dev.ts` calls this, and so does
 * `dev-host.integration.test.ts`, so the test speaks to the server the product
 * runs, path included (#422).
 */
export function claimDevHostSocket(opts: DevHostConnectionOptions): ReturnType<typeof claimWebSocketPath> {
  return claimWebSocketPath(DEV_HOST_WS_PATH, createDevHostConnectionHandler(opts));
}

/**
 * Per-connection WebSocket handler for the dev host.
 *
 * Reads `clientId` from the `hello` message body (NOT assigned per-connection),
 * so a page reload's NEW socket can present the same persisted clientId
 * (localStorage, DevHost.vue) — a reconnect, not a new client. Routes every
 * message to the MultiplayerHost, and on `close` tears down session state ONLY
 * if this socket is still the registered connection for its clientId.
 *
 * Nothing a socket sends before `hello` is answered or held: it is dropped, as
 * the platform serves nothing to a socket it has not identified (#422).
 * `createDevHostClient` refuses such a request itself, so a scripted caller is
 * told to say hello rather than left waiting out a timeout.
 *
 * The close guard is the DEF-C fix: a page reload opens a new socket whose
 * `hello` can be processed BEFORE the older socket's `close` fires (Node gives
 * no ordering guarantee). Without the `clients.get(clientId) === socket` check,
 * that stale close marks the just-reconnected client disconnected and silently
 * orphans every future broadcast/response to its seat.
 *
 * Each handler is one run of the dev server, with its own id (#416). A page's
 * `hello` is answered `welcome` with that id, and a page names it again when
 * its socket reconnects. A `hello` naming a different run comes from a tab
 * left open across a server restart: it is answered `stale_run` and the socket
 * is never identified, so it claims no seat, receives nothing further and
 * cannot take over the routing of a page that shares its client id. A fresh
 * page load names no run and joins as the first arrival or a reconnect would.
 *
 * Every message is admitted through the rules reload queue (#379), so one that
 * arrives while a saved rules edit is still rebuilding waits for the new rules.
 * So is a page's departure (#387): a bot covering its seat is a move, and it
 * waits for the new rules too.
 *
 * The real dev server reaches it through `claimDevHostSocket`, and the tests
 * run the same handler, so the guard has exactly ONE implementation — the
 * tests exercise the literal code the server runs, with no hand-mirrored copy
 * to drift out of sync.
 */
export function createDevHostConnectionHandler(opts: DevHostConnectionOptions): (socket: WebSocket) => void {
  const { mpHost, clients, queue, onError } = opts;
  const runId = randomUUID();

  return (socket: WebSocket) => {
    const send = (message: HostOutbound) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const dispatch = (clientId: string, msg: ClientInbound) => {
      const refusal = (message: string): HostOutbound => ({
        type: 'error',
        message,
        requestId: 'requestId' in msg ? (msg.requestId ?? null) : null,
      });
      queue
        .admit({
          run: () => mpHost.handleMessage(clientId, msg),
          ...(RUNS_THE_RULES.has(msg.type) ? { refuse: (message: string) => send(refusal(message)) } : {}),
        })
        .catch((err: unknown) => onError(err, msg.type));
    };

    let clientId: string | null = null;

    socket.on('message', (raw) => {
      let msg: { type?: string; clientId?: unknown; [key: string]: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        if (msg.runId !== undefined && msg.runId !== runId) {
          send({ type: 'stale_run' });
          return;
        }
        send({ type: 'welcome', runId });
        clientId =
          typeof msg.clientId === 'string' ? msg.clientId : `anon-${Math.random().toString(36).slice(2)}`;
        clients.set(clientId, socket);
        dispatch(clientId, { type: 'hello' });
        return;
      }
      // A client must identify itself via `hello` first; a tab from an earlier
      // run never does (#416).
      if (!clientId) return;
      dispatch(clientId, msg as ClientInbound);
    });

    socket.on('close', () => {
      // Only tear down if THIS socket still owns the clientId mapping. A stale
      // close from a superseded (reloaded) socket must not disconnect the
      // reconnected client — that would orphan every future broadcast/response
      // to its seat (DEF-C).
      if (clientId && clients.get(clientId) === socket) {
        const gone = clientId;
        clients.delete(gone);
        queue.admit({ run: async () => mpHost.disconnect(gone) }).catch((err: unknown) => onError(err, 'disconnect'));
      }
    });
  };
}
