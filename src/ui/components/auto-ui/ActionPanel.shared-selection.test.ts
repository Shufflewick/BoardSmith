// @vitest-environment jsdom
/**
 * THE ACTION PANEL ON THE ONE SHARED SELECTION (#1641).
 *
 * With nothing selected the panel is the ordinary grouped menu, and the things
 * of a type on the board are reached through their type. A selected thing, from
 * the board or the panel, narrows the menu to its own: a heading naming it, its
 * verbs in their groups, then the verbs of related things. When the board
 * starts a verb from another level the panel follows, and cancel lands there.
 *
 * Driven end to end: the engine's subject types, the live session host, the
 * table wiring GameShell uses, and the real ActionPanel.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import ActionPanel from './ActionPanel.vue';
import type { Game, GameClass } from '../../../engine/index.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { BOARD_INTERACTION_KEY } from '../../composables/useBoardInteraction.js';
import { mountLiveSeat, settle } from '../../composables/table-wiring.test-helper.js';
import { DICE, DiceTrayGame, Die, TOWERS, Tower, WorkshopGame } from '../../composables/shared-selection.test-helper.js';
import type { SubjectChoice } from '../../composables/useActionControllerTypes.js';
import { selectedAttrs } from '../../composables/sharedSelection.js';

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function panel<G extends Game>(GameClass: GameClass<G>) {
  const seat = await mountLiveSeat(GameClass, 'panel-shared-selection', mounted);
  const wrapper = mount(ActionPanel, {
    attachTo: document.body,
    props: {
      availableActions: seat.seatState.value.availableActions ?? [],
      actionMetadata: seat.wiring.actionMetadata.value,
      disabledActions: seat.wiring.disabledActions.value,
      isMyTurn: true,
    },
    global: {
      provide: {
        [GAME_CONTEXT_KEYS.actionController as symbol]: seat.wiring.controller,
        [BOARD_INTERACTION_KEY as symbol]: seat.board,
      },
      stubs: { Teleport: true },
    },
  });
  mounted.push(wrapper);
  await settle();
  const game = () => seat.session.readGame();
  return {
    ...seat,
    wrapper,
    controller: seat.wiring.controller,
    game,
    die: (name: string) => DICE.ref(game().first(Die, name)!),
    tower: (name: string) => TOWERS.ref(game().first(Tower, name)!),
  };
}

/** The buttons of the level now drawn: groups and things in brackets, the fold left out. */
const shown = (wrapper: VueWrapper) =>
  wrapper.findAll('.action-buttons > .action-btn-group > button').flatMap((button) => {
    if (button.attributes('data-bs-unavailable-toggle') !== undefined) return [];
    const group = button.attributes('data-bs-action-group');
    if (group) return [`[${group}]`];
    const thing = button.attributes('data-bs-thing');
    return thing ? [`<${button.text().replace('›', '').trim()}>`] : [button.text()];
  });

const heading = (wrapper: VueWrapper) => wrapper.find('.action-menu-label').text();

async function press(wrapper: VueWrapper, label: string) {
  const button = wrapper.findAll('.action-buttons > .action-btn-group > button').find((candidate) => candidate.text().replace('›', '').trim().startsWith(label));
  if (!button) throw new Error(`No button "${label}" at this level: ${shown(wrapper).join(', ')}`);
  await button.trigger('click');
  await settle();
}

