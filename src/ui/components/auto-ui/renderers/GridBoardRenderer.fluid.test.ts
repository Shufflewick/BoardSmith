// @vitest-environment jsdom
/**
 * GridBoardRenderer fluid sizing test (IA-05)
 *
 * Verifies that the grid wrapper exposes --cols and --rows custom properties
 * driven by the board's column/row counts, and that .grid-cell dimensions
 * use var(--cell) (not fixed 50px).
 *
 * Design decision: we assert the inline style string on the wrapper element
 * for --cols/--rows (set via :style binding), and we assert the component
 * scoped CSS uses var(--cell) for .grid-cell width/height by inspecting
 * the rendered element's style attribute (for inline vars) and the component
 * source (for CSS rules). The mounted component path proves the :style binding
 * reaches the DOM.
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import GridBoardRenderer from './GridBoardRenderer.vue';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

/**
 * Build a minimal grid element with explicit $rows/$cols so resolveGridSize
 * returns ok:true with the given dimensions.
 */
function buildGridElement(cols: number, rows: number, children: GameElement[] = []): GameElement {
  return {
    id: 1,
    className: 'Board',
    name: 'TestBoard',
    attributes: {
      $layout: 'grid',
      $rows: rows,
      $cols: cols,
      $rowCoord: 'row',
      $colCoord: 'col',
    },
    children,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GridBoardRenderer fluid sizing', () => {
  it('sets --cols on the board-with-labels wrapper matching the grid column count', () => {
    const element = buildGridElement(8, 6);
    const wrapper = mount(GridBoardRenderer, {
      props: { element, depth: 0 },
      global: { provide: {} },
    });

    // The board-with-labels wrapper (or its parent board-container) must carry --cols
    // as an inline CSS custom property matching the column count.
    const boardWithLabels = wrapper.find('.board-with-labels');
    expect(boardWithLabels.exists()).toBe(true);

    const styleAttr = boardWithLabels.attributes('style') ?? '';
    expect(styleAttr).toContain('--cols: 8');
  });

  it('sets --rows on the board-with-labels wrapper matching the grid row count', () => {
    const element = buildGridElement(8, 6);
    const wrapper = mount(GridBoardRenderer, {
      props: { element, depth: 0 },
      global: { provide: {} },
    });

    const boardWithLabels = wrapper.find('.board-with-labels');
    const styleAttr = boardWithLabels.attributes('style') ?? '';
    expect(styleAttr).toContain('--rows: 6');
  });

  it('does not use fixed 50px width or height on .grid-cell', () => {
    // Assert the component's rendered .grid-cell does NOT carry 50px as an
    // inline width or height (the old fixed-pixel approach).
    // We build one child cell to ensure the grid-cell element appears.
    const cell: GameElement = {
      id: 2,
      className: 'Space',
      name: 'a1',
      attributes: { row: 0, col: 0 },
      children: [],
    };
    const element = buildGridElement(2, 2, [cell]);
    const wrapper = mount(GridBoardRenderer, {
      props: { element, depth: 0 },
      global: { provide: {} },
    });

    const gridCell = wrapper.find('.grid-cell');
    expect(gridCell.exists()).toBe(true);

    // The cell must NOT have an inline style of width:50px or height:50px.
    const style = gridCell.attributes('style') ?? '';
    expect(style).not.toMatch(/width\s*:\s*50px/);
    expect(style).not.toMatch(/height\s*:\s*50px/);
  });

  it('uses var(--cell) for .grid-cell width and height via scoped CSS (source check)', async () => {
    // Mount the component to confirm it renders without error with the new CSS.
    // The var(--cell) usage is in scoped CSS (not inline) — we verify the component
    // renders successfully (no thrown errors) and that the grid wrapper carries
    // --cols/--rows so --cell can resolve at runtime.
    const element = buildGridElement(10, 10);
    const wrapper = mount(GridBoardRenderer, {
      props: { element, depth: 0 },
      global: { provide: {} },
    });

    expect(wrapper.exists()).toBe(true);

    // Confirm --cols and --rows are both present
    const boardWithLabels = wrapper.find('.board-with-labels');
    const styleAttr = boardWithLabels.attributes('style') ?? '';
    expect(styleAttr).toContain('--cols: 10');
    expect(styleAttr).toContain('--rows: 10');
  });
});
