/**
 * Shared WebSocket-constructor resolution for Node-capable client SDKs.
 *
 * Both GameConnection (production `/games/:gameId` protocol) and the dev-host
 * client (127-03) need to run in a Node process without a browser `WebSocket`
 * global, while still working unmodified in browsers. This resolves an
 * injected override first, falling back to the runtime global, and fails
 * loud with an actionable message when neither is available.
 */

/**
 * Resolve the WebSocket constructor to use for a connection.
 *
 * @param wsImplementation - Optional override for runtimes without a global
 *   `WebSocket` (e.g. Node <22.4).
 * @throws {Error} If neither `wsImplementation` nor `globalThis.WebSocket`
 *   is available. The message names both the Node >=22.4 requirement and
 *   the `wsImplementation` escape hatch.
 */
export function resolveWsCtor(wsImplementation: typeof WebSocket | undefined, callerName: string): typeof WebSocket {
  const wsCtor = wsImplementation ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!wsCtor) {
    throw new Error(
      `${callerName} requires a WebSocket implementation. Node <22.4 has no global WebSocket — ` +
        'upgrade to Node >=22.4 or pass `wsImplementation` in the connection config.'
    );
  }
  return wsCtor;
}
