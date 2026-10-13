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
  parsePlayerCounts,
  loadSimulation,
} from './simulate.js';
import { seatPolicies, playShard } from '../lib/sim-shard.js';
import { greedy, random, type Policy, type PolicyTurn, type SimulatedGame } from '../../sim/policies.js';
import { SeededRandom } from '../../utils/random.js';
import { scoreProject } from './simulate-project.test-helper.js';
import { DeadEndGame, ScoreGame, scoreMetrics } from './simulate.fixture.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { scratchDir } from '../lib/project-paths.js';
import { commandBuildDirs } from '../lib/command-build-dirs.test-helper.js';

/**
 * Every simulation worker thread started in this file: the games each was handed, and how many
 * have stopped. The tests count work, never time it.
 */
const workerLog = vi.hoisted(() => ({ slices: [] as number[], started: 0, exited: 0 }));
vi.mock('node:worker_threads', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:worker_threads')>();
  class CountedWorker extends real.Worker {
    constructor(...args: ConstructorParameters<typeof real.Worker>) {
      super(...args);
      workerLog.started++;
      workerLog.slices.push((args[1]?.workerData as { request: { games: unknown[] } }).request.games.length);
      this.once('exit', () => void workerLog.exited++);
    }
  }
  return { ...real, Worker: CountedWorker };
});
/** The slices of the workers started since the last call. */
const takeSlices = () => workerLog.slices.splice(0);

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

/** Rules as a loaded bundle gives them, built from a definition in this file, to play in-process. */
const rulesOf = (gameDefinition: SimulatedGame, policies?: Record<string, Policy>) => ({ gameDefinition, policies, playShard });

