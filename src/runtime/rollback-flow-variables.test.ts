/**
 * After a failed action is rolled back in place, the elements the flow holds
 * are the restored elements, not the discarded ones (#679).
 *
 * `GameRunner.rollbackToPreActionState` rebuilds the element tree from the head
 * checkpoint, which makes new element objects. The flow engine stays where it
 * was, so anything it holds must be pointed at the new objects, as
 * `GameRunner.fromSnapshot` does on a reload.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, Action, loop, sequence, setVar, execute, actionStep, type GameOptions, type FlowContext } from '../engine/index.js';
import { GameRunner } from './runner.js';

class Card extends Piece<RollbackGame, Player> {}

class RollbackGame extends Game<RollbackGame, Player> {
  /** What the flow variable `v` held when the flow last read it. */
  seen: Card | null = null;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card]);
    this.create(Card, 'card');

    this.registerActions(
      Action.create<RollbackGame>('ok').prompt('Carry on').execute(() => {}),
      // Changes the card, then throws: the runner rolls the game back in place.
      Action.create<RollbackGame>('fail')
        .prompt('Fail')
        .execute((_args, ctx) => {
          ctx.game.first(Card)!.name = 'changed by the failed action';
          throw new Error('rules bug after the change');
        }),
    );

    this.setFlow({
      root: sequence(
        setVar<RollbackGame>('v', (ctx: FlowContext<RollbackGame>) => ctx.game.first(Card)),
        loop({
          maxIterations: 20,
          do: sequence(
            actionStep({ player: (ctx) => ctx.game.getPlayer(1)!, actions: ['ok', 'fail'] }),
            execute<RollbackGame>((ctx) => {
              ctx.game.seen = ctx.get<Card>('v') ?? null;
            }),
          ),
        }),
      ),
    });
  }
}

describe('a flow variable holding an element after a failed action is rolled back (#679)', () => {
  it('is the restored element in the tree, not the discarded one', () => {
    const runner = new GameRunner({
      GameClass: RollbackGame,
      gameType: 'rollback',
      gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'rollback' },
    });
    runner.start();
    runner.getSnapshot();

    expect(runner.performAction('fail', 1, {}).success).toBe(false);
    expect(runner.performAction('ok', 1, {}).success).toBe(true);

    const card = runner.game.first(Card)!;
    expect(card.name).toBe('card');
    expect(runner.game.seen).toBe(card);
  });
});
