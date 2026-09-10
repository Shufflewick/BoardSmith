// @vitest-environment jsdom
/**
 * ActionPanel smoke test — proves the Vue SFC component-test harness works.
 *
 * This test exists ONLY to verify that:
 *   1. vitest can transform and import a real .vue SFC from src/ui/components/auto-ui
 *   2. @vue/test-utils mount() works under the jsdom environment
 *   3. The ActionPanel component mounts without throwing when given a minimal controller
 *
 * It does NOT test interaction behaviour (those live in later plans).
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { stubActionController } from './action-panel-controller.test-helper.js';

describe('ActionPanel smoke test', () => {
  it('mounts a real SFC in jsdom and produces DOM', () => {
    const controller = stubActionController();

    const wrapper = mount(ActionPanel, {
      global: {
        provide: {
          [GAME_CONTEXT_KEYS.actionController as symbol]: controller,
        },
      },
      props: {
        availableActions: [],
        playerSeat: 1,
        isMyTurn: true,
      },
    });

    // The harness is real: a genuine Vue SFC mounted under jsdom.
    expect(wrapper.exists()).toBe(true);

    // The component rendered DOM (not an empty wrapper).
    expect(wrapper.element.children.length).toBeGreaterThan(0);
  });
});
