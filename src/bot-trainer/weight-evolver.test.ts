/**
 * `WeightEvolver` runs the µ+λ loop that tunes an existing bot.ts's weights.
 * A real evaluation plays hundreds of games in worker threads, so the benchmark
 * layer is faked here and what is under test is the loop itself: the baseline,
 * the generation count, and that the best candidate ever seen is what comes out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ObjectiveWeight, TrainingProgress } from './types.js';
import type { WeightEvolverConfig } from './weight-evolver.js';
import type { BenchmarkConfig } from './benchmark.js';
import type { BenchmarkJob } from './parallel-benchmark.js';
import { createSeededRandom } from '../utils/random.js';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import type { BotStrategy } from '../bot/index.js';
import { benchmarkBot, weightedBot } from './benchmark.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../testing/temp-tree.test-helper.js';

/** Fitness for each benchmarked population, controlled per test. */
let fitnessOf: (objectives: ObjectiveWeight[], config?: BenchmarkConfig) => number;
const benchmarkCalls: ObjectiveWeight[][][] = [];

vi.mock('./parallel-benchmark.js', () => ({
  runParallelBenchmarks: vi.fn(async (_path: string, _type: string, jobs: BenchmarkJob[]) => {
    benchmarkCalls.push(jobs.map((job) => job.weights));
    return jobs.map((job) => fitnessOf(job.weights, job.config));
  }),
}));

/** Every path loads the bundle below, except where a test hands the real loader a file. */
vi.mock('./training-bundle.js', () => ({ loadTrainingBundle: vi.fn() }));

const { WeightEvolver } = await import('./weight-evolver.js');
const { loadTrainingBundle } = await import('./training-bundle.js');
const realLoader = await vi.importActual<typeof import('./training-bundle.js')>('./training-bundle.js');
const { runParallelBenchmarks } = await import('./parallel-benchmark.js');

/** The config of every job in every benchmark run, run by run. */
const benchmarkConfigs = () => vi.mocked(runParallelBenchmarks).mock.calls.map((call) => call[2].map((job) => job.config));

class EvolveGame extends Game<EvolveGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create<EvolveGame>('pass').execute(() => {}));
    this.setFlow({ root: actionStep({ actions: ['pass'] }) });
  }
}

/** The game's own bot: objectives f0 to f3. */
const bot: BotStrategy = {
  objectives: () =>
    Object.fromEntries(['f0', 'f1', 'f2', 'f3'].map((id) => [id, { checker: () => 0, weight: 1 }])),
};

const objectives = (...weights: number[]): ObjectiveWeight[] =>
  weights.map((weight, i) => ({ id: `f${i}`, weight }));

const evolver = (config: Partial<WeightEvolverConfig> = {}) =>
  new WeightEvolver('/tmp/game.js', 'evolve-game', {
    evolutionGenerations: 2,
    evolutionMu: 2,
    evolutionLambda: 3,
    evolutionBenchmarkGames: 4,
    seed: 'fixed',
    ...config,
  });

/** Total weight of an individual — a stand-in for "how good is this candidate". */
const totalWeight = (individual: ObjectiveWeight[]) =>
  individual.reduce((sum, o) => sum + o.weight, 0);

/**
 * A benchmark with real sampling noise: `config.gameCount` games, each won with
 * probability `strength(individual)`, drawn from the benchmark's seed and the
 * individual, so the same games give the same score and fresh games a fresh one.
 */
const noisy = (strength: (individual: ObjectiveWeight[]) => number) =>
  (individual: ObjectiveWeight[], config?: BenchmarkConfig) => {
    const rng = createSeededRandom(`${config!.seed}|${JSON.stringify(individual)}`);
    const games = config!.gameCount!;
    let wins = 0;
    for (let game = 0; game < games; game++) if (rng() < strength(individual)) wins++;
    return wins / games;
  };

/** The search's own defaults, so the search is as easily fooled as a real run's. */
const defaultSearch = { evolutionGenerations: 5, evolutionMu: 5, evolutionLambda: 20, evolutionBenchmarkGames: 50 };

beforeEach(() => {
  benchmarkCalls.length = 0;
  vi.clearAllMocks();
  vi.mocked(loadTrainingBundle).mockResolvedValue({ gameDefinition: { gameClass: EvolveGame, bot }, benchmarkBot, weightedBot });
  fitnessOf = () => 0.5;
});

