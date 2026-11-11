// @vitest-environment jsdom
/**
 * The board zoom is a magnifier the player sets, never a fit (#1608).
 *
 * The board renders at 100% and reflows to the region's width; the zoom only
 * magnifies it, from 100% to 200%, and the board below the shell reads it
 * through `useBoardSize()`.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref } from 'vue';
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
      shell = useBoardZoom();
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
