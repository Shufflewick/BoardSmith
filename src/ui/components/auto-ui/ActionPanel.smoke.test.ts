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
import { ref, computed } from 'vue';
import ActionPanel from './ActionPanel.vue';

/**
 * Build the minimal controller object ActionPanel reads on first render.
 * Every property accessed by ActionPanel's <script setup> must be present.
 * All reactive values are plain refs/computeds that return stable falsy values.
 */
function makeMinimalController() {
  const noop = () => undefined;
  return {
    // Refs accessed directly (not wrapped in computed by ActionPanel)
    currentAction: ref<string | null>(null),
    isExecuting: ref(false),
    isLoadingChoices: ref(false),
    actionSnapshot: ref(null),

    // Refs that ActionPanel wraps in computed(() => x.value)
    animationsPending: ref(false),
    showActionPanel: ref(true),
    repeatingState: ref(null),
    multiSelectDraft: ref(null),
    currentArgs: ref<Record<string, unknown>>({}),
    currentPick: ref(null),

    // Functions called in computed getters / template handlers
    getCurrentChoices: () => [] as unknown[],
    getValidElements: () => [] as unknown[],
    getCollectedPick: () => null,
    isMultiSelectSelected: () => false,

    // Async functions used in event handlers only (not called on render)
    start: async () => { },
    fill: async () => ({ valid: false, error: 'smoke test' }),
    skip: noop,
    cancel: noop,
    clear: noop,
    execute: async () => ({ success: false }),
    toggleMultiSelect: async () => { },
    confirmMultiSelect: async () => { },
  };
}

describe('ActionPanel smoke test', () => {
  it('mounts a real SFC in jsdom and produces DOM', () => {
    const controller = makeMinimalController();

    const wrapper = mount(ActionPanel, {
      global: {
        provide: {
          actionController: controller,
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
