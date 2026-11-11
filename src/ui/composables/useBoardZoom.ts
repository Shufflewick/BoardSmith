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
 * turn its own pinch off, so one finger or a pen pans it here too. A press on
 * an element that handles its own touch (a draggable's `touch-action`, a form
 * control) is that element's, and a press that never moves is a tap.
 */
import { nextTick, ref, watch, type Ref } from 'vue';
import { provideBoardZoom } from './boardRegionPin.js';
import { DRAG_THRESHOLD } from './pointerDrag.js';

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
    const win = region.ownerDocument.defaultView!;
    const fingers = new Map<number, { x: number; y: number }>();
    /** Presses an element inside the region handles itself: while one is down, no finger pans or pinches. */
    const theirs = new Set<number>();
    /** Where the fingers were, the zoom and scroll, and the board's corner when the current set of fingers came down. */
    let start: { x: number; y: number; spread: number; zoom: number; left: number; top: number; cornerX: number; cornerY: number } | null = null;
    let moved = false;
    /** A pan ended: the click the browser may still send for it is the pan's, not a choice. */
    let swallowClick = false;

    const span = () => {
      const [a, b = a] = [...fingers.values()];
      return { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, spread: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
    };
    const begin = () => {
      const corner = boardEl.value?.getBoundingClientRect() ?? { left: 0, top: 0 };
      start = fingers.size ? { ...span(), zoom: zoomLevel.value, left: region.scrollLeft, top: region.scrollTop, cornerX: corner.left, cornerY: corner.top } : null;
    };
    const handlesItsOwnTouch = (target: EventTarget | null) => {
      for (let el = target instanceof Element ? target : null; el && el !== region; el = el.parentElement) {
        if (el.matches('input, textarea, select, [contenteditable]') || win.getComputedStyle(el).touchAction !== 'auto') return true;
      }
      return false;
    };

    const down = (e: PointerEvent) => {
      swallowClick = false;
      // A mouse has the scrollbars and the wheel.
      if (e.pointerType === 'mouse') return;
      if (handlesItsOwnTouch(e.target)) {
        theirs.add(e.pointerId);
        fingers.clear();
        start = null;
        return;
      }
      if (theirs.size || fingers.size === 2) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      begin();
    };
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId) || !start) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const now = span();
      if (!moved && fingers.size === 1 && Math.hypot(now.x - start.x, now.y - start.y) < DRAG_THRESHOLD) return;
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
      theirs.delete(e.pointerId);
      if (!fingers.delete(e.pointerId)) return;
      if (fingers.size === 0) {
        swallowClick = moved;
        moved = false;
      }
      begin();
    };
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    // A finger can lift anywhere, even off the region, so the window hears every move and release.
    region.addEventListener('pointerdown', down);
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', up);
    region.addEventListener('click', click, { capture: true });
    onCleanup(() => {
      region.removeEventListener('pointerdown', down);
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up);
      win.removeEventListener('pointercancel', up);
      region.removeEventListener('click', click, { capture: true });
    });
  }, { flush: 'post', immediate: true });

  return { zoomLevel, setZoom, resetZoom };
}
