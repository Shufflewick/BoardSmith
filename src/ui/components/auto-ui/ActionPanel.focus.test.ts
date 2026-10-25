// @vitest-environment jsdom
/**
 * The Action Panel never drops a keyboard user out of the tab order (#27).
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
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { useActionController } from '../../composables/useActionController.js';
import type { EnrichedActionMetadata } from '../../composables/useActionController.js';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { documentHasFocus } from './document-has-focus.test-helper.js';

documentHasFocus();

const twoChoiceAction: EnrichedActionMetadata = {
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
    props: { availableActions: ['enterWorld'], isMyTurn: true },
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
    // connected, still inside the Action Panel, still in the tab order.
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

    // The player tabs to something outside the Action Panel.
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
  const sixStep: EnrichedActionMetadata = {
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
      props: { availableActions: ['create'], isMyTurn: true },
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

// A document without focus, such as the GameShell iframe while the player is
// using the page around it (#649), has focus on its body by definition. That is
// not a stranded keyboard user: placing focus there would pull it out of the
// host page, closing its menus and interrupting its text fields, every time a
// new state arrives. The repair is put off until the window regains focus.
describe('a document that does not have focus (#649)', () => {
  let focus: MockInstance<() => void>;
  beforeEach(() => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    focus = vi.spyOn(HTMLElement.prototype, 'focus');
  });
  afterEach(() => {
    focus.mockRestore();
  });

  it('leaves focus alone when the available actions change', async () => {
    const { wrapper } = mountPanel();
    await nextTick();

    await wrapper.setProps({ availableActions: ['enterWorld', 'rest'] });
    await nextTick();
    await nextTick();

    expect(focus).not.toHaveBeenCalled();
    expect(focusDescription()).toBe('BODY');
    wrapper.unmount();
  });

  it('leaves focus alone when the step changes', async () => {
    const { wrapper, controller } = mountPanel();
    await nextTick();

    await controller.start('enterWorld');
    await nextTick();
    await nextTick();

    expect(focus).not.toHaveBeenCalled();
    expect(focusDescription()).toBe('BODY');
    wrapper.unmount();
  });

  // A keyboard player switches tab while waiting, and the opponent's move
  // removes the button they were on. The repair waits for them to come back.
  it('repairs a skipped stranding when the window regains focus', async () => {
    const { wrapper, controller } = mountPanel();
    await nextTick();

    await controller.start('enterWorld');
    await nextTick();
    await nextTick();
    expect(focus).not.toHaveBeenCalled();

    vi.mocked(document.hasFocus).mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));

    expect(focusDescription()).toContain('Wolf');
    wrapper.unmount();
  });

  // A press places focus itself. Focusing the first button under it scrolled a
  // scrolled action bar back to its top, and the press lost its click (#1473).
  it('leaves focus to a pointer press that gives the window focus back', async () => {
    const { wrapper, controller } = mountPanel();
    await nextTick();
    await controller.start('enterWorld');
    await nextTick();
    await nextTick();

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.mocked(document.hasFocus).mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));

    expect(focus).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does not move focus on a window focus when no repair was skipped', async () => {
    const { wrapper } = mountPanel();
    await nextTick();

    vi.mocked(document.hasFocus).mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));

    expect(focus).not.toHaveBeenCalled();
    expect(focusDescription()).toBe('BODY');
    wrapper.unmount();
  });

  it('does not move focus the player put somewhere else before coming back', async () => {
    const { wrapper, controller } = mountPanel();
    await nextTick();
    await controller.start('enterWorld');
    await nextTick();
    await nextTick();

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    vi.mocked(document.hasFocus).mockReturnValue(true);
    outside.focus();
    window.dispatchEvent(new Event('focus'));

    expect(document.activeElement).toBe(outside);
    wrapper.unmount();
  });

  it('stops listening for window focus when the panel unmounts', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { wrapper } = mountPanel();
    const added = add.mock.calls.filter(([type]) => type === 'focus');
    expect(added).toHaveLength(1);

    wrapper.unmount();

    expect(remove.mock.calls.filter(([type]) => type === 'focus')).toEqual([['focus', added[0][1]]]);
    add.mockRestore();
    remove.mockRestore();
  });
});

// A step whose choices come from the server is drawn before they arrive (#653).
// Go Fish's ask showed it: at the moment the step changed, the selection held no
// control yet, so the repair fell through to the panel's first control, the
// cancel button -- and focus parked there was no longer stranded, so it stayed
// when the choices landed a moment later. Enter would have abandoned the action.
describe('a step whose choices are still loading (#653)', () => {
  it('lands on the first choice once they arrive, not on cancel', async () => {
    let answer!: () => void;
    const fetchPickChoices = vi.fn(() => new Promise<{ success: true; choices: { value: string; display: string }[] }>((resolve) => {
      answer = () => resolve({ success: true, choices: [
        { value: 'wolf', display: 'Wolf' },
        { value: 'hare', display: 'Hare' },
      ] });
    }));
    const fetched: EnrichedActionMetadata = {
      name: 'enterWorld',
      prompt: 'Enter the world',
      selections: [{ name: 'species', type: 'choice', prompt: 'Pick a species' }],
    };
    const controller = useActionController({
      sendAction: vi.fn().mockResolvedValue({ success: true }),
      availableActions: ref(['enterWorld']),
      actionMetadata: ref({ enterWorld: fetched }),
      isMyTurn: ref(true),
      autoFill: false,
      autoExecute: false,
      fetchPickChoices,
    });
    const wrapper = mount(ActionPanel, {
      attachTo: document.body,
      global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
      props: { availableActions: ['enterWorld'], isMyTurn: true },
    });
    await nextTick();

    void controller.start('enterWorld');
    await nextTick();
    await nextTick();
    expect(fetchPickChoices).toHaveBeenCalled();
    expect(focusDescription()).not.toContain('✕');

    answer();
    await vi.waitFor(() => expect(focusDescription()).toContain('Wolf'));
    wrapper.unmount();
  });
});
