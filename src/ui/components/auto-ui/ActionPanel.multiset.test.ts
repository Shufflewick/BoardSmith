// @vitest-environment jsdom
/**
 * #1561: A MULTISELECT PICK CAN TAKE A VALUE AS MANY TIMES AS IT IS OFFERED.
 *
 * The engine accepts a choices list that offers one value more than once, and
 * a submission holding up to that many copies (WR-07). The Action Panel draws
 * one checkbox per entry, and each entry is one slot: the panel and a custom
 * UI share the draft through the controller, which names a slot by its value
 * and which copy of that value it is.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { BOARD_INTERACTION_KEY } from '../../composables/useBoardInteraction.js';
import type { TableActionWiring } from '../../composables/useTableActionWiring.js';
import { mountLiveSeat, settle } from '../../composables/table-wiring.test-helper.js';
import type { HeadlessSession } from '../../../testing/headless-session.js';
import { Game, Player, Action, actionStep, type GameOptions } from '../../../engine/index.js';

class AllocationGame extends Game<AllocationGame, Player> {
  allocated: unknown[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<AllocationGame>('allocate')
        .chooseFrom('allocations', {
          choices: () => ['basic', 'basic', 'basic', 'm1', 'm2'],
          multiSelect: { min: 3, max: 3 },
        })
        .execute((args, ctx) => {
          (ctx.game as AllocationGame).allocated = args.allocations as unknown[];
          return { success: true };
        }),
    );
    // `prepare` is shared by one evaluation's `disabled` calls, which is how a
    // game disables one copy of a value and not another.
    const spending = (name: string, spent: (copy: number) => boolean) =>
      Action.create<AllocationGame>(name)
        .chooseFrom('allocations', {
          choices: ['basic', 'basic', 'm1'],
          multiSelect: { min: 1, max: 2 },
          prepare: () => ({ seen: 0 }),
          disabled: (choice, _ctx, prepared) =>
            choice === 'basic' && spent((prepared as { seen: number }).seen++) ? 'spent' : false,
        })
        .execute((args, ctx) => {
          (ctx.game as AllocationGame).allocated = args.allocations as unknown[];
          return { success: true };
        });
    this.registerAction(spending('firstSpent', (copy) => copy === 0));
    this.registerAction(spending('lastSpent', (copy) => copy === 1));
    this.setFlow({
      root: actionStep({
        actions: ['allocate', 'firstSpent', 'lastSpent'],
        player: (ctx) => ctx.game.getPlayer(1)!,
        repeatUntil: () => false,
        maxMoves: 5,
      }),
    });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

interface Table {
  session: HeadlessSession<AllocationGame>;
  controller: TableActionWiring['controller'];
  panel: VueWrapper;
}

async function table(action = 'allocate'): Promise<Table> {
  const { session, wiring, board, seatState } = await mountLiveSeat(AllocationGame, 'bs1561', mounted);
  const Host = defineComponent({
    setup: () => () =>
      h(ActionPanel, {
        availableActions: seatState.value.availableActions ?? [],
        actionMetadata: wiring.actionMetadata.value,
        isMyTurn: true,
      }),
  });
  const panel = mount(Host, {
    global: {
      provide: {
        [GAME_CONTEXT_KEYS.actionController as symbol]: wiring.controller,
        [BOARD_INTERACTION_KEY as symbol]: board,
      },
    },
    attachTo: document.body,
  });
  mounted.push(panel);
  await settle();
  await wiring.controller.start(action);
  await settle();
  return { session, controller: wiring.controller, panel };
}

/** Each checkbox's label and whether it is checked, in the order drawn. */
function boxes(t: Table): Array<[string, boolean]> {
  return t.panel.findAll('.multi-select-choice').map((label) => [
    label.find('.checkbox-label').text(),
    (label.find('input').element as HTMLInputElement).checked,
  ]);
}

async function clickBox(t: Table, index: number): Promise<void> {
  await t.panel.findAll('.multi-select-choice input')[index]!.trigger('click');
  await settle();
}

