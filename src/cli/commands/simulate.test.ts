import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Game,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type FlowContext,
} from '../../engine/index.js';
import {
  runSimulation,
  runReplay,
  simulateCommand,
  resolveSimulationGameOptions,
  seatPolicies,
  parsePlayerCounts,
} from './simulate.js';
import { greedy, random, type Policy, type PolicyTurn } from '../../sim/policies.js';
import { DeadEndGame } from './simulate.fixture.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { scratchDir } from '../lib/project-paths.js';
import { commandBuildDirs } from '../lib/command-build-dirs.test-helper.js';

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
          ctx.game.total += args.value as number;
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        while: (ctx) => ctx.game.total < 6,
        maxIterations: 100,
        do: eachPlayer({
          do: actionStep({ actions: ['pick'] }),
        }),
      }),
    });
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
          ctx.game.total += args.value as number;
          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        while: (ctx) =>
          ctx.game.total < ctx.game.target,
        maxIterations: 200,
        do: eachPlayer({
          do: actionStep({ actions: ['pick'] }),
        }),
      }),
    });
  }
}

describe('runSimulation', () => {
  const pick = { gameClass: PickGame, minPlayers: 2, maxPlayers: 3 };
  const randomSeats = (playerCount: number) => seatPolicies(undefined, undefined, playerCount);

  it('issue 141: forwards gameOptions so an option-gated configuration is reachable', async () => {
    const run = { gamesPerCount: 1, playerCounts: [2], seed: 'gated', policiesFor: randomSeats };
    const base = await runSimulation({ gameClass: TargetGame }, run);
    const gated = await runSimulation({ gameClass: TargetGame }, { ...run, gameOptions: { target: 25 } });

    expect(base.report?.[0].length).toEqual({ mean: 6, min: 6, max: 6 });
    expect(gated.report?.[0].length).toEqual({ mean: 26, min: 26, max: 26 });
  });

  it('is deterministic: same seed twice produces identical reports', async () => {
    const run = { gamesPerCount: 3, playerCounts: [2, 3], seed: 'fixed', policiesFor: randomSeats };
    const run1 = await runSimulation(pick, run);
    const run2 = await runSimulation(pick, run);

    expect(run1).toEqual(run2);
  });

  it('reports each player count: games, completion, win share by seat, tie rate and length (#556)', async () => {
    const result = await runSimulation(pick, {
      gamesPerCount: 4,
      playerCounts: [2, 3],
      seed: 'shape-check',
      policiesFor: randomSeats,
    });

    expect(result.failing).toEqual([]);
    expect(result.report!.map((r) => [r.players, r.games])).toEqual([[2, 4], [3, 4]]);
    for (const count of result.report!) {
      // PickGame declares no winner, so every game is a tie.
      expect(count.tieRate).toBe(1);
      expect(Object.keys(count.winShare).map(Number)).toEqual(
        Array.from({ length: count.players }, (_, i) => i + 1),
      );
      expect(count.length.min).toBeLessThanOrEqual(count.length.mean);
      expect(count.length.mean).toBeLessThanOrEqual(count.length.max);
    }
  });

  it('WR-03: a game cut off at maxActions fails the run with an actionable message and no report', async () => {
    // PickGame needs several actions to reach its completion threshold (total >= 6);
    // capping maxActions at 1 guarantees the game is cut off mid-flight, exercising
    // the `exceededMaxActions` branch (not `stuck`, not `crashed`).
    const result = await runSimulation(pick, {
      gamesPerCount: 1,
      playerCounts: [2],
      seed: 'max-actions-cutoff',
      policiesFor: randomSeats,
      maxActions: 1,
    });

    expect(result.report).toBeNull();
    expect(result.failing).toHaveLength(1);
    const [g] = result.failing;
    expect(g.status).toBe('error');
    expect(g.error).toBe('Game exceeded the maximum action count.');
  });
});

