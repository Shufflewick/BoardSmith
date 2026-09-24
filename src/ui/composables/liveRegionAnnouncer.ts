/**
 * Pure mapping functions for screen-reader live-region announcements.
 *
 * These are dependency-free so they can be unit-tested without mounting Vue.
 * GameShell.vue calls these from watchers (immediate: false) to avoid the
 * "silent first announcement" pitfall (Pitfall 2 in 101-RESEARCH.md).
 */

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting' | string;

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
 *
 * isDraw (D10/ENDGAME-01) distinguishes a genuine draw (game complete with
 * explicit zero winners) from winner data that is merely unavailable (the
 * dev-WS degrade). A bare empty winnerNames array is ambiguous between the
 * two — callers must pass the explicit signal rather than relying on length.
 */
export function announceGameOver(winnerNames: string[], isDraw = false): string {
  if (winnerNames.length === 0) return isDraw ? 'Game over — Draw' : 'Game over';
  if (winnerNames.length === 1) return `Game over — ${winnerNames[0]} wins`;
  return `Game over — ${winnerNames.join(' and ')} win`;
}

/**
 * ENDGAME-01 / F-13: single source of truth for winner/draw state, derived
 * from the authoritative `flowState.winners`. The GameOverCard and the assertive
 * announcer MUST agree — pre-fix the card's `winnerSeats`/`isDraw` were only
 * populated in the platform-mode `game_state` handler, so a standalone/lobby
 * game announced "Alice wins" while the visible card showed a bare "Game Over"
 * (and a real draw was announced but never displayed).
 *
 * `rawWinners` is a DEFINED array when the game is complete (empty = a genuine
 * draw) and `undefined` only when winner data could not be validated (the
 * dev-WS degrade) — that definedness is what distinguishes a draw from
 * "unavailable", which a bare empty array cannot.
 */
export function deriveWinnerState(
  rawWinners: number[] | undefined,
): { winnerSeats: number[]; isDraw: boolean } {
  return {
    winnerSeats: rawWinners ?? [],
    isDraw: rawWinners !== undefined && rawWinners.length === 0,
  };
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
