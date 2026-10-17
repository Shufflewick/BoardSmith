/**
 * THE ONE DOOR A PAGE'S FRAME COMES IN BY, for both dev hosts' sockets
 * (`connection-handler.ts`, `world-connections.ts`).
 *
 * The dev server does not check a socket's origin (#719), so any web page can
 * send it anything. A frame reaches a host's handler only when it parses to an
 * object with a string `type`; anything else is dropped with a warning naming
 * the page, never its payload. And a handler that throws is reported, not left
 * to escape the `ws` listener, where it would end the dev server (#879).
 */
import type { RawData, WebSocket } from 'ws';

/** Text a page chose, as one quoted, escaped line of at most 64 of its characters, for the dev server's log. */
export const quotedForLog = (text: string): string => JSON.stringify(text.slice(0, 64));

/** A frame that parsed to an object with a string `type`. */
type SocketMessage = { type: string; [key: string]: unknown };

function parse(raw: RawData): SocketMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null && typeof (parsed as { type?: unknown }).type === 'string'
    ? (parsed as SocketMessage)
    : null;
}

/**
 * Hand each of `socket`'s frames that is a message to `handle`. `clientId` is
 * who the page said it was, if it has; `report` gets anything `handle` throws.
 */
export function onSocketMessage(
  socket: WebSocket,
  clientId: () => string | null,
  handle: (message: SocketMessage) => void,
  report: (error: unknown, messageType: string) => void,
): void {
  socket.on('message', (raw) => {
    const message = parse(raw);
    if (message === null) {
      const id = clientId();
      const page = id === null ? 'a page that has not said hello' : `page ${quotedForLog(id)}`;
      console.warn(`[boardsmith dev] ignored a frame from ${page} that is not a message with a string type`);
      return;
    }
    try {
      handle(message);
    } catch (error) {
      report(error, message.type);
    }
  });
}
