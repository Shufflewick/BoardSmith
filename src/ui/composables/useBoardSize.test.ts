// @vitest-environment jsdom
/**
 * useBoardSize — pin a content-flow board to the visible board-region width.
 *
 * Behaviors under test:
 *   BS-1: measures the nearest .boardregion ancestor's client width minus its
 *         horizontal padding into availWidth/boardStyle.
 *   BS-2: boardStyle is empty until a measurement succeeds (no width-0 flash),
 *         and falls back to the parent element when no .boardregion exists
 *         (e.g. unit-test harnesses / non-GameShell hosts).
 *   BS-3: re-measures when the region resizes (ResizeObserver) and on window
 *         resize.
 *   BS-4: wires up per board element — a late-mounting or remounting board
 *         (v-if / new game) still gets measured — and tears down observers
 *         on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useBoardSize } from './useBoardSize';

/** A fake .boardregion with the layout jsdom doesn't compute. */
function fakeRegion(clientWidth: number, padding = 0): HTMLElement {
  const el = document.createElement('main');
  el.className = 'boardregion';
  el.style.paddingLeft = `${padding}px`;
  el.style.paddingRight = `${padding}px`;
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
  return el;
}

/** Board element nested under a region the way GameShell nests the slot
 *  (region > zoom container > board root). */
function boardInRegion(region: HTMLElement): HTMLElement {
  const zoomContainer = document.createElement('div');
  const board = document.createElement('div');
  zoomContainer.appendChild(board);
  region.appendChild(zoomContainer);
  document.body.appendChild(region);
  return board;
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(private callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) { this.observed.push(el); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
  fire() { if (!this.disconnected) this.callback(); }
}

function mountBoardSize(boardEl: Ref<HTMLElement | null>) {
  let api!: ReturnType<typeof useBoardSize>;
  const wrapper = mount(defineComponent({
    setup() {
      api = useBoardSize(boardEl);
      return () => h('div');
    },
  }));
  return { api, wrapper };
}

describe('useBoardSize', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('BS-1: pins to the region client width minus horizontal padding', async () => {
    const board = boardInRegion(fakeRegion(800, 24));
    const boardEl = ref<HTMLElement | null>(board);
    const { api, wrapper } = mountBoardSize(boardEl);
    await nextTick(); // flush: 'post' watcher measures

    expect(api.availWidth.value).toBe(800 - 48);
    expect(api.boardStyle.value).toEqual({ width: '752px' });
    wrapper.unmount();
  });

  it('BS-2: boardStyle stays empty until measured; falls back to parent without a region', async () => {
    const boardEl = ref<HTMLElement | null>(null);
    const { api, wrapper } = mountBoardSize(boardEl);
    await nextTick();
    expect(api.boardStyle.value).toEqual({}); // no element yet → no width-0 flash

    // No .boardregion ancestor: measure against the parent element instead.
    const parent = document.createElement('div');
    Object.defineProperty(parent, 'clientWidth', { value: 500 });
    const board = document.createElement('div');
    parent.appendChild(board);
    document.body.appendChild(parent);
    boardEl.value = board;
    await nextTick();

    expect(api.availWidth.value).toBe(500);
    wrapper.unmount();
  });

  it('BS-3: re-measures on region resize and window resize', async () => {
    const region = fakeRegion(800);
    const board = boardInRegion(region);
    const boardEl = ref<HTMLElement | null>(board);
    const { api, wrapper } = mountBoardSize(boardEl);
    await nextTick();
    expect(api.availWidth.value).toBe(800);

    const observer = FakeResizeObserver.instances[0]!;
    expect(observer.observed).toContain(region);

    Object.defineProperty(region, 'clientWidth', { value: 600, configurable: true });
    observer.fire();
    expect(api.availWidth.value).toBe(600);

    Object.defineProperty(region, 'clientWidth', { value: 1024, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(api.availWidth.value).toBe(1024);
    wrapper.unmount();
  });

  it('BS-4: rewires on board remount and tears down on unmount', async () => {
    const regionA = fakeRegion(800);
    const boardA = boardInRegion(regionA);
    const boardEl = ref<HTMLElement | null>(boardA);
    const { api, wrapper } = mountBoardSize(boardEl);
    await nextTick();
    const observerA = FakeResizeObserver.instances[0]!;

    // New game → new board element under a fresh region.
    const regionB = fakeRegion(640);
    const boardB = boardInRegion(regionB);
    boardEl.value = boardB;
    await nextTick();

    expect(observerA.disconnected).toBe(true); // old observer torn down
    expect(api.availWidth.value).toBe(640);
    const observerB = FakeResizeObserver.instances[1]!;
    expect(observerB.observed).toContain(regionB);

    // Unmount: observer disconnected and the window listener removed.
    wrapper.unmount();
    expect(observerB.disconnected).toBe(true);
    Object.defineProperty(regionB, 'clientWidth', { value: 100, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(api.availWidth.value).toBe(640); // unchanged — listener is gone
  });
});
