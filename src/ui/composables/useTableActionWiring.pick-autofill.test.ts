// @vitest-environment jsdom
/**
 * #1721: one pick can opt out of single-choice auto-fill with `autoFill: false`,
 * while the action's other picks still fill. A lone MERC is chosen at once; a
 * lone card waits for the player's press.
 *
 * Driven through a live table, so the option travels engine -> session -> controller.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ref, type Ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { Game, Player, Piece, Space, Action, actionStep, type GameOptions } from '../../engine/index.js';
import type { PlayerGameState } from '../../session/types.js';
import { createBoardInteraction } from './useBoardInteraction.js';
import { mountTableWiring, settle, startTable } from './table-wiring.test-helper.js';

class Merc extends Piece<EquipGame> {}
class Gear extends Piece<EquipGame> {}

class EquipGame extends Game<EquipGame, Player> {
  equipped: string[][] = [];
  static cardsAutoFill: false | undefined;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Merc, Gear]);
    const table = this.create(Space, 'table');
    table.create(Merc, 'merc');
    table.create(Gear, 'knife');
    this.registerAction(
      Action.create<EquipGame>('equip')
        .chooseElement('merc', { elementClass: Merc })
        .chooseElements('cards', {
          elements: (ctx) => [...ctx.game.all(Gear)],
          multiSelect: { min: 1, max: 6 },
          autoFill: EquipGame.cardsAutoFill,
        })
        .execute(({ cards }, ctx) => {
          ctx.game.equipped.push(cards.map((card) => card.name));
          return { success: true };
        }),
    );
    this.setFlow({
      root: actionStep({ actions: ['equip'], player: (ctx) => ctx.game.getPlayer(1)! }),
    });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  EquipGame.cardsAutoFill = undefined;
});

async function autoModeSeat(cardsAutoFill: false | undefined) {
  EquipGame.cardsAutoFill = cardsAutoFill;
  const session = await startTable(EquipGame, 'bs1721');
  const send = vi.spyOn(session, 'send');
  const seatState = ref(session.playerState(1)) as Ref<PlayerGameState>;
  const { wiring, wrapper } = mountTableWiring({
    session: () => session,
    seat: 1,
    seatState,
    boardInteraction: createBoardInteraction(),
    autoEndTurn: true,
    afterPerform: () => { seatState.value = session.playerState(1); },
  });
  mounted.push(wrapper);
  await settle();
  const sentActions = () => send.mock.calls.filter(([, op]) => op.type === 'action');
  return { session, wiring, sentActions };
}

describe('a pick that opts out of single-choice auto-fill (#1721)', () => {
  it('fills the lone MERC, then waits for the player to take the lone card', async () => {
    const { session, wiring, sentActions } = await autoModeSeat(false);

    expect(sentActions()).toEqual([]);
    expect(wiring.controller.currentAction.value).toBe('equip');
    expect(wiring.controller.currentPick.value?.name).toBe('cards');
    expect(wiring.controller.currentArgs.value.merc).toBeDefined();

    const knife = session.readGame().first(Gear)!;
    await wiring.controller.fill('cards', [knife.id]);
    await settle();

    expect(session.readGame().equipped).toEqual([['knife']]);
  });

  it('negative control: without it, starting the action takes the lone card at once', async () => {
    const { session } = await autoModeSeat(undefined);

    expect(session.readGame().equipped).toEqual([['knife']]);
  });
});
