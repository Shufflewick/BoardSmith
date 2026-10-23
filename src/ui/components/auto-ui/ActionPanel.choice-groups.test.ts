// @vitest-environment jsdom
/**
 * GROUPED CHOICES, FROM THE GAME'S DEFINITION TO THE PANEL (#1439).
 *
 * A game puts each choice of a `chooseFrom` or `chooseElement` under a category
 * path. The panel shows one level at a time: a category's button opens it and
 * submits nothing, Back goes up a level, and a category with no choices does not
 * appear. The board still offers every candidate, so a click there answers the
 * same pick whatever category the panel is showing.
 *
 * Driven end to end: the engine's actions, the live session host answering
 * `resolveChoices`, the table wiring GameShell uses, and the real ActionPanel.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { Game, Player, Piece, Action, actionStep, loop, type GameOptions } from '../../../engine/index.js';
import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { BOARD_INTERACTION_KEY } from '../../composables/useBoardInteraction.js';
import { mountLiveSeat, settle } from '../../composables/table-wiring.test-helper.js';

class Building extends Piece<ArmyGame> {
  kind!: string;
}

class Plot extends Piece<ArmyGame> {
  tier!: number;
}

class ArmyGame extends Game<ArmyGame, Player> {
  recruited: string[] = [];
  upgraded: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.create(Building, 'Barracks', { kind: 'Military' });
    this.create(Building, 'Farm', { kind: 'Economy' });
    this.create(Building, 'Mill', { kind: 'Economy' });
    // More plots than the panel lists flat, so ungrouped they would go to the board.
    for (let i = 0; i < 30; i++) this.create(Plot, `Plot ${i + 1}`, { tier: Math.floor(i / 10) + 1 });
    this.registerActions(
      Action.create<ArmyGame>('recruit')
        .prompt('Recruit')
        .chooseFrom('unit', {
          prompt: 'Choose a unit',
          choices: ['Scout', 'Rifleman', 'Sniper', 'Tank'],
          group: (unit) => (unit === 'Scout' ? [] : unit === 'Tank' ? ['Vehicles', 'Heavy'] : ['Infantry']),
          disabled: (unit) => (unit === 'Sniper' ? 'You need a rifle range first.' : false),
        })
        .execute(({ unit }, ctx) => {
          ctx.game.recruited.push(unit);
        }),
      Action.create<ArmyGame>('upgrade')
        .prompt('Upgrade')
        .chooseElement('building', {
          prompt: 'Choose a building',
          elements: (ctx) => [...ctx.game.all(Building)],
          group: (building) => [building.kind],
        })
        .execute(({ building }, ctx) => {
          ctx.game.upgraded.push(building.name!);
        }),
      Action.create<ArmyGame>('deploy')
        .prompt('Deploy')
        .chooseFrom('square', {
          prompt: 'Choose a square',
          choices: ['a1', 'a2', 'b1'],
          // Each choice names its own board square, so ungrouped it would be listed apart as anchored.
          boardRefs: (square) => ({ refs: [{ ref: { notation: square }, role: 'target' }] }),
          group: (square) => [`Rank ${square[0]}`],
        })
        .execute(() => {}),
      Action.create<ArmyGame>('build')
        .prompt('Build')
        .chooseElement('plot', {
          prompt: 'Choose a plot',
          elements: (ctx) => [...ctx.game.all(Plot)],
          group: (plot) => [`Row ${plot.tier}`],
        })
        .execute(() => {}),
    );
    this.setFlow({ root: loop({ maxIterations: 20, do: actionStep({ player: (ctx) => ctx.game.getPlayer(1)!, actions: ['recruit', 'upgrade', 'build', 'deploy'] }) }) });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function panelAt(action: 'recruit' | 'upgrade' | 'build' | 'deploy') {
  const seat = await mountLiveSeat(ArmyGame, 'choice-groups', mounted);
  const wrapper = mount(ActionPanel, {
    attachTo: document.body,
    props: {
      availableActions: seat.seatState.value.availableActions ?? [],
      actionMetadata: seat.wiring.actionMetadata.value,
      isMyTurn: true,
    },
    global: {
      provide: {
        [GAME_CONTEXT_KEYS.actionController as symbol]: seat.wiring.controller,
        [BOARD_INTERACTION_KEY as symbol]: seat.board,
      },
    },
  });
  mounted.push(wrapper);
  await wrapper.get(`[data-bs-action="${action}"]`).trigger('click');
  await settle();
  return { ...seat, wrapper };
}

/** What the panel offers at the level it is showing: categories in brackets. */
const shown = (wrapper: VueWrapper) =>
  wrapper.findAll('.selection-input .choice-btn:not(.skip-btn)').map((button) => {
    const category = button.attributes('data-bs-choice-group');
    return category ? `[${category}]` : button.text();
  });

