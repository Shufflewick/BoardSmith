// @vitest-environment jsdom
/**
 * CardRenderer draws a sprite-sheet card from the element's own `$images`
 * sprite data: its own size and its sheet's size, never a 238x333 card on a
 * 13x5 sheet (#864).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CardRenderer from './CardRenderer.vue';
import CardBack from './CardBack.vue';
import { parseImageInfo } from '../../../utils/image.js';

function card(face: Record<string, unknown>) {
  return { id: 1, className: 'Card', name: 'tile', attributes: { $images: { face } } };
}

describe('CardRenderer sprite face', () => {
  it('positions and sizes the sheet by the sprite data', () => {
    const wrapper = mount(CardRenderer, {
      props: { element: card({ sprite: '/tiles.png', x: 450, y: 140, width: 100, height: 140, sheetWidth: 1000, sheetHeight: 700 }) },
    });
    // Relative to the card box, so the sheet fits whatever size --card-w gives it (#1019).
    const style = wrapper.find('.card-sprite').attributes('style');
    expect(style).toContain('background-position: 50% 25%');
    expect(style).toContain('background-size: 1000% 500%');
  });

  it('refuses sprite data with no sheet size', () => {
    expect(() => mount(CardRenderer, {
      props: { element: card({ sprite: '/tiles.png', x: 0, y: 0, width: 100, height: 140 }) },
    })).toThrow("Sprite image '/tiles.png' at x 0, y 0 is missing sheetWidth, sheetHeight.");
  });
});

describe('CardBack sprite back', () => {
  it('sizes the sheet relative to the card box, as hands and decks draw it (#1019)', () => {
    const image = parseImageInfo({ sprite: '/backs.png', x: 0, y: 0, width: 100, height: 140, sheetWidth: 200, sheetHeight: 140 });
    const style = mount(CardBack, { props: { image } }).find('.card-back-image').attributes('style');
    expect(style).toContain('background-position: 0% 0%');
    expect(style).toContain('background-size: 200% 100%');
  });
});
