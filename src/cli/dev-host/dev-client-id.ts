/**
 * WHO THIS BROWSER IS, ACROSS RELOADS.
 *
 * Both dev chromes need it and for the same reason: a reload opens a NEW
 * socket, and without a stable id the host would treat the reconnecting page as
 * a stranger and the seat it was holding would be lost. It is persisted rather
 * than minted per connection, so a refresh is a reconnect.
 *
 * The two hosts keep SEPARATE keys. A table seat and a world seat are different
 * kinds of thing -- a table's is a chair in one sitting, a world's is where a
 * player's holdings are forever -- and one browser is routinely used for both.
 * Sharing a key would make opening a world reassign the identity a table game
 * running in another tab was still using.
 */

/** The table dev host's key. */
export const TABLE_CLIENT_KEY = 'boardsmith:dev-client-id';

/** The world dev host's key. */
export const WORLD_CLIENT_KEY = 'boardsmith:world-dev-client-id';

/**
 * This browser's id for `key`, minted and stored on first use.
 *
 * `prefix` distinguishes the two hosts in a log without anyone having to look
 * the key up.
 */
export function loadDevClientId(key: string, prefix: string): string {
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const minted = `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  localStorage.setItem(key, minted);
  return minted;
}
