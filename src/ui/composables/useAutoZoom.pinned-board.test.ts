// @vitest-environment jsdom
/**
 * B20: a `useBoardSize()`-pinned board is fitted on WIDTH ONLY.
 *
 * Bug: `useBoardSize()` pins a content-flow board to the board region's width
 * so that wrapping works and growth is vertical-scroll only — that is the
 * documented model, and `useBoardSize.ts` used to record the collision with
 * auto-zoom as known and unfixed. Meanwhile `useAutoZoom` fitted EVERY board
 * on both axes, so the moment such a board's content ran taller than the
 * region it was also scaled down to avoid the scrollbar it had opted into.
 * `zoom` scales the layout box, so every glyph shipped below its declared
 * size (`--bsg-text-xs` painting at 10–11.6px instead of 12px) — precisely the
 * failure the pin exists to prevent.
 *
 * The defect lives in the SEAM between two composables that never talked, so
 * this file drives both of them together across the real shell↔board component
 * boundary — a shell component that calls `useAutoZoom` exactly as GameShell
 * does, rendering a child board component that calls `useBoardSize` exactly as
 * docs/custom-ui-guide.md tells a game to. Asserting `computeFitZoom`'s
 * arithmetic alone (see useAutoZoom.test.ts, AZ-1) would not prove the pin
 * ever reaches the fit.
 *
 * Behaviors under test:
 *   B20-1: a pinned board taller than the region ends at zoom 1 — not shrunk.
 *   B20-2: an UNPINNED board of the identical dimensions is still fitted on
 *          both axes and lands below 1. (The distinction, not just the branch.)
 *   B20-3: a pinned board is still WIDTH-fit — genuine horizontal overflow
 *          scales down, which also proves the pinned path is measuring at all.
 *   B20-4: the pin is scoped to the board's lifetime — unmounting the pinned
 *          board restores both-axis fitting for whatever mounts next.
 *   B20-5: GameShell hands `useAutoZoom` no pin/axis wiring of its own — a
 *          game states the model once, by calling `useBoardSize()`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, shallowRef, nextTick, type Component } from 'vue';
import { mount } from '@vue/test-utils';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useAutoZoom, ZOOM_MIN } from './useAutoZoom';
import { useBoardSize } from './useBoardSize';

/** The measured mobile case from the B20 report: a 375×812 viewport, a
 *  375×765 board region, and a board whose printed text cannot be truncated
 *  running 736px tall — taller than the region minus the Action Panel. */
const REGION = { width: 375, height: 765 };
const NATURAL = { width: 367, height: 736 };
/** The Action Panel's CONSTANT reserved footprint, which GameShell applies as
 *  `.boardregion`'s padding-bottom (`--bsg-panel-reserved`). Nothing measures the
 *  panel; the fit only ever sees region padding. */
const PANEL_RESERVED = 100;

/** Every live observer watching `el` — a real resize notifies all of them, and
 *  the region is watched by BOTH composables. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
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
function flushRaf() {
  const fns = rafQueue;
  rafQueue = [];
  fns.forEach((fn) => fn());
}

/** A board that opts into the region pin, exactly as the guide documents. */
const PinnedBoard = defineComponent({
  name: 'PinnedBoard',
  setup() {
    const boardRef = ref<HTMLElement | null>(null);
    const { boardStyle } = useBoardSize(boardRef);
    return () => h('div', { ref: boardRef, class: 'my-board', style: boardStyle.value });
  },
});

/** The same board WITHOUT the pin — a fixed-intrinsic board. */
const PlainBoard = defineComponent({
  name: 'PlainBoard',
  setup: () => () => h('div', { class: 'my-board' }),
});

/** A shell that calls useAutoZoom with GameShell's exact options and renders
 *  the board as a child component inside `.boardregion > .zoom-container`. */
function mountShell(board: Component | null) {
  let api!: ReturnType<typeof useAutoZoom>;
  const current = shallowRef<Component | null>(board);
  const wrapper = mount(defineComponent({
    setup() {
      const boardregionEl = ref<HTMLElement | null>(null);
      const zoomContainerEl = ref<HTMLElement | null>(null);
      api = useAutoZoom({ boardEl: zoomContainerEl, regionEl: boardregionEl });
      return () => h('main', { class: 'boardregion', ref: boardregionEl }, [
        h('div', { class: 'zoom-container', ref: zoomContainerEl },
          current.value ? [h(current.value)] : []),
      ]);
    },
  }), { attachTo: document.body });
  return { api, wrapper, current };
}

/**
 * Apply the layout jsdom does not compute. The zoom container is
 * `width: max-content`, so its rect is its child's width — the pinned width
 * when the board has one, its natural width otherwise.
 */
