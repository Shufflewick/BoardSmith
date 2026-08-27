// @vitest-environment jsdom
/**
 * The dock never drops a keyboard user out of the tab order (#27).
 *
 * ActionPanel renders the current step's controls and nothing else, and the
 * controller advances a step by changing what the panel renders. A removed node
 * cannot hold focus, so at every transition — opening the action, each
 * selection, and the return to idle — `document.activeElement` fell back to
 * `document.body`: no position in the tab order, nothing announced. A player
 * completing a six-selection action was dropped seven times and had to tab in
 * from the top of the document each time.
 *
 * The rule is deliberately narrow: focus is only placed when it has been
 * STRANDED (on `body`, or on a node no longer in the document). A user who
 * deliberately tabbed somewhere else is never yanked back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { useActionController } from '../../composables/useActionController.js';
import type { ActionMetadata } from '../../composables/useActionController.js';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';

const twoChoiceAction: ActionMetadata = {
  name: 'enterWorld',
  prompt: 'Enter the world',
  selections: [
    { name: 'species', type: 'choice', prompt: 'Pick a species', choices: [
      { value: 'wolf', display: 'Wolf' },
      { value: 'hare', display: 'Hare' },
    ] },
    { name: 'region', type: 'choice', prompt: 'Pick a region', choices: [
      { value: 'north', display: 'North' },
      { value: 'south', display: 'South' },
    ] },
  ],
};

function mountPanel() {
  const sendAction = vi.fn().mockResolvedValue({ success: true });
  const controller = useActionController({
    sendAction,
    availableActions: ref(['enterWorld']),
    actionMetadata: ref({ enterWorld: twoChoiceAction }),
    isMyTurn: ref(true),
    autoFill: false,
    autoExecute: false,
  });

  // attachTo puts the panel in the real document, which is what makes
  // document.activeElement meaningful.
  const wrapper = mount(ActionPanel, {
    attachTo: document.body,
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
    props: { availableActions: ['enterWorld'], playerSeat: 1, isMyTurn: true },
  });
  return { wrapper, controller, sendAction };
}

/** Where focus actually is, as a test can describe it. */
function focusDescription(): string {
  const el = document.activeElement;
  if (!el || el === document.body) return 'BODY';
  if (!el.isConnected) return 'DETACHED';
  return `${el.tagName}:${el.textContent?.trim() ?? ''}`;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('focus after each step of a chained action', () => {
  it('lands on a connected, operable control when the action opens', async () => {
    const { wrapper, controller } = mountPanel();
    await nextTick();

    await controller.start('enterWorld');
    await nextTick();
    await nextTick();

    expect(focusDescription()).not.toBe('BODY');
    expect(focusDescription()).not.toBe('DETACHED');
    expect(wrapper.element.contains(document.activeElement)).toBe(true);
    wrapper.unmount();
  });

  it('follows the panel to the next selection instead of stranding', async () => {
    const { wrapper, controller } = mountPanel();
    await nextTick();
    await controller.start('enterWorld');
    await nextTick();
    await nextTick();

    // Step one offers the species choices.
    expect(focusDescription()).toContain('Wolf');

    await controller.fill('species', 'wolf');
    await nextTick();
    await nextTick();

    // Step two offers the region choices, and focus is on one of them — still
    // connected, still inside the dock, still in the tab order.
    expect(focusDescription()).not.toBe('BODY');
    expect(focusDescription()).not.toBe('DETACHED');
    expect(wrapper.element.contains(document.activeElement)).toBe(true);
    expect(focusDescription()).toContain('North');
    wrapper.unmount();
  });

  it('does not yank focus away from a control the user deliberately moved to', async () => {
    const { wrapper, controller } = mountPanel();
    await nextTick();
    await controller.start('enterWorld');
    await nextTick();
    await nextTick();

    // The player tabs to something outside the dock.
    const outside = document.createElement('button');
    outside.textContent = 'Elsewhere';
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    await controller.fill('species', 'wolf');
    await nextTick();
    await nextTick();

    // Still connected and still where the player put it.
    expect(document.activeElement).toBe(outside);
    wrapper.unmount();
  });
});

describe('focus when the panel returns to its idle list', () => {
  it('lands on the action\'s own button rather than the body', async () => {
    const { wrapper, controller } = mountPanel();
    await nextTick();
    await controller.start('enterWorld');
    await nextTick();
    await nextTick();
    await controller.fill('species', 'wolf');
    await nextTick();
    await nextTick();

    controller.cancel();
    await nextTick();
    await nextTick();

    // The action is offered again, and that is where focus belongs — the
    // acceptance criterion is a connected node, and this is the useful one.
    expect(focusDescription()).not.toBe('BODY');
    expect(focusDescription()).not.toBe('DETACHED');
    expect(wrapper.element.contains(document.activeElement)).toBe(true);
    // The action's own start button, which is the one the player wants.
    expect(focusDescription()).toContain('Enter World');
    wrapper.unmount();
  });
});

describe('a six-selection action, the shape the report measured', () => {
  const sixStep: ActionMetadata = {
    name: 'create',
    prompt: 'Create a survivor',
    selections: Array.from({ length: 6 }, (_, i) => ({
      name: `step${i}`,
      type: 'choice' as const,
      prompt: `Choose ${i}`,
      choices: [
        { value: `a${i}`, display: `A${i}` },
        { value: `b${i}`, display: `B${i}` },
      ],
    })),
  };

  it('never strands focus across all seven transitions', async () => {
    const sendAction = vi.fn().mockResolvedValue({ success: true });
    const controller = useActionController({
      sendAction,
      availableActions: ref(['create']),
      actionMetadata: ref({ create: sixStep }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
    });
    const wrapper = mount(ActionPanel, {
      attachTo: document.body,
      global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
      props: { availableActions: ['create'], playerSeat: 1, isMyTurn: true },
    });
    await nextTick();

    const observed: string[] = [];

    await controller.start('create');
    await nextTick();
    await nextTick();
    observed.push(focusDescription());

    for (let i = 0; i < 6; i++) {
      await controller.fill(`step${i}`, `a${i}`);
      await nextTick();
      await nextTick();
      observed.push(focusDescription());
    }

    // The report measured BODY at every one of these seven points.
    expect(observed).toHaveLength(7);
    expect(observed.filter((f) => f === 'BODY')).toEqual([]);
    expect(observed.filter((f) => f === 'DETACHED')).toEqual([]);
    wrapper.unmount();
  });
});
