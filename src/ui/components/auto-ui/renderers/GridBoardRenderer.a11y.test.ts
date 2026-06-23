// @vitest-environment jsdom
/**
 * GridBoardRenderer a11y test (A11Y-01)
 *
 * Automated regression surface for grid board keyboard operability.
 * Asserts:
 *  - role="grid" on container with aria-label "Game board, N by M"
 *  - role="gridcell" on each cell with per-cell aria-label
 *  - Exactly one cell has tabindex="0" (roving tabindex); others have "-1"
 *  - ArrowRight keydown on the grid advances the roving tab stop
 *  - Enter on a selectable cell calls triggerElementSelect once
 */

import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import GridBoardRenderer from './GridBoardRenderer.vue';
import {
  createBoardInteraction,
  provideBoardInteraction,
} from '../../../composables/useBoardInteraction.js';

// ---------------------------------------------------------------------------
// Local GameElement interface — mirrors GridBoardRenderer
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
}

/**
 * Build a cols×rows grid board element with full child cells.
 * Cell IDs start at 100 to avoid collision with board id=1.
 * resolveGridSize uses $rowCoord/$colCoord to find max row/col → {rows, cols}.
 */
function buildGridElement(cols: number, rows: number): GameElement {
  const cells: GameElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        id: r * cols + c + 100,
        className: 'Space',
        name: String.fromCharCode(97 + c) + (r + 1),
        attributes: { row: r, col: c },
        children: [],
      });
    }
  }
  return {
    id: 1,
    className: 'Board',
    name: 'TestBoard',
    attributes: { $layout: 'grid', $rowCoord: 'row', $colCoord: 'col' },
    children: cells,
  };
}

/**
 * Mount GridBoardRenderer inside a wrapper that provides boardInteraction.
 * tryUseBoardInteraction() uses inject(BOARD_INTERACTION_KEY) which is a
 * non-exported Symbol — provideBoardInteraction() is the canonical way to
 * wire it via component setup().
 */
function mountGrid(element: GameElement, interaction = createBoardInteraction()) {
  const Wrapper = defineComponent({
    components: { GridBoardRenderer },
    setup() {
      provideBoardInteraction(interaction);
    },
    template: '<GridBoardRenderer :element="element" :depth="0" />',
    props: { element: { type: Object, required: true } },
  });
  return {
    wrapper: mount(Wrapper, { props: { element } }),
    interaction,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GridBoardRenderer a11y — role=grid/gridcell + roving tabindex', () => {
  it('renders a role="grid" container', () => {
    const { wrapper } = mountGrid(buildGridElement(4, 2));
    expect(wrapper.find('[role="grid"]').exists()).toBe(true);
  });

  it('aria-label on grid reads "Game board, COLS by ROWS"', () => {
    const { wrapper } = mountGrid(buildGridElement(4, 2));
    const grid = wrapper.find('[role="grid"]');
    expect(grid.attributes('aria-label')).toBe('Game board, 4 by 2');
  });

  it('each cell has role="gridcell"', () => {
    const { wrapper } = mountGrid(buildGridElement(3, 3));
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells.length).toBe(9);
  });

  it('each cell has a non-empty aria-label', () => {
    const { wrapper } = mountGrid(buildGridElement(2, 2));
    const cells = wrapper.findAll('[role="gridcell"]');
    for (const cell of cells) {
      const label = cell.attributes('aria-label') ?? '';
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('exactly one cell has tabindex="0" initially', () => {
    const { wrapper } = mountGrid(buildGridElement(3, 3));
    const cells = wrapper.findAll('[role="gridcell"]');
    const zeros = cells.filter(c => c.attributes('tabindex') === '0');
    expect(zeros.length).toBe(1);
  });

  it('all other cells have tabindex="-1" initially', () => {
    const { wrapper } = mountGrid(buildGridElement(3, 3));
    const cells = wrapper.findAll('[role="gridcell"]');
    const negatives = cells.filter(c => c.attributes('tabindex') === '-1');
    expect(negatives.length).toBe(8); // 9 total - 1 with tabindex=0
  });

  it('ArrowRight on the grid moves tabindex="0" from cell 0 to cell 1', async () => {
    const { wrapper } = mountGrid(buildGridElement(3, 2));
    const grid = wrapper.find('[role="grid"]');
    await grid.trigger('keydown', { key: 'ArrowRight' });
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[0].attributes('tabindex')).toBe('-1');
    expect(cells[1].attributes('tabindex')).toBe('0');
  });

  it('Enter on a selectable cell calls triggerElementSelect once', async () => {
    const element = buildGridElement(2, 2);
    const interaction = createBoardInteraction();
    const selectSpy = vi.fn();
    // Cell id=100 is the first cell (r=0, c=0) — make it selectable
    interaction.setValidElements([{ id: 100, ref: { id: 100 } }], selectSpy);
    const { wrapper } = mountGrid(element, interaction);

    const grid = wrapper.find('[role="grid"]');
    await grid.trigger('keydown', { key: 'Enter' });

    // triggerElementSelect -> onElementSelect(100) -> selectSpy(100)
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy).toHaveBeenCalledWith(100);
  });
});
