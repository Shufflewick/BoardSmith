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
import { anchorAttrs, candidateAttrs, createBoardInteraction, pickSurfaceAttrs, type ElementRef } from './useBoardInteraction.js';
import { useDrawnBoardElements } from './useDrawnBoardElements.js';

function mountBoard(drawn: ElementRef[], offered: ElementRef[] = []) {
  const interaction = createBoardInteraction();
  const elements = ref(drawn);
  const candidates = ref(offered);
  const label = ref<string | null>('Pick me');
  const surface = ref<string | null>(null);
  const shown = ref(true);
  const Board = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null);
      useDrawnBoardElements(interaction, container);
      return () => (shown.value
        ? h('div', { ref: container }, [
          h('p', pickSurfaceAttrs(surface.value), 'The field'),
          ...elements.value.map((element) => h('div', anchorAttrs(element))),
          ...candidates.value.map((element) => h('button', { ...anchorAttrs(element), ...candidateAttrs(label.value) })),
        ])
        : null);
    },
  });
  return { interaction, elements, candidates, label, surface, shown, wrapper: mount(Board) };
}

describe('useDrawnBoardElements', () => {
  it('reports every element the board anchors, by any identity it carries', async () => {
    const { interaction, wrapper } = mountBoard([{ id: 11 }, { notation: 'a5' }, { id: 12, name: 'Rowan' }]);
    await flushPromises();
    expect(interaction.isDrawn({ id: 11 })).toBe(true);
    expect(interaction.isDrawn({ notation: 'a5' })).toBe(true);
    expect(interaction.isDrawn({ name: 'Rowan' })).toBe(true);
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

  // #1644: a board that only shows state draws its elements but offers none of them.
  it('reports as offered only the elements the board marks as candidates', async () => {
    const { interaction, wrapper } = mountBoard([{ id: 11 }], [{ id: 12 }, { notation: 'a5' }]);
    await flushPromises();
    expect(interaction.isDrawn({ id: 11 })).toBe(true);
    expect(interaction.isOffered({ id: 11 })).toBe(false);
    expect(interaction.isOffered({ id: 12 })).toBe(true);
    expect(interaction.isOffered({ notation: 'a5' })).toBe(true);
    wrapper.unmount();
  });

  it('follows the board as it marks and stops marking candidates, and offers nothing once gone', async () => {
    const { interaction, candidates, label, shown, wrapper } = mountBoard([], [{ id: 12 }]);
    await flushPromises();
    expect(interaction.isOffered({ id: 12 })).toBe(true);
    label.value = null;
    await flushPromises();
    expect(interaction.isDrawn({ id: 12 })).toBe(true);
    expect(interaction.isOffered({ id: 12 })).toBe(false);
    label.value = 'Pick me';
    await flushPromises();
    expect(interaction.isOffered({ id: 12 })).toBe(true);
    candidates.value = [{ id: 13 }];
    await flushPromises();
    expect(interaction.isOffered({ id: 12 })).toBe(false);
    expect(interaction.isOffered({ id: 13 })).toBe(true);
    shown.value = false;
    await flushPromises();
    expect(interaction.isOffered({ id: 13 })).toBe(false);
    wrapper.unmount();
  });

  it('reports the pick a surface of the board takes whole, for as long as it says so', async () => {
    const { interaction, surface, shown, wrapper } = mountBoard([]);
    await flushPromises();
    expect(interaction.isPickSurface('space')).toBe(false);
    surface.value = 'space';
    await flushPromises();
    expect(interaction.isPickSurface('space')).toBe(true);
    expect(interaction.isPickSurface('unit')).toBe(false);
    surface.value = null;
    await flushPromises();
    expect(interaction.isPickSurface('space')).toBe(false);
    surface.value = 'space';
    await flushPromises();
    shown.value = false;
    await flushPromises();
    expect(interaction.isPickSurface('space')).toBe(false);
    wrapper.unmount();
  });
});
