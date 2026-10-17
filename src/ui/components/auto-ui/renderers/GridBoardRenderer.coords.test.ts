// @vitest-environment jsdom
/**
 * #891: the grid board places, sizes, names and navigates cells by the
 * coordinates the board declares ($rowCoord/$colCoord), never by tree order.
 */

import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import GridBoardRenderer from './GridBoardRenderer.vue';
import { mountBoardRenderer, type GameElement } from './board-renderer-a11y.test-helper.js';
import { createBoardInteraction } from '../../../composables/useBoardInteraction.js';

type Coord = [row: number, col: number];

function board(coords: Coord[], named = true): GameElement {
  return {
    id: 1,
    className: 'Board',
    name: 'board',
    attributes: { $layout: 'grid', $rowCoord: 'rank', $colCoord: 'file' },
    children: coords.map(([rank, file], i) => ({
      id: 100 + i,
      className: 'Square',
      ...(named ? { name: `${file},${rank}` } : {}),
      attributes: { rank, file },
      children: [],
    })),
  };
}

const mount = (element: GameElement) =>
  mountBoardRenderer(GridBoardRenderer, element, createBoardInteraction()).wrapper;

function placement(wrapper: ReturnType<typeof mount>, name: string) {
  const el = wrapper.find(`[title="${name}"]`).element as HTMLElement;
  return [Number(el.style.gridRow), Number(el.style.gridColumn)];
}

function cursorName(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('[role="gridcell"]').find((c) => c.attributes('tabindex') === '0')?.attributes('title');
}

async function press(wrapper: ReturnType<typeof mount>, key: string) {
  await wrapper.find('[role="grid"]').trigger('keydown', { key });
  await nextTick();
}

const chess: Coord[] = [];
for (let rank = 1; rank <= 8; rank++) for (let file = 1; file <= 8; file++) chess.push([rank, file]);

const byColumn: Coord[] = [];
for (let file = 0; file < 3; file++) for (let rank = 0; rank < 2; rank++) byColumn.push([rank, file]);

describe('GridBoardRenderer places cells by their coordinates (#891)', () => {
  it('draws the documented chess board (ranks and files 1-8) as 8x8', () => {
    const wrapper = mount(board(chess));
    expect(wrapper.find('[role="grid"]').attributes('aria-label')).toBe('Game board, 8 by 8');
    expect(placement(wrapper, '2,1')).toEqual([1, 2]);
    expect(placement(wrapper, '8,8')).toEqual([8, 8]);
  });

  it('places a board created column by column', () => {
    const wrapper = mount(board(byColumn));
    expect(placement(wrapper, '1,0')).toEqual([1, 2]);
    expect(placement(wrapper, '0,1')).toEqual([2, 1]);
    expect(placement(wrapper, '2,1')).toEqual([2, 3]);
  });

  it('places a board with gaps', () => {
    const wrapper = mount(board([[0, 0], [0, 2], [2, 0], [2, 2]]));
    expect(wrapper.find('[role="grid"]').attributes('aria-label')).toBe('Game board, 3 by 3');
    expect(placement(wrapper, '2,0')).toEqual([1, 3]);
    expect(placement(wrapper, '0,2')).toEqual([3, 1]);
  });

  it('names unnamed cells from their coordinates', () => {
    const wrapper = mount(board([[1, 2], [1, 1]], false));
    const labels = wrapper.findAll('[role="gridcell"]').map((c) => c.attributes('aria-label'));
    expect(labels[0]).toMatch(/^b1,/);
    expect(labels[1]).toMatch(/^a1,/);
  });
});

describe('GridBoardRenderer keyboard cursor moves by coordinates (#891)', () => {
  it('ArrowRight and ArrowDown on a board created column by column', async () => {
    const wrapper = mount(board(byColumn));
    expect(cursorName(wrapper)).toBe('0,0');
    await press(wrapper, 'ArrowRight');
    expect(cursorName(wrapper)).toBe('1,0');
    await press(wrapper, 'ArrowDown');
    expect(cursorName(wrapper)).toBe('1,1');
    await press(wrapper, 'End');
    expect(cursorName(wrapper)).toBe('2,1');
    await press(wrapper, 'Home');
    expect(cursorName(wrapper)).toBe('0,1');
    await press(wrapper, 'ArrowUp');
    expect(cursorName(wrapper)).toBe('0,0');
    await press(wrapper, 'ArrowLeft');
    expect(cursorName(wrapper)).toBe('0,0');
  });

  it('steps over gaps to the next cell in the same row or column', async () => {
    const wrapper = mount(board([[0, 0], [2, 0], [0, 2], [2, 2]]));
    await press(wrapper, 'ArrowRight');
    expect(cursorName(wrapper)).toBe('2,0');
    await press(wrapper, 'ArrowDown');
    expect(cursorName(wrapper)).toBe('2,2');
    await press(wrapper, 'ArrowDown');
    expect(cursorName(wrapper)).toBe('2,2');
  });
});
