// @vitest-environment jsdom
/**
 * EVERY RENDERER THAT CAN HOST AN ANCHORED CANDIDATE STAMPS THE SAME HOOK (#189).
 *
 * There are eight built-in renderers (builtin-renderers.ts registers exactly
 * that many). Before this test four of them carried `data-element-id` and none
 * of them carried the player-facing wording, so which hooks a candidate had
 * depended on which renderer the author's element happened to resolve to —
 * a caller could answer a pick on a card and not on a holding.
 *
 * Each case here puts ONE real element into `validElements` with the display
 * text the panel would have shown, mounts the renderer that claims it, and
 * asserts the node carries both the identity and that wording.
 */

import { describe, it, expect } from 'vitest';
import { defineComponent, h, provide, ref } from 'vue';
import { mount } from '@vue/test-utils';
import {
  createBoardInteraction,
  provideBoardInteraction,
  type BoardInteraction,
} from '../../../composables/useBoardInteraction.js';
import CardRenderer from './CardRenderer.vue';
import HandRenderer from './HandRenderer.vue';
import DeckRenderer from './DeckRenderer.vue';
import DieRenderer from './DieRenderer.vue';
import PieceRenderer from './PieceRenderer.vue';
import SpaceRenderer from './SpaceRenderer.vue';
import GridBoardRenderer from './GridBoardRenderer.vue';
import HexBoardRenderer from './HexBoardRenderer.vue';

const CANDIDATE_ID = 42;
const LABEL = 'Holding 1';

/** A board substrate mid-pick, offering exactly one candidate. */
function boardOffering(id: number, display: string): BoardInteraction {
  const board = createBoardInteraction();
  board.setCurrentAction('tend', 0, 'neighbour');
  board.setValidElements([{ id, ref: { id }, display }], () => {});
  return board;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mountWith(component: any, props: Record<string, unknown>, board: BoardInteraction,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mountOptions: Record<string, any> = {}) {
  const Wrapper = defineComponent({
    setup() {
      provideBoardInteraction(board);
      // The context chain AutoRenderer provides — supplied here so the mounted
      // renderer is the same component the shell renders, warnings included.
      provide('playerSeat', 0);
      provide('selectableElements', ref(new Set<number>()));
      provide('selectedElements', ref(new Set<number>()));
      provide('defaultBackImage', ref(null));
      provide('presentation', ref(undefined));
    },
    render() {
      return h(component, props);
    },
  });
  return mount(Wrapper, { attachTo: document.body, ...mountOptions });
}

const DIE_STUB = { global: { stubs: { Die3D: { template: '<div class="stub-die3d"></div>' } } } };

/** A board element of the given $type, claimed by its own renderer. */
function leaf(type?: string) {
  return {
    id: CANDIDATE_ID,
    className: 'Holding',
    name: 'holding-1',
    attributes: type ? { $type: type } : {},
    children: [],
    childCount: 0,
  };
}

/** A grid/hex board whose SECOND cell is the candidate, so the hook is per-cell. */
function boardOfCells(layout: 'grid' | 'hex-grid') {
  const coords = (i: number) =>
    layout === 'grid' ? { row: 0, col: i } : { q: i, r: 0 };
  return {
    id: 1,
    className: 'Board',
    name: 'board',
    attributes:
      layout === 'grid'
        ? { $layout: 'grid', $rowCoord: 'row', $colCoord: 'col' }
        : { $layout: 'hex-grid' },
    children: [0, 1].map(i => ({
      id: i === 1 ? CANDIDATE_ID : 100 + i,
      className: 'Space',
      name: `cell-${i}`,
      attributes: coords(i),
      children: [],
    })),
  };
}

const ELEMENT_CASES: Array<[string, unknown, Record<string, unknown>, Record<string, unknown>]> = [
  ['CardRenderer', CardRenderer, { element: leaf('card'), depth: 0 }, {}],
  ['DeckRenderer', DeckRenderer, { element: leaf('deck'), depth: 0 }, {}],
  ['DieRenderer', DieRenderer, { element: { ...leaf('die'), attributes: { $type: 'die', sides: 6, value: 3 } }, depth: 0 }, DIE_STUB],
  ['HandRenderer', HandRenderer, { element: leaf('hand'), depth: 0 }, {}],
  ['PieceRenderer', PieceRenderer, { element: leaf(), depth: 0 }, {}],
  ['SpaceRenderer', SpaceRenderer, { element: leaf(), depth: 0 }, {}],
];

describe.each(ELEMENT_CASES)('%s — anchored candidate hook (#189)', (_name, component, props, opts) => {
  it('marks the candidate with the display text the panel would have shown', () => {
    const wrapper = mountWith(component, props, boardOffering(CANDIDATE_ID, LABEL), opts);
    const hit = wrapper.find(`[data-bs-candidate="${LABEL}"]`);
    expect(hit.exists()).toBe(true);
    expect(hit.attributes('data-bs-el-id')).toBe(String(CANDIDATE_ID));
    expect(hit.attributes('data-element-id')).toBe(String(CANDIDATE_ID));
    wrapper.unmount();
  });

  it('carries no candidate hook when nothing is being picked', () => {
    const wrapper = mountWith(component, props, createBoardInteraction(), opts);
    expect(wrapper.find('[data-bs-candidate]').exists()).toBe(false);
    // The identity anchor is unconditional — only candidacy comes and goes.
    expect(wrapper.find(`[data-element-id="${CANDIDATE_ID}"]`).exists()).toBe(true);
    wrapper.unmount();
  });
});

const BOARD_CASES: Array<[string, unknown, 'grid' | 'hex-grid']> = [
  ['GridBoardRenderer', GridBoardRenderer, 'grid'],
  ['HexBoardRenderer', HexBoardRenderer, 'hex-grid'],
];

describe.each(BOARD_CASES)('%s — anchored candidate hook (#189)', (_name, component, layout) => {
  it('marks the candidate cell, and only that cell', () => {
    const wrapper = mountWith(
      component,
      { element: boardOfCells(layout), depth: 0 },
      boardOffering(CANDIDATE_ID, LABEL),
    );
    const hits = wrapper.findAll('[data-bs-candidate]');
    expect(hits).toHaveLength(1);
    expect(hits[0].attributes('data-bs-candidate')).toBe(LABEL);
    expect(hits[0].attributes('data-bs-el-id')).toBe(String(CANDIDATE_ID));
    expect(hits[0].attributes('data-element-id')).toBe(String(CANDIDATE_ID));
    wrapper.unmount();
  });

  it('carries no candidate hook when nothing is being picked', () => {
    const wrapper = mountWith(
      component,
      { element: boardOfCells(layout), depth: 0 },
      createBoardInteraction(),
    );
    expect(wrapper.find('[data-bs-candidate]').exists()).toBe(false);
    expect(wrapper.find(`[data-element-id="${CANDIDATE_ID}"]`).exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('the candidate label falls back to the id when the pick supplies no wording', () => {
  it('never leaves a candidate unmarked', () => {
    const board = createBoardInteraction();
    board.setValidElements([{ id: CANDIDATE_ID, ref: { id: CANDIDATE_ID } }], () => {});
    const wrapper = mountWith(PieceRenderer, { element: leaf(), depth: 0 }, board);
    expect(wrapper.find('[data-bs-candidate]').attributes('data-bs-candidate'))
      .toBe(String(CANDIDATE_ID));
    wrapper.unmount();
  });
});
