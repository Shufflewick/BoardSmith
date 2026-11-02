// @vitest-environment jsdom
/**
 * #1562: a multiSelect whose max is 0 takes only the empty list, so auto mode
 * must not fill its one choice. It used to, the table refused it, and the bridge
 * started and filled it again, over and over.
 *
 * Driven through a live table, so the bounds travel engine -> session -> controller.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ref, type Ref } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { Game, Player, Action, actionStep, type GameOptions } from '../../engine/index.js';
import type { PlayerGameState } from '../../session/types.js';
import { createBoardInteraction } from './useBoardInteraction.js';
import { mountTableWiring, settle, startTable } from './table-wiring.test-helper.js';

class AllocateGame extends Game<AllocateGame, Player> {
  allocated: string[][] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('allocate')
        .chooseFrom('allocations', {
          choices: () => ['squidhead'],
          multiSelect: () => ({ min: 0, max: 0 }),
        })
        .execute((args, ctx) => {
          (ctx.game as AllocateGame).allocated.push(args.allocations as string[]);
          return { success: true };
        }),
    );
    this.setFlow({
      root: actionStep({ actions: ['allocate'], player: (ctx) => ctx.game.getPlayer(1)! }),
    });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('auto mode on a sole multiSelect whose max is 0 (#1562)', () => {
  it('leaves the pick to the player, who answers it with the empty list', async () => {
    const session = await startTable(AllocateGame, 'bs1562');
    const send = vi.spyOn(session, 'send');
    const seatState = ref(session.playerState(1)) as Ref<PlayerGameState>;
    const { wiring, wrapper } = mountTableWiring({
      session: () => session,
      seat: 1,
      seatState,
      boardInteraction: createBoardInteraction(),
      autoEndTurn: true,
      // A table broadcasts only a state an action changed; a refused one sends none.
      afterPerform: () => { if (session.readGame().allocated.length) seatState.value = session.playerState(1); },
    });
    mounted.push(wrapper);
    await settle();

    const { controller } = wiring;
    expect(controller.currentAction.value).toBe('allocate');
    expect(send.mock.calls.filter(([, op]) => op.type === 'action')).toEqual([]);

    await controller.confirmMultiSelect('allocations');
    await settle();

    expect(controller.lastError.value).toBeNull();
    expect(session.readGame().allocated).toEqual([[]]);
  });
});
