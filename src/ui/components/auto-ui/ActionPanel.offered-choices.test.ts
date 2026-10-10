// @vitest-environment jsdom
/**
 * #407: THE ACTION PANEL OFFERS EXACTLY WHAT THE ENGINE OFFERS.
 *
 * The panel used to drop from the open pick every value an earlier pick of the
 * same action already held, whether or not the game offered it. So for sotf's
 * `sendMail` (`to: 'Player 3'`, then "who exactly?" narrowed by `to`) the panel
 * offered only `Player 30`, while the engine offered and accepted `Player 3` and
 * a custom UI showed it. The board bridge did the same for the board's
 * clickable targets.
 *
 * The engine's answer for the current pick is the one list. A game that wants
 * distinct values across picks says so in its own `choices`, `elements` or
 * `filterBy`, and then the engine's list is already distinct. Every step below
 * asks the live session host what it offers for the args answered so far and
 * holds the panel's buttons and the board's targets to exactly that.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import ActionPanel from './ActionPanel.vue';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';
import { BOARD_INTERACTION_KEY, type BoardInteraction } from '../../composables/useBoardInteraction.js';
import type { TableActionWiring } from '../../composables/useTableActionWiring.js';
import { mountLiveSeat, settle } from '../../composables/table-wiring.test-helper.js';
import { mailPicks } from '../../composables/send-mail.test-helper.js';
import type { HeadlessSession } from '../../../session/headless-session.js';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  actionStep,
  type GameOptions,
} from '../../../engine/index.js';

class Token extends Piece<PicksGame> {}
class Pool extends Space<PicksGame> {}

const COLORS = ['red', 'blue'];

class PicksGame extends Game<PicksGame, Player> {
  /** What each action executed with. */
  done: Array<{ action: string; args: Record<string, unknown> }> = [];

  constructor(options: GameOptions) {
    super(options);
    const pool = this.create(Pool, 'pool');
    for (const name of ['amber', 'jade']) pool.create(Token, name);

    const record = (action: string) => (args: Record<string, unknown>, ctx: { game: Game }) => {
      (ctx.game as PicksGame).done.push({ action, args: { ...args } });
      return { success: true };
    };

    this.registerAction(
      mailPicks<PicksGame>().execute(record('sendMail'))
    );
    // Two picks from one list, with nothing saying they must differ.
    this.registerAction(
      Action.create('paint')
        .chooseFrom('first', { choices: COLORS })
        .chooseFrom('second', { choices: COLORS })
        .execute(record('paint'))
    );
    // Two picks the GAME keeps distinct: the engine's list is already narrowed.
    this.registerAction(
      Action.create('mix')
        .chooseFrom('first', { choices: COLORS })
        .chooseFrom('second', { choices: (ctx) => COLORS.filter((c) => c !== ctx.args.first) })
        .execute(record('mix'))
    );
    // Two element picks from one pool, with nothing saying they must differ.
    this.registerAction(
      Action.create('stack')
        .chooseElement('bottom', { elements: (ctx) => [...(ctx.game as PicksGame).all(Token)] })
        .chooseElement('top', { elements: (ctx) => [...(ctx.game as PicksGame).all(Token)] })
        .execute(record('stack'))
    );
    // Two choice picks whose choices each name their token on the board.
    const tokenRef = (name: string, ctx: { game: Game }) => ({
      refs: [{ ref: { id: (ctx.game as PicksGame).first(Token, name)!.id }, role: 'target' as const }],
    });
    this.registerAction(
      Action.create('swap')
        .chooseFrom('left', { choices: ['amber', 'jade'], boardRefs: tokenRef })
        .chooseFrom('right', { choices: ['amber', 'jade'], boardRefs: tokenRef })
        .execute(record('swap'))
    );

    this.setFlow(
      {
        root: actionStep({
          actions: ['sendMail', 'paint', 'mix', 'stack', 'swap'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 20,
        }),
      }
    );
  }
}

const SEAT = 1;

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

interface Table {
  session: HeadlessSession<PicksGame>;
  controller: TableActionWiring['controller'];
  board: BoardInteraction;
  panel: VueWrapper;
}

/** Seat 1 of a real table with the panel mounted over the same wiring GameShell uses. */
async function table(): Promise<Table> {
  const { session, wiring, board, seatState } = await mountLiveSeat(PicksGame, 'bs407', mounted);
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
  return { session, controller: wiring.controller, board, panel };
}

/** The labels of the panel's options for the open pick, Skip excluded. */
function panelOptions(panel: VueWrapper): string[] {
  return panel
    .findAll('.choice-buttons .choice-btn:not(.skip-btn)')
    .map((b) => b.text());
}

