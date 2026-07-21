// @vitest-environment jsdom
/**
 * LIBX-01: ActionPanel's dock render filters out actions whose metadata
 * carries `suppressFromDock: true`. The suppressed action must still be
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

describe('ActionPanel dock suppression (LIBX-01)', () => {
  it('hides the dock button for a suppressFromDock action while a sibling un-suppressed action still renders', () => {
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
            suppressFromDock: true,
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

  it('still passes the suppressed action through in availableActions props (executable-elsewhere invariant)', () => {
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
            suppressFromDock: true,
            selections: [],
          },
        },
        playerSeat: 1,
        isMyTurn: true,
      },
    });

    // The suppressed action never renders a dock button...
    const buttons = wrapper.findAll('[data-bs-action]');
    expect(buttons.map(b => b.attributes('data-bs-action'))).not.toContain('hiddenAction');

    // ...but the panel received it unmodified via props -- suppression is a
    // render-only filter, not an availability mutation.
    const receivedProps = wrapper.props() as {
      availableActions: string[];
      actionMetadata: Record<string, { suppressFromDock?: boolean }>;
    };
    expect(receivedProps.availableActions).toEqual(['hiddenAction']);
    expect(receivedProps.actionMetadata.hiddenAction.suppressFromDock).toBe(true);
  });
});
