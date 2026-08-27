import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { runSimulation, simulateCommand, resolveSimulationGameOptions } from './simulate.js';

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

/** A game whose length is gated by a game option, not by player count. */
class TargetGame extends Game<TargetGame, Player> {
  total = 0;
  readonly target: number;

  constructor(options: GameOptions) {
    super(options);
    this.target = (options as { target?: number }).target ?? 6;

    this.registerAction(
      Action.create<TargetGame>('pick')
        .chooseFrom('value', { choices: [1] })
        .execute((args, ctx) => {
          (ctx.game as TargetGame).total += args.value as number;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) =>
            (ctx.game as TargetGame).total < (ctx.game as TargetGame).target,
          maxIterations: 200,
          do: eachPlayer({
            do: actionStep({ actions: ['pick'] }),
          }),
        }),
      }),
    );
  }
}

describe('runSimulation', () => {
  it('issue 141: forwards gameOptions so an option-gated configuration is reachable', async () => {
    const base = await runSimulation(TargetGame, { count: 1, players: 2, seed: 'gated' });
    const gated = await runSimulation(TargetGame, {
      count: 1,
      players: 2,
      seed: 'gated',
      gameOptions: { target: 25 },
    });

    expect(base.games[0].turns).toBe(6);
    expect(gated.games[0].turns).toBe(26);
  });

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

  it('WR-03: synthesizes an actionable error message when a game exceeds maxActions', async () => {
    // PickGame needs several actions to reach its completion threshold (total >= 6);
    // capping maxActions at 1 guarantees the game is cut off mid-flight, exercising
    // the `exceededMaxActions` branch (not `stuck`, not `crashed`).
    const report = await runSimulation(PickGame, {
      count: 1,
      players: 2,
      seed: 'max-actions-cutoff',
      maxActions: 1,
    });

    expect(report.games).toHaveLength(1);
    const [g] = report.games;
    expect(g.status).toBe('error');
    expect(g.error).toBe('Game exceeded the maximum action count.');
  });
});

describe('resolveSimulationGameOptions (issue 141)', () => {
  const declared = {
    difficulty: { type: 'select' as const, label: 'Difficulty', choices: [
      { value: 'normal', label: 'Normal' },
      { value: 'hard', label: 'Hard' },
    ] },
    rounds: { type: 'number' as const, label: 'Rounds' },
  };

  it('parses and coerces --game-option values against the declared options', () => {
    expect(resolveSimulationGameOptions(declared, ['difficulty=hard', 'rounds=12'])).toEqual({
      difficulty: 'hard',
      rounds: 12,
    });
  });

  it('returns an empty bundle when no flag is passed', () => {
    expect(resolveSimulationGameOptions(declared, undefined)).toEqual({});
  });

  it('rejects an undeclared option, naming the declared ones', () => {
    expect(() => resolveSimulationGameOptions(declared, ['nope=1'])).toThrow(/difficulty, rounds/);
  });

  it('rejects a value outside a select option\'s declared choices', () => {
    expect(() => resolveSimulationGameOptions(declared, ['difficulty=brutal'])).toThrow(/difficulty/);
  });

  it('rejects a flag with no "=" separator', () => {
    expect(() => resolveSimulationGameOptions(declared, ['difficulty'])).toThrow(/key=value/);
  });
});

describe('simulateCommand', () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExitCode: number | string | null | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    // A minimal fixture project: valid boardsmith.json + a stub rules/index.ts.
    // simulateCommand's --games/--players validation runs (and returns) before
    // it ever bundles rulesIndexPath, so the stub file's contents don't matter.
    projectDir = mkdtempSync(join(tmpdir(), 'boardsmith-simulate-cli-'));
    writeFileSync(join(projectDir, 'boardsmith.json'), JSON.stringify({ name: 'fixture' }));
    mkdirSync(join(projectDir, 'src', 'rules'), { recursive: true });
    writeFileSync(join(projectDir, 'src', 'rules', 'index.ts'), 'export const gameDefinition = {};\n');
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('IN-01: exits non-zero with an actionable message on a non-numeric --games flag', async () => {
    process.exitCode = 0;
    await simulateCommand({ games: 'abc', players: '2', seed: undefined });
    expect(process.exitCode).toBe(1);
  });

  it('IN-01: exits non-zero with an actionable message on a non-positive --players flag', async () => {
    process.exitCode = 0;
    await simulateCommand({ games: '1', players: '0', seed: undefined });
    expect(process.exitCode).toBe(1);
  });
});
