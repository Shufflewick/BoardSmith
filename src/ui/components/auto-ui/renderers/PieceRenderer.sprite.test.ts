// @vitest-environment jsdom
/**
 * PieceRenderer draws a sprite-sheet piece through the shared getSpriteStyle,
 * so one cell of a many-sprite sheet fills the piece's CSS box (#1020).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PieceRenderer from './PieceRenderer.vue';

function piece(face: Record<string, unknown>) {
  return { id: 1, className: 'Piece', name: 'pawn', attributes: { $images: { face } } };
}

describe('PieceRenderer sprite face', () => {
  it('shows one cell of a many-sprite sheet, sized to the piece box (#1020)', () => {
    const wrapper = mount(PieceRenderer, {
      props: { element: piece({ sprite: '/pieces.png', x: 80, y: 40, width: 40, height: 40, sheetWidth: 200, sheetHeight: 120 }) },
    });
    const style = wrapper.find('.piece-sprite').attributes('style');
    expect(style).toContain('background-position: 50% 50%');
    expect(style).toContain('background-size: 500% 300%');
  });

  it('refuses sprite data with no sheet size', () => {
    expect(() => mount(PieceRenderer, {
      props: { element: piece({ sprite: '/pieces.png', x: 0, y: 0, width: 40, height: 40 }) },
    })).toThrow("Sprite image '/pieces.png' at x 0, y 0 is missing sheetWidth, sheetHeight.");
  });
});
