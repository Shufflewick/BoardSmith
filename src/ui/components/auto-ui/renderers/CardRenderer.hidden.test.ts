// @vitest-environment jsdom
/**
 * CardRenderer on a hidden placeholder from a real per-seat view (#491).
 *
 * The engine marks a card the seat cannot see with `attributes.__hidden`. The
 * renderer must treat that card as hidden: show it as a back, and never draw
 * an overlay face image or stats for it.
 */
import { describe, it, expect } from 'vitest';
import { computed } from 'vue';
import { mount } from '@vue/test-utils';
import CardRenderer from './CardRenderer.vue';
import { GAME_CONTEXT_KEYS } from '../../../composables/useGameContext.js';
import type { PresentationOverlay } from '../presentation.js';
import { hiddenOpponentCard, ownCardOfSeat1 } from '../hidden-hand-game.test-helper.js';

const overlay: PresentationOverlay = {
  byClass: { SecretCard: { image: '/img/face.png', stats: { power: 10 } } },
};

function mountCard(element: ReturnType<typeof hiddenOpponentCard>) {
  return mount(CardRenderer, {
    props: { element, depth: 0 },
    global: { provide: { [GAME_CONTEXT_KEYS.presentation]: computed(() => overlay) } },
  });
}

describe('CardRenderer on a hidden placeholder', () => {
  it('marks the card hidden and draws no overlay face or stats', () => {
    const wrapper = mountCard(hiddenOpponentCard());
    expect(wrapper.find('.card-container').classes()).toContain('is-hidden');
    expect(wrapper.find('.card-back').exists()).toBe(true);
    expect(wrapper.html()).not.toContain('/img/face.png');
    expect(wrapper.find('.card-stats').exists()).toBe(false);
  });

  it("draws the overlay face and stats on the seat's own visible card", () => {
    const wrapper = mountCard(ownCardOfSeat1());
    expect(wrapper.find('.card-container').classes()).not.toContain('is-hidden');
    expect(wrapper.find('img').attributes('src')).toBe('/img/face.png');
    expect(wrapper.find('.card-stats').exists()).toBe(true);
  });
});
