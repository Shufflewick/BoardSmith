/**
 * `WeightEvolver` runs the µ+λ loop that tunes an existing ai.ts's weights.
 * A real evaluation plays hundreds of games in worker threads, so the benchmark
 * layer is faked here and what is under test is the loop itself: the baseline,
 * the generation count, and that the best candidate ever seen is what comes out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LearnedObjective, TrainingProgress } from './types.js';
import { Game, Player } from '../engine/index.js';

/** Fitness for each benchmarked population, controlled per test. */
let fitnessOf: (objectives: LearnedObjective[]) => number;
const benchmarkCalls: LearnedObjective[][][] = [];

vi.mock('./parallel-benchmark.js', () => ({
  runParallelBenchmarks: vi.fn(async (
    _path: string,
    _type: string,
    population: LearnedObjective[][],
  ) => {
    benchmarkCalls.push(population);
    return population.map((individual) => fitnessOf(individual));
  }),
}));

const { WeightEvolver } = await import('./weight-evolver.js');

class EvolveGame extends Game<EvolveGame, Player> {}

const objectives = (...weights: number[]): LearnedObjective[] =>
  weights.map((weight, i) => ({
    featureId: `f${i}`,
    description: `feature ${i}`,
    weight,
    checkerCode: '(game, p) => true',
    correlation: 0.5,
  }));

const evolver = (config = {}) =>
  new WeightEvolver(EvolveGame, 'evolve-game', '/tmp/game.js', {
    evolutionGenerations: 2,
    evolutionMu: 2,
    evolutionLambda: 3,
    evolutionBenchmarkGames: 4,
    seed: 'fixed',
    ...config,
  });

/** Total weight of an individual — a stand-in for "how good is this candidate". */
const totalWeight = (individual: LearnedObjective[]) =>
  individual.reduce((sum, o) => sum + o.weight, 0);

beforeEach(() => {
  benchmarkCalls.length = 0;
  vi.clearAllMocks();
  fitnessOf = () => 0.5;
});

describe('WeightEvolver.evolve', () => {
  it('refuses an empty objective list with an actionable error', async () => {
    await expect(evolver().evolve([])).rejects.toThrow('No objectives provided for evolution');
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

    expect(result.objectives.map((o) => o.featureId)).toEqual(['f0', 'f1']);
    for (const objective of result.objectives) {
      expect(Number.isFinite(objective.weight)).toBe(true);
      expect(objective.checkerCode).toBe('(game, p) => true');
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
      expect(individual.map((o) => o.featureId)).toEqual(['f0', 'f1']);
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
    expect(progress[0].message).toContain('Analyzing game structure');
    expect(progress.some((p) => p.message.includes('Benchmarking initial'))).toBe(true);
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
    const { runParallelBenchmarks } = await import('./parallel-benchmark.js');
    await evolver({ evolutionBenchmarkGames: 12, benchmarkMCTSIterations: 7 })
      .evolve(objectives(5));
    for (const call of vi.mocked(runParallelBenchmarks).mock.calls) {
      expect(call[4]).toMatchObject({ gameCount: 12, mctsIterations: 7 });
    }
  });

  it('does no evolution at all when asked for zero generations', async () => {
    fitnessOf = () => 0.33;
    const result = await evolver({ evolutionGenerations: 0 }).evolve(objectives(5));
    expect(benchmarkCalls).toHaveLength(1);
    expect(result.bestFitness).toBe(0.33);
    expect(result.objectives.map((o) => o.weight)).toEqual([5]);
  });
});
