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
import { Game, Player, Piece, Space, Action, loop, eachPlayer, actionStep, type GameOptions } from '../../engine/index.js';
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

class Checker extends Piece<HopGame> {}
class Board extends Space<HopGame> {}

/**
 * Checkers' multi-jump in small: a follow-up pre-fills the piece and carries a
 * `hops` count no pick declares; the seat picks where it lands.
 */
class HopGame extends Game<HopGame, Player> {
  landed: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    const board = this.create(Board, 'board');
    board.create(Checker, 'jumper');
    board.create(Checker, 'other');
    this.registerActions(
      Action.create<HopGame>('jump')
        .prompt('Jump')
        .execute(() => ({
          success: true,
          followUp: { action: 'land', args: { piece: this.first(Checker, 'jumper')!.id, hops: 2 } },
        })),
      Action.create<HopGame>('land')
        .prompt('Land')
        .followUpArgs<{ hops: number }>()
        .condition({ 'only as a follow-up': () => false })
        .chooseElement('piece', { elementClass: Checker })
        .chooseFrom('to', { choices: (ctx) => [`${ctx.args.piece?.name}-left`, `${ctx.args.piece?.name}-right`] })
        .execute((args) => {
          this.landed.push(`${args.piece.name}:${args.to}:${args.hops}`);
        }),
    );
    this.setFlow({ root: loop({ maxIterations: 4, do: eachPlayer({ do: actionStep({ actions: ['jump'] }) }) }) });
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

  // The server refuses a key no pick declares (#662), so the controller sends
  // the follow-up's picks only, and the engine binds `hops` itself.
  it("takes a follow-up's pre-filled args from the engine and the seat's next pick through the step", async () => {
    const { session, wiring } = await mountLiveSeat(HopGame, 'initial-args-follow-up', mounted, { withPickStep: true });
    const { controller } = wiring;

    await controller.execute('jump');
    await settle();
    expect(controller.currentAction.value).toBe('land');
    await controller.fill('to', 'jumper-right');
    await settle();

    expect(controller.lastError.value).toBe(null);
    expect(controller.currentAction.value).toBe(null);
    expect(session.readGame().landed).toEqual(['jumper:jumper-right:2']);
  });
});
