/**
 * Where a hex grid's cells keep their coordinates. Its own module, free of the
 * element classes, so the engine and the UI read one default (#1294).
 */

/** The attributes a hex grid's cells hold their coordinates in: its $qCoord and $rCoord, else q and r. */
export function hexCoordinateNames(grid: { $qCoord?: unknown; $rCoord?: unknown }): [string, string] {
  return [(grid.$qCoord as string | undefined) ?? 'q', (grid.$rCoord as string | undefined) ?? 'r'];
}
