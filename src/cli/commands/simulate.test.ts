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
} from '../../engine/index.js';
import { runSimulation } from './simulate.js';

/**
 * Minimal always-completing game (mirrors the fixture used by
 * random-simulation.test.ts): one arg-taking action, terminates once the
 * running total reaches a threshold. Used here to unit-test the CLI's
 * result-mapping layer without esbuild or a child process.
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

describe('runSimulation', () => {
  it('is deterministic: same seed twice produces identical per-game reports', async () => {
    const run1 = await runSimulation(PickGame, { count: 3, players: 2, seed: 'fixed' });
    const run2 = await runSimulation(PickGame, { count: 3, players: 2, seed: 'fixed' });

    expect(run1.games).toEqual(run2.games);
    expect(run1.baseSeed).toBe(run2.baseSeed);
    expect(run1.anyFailed).toBe(run2.anyFailed);
  });

  it('maps results to the stable {index, seed, status, turns} shape with sequential index', async () => {
    const report = await runSimulation(PickGame, { count: 4, players: 2, seed: 'shape-check' });

    expect(report.games).toHaveLength(4);
    report.games.forEach((g, i) => {
      expect(g.index).toBe(i);
      expect(typeof g.seed).toBe('string');
      expect(['complete', 'stuck', 'error']).toContain(g.status);
      expect(typeof g.turns).toBe('number');
    });
  });

  it('exposes anyFailed as a boolean signal (false when every game completes)', async () => {
    const report = await runSimulation(PickGame, { count: 3, players: 2, seed: 'all-complete' });

    expect(typeof report.anyFailed).toBe('boolean');
    expect(report.games.every(g => g.status === 'complete')).toBe(true);
    expect(report.anyFailed).toBe(false);
  });
});
