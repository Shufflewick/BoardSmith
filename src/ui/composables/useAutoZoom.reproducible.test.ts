// @vitest-environment jsdom
/**
 * #13: the fitted zoom is a pure function of the region box and the board's
 * natural size — the Action Panel cannot influence it, at any size, at any time.
 *
 * Bug: `measureAndFit` subtracted the Action Panel's MEASURED height, frozen at
 * whatever it happened to be when the board had held still for SETTLE_MS. The
 * panel re-wraps on every selection step, so it has no single value: which
 * sample got frozen depended on where the 300ms window landed relative to
 * session content arriving over the socket. Five reloads of one state fitted at
 * 0.83 / 0.98 / 0.90 / 0.83.
 *
 * Fix: the panel's footprint is a CONSTANT reserved in CSS as `.boardregion`'s
 * padding-bottom (`--bsg-panel-reserved`), and nothing measures the panel.
 *
 * This file drives the real `useAutoZoom` through a harness with GameShell's
 * actual shape — a `.boardregion` carrying the reserved padding, a zoom
 * container inside it, and a REAL `.actionbar` sibling element whose height
 * changes with its button count. The panel is present and changing throughout;
 * the point is that the zoom never notices.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useAutoZoom, SETTLE_MS } from './useAutoZoom';

/** The 375x812 phone from the B20 report. */
const REGION = { width: 375, height: 765 };
const BOARD = { width: 367, height: 736 };
/** `--bsg-panel-reserved` at the base tier: 2*44 + 8 + 2*9. */
const PANEL_RESERVED = 114;
/** One wrapped row of the Action Panel. */
const PANEL_ROW = 52;

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) { FakeResizeObserver.instances.push(this); }
  observe(el: Element) { this.observed.push(el); this.callback(); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
}
function fireAll(el: Element): void {
  for (const o of FakeResizeObserver.instances) {
    if (!o.disconnected && o.observed.includes(el)) o.callback();
  }
}

let rafQueue: Array<() => void> = [];
let rafScheduled = 0;
function flushRaf() {
  const fns = rafQueue;
  rafQueue = [];
  fns.forEach((fn) => fn());
}

/**
 * GameShell's shape: `.boardregion` (reserved padding) > `.game-shell__zoom-container`,
 * with `.actionbar` as an out-of-flow sibling. `buttonRows` drives the panel's
 * real element height, exactly as a selection step with more choices would.
 */
function mountShell() {
  let api!: ReturnType<typeof useAutoZoom>;
  const buttonRows = ref(1);
  const boardHeight = ref(0); // 0x0 until session state arrives
  const wrapper = mount(defineComponent({
    setup() {
      const boardregionEl = ref<HTMLElement | null>(null);
      const zoomContainerEl = ref<HTMLElement | null>(null);
      api = useAutoZoom({ boardEl: zoomContainerEl, regionEl: boardregionEl });
      return () => h('div', { class: 'game-shell__game' }, [
        h('main', { class: 'boardregion', ref: boardregionEl }, [
          h('div', { class: 'game-shell__zoom-container', ref: zoomContainerEl }),
        ]),
        h('div', { class: 'actionbar' },
          Array.from({ length: buttonRows.value }, (_, i) => h('button', {}, `choice ${i}`))),
      ]);
    },
  }), { attachTo: document.body });

  const region = wrapper.find('main.boardregion').element as HTMLElement;
  const zoom = wrapper.find('.game-shell__zoom-container').element as HTMLElement;
  const actionbar = wrapper.find('.actionbar').element as HTMLElement;

  // Layout jsdom does not compute. The region's padding-bottom is the panel's
  // constant reserved footprint — the only channel the panel has into the fit.
  region.style.paddingBottom = `${PANEL_RESERVED}px`;
  Object.defineProperty(region, 'clientWidth', { get: () => REGION.width, configurable: true });
  Object.defineProperty(region, 'clientHeight', { get: () => REGION.height, configurable: true });
  zoom.getBoundingClientRect = () =>
    ({ width: BOARD.width, height: boardHeight.value } as DOMRect);
  // The real panel really does grow with its content.
  actionbar.getBoundingClientRect = () =>
    ({ width: REGION.width, height: buttonRows.value * PANEL_ROW } as DOMRect);

  return { api, wrapper, region, zoom, actionbar, buttonRows, boardHeight };
}

/** Session state arrives: the board takes its natural size and the fit settles. */
async function boardArrives(shell: ReturnType<typeof mountShell>) {
  shell.boardHeight.value = BOARD.height;
  fireAll(shell.zoom);
  flushRaf();
  await nextTick();
  vi.advanceTimersByTime(SETTLE_MS);
}

