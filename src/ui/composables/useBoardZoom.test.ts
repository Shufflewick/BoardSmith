// @vitest-environment jsdom
/**
 * The board zoom is a magnifier the player sets, never a fit (#1608).
 *
 * The board renders at 100% and reflows to the region's width; the zoom only
 * magnifies it, from 100% to 200%, and the board below the shell reads it
 * through `useBoardSize()`.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useBoardZoom, ZOOM_MIN, ZOOM_MAX } from './useBoardZoom';
import { useBoardSize } from './useBoardSize';

function mountShellWithBoard() {
  let shell!: ReturnType<typeof useBoardZoom>;
  let board!: ReturnType<typeof useBoardSize>;
  const Board = defineComponent({
    setup() {
      board = useBoardSize(ref(null));
      return () => h('div');
    },
  });
  const Shell = defineComponent({
    setup() {
      shell = useBoardZoom({ regionEl: ref(null), boardEl: ref(null) });
      return () => h(Board);
    },
  });
  const wrapper = mount(Shell);
  return { shell, board, wrapper };
}

describe('useBoardZoom', () => {
  it('magnifies from 100% to 200%', () => {
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([1, 2]);
  });

  it('starts at 100%, the size the board reflows to', () => {
    const { shell, wrapper } = mountShellWithBoard();
    expect(shell.zoomLevel.value).toBe(1);
    wrapper.unmount();
  });

  it('keeps a zoom the player sets inside 100% to 200%, and resets to 100%', () => {
    const { shell, wrapper } = mountShellWithBoard();
    shell.setZoom(1.5);
    expect(shell.zoomLevel.value).toBe(1.5);
    shell.setZoom(0.5);
    expect(shell.zoomLevel.value).toBe(1);
    shell.setZoom(3);
    expect(shell.zoomLevel.value).toBe(2);
    shell.resetZoom();
    expect(shell.zoomLevel.value).toBe(1);
    wrapper.unmount();
  });

  it('tells a board that called useBoardSize() the zoom it is drawn at', () => {
    const { shell, board, wrapper } = mountShellWithBoard();
    shell.setZoom(1.5);
    expect(board.zoom.value).toBe(1.5);
    wrapper.unmount();
  });
});

/** A shell over a region holding a board with an empty square, a draggable (its own `touch-action`) and a range input, and an element outside the region. */
function mountPinchable() {
  const region = document.createElement('div');
  const board = document.createElement('div');
  const square = document.createElement('div');
  const draggable = document.createElement('div');
  draggable.style.touchAction = 'none';
  const onDraggable = draggable.appendChild(document.createElement('span'));
  const input = Object.assign(document.createElement('input'), { type: 'range' });
  const outside = document.createElement('div');
  board.append(square, draggable, input);
  region.append(board);
  document.body.append(region, outside);
  const scrolls: Array<[number, number]> = [];
  // jsdom has no Element.scrollTo; the region records where it was asked to scroll.
  region.scrollTo = ((left: number, top: number) => { scrolls.push([left, top]); }) as typeof region.scrollTo;
  let shell!: ReturnType<typeof useBoardZoom>;
  const wrapper = mount(defineComponent({
    setup() {
      shell = useBoardZoom({ regionEl: ref(region), boardEl: ref(board) });
      return () => h('div');
    },
  }));
  const done = () => {
    wrapper.unmount();
    region.remove();
    outside.remove();
  };
  return { shell, square, onDraggable, input, outside, scrolls, done };
}

function finger(type: string, target: Element, id: number, x: number, y: number, pointerType = 'touch') {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: id, isPrimary: id === 1, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y,
  }));
}

/** Whether a click on `target` reaches it. */
function clickReaches(target: Element): boolean {
  let reached = false;
  target.addEventListener('click', () => { reached = true; }, { once: true });
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return reached;
}

describe('pinching and panning the board region (#1609)', () => {
  it('magnifies by how far two fingers spread, keeping the board point between them under them', async () => {
    const { shell, square, scrolls, done } = mountPinchable();
    finger('pointerdown', square, 1, 90, 50);
    finger('pointerdown', square, 2, 110, 50);
    finger('pointermove', square, 2, 130, 50);
    await nextTick();
    expect(shell.zoomLevel.value).toBe(2);
    // The point at x 100 is at 200 now, and the fingers' centre is at 110.
    expect(scrolls.at(-1)).toEqual([90, 50]);
    done();
  });

  it('pans under one finger once it moves past the tap threshold, and swallows the click a pan ends in', async () => {
    const { shell, square, scrolls, done } = mountPinchable();
    finger('pointerdown', square, 1, 100, 100);
    finger('pointermove', square, 1, 97, 100);
    await nextTick();
    expect(scrolls).toEqual([]);
    finger('pointermove', square, 1, 70, 80);
    await nextTick();
    expect(scrolls.at(-1)).toEqual([30, 20]);
    expect(shell.zoomLevel.value).toBe(1);
    finger('pointerup', square, 1, 70, 80);
    expect(clickReaches(square)).toBe(false);
    done();
  });

  it('leaves a still press its click', () => {
    const { square, done } = mountPinchable();
    finger('pointerdown', square, 1, 100, 100);
    finger('pointerup', square, 1, 100, 100);
    expect(clickReaches(square)).toBe(true);
    done();
  });

  it('forgets a finger lifted outside the region, so the next finger pans rather than pinches', async () => {
    const { shell, square, outside, scrolls, done } = mountPinchable();
    finger('pointerdown', square, 1, 100, 100);
    finger('pointerup', outside, 1, 300, 100);
    finger('pointerdown', square, 2, 100, 100);
    finger('pointermove', square, 2, 70, 100);
    await nextTick();
    expect(shell.zoomLevel.value).toBe(1);
    expect(scrolls.at(-1)).toEqual([30, 0]);
    done();
  });

  it('leaves alone a press on an element that handles its own touch, and every finger while it is down', async () => {
    const { shell, square, onDraggable, input, scrolls, done } = mountPinchable();
    for (const own of [onDraggable, input]) {
      finger('pointerdown', own, 1, 100, 100);
      finger('pointerdown', square, 2, 120, 100);
      finger('pointermove', own, 1, 60, 100);
      finger('pointermove', square, 2, 160, 100);
      finger('pointerup', own, 1, 60, 100);
      finger('pointerup', square, 2, 160, 100);
    }
    await nextTick();
    expect(scrolls).toEqual([]);
    expect(shell.zoomLevel.value).toBe(1);
    done();
  });

  it('pans for a pen as for a finger, and never for a mouse, which has the scrollbars', async () => {
    const { square, scrolls, done } = mountPinchable();
    finger('pointerdown', square, 1, 100, 100, 'mouse');
    finger('pointermove', square, 1, 50, 100, 'mouse');
    finger('pointerup', square, 1, 50, 100, 'mouse');
    await nextTick();
    expect(scrolls).toEqual([]);
    finger('pointerdown', square, 1, 100, 100, 'pen');
    finger('pointermove', square, 1, 50, 100, 'pen');
    await nextTick();
    expect(scrolls.at(-1)).toEqual([50, 0]);
    done();
  });
});
