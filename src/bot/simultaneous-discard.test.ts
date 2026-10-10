/**
 * A bot playing a Cribbage-style discard: every seat, at the same time, puts
 * two cards from its own hidden hand into a shared crib (#314).
 *
 * This is the one place three things meet that each have their own tests
 * elsewhere: a `simultaneousActionStep`, a `multiSelect` element choice, and a
 * hand only its owner can see, so the bot searches a redacted sandbox in which
 * its opponent's cards are unknown. It is driven through `GameRunner`, the path
 * a host takes, so every move the bot returns is also checked by the engine.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Piece,
  Action,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { MCTSBot } from './mcts-bot.js';

class Card extends Piece<DiscardGame> {
  rank!: number;
}

class Hand extends Space<DiscardGame> {}

class DiscardGame extends Game<DiscardGame, Player> {
  crib!: Space<DiscardGame>;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand]);

    const deck = this.create(Space<DiscardGame>, 'deck');
    deck.contentsHidden();
    for (let rank = 1; rank <= 12; rank++) deck.create(Card, `card-${rank}`, { rank });

    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      for (let i = 0; i < 4; i++) deck.first(Card)!.putInto(hand);
    }

    this.crib = this.create(Space<DiscardGame>, 'crib');
    this.crib.contentsHidden();

    this.registerAction(
      Action.create<DiscardGame>('discard')
        .chooseElements('cards', {
          prompt: 'Put two cards in the crib',
          elements: (ctx) => [...(ctx.game as DiscardGame).handOf(ctx.player.seat).all(Card)],
          multiSelect: { min: 2, max: 2 },
        })
        .execute((args, ctx) => {
          for (const card of args.cards as Card[]) card.putInto((ctx.game as DiscardGame).crib);
          return { success: true };
        }),
    );

    this.setFlow({
      root: simultaneousActionStep({
        actions: ['discard'],
        playerDone: (ctx, player) => (ctx.game as DiscardGame).handOf(player.seat).count(Card) <= 2,
      }),
    });
  }

  /** Over once both seats have discarded into the crib, with no winner. */
  override isFinished(): boolean {
    return super.isFinished() || this.crib.count(Card) === 4;
  }

  handOf(seat: number): Hand {
    return this.first(Hand, `hand-${seat}`)!;
  }
}

const newRunner = () => {
  const runner = new GameRunner({
    GameClass: DiscardGame,
    gameType: 'discard',
    gameOptions: { playerCount: 2, seed: 'discard-seed' },
  });
  runner.start();
  return runner;
};

type Runner = ReturnType<typeof newRunner>;

const botFor = (runner: Runner, seat: number) =>
  new MCTSBot(runner.game, DiscardGame, 'discard', seat, runner.actionHistory, {
    iterations: 20,
    playoutDepth: 2,
    async: false,
    timeout: Infinity,
    seed: `discard-bot-${seat}`,
  });

/** Ids of the cards `seat` holds, read from the authoritative game. */
const handIds = (runner: Runner, seat: number) =>
  runner.game.handOf(seat).all(Card).map((card) => card.id);

/** Ids of the cards a bot's discard names. */
const discardedIds = (args: Record<string, unknown>) => (args.cards as number[]).map(Number);

describe('a bot in a simultaneous two-card discard', () => {
  it('both seats are asked at once', () => {
    const awaiting = newRunner().getFlowState()!.awaitingPlayers!;
    expect(awaiting.map((p) => p.playerIndex).sort()).toEqual([1, 2]);
  });

  for (const seat of [1, 2]) {
    it(`seat ${seat} discards two different cards from its own hand, and the engine accepts them`, async () => {
      const runner = newRunner();
      const hand = handIds(runner, seat);

      const move = (await botFor(runner, seat).play())!;

      expect(move.action).toBe('discard');
      const ids = discardedIds(move.args);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
      for (const id of ids) expect(hand).toContain(id);

      expect(runner.performAction(move.action, seat, move.args).success).toBe(true);
      expect(runner.game.handOf(seat).count(Card)).toBe(2);
    });
  }

  it('the second seat still discards after the first has committed, and that closes the round', async () => {
    const runner = newRunner();

    const first = (await botFor(runner, 1).play())!;
    expect(runner.performAction(first.action, 1, first.args).success).toBe(true);
    expect(runner.getFlowState()!.complete).toBe(false);

    const hand = handIds(runner, 2);
    const second = (await botFor(runner, 2).play())!;
    for (const id of discardedIds(second.args)) expect(hand).toContain(id);
    expect(runner.performAction(second.action, 2, second.args).success).toBe(true);

    expect(runner.game.crib.count(Card)).toBe(4);
    expect(runner.getFlowState()!.complete).toBe(true);
  });
});