describe('runReplay (#322)', () => {
  it("plays a batch game again from that game's own seed, seat count, options and policies", async () => {
    const gameOptions = { deadEnd: 7 };
    const deadEnd = { gameClass: DeadEndGame, minPlayers: 3, maxPlayers: 4 };
    const policiesFor = (playerCount: number) => seatPolicies(undefined, undefined, playerCount);
    const batch = await runSimulation(deadEnd, { gamesPerCount: 6, playerCounts: [3], seed: 'batch', gameOptions, policiesFor });
    const failing = batch.failing.filter((g) => g.index > 0);
    expect(failing.length).toBeGreaterThan(0);

    for (const g of failing) {
      const replayed = await runReplay(deadEnd, { seed: g.seed, players: 3, gameOptions, policies: policiesFor(3) });
      expect(replayed.failing).toEqual([{ ...g, index: 0 }]);
    }
  });
});

describe('seatPolicies: --policy flags (#556)', () => {
  const project = { cautious: { name: 'cautious', choose: () => ({ noMove: 'never' }) } };

  it('plays random at every seat when no flag is given', () => {
    expect(seatPolicies(undefined, undefined, 3).map((p) => p.name)).toEqual(['random', 'random', 'random']);
  });

  it('a bare name sets every seat, and seat=name sets one seat', () => {
    expect(seatPolicies(['cautious', '2=random'], project, 3).map((p) => p.name)).toEqual([
      'cautious',
      'random',
      'cautious',
    ]);
  });

  it('reads mcts:<level> with the bot level names', () => {
    expect(seatPolicies(['1=mcts:easy', '2=mcts:300'], undefined, 2).map((p) => p.name)).toEqual([
      'mcts:easy',
      'mcts:300',
    ]);
    expect(() => seatPolicies(['mcts:brutal'], undefined, 2)).toThrow(/Unknown bot level "brutal"/);
  });

  it("names a project policy by its key in the project's policies, so errors name it", () => {
    expect(seatPolicies(['meddle'], { meddle: greedy(() => 0) }, 2).map((p) => p.name)).toEqual(['meddle', 'meddle']);
  });

  it('plays a project policy written as a class, keeping its prototype and `this`', async () => {
    class Counting implements Policy {
      name = 'counting';
      turns = 0;
      private inner = random();
      choose(turn: PolicyTurn) {
        this.turns += 1;
        return this.inner.choose(turn);
      }
    }
    const counting = new Counting();
    const result = await runSimulation(
      { gameClass: PickGame, minPlayers: 2, maxPlayers: 2 },
      {
        gamesPerCount: 2,
        playerCounts: [2],
        seed: 'class-policy',
        policiesFor: (playerCount) => seatPolicies(['counting'], { counting }, playerCount),
      },
    );

    expect(result.failing).toEqual([]);
    expect(counting.turns).toBeGreaterThan(0);
  });

  it('refuses an unknown policy, naming the ones there are', () => {
    expect(() => seatPolicies(['greedy'], project, 2)).toThrow(/Unknown policy "greedy".*random, mcts:<level>, cautious/);
  });

  it('refuses a seat the game does not have, and a seat named twice', () => {
    expect(() => seatPolicies(['3=random'], undefined, 2)).toThrow(/seat 3.*2-player game/);
    expect(() => seatPolicies(['0=random'], undefined, 2)).toThrow(/seat 0/);
    expect(() => seatPolicies(['1=random', '1=cautious'], project, 2)).toThrow(/seat 1 more than once/);
    expect(() => seatPolicies(['random', 'cautious'], project, 2)).toThrow(/more than one policy for every seat/);
  });

  it('refuses a project policy that shadows a built-in name or is not a policy', () => {
    expect(() => seatPolicies(undefined, { random: project.cautious }, 2)).toThrow(/src\/sim\/index.ts.*"random"/);
    expect(() => seatPolicies(undefined, { odd: 42 } as never, 2)).toThrow(/src\/sim\/index.ts.*"odd".*greedy/);
  });
});

