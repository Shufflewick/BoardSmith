import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { simulateRandomGames, replayRandomGame, type SimulateRandomGamesOptions } from './random-simulation.js';

/**
 * Minimal game whose only action takes an argument (a numeric choice). The
 * random simulator must generate a valid `value` arg for every move, or the
 * game can never progress — exactly the case the old harness silently failed.
 */
class PickGame extends Game<PickGame, Player> {
  total = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<PickGame>('pick')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          (ctx.game as PickGame).total += args.value as number;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) => (ctx.game as PickGame).total < 6,
          maxIterations: 100,
          do: eachPlayer({
            do: actionStep({ actions: ['pick'] }),
          }),
        }),
      }),
    );
  }
}

describe('simulateRandomGames', () => {
  it('generates valid arguments so arg-based games complete (F49)', async () => {
    const results = await simulateRandomGames(PickGame, {
      count: 12,
      playerCounts: [2, 3],
      seed: 'fixed-base',
      timeout: 5000,
    });

    expect(results.total).toBe(12);
    expect(results.completed).toBe(12);
    expect(results.crashed).toBe(0);
    expect(results.stuck).toBe(0);
    expect(results.timedOut).toBe(0);
    // Every completed game must have actually executed arg-bearing actions.
    expect(results.averageActions).toBeGreaterThan(0);
  });

  it('is deterministic and reproducible from the base seed (F50)', async () => {
    const opts: SimulateRandomGamesOptions = {
      count: 6,
      playerCounts: [2],
      seed: 'repro-seed',
      timeout: 5000,
    };

    const a = await simulateRandomGames(PickGame, opts);
    const b = await simulateRandomGames(PickGame, opts);

    // The reported base seed is the one we provided (no Date.now() drift).
    expect(a.seed).toBe('repro-seed');
    expect(b.seed).toBe('repro-seed');

    // Per-game seeds and outcomes match across identical runs.
    expect(a.games.map(g => g.seed)).toEqual(b.games.map(g => g.seed));
    expect(a.games.map(g => g.actionCount)).toEqual(b.games.map(g => g.actionCount));
    expect(a.games.map(g => g.winners)).toEqual(b.games.map(g => g.winners));
  });

  it('returns a base seed that can be regenerated when none is provided (F50)', async () => {
    const results = await simulateRandomGames(PickGame, {
      count: 2,
      playerCounts: [2],
      timeout: 5000,
    });
    expect(typeof results.seed).toBe('string');
    expect(results.seed.length).toBeGreaterThan(0);
    // Per-game seeds are derived from the generated base seed.
    expect(results.games[0].seed.startsWith(results.seed)).toBe(true);
  });

  it('replays a single game deterministically by its seed (F50)', async () => {
    const results = await simulateRandomGames(PickGame, {
      count: 4,
      playerCounts: [2],
      seed: 'replay-base',
      timeout: 5000,
    });

    const target = results.games[0];
    const replay = await replayRandomGame(PickGame, {
      seed: target.seed,
      playerCount: target.playerCount,
    });

    expect(replay.seed).toBe(target.seed);
    expect(replay.actionCount).toBe(target.actionCount);
    expect(replay.completed).toBe(target.completed);
    expect(replay.winners).toEqual(target.winners);
  });
});
