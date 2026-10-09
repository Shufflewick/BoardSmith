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
import { defineComponent, h, ref, type Ref } from 'vue';

import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { BOARD_INTERACTION_KEY } from '../../composables/useBoardInteraction.js';
import type { TableActionWiring } from '../../composables/useTableActionWiring.js';
import { createBoardInteraction } from '../../composables/useBoardInteraction.js';
import { mountLiveSeat, mountTableWiring, settle, startTable } from '../../composables/table-wiring.test-helper.js';
import type { PlayerGameState } from '../../../session/types.js';
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

/**
 * #509: THE PANEL LABELS A VALUE THE WAY ITS OWN BUTTONS DO.
 *
 * A pick's label is the choice's own display (its `label`, else the
 * selection's `display()`, else `labelOfValue`), and a value held without its
 * choice reads by `labelOfValue` too. Everywhere the panel shows a pick it
 * already holds -- a made pick, a repeated pick's entries, an ordered list's
 * entries -- reads the same, so the breadcrumb never names a pick differently
 * from the button that made it.
 *
 * `{ id, name, display }` is the shape that tells the rules apart: `display` on
 * a value is ordinary data (#509), so it reads by its `name`.
 */
const SHAPES: unknown[] = [
  { value: 'skip', label: 'Skip it' },
  { id: 7, name: 'Bronson' },
  'plain',
  { id: 9, name: 'Ada', display: 'Lovelace' },
];
const STOP = 'stop';

class LabelsGame extends Game<LabelsGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<LabelsGame>('made')
        .chooseFrom('pick', { choices: SHAPES })
        .chooseFrom('then', { choices: ['ok'] })
        .execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<LabelsGame>('repeated')
        .chooseFrom('picks', { choices: [...SHAPES, STOP], repeatUntil: STOP })
        .execute(() => ({ success: true })),
    );
    this.registerAction(
      Action.create<LabelsGame>('ordered')
        .chooseFrom('list', { choices: SHAPES, orderedList: { min: 1, max: 8 } })
        .execute(() => ({ success: true })),
    );
    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['made', 'repeated', 'ordered'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 20,
        }),
      }),
    );
  }
}

/** A live seat with the selection-step transport, which a repeating pick needs. */
async function labelsTable(): Promise<Table> {
  const board = createBoardInteraction();
  const session = await startTable(LabelsGame, 'bs509-labels');
  const seatState = ref(session.playerState(SEAT)) as Ref<PlayerGameState>;
  const { wiring, wrapper } = mountTableWiring({
    seat: SEAT,
    session: () => session,
    boardInteraction: board,
    seatState,
    autoEndTurn: false,
    withPickStep: true,
    afterPerform: () => { seatState.value = session.playerState(SEAT); },
  });
  mounted.push(wrapper);
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
  return { session: session as unknown as HeadlessSession<ValuesGame>, controller: wiring.controller, panel };
}

/** The label each offered value's button carries, in offer order. */
function buttonLabels(t: Table, selector: string): Array<{ value: unknown; label: string }> {
  const buttons = t.panel.findAll(selector).map((b) => b.text());
  const values = offered(t).map((c) => c.value);
  expect(buttons).toHaveLength(values.length);
  return values.map((value, i) => ({ value, label: buttons[i]! }));
}

/** A copy of a value as a custom UI holds it: rebuilt from JSON, never the same object. */
const asCustomUiHoldsIt = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('the panel labels a pick it holds the way its button did (#509)', () => {
  it('labels each button by the one rule', async () => {
    const t = await labelsTable();
    await t.controller.start('made');
    await settle();

    expect(buttonLabels(t, '.choice-buttons .choice-btn:not(.skip-btn)').map((b) => b.label))
      .toEqual(['Skip it', 'Bronson', 'plain', 'Ada']);
  });

  it('shows a made pick as its button read', async () => {
    for (const index of SHAPES.keys()) {
      const t = await labelsTable();
      await t.controller.start('made');
      await settle();
      const button = buttonLabels(t, '.choice-buttons .choice-btn:not(.skip-btn)')[index]!;

      await t.controller.fill('pick', asCustomUiHoldsIt(button.value));
      await settle();

      expect(t.panel.findAll('.selected-value .value-display').map((c) => c.text())).toEqual([button.label]);
      for (const w of mounted.splice(0)) w.unmount();
    }
  });

  it('shows each repeated pick entry as its button read, on every pass', async () => {
    const t = await labelsTable();
    await t.controller.start('repeated');
    await settle();

    const pressed: string[] = [];
    for (const index of SHAPES.keys()) {
      const buttons = buttonLabels(t, '.choice-buttons .choice-btn:not(.skip-btn)');
      expect(buttons.map((b) => b.label)).toEqual(['Skip it', 'Bronson', 'plain', 'Ada', STOP]);
      await t.controller.fill('picks', asCustomUiHoldsIt(buttons[index]!.value));
      await settle();
      pressed.push(buttons[index]!.label);

      expect(t.panel.findAll('.accumulated-chip').map((c) => c.text())).toEqual(pressed);
    }
  });

  it('shows each ordered-list entry as its button read', async () => {
    const t = await labelsTable();
    await t.controller.start('ordered');
    await settle();
    const buttons = buttonLabels(t, '.ordered-list-add');

    for (const { value } of buttons) {
      await t.controller.appendListEntry('list', asCustomUiHoldsIt(value));
    }
    await settle();

    expect(t.panel.findAll('.ordered-list-label').map((e) => e.text())).toEqual(buttons.map((b) => b.label));
  });
});
