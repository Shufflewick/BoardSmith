/**
 * A bot's `chooseFrom` pick of an element is in wire form, so the live game accepts it (#1808).
 *
 * The move used to carry the search copy's element. The engine compared its
 * contents with the live element's, and a hidden card under the target made
 * them differ, so the move was refused and the step stalled.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, actionStep, loop, eachPlayer, type GameOptions } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { MCTSNode } from './types.js';

class Unit extends Piece<SkirmishGame> {}
class Card extends Piece<SkirmishGame> {}

/** Seat 1 attacks one of seat 2's units, each holding a card only seat 2 sees. */
class SkirmishGame extends Game<SkirmishGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Unit, Card, Space]);
    const field = this.create(Space<SkirmishGame>, 'field');
    for (const name of ['scout', 'knight']) {
      const unit = field.create(Unit, name);
      unit.player = this.getPlayer(2)!;
      const secret = unit.create(Card, `${name}-secret`);
      secret.player = this.getPlayer(2)!;
      secret.showToOwner();
    }
    this.registerAction(
      Action.create<SkirmishGame>('attack')
        .chooseFrom('target', {
          choices: (ctx) => [...ctx.game.all(Unit)].map((unit) => ({ value: unit, label: unit.name })),
        })
        .execute((_args, ctx) => {
          this.finish([ctx.player]);
          return { success: true };
        }),
    );
    this.setFlow({ root: actionStep({ actions: ['attack'], player: () => this.getPlayer(1)! }) });
  }
}

describe('a bot move that picks an element with chooseFrom', () => {
  it('is accepted by the live game when the element holds a card the bot cannot see', async () => {
    const runner = new GameRunner({ GameClass: SkirmishGame, gameType: 'skirmish', gameOptions: { playerCount: 2, seed: 'bs1808' } });
    runner.start();
    const bot = new MCTSBot(runner.game, SkirmishGame, 'skirmish', 1, { async: false, timeout: Infinity, seed: 'bs1808', iterations: 20 });

    const move = (await bot.play())!;

    expect(runner.performAction(move.action, 1, move.args)).toMatchObject({ success: true });
  });
});

/** Each seat in turn marks a card in any hand, a card the other seat sees only by its placeholder. */
class MarkGame extends Game<MarkGame, Player> {
  marks = 0;

  /** A choice naming `card`; this game offers it wrapped in a plain object. */
  choiceOf(card: Card): unknown {
    return { card, mark: 'x' };
  }

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Space]);
    for (const player of this.players) {
      const hand = this.create(Space<MarkGame>, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      hand.create(Card, `card-${player.seat}`);
    }
    this.registerAction(
      Action.create<MarkGame>('mark')
        .chooseFrom('choice', { choices: (ctx) => [...ctx.game.all(Card)].map((card) => this.choiceOf(card)) })
        .execute((_args, ctx) => {
          if (++this.marks === 4) this.finish([ctx.player]);
          return { success: true };
        }),
    );
    this.setFlow({
      root: loop({ while: () => !this.isFinished(), maxIterations: 10, do: eachPlayer({ do: actionStep({ actions: ['mark'] }) }) }),
    });
  }
}

/** Offers each card itself as the choice. */
class BareMarkGame extends MarkGame {
  override choiceOf(card: Card): unknown {
    return card;
  }
}

/** Every move a node of the search tree refused, wherever it sits. */
function refusedMoves(node: MCTSNode): string[] {
  return [...node.refusedMoveKeys, ...node.children.flatMap(refusedMoves)];
}

describe('a searched opponent move whose chooseFrom value holds an element', () => {
  it.each([
    { value: 'the element itself', GameClass: BareMarkGame },
    { value: 'a plain object holding the element', GameClass: MarkGame },
  ])('is made in the search when $value is one that opponent knows only by a placeholder', async ({ GameClass }) => {
    const game = new GameClass({ playerCount: 2, seed: 'bs1808-mark' });
    game.startFlow();
    const bot = new MCTSBot(
      game, GameClass, 'mark', 1,
      { iterations: 40, playoutDepth: 1, seed: 'bs1808-mark', async: false, timeout: Infinity, usePNS: false },
    ) as unknown as { runSearch(): Promise<{ root: MCTSNode }> };

    const { root } = await bot.runSearch();

    expect(refusedMoves(root)).toEqual([]);
  });
});
