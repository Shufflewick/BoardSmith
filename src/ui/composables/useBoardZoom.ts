/**
 * useBoardZoom — the player's board magnifier (#1608).
 *
 * The board is never zoomed to fit: the auto-UI's cells, pieces and cards size
 * from the board region's width, down to the `--bsg-tap-min` floor, and the
 * region scrolls when a board cannot fit at that floor. The zoom only magnifies,
 * from 100% to 200%, and only when the player asks. PlayShell applies it as a
 * `transform: scale`, so every browser reports the magnified boxes from
 * `getBoundingClientRect` and hit-tests them the same way.
 */
import { ref } from 'vue';
import { provideBoardZoom } from './boardRegionPin.js';

/** The slider's range: a magnifier, never below the size the board reflows to. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;

export function useBoardZoom() {
  const zoomLevel = ref(1);
  provideBoardZoom(zoomLevel);

  /** The slider's value, kept inside its range. */
  function setZoom(value: number) {
    zoomLevel.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  }

  /** Back to 100%. */
  function resetZoom() {
    zoomLevel.value = 1;
  }

  return { zoomLevel, setZoom, resetZoom };
}