describe('WeightEvolver.evolve', () => {
  it('refuses an empty objective list with an actionable error', async () => {
    await expect(evolver().evolve([])).rejects.toThrow('No objectives provided for evolution');
  });

  it('refuses, in this process and before benchmarking, a bundle built without the benchmark (#697)', async () => {
    const dir = tempTree('bs-weight-evolver-697-');
    const bundlePath = join(dir, 'rules.mjs');
    writeFileSync(bundlePath, 'export const gameDefinition = { gameClass: class {} };\n');
    vi.mocked(loadTrainingBundle).mockImplementationOnce(realLoader.loadTrainingBundle);
    await expect(new WeightEvolver(bundlePath, 'evolve-game').evolve(objectives(5))).rejects.toThrow(
      `${bundlePath} must export the game's gameDefinition, benchmarkBot and weightedBot`,
    );
    expect(benchmarkCalls).toEqual([]);
  });

  it("refuses, naming it, a weight for an objective the game's bot does not define, before benchmarking", async () => {
    await expect(evolver().evolve([...objectives(5), { id: 'ghost', weight: 1 }])).rejects.toThrow(/'ghost'/);
    expect(benchmarkCalls).toEqual([]);
  });

  it('benchmarks the supplied objectives once, first, to get a baseline', async () => {
    fitnessOf = () => 0.42;
    const result = await evolver().evolve(objectives(5));
    expect(benchmarkCalls[0]).toHaveLength(1);
    expect(result.initialFitness).toBe(0.42);
  });

  it('returns usable objectives, a fitness and the baseline, not just the right keys', async () => {
    fitnessOf = (individual) => Math.min(1, Math.abs(totalWeight(individual)) / 20);
    const result = await evolver().evolve(objectives(5, -3));

    expect(result.objectives.map((o) => o.id)).toEqual(['f0', 'f1']);
    for (const objective of result.objectives) {
      expect(Number.isFinite(objective.weight)).toBe(true);
    }
    expect(result.bestFitness).toBeGreaterThanOrEqual(0);
    expect(result.bestFitness).toBeLessThanOrEqual(1);
    expect(result.initialFitness).toBe(fitnessOf(objectives(5, -3)));
  });

  it('runs one evaluation per generation after the baseline', async () => {
    await evolver({ evolutionGenerations: 3 }).evolve(objectives(5));
    expect(benchmarkCalls).toHaveLength(4);
  });

  it('evaluates parents plus lambda offspring each generation', async () => {
    await evolver({ evolutionGenerations: 1, evolutionMu: 2, evolutionLambda: 3 })
      .evolve(objectives(5));
    expect(benchmarkCalls[1]).toHaveLength(5);
  });

  it('keeps the original objectives in the very first population', async () => {
    const original = objectives(5, -3);
    await evolver({ evolutionGenerations: 1 }).evolve(original);
    expect(benchmarkCalls[1][0].map((o) => o.weight)).toEqual([5, -3]);
  });

  it('keeps the objective identities while varying the weights', async () => {
    await evolver({ evolutionGenerations: 1 }).evolve(objectives(5, -3));
    for (const individual of benchmarkCalls[1]) {
      expect(individual.map((o) => o.id)).toEqual(['f0', 'f1']);
    }
  });

  it('actually mutates the weights rather than re-benchmarking one candidate', async () => {
    await evolver({ evolutionGenerations: 1 }).evolve(objectives(5, -3));
    const distinct = new Set(benchmarkCalls[1].map((i) => JSON.stringify(i.map((o) => o.weight))));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('returns the best candidate it found, not the last one it tried', async () => {
    fitnessOf = (individual) => Math.min(1, Math.max(0, totalWeight(individual) / 20));
    const result = await evolver({ evolutionGenerations: 2 }).evolve(objectives(5));
    const bestSeen = Math.max(
      ...benchmarkCalls.flat().map((individual) => fitnessOf(individual)),
    );
    expect(result.bestFitness).toBe(bestSeen);
    expect(fitnessOf(result.objectives)).toBe(bestSeen);
  });

  it('never returns a fitness below the baseline', async () => {
    // The starting objectives are always in the population, so evolution can
    // only ever match or beat where it began.
    fitnessOf = (individual) => (totalWeight(individual) === 5 ? 0.9 : 0.1);
    const result = await evolver().evolve(objectives(5));
    expect(result.bestFitness).toBeGreaterThanOrEqual(result.initialFitness);
  });

  it('keeps the original objectives when nothing beats them', async () => {
    fitnessOf = (individual) => (totalWeight(individual) === 5 ? 0.9 : 0.1);
    const result = await evolver().evolve(objectives(5));
    expect(result.objectives.map((o) => o.weight)).toEqual([5]);
  });

  it('is reproducible for the same seed', async () => {
    fitnessOf = (individual) => Math.min(1, Math.abs(totalWeight(individual)) / 20);
    const first = await evolver().evolve(objectives(5));
    benchmarkCalls.length = 0;
    const second = await evolver().evolve(objectives(5));
    expect(second.objectives).toEqual(first.objectives);
    expect(second.bestFitness).toBe(first.bestFitness);
  });

  it('explores differently under a different seed', async () => {
    fitnessOf = (individual) => Math.min(1, Math.abs(totalWeight(individual)) / 20);
    await evolver({ seed: 'alpha' }).evolve(objectives(5));
    const alpha = JSON.stringify(benchmarkCalls[1]);
    benchmarkCalls.length = 0;
    await evolver({ seed: 'beta' }).evolve(objectives(5));
    expect(JSON.stringify(benchmarkCalls[1])).not.toBe(alpha);
  });

  it('reports progress from setup through the final generation', async () => {
    const progress: TrainingProgress[] = [];
    await evolver({ evolutionGenerations: 2, onProgress: (p) => progress.push(p) })
      .evolve(objectives(5));
    expect(progress[0].message).toContain('Benchmarking initial');
    expect(progress.at(-1)!.iteration).toBe(2);
    expect(progress.at(-1)!.totalIterations).toBe(2);
  });

  it('reports a non-decreasing best win rate as it goes', async () => {
    const rates: number[] = [];
    fitnessOf = (individual) => Math.min(1, Math.abs(totalWeight(individual)) / 20);
    await evolver({ onProgress: (p) => rates.push(p.bestWinRate) }).evolve(objectives(5));
    expect(rates).toEqual([...rates].sort((a, b) => a - b));
  });

  it('runs without a progress callback', async () => {
    await expect(evolver({ onProgress: undefined }).evolve(objectives(5))).resolves.toBeDefined();
  });

  it('threads the benchmark game count and MCTS budget into every evaluation', async () => {
    await evolver({ evolutionBenchmarkGames: 12, benchmarkMCTSIterations: 7 })
      .evolve(objectives(5));
    for (const config of benchmarkConfigs().flat()) {
      expect(config).toMatchObject({ gameCount: 12, mctsIterations: 7 });
    }
  });

  it('benchmarks every evaluation reproducibly from the evolution seed, with no game clock (#699)', async () => {
    await evolver({ seed: 'repeat' }).evolve(objectives(5));
    const configs = benchmarkConfigs();
    expect(configs.map((run) => [...new Set(run.map((c) => c.seed))])).toEqual([
      ['repeat-initial'], ['repeat-gen-1'], ['repeat-gen-2'],
    ]);
    expect(configs.flat().every((c) => c.reproducible === true && c.timeout === undefined)).toBe(true);
  });

  it('plays new games at every stage of an unseeded evolution, with unseeded, clock-bounded searches (#699)', async () => {
    await evolver({ seed: undefined }).evolve(objectives(5));
    const first = benchmarkConfigs().flat();
    expect(first.every((c) => c.reproducible !== true && c.timeout === 30000)).toBe(true);
    const gameSeeds = benchmarkConfigs().map((run) => run[0].seed);
    expect(new Set(gameSeeds).size).toBe(gameSeeds.length);
    expect(gameSeeds.every((seed) => typeof seed === 'string')).toBe(true);

    vi.mocked(runParallelBenchmarks).mockClear();
    await evolver({ seed: undefined }).evolve(objectives(5));
    const again = benchmarkConfigs().flat().map((c) => c.seed);
    expect(again.some((seed) => gameSeeds.includes(seed))).toBe(false);
  });

  it('mutates afresh on each unseeded evolution, as a run with no seed always has (#699)', async () => {
    await evolver({ seed: undefined }).evolve(objectives(5));
    const first = JSON.stringify(benchmarkCalls[1]);
    benchmarkCalls.length = 0;
    await evolver({ seed: undefined }).evolve(objectives(5));
    expect(JSON.stringify(benchmarkCalls[1])).not.toBe(first);
  });

  it('refuses a game timeout on a seeded evolution, before benchmarking (#699)', async () => {
    await expect(evolver({ seed: 'repeat', gameTimeout: 1000 }).evolve(objectives(5))).rejects.toThrow(/gameTimeout/);
    expect(runParallelBenchmarks).not.toHaveBeenCalled();
  });

  it('does no evolution at all when asked for zero generations', async () => {
    fitnessOf = () => 0.33;
    const result = await evolver({ evolutionGenerations: 0 }).evolve(objectives(5));
    expect(benchmarkCalls).toHaveLength(1);
    expect(result.bestFitness).toBe(0.33);
    expect(result.objectives.map((o) => o.weight)).toEqual([5]);
  });
});

describe('WeightEvolver confirms the search pick on fresh games before keeping it (#870)', () => {
  const original = objectives(5, -3);
  const isOriginal = (individual: ObjectiveWeight[]) => JSON.stringify(individual) === JSON.stringify(original);

  it('keeps the original, and reports no improvement, when every candidate is as strong as it', async () => {
    fitnessOf = noisy(() => 0.5);
    // A seed that is not one of the ~1 in 20 runs the rule may wrongly accept; the 100-run test below checks the rate
    const result = await evolver({ ...defaultSearch, seed: 'equal-a' }).evolve(original);

    expect(result.bestFitness, 'the search should have been fooled by a lucky candidate').toBeGreaterThan(result.initialFitness);
    expect(result.objectives).toEqual(original);
    expect(result.confirmation).toMatchObject({ games: 400, accepted: false });
  });

  it('keeps the original in at least 90 of 100 equal-strength runs (the rule allows about 5)', async () => {
    fitnessOf = noisy(() => 0.5);
    let accepted = 0;
    for (let run = 0; run < 100; run++) {
      const result = await evolver({ ...defaultSearch, seed: `equal-${run}` }).evolve(original);
      if (result.confirmation?.accepted) accepted++;
      else expect(result.objectives).toEqual(original);
    }
    expect(accepted).toBeLessThanOrEqual(10);
  });

  it('accepts a clearly stronger candidate, and reports the confirmation rates over all its batches, not the search score', async () => {
    fitnessOf = noisy((individual) => (isOriginal(individual) ? 0.5 : 0.7));
    const result = await evolver({ ...defaultSearch, seed: 'stronger' }).evolve(original);

    expect(result.objectives).not.toEqual(original);
    const confirmation = result.confirmation!;
    expect(confirmation.accepted).toBe(true);
    const overBatches = (strength: number, weights: ObjectiveWeight[]) =>
      Array.from({ length: 20 }, (_, b) => noisy(() => strength)(weights, { gameCount: 20, seed: `stronger-confirm-${b}` }))
        .reduce((sum, rate) => sum + rate, 0) / 20;
    expect(confirmation.originalWinRate).toBe(overBatches(0.5, original));
    expect(confirmation.candidateWinRate).toBe(overBatches(0.7, result.objectives));
  });

  it('splits each set\'s 400 games into 20 separately seeded batches, both sets on the same games, on seeds the search never used (#1031)', async () => {
    fitnessOf = noisy((individual) => (isOriginal(individual) ? 0.5 : 0.7));
    await evolver({ seed: 'fresh' }).evolve(original);
    const [confirm, ...search] = benchmarkConfigs().reverse();
    const jobs = vi.mocked(runParallelBenchmarks).mock.calls.at(-1)![2];
    const batchSeeds = Array.from({ length: 20 }, (_, b) => `fresh-confirm-${b}`);
    const [originalJobs, candidateJobs] = [jobs.slice(0, 20), jobs.slice(20)];

    expect(jobs).toHaveLength(40);
    expect(originalJobs.every((job) => job.weights === original)).toBe(true);
    expect(candidateJobs.every((job) => job.weights === candidateJobs[0].weights && job.weights !== original)).toBe(true);
    expect(originalJobs.map((job) => job.config.seed)).toEqual(batchSeeds);
    expect(candidateJobs.map((job) => job.config.seed)).toEqual(batchSeeds);
    expect(confirm.every((c) => c.gameCount === 20 && c.reproducible === true)).toBe(true);
    expect(search.flat().some((c) => c.seed!.includes('confirm'))).toBe(false);
  });

  it('gives the pool at least as many confirmation jobs as workers, so none sits idle (#1031)', async () => {
    fitnessOf = noisy((individual) => (isOriginal(individual) ? 0.5 : 0.7));
    await evolver({ seed: 'busy', workerCount: 16 }).evolve(original);
    const [, , jobs, options] = vi.mocked(runParallelBenchmarks).mock.calls.at(-1)!;
    expect(options).toEqual({ workerCount: 16 });
    expect(jobs.length).toBeGreaterThanOrEqual(16);
  });

  it('confirms nothing when the search kept the original', async () => {
    fitnessOf = (individual) => (isOriginal(individual) ? 0.9 : 0.1);
    const result = await evolver().evolve(original);
    expect(result.confirmation).toBeUndefined();
    expect(result.objectives).toEqual(original);
  });
});

