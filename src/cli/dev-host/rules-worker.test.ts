/**
 * #885: `boardsmith dev` RUNS EACH RULES BUNDLE IN A WORKER IT THROWS AWAY.
 *
 * Node never unloads an ES module, so a dev host that imported every rebuilt
 * bundle kept them all: about 2 MB a save on Hex. These tests drive both roads
 * the way `boardsmith dev` does (a project on disk, saved and reloaded through
 * the road's own reload queue) and count what is left: one worker running the
 * rules, and no copy of them ever evaluated in this process. Each rules file
 * marks the global object of whatever thread evaluates it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { tableRulesReloadQueue } from '../commands/dev-table-runtime.js';
import { loadWorldRuntime, openWorldRun } from '../commands/dev-world.js';
import { rulesProject } from './rules-project.test-helper.js';
import { liveRulesWorkers } from './rules-worker.js';
import { openSocketPage, serveSockets } from './socket-page.test-helper.js';
import { openTable, tableProject } from './table-host.test-helper.js';
import { createDevHostClientMemory } from './test-client-memory.js';

/** Set on the global object of every thread that evaluates a rules file below. */
const MARK = 'bs885RulesEvaluatedHere';
const markLine = `(globalThis as Record<string, unknown>).${MARK} = true;`;
const evaluatedHere = () => (globalThis as Record<string, unknown>)[MARK];

/** A one-seat counter whose `bump` adds `step`. */
function tableRules(step: number): string {
  return [
    "import { Action, Game, Player, actionStep, loop, sequence, type GameOptions } from 'boardsmith';",
    markLine,
    'export class CounterGame extends Game<CounterGame, Player> {',
    '  count = 0;',
    '  constructor(options: GameOptions) {',
    '    super(options);',
    `    this.registerAction(Action.create('bump').execute(() => { this.count += ${step}; }));`,
    "    this.setFlow({ root: sequence(loop({ name: 'rounds', maxIterations: 50, do: actionStep({ name: 'a', actions: ['bump'], turnScope: 'restart' }) })) });",
    '  }',
    '}',
    "export const gameDefinition = { gameClass: CounterGame, gameType: 'rules-worker-counter', minPlayers: 1, maxPlayers: 1 };",
  ].join('\n');
}

/**
 * A one-fire world whose `stoke` adds `step` logs. `feed` chooses from the
 * fire's embers, read through the world's read-only projection, so the offers
 * a page is sent carry what that projection answered.
 */
function worldRules(step: number): string {
  return [
    "import { Game, Piece, Space } from 'boardsmith';",
    "import { worldAction } from 'boardsmith/world';",
    markLine,
    'class Fire extends Space { logs = 0; }',
    'class Ember extends Piece {}',
    'class Camp extends Game {',
    '  constructor(options: ConstructorParameters<typeof Game>[0]) {',
    '    super(options);',
    '    this.registerElements([Fire, Ember]);',
    '  }',
    '}',
    'export const gameDefinition = {',
    '  gameClass: Camp,',
    "  gameType: 'rules-worker-world',",
    '  world: {',
    '    maxPlayers: 1,',
    "    actions: [worldAction('stoke').needs(() => ['fire'])",
    `      .execute((_args: unknown, ctx: { world: { partition(name: string): unknown } }) => { (ctx.world.partition('fire') as Fire).logs += ${step}; }),`,
    "      worldAction('feed').needs(() => ['fire'])",
    "      .chooseFrom('ember', { choices: ({ game }: { game: Camp }) => game.all(Ember).map((ember) => ember.name!) })",
    '      .execute(() => {})],',
    "    view: () => ['fire'],",
    "    genesis: (game: Camp) => { const fire = game.create(Fire, 'fire'); fire.create(Ember, 'birch'); return { fire }; },",
    '  },',
    '};',
  ].join('\n');
}

const SAVED = 'src/rules/index.ts';
const RELOADS = 3;

