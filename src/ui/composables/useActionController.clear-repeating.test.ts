// @vitest-environment jsdom
/**
 * Clearing a pick at or before a repeating pick, over a real table (#1365):
 * the server's pending action holds the repeat's steps and takes no earlier
 * pick again, so the clear is refused once a step is held, and resets the
 * repeat when none is.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountLiveSeat, settle } from './table-wiring.test-helper.js';
import { Action, Game, Player, actionStep, type GameOptions } from '../../engine/index.js';

class StockGame extends Game<StockGame, Player> {
  stocked: Record<string, unknown>[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<StockGame>('stock')
        .chooseFrom('ship', { choices: ['dory', 'skiff'] })
        .chooseFrom('gear', {
          choices: (ctx) => (ctx.args.ship === 'dory' ? ['net', 'oar', 'stop'] : ['sail', 'stop']),
          repeatUntil: 'stop',
        })
        .execute((args, ctx) => {
          (ctx.game as StockGame).stocked.push({ ...args });
          return { success: true };
        }),
    );
    this.setFlow({
      root: actionStep({
        actions: ['stock'],
        player: (ctx) => ctx.game.getPlayer(1)!,
        repeatUntil: () => false,
        maxMoves: 20,
      }),
    });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function stockShip(ship: string) {
  const { session, wiring } = await mountLiveSeat(StockGame, 'bs1365', mounted, { withPickStep: true });
  const { controller } = wiring;
  await controller.start('stock');
  await controller.fill('ship', ship);
  await settle();
  return { session, controller };
}

const HELD = 'The server already holds your picks for this action, so an earlier pick cannot be changed now. Cancel the action to start it again.';

describe('clearing a pick at or before a repeating pick (#1365)', () => {
  it('is refused once the repeating pick has sent a step, so the action cannot commit with the cleared answer', async () => {
    const { session, controller } = await stockShip('dory');
    await controller.fill('gear', 'net');
    await controller.fill('gear', 'oar');

    expect(controller.clear('ship')).toBe(false);
    expect(controller.lastError.value).toBe(HELD);
    expect(controller.clear('gear')).toBe(false);
    expect(controller.currentArgs.value).toEqual({ ship: 'dory' });
    expect(controller.repeatingState.value?.accumulated.map((a) => a.value)).toEqual(['net', 'oar']);

    await controller.fill('gear', 'stop');
    await settle();
    expect(session.readGame().stocked).toEqual([{ ship: 'dory', gear: ['net', 'oar', 'stop'] }]);
  });

  it('resets a repeating pick the server holds nothing of, so it is asked again against the new answer', async () => {
    const { session, controller } = await stockShip('dory');
    expect((await controller.fill('gear', 'sail')).valid).toBe(false);
    expect(controller.repeatingState.value?.accumulated).toEqual([]);

    expect(controller.clear('ship')).toBe(true);
    expect(controller.repeatingState.value).toBeNull();
    await controller.fill('ship', 'skiff');
    await settle();
    expect(controller.getChoices(controller.currentPick.value!).map((c) => c.value)).toEqual(['sail', 'stop']);
    await controller.fill('gear', 'sail');
    await controller.fill('gear', 'stop');
    await settle();

    expect(session.readGame().stocked).toEqual([{ ship: 'skiff', gear: ['sail', 'stop'] }]);
  });
});
