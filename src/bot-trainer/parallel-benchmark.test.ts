/**
 * The evolution loop's work distributor. Real benchmarks spawn worker threads
 * that play hundreds of games, so the worker itself is faked here — what is
 * under test is the coordination: every game of every weight set is played
 * exactly once, each set gets its win rate, in order, a crashed worker cannot
 * lose or duplicate work, and an erroring or exiting worker fails the run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

/** One benchmark game's outcome, as a worker reports it. */
type GameOutcome = { wins: number; losses: number; draws: number; incomplete: number };

/** Behaviour a fake worker applies to each request it receives. */
type WorkerBehaviour = (request: any) => GameOutcome | { error: string } | 'crash' | 'exit';

let behaviour: WorkerBehaviour;
let createdWorkers: FakeWorker[];
let terminated: number;

class FakeWorker extends EventEmitter {
  readonly received: any[] = [];

  constructor(public readonly path: unknown) {
    super();
    createdWorkers.push(this);
  }

  postMessage(request: any): void {
    this.received.push(request);
    // Reply asynchronously, like a real worker thread.
    queueMicrotask(() => {
      const outcome = behaviour(request);
      if (outcome === 'crash') {
        this.emit('error', new Error('worker exploded'));
        return;
      }
      if (outcome === 'exit') {
        // Game code calling process.exit(0): the thread ends with no error event.
        this.emit('exit', 0);
        return;
      }
      this.emit('message', { piece: request.piece, ...outcome });
    });
  }

  async terminate(): Promise<void> {
    terminated++;
  }
}

vi.mock('worker_threads', () => ({
  Worker: class {
    constructor(path: unknown) {
      return new FakeWorker(path) as unknown as never;
    }
  },
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, cpus: () => new Array(4).fill({}) };
});

const { runParallelBenchmarks } = await import('./parallel-benchmark.js');

import type { ObjectiveWeight } from './types.js';
import type { BenchmarkJob } from './parallel-benchmark.js';

const objectives = (weight: number): ObjectiveWeight[] => [{ id: `f${weight}`, weight }];

const config = { gameCount: 10, mctsIterations: 5, timeout: 1000, maxActions: 100, seed: 's' };

const won = (win: boolean): GameOutcome => ({ wins: win ? 1 : 0, losses: win ? 0 : 1, draws: 0, incomplete: 0 });

const run = (
  population: ObjectiveWeight[][],
  options?: { workerCount?: number },
  onProgress?: (completed: number, total: number) => void,
) => runParallelBenchmarks('/game.js', 'test', population.map((weights) => ({ weights, config })), options, onProgress);

/**
 * The fake workers answer in microtasks, so the run has settled by the next
 * macrotask; 'pending' there means it would hang.
 */
const settledBeforeNextMacrotask = (promise: Promise<number[]>) =>
  Promise.race([
    promise.then((value) => value, (error: unknown) => error),
    new Promise((resolve) => setImmediate(() => resolve('pending'))),
  ]);

/** Each request as [weight, game], sorted. */
const sent = () => createdWorkers
  .flatMap((worker) => worker.received.map((r) => [r.weights[0].weight, r.config.game]))
  .sort(([a, b], [c, d]) => a - c || b - d);

