/**
 * Pure mapping functions for screen-reader live-region announcements.
 *
 * These are dependency-free so they can be unit-tested without mounting Vue.
 * GameShell.vue calls these from watchers (immediate: false) to avoid the
 * "silent first announcement" pitfall (Pitfall 2 in 101-RESEARCH.md).
 */

/**
 * What the shell says to the viewer when they have to act, in a turn-based step
 * or a simultaneous one. The players panel prints it and the live region speaks
 * it, so a screen-reader user hears the words a sighted player reads.
 */
export const YOUR_MOVE = 'Your move';

/**
 * Returns {@link YOUR_MOVE} when isMyTurn becomes true; empty string otherwise.
 * Call from a `watch(isMyTurn, ...)` handler, which fires only when the value
 * changes, so the viewer hears it once per turn and not on every state push.
 */
export function announceTurnChange(newIsMyTurn: boolean): string {
  return newIsMyTurn ? YOUR_MOVE : '';
}

/**
 * Returns the game-over announcement for the assertive live region.
 * winnerNames should be the resolved display names of winning players.
 *
 * isDraw (D10/ENDGAME-01) distinguishes a genuine draw (game complete with
 * explicit zero winners) from winner data that is merely unavailable. A bare empty winnerNames array is ambiguous between the
 * two — callers must pass the explicit signal rather than relying on length.
 */
export function announceGameOver(winnerNames: string[], isDraw = false): string {
  if (winnerNames.length === 0) return isDraw ? 'Game over — Draw' : 'Game over';
  if (winnerNames.length === 1) return `Game over — ${winnerNames[0]} wins`;
  return `Game over — ${winnerNames.join(' and ')} win`;
}

/**
 * The sentence naming every OTHER seat that has to act: "Bob is playing",
 * "Bob and Carol are playing", "Bob, Carol and Dan are playing". Empty when the
 * list is. The players panel prints it and the live region speaks it.
 */
export function describePlaying(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is playing`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are playing`;
}
