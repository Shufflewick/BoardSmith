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
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import HexBoardRenderer from './HexBoardRenderer.vue';
import {
  createBoardInteraction,
  provideBoardInteraction,
} from '../../../composables/useBoardInteraction.js';

// ---------------------------------------------------------------------------
// Local GameElement interface — mirrors HexBoardRenderer
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
}

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

/**
 * Mount HexBoardRenderer inside a wrapper that provides boardInteraction.
 */
function mountHex(element: GameElement, interaction = createBoardInteraction()) {
  const Wrapper = defineComponent({
    components: { HexBoardRenderer },
    setup() {
      provideBoardInteraction(interaction);
    },
    template: '<HexBoardRenderer :element="element" :depth="0" />',
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
describe('HexBoardRenderer a11y — role=gridcell + roving tabindex (partial — SVG focus in Safari/VoiceOver requires manual verification, research Open Q3)', () => {
  it('SVG root has role="grid" (required ancestor for role="gridcell", WR-02)', () => {
    const { wrapper } = mountHex(buildHexElement(3));
    const svg = wrapper.find('svg');
    expect(svg.attributes('role')).toBe('grid');
  });

  it('SVG root has aria-colcount matching the column count', () => {
    // 3 cells in a single horizontal row → q=0,1,2 → hexCols = 3
    const { wrapper } = mountHex(buildHexElement(3));
    const svg = wrapper.find('svg');
    expect(svg.attributes('aria-colcount')).toBe('3');
  });

  it('SVG root has aria-rowcount', () => {
    // Single-row board → all cells have r=0 → hexRows = 1
    const { wrapper } = mountHex(buildHexElement(3));
    const svg = wrapper.find('svg');
    expect(svg.attributes('aria-rowcount')).toBe('1');
  });

  it('each <g> hex cell has role="gridcell"', () => {
    const { wrapper } = mountHex(buildHexElement(3));
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells.length).toBe(3);
  });

  it('each cell has a non-empty aria-label', () => {
    const { wrapper } = mountHex(buildHexElement(3));
    const cells = wrapper.findAll('[role="gridcell"]');
    for (const cell of cells) {
      const label = cell.attributes('aria-label') ?? '';
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('exactly one cell has tabindex="0" initially', () => {
    const { wrapper } = mountHex(buildHexElement(4));
    const cells = wrapper.findAll('[role="gridcell"]');
    const zeros = cells.filter(c => c.attributes('tabindex') === '0');
    expect(zeros.length).toBe(1);
  });

  it('all other cells have tabindex="-1" initially', () => {
    const { wrapper } = mountHex(buildHexElement(4));
    const cells = wrapper.findAll('[role="gridcell"]');
    const negatives = cells.filter(c => c.attributes('tabindex') === '-1');
    expect(negatives.length).toBe(3); // 4 total - 1 with tabindex=0
  });

  it('ArrowRight on the SVG root advances roving tabindex from cell 0 to cell 1', async () => {
    const { wrapper } = mountHex(buildHexElement(3));
    const svg = wrapper.find('svg');
    expect(svg.exists()).toBe(true);
    await svg.trigger('keydown', { key: 'ArrowRight' });
    const cells = wrapper.findAll('[role="gridcell"]');
    expect(cells[0].attributes('tabindex')).toBe('-1');
    expect(cells[1].attributes('tabindex')).toBe('0');
  });
});
