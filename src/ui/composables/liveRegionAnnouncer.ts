/**
 * Pure mapping functions for screen-reader live-region announcements.
 *
 * These are dependency-free so they can be unit-tested without mounting Vue.
 * GameShell.vue calls these from watchers (immediate: false) to avoid the
 * "silent first announcement" pitfall (Pitfall 2 in 101-RESEARCH.md).
 */

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | string;

/**
 * Returns "Your turn" when isMyTurn becomes true; empty string otherwise.
 * Call from a `watch(isMyTurn, ...)` handler.
 */
export function announceTurnChange(newIsMyTurn: boolean): string {
  return newIsMyTurn ? 'Your turn' : '';
}

/**
 * Returns the appropriate reconnection message when connectionStatus changes.
 * Returns empty string when the transition does not warrant an announcement.
 */
export function announceConnectionChange(
  newStatus: ConnectionStatus,
  oldStatus: ConnectionStatus,
): string {
  if (newStatus === oldStatus) return '';
  if (newStatus === 'disconnected' || newStatus === 'reconnecting') return 'Reconnecting…';
  if (newStatus === 'connected') return 'Reconnected';
  return '';
}

/**
 * Returns the game-over announcement for the assertive live region.
 * winnerNames should be the resolved display names of winning players.
 */
export function announceGameOver(winnerNames: string[]): string {
  if (winnerNames.length === 0) return 'Game over';
  if (winnerNames.length === 1) return `Game over — ${winnerNames[0]} wins`;
  return `Game over — ${winnerNames.join(' and ')} win`;
}

/**
 * Returns the polite announcement when it becomes an opponent's turn.
 * awaitingNames are the display names of players waiting to act.
 */
export function announceOpponentTurn(awaitingNames: string[]): string {
  if (awaitingNames.length === 0) return '';
  return `${awaitingNames[0]} is playing…`;
}