beforeEach(() => {
  createdWorkers = [];
  terminated = 0;
  // A set of weight w wins its first w of 10 games, so its win rate is w / 10 and results can be matched to inputs.
  behaviour = (request) => won(request.config.game < request.weights[0].weight);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runParallelBenchmarks', () => {
  it('returns nothing for an empty population, without starting a worker', async () => {
    expect(await run([])).toEqual([]);
    expect(createdWorkers).toHaveLength(0);
  });

  it('scores an empty objective set 0 without sending it to a worker', async () => {
    expect(await run([[]])).toEqual([0]);
    expect(createdWorkers).toHaveLength(0);
  });

  it('returns one win rate per weight set', async () => {
    expect(await run([objectives(1), objectives(2), objectives(3)])).toHaveLength(3);
  });

  it('indexes each result by its weight set, not by arrival order', async () => {
    expect(await run([objectives(3), objectives(1), objectives(2)], { workerCount: 3 })).toEqual([0.3, 0.1, 0.2]);
  });

  it('mixes scored and empty weight sets correctly', async () => {
    expect(await run([objectives(1), [], objectives(3)])).toEqual([0.1, 0, 0.3]);
  });

  it('sends each game of each weight set to a worker exactly once (#1307)', async () => {
    await run([objectives(1), objectives(2)]);
    expect(sent()).toEqual([1, 2].flatMap((weight) => Array.from({ length: 10 }, (_, game) => [weight, game])));
  });

  it('scores a set by its wins over the games that finished, as benchmarkBot does (#1307)', async () => {
    behaviour = (request) => request.config.game === 0
      ? { wins: 0, losses: 0, draws: 0, incomplete: 1 }
      : won(request.config.game === 1);
    expect(await run([objectives(5)])).toEqual([1 / 9]);
  });

  it('passes the game module, type, weights and config, with the one game to play, through to the worker', async () => {
    await run([objectives(1)], { workerCount: 1 });
    expect(createdWorkers[0].received[0]).toMatchObject({
      gameModulePath: '/game.js',
      gameType: 'test',
      weights: objectives(1),
      config: { ...config, game: 0 },
    });
  });

  it("sends each job its own config, so jobs can play differently seeded games (#1031)", async () => {
    const seeded = (seed: string): BenchmarkJob['config'] => ({ ...config, gameCount: 2, seed });
    await runParallelBenchmarks('/game.js', 'test', [
      { weights: objectives(1), config: seeded('a') },
      { weights: objectives(1), config: seeded('b') },
    ], { workerCount: 1 });
    expect(createdWorkers[0].received.map((request) => request.config)).toEqual([
      { ...seeded('a'), game: 0 }, { ...seeded('a'), game: 1 }, { ...seeded('b'), game: 0 }, { ...seeded('b'), game: 1 },
    ]);
  });

  it('honours an explicit worker count', async () => {
    await run([objectives(1), objectives(2), objectives(3), objectives(4)], { workerCount: 2 });
    expect(createdWorkers).toHaveLength(2);
  });

  it("shares one weight set's games across the whole pool (#1307)", async () => {
    await run([objectives(5)], { workerCount: 4 });
    expect(createdWorkers).toHaveLength(4);
    expect(createdWorkers.every((worker) => worker.received.length > 0)).toBe(true);
  });

  it('never starts more workers than there are games', async () => {
    await runParallelBenchmarks('/game.js', 'test', [{ weights: objectives(1), config: { ...config, gameCount: 1 } }], { workerCount: 8 });
    expect(createdWorkers).toHaveLength(1);
  });

  it('starts at least one worker even when asked for none', async () => {
    await run([objectives(1)], { workerCount: 0 });
    expect(createdWorkers).toHaveLength(1);
  });

  it('defaults the pool to one fewer than the CPU count', async () => {
    await run([objectives(1)]);
    expect(createdWorkers).toHaveLength(3);
  });

  it('terminates every worker once the run finishes', async () => {
    await run([objectives(1), objectives(2)], { workerCount: 2 });
    expect(terminated).toBe(2);
  });

  it('reports progress once per game played, ending at the total (#1307)', async () => {
    const progress: Array<[number, number]> = [];
    await run([objectives(1), objectives(2)], { workerCount: 1 }, (completed, total) => progress.push([completed, total]));
    expect(progress).toEqual(Array.from({ length: 20 }, (_, i) => [i + 1, 20]));
  });

  it('rejects, naming the weight set, the game and the reason, when its worker reports an error (#1307)', async () => {
    behaviour = (request) => request.weights[0].weight === 2 && request.config.game === 3
      ? { error: 'benchmark blew up' }
      : won(true);
    const outcome = await settledBeforeNextMacrotask(
      run([objectives(1), objectives(2), objectives(3)], { workerCount: 3 }),
    );
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe(
      'Benchmark game 4 of 10 of weight set 2 of 3 for "test" failed: benchmark blew up',
    );
    expect(terminated).toBe(3);
  });

  it('rejects instead of hanging when a worker exits without an error event', async () => {
    behaviour = (request) => request.weights[0].weight === 1 && request.config.game === 0 ? 'exit' : won(true);
    const outcome = await settledBeforeNextMacrotask(
      run([objectives(1), objectives(2)], { workerCount: 2 }),
    );
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe(
      'A benchmark worker for "test" stopped (exit code 0) while playing benchmark game 1 of 10 of weight set 1 of 2.',
    );
    expect(terminated).toBe(2);
  });

  it('re-queues work lost to a crashed worker instead of dropping it', async () => {
    let crashed = false;
    const fair = behaviour;
    behaviour = (request) => {
      if (!crashed && request.config.game === 0) {
        crashed = true;
        return 'crash';
      }
      return fair(request);
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run([objectives(1), objectives(2)], { workerCount: 2 })).toEqual([0.1, 0.2]);
  });

  it('rejects with an actionable error when every worker crashes', async () => {
    behaviour = () => 'crash';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run([objectives(1)], { workerCount: 1 }))
      .rejects.toThrow('All benchmark workers crashed');
  });

  it('completes a population larger than the pool by reusing workers', async () => {
    const population = Array.from({ length: 7 }, (_, i) => objectives(i + 1));
    const result = await run(population, { workerCount: 2 });
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(createdWorkers).toHaveLength(2);
  });
});
