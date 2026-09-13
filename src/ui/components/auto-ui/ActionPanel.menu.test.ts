// @vitest-environment jsdom
/**
 * THE ACTION PANEL'S START-BUTTON HIERARCHY (#228).
 *
 * Every line of the issue's expected behaviour that a mounted component can
 * hold, held here. The three it CANNOT hold -- real focus across a real
 * re-render, real Escape from a real keyboard, and a narrow real viewport --
 * are in `scripts/action-menu-browser.mjs`, because this repo's own rule is
 * that a component test proves markup, copy, props, branches and events and
 * nothing visual, and a menu that renders correctly while trapping focus would
 * pass everything below.
 *
 * THE ONE THAT MATTERS MOST is `no group interaction is a game command`: the
 * controller is a spy on every verb it has, and opening, entering, leaving and
 * re-entering groups must leave every one of them uncalled.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { stubActionController } from './action-panel-controller.test-helper.js';

type Meta = {
  name: string;
  prompt?: string;
  group?: string[];
  order?: number;
  selections?: unknown[];
  suppressFromActionPanel?: boolean;
  help?: string;
};

function mountPanel(actions: Meta[], extra: Record<string, unknown> = {}) {
  const controller = stubActionController();
  const metadata: Record<string, unknown> = {};
  for (const action of actions) metadata[action.name] = { selections: [], ...action };
  const wrapper = mount(ActionPanel, {
    global: { provide: { [GAME_CONTEXT_KEYS.actionController as symbol]: controller } },
    attachTo: document.body,
    props: {
      availableActions: actions.map((a) => a.name),
      actionMetadata: metadata,
      playerSeat: 1,
      isMyTurn: true,
      ...extra,
    },
  });
  return { wrapper, controller };
}

const leafNames = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('[data-bs-action]').map((b) => b.attributes('data-bs-action')!);

const groupLabels = (wrapper: ReturnType<typeof mount>): string[] =>
  wrapper.findAll('[data-bs-action-group]').map((b) => b.attributes('data-bs-action-group')!);

const LACUNA: Meta[] = [
  { name: 'construct', prompt: 'Construct building', order: 10 },
  { name: 'upgrade', prompt: 'Upgrade building', order: 20 },
  { name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'], order: 30 },
  { name: 'dumpWater', prompt: 'Dump water', group: ['Dump'], order: 31 },
  { name: 'renamePlanet', prompt: 'Rename planet', group: ['More', 'Empire settings'], order: 90 },
  { name: 'describeEmpire', prompt: 'Describe empire', group: ['More', 'Empire settings'], order: 91 },
  { name: 'skipMission', prompt: 'Skip mission', group: ['More'], order: 80 },
];

describe('a game with no grouping metadata keeps the flat panel it had', () => {
  it('renders every available action as a top-level button and draws no menu chrome', () => {
    const { wrapper } = mountPanel([
      { name: 'move', prompt: 'Move' },
      { name: 'pass', prompt: 'Pass' },
    ]);
    expect(leafNames(wrapper)).toEqual(['move', 'pass']);
    expect(groupLabels(wrapper)).toEqual([]);
    expect(wrapper.find('[data-bs-menu-back]').exists()).toBe(false);
    expect(wrapper.find('.action-menu-header').exists()).toBe(false);
  });
});

describe('a group occupies one button, and its children appear only after opening', () => {
  it('shows the group button and hides its members at the parent level', () => {
    const { wrapper } = mountPanel(LACUNA);
    expect(leafNames(wrapper)).toEqual(['construct', 'upgrade']);
    expect(groupLabels(wrapper)).toEqual(['Dump', 'More']);
  });

  it('replaces the level with the group members when it is opened', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    expect(leafNames(wrapper)).toEqual(['dumpOre', 'dumpWater']);
    expect(groupLabels(wrapper)).toEqual([]);
  });

  it('walks into a nested group and shows only the innermost level', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="More"]').trigger('click');
    expect(leafNames(wrapper)).toEqual(['skipMission']);
    expect(groupLabels(wrapper)).toEqual(['Empire settings']);

    await wrapper.find('[data-bs-action-group="Empire settings"]').trigger('click');
    expect(leafNames(wrapper)).toEqual(['renamePlanet', 'describeEmpire']);
    expect(groupLabels(wrapper)).toEqual([]);
  });

  it('names the level it is in, and where Back goes', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="More"]').trigger('click');
    expect(wrapper.find('.action-menu-label').text()).toBe('More');
    expect(wrapper.find('[data-bs-menu-back]').attributes('aria-label')).toBe('Back to all actions');

    await wrapper.find('[data-bs-action-group="Empire settings"]').trigger('click');
    expect(wrapper.find('.action-menu-label').text()).toBe('More / Empire settings');
    expect(wrapper.find('[data-bs-menu-back]').attributes('aria-label')).toBe('Back to More');
  });

  it('says on the group button that it opens a level, and how many actions are in it', async () => {
    const { wrapper } = mountPanel(LACUNA);
    const dump = wrapper.find('[data-bs-action-group="Dump"]');
    expect(dump.text()).toContain('Dump');
    expect(dump.text()).toContain('2 actions');
    const more = wrapper.find('[data-bs-action-group="More"]');
    // One action and one nested group: both are things behind the button.
    expect(more.text()).toContain('2 actions');
  });
});

describe('back navigation', () => {
  it('goes up exactly one level per Back press', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="More"]').trigger('click');
    await wrapper.find('[data-bs-action-group="Empire settings"]').trigger('click');

    await wrapper.find('[data-bs-menu-back]').trigger('click');
    expect(groupLabels(wrapper)).toEqual(['Empire settings']);
    expect(wrapper.find('.action-menu-label').text()).toBe('More');

    await wrapper.find('[data-bs-menu-back]').trigger('click');
    expect(groupLabels(wrapper)).toEqual(['Dump', 'More']);
    expect(wrapper.find('.action-menu-header').exists()).toBe(false);
  });

  it('goes up one level on Escape as well as Back', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    await wrapper.find('.action-panel').trigger('keydown', { key: 'Escape' });
    expect(groupLabels(wrapper)).toEqual(['Dump', 'More']);
  });

  it('restores focus to the group button it came out of', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    await nextTick();
    await wrapper.find('[data-bs-menu-back]').trigger('click');
    await nextTick();
    expect(document.activeElement?.getAttribute('data-bs-action-group')).toBe('Dump');
    wrapper.unmount();
  });

  it('moves focus into the level it just opened', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    await nextTick();
    expect(document.activeElement?.getAttribute('data-bs-action')).toBe('dumpOre');
    wrapper.unmount();
  });
});

describe('only available actions contribute to the hierarchy', () => {
  it('drops a group whose every member has gone', async () => {
    const { wrapper } = mountPanel(LACUNA);
    expect(groupLabels(wrapper)).toEqual(['Dump', 'More']);

    await wrapper.setProps({
      availableActions: ['construct', 'skipMission', 'renamePlanet'],
    });
    expect(groupLabels(wrapper)).toEqual(['More']);
  });

  it('drops the player back to the surviving parent when the open level empties', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="More"]').trigger('click');
    await wrapper.find('[data-bs-action-group="Empire settings"]').trigger('click');
    expect(leafNames(wrapper)).toEqual(['renamePlanet', 'describeEmpire']);

    // Both members of the innermost group go; `More` still has `skipMission`.
    await wrapper.setProps({ availableActions: ['construct', 'skipMission'] });
    await nextTick();
    expect(wrapper.find('.action-menu-label').text()).toBe('More');
    expect(leafNames(wrapper)).toEqual(['skipMission']);
  });

  it('lands on the root when the whole open branch has gone, and says so once', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="More"]').trigger('click');

    await wrapper.setProps({ availableActions: ['construct', 'dumpOre'] });
    await nextTick();
    expect(wrapper.find('.action-menu-header').exists()).toBe(false);
    expect(leafNames(wrapper)).toEqual(['construct']);
    expect(groupLabels(wrapper)).toEqual(['Dump']);
    expect(wrapper.find('[data-bs-menu-announcement]').text()).toContain('no longer available');
  });

  it('keeps the open level when availability changes elsewhere', async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');

    await wrapper.setProps({
      availableActions: ['dumpOre', 'dumpWater', 'renamePlanet', 'skipMission'],
    });
    await nextTick();
    expect(wrapper.find('.action-menu-label').text()).toBe('Dump');
    expect(leafNames(wrapper)).toEqual(['dumpOre', 'dumpWater']);
  });

  it('shows a member that becomes available while its group is open', async () => {
    const { wrapper } = mountPanel(LACUNA, { });
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    expect(leafNames(wrapper)).toEqual(['dumpOre', 'dumpWater']);

    await wrapper.setProps({
      availableActions: [...LACUNA.map((a) => a.name), 'dumpFood'],
      actionMetadata: {
        ...Object.fromEntries(LACUNA.map((a) => [a.name, { selections: [], ...a }])),
        dumpFood: { name: 'dumpFood', prompt: 'Dump food', group: ['Dump'], order: 32, selections: [] },
      },
    });
    await nextTick();
    expect(leafNames(wrapper)).toEqual(['dumpOre', 'dumpWater', 'dumpFood']);
  });
});

describe('display order', () => {
  it('sorts leaves and groups by declared order, a group sitting where its lowest member does', () => {
    const { wrapper } = mountPanel([
      { name: 'rename', prompt: 'Rename', group: ['More'], order: 90 },
      { name: 'construct', prompt: 'Construct', order: 10 },
      { name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'], order: 30 },
      { name: 'upgrade', prompt: 'Upgrade', order: 20 },
    ]);
    const rendered = wrapper
      .findAll('[data-bs-action], [data-bs-action-group]')
      .map((b) => b.attributes('data-bs-action') ?? `[${b.attributes('data-bs-action-group')}]`);
    expect(rendered).toEqual(['construct', 'upgrade', '[Dump]', '[More]']);
  });
});

describe('grouping changes nothing about a leaf', () => {
  it("keeps a grouped action's disabled reason on its button", async () => {
    const { wrapper } = mountPanel(LACUNA, {
      disabledActions: { dumpOre: 'You have no ore to dump.' },
    });
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    const button = wrapper.find('[data-bs-action="dumpOre"]');
    expect(button.attributes('aria-disabled')).toBe('true');
    expect(button.attributes('data-bs-disabled-reason')).toBe('You have no ore to dump.');
  });

  it('keeps the help affordance on a grouped action', async () => {
    const { wrapper } = mountPanel(
      [{ name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'], help: 'Throws ore away.' }],
      { isActionHelpVisible: true },
    );
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    expect(wrapper.findComponent({ name: 'ActionHelpPopover' }).exists()).toBe(true);
  });

  it('starts the existing controller when a grouped leaf is selected', async () => {
    const { wrapper, controller } = mountPanel([
      { name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'], selections: [
        { name: 'amount', type: 'number', prompt: 'How much?' },
      ] },
      { name: 'construct', prompt: 'Construct' },
    ]);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    await wrapper.find('[data-bs-action="dumpOre"]').trigger('click');
    expect(controller.start).toHaveBeenCalledWith('dumpOre', undefined);
    expect(controller.execute).not.toHaveBeenCalled();
  });

  it('executes a no-selection grouped leaf exactly as a flat one', async () => {
    const { wrapper, controller } = mountPanel([
      { name: 'skipMission', prompt: 'Skip mission', group: ['More'] },
      { name: 'construct', prompt: 'Construct' },
    ]);
    await wrapper.find('[data-bs-action-group="More"]').trigger('click');
    await wrapper.find('[data-bs-action="skipMission"]').trigger('click');
    expect(controller.execute).toHaveBeenCalledWith('skipMission', {});
  });
});

describe('opening a menu is not a game command', () => {
  it('touches nothing on the controller while navigating in, down, out and back in', async () => {
    const { wrapper, controller } = mountPanel(LACUNA);
    const verbs = ['start', 'fill', 'skip', 'cancel', 'clear', 'execute',
      'toggleMultiSelect', 'confirmMultiSelect'] as const;

    await wrapper.find('[data-bs-action-group="More"]').trigger('click');
    await wrapper.find('[data-bs-action-group="Empire settings"]').trigger('click');
    await wrapper.find('[data-bs-menu-back]').trigger('click');
    await wrapper.find('.action-panel').trigger('keydown', { key: 'Escape' });
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');

    for (const verb of verbs) {
      expect(controller[verb], `${verb} was called by menu navigation`).not.toHaveBeenCalled();
    }
  });

  it("emits none of the panel's own events while navigating", async () => {
    const { wrapper } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    await wrapper.find('[data-bs-menu-back]').trigger('click');
    // The panel's declared emits are the shell's cues to move the board or the
    // game on. A group interaction produces none of them.
    expect(wrapper.emitted('selectingElement')).toBeUndefined();
    expect(wrapper.emitted('cancelSelection')).toBeUndefined();
    expect(wrapper.emitted('undo')).toBeUndefined();
  });
});

describe('the panel returns to a coherent menu state after an action', () => {
  it('is back at the level the action was started from once it is cancelled', async () => {
    const { wrapper, controller } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    controller.currentAction.value = 'dumpOre';
    await nextTick();
    expect(wrapper.find('.action-config').exists()).toBe(true);

    controller.currentAction.value = null;
    await nextTick();
    expect(wrapper.find('.action-menu-label').text()).toBe('Dump');
    expect(leafNames(wrapper)).toEqual(['dumpOre', 'dumpWater']);
  });

  it('lands on the root when the level the action was started from is gone', async () => {
    const { wrapper, controller } = mountPanel(LACUNA);
    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    controller.currentAction.value = 'dumpOre';
    await nextTick();

    // The action consumed the last of the ore: neither dump is offered now.
    controller.currentAction.value = null;
    await wrapper.setProps({ availableActions: ['construct', 'upgrade'] });
    await nextTick();
    expect(wrapper.find('.action-menu-header').exists()).toBe(false);
    expect(leafNames(wrapper)).toEqual(['construct', 'upgrade']);
  });
});

describe('the level survives the moment a push has no offers in it yet (#253)', () => {
  /**
   * THE INTERSTITIAL IS NOT AN EMPTY MENU.
   *
   * A world push is two frames (#244): the state arrives, the offers follow, and
   * between them the panel is handed NO available actions at all -- "not yet",
   * which `useWorldHost` keeps distinct from "nothing". A table hands the panel
   * the same blank whenever a turn passes. Resolving the open path against that
   * blank answers the root for every path, so writing the answer back destroyed
   * the level the player was standing in a tick before the real set arrived,
   * and the announcement told a screen-reader user their group had gone when it
   * had not. These drive that sequence in the order the browser produces it,
   * which is the half `scripts/action-menu-browser.mjs` caught and this file
   * could not: every `setProps` here used to hand over a populated set.
   */
  /** What is left after `dumpOre` spent the ore: `dumpWater` survives, so does `Dump`. */
  const ORE_SPENT = ['construct', 'upgrade', 'dumpWater', 'skipMission'];
  /** What is left after another seat closed the registry: `Empire settings` is gone, `More` is not. */
  const REGISTRY_CLOSED = ['construct', 'skipMission'];

  /** A world push, in its two halves: the blank, then the set. */
  const blankThen = async (
    wrapper: ReturnType<typeof mount>,
    available: string[],
  ): Promise<void> => {
    await wrapper.setProps({ availableActions: [] });
    await nextTick();
    await wrapper.setProps({ availableActions: available });
    await nextTick();
  };

  /** A panel with the player standing in the level `path` names, keyboard and all. */
  const standingIn = async (path: string[]) => {
    const mounted = mountPanel(LACUNA);
    for (const label of path) {
      await mounted.wrapper.find(`[data-bs-action-group="${label}"]`).trigger('click');
    }
    await nextTick();
    return mounted;
  };

  it('comes back to the level the action was taken from', async () => {
    const { wrapper } = await standingIn(['Dump']);
    expect(leafNames(wrapper)).toEqual(['dumpOre', 'dumpWater']);

    await blankThen(wrapper, ORE_SPENT);
    expect(wrapper.find('.action-menu-label').text()).toBe('Dump');
    expect(leafNames(wrapper)).toEqual(['dumpWater']);
  });

  it('tells a screen reader nothing about a group that never went away', async () => {
    const { wrapper } = await standingIn(['Dump']);
    await blankThen(wrapper, ORE_SPENT);
    expect(wrapper.find('[data-bs-menu-announcement]').text()).toBe('');
  });

  it('still truncates to the surviving parent when the blank is followed by a real loss', async () => {
    const { wrapper } = await standingIn(['More', 'Empire settings']);
    expect(leafNames(wrapper)).toEqual(['renamePlanet', 'describeEmpire']);

    await blankThen(wrapper, REGISTRY_CLOSED);
    expect(wrapper.find('.action-menu-label').text()).toBe('More');
    expect(leafNames(wrapper)).toEqual(['skipMission']);
    const said = wrapper.find('[data-bs-menu-announcement]').text();
    expect(said).toContain('Empire settings');
    expect(said).toContain('no longer available');
  });

  it('leaves the keyboard on a control in the level it moved the player to', async () => {
    const { wrapper } = await standingIn(['More', 'Empire settings']);
    // Where opening the level put it, and the node the loss is about to remove.
    expect(document.activeElement?.getAttribute('data-bs-action')).toBe('renamePlanet');

    await blankThen(wrapper, REGISTRY_CLOSED);
    await nextTick();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute('data-bs-action')).toBe('skipMission');
    wrapper.unmount();
  });

  it('leaves the keyboard in the level it kept the player in', async () => {
    const { wrapper } = await standingIn(['Dump']);
    await blankThen(wrapper, ORE_SPENT);
    await nextTick();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute('data-bs-action')).toBe('dumpWater');
    wrapper.unmount();
  });

  it('remembers a level across a blank that nothing follows for a while', async () => {
    // The blank can be the last thing that happens for a while: a quiet world
    // sends no second set until something moves. The path is REQUESTED, never
    // trusted, so it waits rather than being thrown away.
    const { wrapper } = await standingIn(['Dump']);
    await blankThen(wrapper, LACUNA.map((a) => a.name));
    expect(wrapper.find('.action-menu-label').text()).toBe('Dump');
    expect(leafNames(wrapper)).toEqual(['dumpOre', 'dumpWater']);
  });
});

