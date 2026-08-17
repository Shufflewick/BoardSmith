// @vitest-environment jsdom
/**
 * FlyingCardsOverlay draws the in-flight elements `useFlyingElements` produces.
 * It picks a render mode per element (image / card / piece), and the mode is
 * what decides whether a checkers piece flies as a coloured disc or as a blank
 * playing card. Previously the component was only ever stubbed out in tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import FlyingCardsOverlay from './FlyingCardsOverlay.vue';
import type { FlyingCard } from '../../composables/useFlyingElements.js';

const flyingCard = (
  id: string,
  cardData: Record<string, unknown>,
  overrides: Partial<FlyingCard> = {},
): FlyingCard => ({
  id,
  cardData: cardData as FlyingCard['cardData'],
  style: {
    position: 'fixed',
    left: '10px',
    top: '20px',
    width: '70px',
    height: '100px',
    transform: 'translate(0, 0)',
    transition: 'all 500ms',
    zIndex: 1000,
    pointerEvents: 'none',
  },
  isFlipped: false,
  progress: 0,
  ...overrides,
});

const overlay = (flyingCards: FlyingCard[], props: Record<string, unknown> = {}, slots = {}) =>
  mount(FlyingCardsOverlay, {
    props: { flyingCards, ...props },
    slots,
    attachTo: document.body,
  });

const cards = () => document.querySelectorAll('.flying-card');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FlyingCardsOverlay', () => {
  it('renders nothing when nothing is in flight', () => {
    overlay([]);
    expect(cards()).toHaveLength(0);
  });

  it('renders one node per flying element', () => {
    overlay([flyingCard('a', { rank: 'A', suit: 'H' }), flyingCard('b', { rank: 'K', suit: 'S' })]);
    expect(cards()).toHaveLength(2);
  });

  it('applies the position style the composable computed', () => {
    overlay([flyingCard('a', { rank: 'A', suit: 'H' })]);
    const style = (cards()[0] as HTMLElement).getAttribute('style')!;
    expect(style).toContain('left: 10px');
    expect(style).toContain('top: 20px');
    expect(style).toContain('position: fixed');
  });

  it('never intercepts pointer events — the board stays clickable mid-flight', () => {
    overlay([flyingCard('a', { rank: 'A', suit: 'H' })]);
    expect((cards()[0] as HTMLElement).getAttribute('style')).toContain('pointer-events: none');
  });

  it('marks a flipping element so the flip animation can run', () => {
    overlay([flyingCard('a', { rank: 'A', suit: 'H' }, { isFlipped: true })]);
    expect(cards()[0].classList.contains('flipping')).toBe(true);
    expect(document.querySelector('.card-inner')!.classList.contains('flipped')).toBe(true);
  });

  describe('render modes', () => {
    it('draws rank and suit for a plain card', () => {
      overlay([flyingCard('a', { rank: 'K', suit: 'H' })]);
      expect(document.querySelector('.rank')!.textContent).toBe('K');
      expect(document.querySelector('.suit')!.textContent).toBe('♥');
    });

    it('draws a URL face image as an <img>', () => {
      overlay([flyingCard('a', { rank: 'A', suit: 'H', faceImage: '/ace.png' })]);
      const img = document.querySelector('.card-front img.card-image') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/ace.png');
    });

    it('draws a sprite face as a positioned background, not an <img>', () => {
      overlay([flyingCard('a', {
        rank: 'A', suit: 'H',
        faceImage: { sprite: '/cards.png', x: 238, y: 0, width: 238, height: 333 },
      })]);
      expect(document.querySelector('.card-front .card-sprite')).not.toBeNull();
      expect(document.querySelector('.card-front img')).toBeNull();
    });

    it('draws an owned element with no art as a coloured piece, not a card', () => {
      overlay([flyingCard('a', { playerSeat: 0 })]);
      expect(document.querySelector('.piece-inner')).not.toBeNull();
      expect(document.querySelector('.card-inner')).toBeNull();
    });

    it('colours the piece by seat', () => {
      overlay([flyingCard('a', { playerSeat: 1 })], { playerColors: ['#ff0000', '#00ff00'] });
      const piece = document.querySelector('.piece-inner') as HTMLElement;
      expect(piece.getAttribute('style')).toContain('rgb(0, 255, 0)');
    });

    it('falls back to its own palette when the game supplies none', () => {
      overlay([flyingCard('a', { playerSeat: 0 })]);
      const piece = document.querySelector('.piece-inner') as HTMLElement;
      expect(piece.getAttribute('style')).toContain('rgb(231, 76, 60)');
    });

    it('wraps the seat around a short palette rather than rendering colourless', () => {
      overlay([flyingCard('a', { playerSeat: 3 })], { playerColors: ['#ff0000', '#00ff00'] });
      const piece = document.querySelector('.piece-inner') as HTMLElement;
      expect(piece.getAttribute('style')).toContain('rgb(0, 255, 0)');
    });

    it('prefers card art over piece rendering when an element has both', () => {
      overlay([flyingCard('a', { playerSeat: 0, faceImage: '/ace.png' })]);
      expect(document.querySelector('.card-inner')).not.toBeNull();
      expect(document.querySelector('.piece-inner')).toBeNull();
    });
  });

  describe('back face', () => {
    it('draws a URL back image', () => {
      overlay([flyingCard('a', { rank: 'A', suit: 'H', backImage: '/back.png' })]);
      const img = document.querySelector('.card-back img.card-image') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/back.png');
    });

    it('paints a plain colour back when one is given', () => {
      overlay([flyingCard('a', { rank: 'A', suit: 'H', backColor: '#123456' })]);
      const back = document.querySelector('.card-back') as HTMLElement;
      expect(back.getAttribute('style')).toContain('rgb(18, 52, 86)');
      expect(back.classList.contains('has-color')).toBe(true);
    });
  });

  describe('customisation', () => {
    it('uses a supplied suit symbol function', () => {
      overlay([flyingCard('a', { rank: 'A', suit: 'H' })], { getSuitSymbol: () => 'HEART' });
      expect(document.querySelector('.suit')!.textContent).toBe('HEART');
    });

    it('uses a supplied suit colour function', () => {
      overlay([flyingCard('a', { rank: 'A', suit: 'H' })], { getSuitColor: () => 'rgb(1, 2, 3)' });
      const front = document.querySelector('.card-front') as HTMLElement;
      expect(front.getAttribute('style')).toContain('rgb(1, 2, 3)');
    });

    it('lets a custom UI take over rendering through the card slot', () => {
      overlay(
        [flyingCard('a', { rank: 'A', suit: 'H' })],
        {},
        { card: '<div class="my-card">Mine</div>' },
      );
      expect(document.querySelector('.my-card')!.textContent).toBe('Mine');
      expect(document.querySelector('.card-inner')).toBeNull();
    });

    it('hands the flying element to the slot so it can render its own data', () => {
      overlay(
        [flyingCard('a', { rank: 'Q', suit: 'S' })],
        {},
        { card: '<template #card="{ card }"><div class="my-card">{{ card.cardData.rank }}</div></template>' },
      );
      expect(document.querySelector('.my-card')!.textContent).toBe('Q');
    });
  });

  it('updates as the in-flight set changes', async () => {
    const wrapper = overlay([flyingCard('a', { rank: 'A', suit: 'H' })]);
    expect(cards()).toHaveLength(1);
    await wrapper.setProps({
      flyingCards: [flyingCard('a', { rank: 'A', suit: 'H' }), flyingCard('b', { rank: '2', suit: 'C' })],
    });
    expect(cards()).toHaveLength(2);
    await wrapper.setProps({ flyingCards: [] });
    expect(cards()).toHaveLength(0);
  });
});
