import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { playGame } from './play-game.js';
import { random, greedy, mcts, type Policy } from './index.js';

/** Each seat adds 1-3 to its own score; the first to reach 10 ends the game, and the highest score wins. */
class RaceGame extends Game<RaceGame, Player> {
  scores: Record<number, number> = {};

  constructor(options: GameOptions) {
    super(options);
    for (const player of this.players) this.scores[player.seat] = 0;
    this.registerAction(
      Action.create<RaceGame>('take')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          ctx.game.scores[ctx.player.seat] += args.value as number;
          const best = Math.max(...Object.values(ctx.game.scores));
          if (best >= 10) ctx.game.finish(ctx.game.players.filter((p) => ctx.game.scores[p.seat] === best));
          return { success: true };
        }),
    );
    this.setFlow({
      root: loop({
        while: (ctx) => !ctx.game.isFinished(),
        maxIterations: 100,
        do: eachPlayer({ do: actionStep({ actions: ['take'] }) }),
      }),
    });
  }
}

/** A game whose only move takes a number, which greedy cannot list. */
class BidGame extends Game<BidGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<BidGame>('bid')
        .enterNumber('amount', { min: 1, max: 5, integer: true })
        .execute((_args, ctx) => {
          ctx.game.finish([]);
          return { success: true };
        }),
    );
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['bid'] }) }) });
  }
}

const race = { gameClass: RaceGame, gameType: 'race', minPlayers: 2, maxPlayers: 4 };

/** The fixture greedy policy: take the largest step. */
const biggestStep = greedy((_game, move) => move.args.value as number);

function play(policies: Policy[], seed: string) {
  return playGame(race, { playerCount: policies.length, seed, policies, maxActions: 200 });
}

describe('playGame with policies (#556)', () => {
  it('a short greedy policy completes games', async () => {
    for (const seed of ['g1', 'g2', 'g3']) {
      const result = await play([biggestStep, biggestStep], seed);
      expect(result.error).toBeUndefined();
      expect(result.completed).toBe(true);
      // Both seats always take 3: seat 1 reaches 12 first and wins alone.
      expect(result.actionCount).toBe(7);
      expect(result.winners).toEqual([1]);
    }
  });

  it('gives identical results for the same seed and policies, whatever the seed', async () => {
    const lineups: Policy[][] = [
      [random(), random()],
      [biggestStep, random(), random()],
      [random(), biggestStep, random(), biggestStep],
    ];
    for (let i = 0; i < 20; i++) {
      for (const lineup of lineups) {
        const seed = `same-${i}`;
        const first = await play(lineup, seed);
        const second = await play(lineup, seed);
        expect({ ...second, duration: 0 }).toEqual({ ...first, duration: 0 });
        expect(first.completed).toBe(true);
      }
    }
  });

  it("changing one seat's policy does not change the random draws of another seat", async () => {
    const drawsBySeat1: number[][] = [];
    for (const seat2 of [random(), biggestStep]) {
      const draws: number[] = [];
      const recorder: Policy = {
        name: 'recorder',
        choose: (turn) => {
          const value = 1 + turn.random.nextInt(3);
          draws.push(value);
          return { action: 'take', args: { value } };
        },
      };
      await play([recorder, seat2], 'separate');
      drawsBySeat1.push(draws);
    }
    const shared = Math.min(drawsBySeat1[0].length, drawsBySeat1[1].length);
    expect(shared).toBeGreaterThan(1);
    expect(drawsBySeat1[0].slice(0, shared)).toEqual(drawsBySeat1[1].slice(0, shared));
  });

  it('an MCTS seat plays the same game again for the same seed', async () => {
    const lineup = [mcts(20), random()];
    const first = await play(lineup, 'mcts-seed');
    const second = await play(lineup, 'mcts-seed');
    expect(first.error).toBeUndefined();
    expect(first.completed).toBe(true);
    expect({ ...second, duration: 0 }).toEqual({ ...first, duration: 0 });
  });

  it('a policy that changes the game is refused, naming the policy', async () => {
    const meddler: Policy = {
      name: 'meddler',
      choose: (turn) => {
        turn.game.random();
        return { action: 'take', args: { value: 1 } };
      },
    };
    const result = await play([meddler, random()], 'meddle');
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/policy 'meddler'.*changed the game/);
  });

  it('greedy refuses a move that takes a number, saying why', async () => {
    const result = await playGame(
      { gameClass: BidGame },
      { playerCount: 2, seed: 'bid', policies: [biggestStep, biggestStep], maxActions: 10 },
    );
    expect(result.completed).toBe(false);
    expect(result.error).toMatch(/greedy.*'bid'.*number input 'amount'/);
  });

  it('refuses a player count the game does not declare', async () => {
    await expect(play([random(), random(), random(), random(), random()], 'five')).rejects.toThrow(
      /5 players.*2 to 4/,
    );
  });

  it('refuses a policy list that does not give one policy per seat', async () => {
    await expect(
      playGame(race, { playerCount: 3, seed: 'short', policies: [random(), random()], maxActions: 10 }),
    ).rejects.toThrow(/3 seats.*2 policies/);
  });
});
