import { seatDisplayName } from '../engine/element/seat-defaults.js';

/** How every UI surface shows a seat: the library's one seat name, and its player's colour. */
export function seatDisplay(
  players: ReadonlyArray<{ seat: number; name?: unknown; color?: unknown }>,
  seat: number,
): { seat: number; name: string; color?: string } {
  const player = players.find((p) => p.seat === seat);
  return {
    seat,
    name: seatDisplayName(seat, typeof player?.name === 'string' ? player.name : undefined),
    color: typeof player?.color === 'string' ? player.color : undefined,
  };
}