describe('the panel with nothing selected (#1641)', () => {
  it('is the ordinary grouped menu, with the things on the board reached through their type', async () => {
    const { wrapper } = await panel(WorkshopGame);
    expect(shown(wrapper)).toEqual(['[Dice]', '[Towers]', '[Shop]', 'Paint', 'Place a die', 'Pass']);
    await press(wrapper, 'Dice');
    expect(shown(wrapper)).toEqual(['<red showing 1>', '<blue showing 1>', '<green showing 1>']);
  });

  it('draws a top level that is one subject type and nothing else as that type\'s things', async () => {
    const { wrapper } = await panel(DiceTrayGame);
    expect(shown(wrapper)).toEqual(['<red showing 1>', '<blue showing 1>']);
    expect(wrapper.find('[data-bs-menu-back]').exists()).toBe(false);
  });

  it('selects a thing pressed in its list, for the board as well', async () => {
    const { wrapper, controller } = await panel(WorkshopGame);
    await press(wrapper, 'Dice');
    await press(wrapper, 'blue showing 1');
    expect(controller.selection.value).toMatchObject({ type: 'Dice', label: 'blue showing 1' });
    expect(heading(wrapper)).toBe('Dice / blue showing 1');
  });
});

describe('the shared selection on the page (#1642)', () => {
  it('marks the panel with the selected thing as a board marks it with selectedAttrs, and with nothing when none is', async () => {
    const { wrapper, controller, die } = await panel(WorkshopGame);
    const root = () => wrapper.get('.action-panel-root').attributes('data-bs-selection');
    expect(root()).toBeUndefined();
    controller.select(die('red'));
    await settle();
    expect(root()).toBe(selectedAttrs(die('red'))['data-bs-selected']);
    controller.select(null);
    await settle();
    expect(root()).toBeUndefined();
  });
});

describe('the panel on a selected thing (#1641)', () => {
  it('names the thing, lists its verbs, the verbs that take it later and its related things\' verbs, and starts one with the thing filled in', async () => {
    const { wrapper, controller, game, die } = await panel(WorkshopGame);
    controller.select(die('red'));
    await settle();
    expect(heading(wrapper)).toBe('Dice / red showing 1');
    expect(shown(wrapper)).toEqual(['Reroll', 'Draft', 'Place a die', 'Paint: red']);
    await press(wrapper, 'Draft');
    expect(game().log).toEqual(['draft red']);
  });

  it('starts a related thing\'s verb on that thing', async () => {
    const { wrapper, controller, game, die } = await panel(WorkshopGame);
    controller.select(die('blue'));
    await settle();
    await press(wrapper, 'Paint: blue');
    expect(game().log).toEqual(['paint blue']);
  });

  it('treats a verb its thing answered completely as done, never as waiting on the board (#1641 review F4)', async () => {
    const { wrapper, controller, game, die } = await panel(WorkshopGame);
    controller.select(die('red'));
    await settle();
    await press(wrapper, 'Reroll');
    expect(game().log).toEqual(['reroll red']);
    expect(wrapper.emitted('selectingElement')).toBeUndefined();
    expect(wrapper.emitted('cancelSelection')).toHaveLength(1);
  });

  it('folds a verb the thing cannot take now, with its reason', async () => {
    const { wrapper, controller, die } = await panel(WorkshopGame);
    controller.select(die('green'));
    await settle();
    expect(shown(wrapper)).toEqual(['Draft', 'Place a die', 'Paint: green']);
    expect(wrapper.get('[data-bs-unavailable-toggle]').text()).toContain('1 not available yet');
    expect(wrapper.get('[data-bs-unavailable-list]').text()).toContain('The green die is spent.');
  });

  it('offers the verb about the things that belong to it, opened narrowed to them', async () => {
    const { wrapper, controller, tower } = await panel(WorkshopGame);
    controller.select(tower('Chemical Works'));
    await settle();
    expect(shown(wrapper)).toEqual(['Upgrade', 'Buy a blueprint']);
    await press(wrapper, 'Buy a blueprint');
    expect(wrapper.findAll('.selection-input .choice-btn').map((button) => button.text())).toEqual(['Fire Curtain', 'Tar Slick']);
  });

  it('says so when nothing can be done with the thing right now', async () => {
    const { wrapper, controller } = await panel(WorkshopGame);
    controller.select({ type: 'Towers', key: 'ruin', label: 'the ruined tower' });
    await settle();
    expect(wrapper.get('[data-bs-thing-empty]').text()).toBe('Nothing can be done with the ruined tower right now.');
  });

  it('keeps that sentence whole on a phone, where the breadcrumb is cut short (#1627 review F6)', async () => {
    const { wrapper, controller } = await panel(WorkshopGame);
    controller.select({ type: 'Towers', key: 'ruin', label: 'the ruined tower' });
    await settle();
    const style = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ActionPanel.vue'), 'utf-8');
    const at = style.indexOf('@media (max-width: 639px) and (orientation: portrait) {');
    expect(at, 'ActionPanel.vue has no upright-phone block').toBeGreaterThan(-1);
    const phone = style.slice(at, style.indexOf('\n}\n', at));
    const cutting = Array.from(phone.matchAll(/([^{}]+)\{([^}]*)\}/g))
      .filter(([, , body]) => /text-overflow:\s*ellipsis/.test(body))
      .flatMap(([, selectors]) => selectors.split(',').map((selector) => selector.trim()));
    expect(cutting, 'the phone block cuts the breadcrumb short').not.toEqual([]);
    const status = wrapper.get('[data-bs-thing-empty]').element;
    expect(cutting.filter((selector) => status.matches(selector))).toEqual([]);
  });

  it('goes Back to the list the thing sits in, clearing the selection', async () => {
    const { wrapper, controller, die } = await panel(WorkshopGame);
    controller.select(die('red'));
    await settle();
    await wrapper.get('[data-bs-menu-back]').trigger('click');
    await settle();
    expect(controller.selection.value).toBeNull();
    expect(heading(wrapper)).toBe('Dice');
  });

  it('gives way to an open action', async () => {
    const { wrapper, controller, die } = await panel(WorkshopGame);
    controller.select(die('red'));
    await controller.start('placeDie', { subject: die('red') });
    await settle();
    expect(wrapper.find('[data-bs-open-action="placeDie"]').exists()).toBe(true);
    expect(wrapper.find('[data-bs-thing-level]').exists()).toBe(false);
  });
});

