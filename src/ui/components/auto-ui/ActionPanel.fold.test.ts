// @vitest-environment jsdom
/**
 * DISABLED ACTIONS FOLD INTO ONE ROW (#1638).
 *
 * Each menu level draws its usable actions, then one "N not available yet" row
 * that opens to the disabled ones with their reasons. A disabled action sits in
 * exactly one fold: the deepest level of the usable menu its group reaches.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { stubActionController, type ActionPanelProps } from './action-panel-controller.test-helper.js';
import type { EnrichedActionMetadata } from '../../composables/useActionControllerTypes.js';
import { documentHasFocus } from './document-has-focus.test-helper.js';
import { findAnchor } from '../helpers/overlay-utils.js';

documentHasFocus();

type Meta = Partial<EnrichedActionMetadata> & { name: string };

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function mountPanel(actions: Meta[], extra: Partial<ActionPanelProps> = {}) {
  const controller = stubActionController();
  const metadata: Record<string, EnrichedActionMetadata> = {};
  for (const action of actions) metadata[action.name] = { selections: [], ...action };
  const wrapper = mount(ActionPanel, {
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
    attachTo: document.body,
    props: {
      availableActions: actions.map((a) => a.name),
      actionMetadata: metadata,
      isMyTurn: true,
      ...extra,
    },
  });
  mounted.push(wrapper);
  return { wrapper, controller };
}

type Wrapper = ReturnType<typeof mountPanel>['wrapper'];

/** The buttons of the level, folded entries left out. */
const usable = (wrapper: Wrapper): string[] =>
  wrapper.findAll('[data-bs-action]:not([data-bs-unavailable]), [data-bs-action-group]')
    .map((b) => b.attributes('data-bs-action') ?? `[${b.attributes('data-bs-action-group')}]`);

const toggle = (wrapper: Wrapper) => wrapper.find('[data-bs-unavailable-toggle]');

/** Open the fold and read what it holds. */
async function folded(wrapper: Wrapper): Promise<string[]> {
  if (toggle(wrapper).attributes('aria-expanded') !== 'true') await toggle(wrapper).trigger('click');
  return wrapper.findAll('[data-bs-unavailable]').map((b) => b.attributes('data-bs-action')!);
}

const WINDUP: Meta[] = [
  { name: 'checkIn', prompt: 'Check in' },
  { name: 'buyPack', prompt: 'Buy pack' },
  { name: 'movePack', prompt: 'Move a pack', group: ['Packs'] },
  { name: 'levelUp', prompt: 'Level up a pack', group: ['Packs'] },
  { name: 'unlockUnit', prompt: 'Unlock a unit type', group: ['Buy and unlock'] },
  { name: 'buyTech', prompt: 'Buy a technology', group: ['Buy and unlock'] },
  { name: 'rocket', prompt: 'Rocket Strike', group: ['Strikes', 'Damage'] },
  { name: 'cancelStrike', prompt: 'Cancel a strike', group: ['Strikes'] },
];

const ROUND_ONE = {
  movePack: 'You have no pack on the field.',
  levelUp: 'You have no pack on the field.',
  buyTech: 'Unlock a unit type first.',
  rocket: 'Strikes open after the first battle.',
  cancelStrike: 'You have no strike to cancel.',
};

describe('a level with no disabled action looks exactly as it did', () => {
  it('draws every action and no fold row', () => {
    const { wrapper } = mountPanel(WINDUP);
    expect(usable(wrapper)).toEqual(['checkIn', 'buyPack', '[Packs]', '[Buy and unlock]', '[Strikes]']);
    expect(toggle(wrapper).exists()).toBe(false);
  });
});

describe('the fold row', () => {
  it('shows the usable buttons, then one row counting what this level folded', () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    expect(usable(wrapper)).toEqual(['checkIn', 'buyPack', '[Buy and unlock]']);
    expect(toggle(wrapper).text()).toContain('4 not available yet');
    expect(wrapper.find('[data-bs-unavailable]').isVisible()).toBe(false);
  });

  it('opens to the disabled actions with their reasons, each in one fold only', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    // Packs and Strikes hold nothing usable, so their members fold here; Buy a technology folds inside its group.
    expect(await folded(wrapper)).toEqual(['movePack', 'levelUp', 'rocket', 'cancelStrike']);
    const rocket = wrapper.find('[data-bs-unavailable][data-bs-action="rocket"]');
    expect(rocket.text()).toContain('Rocket Strike');
    expect(rocket.text()).toContain('Strikes open after the first battle.');
    expect(rocket.attributes('aria-disabled')).toBe('true');
  });

  it('folds the disabled members of a usable group inside that group', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    const group = wrapper.find('[data-bs-action-group="Buy and unlock"]');
    expect(group.text()).toContain('1 action');
    await group.trigger('click');
    expect(usable(wrapper)).toEqual(['unlockUnit']);
    expect(toggle(wrapper).text()).toContain('1 not available yet');
    expect(await folded(wrapper)).toEqual(['buyTech']);
  });

  it('starts nothing when a folded entry is pressed', async () => {
    const { wrapper, controller } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    await folded(wrapper);
    await wrapper.find('[data-bs-unavailable][data-bs-action="cancelStrike"]').trigger('click');
    expect(controller.start).not.toHaveBeenCalled();
    expect(controller.execute).not.toHaveBeenCalled();
  });

  it('shows only the row when nothing at all is usable', async () => {
    const { wrapper } = mountPanel(
      [{ name: 'pass', prompt: 'Pass' }],
      { disabledActions: { pass: 'Wait for the battle to finish.' } },
    );
    expect(usable(wrapper)).toEqual([]);
    expect(toggle(wrapper).text()).toContain('1 not available yet');
    expect(await folded(wrapper)).toEqual(['pass']);
  });
});