const clients = createDevHostClientMemory();
const closing: Array<() => Promise<void>> = [];
beforeEach(() => {
  clients.reset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

/** A table on `tableRules(1)` behind its reload queue, with `dev` seated. */
async function servedTable() {
  const project = tableProject('bs-rules-worker-table-', tableRules(1));
  const first = await project.load();
  const table = await openTable(first, clients, { makeSeed: () => 'rules-worker' });
  const queue = tableRulesReloadQueue({ host: table.host, running: first, load: project.load });
  const count = () => {
    const view = table.frames().at(-1)?.view as { state: { view: { attributes: { count: number } } } };
    return view.state.view.attributes.count;
  };
  return { ...table, save: project.save, reload: () => queue.saved(SAVED), bump: () => table.act('bump'), count };
}

describe('#885: the table road', () => {
  it('runs the rules in one worker however often they reload, and never in this process', async () => {
    const before = liveRulesWorkers();
    const table = await servedTable();
    await table.bump();
    for (let step = 2; step < 2 + RELOADS; step++) {
      table.save(tableRules(step));
      await table.reload();
    }
    await table.bump();

    // 1 from the first rules, then 4 from the last of the reloaded ones.
    expect(table.count()).toBe(1 + 1 + RELOADS);
    expect(liveRulesWorkers() - before).toBe(1);
    expect(evaluatedHere()).toBeUndefined();
  }, 60_000);

  it('stops the worker of an edit that builds but throws while loading, and plays on the rules it had', async () => {
    const before = liveRulesWorkers();
    const table = await servedTable();
    await table.bump();
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});

    table.save(`throw new Error('rules exploded while loading');\nexport const gameDefinition = {};`);
    await table.reload();

    expect(said.mock.calls.flat().join('\n')).toMatch(
      /Your edited rules did not load, so this table is still running the ones it had: .*rules exploded while loading/,
    );
    await table.bump();
    expect(table.count()).toBe(2);
    expect(liveRulesWorkers() - before).toBe(1);
  }, 60_000);
});

/** A world on `worldRules(1)` with one page seated, and the run's reload queue. */
async function servedWorld() {
  const { rulesPath, tempDir, save } = rulesProject('bs-rules-worker-world-', worldRules(1));
  const load = () => loadWorldRuntime(rulesPath, tempDir, 'monorepo');
  const run = await openWorldRun({
    cwd: tempTree('bs-rules-worker-world-run-'),
    displayName: 'Camp',
    runtime: await load(),
    reloadRules: load,
  });
  const server = await serveSockets(run.connections.accept);
  closing.push(async () => {
    run.connections.forgetAll();
    await server.close();
    await run.close();
  });
  const page = await openSocketPage(server.port, 'p1', (f) => f.type === 'world_offers');
  let request = 0;
  const stoke = () => {
    const requestId = `stoke-${++request}`;
    const answer = page.next((f) => f.type === 'world_response' && f.requestId === requestId);
    page.send({ type: 'action', requestId, order: { id: `order-${request}`, at: Date.now() }, action: 'stoke', args: {} });
    return answer;
  };
  const logs = () => {
    const view = JSON.stringify(page.frames.filter((f) => f.type === 'world_state').at(-1)?.view);
    return Number(/"logs":(\d+)/.exec(view)?.[1]);
  };
  /** The page starts again after a reload, as a browser does. */
  const rejoin = async () => {
    const greeted = page.next((f) => f.type === 'world_offers');
    page.send({ type: 'hello', clientId: 'p1' });
    await greeted;
  };
  return { run, save, reload: () => run.queue.saved(SAVED), stoke, logs, rejoin };
}

describe('#885: the world road', () => {
  it('runs the world in one worker however often its rules reload, and never in this process', async () => {
    const before = liveRulesWorkers();
    const world = await servedWorld();
    expect(await world.stoke()).toMatchObject({ ok: true });
    for (let step = 2; step < 2 + RELOADS; step++) {
      world.save(worldRules(step));
      await world.reload();
    }
    await world.rejoin();
    expect(await world.stoke()).toMatchObject({ ok: true });

    await vi.waitFor(() => expect(world.logs()).toBe(1 + 1 + RELOADS));
    expect(liveRulesWorkers() - before).toBe(1);
    expect(evaluatedHere()).toBeUndefined();

    await world.run.close();
    expect(liveRulesWorkers() - before).toBe(0);
  }, 60_000);

  it('stops the worker of an edit with no gameDefinition, and the world goes on, on the rules it had', async () => {
    const before = liveRulesWorkers();
    const world = await servedWorld();
    expect(await world.stoke()).toMatchObject({ ok: true });
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});

    world.save('export const notTheRules = 1;');
    await world.reload();

    expect(said.mock.calls.flat().join('\n')).toMatch(
      /Your edited rules did not load, so this world is still running the ones it had: Rules module must export a gameDefinition/,
    );
    expect(await world.stoke()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(world.logs()).toBe(2));
    expect(liveRulesWorkers() - before).toBe(1);
  }, 60_000);
});
