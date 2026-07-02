// @vitest-environment jsdom
/**
 * useAutoZoom — one-shot startup fit for the board zoom.
 *
 * Behaviors under test:
 *   AZ-1: computeFitZoom returns the largest zoom where the board fits both
 *         axes, clamped to [ZOOM_MIN, ZOOM_MAX], and null for unmeasurable boxes.
 *   AZ-2: measureAndFit applies the fitted zoom from real element measurements
 *         (board rect ÷ applied zoom vs region client box minus padding and
 *         dock height).
 *   AZ-3: startup fitting keeps following board resizes while content settles
 *         in (including waiting out an initial 0×0 board), then STOPS once the
 *         size has been stable for SETTLE_MS — later content growth never
 *         moves the zoom.
 *   AZ-4: setZoom (the slider) clamps, applies, and cancels any in-flight
 *         startup fitting so the user's choice is never stomped.
 *   AZ-5: fitZoom re-fits once on demand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { computeFitZoom, useAutoZoom, ZOOM_MIN, ZOOM_MAX, SETTLE_MS } from './useAutoZoom';

describe('computeFitZoom (AZ-1)', () => {
  it('fits the constraining axis', () => {
    // Width would allow 2x, height only 1.5x → height constrains.
    expect(computeFitZoom({ width: 500, height: 400 }, { width: 1000, height: 600 })).toBe(1.5);
  });

  it('clamps to the slider range', () => {
    expect(computeFitZoom({ width: 100, height: 100 }, { width: 1000, height: 1000 })).toBe(ZOOM_MAX);
    expect(computeFitZoom({ width: 4000, height: 4000 }, { width: 500, height: 500 })).toBe(ZOOM_MIN);
  });

  it('returns null for unmeasurable boxes (not laid out yet)', () => {
    expect(computeFitZoom({ width: 0, height: 0 }, { width: 800, height: 600 })).toBeNull();
    expect(computeFitZoom({ width: 500, height: 400 }, { width: 0, height: 0 })).toBeNull();
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

function fakeRegion(clientWidth: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: clientWidth });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  return el;
}

/** Controllable ResizeObserver stub: jsdom has none, and the composable's
 *  startup behavior is driven by when resize callbacks fire. */
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

function mountAutoZoom(opts: {
  boardEl: Ref<HTMLElement | null>;
  regionEl: Ref<HTMLElement | null>;
  dockHeight: Ref<number>;
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

describe('useAutoZoom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('AZ-2: fits at startup from element measurements', async () => {
    const board = fakeBoard(400, 300);
    const boardEl = ref<HTMLElement | null>(board.el);
    const regionEl = ref<HTMLElement | null>(fakeRegion(800, 700));
    const dockHeight = ref(100);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl, dockHeight });
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
    const regionEl = ref<HTMLElement | null>(fakeRegion(600, 450));
    const dockHeight = ref(0);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl, dockHeight });
    await nextTick();

    expect(api.zoomLevel.value).toBe(1.5);
    wrapper.unmount();
  });

  it('AZ-3: keeps fitting while content settles, then stops for good', async () => {
    // Board starts 0×0 — session state hasn't arrived yet.
    const board = fakeBoard(0, 0);
    const boardEl = ref<HTMLElement | null>(board.el);
    const regionEl = ref<HTMLElement | null>(fakeRegion(800, 600));
    const dockHeight = ref(0);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl, dockHeight });
    await nextTick();
    const observer = FakeResizeObserver.instances[0]!;

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

    // Size holds still for SETTLE_MS → startup over, observer disconnected.
    vi.advanceTimersByTime(SETTLE_MS);
    expect(observer.disconnected).toBe(true);

    // Mid-game growth never moves the zoom.
    board.setSize(800, 900);
    observer.fire();
    expect(api.zoomLevel.value).toBe(1.0);
    wrapper.unmount();
  });

  it('AZ-4: setZoom clamps, applies, and cancels in-flight startup fitting', async () => {
    const board = fakeBoard(400, 300);
    const boardEl = ref<HTMLElement | null>(board.el);
    const regionEl = ref<HTMLElement | null>(fakeRegion(800, 600));
    const dockHeight = ref(0);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl, dockHeight });
    await nextTick();
    const observer = FakeResizeObserver.instances[0]!;

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
    const regionEl = ref<HTMLElement | null>(fakeRegion(800, 700));
    const dockHeight = ref(100);
    const { api, wrapper } = mountAutoZoom({ boardEl, regionEl, dockHeight });
    await nextTick();

    api.setZoom(0.6);
    api.fitZoom();
    expect(api.zoomLevel.value).toBe(2.0);
    wrapper.unmount();
  });
});