const openCategory = async (wrapper: VueWrapper, label: string) => {
  await wrapper.get(`[data-bs-choice-group="${label}"]`).trigger('click');
  await settle();
};

describe('grouped chooseFrom choices in the Action Panel (#1439)', () => {
  it('shows the top level: the categories and the ungrouped choices', async () => {
    const { wrapper } = await panelAt('recruit');
    expect(shown(wrapper)).toEqual(['Scout', '[Infantry]', '[Vehicles]']);
  });

  it('drills down one level at a time, without submitting anything', async () => {
    const { wrapper, session, wiring } = await panelAt('recruit');
    await openCategory(wrapper, 'Vehicles');
    expect(shown(wrapper)).toEqual(['[Heavy]']);
    await openCategory(wrapper, 'Heavy');
    expect(shown(wrapper)).toEqual(['Tank']);
    expect(wiring.controller.currentAction.value).toBe('recruit');
    expect(wiring.controller.currentArgs.value['unit']).toBeUndefined();
    expect(session.readGame().recruited).toEqual([]);
  });

  it('goes back up one level at a time', async () => {
    const { wrapper } = await panelAt('recruit');
    await openCategory(wrapper, 'Vehicles');
    await openCategory(wrapper, 'Heavy');
    await wrapper.get('[data-bs-choice-back]').trigger('click');
    await settle();
    expect(shown(wrapper)).toEqual(['[Heavy]']);
    await wrapper.get('[data-bs-choice-back]').trigger('click');
    await settle();
    expect(shown(wrapper)).toEqual(['Scout', '[Infantry]', '[Vehicles]']);
    expect(wrapper.find('[data-bs-choice-back]').exists()).toBe(false);
  });

  it('moves keyboard focus into a category, and back onto its button', async () => {
    const { wrapper } = await panelAt('recruit');
    await openCategory(wrapper, 'Infantry');
    expect(document.activeElement?.textContent?.trim()).toBe('Rifleman');
    await wrapper.get('[data-bs-choice-back]').trigger('click');
    await settle();
    expect(document.activeElement?.getAttribute('data-bs-choice-group')).toBe('Infantry');
  });

  it('keeps a disabled choice and its reason inside its category', async () => {
    const { wrapper } = await panelAt('recruit');
    await openCategory(wrapper, 'Infantry');
    expect(shown(wrapper)).toEqual(['Rifleman', 'Sniper']);
    const sniper = wrapper.findAll('.choice-btn').find((b) => b.text() === 'Sniper')!;
    expect(sniper.attributes('aria-disabled')).toBe('true');
  });

  it('answers the pick from inside a category, as the server accepts it', async () => {
    const { wrapper, session } = await panelAt('recruit');
    await openCategory(wrapper, 'Infantry');
    await wrapper.findAll('.choice-btn').find((b) => b.text() === 'Rifleman')!.trigger('click');
    await settle();
    expect(session.readGame().recruited).toEqual(['Rifleman']);
  });

  it('groups choices that name their own board squares, rather than listing them apart', async () => {
    const { wrapper } = await panelAt('deploy');
    expect(shown(wrapper)).toEqual(['[Rank a]', '[Rank b]']);
    await openCategory(wrapper, 'Rank a');
    expect(shown(wrapper)).toEqual(['a1', 'a2']);
  });
});

describe('grouped chooseElement candidates in the Action Panel (#1439)', () => {
  it('shows the categories, and the elements inside one', async () => {
    const { wrapper } = await panelAt('upgrade');
    expect(shown(wrapper)).toEqual(['[Military]', '[Economy]']);
    await openCategory(wrapper, 'Economy');
    expect(shown(wrapper)).toEqual(['Farm', 'Mill']);
  });

  it('shows the categories of a large grouped set rather than handing it to the board', async () => {
    const { wrapper } = await panelAt('build');
    expect(wrapper.find('.board-handoff-btn').exists()).toBe(false);
    expect(shown(wrapper)).toEqual(['[Row 1]', '[Row 2]', '[Row 3]']);
  });

  it('takes a board click on an element in a category the panel has not opened', async () => {
    const { wrapper, board, session } = await panelAt('upgrade');
    await openCategory(wrapper, 'Economy');
    const barracks = session.readGame().first(Building, 'Barracks')!;
    board.triggerElementSelect({ id: barracks.id });
    await settle();
    expect(session.readGame().upgraded).toEqual(['Barracks']);
  });
});