/** A selection step re-wraps the panel: its element really resizes. */
async function panelGrowsTo(shell: ReturnType<typeof mountShell>, rows: number) {
  shell.buttonRows.value = rows;
  await nextTick();
  fireAll(shell.actionbar); // no-op unless something observes the panel
  flushRaf();
  await nextTick();
}

describe('#13: the fitted zoom is reproducible — the Action Panel cannot reach it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeResizeObserver.instances = [];
    rafQueue = [];
    rafScheduled = 0;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafScheduled += 1;
      rafQueue.push(() => cb(0));
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('fits identically with 1 button and with 20 buttons in the panel', async () => {
    const zooms: number[] = [];
    for (const rows of [1, 20]) {
      const shell = mountShell();
      await nextTick();
      await panelGrowsTo(shell, rows);
      await boardArrives(shell);
      // The panel really is a different size in the two runs.
      expect(shell.actionbar.getBoundingClientRect().height).toBe(rows * PANEL_ROW);
      zooms.push(shell.api.zoomLevel.value);
      shell.wrapper.unmount();
    }
    expect(zooms[0]).toBe(zooms[1]);
    // And it is the value the region box alone dictates.
    expect(zooms[0]).toBeCloseTo((REGION.height - PANEL_RESERVED) / BOARD.height, 10);
  });

  it('fits identically whether the panel grows before or after the board settles', async () => {
    const before = mountShell();
    await nextTick();
    await panelGrowsTo(before, 8);
    await boardArrives(before);

    const after = mountShell();
    await nextTick();
    await boardArrives(after);
    await panelGrowsTo(after, 8);

    expect(before.api.zoomLevel.value).toBe(after.api.zoomLevel.value);
    before.wrapper.unmount();
    after.wrapper.unmount();
  });

  it('fits identically across five reloads of the same state with different panel timing', async () => {
    // Each "reload" races the panel against the settle window differently —
    // exactly the non-determinism the old freeze sampled.
    const schedules: Array<(s: ReturnType<typeof mountShell>) => Promise<void>> = [
      async (s) => { await boardArrives(s); },
      async (s) => { await panelGrowsTo(s, 3); await boardArrives(s); },
      async (s) => { await boardArrives(s); await panelGrowsTo(s, 5); },
      async (s) => {
        await panelGrowsTo(s, 2);
        s.boardHeight.value = BOARD.height;
        fireAll(s.zoom);
        flushRaf();
        vi.advanceTimersByTime(SETTLE_MS / 2);
        await panelGrowsTo(s, 12);
        vi.advanceTimersByTime(SETTLE_MS);
      },
      async (s) => {
        await panelGrowsTo(s, 20);
        await boardArrives(s);
        await panelGrowsTo(s, 1);
      },
    ];

    const zooms: number[] = [];
    for (const drive of schedules) {
      const shell = mountShell();
      await nextTick();
      await drive(shell);
      zooms.push(shell.api.zoomLevel.value);
      shell.wrapper.unmount();
    }

    expect(new Set(zooms).size).toBe(1);
    expect(zooms[0]).toBeCloseTo((REGION.height - PANEL_RESERVED) / BOARD.height, 10);
  });

  it('ZOOM-02 tripwire: panel growth/shrink mid-game moves nothing and schedules no re-fit', async () => {
    const shell = mountShell();
    await nextTick();
    await boardArrives(shell);
    const settled = shell.api.zoomLevel.value;

    const framesBefore = rafScheduled;
    for (const rows of [4, 1, 12, 3, 20, 1]) {
      await panelGrowsTo(shell, rows);
      expect(shell.api.zoomLevel.value).toBe(settled);
    }
    // Not merely "the value came back the same" — no work was even scheduled.
    expect(rafScheduled).toBe(framesBefore);
    shell.wrapper.unmount();
  });

  it('the options type admits no panel input at all (compile-level purity)', () => {
    const boardEl = ref<HTMLElement | null>(null);
    const regionEl = ref<HTMLElement | null>(null);
    mount(defineComponent({
      setup() {
        useAutoZoom({
          boardEl,
          regionEl,
          // @ts-expect-error — the fit CANNOT read the Action Panel: there is no
          // option to hand it one. If this line ever stops erroring, the panel
          // has a channel into the fit again and #13 has regressed.
          actionPanelHeight: ref(120),
        });
        return () => h('div');
      },
    })).unmount();
  });
});
