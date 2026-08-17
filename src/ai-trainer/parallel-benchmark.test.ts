/**
 * The evolution loop's work distributor. Real benchmarks spawn worker threads
 * that play hundreds of games, so the worker itself is faked here — what is
 * under test is the coordination: every individual gets a fitness, in order,
 * exactly once, and a crashed or erroring worker cannot lose or duplicate work.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

/** Behaviour a fake worker applies to each request it receives. */
type WorkerBehaviour = (request: any) => { winRate: number } | { error: string } | 'crash';

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
      this.emit('message', 'error' in outcome
        ? { individualIndex: request.individualIndex, error: outcome.error }
        : { individualIndex: request.individualIndex, winRate: outcome.winRate });
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

import type { LearnedObjective, SerializableGameStructure } from './types.js';

const objectives = (weight: number): LearnedObjective[] => [{
  featureId: `f${weight}`,
  description: 'f',
  weight,
  checkerCode: '(g, p) => true',
  correlation: 0.5,
}];

const structure: SerializableGameStructure = {
  elementTypes: {},
  playerInfo: { numericProperties: [], booleanProperties: [], stringProperties: [] },
  spatialInfo: { hasBoard: false, isHex: false },
  playerCount: 2,
  winConditionInfo: {
    gameType: 'unknown',
    confidence: 0,
    indicators: [],
    scoreBased: false,
    eliminationBased: false,
    connectionBased: false,
    collectionBased: false,
  },
};

const config = { gameCount: 10, mctsIterations: 5, timeout: 1000, maxActions: 100, seed: 's' };

const run = (
  population: LearnedObjective[][],
  options?: { workerCount?: number },
  onProgress?: (completed: number, total: number) => void,
) => runParallelBenchmarks('/game.js', 'test', population, structure, config, options, onProgress);

beforeEach(() => {
  createdWorkers = [];
  terminated = 0;
  // Fitness mirrors the individual's weight so results can be matched to inputs.
  behaviour = (request) => ({ winRate: request.objectives[0].weight / 100 });
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

  it('returns one fitness per individual', async () => {
    expect(await run([objectives(10), objectives(20), objectives(30)])).toHaveLength(3);
  });

  it('indexes each result by its individual, not by arrival order', async () => {
    // The worker answers with a fitness derived from the individual it was
    // given, so a slot mix-up in the coordinator shows up as a reordering.
    expect(await run([objectives(30), objectives(10), objectives(20)], { workerCount: 3 }))
      .toEqual([0.3, 0.1, 0.2]);
  });

  it('mixes scored and empty individuals correctly', async () => {
    expect(await run([objectives(10), [], objectives(30)])).toEqual([0.1, 0, 0.3]);
  });

  it('sends each individual to a worker exactly once', async () => {
    await run([objectives(10), objectives(20), objectives(30)]);
    const sentIndexes = createdWorkers
      .flatMap((worker) => worker.received.map((r) => r.individualIndex))
      .sort();
    expect(sentIndexes).toEqual([0, 1, 2]);
  });

  it('passes the game module, type, config and structure through to the worker', async () => {
    await run([objectives(10)]);
    expect(createdWorkers[0].received[0]).toMatchObject({
      gameModulePath: '/game.js',
      gameType: 'test',
      config,
      structure,
    });
  });

  it('honours an explicit worker count', async () => {
    await run([objectives(1), objectives(2), objectives(3), objectives(4)], { workerCount: 2 });
    expect(createdWorkers).toHaveLength(2);
  });

  it('never starts more workers than there are individuals', async () => {
    await run([objectives(1)], { workerCount: 8 });
    expect(createdWorkers).toHaveLength(1);
  });

  it('starts at least one worker even when asked for none', async () => {
    await run([objectives(1)], { workerCount: 0 });
    expect(createdWorkers).toHaveLength(1);
  });

  it('defaults the pool to one fewer than the CPU count', async () => {
    await run(Array.from({ length: 10 }, (_, i) => objectives(i + 1)));
    expect(createdWorkers).toHaveLength(3);
  });

  it('terminates every worker once the run finishes', async () => {
    await run([objectives(1), objectives(2)], { workerCount: 2 });
    expect(terminated).toBe(2);
  });

  it('reports progress once per completed individual, ending at the total', async () => {
    const progress: Array<[number, number]> = [];
    await run(
      [objectives(10), objectives(20), objectives(30)],
      { workerCount: 1 },
      (completed, total) => progress.push([completed, total]),
    );
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('scores an individual 0 when its worker reports an error', async () => {
    behaviour = (request) => request.individualIndex === 1
      ? { error: 'benchmark blew up' }
      : { winRate: 0.5 };
    expect(await run([objectives(10), objectives(20), objectives(30)]))
      .toEqual([0.5, 0, 0.5]);
  });

  it('re-queues work lost to a crashed worker instead of dropping it', async () => {
    let crashed = false;
    behaviour = (request) => {
      if (!crashed && request.individualIndex === 0) {
        crashed = true;
        return 'crash';
      }
      return { winRate: 0.7 };
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run([objectives(10), objectives(20)], { workerCount: 2 }))
      .toEqual([0.7, 0.7]);
  });

  it('rejects with an actionable error when every worker crashes', async () => {
    behaviour = () => 'crash';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run([objectives(10)], { workerCount: 1 }))
      .rejects.toThrow('All benchmark workers crashed');
  });

  it('completes a population larger than the pool by reusing workers', async () => {
    const population = Array.from({ length: 7 }, (_, i) => objectives((i + 1) * 10));
    const result = await run(population, { workerCount: 2 });
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(createdWorkers).toHaveLength(2);
  });
});
