// @vitest-environment jsdom
/**
 * LIBX-01: ActionPanel's Action Panel render filters out actions whose metadata
 * carries `suppressFromActionPanel: true`. The suppressed action must still be
 * passed in via props (the panel only filters the RENDERED buttons -- it
 * does not mutate availability; the board substrate is fed independently
 * via useBoardActionBridge, so a suppressed action stays board-clickable).
 *
 * Pre-fix: `visibleActions` is a bare passthrough
 * (`return actionsWithMetadata.value;`), so the suppressed action's button
 * renders identically to any other action -- this test fails pre-fix.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ActionPanel from './ActionPanel.vue';

function makeMinimalController() {
  const noop = () => undefined;
  return {
    currentAction: ref<string | null>(null),
    isExecuting: ref(false),
    isLoadingChoices: ref(false),
    actionSnapshot: ref(null),

    animationsPending: ref(false),
    showActionPanel: ref(true),
    repeatingState: ref(null),
    multiSelectDraft: ref(null),
    currentArgs: ref<Record<string, unknown>>({}),
    currentPick: ref(null),

    getCurrentChoices: () => [] as unknown[],
    getValidElements: () => [] as unknown[],
    getCollectedPick: () => null,
    isMultiSelectSelected: () => false,

    start: async () => { },
    fill: async () => ({ valid: false, error: 'test' }),
    skip: noop,
    cancel: noop,
    clear: noop,
    execute: async () => ({ success: false }),
    toggleMultiSelect: async () => { },
    confirmMultiSelect: async () => { },
  };
}

describe('ActionPanel Action Panel suppression (LIBX-01)', () => {
  it('hides the Action Panel button for a suppressFromActionPanel action while a sibling un-suppressed action still renders', () => {
    const controller = makeMinimalController();

    const wrapper = mount(ActionPanel, {
      global: {
        provide: {
          actionController: controller,
        },
      },
      props: {
        availableActions: ['hiddenAction', 'visibleAction'],
        actionMetadata: {
          hiddenAction: {
            name: 'hiddenAction',
            prompt: 'Hidden Action',
            suppressFromActionPanel: true,
            selections: [],
          },
          visibleAction: {
            name: 'visibleAction',
            prompt: 'Visible Action',
            selections: [],
          },
        },
        playerSeat: 1,
        isMyTurn: true,
      },
    });

    const buttons = wrapper.findAll('[data-bs-action]');
    const renderedNames = buttons.map(b => b.attributes('data-bs-action'));

    expect(renderedNames).not.toContain('hiddenAction');
    expect(renderedNames).toContain('visibleAction');
  });

  it('renders the suppressed action when it is the ONLY one, and still passes it through unmodified (executable-elsewhere invariant)', () => {
    const controller = makeMinimalController();

    const wrapper = mount(ActionPanel, {
      global: {
        provide: {
          actionController: controller,
        },
      },
      props: {
        availableActions: ['hiddenAction'],
        actionMetadata: {
          hiddenAction: {
            name: 'hiddenAction',
            prompt: 'Hidden Action',
            suppressFromActionPanel: true,
            selections: [],
          },
        },
        playerSeat: 1,
        isMyTurn: true,
      },
    });

    // Suppression hides a REDUNDANT button, never the last one. This fixture is
    // the reported trap exactly: one available action, suppressed, with NO
    // selections (`selections: []`). Filtering it out would leave the player a
    // prompt and nothing to press — and with no selections no pick can start,
    // so the mid-pick anchored-choices affordance never appears either. There
    // would be no way out of that state.
    const buttons = wrapper.findAll('[data-bs-action]');
    expect(buttons.map(b => b.attributes('data-bs-action'))).toContain('hiddenAction');

    // And the panel received it unmodified via props -- suppression is a
    // render-only filter, not an availability mutation.
    const receivedProps = wrapper.props() as {
      availableActions: string[];
      actionMetadata: Record<string, { suppressFromActionPanel?: boolean }>;
    };
    expect(receivedProps.availableActions).toEqual(['hiddenAction']);
    expect(receivedProps.actionMetadata.hiddenAction.suppressFromActionPanel).toBe(true);
  });
});
