// @vitest-environment jsdom
/**
 * useAutoZoom — startup fit + persistent available-space re-fit for the board zoom.
 *
 * Behaviors under test:
 *   AZ-1: computeFitZoom returns the largest zoom where the board fits both
 *         axes, clamped to [ZOOM_MIN, ZOOM_MAX], and null for unmeasurable boxes.
 *   AZ-2: measureAndFit applies the fitted zoom from real element measurements
 *         (board rect ÷ applied zoom vs region client box minus padding and
 *         Action Panel height).
 *   AZ-3: startup fitting keeps following board resizes while content settles
 *         in (including waiting out an initial 0×0 board), then the STARTUP
 *         board observer stops once the size has been stable for SETTLE_MS —
 *         later board CONTENT growth (with no Action Panel/region change) never moves
 *         the zoom.
 *   AZ-4: setZoom (the slider) clamps, applies, cancels any in-flight startup
 *         fitting, and takes manual control (auto-refit stops until fitZoom).
 *   AZ-5: fitZoom re-fits once on demand and re-arms auto-refit.
 *   ZOOM-01: after the startup fit settles, a region resize re-fits the board
 *         (the persistent region observer), unless the user has taken manual
 *         control via setZoom.
 *   ZOOM-02: the Action Panel height is reserved during startup but frozen afterwards —
 *         a mid-game action-panel resize must NOT move the board. Re-fitting on
 *         it made the board shake on every piece click and every move.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { computeFitZoom, useAutoZoom, ZOOM_MIN, ZOOM_MAX, SETTLE_MS } from './useAutoZoom';

describe('computeFitZoom (AZ-1)', () => {
  it('fits the constraining axis', () => {
    // Width would allow 2x, height only 1.5x → height constrains.
    expect(computeFitZoom({ width: 500, height: 400 }, { width: 1000, height: 600 }, 'both')).toBe(1.5);
  });

  it('clamps to the slider range', () => {
    expect(computeFitZoom({ width: 100, height: 100 }, { width: 1000, height: 1000 }, 'both')).toBe(ZOOM_MAX);
    expect(computeFitZoom({ width: 4000, height: 4000 }, { width: 500, height: 500 }, 'both')).toBe(ZOOM_MIN);
  });

  it('returns null for unmeasurable boxes (not laid out yet)', () => {
    expect(computeFitZoom({ width: 0, height: 0 }, { width: 800, height: 600 }, 'both')).toBeNull();
    expect(computeFitZoom({ width: 500, height: 400 }, { width: 0, height: 0 }, 'both')).toBeNull();
  });

  it("B20: 'width' ignores the height term entirely", () => {
    // Same boxes as the constraining-axis case: height would force 1.5.
    expect(computeFitZoom({ width: 500, height: 400 }, { width: 1000, height: 600 }, 'width')).toBe(2);
    // A board far taller than the space still fits at 1 when its width matches.
    expect(computeFitZoom({ width: 367, height: 4000 }, { width: 367, height: 600 }, 'width')).toBe(1);
    // Genuine horizontal overflow is still fitted — that is the one case where
    // scaling a pinned board down is correct.
    expect(computeFitZoom({ width: 800, height: 100 }, { width: 400, height: 600 }, 'width')).toBe(0.5);
  });

  it("B20: 'width' still fits when the height boxes are unmeasurable", () => {
    // A tall board under a taller-than-region Action Panel allowance yields a
    // non-positive avail height; that must not suppress the width fit.
    expect(computeFitZoom({ width: 400, height: 900 }, { width: 400, height: 0 }, 'width')).toBe(1);
    // The width boxes are still required on both axis modes.
    expect(computeFitZoom({ width: 0, height: 900 }, { width: 400, height: 600 }, 'width')).toBeNull();
  });
});

/** Fake board/region elements with the layout jsdom doesn't compute.
 *  The returned setter changes the board's reported size (content settling in). */
function fakeBoard(width: number, height: number, appliedZoom = 1) {
  const size = { width, height };
  const el = document.createElement('div');
  // The real element carries CSS zoom, so its client rect is scaled.
  el.getBoundingClientRect = () =>
    ({ width: size.width * appliedZoom, height: size.height * appliedZoom }) as DOMRect;
  if (appliedZoom !== 1) {
    // jsdom doesn't compute the non-standard `zoom` property; report it the way
    // a real browser's computed style would.
    const realGCS = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((target: Element) =>
      target === el
        ? ({ zoom: String(appliedZoom) } as unknown as CSSStyleDeclaration)
        : realGCS(target as Element),
    );
  }
  return { el, setSize: (w: number, h: number) => { size.width = w; size.height = h; } };
}

/** Mutable fake region: clientWidth/clientHeight are getter-backed over a
 *  mutable size object so a test can drive a post-startup region resize
 *  (mirrors fakeBoard's shape). */
