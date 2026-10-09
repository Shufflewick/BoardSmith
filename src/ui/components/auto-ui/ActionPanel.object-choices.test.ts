// @vitest-environment jsdom
/**
 * #563: OBJECT-VALUED CHOICES ARE DISTINCT ITEMS IN THE ACTION PANEL.
 *
 * The panel keyed every choice by `String(choice.value)`, so every object-valued
 * choice keyed as '[object Object]'. Vue then cannot tell them apart: when the
 * list changes it hands one choice's button to another, so the button the
 * player was on (focus included) silently starts meaning a different choice. A choice is keyed the way the engine identifies
 * it (`choiceValueKey` beside `valuesEqual` in `engine/action/choice-matching.ts`).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { stubActionController, mountPanel } from './action-panel-controller.test-helper.js';

const NORTH = { value: { from: 'harbor', to: 'north' }, display: 'Harbor to north' };
const SOUTH = { value: { from: 'harbor', to: 'south' }, display: 'Harbor to south' };
const EAST = { value: { from: 'market', to: 'east' }, display: 'Market to east' };

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function buttonFor(panel: VueWrapper, label: string): HTMLElement {
  const button = panel.findAll('.choice-btn:not(.skip-btn)').find((b) => b.text() === label);
  expect(button, `the panel should offer "${label}"`).toBeTruthy();
  return button!.element as HTMLElement;
}

describe('object-valued choices in the Action Panel (#563)', () => {
  it('renders each object choice as its own item, and pressing each fills that choice', async () => {
    const fill = vi.fn(async () => ({ valid: true }));
    const controller = stubActionController({
      currentAction: ref('travel'),
      currentPick: ref({ name: 'leg', type: 'choice', prompt: 'Choose a leg' }),
      currentChoices: ref([NORTH, SOUTH]),
      fill,
    });
    const panel = mountPanel(controller);
    mounted.push(panel);

    expect(panel.findAll('.choice-btn:not(.skip-btn)').map((b) => b.text()))
      .toEqual(['Harbor to north', 'Harbor to south']);

    buttonFor(panel, 'Harbor to north').click();
    buttonFor(panel, 'Harbor to south').click();
    await nextTick();
    expect(fill.mock.calls).toEqual([['leg', NORTH.value], ['leg', SOUTH.value]]);
  });

  it('keeps each object choice on its own button when the list changes', async () => {
    const currentChoices = ref([NORTH, SOUTH, EAST]);
    const fill = vi.fn(async () => ({ valid: true }));
    const controller = stubActionController({
      currentAction: ref('travel'),
      currentPick: ref({ name: 'leg', type: 'choice', prompt: 'Choose a leg' }),
      currentChoices,
      fill,
    });
    const panel = mountPanel(controller);
    mounted.push(panel);

    const southButton = buttonFor(panel, 'Harbor to south');
    const eastButton = buttonFor(panel, 'Market to east');

    // The game narrows its list: north is no longer on offer.
    currentChoices.value = [SOUTH, EAST];
    await nextTick();

    expect(buttonFor(panel, 'Harbor to south')).toBe(southButton);
    expect(buttonFor(panel, 'Market to east')).toBe(eastButton);

    southButton.click();
    await nextTick();
    expect(fill).toHaveBeenCalledWith('leg', SOUTH.value);
  });
});
