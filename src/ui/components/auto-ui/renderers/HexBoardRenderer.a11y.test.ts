// @vitest-environment jsdom
/**
 * HexBoardRenderer a11y test (A11Y-01)
 *
 * partial — SVG focus in Safari/VoiceOver requires manual verification (research Open Q3).
 *
 * Automated regression surface for hex board keyboard operability.
 * Asserts:
 *  - Each <g> hex cell has role="gridcell" with a per-cell aria-label
 *  - Exactly one cell has tabindex="0" (roving tabindex); others have "-1"
 *  - ArrowRight on the SVG root advances the roving tab stop (currentIdx moves)
 *
 * NOTE: tabindex on SVG <g> elements is spec-valid in all modern browsers.
 * Safari/VoiceOver SVG focus reliability requires manual verification per
 * research Open Question 3. Escalate to overlay buttons if VO fails.
 */

import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import HexBoardRenderer from './HexBoardRenderer.vue';
import {
  mountBoardRenderer,
  type GameElement,
} from './board-renderer-a11y.test-helper.js';
import { createBoardInteraction } from '../../../composables/useBoardInteraction.js';

/** This suite's renderer, so every mount below reads the same as the other board's. */
const mountBoard = (element: GameElement, interaction = createBoardInteraction()) =>
  mountBoardRenderer(HexBoardRenderer, element, interaction);

/**
 * Build a hex board with `cellCount` cells in a horizontal row (r=0, q=0..N-1).
 * Uses default qCoord='q' and rCoord='r' attribute names.
 */