function fakeRegion(clientWidth: number, clientHeight: number, reservedPanel = 0) {
  const size = { width: clientWidth, height: clientHeight };
  const el = document.createElement('div');
  // The Action Panel's CONSTANT reserved footprint is the region's padding-bottom
  // (--bsg-panel-reserved in GameShell.vue). The fit subtracts region padding and
  // knows nothing about a panel — see the module docblock (#13).
  el.style.paddingBottom = `${reservedPanel}px`;
  Object.defineProperty(el, 'clientWidth', { get: () => size.width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => size.height, configurable: true });
  return { el, setSize: (w: number, h: number) => { size.width = w; size.height = h; } };
}

/** Controllable ResizeObserver stub: jsdom has none, and the composable's
 *  startup + persistent-refit behavior is driven by when resize callbacks fire. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
    this.callback(); // real observers fire an initial callback on observe()
  }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  fire() { if (!this.disconnected) this.callback(); }
}

/** Controllable requestAnimationFrame queue: the composable rAF-coalesces
 *  re-fits, and iframe/host resize catch-up also runs on rAF. Tests must
 *  flush it deterministically rather than rely on real frame timing. */
let rafId = 0;
let rafQueue = new Map<number, () => void>();
function flushRaf() {
  const fns = Array.from(rafQueue.values());
  rafQueue.clear();
  fns.forEach((fn) => fn());
}

function mountAutoZoom(opts: {
  boardEl: Ref<HTMLElement | null>;
  regionEl: Ref<HTMLElement | null>;
}) {
  let api!: ReturnType<typeof useAutoZoom>;
  const wrapper = mount(defineComponent({
    setup() {
      api = useAutoZoom(opts);
      return () => h('div');
    },
  }));
  return { api, wrapper };
}

/** Find the ResizeObserver instance observing a specific element (there are
 *  two live instances post-fix: the startup board observer and the
 *  persistent region observer — index alone is not reliable for the region
 *  one once tests re-wire regionEl). */
function observerFor(el: Element): FakeResizeObserver | undefined {
  return FakeResizeObserver.instances.find((o) => o.observed.includes(el));
}

