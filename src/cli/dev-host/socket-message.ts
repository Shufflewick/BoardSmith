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

/** Longest page-chosen text a log line shows; a message type is a word or two. */
const PAGE_TEXT_MAX = 200;

/**
 * Text a page chose or can influence, fit for the developer's terminal: every
 * C0, DEL and C1 character and every bidi override and isolate (#1132) shown as
 * a `\uXXXX` escape (the 8-bit CSI U+009B included, which `JSON.stringify`
 * passes through), and anything past `PAGE_TEXT_MAX` characters cut with a
 * note saying how much (#1089).
 */
export function pageText(text: string): string {
  const shown = text
    .slice(0, PAGE_TEXT_MAX)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const cut = text.length - PAGE_TEXT_MAX;
  return cut > 0 ? `${shown}... (${cut} more characters)` : shown;
}
