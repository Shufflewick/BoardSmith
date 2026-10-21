// @vitest-environment jsdom
/**
 * useBoardSize — pin a content-flow board to the visible board-region width.
 *
 * Behaviors under test:
 *   BS-1: measures the nearest .boardregion ancestor's content width into
 *         availWidth/boardStyle, and caps the pin at the region's own width so
 *         a stale pin cannot overflow it (#1336). The width is the one the
 *         region has with its vertical scrollbar showing, whether or not it
 *         shows, so the scrollbar coming or going never moves the pin (#1343),
 *         and the cap takes off a scrollbar 100cqw leaves out (#1353).
 *   BS-2: boardStyle is empty until a measurement succeeds (no width-0 flash),
 *         and falls back to the parent element when no .boardregion exists
 *         (e.g. unit-test harnesses / non-GameShell hosts).
 *   BS-3: re-measures when the region resizes (ResizeObserver) and on window
 *         resize.
 *   BS-4: wires up per board element — a late-mounting or remounting board
 *         (v-if / new game) still gets measured — and tears down observers
 *         on unmount.
 *   BS-5: zoom is 1 outside a GameShell (the shell case is tested in
 *         useAutoZoom.pinned-board.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useBoardSize } from './useBoardSize';

/** A fake .boardregion whose content box is `width` wide. */
function fakeRegion(width: number): HTMLElement {
  const el = document.createElement('main');
  el.className = 'boardregion';
  el.style.width = `${width}px`;
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
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('BS-1: pins to the region content width', async () => {
    const board = boardInRegion(fakeRegion(752.5));
    const boardEl = ref<HTMLElement | null>(board);
    const { api, wrapper } = mountBoardSize(boardEl);
    await nextTick(); // flush: 'post' watcher measures

    expect(api.availWidth.value).toBe(752.5);
    // 100cqw is the region's content box at layout time, so a pin measured
    // before the region narrowed never runs past it (#1336).
    expect(api.boardStyle.value).toEqual({ width: 'min(752.5px, 100cqw)' });
    wrapper.unmount();
  });

  it('BS-1: pins to the width the region has with its vertical scrollbar showing, and leaves its overflow as it was (#1343)', async () => {
    const region = fakeRegion(752);
    region.style.overflowY = 'auto';
    const realStyle = window.getComputedStyle.bind(window);
    // jsdom has no scrollbar: a 15px one shows while overflow-y is scroll.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => el === region
      ? ({ width: region.style.overflowY === 'scroll' ? '737px' : '752px' } as CSSStyleDeclaration)
      : realStyle(el));
    const { api, wrapper } = mountBoardSize(ref(boardInRegion(region)));
    await nextTick();

    expect(api.availWidth.value).toBe(737);
    expect(region.style.overflowY).toBe('auto');
    wrapper.unmount();
  });

  it('BS-1: where 100cqw leaves out a scrollbar the region reserves no gutter for, the cap takes it off (#1353)', async () => {
    const region = fakeRegion(752);
    const realStyle = window.getComputedStyle.bind(window);
    // Chromium and WebKit resolve 100cqw to the region's width as if its 15px scrollbar were not there.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      if (el === region) return { width: region.style.overflowY === 'scroll' ? '737px' : '752px' } as CSSStyleDeclaration;
      if ((el as HTMLElement).style.width === '100cqw') return { width: '752px' } as CSSStyleDeclaration;
      return realStyle(el);
    });
    const { api, wrapper } = mountBoardSize(ref(boardInRegion(region)));
    await nextTick();

    expect(api.boardStyle.value).toEqual({ width: 'min(737px, calc(100cqw - 15px))' });
    expect(region.children).toHaveLength(1);
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
    // No .boardregion, so no container for cqw to resolve against.
    expect(api.boardStyle.value).toEqual({ width: '500px' });
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

    region.style.width = '600px';
    observer.fire();
    expect(api.availWidth.value).toBe(600);

    region.style.width = '1024px';
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
    regionB.style.width = '100px';
    window.dispatchEvent(new Event('resize'));
    expect(api.availWidth.value).toBe(640); // unchanged — listener is gone
  });

  it('BS-5: zoom is 1 outside a GameShell, where nothing zooms the board (#1332)', async () => {
    const { api, wrapper } = mountBoardSize(ref(boardInRegion(fakeRegion(800))));
    await nextTick();
    expect(api.zoom.value).toBe(1);
    wrapper.unmount();
  });

  it('cancels the pending first-frame measure on unmount (#868)', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 7);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const { wrapper } = mountBoardSize(ref(boardInRegion(fakeRegion(800))));
    await nextTick();

    wrapper.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });
});