describe('useAutoZoom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    rafId = 0;
    rafQueue = new Map();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++rafId;
      rafQueue.set(id, () => cb(0));
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue.delete(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('AZ-2: fits at startup from element measurements', async () => {
    const board = fakeBoard(400, 300);
    const boardEl = ref<HTMLElement | null>(board.el);
    const region = fakeRegion(800, 700, 100);
    const regionEl = ref<HTMLElement | null>(region.el);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
    await nextTick(); // flush: 'post' watcher wires the observer

    // width: 800/400 = 2, height: (700-100)/300 = 2 → fit 2.0
    expect(api.zoomLevel.value).toBe(2.0);
    wrapper.unmount();
  });

  it('AZ-2: divides out the already-applied zoom when measuring natural size', async () => {
    // Board is currently rendered at zoom 2 (rect reports 800×600); its natural
    // size is 400×300 and the correct fit for a 600×450 region is 1.5, not 0.75.
    const board = fakeBoard(400, 300, 2);
    const boardEl = ref<HTMLElement | null>(board.el);
    const region = fakeRegion(600, 450);
    const regionEl = ref<HTMLElement | null>(region.el);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
    await nextTick();

    expect(api.zoomLevel.value).toBe(1.5);
    wrapper.unmount();
  });

  it('AZ-3: keeps fitting while content settles, then the startup observer stops', async () => {
    // Board starts 0×0 — session state hasn't arrived yet.
    const board = fakeBoard(0, 0);
    const boardEl = ref<HTMLElement | null>(board.el);
    const region = fakeRegion(800, 600);
    const regionEl = ref<HTMLElement | null>(region.el);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
    await nextTick();
    // Flush the mount-time region-wiring catch-up frame now (it fires within
    // a frame of mount in practice) so it can't be mistaken later for a
    // response to the mid-game content growth this test locks down.
    flushRaf();
    const observer = observerFor(board.el)!;

    expect(api.zoomLevel.value).toBe(1.0); // nothing measurable yet

    // The 0×0 phase must NOT start the settle countdown — content arriving
    // long after SETTLE_MS still gets its startup fit.
    vi.advanceTimersByTime(SETTLE_MS * 10);
    board.setSize(400, 300);
    observer.fire();
    expect(api.zoomLevel.value).toBe(2.0);

    // More content arrives within the settle window → still refits.
    vi.advanceTimersByTime(SETTLE_MS / 2);
    board.setSize(800, 300);
    observer.fire();
    expect(api.zoomLevel.value).toBe(1.0);

    // Size holds still for SETTLE_MS → startup over, board observer disconnected.
    vi.advanceTimersByTime(SETTLE_MS);
    expect(observer.disconnected).toBe(true);

    // Mid-game CONTENT growth (board is no longer observed) never moves the
    // zoom by itself — no region change accompanies it.
    board.setSize(800, 900);
    observer.fire(); // no-op: disconnected
    flushRaf();
    expect(api.zoomLevel.value).toBe(1.0);
    wrapper.unmount();
  });

  it('AZ-4: setZoom clamps, applies, cancels in-flight startup fitting, and takes manual control', async () => {
    const board = fakeBoard(400, 300);
    const boardEl = ref<HTMLElement | null>(board.el);
    const region = fakeRegion(800, 600);
    const regionEl = ref<HTMLElement | null>(region.el);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
    await nextTick();
    const observer = observerFor(board.el)!;

    // User grabs the slider while the board is still settling.
    api.setZoom(0.8);
    expect(api.zoomLevel.value).toBe(0.8);
    expect(observer.disconnected).toBe(true);

    // A late content resize can't stomp the user's choice.
    board.setSize(200, 200);
    observer.fire();
    expect(api.zoomLevel.value).toBe(0.8);

    api.setZoom(99);
    expect(api.zoomLevel.value).toBe(ZOOM_MAX);
    api.setZoom(0.01);
    expect(api.zoomLevel.value).toBe(ZOOM_MIN);
    wrapper.unmount();
  });

  it('AZ-5: fitZoom re-fits once on demand', async () => {
    const board = fakeBoard(400, 300);
    const boardEl = ref<HTMLElement | null>(board.el);
    const region = fakeRegion(800, 700, 100);
    const regionEl = ref<HTMLElement | null>(region.el);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
    await nextTick();

    api.setZoom(0.6);
    api.fitZoom();
    expect(api.zoomLevel.value).toBe(2.0);
    wrapper.unmount();
  });

  describe('re-fit on available-space change (ZOOM-01)', () => {
    it("reserves the panel's CONSTANT footprint from the region's padding, from the first fit (#13)", async () => {
      const board = fakeBoard(400, 300);
      const boardEl = ref<HTMLElement | null>(board.el);
      // The region's padding-bottom IS the reserved panel footprint.
      const region = fakeRegion(800, 700, 400);
      const regionEl = ref<HTMLElement | null>(region.el);
      const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
      await nextTick();
      flushRaf();

      // avail height 700-400=300 → min(800/400, 300/300) = 1.0, reserved from the
      // very first fit: there is no "panel landing" instant to be early or late for.
      expect(api.zoomLevel.value).toBe(1.0);
      wrapper.unmount();
    });

    it('a post-startup region re-fit reserves the same constant footprint (ZOOM-02)', async () => {
      const board = fakeBoard(400, 300);
      const boardEl = ref<HTMLElement | null>(board.el);
      const region = fakeRegion(800, 700, 100);
      const regionEl = ref<HTMLElement | null>(region.el);
      const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
      await nextTick();
      flushRaf();
      vi.advanceTimersByTime(SETTLE_MS);

      // The window resizes. The reservation is a CSS constant, so the re-fit
      // reserves exactly what the startup fit did — no frozen sample involved:
      // avail 800 x (1000-100)=900 -> min(800/400, 900/300) = min(2, 3) = 2.0.
      region.setSize(800, 1000);
      observerFor(region.el)?.fire();
      flushRaf();

      expect(api.zoomLevel.value).toBe(2.0);
      wrapper.unmount();
    });

    it('re-fits when the region resizes after the startup fit has settled', async () => {
      const board = fakeBoard(400, 300);
      const boardEl = ref<HTMLElement | null>(board.el);
      const region = fakeRegion(800, 700, 100);
      const regionEl = ref<HTMLElement | null>(region.el);
      const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
      await nextTick();
      flushRaf();
      expect(api.zoomLevel.value).toBe(2.0);

      vi.advanceTimersByTime(SETTLE_MS);

      // The region shrinks (window/sidebar reflow): avail width now 400 →
      // fit min(400/400, 600/300) = min(1, 2) = 1.0.
      region.setSize(400, 700);
      const regionObserver = observerFor(region.el);
      regionObserver?.fire();
      flushRaf();

      expect(api.zoomLevel.value).toBe(1.0);
      wrapper.unmount();
    });
  });

  describe('adversarial: user zoom + content-growth guard (ZOOM-01)', () => {
    it('a manual setZoom is NOT overridden by a subsequent region change', async () => {
      const board = fakeBoard(400, 300);
      const boardEl = ref<HTMLElement | null>(board.el);
      const region = fakeRegion(800, 700, 100);
      const regionEl = ref<HTMLElement | null>(region.el);
      const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
      await nextTick();
      flushRaf();
      vi.advanceTimersByTime(SETTLE_MS);

      api.setZoom(0.8);
      expect(api.zoomLevel.value).toBe(0.8);

      // Attempt to defeat the guard with the EXACT change that re-fits an
      // un-controlled player: a region resize.
      region.setSize(400, 700);
      observerFor(region.el)?.fire();
      await nextTick();
      flushRaf();

      expect(api.zoomLevel.value).toBe(0.8); // unchanged — user zoom wins
      wrapper.unmount();
    });

    it('fitZoom() re-arms auto-refit: a later region change re-fits again', async () => {
      const board = fakeBoard(400, 300);
      const boardEl = ref<HTMLElement | null>(board.el);
      const region = fakeRegion(800, 700, 100);
      const regionEl = ref<HTMLElement | null>(region.el);
      const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
      await nextTick();
      flushRaf();
      vi.advanceTimersByTime(SETTLE_MS);

      api.setZoom(0.8);
      region.setSize(400, 700);
      observerFor(region.el)?.fire();
      await nextTick();
      flushRaf();
      expect(api.zoomLevel.value).toBe(0.8);

      // Pressing Fit re-fits to the CURRENT space (400×700 region less its 100
      // reserved footprint → avail 400×600) and clears the guard.
      api.fitZoom();
      expect(api.zoomLevel.value).toBe(1.0); // min(400/400, 600/300) = 1.0

      // A later region change now DOES re-fit (guard re-armed): avail is
      // 800 × (1100-100)=1000 → min(800/400, 1000/300) = min(2, 3.33) = 2.0.
      region.setSize(800, 1100);
      observerFor(region.el)?.fire();
      await nextTick();
      flushRaf();
      expect(api.zoomLevel.value).toBe(2.0);
      wrapper.unmount();
    });

    it('board CONTENT growth alone (no region change) does not move the zoom', async () => {
      const board = fakeBoard(400, 300);
      const boardEl = ref<HTMLElement | null>(board.el);
      const region = fakeRegion(800, 700, 100);
      const regionEl = ref<HTMLElement | null>(region.el);
      const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
      await nextTick();
      flushRaf();
      vi.advanceTimersByTime(SETTLE_MS);
      expect(api.zoomLevel.value).toBe(2.0);

      // Board grows mid-game; the board is no longer observed post-startup,
      // and the region observer does not fire for it.
      board.setSize(800, 900);
      await nextTick();
      flushRaf();

      expect(api.zoomLevel.value).toBe(2.0); // unchanged
      wrapper.unmount();
    });

    it('the persistent region observer is torn down on unmount — no leak, no re-fit after', async () => {
      const board = fakeBoard(400, 300);
      const boardEl = ref<HTMLElement | null>(board.el);
      const region = fakeRegion(800, 700, 100);
      const regionEl = ref<HTMLElement | null>(region.el);
      const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
      await nextTick();
      flushRaf();
      vi.advanceTimersByTime(SETTLE_MS);
      expect(api.zoomLevel.value).toBe(2.0);

      const regionObserver = observerFor(region.el)!;
      expect(regionObserver.disconnected).toBe(false);

      wrapper.unmount();
      expect(regionObserver.disconnected).toBe(true);

      // Post-unmount layout churn must not resurrect a re-fit.
      region.setSize(200, 200);
      regionObserver.fire(); // no-op: disconnected
      await nextTick();
      flushRaf();

      expect(api.zoomLevel.value).toBe(2.0); // unchanged
    });

    it('a scrollbar-toggle-sized region change settles rather than oscillating', async () => {
      const board = fakeBoard(400, 300);
      const boardEl = ref<HTMLElement | null>(board.el);
      const region = fakeRegion(800, 700, 100);
      const regionEl = ref<HTMLElement | null>(region.el);
      const { api, wrapper } = mountAutoZoom({ boardEl, regionEl });
      await nextTick();
      flushRaf();
      vi.advanceTimersByTime(SETTLE_MS);
      expect(api.zoomLevel.value).toBe(2.0);

      const regionObserver = observerFor(region.el)!;

      // Simulate a scrollbar showing up (~15px narrower) and hiding again,
      // fired repeatedly — the fit must converge, not drift or oscillate.
      region.setSize(785, 700);
      regionObserver.fire();
      flushRaf();
      const afterFirst = api.zoomLevel.value;

      region.setSize(800, 700);
      regionObserver.fire();
      flushRaf();
      const afterSecond = api.zoomLevel.value;

      region.setSize(785, 700);
      regionObserver.fire();
      flushRaf();
      const afterThird = api.zoomLevel.value;

      expect(Number.isFinite(afterFirst)).toBe(true);
      expect(Number.isFinite(afterSecond)).toBe(true);
      expect(afterThird).toBe(afterFirst); // settles back, does not drift
      wrapper.unmount();
    });
  });
});
