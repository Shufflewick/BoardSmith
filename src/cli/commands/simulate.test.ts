import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import {
  runSimulation,
  runReplay,
  simulateCommand,
  resolveSimulationGameOptions,
  parsePlayerCounts,
  loadSimulation,
} from './simulate.js';
import { seatPolicies } from '../lib/sim-shard.js';
import { playOnWorkers } from '../lib/sim-workers.js';
import { greedy } from '../../sim/policies.js';
import { SeededRandom } from '../../utils/random.js';
import { scoreProject } from './simulate-project.test-helper.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { scratchDir } from '../lib/project-paths.js';
import { commandBuildDirs } from '../lib/command-build-dirs.test-helper.js';

/**
 * Every simulation worker thread started in this file: the mode it plays in and how many games
 * it was handed, and how many have stopped. The tests count work, never time it.
 */
const workerLog = vi.hoisted(() => ({ slices: [] as Array<{ mode: string; games: number }>, started: 0, exited: 0 }));
vi.mock('node:worker_threads', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:worker_threads')>();
  class CountedWorker extends real.Worker {
    constructor(...args: ConstructorParameters<typeof real.Worker>) {
      super(...args);
      workerLog.started++;
      const options = args[1] as { workerData: { request: { games: unknown[] } }; env: { NODE_ENV: string } };
      workerLog.slices.push({ mode: options.env.NODE_ENV, games: options.workerData.request.games.length });
      this.once('exit', () => void workerLog.exited++);
    }
  }
  return { ...real, Worker: CountedWorker };
});
/** The games each worker of `mode` started since the last call was handed; forgets every worker started so far. */
const takeSlices = (mode = 'production') => workerLog.slices.splice(0).filter((s) => s.mode === mode).map((s) => s.games);

/**
 * A bundle of the score project (see `simulate-project.test-helper.ts`), built while the file is
 * collected (#363), for the tests that call the runner directly.
 */
const shardProject = scoreProject();
const shardRules = await loadSimulation(shardProject, join(shardProject, 'src', 'rules'), tempTree('boardsmith-simulate-shards-'), undefined);

describe('runSimulation', () => {
  const run = { gamesPerCount: 3, playerCounts: [2, 3], seed: 'fixed', jobs: 2 };

  it('issue 141: forwards gameOptions so an option-gated configuration is reachable', async () => {
    const biggest = { ...run, playerCounts: [2], policyFlags: ['biggest'] };
    const base = await runSimulation(shardRules, biggest);
    const gated = await runSimulation(shardRules, { ...biggest, gameOptions: { target: 9 } });

    expect(base.report?.[0].length).toMatchObject({ mean: 4, min: 4, max: 4 });
    expect(gated.report?.[0].length).toMatchObject({ mean: 6, min: 6, max: 6 });
  }, 60_000);

  it('is deterministic with author metrics: same seed, same report (#556)', async () => {
    const run1 = await runSimulation(shardRules, run);
    expect(run1.report?.[0].scores.score.n).toBe(6);
    expect(await runSimulation(shardRules, run)).toEqual(run1);
  }, 60_000);

  it('reports each player count: games, win share by seat, tie rate and length (#556)', async () => {
    const result = await runSimulation(shardRules, run);

    expect(result.failing).toEqual([]);
    expect(result.report!.map((r) => [r.players, r.games])).toEqual([[2, 3], [3, 3]]);
    for (const count of result.report!) {
      expect(Object.keys(count.winShare).map(Number)).toEqual(Array.from({ length: count.players }, (_, i) => i + 1));
      expect(count.length.min).toBeLessThanOrEqual(count.length.mean);
      expect(count.length.mean).toBeLessThanOrEqual(count.length.max);
    }
  }, 60_000);

  it('WR-03: a game cut off at maxActions fails the run with an actionable message and no report', async () => {
    // A game needs at least four actions to reach its target, so one action cuts it off mid-flight.
    const result = await runSimulation(shardRules, { ...run, gamesPerCount: 1, playerCounts: [2], maxActions: 1 });

    expect(result.report).toBeNull();
    expect(result.failing).toHaveLength(1);
    const [g] = result.failing;
    expect(g.status).toBe('error');
    expect(g.error).toMatch(/^Game did not finish within the maximum of 1 action\. Raise maxActions/);
  }, 60_000);

  it('plays a project policy written as a class, keeping its prototype and `this`', async () => {
    const result = await runSimulation(shardRules, { ...run, policyFlags: ['steady'] });
    expect(result.failing).toEqual([]);
  }, 60_000);
});

