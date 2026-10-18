/**
 * THE WORLD DEV HOST'S SOCKETS: which are open, and who each one says it is.
 *
 * `boardsmith dev`'s world run owns the only real ones, and it used to keep
 * this bookkeeping inline where no test could reach it. It is a module of its
 * own for the reason `connection-handler.ts` is one for the table host: the
 * regression test for #284 drives the literal code the server runs, over real
 * sockets, with no hand-mirrored copy to drift.
 *
 * ONE SOURCE OF TRUTH FOR "IS THIS PAGE STILL HERE". The world runs in its
 * rules' worker (#885) and answers `isOpen` from the pages this tells it are
 * open, the same map `sendFrame` sends through, so the world can never believe
 * in a page its frames are no longer reaching, or skip one they still reach.
 *
 * A REQUEST ID BELONGS TO ONE PAGE LOAD (#1099), as on the table host (#1041).
 * A reloaded page keeps its client id and numbers its requests from 0 again,
 * so each request reaches the host under an id of this module's own, and its
 * answer goes back under the page's id only while the load that asked still
 * holds the client's socket.
 */
import { randomUUID } from 'node:crypto';

import { styleText } from 'node:util';
import { WebSocket } from 'ws';

import type { RulesReloadQueue } from './rules-reload-queue.js';
import { pageText, parseSocketMessage } from './socket-message.js';
import { toWireJson } from './wire-json.js';
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
  /**
   * One frame, already encoded as JSON, to one page; dropped when that page's
   * socket is not open. An answer names the request id the host was given, and
   * goes only to the page load that asked (#1099).
   */
  sendFrame(clientId: string, frame: string, hostRequestId?: string): void;
  /** One frame to every open page. */
  broadcast(message: unknown): void;
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
  host: () => Pick<LocalWorldHost, 'handleMessage' | 'disconnect'>,
  queue: Pick<RulesReloadQueue, 'admit'>,
  /**
   * Told which pages are open whenever that changes, before anything the change
   * sends the host: the world, in its rules' worker, answers `isOpen` from it
   * (#284, #885).
   */
  pagesChanged: (open: readonly string[]) => void,
): WorldConnections {
  const clients = new Map<string, WebSocket>();
  const changed = (): void => pagesChanged([...clients.keys()]);
  /** The page load each client's socket now belongs to. */
  const pageLoad = new Map<string, string>();
  /** Each request the host has not answered yet, by the id the host was given. */
  const requestOrigin = new Map<string, { clientId: string; loadId: string; requestId: string }>();
  let nextRequest = 0;

  const openSocket = (clientId: string): WebSocket | undefined => {
    const socket = clients.get(clientId);
    return socket !== undefined && socket.readyState === WebSocket.OPEN ? socket : undefined;
  };

  return {
    sendFrame(clientId, frame, hostRequestId) {
      if (hostRequestId === undefined) {
        openSocket(clientId)?.send(frame);
        return;
      }
      const origin = requestOrigin.get(hostRequestId);
      requestOrigin.delete(hostRequestId);
      if (origin === undefined || pageLoad.get(origin.clientId) !== origin.loadId) return;
      openSocket(origin.clientId)?.send(toWireJson({ ...(JSON.parse(frame) as object), requestId: origin.requestId }));
    },

    broadcast(message) {
      for (const clientId of clients.keys()) openSocket(clientId)?.send(toWireJson(message));
    },

    accept(socket) {
      let clientId: string | null = null;
      let loadId: string | null = null;
      // Only if this socket still owns the id: a reload's new socket may be helloed before the old one's close fires.
      const release = (): void => {
        if (clientId !== null && clients.get(clientId) === socket) {
          const gone = clientId;
          clients.delete(gone);
          pageLoad.delete(gone);
          for (const [id, origin] of requestOrigin) if (origin.clientId === gone) requestOrigin.delete(id);
          changed();
          // A departure waits for a pending reload like the page's messages
          // did (#387): it can start a departure's clock command.
          queue
            .admit({ run: () => host().disconnect(gone) })
            .catch((error: unknown) => console.error(styleText('red', `[boardsmith dev] a page leaving the world failed: ${pageText(error instanceof Error ? error.message : String(error))}`)));
        }
      };
      const identify = (hello: Record<string, unknown>): void => {
        const next = typeof hello.clientId === 'string' ? hello.clientId : `anon-${Math.random().toString(36).slice(2)}`;
        // A socket that changes identity leaves as its old client (#1178).
        if (next !== clientId) release();
        clientId = next;
        // A caller that names no page load (a scripted client) is one per socket.
        loadId = typeof hello.loadId === 'string' ? hello.loadId : randomUUID();
        clients.set(clientId, socket);
        pageLoad.set(clientId, loadId);
        changed();
      };
      socket.on('message', (raw) => {
        const message = parseSocketMessage(raw);
        if (message === null) return;
        if (message.type === 'hello') identify(message);
        if (clientId === null || loadId === null) return; // a client identifies itself first
        const from = clientId;
        const asked = message as unknown as WorldDevRequest;
        const refusal = refusalOf(asked);
        let request = asked;
        let hostRequestId: string | null = null;
        if ('requestId' in asked) {
          hostRequestId = String(nextRequest++);
          requestOrigin.set(hostRequestId, { clientId: from, loadId, requestId: asked.requestId });
          request = { ...asked, requestId: hostRequestId };
        }
        const refuse =
          refusal === null
            ? undefined
            : (text: string) => {
                if (hostRequestId !== null) requestOrigin.delete(hostRequestId);
                if (socket.readyState === WebSocket.OPEN) socket.send(toWireJson(refusal(text)));
              };
        void queue
          .admit({ run: () => host().handleMessage(from, request), ...(refuse === undefined ? {} : { refuse }) })
          .catch((error: unknown) => {
            // The message, not the error object, exactly as `reloadWorld` in
            // `dev-world.ts` does it (#240).
            const reason = error instanceof Error ? error.message : String(error);
            // A page still waiting is told why, as the table road tells it (#1060): its rules' worker may have stopped.
            if (hostRequestId === null || requestOrigin.has(hostRequestId)) refuse?.(reason);
            if (hostRequestId !== null) requestOrigin.delete(hostRequestId);
            console.error(styleText('red', `[boardsmith dev] world message '${pageText(message.type)}' failed: ${pageText(reason)}`));
          });
      });
      socket.on('close', release);
    },

    forgetAll(farewell) {
      for (const [clientId, socket] of clients) {
        if (farewell !== undefined && socket.readyState === WebSocket.OPEN) {
          socket.send(toWireJson(farewell));
        }
        clients.delete(clientId);
        pageLoad.delete(clientId);
      }
      requestOrigin.clear();
      changed();
    },
  };
}