function count(t: Table): string {
  return t.panel.find('.multi-select-count').text();
}

describe('a multiSelect pick offering one value more than once (#1561)', () => {
  it('checks one box per click on a repeated value, and the count follows', async () => {
    const t = await table();
    await clickBox(t, 0);
    expect(boxes(t)).toEqual([['basic', true], ['basic', false], ['basic', false], ['m1', false], ['m2', false]]);
    expect(count(t)).toBe('Selected: 1/3');

    await clickBox(t, 1);
    expect(boxes(t)).toEqual([['basic', true], ['basic', true], ['basic', false], ['m1', false], ['m2', false]]);
    expect(count(t)).toBe('Selected: 2/3');
  });

  it('checks the copy clicked, not the first unchecked one, and the custom UI sees the same copies (#1574)', async () => {
    const t = await table();
    await clickBox(t, 2);
    expect(boxes(t)).toEqual([['basic', false], ['basic', false], ['basic', true], ['m1', false], ['m2', false]]);

    await clickBox(t, 0);
    expect(boxes(t)).toEqual([['basic', true], ['basic', false], ['basic', true], ['m1', false], ['m2', false]]);
    expect(count(t)).toBe('Selected: 2/3');
    expect([0, 1, 2].map((copy) => t.controller.isMultiSelectSelected('allocations', 'basic', copy)))
      .toEqual([true, false, true]);

    await clickBox(t, 2);
    expect(boxes(t)).toEqual([['basic', true], ['basic', false], ['basic', false], ['m1', false], ['m2', false]]);
    expect(count(t)).toBe('Selected: 1/3');
  });

  it('unchecks one copy when a checked copy is clicked', async () => {
    const t = await table();
    await clickBox(t, 0);
    await clickBox(t, 1);
    await clickBox(t, 1);
    expect(boxes(t)).toEqual([['basic', true], ['basic', false], ['basic', false], ['m1', false], ['m2', false]]);
    expect(count(t)).toBe('Selected: 1/3');
  });

  it('submits a value as many times as the panel checked it', async () => {
    const t = await table();
    await clickBox(t, 0);
    await clickBox(t, 1);
    await clickBox(t, 3);
    expect(t.session.readGame().allocated).toEqual(['basic', 'basic', 'm1']);
  });

  it('shows a custom UI the copies the panel checked, and the panel the copies it toggled', async () => {
    const t = await table();
    await t.controller.toggleMultiSelect('allocations', 'basic', 0);
    await t.controller.toggleMultiSelect('allocations', 'basic', 1);
    await settle();
    expect(boxes(t).map(([, checked]) => checked)).toEqual([true, true, false, false, false]);

    await clickBox(t, 1);
    expect(t.controller.isMultiSelectSelected('allocations', 'basic', 0)).toBe(true);
    expect(t.controller.isMultiSelectSelected('allocations', 'basic', 1)).toBe(false);
  });

  it('refuses a copy the pick does not offer', async () => {
    const t = await table();
    await t.controller.toggleMultiSelect('allocations', 'm1', 1);
    await settle();
    expect(count(t)).toBe('Selected: 0/3');
  });

  it('takes an enabled copy of a value whose first copy is disabled', async () => {
    const t = await table('firstSpent');
    await clickBox(t, 1);
    expect(boxes(t)).toEqual([['basic', false], ['basic', true], ['m1', false]]);
    expect(count(t)).toBe('Selected: 1/2');
  });

  it('refuses a disabled copy of a value with its reason, though another copy is held', async () => {
    const t = await table('lastSpent');
    await clickBox(t, 0);
    await clickBox(t, 1);
    await t.controller.toggleMultiSelect('allocations', 'basic', 1);
    await settle();
    expect(boxes(t)).toEqual([['basic', true], ['basic', false], ['m1', false]]);
    expect(count(t)).toBe('Selected: 1/2');
    expect(t.controller.lastError.value).toBe('Selection disabled: spent');
  });
});