describe('runReplay (#322)', () => {
  it("plays a batch game again from that game's own seed, seat count, options and policies", async () => {
    const gameOptions = { limit: 4 };
    const batch = await runSimulation(shardRules, { gamesPerCount: 3, playerCounts: [2], seed: 'batch', gameOptions, policyFlags: ['2=biggest'], jobs: 2 });
    expect(batch.failing).toHaveLength(3);

    for (const g of batch.failing) {
      const replayed = await runReplay(shardRules, { seed: g.seed, players: 2, gameOptions, policyFlags: ['2=biggest'] });
      expect(replayed.failing).toEqual([{ ...g, index: 0 }]);
    }
  }, 60_000);
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

  it.each(['0', '-1', '1.5', '1e3', '12abc', ''])('refuses a count of "%s" by name (#1047)', (raw) => {
    expect(() => parsePlayerCounts(`2,${raw}`, {})).toThrow(`--players takes a positive whole number, got "${raw}".`);
  });

  it('needs a list when the game declares no player range', () => {
    expect(() => parsePlayerCounts(undefined, {})).toThrow(/minPlayers.*--players/);
    expect(parsePlayerCounts('1', {})).toEqual([1]);
  });
});

describe('resolveSimulationGameOptions (issue 141)', () => {
  const declared = {
    difficulty: { type: 'select' as const, label: 'Difficulty', default: 'normal', choices: [
      { value: 'normal', label: 'Normal' },
      { value: 'hard', label: 'Hard' },
    ] },
    rounds: { type: 'number' as const, label: 'Rounds', default: 10 },
  };

  it('parses and coerces --game-option values against the declared options', () => {
    expect(resolveSimulationGameOptions(declared, ['difficulty=hard', 'rounds=12'])).toEqual({
      difficulty: 'hard',
      rounds: 12,
    });
  });

  it('returns every declared option at its default when no flag is passed (#701)', () => {
    expect(resolveSimulationGameOptions(declared, undefined)).toEqual({ difficulty: 'normal', rounds: 10 });
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

  it('sets a designer-only option, which no player can choose (#687)', () => {
    const withKnob = { ...declared, lootScale: { type: 'number' as const, label: 'Loot scale', default: 1, designerOnly: true as const } };
    expect(resolveSimulationGameOptions(withKnob, ['lootScale=1.5'])).toEqual({ difficulty: 'normal', rounds: 10, lootScale: 1.5 });
  });
});

// --players is checked against the game's declared range, so after the rules are bundled. That
// run happens here, where no test timeout applies (#1127).
const playersProject = tempTree('boardsmith-simulate-players-');
writeFileSync(join(playersProject, 'boardsmith.json'), JSON.stringify({ name: 'fixture' }));
mkdirSync(join(playersProject, 'src', 'rules'), { recursive: true });
writeFileSync(join(playersProject, 'src', 'rules', 'index.ts'), 'export const gameDefinition = {};\n');
const nonPositivePlayers = await simulateOutput(playersProject, { games: '1', players: '0', seed: undefined });

describe('simulateCommand', () => {
  let projectDir: string;
  let originalCwd: string;
  let originalExitCode: number | string | null | undefined;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    // A minimal fixture project: valid boardsmith.json + a stub rules/index.ts.
    // simulateCommand's --games validation runs (and returns) before it ever
    // bundles rulesIndexPath, so the stub file's contents don't matter.
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

  it.each(['0', '-1', '1.5', '1e3', '12abc', ''])('refuses --games "%s" by name (#1047)', async (raw) => {
    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await simulateCommand({ games: raw, players: '2', seed: undefined });
      expect(process.exitCode).toBe(1);
      expect(printed.mock.calls.map(([line]) => stripVTControlCharacters(String(line)))).toEqual([
        `--games takes a positive whole number, got "${raw}".`,
      ]);
    } finally {
      printed.mockRestore();
    }
  });

  it('IN-01: exits non-zero with an actionable message on a non-positive --players flag', () => {
    expect(nonPositivePlayers.exitCode).toBe(1);
    expect(nonPositivePlayers.output).toContain('--players takes a positive whole number, got "0".');
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
// These tests run the fixture by its path; this links them to it, loading nothing (#1415).
import.meta.glob('./simulate.fixture.ts');

/** A project whose rules module is `rules`, already holding a scratch file and a chunk worktree. */
function projectWithAuthorFiles(rules: string): { dir: string; expectAuthorFilesKept: () => void } {
  const dir = tempTree('boardsmith-simulate-391-');
  writeFileSync(
    join(dir, 'boardsmith.json'),
    JSON.stringify({ name: 'fixture', backend: 'table', gameOptions: [{ id: 'deadEnd', type: 'number', label: 'Dead end', default: 5 }] }),
  );
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
    `  minPlayers: 3, maxPlayers: 4 };`,
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
    `  minPlayers: 3, maxPlayers: 4 };`,
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
    expect(forgotMetrics.output).toContain("Metric 'mode' was refused: it is not in gameDefinition.metrics");
  });

  it('--csv with an unfinished game prints the failure, no rows, and exits 1', () => {
    expect(failingCsv.exitCode).toBe(1);
    expect(failingCsv.output).toContain('Replay: boardsmith simulate --replay fails-3-');
    expect(failingCsv.output).not.toContain('variant,players');
  });
});

/**
 * #556: a run's games are always played on worker threads, each importing the same bundle and
 * playing a round-robin share, combined in game order, so the result is the same whatever the
 * worker count.
 */
describe('--jobs: games played on worker threads (#556)', () => {
  it('gives the same result for any worker count, dealing the games round-robin', async () => {
    const random = new SeededRandom('jobs-property');
    for (let run = 0; run < 5; run++) {
      const options = {
        gamesPerCount: 1 + random.nextInt(6),
        playerCounts: [[2], [3], [2, 3]][random.nextInt(3)],
        seed: `jobs-${run}`,
        policyFlags: random.nextInt(2) === 0 ? [] : ['2=biggest'],
      };
      const jobs = 2 + random.nextInt(3);
      const games = options.gamesPerCount * options.playerCounts.length;
      takeSlices();
      const one = await runSimulation(shardRules, { ...options, jobs: 1 });
      expect(takeSlices()).toEqual([games]);
      const several = await runSimulation(shardRules, { ...options, jobs });
      expect(JSON.stringify(several)).toBe(JSON.stringify(one));

      const count = Math.min(jobs, games);
      expect(takeSlices()).toEqual(Array.from({ length: count }, (_, w) => Math.ceil((games - w) / count)));
    }
    // Every worker has stopped by the time its run returns.
    expect(workerLog.exited).toBe(workerLog.started);
  }, 120_000);

  it('stops a worker still playing when another fails, and says why', async () => {
    // A stand-in bundle: its first game fails at once, and its second never ends.
    const dir = tempTree('boardsmith-simulate-stuck-worker-');
    const bundlePath = join(dir, 'bundle.mjs');
    writeFileSync(
      bundlePath,
      [
        'export async function playShard(_bundle, request) {',
        "  if (request.games[0].seed === 'fails') throw new Error('this slice failed');",
        '  setInterval(() => {}, 1000);',
        '  return new Promise(() => {});',
        '}',
      ].join('\n'),
    );
    takeSlices();
    const exitedBefore = workerLog.exited;
    const request = { games: [{ seed: 'fails', players: 2 }, { seed: 'never ends', players: 2 }], policyFlags: [], gameOptions: {}, maxActions: 10 };
    await expect(playOnWorkers(bundlePath, request, 2, 'production')).rejects.toThrow('this slice failed');
    expect(takeSlices()).toEqual([1, 1]);
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
const productionOnly = await simulateOutput(scoreDir, { games: '2', players: '2', seed: 'p', gameOption: ['breakInProduction=true'] });
const productionOnlyJson = await simulateOutput(scoreDir, { games: '2', players: '2', seed: 'p', json: true, gameOption: ['breakInProduction=true'] });
const policyClash = await simulateOutput(scoreDir, { games: '1', players: '2', policy: ['biggest'], compare: ['policy=random,steady'] });

describe('boardsmith simulate --jobs (#556)', () => {
  it('prints byte-identical --json whatever the worker count', () => {
    expect(jobsOne.exitCode, jobsOne.output).toBe(0);
    expect(jobsThree.output).toBe(jobsOne.output);
    // Ten games (five at each of 2 and 3 players): one worker, or three dealt round-robin.
    expect(jobsOneSlices).toEqual([10]);
    expect(jobsThreeSlices).toEqual([4, 3, 3]);
  });

  it('plays in production mode whatever the worker count', () => {
    for (const { output } of [jobsOne, jobsThree]) {
      for (const count of JSON.parse(output).report) expect(count.categories.mode.production.share).toBe(1);
    }
  });

  it('says plainly when a game fails only in production mode, and prints no replay that would finish', () => {
    expect(productionOnly.exitCode).toBe(1);
    expect(productionOnly.output).toMatch(/^Game 0 error \(seed p-2-0\)|^Game 0 stuck \(seed p-2-0\)/m);
    expect(productionOnly.output).toContain('This game fails only in production mode');
    expect(productionOnly.output).toContain('a choices, condition or filter callback');
    expect(productionOnly.output).not.toContain('Replay:');
  });

  it('marks such a game productionOnly in --json', () => {
    expect(productionOnlyJson.exitCode).toBe(1);
    expect(JSON.parse(productionOnlyJson.output).games[0]).toMatchObject({ index: 0, productionOnly: true });
  });

  it("reports a failing game's real message, replayed in dev mode, and a replay command carrying its variant", () => {
    expect(failingInWorker.exitCode).toBe(1);
    // The game's own line, not the engine's log: a worker's production mode leaves the throw's text out of it.
    expect(failingInWorker.output).toMatch(/^Game 0 stuck \(seed w-2-0\).*\n {2}Action 'add' rejected the move .*, chosen by policy 'random': .*\(a score of \d+ is over the limit of 4\)/m);
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
      { target: 6, limit: 1000, breakInProduction: false },
      { target: 9, limit: 1000, breakInProduction: false },
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
    expect(neverImported.output).toContain('--compare src/rules/data/unused.csv: the rules never import it');
    expect(neverImported.output).not.toContain("Failed to load this game's rules");
  });

  it('names --compare when a policy it gives clashes with a --policy flag', () => {
    expect(policyClash.exitCode).toBe(1);
    expect(policyClash.output).toContain('--compare policy=random sets every seat, which --policy biggest already sets');
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
