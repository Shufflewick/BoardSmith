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
 * ResizeObserver on the REGION re-fits the board whenever the available space
 * genuinely changes (a window/iframe resize, the sidebar collapsing) — this is
 * what keeps a never-touched-zoom player's board reachable as the layout moves
 * around it. A manual `setZoom` (the slider) takes control and this auto-refit
 * stops; `fitZoom()` (the header/menu "Fit" button) re-fits once and re-arms it.
 *
 * The Action Panel's height is deliberately NOT part of that persistent re-fit. It is
 * reserved during startup (so the Action Panel landing is accounted for in the initial
 * fit) and then frozen. The action panel's height changes constantly during
 * play — every selection step re-wraps it — and re-fitting on that resized the
 * board under the player's cursor on every click: the board visibly shook when
 * a piece was selected and again when it moved. Nothing is lost by ignoring it:
 * the Action Panel is out of flow (GameShell's `.actionbar` is `position: absolute`) so
 * it never moves the board by itself, and the board region keeps `--action-panel-h` of
 * scroll room, so anything a grown Action Panel covers stays scrollable into view.
 *
 * Fit axis: a board that has called `useBoardSize()` is pinned to the region's
 * width and documented to grow by VERTICAL SCROLL. Height-fitting such a board
 * contradicts that model — it scales the whole layout box down (type included)
 * purely to avoid a scrollbar the board already opted into. So a pinned board
 * is fitted on WIDTH ONLY. Nothing is lost: its width is the region's width, so
 * the width term is 1 unless content genuinely overflows sideways, which is
 * the one case where scaling down is still the right answer. The game states
 * this once, by calling `useBoardSize()`; see composables/boardRegionPin.ts.
 *
 * Measurement notes:
 * - The board element carries CSS `zoom`, so its getBoundingClientRect() is
 *   scaled. Natural size = rect / the *applied* zoom read from computed style
 *   (not the ref, which may not have flushed to the DOM yet).
 * - Available space is the region's client box minus its padding and the
 *   floating Action Panel's height, so a fitted board sits fully above the Action Panel.
 * - Re-fits triggered by the region observer / Action Panel watch are rAF-coalesced
 *   into a single `measureAndFit()` per frame, so a cascade of layout changes
 *   (e.g. the Action Panel's own ResizeObserver plus a window resize) never thrashes.
 */
import { ref, watch, onUnmounted, type Ref } from 'vue';
import { provideBoardRegionPin } from './boardRegionPin.js';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;

/** Which axes the board must fit inside the available space.
 *  `'both'` for a fixed-intrinsic board; `'width'` for a board pinned to the
 *  region by `useBoardSize()`, whose growth is vertical scroll by contract. */
export type FitAxis = 'both' | 'width';

/** How long the board's size must hold still after a successful fit before
 *  startup is considered over and the startup board observer disconnects. */
export const SETTLE_MS = 300;

/** Largest zoom at which `natural` fits inside `avail` on the requested axes,
 *  clamped to the slider range. Returns null when a box the chosen axes need is
 *  unmeasurable (not laid out yet). `fitAxis` is required, not defaulted: the
 *  axis is a property of the board, and a caller that hasn't decided it hasn't
 *  finished the measurement. */
export function computeFitZoom(
  natural: { width: number; height: number },
  avail: { width: number; height: number },
  fitAxis: FitAxis,
): number | null {
  if (natural.width < 1 || avail.width < 1) return null;
  const clamp = (fit: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, fit));
  const widthFit = avail.width / natural.width;
  // Width-only: the height boxes are irrelevant, and an unmeasurable height
  // (a tall board under a tall Action Panel) must not suppress the fit.
  if (fitAxis === 'width') return clamp(widthFit);
  if (natural.height < 1 || avail.height < 1) return null;
  return clamp(Math.min(widthFit, avail.height / natural.height));
}

export function useAutoZoom(options: {
  /** The zoom container (`.game-shell__zoom-container`) — sized to the board's natural content. */
  boardEl: Ref<HTMLElement | null>;
  /** The scrollable board region (`.boardregion`) the board must fit inside. */
  regionEl: Ref<HTMLElement | null>;
  /** Measured height of the floating Action Panel, reserved so a fitted board
   *  is fully visible above it rather than sliding underneath. */
  actionPanelHeight: Ref<number>;
}) {
  const { boardEl, regionEl, actionPanelHeight } = options;

  const zoomLevel = ref(1.0);

  /** Non-zero while a `useBoardSize()`-pinned board is mounted below the shell.
   *  Such a board is width-fit only (see the module docblock). The game opts in
   *  by calling `useBoardSize()` — there is no second flag to remember. */
  const pinnedBoards = provideBoardRegionPin();

  /** True once the user has manually zoomed (the slider). While true, the
   *  persistent available-space re-fit is a no-op — `fitZoom()` clears it. */
  let userControlled = false;

  /** The Action Panel height the fit reserves. Null while startup is still following
   *  the live Action Panel; set to the Action Panel's height at the moment startup ends, after
   *  which mid-game Action Panel growth/shrink can no longer change the board's size
   *  (see the module docblock). Cleared when a new board mounts. */
  let reservedActionPanelHeight: number | null = null;

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
        - (reservedActionPanelHeight ?? actionPanelHeight.value),
    };

    const fit = computeFitZoom(natural, avail, pinnedBoards.value > 0 ? 'width' : 'both');
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
    // Freeze the Action Panel allowance at whatever the Action Panel measures right now, so a
    // later region-driven re-fit reserves the same space this fit did rather
    // than silently adopting a mid-game panel height.
    reservedActionPanelHeight = actionPanelHeight.value;
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
    // A new board gets a fresh startup, which follows the live Action Panel again.
    reservedActionPanelHeight = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      boardObserver = new ResizeObserver(onBoardResize);
      boardObserver.observe(el); // observe() always fires an initial callback
    }
  }, { immediate: true, flush: 'post' });

  // --- Persistent re-fit on available-space changes (component lifetime) --
  // Only reads region/Action Panel geometry and writes the board's zoom — never
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

  // The Action Panel's own ResizeObserver already writes fresh actionPanelHeight
  // (GameShell.vue) — just react to the ref, don't re-measure it here.
  //
  // STARTUP ONLY. The frozen allowance in measureAndFit is what actually holds
  // the board's size still after startup; this guard additionally skips the
  // pointless rAF + layout measurement that a mid-game Action Panel resize would
  // otherwise schedule — and the panel re-wraps on every single selection step.
  watch(actionPanelHeight, () => {
    if (startupDone) return;
    scheduleRefit();
  }, { flush: 'post' });

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
