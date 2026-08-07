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
 * SETTLE_MS is NOT a race against a fluctuating quantity: the board's natural
 * size converges (it is 0x0 until session state arrives, then settles on one
 * number for a given state), so the settle timer only decides WHEN TO STOP
 * re-fitting a value that has already converged. Any sampling instant after
 * convergence yields the same zoom, which is what makes the fitted zoom
 * reproducible across two loads of the same state.
 *
 * Separately, and for the whole component lifetime, a persistent
 * ResizeObserver on the REGION re-fits the board whenever the available space
 * genuinely changes (a window/iframe resize, the sidebar collapsing) — this is
 * what keeps a never-touched-zoom player's board reachable as the layout moves
 * around it. A manual `setZoom` (the slider) takes control and this auto-refit
 * stops; `fitZoom()` (the header/menu "Fit" button) re-fits once and re-arms it.
 *
 * NOTHING HERE MEASURES THE ACTION PANEL — the options type does not even admit
 * a panel input, so the fit cannot read it. The panel's height has no single
 * value (every selection step re-wraps it), so reserving the measured height
 * made the fitted zoom depend on when the sample was taken (issue #13). Instead
 * GameShell reserves a CONSTANT footprint in CSS: `--bsg-panel-reserved` is
 * `.boardregion`'s padding-bottom, so the padding subtraction below already
 * excludes the panel's space and the region box is the single source of truth.
 * Being constant, it never re-triggers the persistent region observer, and the
 * panel can grow over the board without ever resizing it — the old "board shakes
 * under the player's cursor on every click" regression is structurally
 * impossible. The panel is out of flow (`.actionbar` is `position: absolute`) so
 * it never moves the board by itself, and the region plus the zoom container's
 * bottom margin keep scroll room up to the panel's ceiling (`--bsg-panel-max`),
 * so anything a fully grown panel covers stays scrollable into view.
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
 * - Available space is the region's client box minus its padding — and the
 *   region's padding-bottom is the Action Panel's reserved footprint, so a
 *   fitted board sits fully above that footprint with no panel term needed.
 * - Re-fits triggered by the region observer are rAF-coalesced into a single
 *   `measureAndFit()` per frame, so a cascade of layout changes (e.g. the
 *   sidebar collapsing plus a window resize) never thrashes.
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
}) {
  const { boardEl, regionEl } = options;

  const zoomLevel = ref(1.0);

  /** Non-zero while a `useBoardSize()`-pinned board is mounted below the shell.
   *  Such a board is width-fit only (see the module docblock). The game opts in
   *  by calling `useBoardSize()` — there is no second flag to remember. */
  const pinnedBoards = provideBoardRegionPin();

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
        - (parseFloat(regionStyle.paddingBottom) || 0),
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
  // Only reads region geometry and writes the board's zoom — never
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
