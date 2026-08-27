/**
 * The words for a die's current face.
 *
 * `Die3D` draws its faces in WebGL, so the value a player reads off the screen
 * exists only as pixels on a canvas - nothing in the page says it (issue 82).
 * This is the one place that turns a die's state into text, so the die itself,
 * the zoom preview, and any control wrapping a die all say the same thing.
 */

/**
 * Name a die and the face it is showing, e.g. `'d6 showing 4'`.
 *
 * @param sides - How many faces the die has
 * @param value - The face currently up, 1-indexed as the engine stores it
 * @param faceLabels - Optional custom face words, indexed from face 1
 * @param zeroIndexed - For a d10 whose faces read 0-9 rather than 1-10
 */
export function dieAriaLabel(
  sides: number,
  value: number,
  faceLabels?: string[],
  zeroIndexed = false,
): string {
  const custom = faceLabels?.[value - 1];
  if (custom) return `d${sides} showing ${custom}`;

  const face = sides === 10 && zeroIndexed ? value - 1 : value;
  return `d${sides} showing ${face}`;
}
