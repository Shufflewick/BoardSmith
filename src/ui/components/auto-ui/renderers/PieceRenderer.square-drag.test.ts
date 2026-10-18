// @vitest-environment jsdom
/**
 * A piece standing on a candidate square drags on the square's behalf (#943).
 *
 * Checkers and Chess anchor a piece's candidate to the notation of its square,
 * so the square is the board's candidate and the piece is not. The piece must
 * still be draggable, and its drag must carry the square, whose pick the shared
 * drag-start path resolves (useDragDropTargets.test.ts covers that half).
 */
import { describe, it, expect } from 'vitest';
import '../builtin-renderers.js';
import GridBoardRenderer from './GridBoardRenderer.vue';
import { mountBoardRenderer } from './board-renderer-a11y.test-helper.js';
import type { GameElement } from '../auto-ui-helpers.js';
import { createBoardInteraction } from '../../../composables/useBoardInteraction.js';

/** A one-row board: d4 holds piece 42, e4 holds piece 43. */
function board(): GameElement {
  const square = (id: number, notation: string, col: number, piece: number): GameElement => ({
    id,
    className: 'Square',
    name: notation,
    attributes: { row: 0, col, notation },
    children: [{ id: piece, className: 'CheckerPiece', name: `piece-${piece}`, attributes: {} }],
  });
  return {
    id: 1,
    className: 'Board',
    name: 'board',
    attributes: { $layout: 'grid', $rowCoord: 'row', $colCoord: 'col' },
    children: [square(300, 'd4', 0, 42), square(301, 'e4', 1, 43)],
  };
}

const dataTransfer = { setData() {}, setDragImage() {}, effectAllowed: '' };

describe('PieceRenderer on a candidate square (#943)', () => {
  it('is draggable, and its drag carries the square', async () => {
    const interaction = createBoardInteraction();
    interaction.setValidElements([{ id: 42, ref: { notation: 'd4' } }], () => {});
    const { wrapper } = mountBoardRenderer(GridBoardRenderer, board(), interaction);

    const [onCandidate, offCandidate] = wrapper.findAll('.piece');
    expect(onCandidate.attributes('draggable')).toBe('true');
    expect(offCandidate.attributes('draggable')).toBe('false');

    await onCandidate.trigger('dragstart', { dataTransfer });
    expect(interaction.draggedElement).toEqual({ id: 300, name: 'd4', notation: 'd4' });
    expect(onCandidate.classes()).toContain('is-dragging');
    wrapper.unmount();
  });
});
