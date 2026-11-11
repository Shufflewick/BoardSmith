/**
 * useBoardZoom — the player's board magnifier (#1608).
 *
 * The board is never zoomed to fit: the auto-UI's cells, pieces and cards size
 * from the board region's width, down to the `--bsg-tap-min` floor, and the
 * region scrolls when a board cannot fit at that floor. The zoom only magnifies,
 * from 100% to 200%, and only when the player asks. PlayShell applies it as a
 * `transform: scale`, so every browser reports the magnified boxes from
 * `getBoundingClientRect` and hit-tests them the same way.
 *
 * On a touch screen the player also pinches and pans inside the board region
 * (#1609). The region is `touch-action: none`, because iOS will not let a page
 * turn its own pinch off, so one finger pans it here too. A press a draggable
 * claimed is the drag's, and a press that never moves is a tap.
 */
import { nextTick, ref, watch, type Ref } from 'vue';
import { provideBoardZoom } from './boardRegionPin.js';
import { claimedByDrag, DRAG_THRESHOLD } from './pointerDrag.js';

/** The slider's range: a magnifier, never below the size the board reflows to. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;

export interface BoardZoomElements {
  /** The scrolling board region the fingers pinch and pan. */
  regionEl: Readonly<Ref<HTMLElement | null>>;
  /** The scaled board inside it, scaled from its top-left corner. */
  boardEl: Readonly<Ref<HTMLElement | null>>;
}

export function useBoardZoom({ regionEl, boardEl }: BoardZoomElements) {
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

  watch(regionEl, (region, _previous, onCleanup) => {
    if (!region) return;
    const fingers = new Map<number, { x: number; y: number }>();
    /** Where the fingers were, the zoom and scroll, and the board's corner when the current set of fingers came down. */
    let start: { x: number; y: number; spread: number; zoom: number; left: number; top: number; cornerX: number; cornerY: number } | null = null;
    let moved = false;

    const span = () => {
      const [a, b = a] = [...fingers.values()];
      return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, spread: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
    };
    const begin = () => {
      const corner = boardEl.value?.getBoundingClientRect() ?? { left: 0, top: 0 };
      start = fingers.size ? { ...span(), zoom: zoomLevel.value, left: region.scrollLeft, top: region.scrollTop, cornerX: corner.left, cornerY: corner.top } : null;
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || claimedByDrag(e) || fingers.size === 2) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      begin();
    };
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId) || !start) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = span();
      if (!moved && Math.hypot(now.x - start.x, now.y - start.y) < DRAG_THRESHOLD && fingers.size === 1) return;
      moved = true;
      const from = start;
      if (fingers.size === 2 && from.spread > 0) setZoom(from.zoom * (now.spread / from.spread));
      // The board point that was under the fingers' centre stays under it, once the new zoom has laid the region out.
      const ratio = zoomLevel.value / from.zoom;
      void nextTick(() => region.scrollTo(
        from.left + (from.x - from.cornerX) * ratio + from.cornerX - now.x,
        from.top + (from.y - from.cornerY) * ratio + from.cornerY - now.y,
      ));
    };
    const up = (e: PointerEvent) => {
      if (!fingers.delete(e.pointerId)) return;
      if (fingers.size === 0) moved = false;
      begin();
    };

    region.addEventListener('pointerdown', down);
    region.addEventListener('pointermove', move);
    region.addEventListener('pointerup', up);
    region.addEventListener('pointercancel', up);
    onCleanup(() => {
      region.removeEventListener('pointerdown', down);
      region.removeEventListener('pointermove', move);
      region.removeEventListener('pointerup', up);
      region.removeEventListener('pointercancel', up);
    });
  }, { flush: 'post' });

  return { zoomLevel, setZoom, resetZoom };
}
