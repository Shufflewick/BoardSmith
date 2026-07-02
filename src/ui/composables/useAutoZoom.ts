/**
 * useAutoZoom — one-shot startup fit for the board zoom.
 *
 * At startup the board renders at its natural (max-content) size inside the
 * scrollable board region. This composable watches the board ONLY while it is
 * settling in (content arrives asynchronously over the session socket), fits
 * the zoom so the whole board fills the available region without scrolling
 * (clamped to the slider range), and then stops for good: once the board's
 * size has been stable for SETTLE_MS after a successful fit, the observer is
 * disconnected. Mid-game content growth, window resizes, etc. never move the
 * zoom — the user adjusts with the slider, or re-fits on demand via
 * `fitZoom()` (the header percent button / menu "Fit").
 *
 * Measurement notes:
 * - The board element carries CSS `zoom`, so its getBoundingClientRect() is
 *   scaled. Natural size = rect / the *applied* zoom read from computed style
 *   (not the ref, which may not have flushed to the DOM yet).
 * - Available space is the region's client box minus its padding and the
 *   floating action dock's height, so a fitted board sits fully above the dock.
 */
import { ref, watch, onUnmounted, type Ref } from 'vue';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;

/** How long the board's size must hold still after a successful fit before
 *  startup is considered over and the observer disconnects. */
export const SETTLE_MS = 300;

/** Largest zoom at which `natural` fits entirely inside `avail`, clamped to the
 *  slider range. Returns null when either box is unmeasurable (not laid out yet). */
export function computeFitZoom(
  natural: { width: number; height: number },
  avail: { width: number; height: number },
): number | null {
  if (natural.width < 1 || natural.height < 1) return null;
  if (avail.width < 1 || avail.height < 1) return null;
  const fit = Math.min(avail.width / natural.width, avail.height / natural.height);
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit));
}

export function useAutoZoom(options: {
  /** The zoom container (`.game-shell__zoom-container`) — sized to the board's natural content. */
  boardEl: Ref<HTMLElement | null>;
  /** The scrollable board region (`.boardregion`) the board must fit inside. */
  regionEl: Ref<HTMLElement | null>;
  /** Measured height of the floating action dock, reserved so a fitted board
   *  is fully visible above it rather than sliding underneath. */
  dockHeight: Ref<number>;
}) {
  const { boardEl, regionEl, dockHeight } = options;

  const zoomLevel = ref(1.0);

  /** Measure and apply the fitted zoom. Returns true when both boxes were
   *  measurable (a fit was computed), false when layout isn't ready yet. */
  function measureAndFit(): boolean {
    const board = boardEl.value;
    const region = regionEl.value;
    if (!board || !region) return false;

    const appliedZoom = parseFloat(getComputedStyle(board).zoom) || 1;
    const rect = board.getBoundingClientRect();
    const natural = { width: rect.width / appliedZoom, height: rect.height / appliedZoom };

    const regionStyle = getComputedStyle(region);
    const avail = {
      width: region.clientWidth
        - (parseFloat(regionStyle.paddingLeft) || 0)
        - (parseFloat(regionStyle.paddingRight) || 0),
      height: region.clientHeight
        - (parseFloat(regionStyle.paddingTop) || 0)
        - (parseFloat(regionStyle.paddingBottom) || 0)
        - dockHeight.value,
    };

    const fit = computeFitZoom(natural, avail);
    if (fit == null) return false;
    // Epsilon guard: ignore sub-visible deltas from layout rounding.
    if (Math.abs(fit - zoomLevel.value) > 0.005) zoomLevel.value = fit;
    return true;
  }

  // --- Startup-only fitting -------------------------------------------------
  let startupDone = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let boardObserver: ResizeObserver | null = null;

  function endStartup() {
    startupDone = true;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    boardObserver?.disconnect();
    boardObserver = null;
  }

  function onBoardResize() {
    if (startupDone) return;
    // Keep observing (without a settle countdown) until the first SUCCESSFUL
    // fit — the board can be 0×0 for a while before session state arrives.
    if (!measureAndFit()) return;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(endStartup, SETTLE_MS);
  }

  // The board lives under a v-if (game screen); a new element means a new
  // game / remount, so startup fitting begins again for it.
  watch(boardEl, (el) => {
    endStartup();
    startupDone = false;
    if (el && typeof ResizeObserver !== 'undefined') {
      boardObserver = new ResizeObserver(onBoardResize);
      boardObserver.observe(el); // observe() always fires an initial callback
    }
  }, { immediate: true, flush: 'post' });

  onUnmounted(endStartup);

  /** Manual zoom from the slider — also cancels any in-flight startup fitting
   *  so the user's choice is never stomped. */
  function setZoom(value: number) {
    endStartup();
    zoomLevel.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  }

  /** One-shot re-fit on demand (header percent button / menu "Fit"). */
  function fitZoom() {
    endStartup();
    measureAndFit();
  }

  return { zoomLevel, setZoom, fitZoom, measureAndFit };
}
