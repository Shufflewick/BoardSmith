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
import { defineComponent, nextTick } from 'vue';
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
    wrapper: mount(Wrapper, { props: { element }, attachTo: document.body }),
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

/**
 * #172 — the board is the only path into a board-anchored choice, so it has to
 * accept keyboard focus and park it on a cell the player can actually choose.
 */
describe('GridBoardRenderer candidate focus (#172)', () => {
  function gridWithCandidates(candidateIds: number[]) {
    const element = buildGridElement(4, 3);
    const interaction = createBoardInteraction();
    interaction.setValidElements(
      candidateIds.map((id) => ({ id, ref: { id } })),
      () => {},
    );
    return { ...mountGrid(element, interaction), element };
  }

  it('parks the roving tab stop on the first valid target, not on cell 0', async () => {
    // Candidates are cells 105 and 108 — indices 5 and 8 of a 4x3 grid.
    const { wrapper } = gridWithCandidates([105, 108]);
    await nextTick();

    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[0].attributes('tabindex')).toBe('-1');
    expect(cells[5].attributes('tabindex')).toBe('0');
  });

  it('moves DOM focus onto that cell when the panel hands the choice over', async () => {
    const { wrapper, interaction } = gridWithCandidates([105, 108]);
    await nextTick();

    interaction.requestBoardFocus();
    await nextTick();
    await nextTick();

    const cells = wrapper.findAll('[role="gridcell"]');
    expect(document.activeElement).toBe(cells[5].element);
  });

  it('leaves the tab stop alone when there is nothing to pick', async () => {
    const { wrapper } = gridWithCandidates([]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[0].attributes('tabindex')).toBe('0');
  });
});

/**
 * #190 — the roving cursor and real focus must never disagree.
 *
 * Reported against HexBoardRenderer, but the wiring is shared: the grid keydown
 * handler activates the cursor's cell, and the candidate cursor (#172) can move
 * without focus moving with it. So the same silent wrong move is reachable here.
 */
describe('GridBoardRenderer keyboard activation follows focus (#190)', () => {
  function pickableGrid(candidateIds: number[]) {
    const interaction = createBoardInteraction();
    const picked: number[] = [];
    interaction.setValidElements(
      candidateIds.map((id) => ({ id, ref: { id } })),
      (id) => picked.push(id),
    );
    return { ...mountGrid(buildGridElement(3, 2), interaction), picked };
  }

  it('Enter resolves the cell that holds focus, not the one the cursor parked on', async () => {
    const { wrapper, picked } = pickableGrid([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[2].attributes('tabindex')).toBe('0');

    (cells[4].element as HTMLElement).focus();
    await nextTick();
    await wrapper.find('[role="grid"]').trigger('keydown', { key: 'Enter' });

    expect(picked).toEqual([104]);
  });

  it('Enter resolves the cell it was delivered to even when no focus event ever fired', async () => {
    // Measured in Chrome: .focus() on a cell in a document that does not hold
    // system focus moves document.activeElement and fires neither focus nor
    // focusin. The key still arrives at that cell, and that is what must decide.
    const { wrapper, picked } = pickableGrid([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[2].attributes('tabindex')).toBe('0');

    await cells[4].trigger('keydown', { key: 'Enter' });

    expect(picked).toEqual([104]);
  });

  it('Space resolves the cell that holds focus too', async () => {
    const { wrapper, picked } = pickableGrid([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');

    (cells[4].element as HTMLElement).focus();
    await nextTick();
    await wrapper.find('[role="grid"]').trigger('keydown', { key: ' ' });

    expect(picked).toEqual([104]);
  });

  it('a re-offer does not drag the cursor off the cell the player has focused', async () => {
    const { wrapper, interaction, picked } = pickableGrid([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');

    (cells[5].element as HTMLElement).focus();
    await nextTick();
    expect(cells[5].attributes('tabindex')).toBe('0');

    interaction.setValidElements(
      [102, 104].map((id) => ({ id, ref: { id } })),
      (id) => picked.push(id),
    );
    await nextTick();

    expect(document.activeElement).toBe(cells[5].element);

    await wrapper.find('[role="grid"]').trigger('keydown', { key: 'Enter' });
    expect(picked).toEqual([]);
    expect(interaction.isSelected({ id: 105 })).toBe(true);
    expect(cells[5].attributes('tabindex')).toBe('0');
  });

  it('ArrowRight steps from the cell that holds focus, not from a stale cursor', async () => {
    const { wrapper } = pickableGrid([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');

    (cells[4].element as HTMLElement).focus();
    await nextTick();
    await wrapper.find('[role="grid"]').trigger('keydown', { key: 'ArrowRight' });
    await nextTick();

    expect(cells[5].attributes('tabindex')).toBe('0');
    expect(document.activeElement).toBe(cells[5].element);
  });
});
