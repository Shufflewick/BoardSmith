/**
 * Default player color palette, used when a game doesn't pass `GameOptions.colors`.
 *
 * 16 colors, matching the platform's seat ceiling, so a game can declare any
 * supported player count without hand-supplying a palette. Seats are assigned in
 * order (seat 1 = index 0), and the first eight entries are unchanged from when
 * the palette stopped there — a game that already shipped keeps the colors its
 * players know.
 *
 * **Distinctness.** Measured, not eyeballed: pairwise CIEDE2000 (ΔE00) across all
 * 120 pairs. Normal vision min ΔE00 = 10.8, which is the pre-existing
 * `#f39c12`/`#e67e22` pair from the original eight — every pair involving a newly
 * added color is ≥ 12.4, so extending to 16 does not tighten the palette's
 * floor. Under simulated dichromacy the floors are lower (protanopia 4.7,
 * deuteranopia 3.7, tritanopia 0.0 for red-vs-pink), which is inherent to 16
 * categorical hues rather than to this particular choice — the original eight
 * already measured 8.9 / 6.1 / 2.7. Color is therefore never the sole carrier of
 * player identity: every entry also has a name in {@link DEFAULT_COLOR_LABELS},
 * surfaced as `player.colorLabel`.
 */
export const DEFAULT_COLOR_PALETTE: readonly string[] = [
  '#e74c3c',  // Red
  '#3498db',  // Blue
  '#27ae60',  // Green
  '#f39c12',  // Yellow
  '#9b59b6',  // Purple
  '#1abc9c',  // Teal
  '#e67e22',  // Orange
  '#2c3e50',  // Black (dark navy)
  '#e84393',  // Pink
  '#8bc34a',  // Lime
  '#4834d4',  // Indigo
  '#a0522d',  // Brown
  '#7f8c8d',  // Slate
  '#0e6655',  // Pine (dark teal)
  '#f1948a',  // Salmon
  '#85c1e9',  // Sky
] as const;

/**
 * Human-readable names for the default palette hexes.
 * Lets `player.colorLabel` resolve to a word (e.g. "Red") for player-facing
 * text — logs, narration — even when a game doesn't define a labeled palette.
 * Games with a custom labeled palette pass their own map via `GameOptions.colorLabels`.
 */
export const DEFAULT_COLOR_LABELS: Readonly<Record<string, string>> = {
  '#e74c3c': 'Red',
  '#3498db': 'Blue',
  '#27ae60': 'Green',
  '#f39c12': 'Yellow',
  '#9b59b6': 'Purple',
  '#1abc9c': 'Teal',
  '#e67e22': 'Orange',
  '#2c3e50': 'Black',
  '#e84393': 'Pink',
  '#8bc34a': 'Lime',
  '#4834d4': 'Indigo',
  '#a0522d': 'Brown',
  '#7f8c8d': 'Slate',
  '#0e6655': 'Pine',
  '#f1948a': 'Salmon',
  '#85c1e9': 'Sky',
};

/**
 * The name a seat shows wherever the library names it: its player's name, or
 * `Player <seat>` when it has none. Seats start at 1, and an empty name counts
 * as none (`playerNames: ['', 'Bob']` is allowed).
 */
export function seatDisplayName(seat: number, name?: string | null): string {
  return name || `Player ${seat}`;
}
