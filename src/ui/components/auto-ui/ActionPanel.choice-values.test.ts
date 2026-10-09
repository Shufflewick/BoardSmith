// @vitest-environment jsdom
/**
 * #509: A CHOICE'S VALUE IS THE SAME VALUE ON EVERY PATH, END TO END.
 *
 * A chooseFrom choice is a bare value or the labelled shape
 * `{ value, label? }`. The engine reads `value` out of the labelled shape where
 * the choices are built, so the wire carries the value with the label as its
 * display, and every callback after `choices` receives the value: a later
 * pick's `choices` (through `ctx.args`), `validate` and `execute`. An object
 * with any other key is a value in its own right and arrives whole.
 *
 * Each case runs on a live table with the Action Panel mounted over the wiring
 * GameShell uses, and is driven both ways a player can drive it: a click on the
 * panel's button, and a custom UI's `fill()` with the value it was offered.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { BOARD_INTERACTION_KEY } from '../../composables/useBoardInteraction.js';
import type { TableActionWiring } from '../../composables/useTableActionWiring.js';
import { mountLiveSeat, settle } from '../../composables/table-wiring.test-helper.js';
import type { HeadlessSession } from '../../../session/headless-session.js';
import { Game, Player, Action, defineFlow, actionStep, type GameOptions } from '../../../engine/index.js';

class ValuesGame extends Game<ValuesGame, Player> {
  /** What each callback received, in the order they ran. */
  seen: Array<{ where: string; value: unknown }> = [];

  constructor(options: GameOptions) {
    super(options);
    const note = (where: string, value: unknown) => {
      (this as ValuesGame).seen.push({ where, value });
    };

    this.registerAction(
      Action.create<ValuesGame>('labelled')
        .chooseFrom('pick', {
          choices: [{ value: 'skip', label: 'Skip it' }, { value: 'go', label: 'Go now' }],
          validate: (value) => { note('validate', value); return true; },
        })
        .chooseFrom('then', {
          choices: (ctx) => { note('later choices', ctx.args.pick); return ['ok', 'fine']; },
        })
        .execute((args) => { note('execute', args.pick); return { success: true }; }),
    );
    this.registerAction(
      Action.create<ValuesGame>('extra')
        .chooseFrom('pick', {
          choices: [{ value: 'go', cost: 3 }, { value: 'stay', cost: 0 }],
          display: (choice) => `${choice.value} (${choice.cost})`,
        })
        .execute((args) => { note('execute', args.pick); return { success: true }; }),
    );
    this.registerAction(
      Action.create<ValuesGame>('many')
        .chooseFrom('picks', {
          choices: [{ value: 'x', label: 'Ex' }, 'y', { value: 'z', label: 'Zed' }],
          multiSelect: { min: 1 },
        })
        .execute((args) => { note('execute', args.picks); return { success: true }; }),
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['labelled', 'extra', 'many'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 20,
        }),
      }),
    );
  }
}

const SEAT = 1;

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

interface Table {
  session: HeadlessSession<ValuesGame>;
  controller: TableActionWiring['controller'];
  panel: VueWrapper;
}

async function table(): Promise<Table> {
  const { session, wiring, board, seatState } = await mountLiveSeat(ValuesGame, 'bs509', mounted);
  const Host = defineComponent({
    setup: () => () =>
      h(ActionPanel, {
        availableActions: seatState.value.availableActions ?? [],
        actionMetadata: wiring.actionMetadata.value,
        playerSeat: SEAT,
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
  return { session, controller: wiring.controller, panel };
}

async function choose(t: Table, label: string): Promise<void> {
  const button = t.panel
    .findAll('.choice-buttons .choice-btn:not(.skip-btn)')
    .find((b) => b.text() === label);
  expect(button, `the panel should offer "${label}"`).toBeTruthy();
  await button!.trigger('click');
  await settle();
}

/** The open pick's choices exactly as the wire delivered them. */
function offered(t: Table): Array<{ value: unknown; display: string }> {
  const pick = t.controller.currentPick.value;
  expect(pick, 'a pick should be open').toBeTruthy();
  return t.controller.getChoices(pick!).map(({ value, display }) => ({ value, display }));
}

describe('a chooseFrom value is the same on every path (#509)', () => {
  it('sends a labelled choice as its value, with its label as the display', async () => {
    const t = await table();
    await t.controller.start('labelled');
    await settle();

    expect(offered(t)).toEqual([
      { value: 'skip', display: 'Skip it' },
      { value: 'go', display: 'Go now' },
    ]);
  });

  it('delivers the value to validate, a later pick and execute when the panel is clicked', async () => {
    const t = await table();
    await t.controller.start('labelled');
    await settle();
    await choose(t, 'Go now');
    await choose(t, 'ok');

    // A later pick's choices are also read before 'pick' is answered (with no
    // value yet), so only the calls that saw a value are compared.
    const withValue = t.session.readGame().seen.filter((s) => s.value !== undefined);
    expect(new Set(withValue.map((s) => s.where))).toEqual(new Set(['validate', 'later choices', 'execute']));
    expect(withValue.map((s) => s.value)).toEqual(withValue.map(() => 'go'));
  });

  it('delivers the same value when a custom UI fills the value it was offered', async () => {
    const t = await table();
    await t.controller.start('labelled');
    await settle();
    await t.controller.fill('pick', offered(t)[1]!.value);
    await settle();
    await t.controller.fill('then', 'fine');
    await settle();

    const executed = t.session.readGame().seen.filter((s) => s.where === 'execute');
    expect(executed).toEqual([{ where: 'execute', value: 'go' }]);
  });

  it('refuses a custom UI that fills the whole wire choice instead of its value', async () => {
    const t = await table();
    await t.controller.start('labelled');
    await settle();
    const result = await t.controller.fill('pick', offered(t)[1]);
    await settle();

    expect(result.valid).toBe(false);
    expect(t.session.readGame().seen.filter((s) => s.where === 'execute')).toEqual([]);
  });

  it('keeps an object with any other key whole, on the wire and in execute', async () => {
    const t = await table();
    await t.controller.start('extra');
    await settle();

    expect(offered(t)).toEqual([
      { value: { value: 'go', cost: 3 }, display: 'go (3)' },
      { value: { value: 'stay', cost: 0 }, display: 'stay (0)' },
    ]);
    await choose(t, 'go (3)');

    expect(t.session.readGame().seen).toEqual([{ where: 'execute', value: { value: 'go', cost: 3 } }]);
  });

  it('delivers a multiSelect pick as an array of values', async () => {
    const t = await table();
    await t.controller.start('many');
    await settle();

    expect(offered(t)).toEqual([
      { value: 'x', display: 'Ex' },
      { value: 'y', display: 'y' },
      { value: 'z', display: 'Zed' },
    ]);
    await t.controller.fill('picks', ['x', 'z']);
    await settle();

    expect(t.session.readGame().seen).toEqual([{ where: 'execute', value: ['x', 'z'] }]);
  });
});
