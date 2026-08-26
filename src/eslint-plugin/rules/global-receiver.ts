/**
 * Deciding whether a member call really reaches a global.
 *
 * The sandbox rules (`no-network`, `no-timers`) have to catch
 * `window.fetch()` and `globalThis.setTimeout()` without catching a game's own
 * `deck.fetch()` or `scheduler.setTimeout()` (#38). Matching on the property
 * name alone banned every method that happened to share a name with a global,
 * so a card game with a `fetch` domain method could not lint clean except by
 * renaming its API around the linter.
 */

/** Identifiers that really do name the global object. */
const GLOBAL_RECEIVERS: ReadonlySet<string> = new Set(['window', 'globalThis', 'self', 'global']);

/**
 * True when a `MemberExpression` callee is reached through the global object,
 * e.g. `window.fetch` — and false for `deck.fetch` or `this.deck.fetch`.
 */
export function isGlobalMemberCall(callee: { object?: unknown }): boolean {
  const object = callee.object as { type?: string; name?: string } | undefined;
  return object?.type === 'Identifier' && GLOBAL_RECEIVERS.has(object.name ?? '');
}
