// @vitest-environment jsdom
/**
 * #268: the Action Panel draws a destructive verb apart from an ordinary one.
 *
 * The panel is shipped shell chrome a game cannot restyle, so this is the only
 * surface that can carry the warning. What it must NOT do is carry it in colour
 * alone: a player who cannot tell the hues apart would get no warning at all.
 * So the button gets three carriers that are independent of the palette -- a
 * marker glyph, a screen-reader label, and a `destructive` class the stylesheet
 * hangs an inset ring off -- and the colour is the fourth.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { stubActionController } from './action-panel-controller.test-helper.js';

function panel() {
  return mount(ActionPanel, {
    global: {
      provide: {
        [GAME_CONTEXT_KEYS.actionController as symbol]: stubActionController(),
      },
    },
    props: {
      availableActions: ['endSurvivor', 'lookAround'],
      actionMetadata: {
        endSurvivor: {
          name: 'endSurvivor',
          prompt: 'Careful: end this survivor, scattering everything you carry across the map',
          destructive: true,
          selections: [],
        },
        lookAround: {
          name: 'lookAround',
          prompt: 'Look around the sector you are standing in',
          selections: [],
        },
      },
      playerSeat: 1,
      isMyTurn: true,
    },
  });
}

describe('ActionPanel destructive emphasis (#268)', () => {
  it('marks only the destructive action button with the destructive class', () => {
    const wrapper = panel();
    const button = (name: string) => wrapper.get(`[data-bs-action="${name}"]`);

    expect(button('endSurvivor').classes()).toContain('destructive');
    expect(button('lookAround').classes()).not.toContain('destructive');
  });

  it('carries the warning without colour: a marker glyph and a screen-reader label', () => {
    const wrapper = panel();
    const destructive = wrapper.get('[data-bs-action="endSurvivor"]');
    const ordinary = wrapper.get('[data-bs-action="lookAround"]');

    const mark = destructive.get('.action-destructive-mark');
    // The glyph is decoration for the eye; the words are what a screen reader says.
    expect(mark.attributes('aria-hidden')).toBe('true');
    expect(mark.text()).not.toBe('');
    expect(destructive.get('.sr-only').text()).toBe('Destructive action.');

    expect(ordinary.find('.action-destructive-mark').exists()).toBe(false);
    expect(ordinary.find('.sr-only').exists()).toBe(false);

    // The prompt itself is untouched -- the emphasis is added around it, never
    // instead of it.
    expect(destructive.text()).toContain('Careful: end this survivor');
  });
});
