// @vitest-environment jsdom
/**
 * The picks a seat collects locally reach the server as picks (#658).
 *
 * The controller keeps a pick with no `onSelect` on the client and routes the
 * first pick that has one through the selection-step transport, sending the
 * picks before it as `initialArgs`. The server makes those picks as the
 * seat's own steps would, so the later pick's choices see them. Driven on a
 * live table, wired as GameShell wires it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { Game, Player, Action, loop, eachPlayer, actionStep, type GameOptions } from '../../engine/index.js';
import { mountLiveSeat, settle } from './table-wiring.test-helper.js';

class PayGame extends Game<PayGame, Player> {
  bought: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<PayGame>('buy')
        .prompt('Buy')
        .chooseFrom('color', { choices: ['red', 'blue'] })
        .chooseFrom('pay', {
          choices: (ctx) => (ctx.args.color === 'blue' ? ['silver'] : ['gold']),
          // Its onSelect is what routes this pick, with `color` before it, to the server.
          onSelect: () => {},
        })
        .execute((args) => {
          this.bought.push(`${args.color}:${args.pay}`);
        }),
    );
    this.setFlow({ root: loop({ maxIterations: 4, do: eachPlayer({ do: actionStep({ actions: ['buy'] }) }) }) });
  }
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe('locally collected picks travel as initialArgs (#658)', () => {
  it('makes the earlier pick on the server, so the onSelect pick is checked against its choices', async () => {
    const { session, wiring } = await mountLiveSeat(PayGame, 'initial-args', mounted, { withPickStep: true });
    const { controller } = wiring;

    await controller.start('buy');
    await controller.fill('color', 'blue');
    await settle();
    await controller.fill('pay', 'silver');
    await settle();

    expect(controller.lastError.value).toBe(null);
    expect(controller.currentAction.value).toBe(null);
    expect(session.readGame().bought).toEqual(['blue:silver']);
  });
});
