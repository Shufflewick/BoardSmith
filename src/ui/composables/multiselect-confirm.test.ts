// @vitest-environment jsdom
/**
 * #1789: a fixed-count multiSelect declared with `confirm: true` waits for Done
 * after its last tick, so the player can still change the pick. Driven through a
 * live table, so the option travels engine -> session -> controller.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { Game, Player, Action, actionStep, type GameOptions } from '../../engine/index.js';
import { mountLiveSeat, settle } from './table-wiring.test-helper.js';

class DiscardGame extends Game<DiscardGame, Player> {
  discarded: string[][] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<DiscardGame>('discard')
        .chooseFrom('cards', { choices: ['a', 'b', 'c'], multiSelect: { min: 2, max: 2, confirm: true } })
        .execute((args, ctx) => {
          ctx.game.discarded.push(args.cards as string[]);
          return { success: true };
        }),
    );
    this.setFlow({ root: actionStep({ actions: ['discard'], player: (ctx) => ctx.game.getPlayer(1)! }) });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('a fixed-count multiSelect that asks to confirm (#1789)', () => {
  it('sends nothing on the last tick, and the pick as changed on Done', async () => {
    const { session, wiring } = await mountLiveSeat(DiscardGame, 'bs1789-confirm', mounted);
    const send = vi.spyOn(session, 'send');
    const { controller } = wiring;
    await controller.start('discard');
    await settle();

    await controller.toggleMultiSelect('cards', 'a');
    await controller.toggleMultiSelect('cards', 'b');
    await settle();
    expect(send.mock.calls.filter(([, op]) => op.type === 'action')).toEqual([]);

    await controller.toggleMultiSelect('cards', 'b');
    await controller.toggleMultiSelect('cards', 'c');
    await controller.confirmMultiSelect('cards');
    await settle();

    expect(session.readGame().discarded).toEqual([['a', 'c']]);
  });
});
