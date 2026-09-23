/**
 * #283: `boardsmith dev` RUNS A WORLD ON THE ENGINE ITS RULES WERE BUILT ON.
 *
 * The rules are loaded by bundling them, engine included. The world host used
 * to be the CLI's own, on the CLI's own copy of the engine, so a world ran on
 * two: the read-only projection recognised none of the bundle's finders as the
 * engine's, and every offer walk paid a proxy trap per element per step --
 * 15-30 seconds a command with two seats attached.
 *
 * `loadWorldRuntime` is the table road's `loadGameRuntime` for a world: the
 * rules and the world host come out of ONE bundle, so they share one engine by
 * construction, exactly as the platform splices a world bundle around one.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { worldBudgets } from '../../world/index.js';
import { LocalWorldHost } from '../dev-host/world-host.js';
import { openWorldStore } from '../dev-host/world-store.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { loadWorldRuntime } from './dev-world.js';

/** A one-room world project, written the way an author writes one. */
function worldProject(): { rulesPath: string; tempDir: string; storePath: string } {
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
  return { rulesPath, tempDir, storePath: join(dir, '.boardsmith-dev-world', 'world.db') };
}

const closing: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

describe('loadWorldRuntime (#283)', () => {
  it('builds the world host into the same bundle as the rules, so a world runs on one engine', async () => {
    const { rulesPath, tempDir, storePath } = worldProject();
    const runtime = await loadWorldRuntime(rulesPath, tempDir, 'monorepo');

    const frames: Array<{ clientId: string; message: { type: string; actions?: unknown } }> = [];
    const budgets = worldBudgets();
    const host = new runtime.LocalWorldHost({
      definition: runtime.gameDefinition as unknown as ConstructorParameters<
        typeof LocalWorldHost
      >[0]['definition'],
      worldName: 'Yard',
      seed: 'world:dev-world-runtime',
      budgets,
      store: runtime.openWorldStore(storePath, budgets),
      send: (clientId, message) =>
        frames.push({ clientId, message: message as { type: string; actions?: unknown } }),
    });
    closing.push(() => host.close());

    await host.start();
    await host.handleMessage('page-1', { type: 'hello' });

    const offers = frames.find((frame) => frame.message.type === 'world_offers');
    expect(offers, 'The bundled host answered a hello with no offers.').toBeDefined();
    expect((offers!.message.actions as Array<{ name: string }>).map((a) => a.name)).toEqual([
      'look',
    ]);
  });

  it("is needed: the CLI's own host refuses rules bundled on their own engine", async () => {
    // What `boardsmith dev` used to do, which the world now refuses by name
    // rather than running slowly on two engines.
    const { rulesPath, tempDir, storePath } = worldProject();
    const runtime = await loadWorldRuntime(rulesPath, tempDir, 'monorepo');
    const budgets = worldBudgets();
    const store = openWorldStore(storePath, budgets);
    closing.push(async () => store.close());

    expect(
      () =>
        new LocalWorldHost({
          definition: runtime.gameDefinition as unknown as ConstructorParameters<
            typeof LocalWorldHost
          >[0]['definition'],
          worldName: 'Yard',
          seed: 'world:dev-world-runtime',
          budgets,
          store,
          send: () => {},
        }),
    ).toThrow(/different copy of the BoardSmith engine/);
  });
});