/**
 * THE INVARIANT: the panel lists exactly what the engine offers for the open
 * pick, in the engine's order, and the board's targets are exactly the
 * engine's elements, or the elements its choices name. Returns the engine's labels so a test can say which one it
 * is choosing.
 */
async function expectPanelOffersWhatTheEngineOffers(t: Table, action: string): Promise<string[]> {
  const pick = t.controller.currentPick.value;
  expect(pick, 'a pick should be open').toBeTruthy();
  const offered = await t.session.send(SEAT, {
    type: 'resolveChoices',
    actionName: action,
    selectionName: pick!.name,
    player: SEAT,
    args: { ...t.controller.currentArgs.value },
  });
  if (!offered.success) throw new Error(`the engine refused to answer "${pick!.name}": ${offered.error}`);

  // An element pick's board targets are its elements; a choice pick's are the
  // elements its choices name.
  const [labels, boardIds] =
    pick!.type === 'element' || pick!.type === 'elements'
      ? [
          (offered.validElements ?? []).map((e) => e.display ?? String(e.id)),
          (offered.validElements ?? []).map((e) => e.id),
        ]
      : [
          (offered.choices ?? []).map((c) => c.display),
          (offered.choices ?? []).flatMap((c) => (c.refs ?? []).map((r) => r.ref.id)),
        ];
  expect(panelOptions(t.panel), `panel options for "${pick!.name}"`).toEqual(labels);
  expect(t.board.validElements.map((e) => e.id), `board targets for "${pick!.name}"`).toEqual(boardIds);
  return labels;
}

async function startFromPanel(t: Table, action: string): Promise<void> {
  await t.controller.start(action);
  await settle();
}

async function choose(t: Table, label: string): Promise<void> {
  const button = t.panel
    .findAll('.choice-buttons .choice-btn:not(.skip-btn)')
    .find((b) => b.text() === label);
  expect(button, `the panel should offer "${label}"`).toBeTruthy();
  await button!.trigger('click');
  await settle();
}

describe('the Action Panel offers exactly what the engine offers (#407)', () => {
  it('offers the value an earlier pick took when the narrowed list still holds it (the issue repro)', async () => {
    const t = await table();
    await startFromPanel(t, 'sendMail');
    await expectPanelOffersWhatTheEngineOffers(t, 'sendMail');
    await choose(t, 'Player 3');

    expect(t.controller.currentPick.value?.name).toBe('recipient');
    expect(await expectPanelOffersWhatTheEngineOffers(t, 'sendMail')).toEqual(['Player 3', 'Player 30']);
    await choose(t, 'Player 3');

    expect(t.session.readGame().done).toEqual([
      { action: 'sendMail', args: { to: 'Player 3', recipient: 'Player 3' } },
    ]);
  });

  it('offers a repeat of an earlier choice when the game allows one', async () => {
    const t = await table();
    await startFromPanel(t, 'paint');
    await expectPanelOffersWhatTheEngineOffers(t, 'paint');
    await choose(t, 'red');

    expect(await expectPanelOffersWhatTheEngineOffers(t, 'paint')).toEqual(['red', 'blue']);
    await choose(t, 'red');

    expect(t.session.readGame().done).toEqual([{ action: 'paint', args: { first: 'red', second: 'red' } }]);
  });

  it('hides an earlier choice only because the game narrowed its own list', async () => {
    const t = await table();
    await startFromPanel(t, 'mix');
    await choose(t, 'red');

    expect(await expectPanelOffersWhatTheEngineOffers(t, 'mix')).toEqual(['blue']);
  });

  it('offers, on the panel and the board, an element an earlier pick took when the game allows it', async () => {
    const t = await table();
    await startFromPanel(t, 'stack');
    const first = await expectPanelOffersWhatTheEngineOffers(t, 'stack');
    expect(first).toHaveLength(2);
    await choose(t, first[0]!);

    expect(t.controller.currentPick.value?.name).toBe('top');
    expect(await expectPanelOffersWhatTheEngineOffers(t, 'stack')).toEqual(first);
  });

  it('offers, on the panel and the board, a choice an earlier pick took when the game allows it', async () => {
    const t = await table();
    await startFromPanel(t, 'swap');
    await expectPanelOffersWhatTheEngineOffers(t, 'swap');
    await choose(t, 'amber');

    expect(t.controller.currentPick.value?.name).toBe('right');
    expect(await expectPanelOffersWhatTheEngineOffers(t, 'swap')).toEqual(['amber', 'jade']);
    await choose(t, 'amber');

    expect(t.session.readGame().done).toEqual([{ action: 'swap', args: { left: 'amber', right: 'amber' } }]);
  });
});