describe('the fold row is reachable by keyboard and screen reader', () => {
  it('is a real button that says whether it is open and what it controls', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    const button = toggle(wrapper);
    expect(button.element.tagName).toBe('BUTTON');
    expect(button.attributes('aria-expanded')).toBe('false');
    await button.trigger('click');
    expect(button.attributes('aria-expanded')).toBe('true');
    const list = wrapper.find(`#${button.attributes('aria-controls')}`);
    expect(list.findAll('[data-bs-unavailable]')).toHaveLength(4);
    expect(list.attributes('aria-label')).toBe('Not available yet');
  });

  it('puts the keyboard on the row when a level holds nothing usable', async () => {
    const { wrapper } = mountPanel(
      [{ name: 'pass', prompt: 'Pass', group: ['Turn'] }, { name: 'look', prompt: 'Look' }],
      { disabledActions: { look: 'It is too dark.' } },
    );
    await wrapper.find('[data-bs-action-group="Turn"]').trigger('click');
    await nextTick();
    await wrapper.setProps({ disabledActions: { look: 'It is too dark.', pass: 'Wait for the battle.' } });
    await nextTick();
    await nextTick();
    expect(document.activeElement?.hasAttribute('data-bs-unavailable-toggle')).toBe(true);
  });

  it('keeps folded entries in the tab order, so their reasons can be reached', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    await folded(wrapper);
    for (const entry of wrapper.findAll('[data-bs-unavailable]')) {
      expect(entry.attributes('disabled')).toBeUndefined();
      expect(entry.attributes('aria-describedby')).toBeTruthy();
    }
  });

  it('closes again when the player moves to another level', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    await folded(wrapper);
    await wrapper.find('[data-bs-action-group="Buy and unlock"]').trigger('click');
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[data-bs-unavailable]').isVisible()).toBe(false);
  });
});

describe('a player is never left standing in a dead level', () => {
  const NO_GEARS = { ...ROUND_ONE, unlockUnit: 'You have no gears left.' };

  it('shows them the parent, and says why, when the last usable action of their level is disabled', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    await wrapper.find('[data-bs-action-group="Buy and unlock"]').trigger('click');

    await wrapper.setProps({ disabledActions: NO_GEARS });
    await nextTick();
    expect(wrapper.find('.action-menu-header').exists()).toBe(false);
    expect(usable(wrapper)).toEqual(['checkIn', 'buyPack']);
    expect(wrapper.find('[data-bs-menu-announcement]').text())
      .toBe('Buy and unlock has nothing available yet. Showing all actions.');
    expect(await folded(wrapper)).toContain('unlockUnit');
  });

  it('brings them back to their level when a hold on its only usable action lifts', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    await wrapper.find('[data-bs-action-group="Buy and unlock"]').trigger('click');

    await wrapper.setProps({ disabledActions: NO_GEARS });
    await nextTick();
    await wrapper.setProps({ disabledActions: ROUND_ONE });
    await nextTick();
    expect(wrapper.find('.action-menu-label').text()).toBe('Buy and unlock');
    expect(usable(wrapper)).toEqual(['unlockUnit']);
  });

  it('shows the top level while nothing at all is usable, and brings them back after', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    await wrapper.find('[data-bs-action-group="Buy and unlock"]').trigger('click');

    const everything = Object.fromEntries(WINDUP.map((a) => [a.name, 'The battle is playing.']));
    await wrapper.setProps({ disabledActions: everything });
    await nextTick();
    expect(wrapper.find('.action-menu-header').exists()).toBe(false);
    expect(usable(wrapper)).toEqual([]);

    await wrapper.setProps({ disabledActions: undefined });
    await nextTick();
    expect(wrapper.find('.action-menu-label').text()).toBe('Buy and unlock');
  });

  it('still drops a level for good when its actions are no longer offered at all', async () => {
    const { wrapper } = mountPanel(WINDUP);
    await wrapper.find('[data-bs-action-group="Buy and unlock"]').trigger('click');

    await wrapper.setProps({ availableActions: ['checkIn', 'buyPack'] });
    await nextTick();
    expect(wrapper.find('[data-bs-menu-announcement]').text())
      .toBe('Buy and unlock is no longer available. Showing all actions.');
    await wrapper.setProps({ availableActions: WINDUP.map((a) => a.name) });
    await nextTick();
    expect(wrapper.find('.action-menu-header').exists()).toBe(false);
  });
});

describe('an overlay pointing at a folded action', () => {
  it('points at the fold row while it is shut, and at the action once it is open', async () => {
    const { wrapper } = mountPanel(WINDUP, { disabledActions: ROUND_ONE });
    const target = { kind: 'action', actionName: 'rocket' } as const;
    expect(findAnchor(target)).toBe(toggle(wrapper).element);
    await toggle(wrapper).trigger('click');
    expect(findAnchor(target)).toBe(wrapper.find('[data-bs-action="rocket"]').element);
  });
});
