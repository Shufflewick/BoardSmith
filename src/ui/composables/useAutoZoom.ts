/**
 * useAutoZoom — startup fit + persistent available-space re-fit for the board zoom.
 *
 * At startup the board renders at its natural (max-content) size inside the
 * scrollable board region. This composable watches the board while it is
 * settling in (content arrives asynchronously over the session socket), fits
 * the zoom so the whole board fills the available region without scrolling
 * (clamped to the slider range), and then stops watching the board itself
 * once its size has been stable for SETTLE_MS — mid-game board CONTENT
 * growth never moves the zoom on its own.
 *
 * Separately, and for the whole component lifetime, a persistent
 * ResizeObserver on the region plus a watch on the dock's measured height
 * re-fit the board whenever the AVAILABLE SPACE changes (the dock landing,
 * a region resize) — this is what keeps a never-touched-zoom player's board
 * reachable as the layout moves around it. A manual `setZoom` (the slider)
 * takes control and this auto-refit stops; `fitZoom()` (the header/menu
 * "Fit" button) re-fits once and re-arms it.
 *
 * Measurement notes:
 * - The board element carries CSS `zoom`, so its getBoundingClientRect() is
 *   scaled. Natural size = rect / the *applied* zoom read from computed style
 *   (not the ref, which may not have flushed to the DOM yet).
 * - Available space is the region's client box minus its padding and the
 *   floating action dock's height, so a fitted board sits fully above the dock.
 * - Re-fits triggered by the region observer / dock watch are rAF-coalesced
 *   into a single `measureAndFit()` per frame, so a cascade of layout changes
 *   (e.g. the dock's own ResizeObserver plus a window resize) never thrashes.
 */
import { ref, watch, onUnmounted, type Ref } from 'vue';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;

/** How long the board's size must hold still after a successful fit before
 *  startup is considered over and the startup board observer disconnects. */
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

  /** True once the user has manually zoomed (the slider). While true, the
   *  persistent available-space re-fit is a no-op — `fitZoom()` clears it. */
  let userControlled = false;

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

  // --- Startup fitting: follow the board while its own content settles ----
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

  // --- Persistent re-fit on available-space changes (component lifetime) --
  // Only reads region/dock geometry and writes the board's zoom — never
  // observes the board itself here, so this cannot feed back into its own
  // trigger (the board-content-growth exclusion above holds by construction).
  let pendingFrame: number | null = null;

  function scheduleRefit() {
    if (pendingFrame !== null) return; // already coalescing this frame
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (!userControlled) measureAndFit();
    });
  }

  let regionObserver: ResizeObserver | null = null;

  function teardownRefit() {
    regionObserver?.disconnect();
    regionObserver = null;
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
  }

  // Observe the region directly (it is already passed in — no `.closest`
  // needed). Lives for the component lifetime; torn down on unmount only.
  watch(regionEl, (el) => {
    regionObserver?.disconnect();
    regionObserver = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      regionObserver = new ResizeObserver(scheduleRefit);
      regionObserver.observe(el);
    }
    // Catch iframe/host resize that the RO may miss (useBoardSize precedent).
    // Routed through the same coalescing scheduler (not a raw rAF) so
    // teardownRefit's cancelAnimationFrame(pendingFrame) always covers it.
    scheduleRefit();
  }, { immediate: true, flush: 'post' });

  // The dock's own ResizeObserver already writes fresh dockHeight
  // (GameShell.vue) — just react to the ref, don't re-measure it here.
  watch(dockHeight, scheduleRefit, { flush: 'post' });

  onUnmounted(() => {
    endStartup();
    teardownRefit();
  });

  /** Manual zoom from the slider — cancels any in-flight startup fitting and
   *  takes manual control, so neither startup nor the persistent
   *  available-space re-fit ever stomps the user's choice. */
  function setZoom(value: number) {
    endStartup();
    userControlled = true;
    // A frame already queued by a prior scheduleRefit is intentionally left to
    // fire — its callback re-checks `userControlled` at fire-time (:140) and
    // self-no-ops now that we've set it, so there's nothing to cancel here.
    zoomLevel.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  }

  /** Re-fit once on demand (header percent button / menu "Fit") and re-arm
   *  the persistent auto-refit — "Fit" means "fit to space and keep it
   *  fitted" again. */
  function fitZoom() {
    endStartup();
    userControlled = false;
    measureAndFit();
  }

  return { zoomLevel, setZoom, fitZoom, measureAndFit };
}
