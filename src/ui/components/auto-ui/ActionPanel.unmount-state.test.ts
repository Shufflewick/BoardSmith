// @vitest-environment jsdom
/**
 * WHAT THE PANEL GETS BACK WHEN IT IS MOUNTED AGAIN (#235).
 *
 * Collapsing the action bar is a `v-if` swap in `PlayShell`, so it does not
 * hide the panel, it UNMOUNTS it. Every ref inside went with it: the value in a
 * text or number editor (#229 measured the loss in a real browser) and the
 * level of the start-button hierarchy the player had navigated to (#228
 * measured the same loss and declined to fix it here).
 *
 * Both now live in the controller, which outlives the panel, so this file
 * mounts a panel over ONE controller, unmounts it, and mounts a second one --
 * which is what a collapse and a restore are from the panel's point of view.
 *
 * The other half is that nothing comes back where it should not: the lifetime
 * of a draft is held in `useActionController.pick-draft.test.ts`, and the two
 * cases a PANEL can reach are held here.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import ActionPanel from './ActionPanel.vue';
import { useActionController } from '../../composables/useActionController.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import type { ActionMetadata } from '../../composables/useActionControllerTypes.js';

const DESCRIBE: ActionMetadata = {
  name: 'describeEmpire',
  prompt: 'Describe empire',
  selections: [
    { name: 'description', type: 'text', prompt: 'Empire description', maxLength: 1000, multiline: true },
  ],
};

const RECYCLE: ActionMetadata = {
  name: 'recycle',
  prompt: 'Recycle waste',
  selections: [{ name: 'waste', type: 'number', prompt: 'Waste to recycle', min: 1, integer: true }],
};

const NICKNAME: ActionMetadata = {
  name: 'setNickname',
  prompt: 'Set nickname',
  selections: [{ name: 'description', type: 'text', prompt: 'Nickname', maxLength: 20 }],
};

/** Two groups, one of them nested, so a level can be navigated into and out of. */
const LACUNA: ActionMetadata[] = [
  { name: 'construct', prompt: 'Construct building', order: 10, selections: [] },
  { name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'], order: 30, selections: [] },
  { name: 'dumpFood', prompt: 'Dump food', group: ['Dump'], order: 31, selections: [] },
  { name: 'renamePlanet', prompt: 'Rename planet', group: ['More', 'Empire settings'], order: 90, selections: [] },
  { name: 'skipMission', prompt: 'Skip mission', group: ['More'], order: 95, selections: [] },
];

/** A controller and a way to mount and unmount panels over it. */
function panelsOver(actions: ActionMetadata[]) {
  const metadata: Record<string, ActionMetadata> = {};
  for (const action of actions) metadata[action.name] = action;
  const availableActions = ref(actions.map((a) => a.name));
  const controller = useActionController({
    sendAction: vi.fn().mockResolvedValue({ success: true }),
    availableActions,
    actionMetadata: ref(metadata),
    isMyTurn: ref(true),
    autoFill: false,
    autoExecute: false,
    fetchPickChoices: vi.fn().mockResolvedValue({ success: true, choices: [] }),
  });

  const mountPanel = async () => {
    const wrapper = mount(ActionPanel, {
      global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
      attachTo: document.body,
      props: {
        availableActions: availableActions.value,
        actionMetadata: metadata,
        playerSeat: 1,
        isMyTurn: true,
      },
    });
    await nextTick();
    return wrapper;
  };

  return { controller, availableActions, mountPanel };
}

describe('a draft survives the panel being unmounted (#235)', () => {
  it('gives a multiline field back the prose that was in it', async () => {
    const { controller, mountPanel } = panelsOver([DESCRIBE]);
    await controller.start(DESCRIBE.name, {});

    const first = await mountPanel();
    const box = first.find('.text-input textarea');
    await box.setValue('A draft nobody meant to throw away.');
    first.unmount();

    const second = await mountPanel();
    expect((second.find('.text-input textarea').element as HTMLTextAreaElement).value)
      .toBe('A draft nobody meant to throw away.');
    second.unmount();
  });

  it('gives a number field back the number that was in it', async () => {
    const { controller, mountPanel } = panelsOver([RECYCLE]);
    await controller.start(RECYCLE.name, {});

    const first = await mountPanel();
    await first.find('.number-input input').setValue('7');
    first.unmount();

    const second = await mountPanel();
    expect((second.find('.number-input input').element as HTMLInputElement).value).toBe('7');
    second.unmount();
  });

  it('survives being unmounted and mounted again more than once', async () => {
    // A player may put the bar down and bring it up as often as they like; the
    // control's own promise is that it is reversible.
    const { controller, mountPanel } = panelsOver([DESCRIBE]);
    await controller.start(DESCRIBE.name, {});

    const first = await mountPanel();
    await first.find('.text-input textarea').setValue('Still here.');
    first.unmount();

    for (let round = 0; round < 3; round++) {
      const wrapper = await mountPanel();
      expect((wrapper.find('.text-input textarea').element as HTMLTextAreaElement).value)
        .toBe('Still here.');
      wrapper.unmount();
    }
  });

  it('does not put the draft into a different action asking the same name', async () => {
    // The bug #229 fixed in the other direction, now that the value outlives
    // the component that used to reset it.
    const { controller, mountPanel } = panelsOver([DESCRIBE, NICKNAME]);
    await controller.start(DESCRIBE.name, {});

    const first = await mountPanel();
    await first.find('.text-input textarea').setValue('x'.repeat(200));
    first.unmount();

    controller.cancel();
    await controller.start(NICKNAME.name, {});
    const second = await mountPanel();
    expect((second.find('.text-input input[type="text"]').element as HTMLInputElement).value)
      .toBe('');
    second.unmount();
  });

  it('opens empty after the value has been submitted', async () => {
    const { controller, mountPanel } = panelsOver([DESCRIBE]);
    await controller.start(DESCRIBE.name, {});

    const wrapper = await mountPanel();
    await wrapper.find('.text-input textarea').setValue('Submitted and done.');
    await wrapper.find('.text-input .done-button').trigger('click');
    await nextTick();
    wrapper.unmount();

    controller.cancel();
    await controller.start(DESCRIBE.name, {});
    const second = await mountPanel();
    expect((second.find('.text-input textarea').element as HTMLTextAreaElement).value).toBe('');
    second.unmount();
  });

  it('does not bring back the refusal message, which was about a press and not a value', async () => {
    // The error says why the LAST submission was refused. The value comes back
    // because the player wrote it; the refusal does not, because they have not
    // pressed anything yet in the panel now in front of them.
    const { controller, mountPanel } = panelsOver([NICKNAME]);
    await controller.start(NICKNAME.name, {});

    const first = await mountPanel();
    const field = first.find('.text-input input[type="text"]');
    await field.setValue('x'.repeat(40));
    await first.find('.text-input .done-button').trigger('click');
    await nextTick();
    expect(first.find('.text-input .selection-error').exists()).toBe(true);
    first.unmount();

    const second = await mountPanel();
    expect(second.find('.text-input .selection-error').exists()).toBe(false);
    expect(second.find('.text-input input[type="text"]').attributes('aria-invalid')).toBeUndefined();
    second.unmount();
  });
});

const groupLabels = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('[data-bs-action-group]').map((b) => b.attributes('data-bs-action-group')!);
const leafNames = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('[data-bs-action]').map((b) => b.attributes('data-bs-action')!);

describe('the open menu level survives the panel being unmounted (#228, #235)', () => {
  it('reopens at the level the player was standing in, not at the top', async () => {
    const { mountPanel } = panelsOver(LACUNA);

    const first = await mountPanel();
    await first.find('[data-bs-action-group="More"]').trigger('click');
    await first.find('[data-bs-action-group="Empire settings"]').trigger('click');
    expect(leafNames(first)).toEqual(['renamePlanet']);
    first.unmount();

    const second = await mountPanel();
    expect(leafNames(second)).toEqual(['renamePlanet']);
    expect(second.find('.action-menu-label').text()).toBe('More / Empire settings');
    second.unmount();
  });

  it('still leaves the level whole when Back is pressed after a remount', async () => {
    // The remembered path has to be operable, not just drawn: a level restored
    // with no way out of it would be worse than being put back at the top.
    const { mountPanel } = panelsOver(LACUNA);

    const first = await mountPanel();
    await first.find('[data-bs-action-group="Dump"]').trigger('click');
    first.unmount();

    const second = await mountPanel();
    expect(leafNames(second)).toEqual(['dumpOre', 'dumpFood']);
    await second.find('[data-bs-menu-back]').trigger('click');
    expect(groupLabels(second)).toEqual(['Dump', 'More']);
    second.unmount();
  });

  it('reopens at the deepest level that still exists when the group went away', async () => {
    // The remembered path is REQUESTED, never trusted: `resolveMenuPath` already
    // truncates it to what the menu now offers, which is what makes remembering
    // it safe across a collapse of any length.
    const { availableActions, mountPanel } = panelsOver(LACUNA);

    const first = await mountPanel();
    await first.find('[data-bs-action-group="More"]').trigger('click');
    await first.find('[data-bs-action-group="Empire settings"]').trigger('click');
    expect(leafNames(first)).toEqual(['renamePlanet']);
    first.unmount();

    // The only action inside 'Empire settings' goes away while the bar is down.
    availableActions.value = ['construct', 'dumpOre', 'dumpFood', 'skipMission'];
    const second = await mountPanel();
    expect(second.find('.action-menu-label').text()).toBe('More');
    expect(leafNames(second)).toEqual(['skipMission']);
    second.unmount();
  });
});

describe('an availability change no longer re-mounts the idle list (#228, #235)', () => {
  it('keeps the focused action button, and the focus on it', async () => {
    // The list was keyed on `availableActions.join(',')`, so any change to the
    // set re-mounted every button in it -- the same unmount-loses-state
    // mechanism as the collapse, and the reason #228 had to extend the focus
    // watcher to put focus back afterwards. With the level remembered outside
    // the component, the key has nothing left to do, and a button that still
    // exists now keeps its DOM node and its focus.
    const { mountPanel } = panelsOver(LACUNA);
    const wrapper = await mountPanel();
    const button = wrapper.find('[data-bs-action="construct"]').element as HTMLElement;
    button.focus();
    expect(document.activeElement).toBe(button);

    // A sixth action arrives. `construct` is untouched by that, and used to be
    // re-mounted anyway.
    await wrapper.setProps({
      availableActions: [...LACUNA.map((a) => a.name), 'endTurn'],
    });
    await nextTick();

    expect(wrapper.find('[data-bs-action="construct"]').element).toBe(button);
    expect(document.activeElement).toBe(button);
    wrapper.unmount();
  });

  it('still puts focus somewhere when the focused button is the one that went away', async () => {
    // The watcher is not redundant: a button whose action stops being available
    // is genuinely removed, and a removed node cannot hold focus.
    const { mountPanel } = panelsOver(LACUNA);
    const wrapper = await mountPanel();
    (wrapper.find('[data-bs-action="construct"]').element as HTMLElement).focus();

    await wrapper.setProps({ availableActions: ['dumpOre', 'dumpFood'] });
    await nextTick();
    await nextTick();

    expect(document.activeElement).not.toBe(document.body);
    expect(wrapper.element.contains(document.activeElement)).toBe(true);
    wrapper.unmount();
  });
});