describe('runSimulation', () => {
  const pick = rulesOf({ gameClass: PickGame, minPlayers: 2, maxPlayers: 3 });

  it('issue 141: forwards gameOptions so an option-gated configuration is reachable', async () => {
    const run = { gamesPerCount: 1, playerCounts: [2], seed: 'gated' };
    const base = await runSimulation(rulesOf({ gameClass: TargetGame }), run);
    const gated = await runSimulation(rulesOf({ gameClass: TargetGame }), { ...run, gameOptions: { target: 25 } });

    expect(base.report?.[0].length).toMatchObject({ mean: 6, min: 6, max: 6 });
    expect(gated.report?.[0].length).toMatchObject({ mean: 26, min: 26, max: 26 });
  });

  it('is deterministic: same seed twice produces identical reports', async () => {
    const run = { gamesPerCount: 3, playerCounts: [2, 3], seed: 'fixed' };
    const run1 = await runSimulation(pick, run);
    const run2 = await runSimulation(pick, run);

    expect(run1).toEqual(run2);
  });

  it('is deterministic with author metrics: same seed, same report (#556)', async () => {
    const scored = rulesOf({ gameClass: ScoreGame, minPlayers: 2, maxPlayers: 3, metrics: scoreMetrics });
    const run = { gamesPerCount: 5, playerCounts: [2, 3], seed: 'metrics' };
    const run1 = await runSimulation(scored, run);
    expect(run1.report?.[0].scores.score.n).toBe(10);
    expect(await runSimulation(scored, run)).toEqual(run1);
  });

  it('reports each player count: games, completion, win share by seat, tie rate and length (#556)', async () => {
    const result = await runSimulation(pick, {
      gamesPerCount: 4,
      playerCounts: [2, 3],
      seed: 'shape-check',
    });

    expect(result.failing).toEqual([]);
    expect(result.report!.map((r) => [r.players, r.games])).toEqual([[2, 4], [3, 4]]);
    for (const count of result.report!) {
      // PickGame declares no winner, so every game is a tie.
      expect(count.tieRate.share).toBe(1);
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
    const deadEnd = rulesOf({ gameClass: DeadEndGame, minPlayers: 3, maxPlayers: 4 });
    const batch = await runSimulation(deadEnd, { gamesPerCount: 6, playerCounts: [3], seed: 'batch', gameOptions });
    const failing = batch.failing.filter((g) => g.index > 0);
    expect(failing.length).toBeGreaterThan(0);

    for (const g of failing) {
      const replayed = await runReplay(deadEnd, { seed: g.seed, players: 3, gameOptions });
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
    const result = await runSimulation(rulesOf({ gameClass: PickGame, minPlayers: 2, maxPlayers: 2 }, { counting }), {
      gamesPerCount: 2,
      playerCounts: [2],
      seed: 'class-policy',
      policyFlags: ['counting'],
    });

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
    expect(report.map((r: { players: number; games: number; length: { mean: number; min: number; max: number } }) =>
      [r.players, r.games, r.length.mean, r.length.min, r.length.max])).toEqual([
      [3, 3, 6, 6, 6],
      [4, 3, 4, 4, 4],
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

/**
 * #556: a game's author metrics reach every output of `boardsmith simulate`
 * with nothing but `gameDefinition.metrics` declared. Each run bundles the
 * rules, so they run while the file is collected (#363).
 */
const metricsProject = projectWithAuthorFiles(
  [
    `import { ScoreGame, scoreMetrics } from ${JSON.stringify(deadEndFixture)};`,
    `export const gameDefinition = { gameClass: ScoreGame, gameType: 'score', displayName: 'Score',`,
    `  minPlayers: 2, maxPlayers: 3, metrics: scoreMetrics };`,
  ].join('\n'),
);
const metricsHuman = await simulateOutput(metricsProject.dir, { games: '4', seed: 'metrics' });
const metricsJson = await simulateOutput(metricsProject.dir, { games: '4', seed: 'metrics', json: true });
const metricsCsv = await simulateOutput(metricsProject.dir, { games: '4', seed: 'metrics', csv: true });
const forgotMetricsProject = projectWithAuthorFiles(
  [
    `import { ScoreGame } from ${JSON.stringify(deadEndFixture)};`,
    `export const gameDefinition = { gameClass: ScoreGame, gameType: 'score', displayName: 'Score', minPlayers: 2, maxPlayers: 2 };`,
  ].join('\n'),
);
const forgotMetrics = await simulateOutput(forgotMetricsProject.dir, { games: '1', seed: 'forgot' });
const failingCsv = await simulateOutput(afterRun.dir, { games: '4', players: '3', seed: 'fails', gameOption: ['deadEnd=7'], csv: true });

describe("boardsmith simulate reports the game's author metrics (#556)", () => {
  it('prints a table per metric beside the built-in ones', () => {
    expect(metricsHuman.exitCode, metricsHuman.output).toBe(0);
    for (const title of ['2 players: 4 games', '3 players: 4 games', 'Win share by seat', 'Ties', 'Game length (actions)', 'Count per game: added', 'Score: score']) {
      expect(metricsHuman.output).toContain(title);
    }
  });

  it('--json gives { run, games, report } with the metrics in each player count', () => {
    const { run, games, report } = JSON.parse(metricsJson.output);
    expect(run).toMatchObject({ seed: 'metrics', gamesPerCount: 4, players: [2, 3] });
    expect(games).toEqual([]);
    expect(report.map((r: { players: number }) => r.players)).toEqual([2, 3]);
    expect(report[0].scores.score).toMatchObject({ n: 8 });
    expect(Object.keys(report[0].counts.added).every((key) => ['1', '2', '3'].includes(key))).toBe(true);
    expect(report[0].tieRate).toEqual({ share: expect.any(Number), low: expect.any(Number), high: expect.any(Number) });
  });

  it('--csv gives one statistic per row, the same numbers as --json', () => {
    expect(metricsCsv.exitCode).toBe(0);
    const lines = metricsCsv.output.trim().split('\n');
    expect(lines[0]).toBe('variant,players,section,metric,key,stat,value');
    const { report } = JSON.parse(metricsJson.output);
    expect(lines).toContain(`,2,score,score,,mean,${report[0].scores.score.mean}`);
    expect(lines).toContain(`,3,length,,,max,${report[1].length.max}`);
  });

  it('a game that records metrics gameDefinition.metrics does not declare fails, naming the metric', () => {
    expect(forgotMetrics.exitCode).toBe(1);
    expect(forgotMetrics.output).toContain("Metric 'added' was refused: it is not in gameDefinition.metrics");
  });

  it('--csv with an unfinished game prints the failure, no rows, and exits 1', () => {
    expect(failingCsv.exitCode).toBe(1);
    expect(failingCsv.output).toContain('Replay: boardsmith simulate --replay fails-3-');
    expect(failingCsv.output).not.toContain('variant,players');
  });
});

/**
 * #556: `--jobs` plays a run's games on worker threads, each importing the same bundle and
 * playing one slice, and combines them in game order, so the result is the same whatever the
 * worker count. The bundle is built while the file is collected (#363).
 */
const shardProject = scoreProject();
const shardRules = await loadSimulation(shardProject, join(shardProject, 'src', 'rules'), tempTree('boardsmith-simulate-shards-'));

describe('--jobs: games played on worker threads (#556)', () => {
  it('gives the same result as one in-process run for any worker count, in even slices in game order', async () => {
    const random = new SeededRandom('jobs-property');
    for (let run = 0; run < 5; run++) {
      const options = {
        gamesPerCount: 1 + random.nextInt(6),
        playerCounts: [[2], [3], [2, 3]][random.nextInt(3)],
        seed: `jobs-${run}`,
        policyFlags: random.nextInt(2) === 0 ? [] : ['2=biggest'],
      };
      const jobs = 2 + random.nextInt(3);
      takeSlices();
      const inProcess = await runSimulation(shardRules, options);
      expect(takeSlices()).toEqual([]);
      const onWorkers = await runSimulation(shardRules, { ...options, workers: { bundlePath: shardRules.bundlePath, jobs } });
      expect(JSON.stringify(onWorkers)).toBe(JSON.stringify(inProcess));

      const games = options.gamesPerCount * options.playerCounts.length;
      const slices = takeSlices();
      // A single game is played in this process.
      expect(slices).toHaveLength(games > 1 ? Math.min(jobs, games) : 0);
      if (games === 1) continue;
      expect(slices.reduce((sum, n) => sum + n, 0)).toBe(games);
      expect(Math.max(...slices) - Math.min(...slices)).toBeLessThanOrEqual(1);
    }
    // Every worker has stopped by the time its run returns.
    expect(workerLog.exited).toBe(workerLog.started);
  }, 120_000);

  it('stops every worker when one fails, and says why', async () => {
    takeSlices();
    const exitedBefore = workerLog.exited;
    await expect(
      runSimulation(shardRules, {
        gamesPerCount: 4,
        playerCounts: [2],
        seed: 'broken',
        policyFlags: ['nobody'],
        workers: { bundlePath: shardRules.bundlePath, jobs: 2 },
      }),
    ).rejects.toThrow(/Unknown policy "nobody"/);
    expect(takeSlices()).toEqual([2, 2]);
    expect(workerLog.exited - exitedBefore).toBe(2);
    expect(workerLog.exited).toBe(workerLog.started);
  }, 60_000);
});

/**
 * #556: `--compare` and `--jobs` end to end. Each run bundles the rules, so they all run while
 * the file is collected (#363); the slices each run started are taken right after it.
 */
const scoreDir = scoreProject();
takeSlices();
const jobsOne = await simulateOutput(scoreDir, { games: '5', seed: 'jobs', json: true, jobs: '1' });
const jobsOneSlices = takeSlices();
const jobsThree = await simulateOutput(scoreDir, { games: '5', seed: 'jobs', json: true, jobs: '3' });
const jobsThreeSlices = takeSlices();
const plainRandom = await simulateOutput(scoreDir, { games: '4', players: '2', seed: 'same', json: true });
const comparePolicy = await simulateOutput(scoreDir, { games: '4', players: '2', seed: 'same', json: true, compare: ['policy=random,biggest'] });
const comparePolicyCsv = await simulateOutput(scoreDir, { games: '4', players: '2', seed: 'same', csv: true, compare: ['policy=random,biggest'] });
const comparePolicyTables = await simulateOutput(scoreDir, { games: '4', players: '2', seed: 'same', compare: ['policy=random,biggest'] });
const compareTarget = await simulateOutput(scoreDir, { games: '3', players: '2', seed: 't', json: true, policy: ['biggest'], compare: ['target=6,9'] });
const compareData = await simulateOutput(scoreDir, {
  games: '3', players: '2', seed: 'd', json: true, compare: ['src/rules/data/amounts.csv=data/one.csv,data/three.csv'],
});
const neverImported = await simulateOutput(scoreDir, { games: '1', players: '2', compare: ['src/rules/data/unused.csv=data/one.csv,data/three.csv'] });
const tooMany = await simulateOutput(scoreDir, { games: '1', players: '2', compare: ['target=6,7,8,9,10,11,12', 'limit=50,60'] });
const undeclared = await simulateOutput(scoreDir, { games: '1', players: '2', compare: ['speed=1,2'] });
takeSlices();
const failingInWorker = await simulateOutput(scoreDir, { games: '2', players: '2', seed: 'w', jobs: '2', compare: ['limit=100,4'] });
const failingInWorkerSlices = takeSlices();

describe('boardsmith simulate --jobs (#556)', () => {
  it('prints byte-identical --json whatever the worker count', () => {
    expect(jobsOne.exitCode, jobsOne.output).toBe(0);
    expect(jobsThree.output).toBe(jobsOne.output);
    expect(jobsOneSlices).toEqual([]);
    // Ten games (five at each of 2 and 3 players) in three slices.
    expect(jobsThreeSlices).toEqual([3, 3, 4]);
  });

  it("reports a failing game's real message, replayed in dev mode, and a replay command carrying its variant", () => {
    expect(failingInWorker.exitCode).toBe(1);
    // The game's own line, not the engine's log: a worker's production mode leaves the throw's text out of it.
    expect(failingInWorker.output).toMatch(/^Game 0 stuck \(seed w-2-0\).*\n {2}.*failed with: .*\(a score of \d+ is over the limit of 4\)/m);
    expect(failingInWorker.output).toContain('Replay: boardsmith simulate --replay w-2-0 --players 2 --game-option limit=4');
    expect(failingInWorker.output).not.toMatch(/Replay: .*limit=100/);
    // Two variants, each on two workers playing one game.
    expect(failingInWorkerSlices).toEqual([1, 1, 1, 1]);
  });
});

/** Each variant's game lengths at the first player count: mean, min and max. */
const lengths = (output: string) =>
  JSON.parse(output).variants.map((v: { report: Array<{ length: { mean: number; min: number; max: number } }> }) => {
    const { mean, min, max } = v.report[0].length;
    return [mean, min, max];
  });

describe('boardsmith simulate --compare (#556)', () => {
  it('plays every variant on the same seeds: the base variant is the plain run', () => {
    expect(comparePolicy.exitCode, comparePolicy.output).toBe(0);
    const { variants } = JSON.parse(comparePolicy.output);
    expect(variants.map((v: { label: string }) => v.label)).toEqual(['policy=random', 'policy=biggest']);
    expect(variants[0].report).toEqual(JSON.parse(plainRandom.output).report);
    // biggest adds 3 every move: two rounds of two seats reach 6.
    expect(lengths(comparePolicy.output)[1]).toEqual([4, 4, 4]);
  });

  it('compares a declared game option', () => {
    expect(compareTarget.exitCode, compareTarget.output).toBe(0);
    expect(JSON.parse(compareTarget.output).variants.map((v: { gameOptions: object }) => v.gameOptions)).toEqual([
      { target: 6 },
      { target: 9 },
    ]);
    expect(lengths(compareTarget.output)).toEqual([[4, 4, 4], [6, 6, 6]]);
  });

  it('swaps a data file the rules import for each variant', () => {
    expect(compareData.exitCode, compareData.output).toBe(0);
    // One a move takes six rounds of two seats to reach 6; three a move takes two.
    expect(lengths(compareData.output)).toEqual([[12, 12, 12], [4, 4, 4]]);
  });

  it('refuses a data file the rules never import', () => {
    expect(neverImported.exitCode).toBe(1);
    expect(neverImported.output).toContain('The rules never import src/rules/data/unused.csv');
  });

  it('refuses more than 12 variants', () => {
    expect(tooMany.exitCode).toBe(1);
    expect(tooMany.output).toContain('14 variants');
    expect(tooMany.output).toContain('at most 12');
  });

  it('refuses a dimension that is not policy, a declared game option or a data file', () => {
    expect(undeclared.exitCode).toBe(1);
    expect(undeclared.output).toMatch(/"speed".*target, limit/);
  });

  it('labels every CSV row with its variant', () => {
    const lines = comparePolicyCsv.output.trim().split('\n');
    expect(lines.filter((line) => line.startsWith('variant,'))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith('policy=random,2,length,'))).toBe(true);
    expect(lines.some((line) => line.startsWith('policy=biggest,2,length,'))).toBe(true);
    expect(lines.slice(1).every((line) => /^policy=(random|biggest),/.test(line))).toBe(true);
  });

  it('prints a column per variant with its difference from the first', () => {
    expect(comparePolicyTables.output).toContain('1  policy=random');
    expect(comparePolicyTables.output).toContain('2  policy=biggest');
    expect(comparePolicyTables.output).toMatch(/Game length \(actions\)/);
    expect(comparePolicyTables.output).toMatch(/\n\s+mean\s+[\d.]+\s+4 \(-[\d.]+\)/);
  });
});
