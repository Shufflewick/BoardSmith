// @vitest-environment jsdom
/**
 * A deck's top card is children[0], the card first() and a draw take (#893).
 * The stacked cards are positioned siblings in one stacking context, so the one
 * painted last (highest z-index, then latest in the page) is the one a player sees.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import DeckRenderer from './DeckRenderer.vue';

const card = (id: number, name: string) => ({ id, name, className: 'Card', attributes: { $type: 'card' } });
const deck = {
  id: 1,
  name: 'pile',
  className: 'Deck',
  attributes: { $type: 'deck' },
  children: [card(2, 'C'), card(3, 'B'), card(4, 'A')],
};

const CardStub = defineComponent({
  props: { element: { type: Object, required: true } },
  setup: (props) => () => h('div', { 'data-card': (props.element as { name: string }).name }),
});

function mountDeck() {
  return mount(DeckRenderer, { props: { element: deck }, global: { stubs: { ElementRenderer: CardStub } } });
}

describe('DeckRenderer top card (#893)', () => {
  it('paints the first child on top', () => {
    const cards = mountDeck().findAll('.deck-card').map((w, order) => ({
      name: w.attributes('data-card'),
      z: Number((w.element as HTMLElement).style.zIndex || 0),
      order,
    }));
    const painted = [...cards].sort((a, b) => a.z - b.z || a.order - b.order);

    expect(painted.at(-1)!.name).toBe('C');
  });

  it('lists the top card first for screen readers', () => {
    expect(mountDeck().findAll('.deck-card').map((w) => w.attributes('data-card'))).toEqual(['C', 'B', 'A']);
  });
});
