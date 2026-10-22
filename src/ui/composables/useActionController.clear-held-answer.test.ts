// @vitest-environment jsdom
/**
 * Clearing an earlier pick once a pick step has finished, over a real table
 * (#1372): the server's pending action holds every answer sent with the step,
 * so the clear is refused and the action commits with the answers the server
 * holds, never a cleared one or a later answer given against it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountLiveSeat, settle } from './table-wiring.test-helper.js';
import { Action, Game, Player, actionStep, type GameOptions } from '../../engine/index.js';

const crewFor = (ship: unknown) => (ship === 'dory' ? ['ann', 'bo'] : ['cy', 'di']);

class DockGame extends Game<DockGame, Player> {
  sailed: Record<string, unknown>[] = [];

  constructor(options: GameOptions) {
    super(options);
    const sail = (args: Record<string, unknown>, ctx: { game: unknown }) => {
      (ctx.game as DockGame).sailed.push({ ...args });
      return { success: true };
    };
    // The step comes after the pick cleared: a plain pick, then one with onSelect.
    this.registerAction(
      Action.create<DockGame>('crewUp')
        .chooseFrom('ship', { choices: ['dory', 'skiff'] })
        .chooseFrom('crew', { choices: (ctx) => crewFor(ctx.args.ship), onSelect: () => {} })
        .chooseFrom('port', { choices: ['north', 'south'] })
        .execute(sail),
    );
    // The step is the pick cleared: one with onSelect, then a plain pick (#1365 review F2).
    this.registerAction(
      Action.create<DockGame>('launch')
        .chooseFrom('ship', { choices: ['dory', 'skiff'], onSelect: () => {} })
        .chooseFrom('crew', { choices: (ctx) => crewFor(ctx.args.ship) })
        .chooseFrom('port', { choices: ['north', 'south'] })
        .execute(sail),
    );
    this.setFlow({
      root: actionStep({
        actions: ['crewUp', 'launch'],
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

const HELD = 'The server already holds this answer, so it cannot be cleared now. Cancel the action to start it again.';

describe('clearing an earlier pick after a pick step finished (#1372)', () => {
  it.each(['crewUp', 'launch'])('%s: is refused, so the server never holds an answer given against a cleared one', async (action) => {
    const { session, wiring } = await mountLiveSeat(DockGame, 'bs1372', mounted, { withPickStep: true });
    const { controller } = wiring;
    await controller.start(action);
    await controller.fill('ship', 'dory');
    await settle();
    await controller.fill('crew', 'ann');
    await settle();
    expect(controller.pendingOnServer.value).toBe(true);

    expect(controller.clear('ship')).toBe(false);
    expect(controller.lastError.value).toBe(HELD);
    expect(controller.clear('crew')).toBe(false);
    expect(controller.currentArgs.value).toEqual({ ship: 'dory', crew: 'ann' });

    await controller.fill('port', 'north');
    await settle();
    expect(session.readGame().sailed).toEqual([{ ship: 'dory', crew: 'ann', port: 'north' }]);
  });
});