describe('parsePlayerCounts: --players (#556)', () => {
  const game = { minPlayers: 2, maxPlayers: 5 };

  it('defaults to every count the game declares', () => {
    expect(parsePlayerCounts(undefined, game)).toEqual([2, 3, 4, 5]);
  });

  it('takes a comma-separated list', () => {
    expect(parsePlayerCounts('2,4', game)).toEqual([2, 4]);
  });

  it('refuses a count outside the declared range, or one that is not a whole number', () => {
    expect(() => parsePlayerCounts('2,6', game)).toThrow(/6.*2 to 5/);
    expect(() => parsePlayerCounts('two', game)).toThrow(/--players.*"two"/);
    expect(() => parsePlayerCounts('2,,3', game)).toThrow(/--players/);
    expect(() => parsePlayerCounts('0', {})).toThrow(/--players/);
    expect(() => parsePlayerCounts('2,3,2', game)).toThrow(/--players names 2 more than once/);
  });

  it('needs a list when the game declares no player range', () => {
    expect(() => parsePlayerCounts(undefined, {})).toThrow(/minPlayers.*--players/);
    expect(parsePlayerCounts('1', {})).toEqual([1]);
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
    projectDir = tempTree('boardsmith-simulate-cli-');
    writeFileSync(join(projectDir, 'boardsmith.json'), JSON.stringify({ name: 'fixture' }));
    mkdirSync(join(projectDir, 'src', 'rules'), { recursive: true });
    writeFileSync(join(projectDir, 'src', 'rules', 'index.ts'), 'export const gameDefinition = {};\n');
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
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

/**
 * #391: simulate bundles the rules into its own build directory and removes
 * only that. `.boardsmith/` also holds the scratch directory and the chunk
 * worktrees of a parallel build, which simulate did not make.
 *
 * Both runs happen while the file is collected, where no test timeout applies,
 * because each bundles the rules (#363, #417). The tests assert what they left.
 */
const deadEndFixture = resolve(dirname(fileURLToPath(import.meta.url)), 'simulate.fixture.ts');

/** A project whose rules module is `rules`, already holding a scratch file and a chunk worktree. */
function projectWithAuthorFiles(rules: string): { dir: string; expectAuthorFilesKept: () => void } {
  const dir = tempTree('boardsmith-simulate-391-');
  writeFileSync(join(dir, 'boardsmith.json'), JSON.stringify({ name: 'fixture', backend: 'table' }));
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rules', 'index.ts'), rules);
  const scratchFile = join(scratchDir(dir), 'keep.txt');
  const worktreeFile = join(dir, '.boardsmith', 'worktrees', 'chunk-a', 'notes.md');
  mkdirSync(scratchDir(dir), { recursive: true });
  mkdirSync(dirname(worktreeFile), { recursive: true });
  writeFileSync(scratchFile, 'keep me\n');
  writeFileSync(worktreeFile, 'unfinished chunk\n');
  return {
    dir,
    expectAuthorFilesKept: () => {
      expect(readFileSync(scratchFile, 'utf-8')).toBe('keep me\n');
      expect(readFileSync(worktreeFile, 'utf-8')).toBe('unfinished chunk\n');
      expect(commandBuildDirs(dir, 'simulate'), 'simulate left its build directory behind').toEqual([]);
    },
  };
}

/** Runs simulate from inside `dir`, then restores the cwd and exit code. Returns what it threw, if anything. */
async function simulateIn(dir: string, options: Parameters<typeof simulateCommand>[0]): Promise<unknown> {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.chdir(dir);
  try {
    await simulateCommand(options);
    return undefined;
  } catch (thrown) {
    return thrown;
  } finally {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    log.mockRestore();
  }
}

const afterRun = projectWithAuthorFiles(
  [
    `import { DeadEndGame } from ${JSON.stringify(deadEndFixture)};`,
    `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', displayName: 'Fixture',`,
    `  minPlayers: 3, maxPlayers: 4, gameOptions: { deadEnd: { type: 'number', label: 'Dead end' } } };`,
  ].join('\n'),
);
const afterRunError = await simulateIn(afterRun.dir, { games: '1', players: '3', seed: 'keep', json: true });

const afterBrokenRules = projectWithAuthorFiles('export const gameDefinition = ;\n');
const brokenRulesError = await simulateIn(afterBrokenRules.dir, { games: '1', players: '2', seed: undefined });

describe('simulateCommand leaves the rest of .boardsmith alone (#391)', () => {
  it('after a run', () => {
    expect(afterRunError).toBeUndefined();
    afterRun.expectAuthorFilesKept();
  });

  it('after rules that fail to load', () => {
    expect(brokenRulesError).toBeInstanceOf(Error);
    expect((brokenRulesError as Error).message).toContain("Failed to load this game's rules");
    afterBrokenRules.expectAuthorFilesKept();
  });
});

/**
 * #556: the command end to end. A project's own policies come from its
 * `src/sim/index.ts`, bundled with its rules; every run reports per player
 * count; and a run with an unfinished game prints the failure and its replay
 * command, exits 1, and prints no statistics. Each run bundles the rules, so
 * both run while the file is collected (#363).
 */
const simIndex = resolve(dirname(fileURLToPath(import.meta.url)), '../../sim/index.ts');

/** Runs simulate in `dir`, returning everything it printed and the exit code it set. */
async function simulateOutput(dir: string, options: Parameters<typeof simulateCommand>[0]): Promise<{ output: string; exitCode: unknown }> {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  const printed: string[] = [];
  const capture = (...parts: unknown[]) => void printed.push(parts.map(String).join(' '));
  const log = vi.spyOn(console, 'log').mockImplementation(capture);
  const error = vi.spyOn(console, 'error').mockImplementation(capture);
  process.chdir(dir);
  try {
    await simulateCommand(options);
    return { output: printed.join('\n'), exitCode: process.exitCode };
  } finally {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    log.mockRestore();
    error.mockRestore();
  }
}

const policyProject = projectWithAuthorFiles(
  [
    `import { DeadEndGame } from ${JSON.stringify(deadEndFixture)};`,
    `export const gameDefinition = { gameClass: DeadEndGame, gameType: 'fixture', displayName: 'Fixture',`,
    `  minPlayers: 3, maxPlayers: 4, gameOptions: { deadEnd: { type: 'number', label: 'Dead end' } } };`,
  ].join('\n'),
);
mkdirSync(join(policyProject.dir, 'src', 'sim'), { recursive: true });
writeFileSync(
  join(policyProject.dir, 'src', 'sim', 'index.ts'),
  [
    `import { greedy } from ${JSON.stringify(simIndex)};`,
    `export const policies = { biggest: greedy((_game, move) => Number(move.args.amount)) };`,
  ].join('\n'),
);
const greedyRun = await simulateOutput(policyProject.dir, {
  games: '3', seed: 'greedy', json: true, policy: ['biggest'], gameOption: ['deadEnd=100'],
});
const failingRun = await simulateOutput(afterRun.dir, { games: '4', players: '3', seed: 'fails', gameOption: ['deadEnd=7'] });

describe('boardsmith simulate reports per player count (#556)', () => {
  it("plays the project's own policy from src/sim/index.ts at every declared player count", () => {
    expect(greedyRun.exitCode, greedyRun.output).toBe(0);
    const { run, games, report } = JSON.parse(greedyRun.output);
    expect(run).toMatchObject({ seed: 'greedy', gamesPerCount: 3, players: [3, 4], policies: ['biggest'] });
    expect(games).toEqual([]);
    // Every seat adds 3 and the loop checks the total of 12 after each full round: two rounds of
    // three seats, or one of four.
    expect(report.map((r: { players: number; games: number; length: unknown }) => [r.players, r.games, r.length])).toEqual([
      [3, 3, { mean: 6, min: 6, max: 6 }],
      [4, 3, { mean: 4, min: 4, max: 4 }],
    ]);
  });

  it('a run with an unfinished game prints the failure and its replay, exits 1, and prints no statistics', () => {
    expect(failingRun.exitCode).toBe(1);
    expect(failingRun.output).toMatch(/Game \d+ stuck \(seed fails-3-\d\) after \d+ action\(s\)\./);
    expect(failingRun.output).toContain('Replay: boardsmith simulate --replay fails-3-');
    expect(failingRun.output).not.toMatch(/Win share|Ties|Length/);
    // Only failing games are listed.
    expect(failingRun.output).not.toMatch(/complete after/);
  });
});
