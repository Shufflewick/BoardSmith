// @vitest-environment jsdom
/**
 * A piece standing on a candidate square drags on the square's behalf (#943).
 *
 * Checkers and Chess anchor a piece's candidate to the notation of its square,
 * so the square is the board's candidate and the piece is not. The piece must
 * still be draggable, and its drag must carry the square, whose pick the shared
 * drag-start path resolves (useDragDropTargets.test.ts covers that half).
 * A disabled candidate, a piece, its square or a card, drags for nothing (#1190),
 * except the auto-filled source, and a disabled piece still drags for its square (#1299).
 */
import { describe, it, expect } from 'vitest';
import '../builtin-renderers.js';
import GridBoardRenderer from './GridBoardRenderer.vue';
import CardRenderer from './CardRenderer.vue';
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

  it('a disabled candidate, on the piece or on its square, does not make the piece draggable, as a click on it chooses nothing (#1190)', () => {
    const interaction = createBoardInteraction();
    interaction.setValidElements([
      { id: 42, ref: { notation: 'd4' }, disabled: 'blocked' },
      { id: 43, ref: { id: 43 }, disabled: 'pinned' },
    ], () => {});
    const { wrapper } = mountBoardRenderer(GridBoardRenderer, board(), interaction);

    for (const piece of wrapper.findAll('.piece')) {
      expect(piece.attributes('draggable')).toBe('false');
      expect(piece.classes()).not.toContain('is-draggable');
    }
    wrapper.unmount();
  });

  it('a disabled piece on an enabled candidate square drags for its square (#1299)', async () => {
    const interaction = createBoardInteraction();
    interaction.setValidElements([
      { id: 300, ref: { notation: 'd4' } },
      { id: 42, ref: { id: 42 }, disabled: 'pinned' },
    ], () => {});
    const { wrapper } = mountBoardRenderer(GridBoardRenderer, board(), interaction);

    const [piece] = wrapper.findAll('.piece');
    expect(piece.attributes('draggable')).toBe('true');
    await piece.trigger('dragstart', { dataTransfer });
    expect(interaction.draggedElement).toEqual({ id: 300, name: 'd4', notation: 'd4' });
    wrapper.unmount();
  });
});

describe('CardRenderer for a disabled candidate (#1190)', () => {
  it('is not draggable', () => {
    const interaction = createBoardInteraction();
    interaction.setValidElements([{ id: 7, ref: { id: 7 }, disabled: 'too expensive' }], () => {});
    const { wrapper } = mountBoardRenderer(CardRenderer, { id: 7, className: 'Card', name: 'ace', attributes: {} }, interaction);

    const card = wrapper.find('.card-container');
    expect(card.classes()).toContain('is-disabled');
    expect(card.attributes('draggable')).toBe('false');
    wrapper.unmount();
  });

  it('the auto-filled card drags on even when the pick lists it as a disabled destination (#1299)', async () => {
    const interaction = createBoardInteraction();
    interaction.setValidElements([{ id: 7, ref: { id: 7 }, disabled: 'already there' }], () => {});
    interaction.setDraggableSelectedElement({ id: 7 });
    const { wrapper } = mountBoardRenderer(CardRenderer, { id: 7, className: 'Card', name: 'ace', attributes: {} }, interaction);

    const card = wrapper.find('.card-container');
    expect(card.attributes('draggable')).toBe('true');
    await card.trigger('dragstart', { dataTransfer });
    expect(interaction.isDragging).toBe(true);
    wrapper.unmount();
  });
});