describe('the panel following the board (#1641)', () => {
  it('moves to the level of a verb the board started elsewhere, and cancel lands there', async () => {
    const { wrapper, controller } = await panel(WorkshopGame);
    await press(wrapper, 'Dice');
    await controller.start('trade');
    await settle();
    controller.cancel();
    await settle();
    expect(heading(wrapper)).toBe('Shop');
    expect(shown(wrapper)).toEqual(['Buy a blueprint', 'Trade']);
  });

  it('looks away from a selected thing to show a verb that is not about it, keeping the selection', async () => {
    const { wrapper, controller, die } = await panel(WorkshopGame);
    controller.select(die('red'));
    await settle();
    await controller.start('trade');
    await settle();
    controller.cancel();
    await settle();
    expect(heading(wrapper)).toBe('Shop');
    expect(controller.selection.value).toMatchObject({ label: 'red showing 1' });
  });
});

describe('the panel on a selection the game keeps (#1641)', () => {
  it('looks away on Back from a thing the game cannot unselect, and returns when the game selects another', async () => {
    const { wrapper, controller, die } = await panel(WorkshopGame);
    const stored = ref<SubjectChoice | null>(die('red'));
    controller.bindSubjectSelection({ read: () => stored.value, write: (thing) => { if (thing) stored.value = thing; }, selects: [] });
    await settle();
    expect(heading(wrapper)).toBe('Dice / red showing 1');
    await wrapper.get('[data-bs-menu-back]').trigger('click');
    await settle();
    expect(controller.selection.value).toMatchObject({ label: 'red showing 1' });
    expect(shown(wrapper)).toEqual(['<red showing 1>', '<blue showing 1>', '<green showing 1>']);
    await press(wrapper, 'blue showing 1');
    expect(heading(wrapper)).toBe('Dice / blue showing 1');
  });
});
