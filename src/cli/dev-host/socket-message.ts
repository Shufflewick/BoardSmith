import type { RawData } from 'ws';

/** A frame that parsed to an object with a string `type`. */
type SocketMessage = { type: string; [key: string]: unknown };

/**
 * A page's frame as a message, or null when it is not one. The dev server does
 * not check a socket's origin (#719), so a frame can be anything; both dev
 * hosts drop what this rejects, silently, rather than crash on it (#879).
 */
export function parseSocketMessage(raw: RawData): SocketMessage | null {
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
