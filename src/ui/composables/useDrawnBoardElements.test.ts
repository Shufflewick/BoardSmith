// @vitest-environment jsdom
/**
 * #1589 — the board reports which elements it draws, from its own anchors.
 *
 * Every element candidate carries a board ref whether or not the board draws
 * it, so the Action Panel needs the board itself to say what is on it. A board
 * that spreads `anchorAttrs` says so without doing anything else.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { anchorAttrs, createBoardInteraction, type ElementRef } from './useBoardInteraction.js';
import { useDrawnBoardElements } from './useDrawnBoardElements.js';

function mountBoard(drawn: ElementRef[]) {
  const interaction = createBoardInteraction();
  const elements = ref(drawn);
  const shown = ref(true);
  const Board = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null);
      useDrawnBoardElements(interaction, container);
      return () => (shown.value
        ? h('div', { ref: container }, [
          h('p', 'The field'),
          ...elements.value.map((element) => h('div', anchorAttrs(element))),
        ])
        : null);
    },
  });
  return { interaction, elements, shown, wrapper: mount(Board) };
}

describe('useDrawnBoardElements', () => {
  it('reports every element the board anchors, by any identity it carries', async () => {
    const { interaction, wrapper } = mountBoard([{ id: 11 }, { notation: 'a5' }, { id: 12, name: 'Genesis' }]);
    await flushPromises();
    expect(interaction.isDrawn({ id: 11 })).toBe(true);
    expect(interaction.isDrawn({ notation: 'a5' })).toBe(true);
    expect(interaction.isDrawn({ name: 'Genesis' })).toBe(true);
    expect(interaction.isDrawn({ id: 13 })).toBe(false);
    expect(interaction.isDrawn({ name: 'a5' })).toBe(false);
    wrapper.unmount();
  });

  it('follows the board as it draws and stops drawing an element', async () => {
    const { interaction, elements, wrapper } = mountBoard([{ id: 11 }]);
    await flushPromises();
    expect(interaction.isDrawn({ id: 11 })).toBe(true);
    elements.value = [{ id: 12 }];
    await flushPromises();
    expect(interaction.isDrawn({ id: 11 })).toBe(false);
    expect(interaction.isDrawn({ id: 12 })).toBe(true);
    wrapper.unmount();
  });

  it('reports nothing drawn once the board is gone', async () => {
    const { interaction, shown, wrapper } = mountBoard([{ id: 11 }]);
    await flushPromises();
    expect(interaction.isDrawn({ id: 11 })).toBe(true);
    shown.value = false;
    await flushPromises();
    expect(interaction.isDrawn({ id: 11 })).toBe(false);
    wrapper.unmount();
  });
});
