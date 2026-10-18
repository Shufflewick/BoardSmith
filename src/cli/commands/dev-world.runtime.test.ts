/**
 * #283: `boardsmith dev` RUNS A WORLD ON THE ENGINE ITS RULES WERE BUILT ON.
 *
 * The rules are loaded by bundling them, engine included. The world host used
 * to be the CLI's own, on the CLI's own copy of the engine, so a world ran on
 * two: the read-only projection recognised none of the bundle's finders as the
 * engine's, and every offer walk paid a proxy trap per element per step --
 * 15-30 seconds a command with two seats attached.
 *
 * `loadWorldRuntime` is the table road's `loadTableRuntime` for a world: the
 * rules and the world host come out of ONE bundle, so they share one engine by
 * construction, exactly as the platform splices a world bundle around one. The
 * bundle runs in a worker (#885), so the world is reached by its calls.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { worldBudgets } from '../../world/index.js';
import { LocalWorldHost } from '../dev-host/world-host.js';
import type { WorldEvent } from '../dev-host/world-rules-worker.js';
import { openWorldStore } from '../dev-host/world-store.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { loadWorldRuntime } from './dev-world.js';
import { loadGameDefinition } from './game-runtime.js';

/** A one-room world project, written the way an author writes one. */
function worldProject(): { rulesPath: string; tempDir: string } {
  const dir = tempTree('bs-dev-world-runtime-');
  const rulesPath = join(dir, 'src', 'rules');
  mkdirSync(rulesPath, { recursive: true });
  writeFileSync(
    join(rulesPath, 'index.ts'),
    [
      "import { Game, Space } from 'boardsmith';",
      "import { worldAction } from 'boardsmith/world';",
      'class Yard extends Space {}',
      'class YardGame extends Game {',
      '  constructor(options: ConstructorParameters<typeof Game>[0]) {',
      '    super(options);',
      '    this.registerElements([Yard]);',
      '  }',
      '}',
      'export const gameDefinition = {',
      '  gameClass: YardGame,',
      "  gameType: 'dev-world-runtime',",
      '  world: {',
      '    maxPlayers: 2,',
      "    actions: [worldAction('look').needs(() => ['yard']).execute(() => {})],",
      "    view: () => ['yard'],",
      "    genesis: (game: YardGame) => ({ yard: game.create(Yard, 'yard') }),",
      '  },',
      '};',
    ].join('\n'),
  );
  const tempDir = join(dir, '.boardsmith');
  mkdirSync(tempDir, { recursive: true });
  return { rulesPath, tempDir };
}

// #363: bundling the rules with the engine and the world host is the slow part
// of these tests, seconds on a busy machine. So both bundles are built once,
// here, while the file is collected and no test timeout applies. Each test
// still opens its own store.
const project = worldProject();
const runtime = await loadWorldRuntime(project.rulesPath, project.tempDir, 'monorepo');
// The rules alone, bundled on their own engine, loaded into this process.
const definitionOnly = await loadGameDefinition(project.rulesPath, project.tempDir, 'monorepo', undefined);

/** A fresh store path per test, so no test sees another's world. */
function storePath(): string {
  return join(tempTree('bs-dev-world-store-'), 'world.db');
}

const closing: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

describe('loadWorldRuntime (#283)', () => {
  it('builds the world host into the same bundle as the rules, so a world runs on one engine', async () => {
    const frames: Array<{ clientId: string; message: { type: string; actions?: unknown } }> = [];
    runtime.worker.listen((event) => {
      const told = event as WorldEvent;
      if ('send' in told) frames.push({ clientId: told.send.clientId, message: JSON.parse(told.send.frame) });
    });
    await runtime.worker.call('open', { storePath: storePath(), port: 5173, worldName: 'Yard', budgets: worldBudgets(), pages: ['page-1'] });
    closing.push(async () => {
      await runtime.worker.call('close');
      await runtime.worker.close();
    });

    await runtime.worker.call('message', { clientId: 'page-1', message: { type: 'hello' } });

    const offers = frames.find((frame) => frame.message.type === 'world_offers');
    expect(offers, 'The bundled host answered a hello with no offers.').toBeDefined();
    expect((offers!.message.actions as Array<{ name: string }>).map((a) => a.name)).toEqual([
      'look',
    ]);
  });

  it("is needed: the CLI's own host refuses rules bundled on their own engine", () => {
    // What `boardsmith dev` used to do, which the world now refuses by name
    // rather than running slowly on two engines.
    const budgets = worldBudgets();
    const store = openWorldStore(storePath(), budgets);
    closing.push(async () => store.close());

    expect(
      () =>
        new LocalWorldHost({
          definition: definitionOnly as unknown as ConstructorParameters<
            typeof LocalWorldHost
          >[0]['definition'],
          worldName: 'Yard',
          seed: 'world:dev-world-runtime',
          budgets,
          store,
          send: () => {},
          isOpen: () => true,
        }),
    ).toThrow(/different copy of the BoardSmith engine/);
  });
});