function layOut(wrapper: ReturnType<typeof mountShell>['wrapper'], minContentWidth = 0) {
  const region = wrapper.find('main.boardregion').element as HTMLElement;
  const zoom = wrapper.find('.zoom-container').element as HTMLElement;
  region.style.paddingBottom = `${PANEL_RESERVED}px`;
  Object.defineProperty(region, 'clientWidth', { get: () => REGION.width, configurable: true });
  Object.defineProperty(region, 'clientHeight', { get: () => REGION.height, configurable: true });
  zoom.getBoundingClientRect = () => {
    const boardRoot = zoom.firstElementChild as HTMLElement | null;
    const pinned = boardRoot ? parseFloat(boardRoot.style.width) : NaN;
    const width = Math.max(Number.isFinite(pinned) ? pinned : NATURAL.width, minContentWidth);
    return { width, height: NATURAL.height } as DOMRect;
  };
  return { region, zoom };
}

/** Drive the layout the way a browser does: the region lays out (both
 *  composables measure it), the board takes its pinned width, then the zoom
 *  container's new size reaches the startup fit. */
async function settle(wrapper: ReturnType<typeof mountShell>['wrapper'], minContentWidth = 0) {
  const { region, zoom } = layOut(wrapper, minContentWidth);
  fireAll(region);
  await nextTick();
  fireAll(zoom);
  flushRaf();
  await nextTick();
  return { region, zoom };
}

describe('B20: useBoardSize pins the board; useAutoZoom stops height-fitting it', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    rafQueue = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(() => cb(0));
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('B20-1: a pinned board taller than the region stays at zoom 1', async () => {
    const shell = mountShell(PinnedBoard);
    const { zoom } = await settle(shell.wrapper);

    // The pin took: the board is the region's width, and the board is really
    // taller than the space the both-axis fit would have measured against.
    expect(zoom.getBoundingClientRect().width).toBe(REGION.width);
    expect(NATURAL.height).toBeGreaterThan(REGION.height - PANEL_RESERVED);

    expect(shell.api.zoomLevel.value).toBe(1);
    shell.wrapper.unmount();
  });

  it('B20-2: an UNPINNED board of the same size is still fitted on both axes', async () => {
    const shell = mountShell(PlainBoard);
    await settle(shell.wrapper);

    // min(375/367, (765-100)/736) = height constrains.
    const expected = (REGION.height - PANEL_RESERVED) / NATURAL.height;
    expect(shell.api.zoomLevel.value).toBeCloseTo(expected, 5);
    expect(shell.api.zoomLevel.value).toBeLessThan(1);
    shell.wrapper.unmount();
  });

  it('B20-3: a pinned board is still WIDTH-fit when content genuinely overflows sideways', async () => {
    const shell = mountShell(PinnedBoard);
    // An unwrappable 750px-wide element inside the pinned board.
    await settle(shell.wrapper, 750);

    expect(shell.api.zoomLevel.value).toBe(ZOOM_MIN); // 375/750 = 0.5
    shell.wrapper.unmount();
  });

  it('B20-4: the pin lives only as long as the pinned board', async () => {
    const shell = mountShell(PinnedBoard);
    await settle(shell.wrapper);
    expect(shell.api.zoomLevel.value).toBe(1);

    // New game, fixed-intrinsic board this time: the pin is gone and the
    // height term applies again.
    shell.current.value = PlainBoard;
    await nextTick();
    shell.api.fitZoom(); // "Fit" — re-measures the new board
    await settle(shell.wrapper);

    expect(shell.api.zoomLevel.value).toBeCloseTo((REGION.height - PANEL_RESERVED) / NATURAL.height, 5);
    shell.wrapper.unmount();
  });
});

describe('B20-5: the game wires nothing — GameShell states no axis of its own', () => {
  const gameShellSource = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'GameShell.vue'),
    'utf-8',
  );

  it('passes useAutoZoom only the two geometry options', () => {
    const start = gameShellSource.indexOf('useAutoZoom({');
    expect(start).toBeGreaterThan(-1);
    const call = gameShellSource.slice(start, gameShellSource.indexOf('});', start));
    expect(call).toContain('boardEl: zoomContainerEl');
    expect(call).toContain('regionEl: boardregionEl');
    // No axis/pin flag for a game (or the shell) to get wrong: the pin is the
    // single statement of intent, carried by useBoardSize itself.
    expect(call).not.toMatch(/fitAxis|pinned|boardRegionPin/);
    // And no Action Panel input at all (#13): the panel's footprint is a CSS
    // constant on `.boardregion`, so the fit reads region padding, never a panel.
    expect(call).not.toMatch(/[Pp]anel/);
  });
});
