/**
 * THE WORLD DEV HOST'S SOCKETS: which are open, and who each one says it is.
 *
 * `boardsmith dev`'s world run owns the only real ones, and it used to keep
 * this bookkeeping inline where no test could reach it. It is a module of its
 * own for the reason `connection-handler.ts` is one for the table host: the
 * regression test for #284 drives the literal code the server runs, over real
 * sockets, with no hand-mirrored copy to drift.
 *
 * ONE SOURCE OF TRUTH FOR "IS THIS PAGE STILL HERE". `send` and `isOpen` read
 * the same map and the same `readyState`, so the host can never believe in a
 * page its own frames are no longer reaching, or skip one they still reach.
 */
import chalk from 'chalk';
import { WebSocket } from 'ws';

import type { RulesReloadQueue } from './rules-reload-queue.js';
import type { LocalWorldHost, WorldDevRequest } from './world-host.js';

/**
 * How a page is answered when a message that runs the world's rules was held
 * for a saved edit that did not load (#379), in the frame that message is
 * answered in. Null for a message that still runs then (hello, attach), on the
 * rules the world kept.
 */
function refusalOf(message: WorldDevRequest): ((text: string) => Record<string, unknown>) | null {
  switch (message.type) {
    case 'action':
      return (text) => ({ type: 'world_response', requestId: message.requestId, ok: false, message: text });
    case 'pick':
      return (text) => ({ type: 'world_pick_result', requestId: message.requestId, ok: false, message: text });
    case 'quote':
      return (text) => ({ type: 'world_quote_result', requestId: message.requestId, ok: false, message: text });
    case 'fire_due':
    case 'wake':
      return (text) => ({ type: 'world_notice', message: text });
    default:
      return null;
  }
}

interface WorldConnections {
  /** One frame to one page, dropped when that page's socket is not open. */
  send(clientId: string, message: unknown): void;
  /** One frame to every open page. */
  broadcast(message: unknown): void;
  /** Whether this page's socket is open right now -- the host's `isOpen`. */
  isOpen(clientId: string): boolean;
  /** Take one newly upgraded socket: its messages go to the current host, and
   *  its close is that page's departure. */
  accept(socket: WebSocket): void;
  /**
   * Forget every page, telling each open one `farewell` first when given.
   *
   * A rules reload (#201) says `world_reload`, because every page's UI has just
   * been hot-reloaded onto a world rebuilt beneath it; a shutdown says nothing.
   */
  forgetAll(farewell?: unknown): void;
}

/**
 * The bookkeeping for one world run.
 *
 * `host` is asked for on every message rather than captured once, because a
 * rule edit replaces the whole world host (#201) while the pages stay put.
 * Every message is admitted through `queue`, so one sent while a saved rules
 * edit is still building waits for the world to run it (#379), and so is a
 * page's departure (#387).
 */
export function createWorldConnections(
  host: () => LocalWorldHost,
  queue: Pick<RulesReloadQueue, 'admit'>,
): WorldConnections {
  const clients = new Map<string, WebSocket>();

  const openSocket = (clientId: string): WebSocket | undefined => {
    const socket = clients.get(clientId);
    return socket !== undefined && socket.readyState === WebSocket.OPEN ? socket : undefined;
  };

  return {
    send(clientId, message) {
      openSocket(clientId)?.send(JSON.stringify(message));
    },

    broadcast(message) {
      for (const clientId of clients.keys()) openSocket(clientId)?.send(JSON.stringify(message));
    },

    isOpen(clientId) {
      return openSocket(clientId) !== undefined;
    },

    accept(socket) {
      let clientId: string | null = null;
      socket.on('message', (raw) => {
        let message: { type?: string; clientId?: unknown; [key: string]: unknown };
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (message.type === 'hello') {
          clientId =
            typeof message.clientId === 'string'
              ? message.clientId
              : `anon-${Math.random().toString(36).slice(2)}`;
          clients.set(clientId, socket);
        }
        if (clientId === null) return; // a client identifies itself first
        const from = clientId;
        const request = message as unknown as WorldDevRequest;
        const refusal = refusalOf(request);
        void queue
          .admit({
            run: () => host().handleMessage(from, request),
            ...(refusal === null
              ? {}
              : {
                  refuse: (text: string) => {
                    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(refusal(text)));
                  },
                }),
          })
          .catch((error: unknown) =>
            // The message, not the error object, exactly as `reloadWorld` in
            // `dev-world.ts` does it (#240).
            console.error(
              chalk.red(
                `[boardsmith dev] world message '${String(message.type)}' failed: ` +
                  `${error instanceof Error ? error.message : String(error)}`,
              ),
            ),
          );
      });
      socket.on('close', () => {
        // Only tear down if THIS socket still owns the id: a reload's new socket
        // may be helloed before the old one's close fires, and a stale close
        // would drop the seat the reconnected page just took.
        if (clientId !== null && clients.get(clientId) === socket) {
          const gone = clientId;
          clients.delete(gone);
          // A departure waits for a pending reload like the page's messages
          // did (#387): it can start a departure's clock command.
          queue
            .admit({ run: () => host().disconnect(gone) })
            .catch((error: unknown) => console.error(chalk.red(`[boardsmith dev] a page leaving the world failed: ${error instanceof Error ? error.message : String(error)}`)));
        }
      });
    },

    forgetAll(farewell) {
      for (const [clientId, socket] of clients) {
        if (farewell !== undefined && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(farewell));
        }
        clients.delete(clientId);
      }
    },
  };
}