describe('suppressFromActionPanel and grouping are one mechanism, not two', () => {
  it('keeps the hierarchy when every available action is suppressed', async () => {
    // The restore-everything fallback exists so the panel is never a prompt
    // with nothing to press. It decides MEMBERSHIP -- which actions are drawn --
    // and grouping decides ARRANGEMENT. Restoring them as a FLAT list would be
    // the fallback overruling the game's hierarchy, which is the one thing
    // #228 says must not happen.
    const { wrapper } = mountPanel([
      { name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'], suppressFromActionPanel: true },
      { name: 'dumpWater', prompt: 'Dump water', group: ['Dump'], suppressFromActionPanel: true },
    ]);
    expect(groupLabels(wrapper)).toEqual(['Dump']);
    expect(leafNames(wrapper)).toEqual([]);

    await wrapper.find('[data-bs-action-group="Dump"]').trigger('click');
    expect(leafNames(wrapper)).toEqual(['dumpOre', 'dumpWater']);
  });

  it('still hides a suppressed member while an unsuppressed sibling is offered', () => {
    const { wrapper } = mountPanel([
      { name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'], suppressFromActionPanel: true },
      { name: 'construct', prompt: 'Construct' },
    ]);
    expect(groupLabels(wrapper)).toEqual([]);
    expect(leafNames(wrapper)).toEqual(['construct']);
  });
});

describe('grouping survives having no ungrouped action at all', () => {
  it('does not collapse into a flat list when every available action is grouped', () => {
    const { wrapper } = mountPanel([
      { name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'] },
      { name: 'renamePlanet', prompt: 'Rename planet', group: ['More'] },
    ]);
    expect(leafNames(wrapper)).toEqual([]);
    expect(groupLabels(wrapper)).toEqual(['Dump', 'More']);
  });

  it('keeps the Undo button reachable at the root beside the groups', () => {
    const { wrapper } = mountPanel(
      [{ name: 'dumpOre', prompt: 'Dump ore', group: ['Dump'] }],
      { canUndo: true },
    );
    expect(wrapper.find('.undo-btn').exists()).toBe(true);
  });
});