function buildHexElement(cellCount: number): GameElement {
  const cells: GameElement[] = [];
  for (let q = 0; q < cellCount; q++) {
    cells.push({
      id: q + 100,
      className: 'HexSpace',
      name: `h${q}`,
      attributes: { q, r: 0 },
      children: [],
    });
  }
  return {
    id: 1,
    className: 'HexBoard',
    name: 'TestHexBoard',
    attributes: { $layout: 'hex-grid' },
    children: cells,
  };
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('HexBoardRenderer a11y — role=gridcell + roving tabindex (partial — SVG focus in Safari/VoiceOver requires manual verification, research Open Q3)', () => {
  it('SVG root has role="grid" (required ancestor for role="gridcell", WR-02)', () => {
    const { wrapper } = mountBoard(buildHexElement(3));
    const svg = wrapper.find('svg');
    expect(svg.attributes('role')).toBe('grid');
  });

  it('SVG root has aria-colcount matching the column count', () => {
    // 3 cells in a single horizontal row → q=0,1,2 → hexCols = 3
    const { wrapper } = mountBoard(buildHexElement(3));
    const svg = wrapper.find('svg');
    expect(svg.attributes('aria-colcount')).toBe('3');
  });

  it('SVG root has aria-rowcount', () => {
    // Single-row board → all cells have r=0 → hexRows = 1
    const { wrapper } = mountBoard(buildHexElement(3));
    const svg = wrapper.find('svg');
    expect(svg.attributes('aria-rowcount')).toBe('1');
  });

  it('each <g> hex cell has role="gridcell"', () => {
    const { wrapper } = mountBoard(buildHexElement(3));
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells.length).toBe(3);
  });

  it('each cell has a non-empty aria-label', () => {
    const { wrapper } = mountBoard(buildHexElement(3));
    const cells = wrapper.findAll('[role="gridcell"]');
    for (const cell of cells) {
      const label = cell.attributes('aria-label') ?? '';
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('exactly one cell has tabindex="0" initially', () => {
    const { wrapper } = mountBoard(buildHexElement(4));
    const cells = wrapper.findAll('[role="gridcell"]');
    const zeros = cells.filter(c => c.attributes('tabindex') === '0');
    expect(zeros.length).toBe(1);
  });

  it('all other cells have tabindex="-1" initially', () => {
    const { wrapper } = mountBoard(buildHexElement(4));
    const cells = wrapper.findAll('[role="gridcell"]');
    const negatives = cells.filter(c => c.attributes('tabindex') === '-1');
    expect(negatives.length).toBe(3); // 4 total - 1 with tabindex=0
  });

  it('ArrowRight on the SVG root advances roving tabindex from cell 0 to cell 1', async () => {
    const { wrapper } = mountBoard(buildHexElement(3));
    const svg = wrapper.find('svg');
    expect(svg.exists()).toBe(true);
    await svg.trigger('keydown', { key: 'ArrowRight' });
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[0].attributes('tabindex')).toBe('-1');
    expect(cells[1].attributes('tabindex')).toBe('0');
  });
});

/**
 * #172 — Hex is the case this ticket is about: ~50 empty cells that the panel
 * hands to the board. The board is then the only path into the choice.
 */
describe('HexBoardRenderer candidate focus (#172)', () => {
  function hexWithCandidates(candidateIds: number[]) {
    const interaction = createBoardInteraction();
    interaction.setValidElements(
      candidateIds.map((id) => ({ id, ref: { id } })),
      () => {},
    );
    return mountBoard(buildHexElement(6), interaction);
  }

  it('parks the roving tab stop on the first valid target, not on cell 0', async () => {
    const { wrapper } = hexWithCandidates([103, 105]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[0].attributes('tabindex')).toBe('-1');
    expect(cells[3].attributes('tabindex')).toBe('0');
  });

  it('moves DOM focus onto that cell when the panel hands the choice over', async () => {
    const { wrapper, interaction } = hexWithCandidates([103, 105]);
    await nextTick();

    interaction.requestBoardFocus();
    await nextTick();
    await nextTick();

    const cells = wrapper.findAll('[role="gridcell"]');
    expect(document.activeElement).toBe(cells[3].element);
  });

  it('leaves the tab stop alone when there is nothing to pick', async () => {
    const { wrapper } = hexWithCandidates([]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[0].attributes('tabindex')).toBe('0');
  });
});

/**
 * #190 — the roving cursor and real focus must never disagree.
 *
 * The move a keyboard player makes succeeds either way; the defect is that it
 * was a different move. So every case here focuses one cell and then asserts
 * WHICH element the key resolved, not that focus moved.
 */
describe('HexBoardRenderer keyboard activation follows focus (#190)', () => {
  function pickableHex(candidateIds: number[]) {
    const interaction = createBoardInteraction();
    const picked: number[] = [];
    interaction.setValidElements(
      candidateIds.map((id) => ({ id, ref: { id } })),
      (id) => picked.push(id),
    );
    return { ...mountBoard(buildHexElement(6), interaction), picked };
  }

  it('Enter resolves the cell that holds focus, not the one the cursor parked on', async () => {
    const { wrapper, picked } = pickableHex([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');
    // The cursor parks itself on the first candidate (102, index 2).
    expect(cells[2].attributes('tabindex')).toBe('0');

    (cells[4].element as SVGGElement).focus();
    await nextTick();
    await wrapper.find('svg').trigger('keydown', { key: 'Enter' });

    expect(picked).toEqual([104]);
  });

  it('Enter resolves the cell it was delivered to even when no focus event ever fired', async () => {
    // Measured in Chrome: .focus() on a cell in a document that does not hold
    // system focus moves document.activeElement and fires neither focus nor
    // focusin. The key still arrives at that cell, and that is what must decide.
    const { wrapper, picked } = pickableHex([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[2].attributes('tabindex')).toBe('0');

    await cells[4].trigger('keydown', { key: 'Enter' });

    expect(picked).toEqual([104]);
  });

  it('Space resolves the cell that holds focus too', async () => {
    const { wrapper, picked } = pickableHex([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');

    (cells[4].element as SVGGElement).focus();
    await nextTick();
    await wrapper.find('svg').trigger('keydown', { key: ' ' });

    expect(picked).toEqual([104]);
  });

  it('a re-offer does not drag the cursor off the cell the player has focused', async () => {
    const { wrapper, interaction, picked } = pickableHex([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');

    // The player focuses a cell this choice does not accept — an occupied hex,
    // say, on the way to somewhere else.
    (cells[5].element as SVGGElement).focus();
    await nextTick();
    expect(cells[5].attributes('tabindex')).toBe('0');

    // Any state update re-offers the same candidates as a fresh array.
    interaction.setValidElements(
      [102, 104].map((id) => ({ id, ref: { id } })),
      (id) => picked.push(id),
    );
    await nextTick();

    expect(document.activeElement).toBe(cells[5].element);

    await wrapper.find('svg').trigger('keydown', { key: 'Enter' });
    // The focused cell is not a candidate, so it resolves as a passive select.
    // What must NOT happen is a stone landing on a cell the player never chose.
    expect(picked).toEqual([]);
    expect(interaction.isSelected({ id: 105 })).toBe(true);
    expect(cells[5].attributes('tabindex')).toBe('0');
  });

  it('ArrowRight steps from the cell that holds focus, not from a stale cursor', async () => {
    const { wrapper } = pickableHex([102, 104]);
    await nextTick();
    const cells = wrapper.findAll('[role="gridcell"]');

    (cells[4].element as SVGGElement).focus();
    await nextTick();
    await wrapper.find('svg').trigger('keydown', { key: 'ArrowRight' });
    await nextTick();

    expect(cells[5].attributes('tabindex')).toBe('0');
    expect(document.activeElement).toBe(cells[5].element);
  });
});
