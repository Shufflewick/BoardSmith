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
import { liveRulesWorkers, rulesAnswered } from './rules-worker.js';
import { openSocketPage, serveSockets } from './socket-page.test-helper.js';
import { openTable, tableProject } from './table-host.test-helper.js';
import { createDevHostClientMemory } from './test-client-memory.js';

/** Set on the global object of every thread that evaluates a rules file below. */
const MARK = 'bs885RulesEvaluatedHere';
const markLine = `(globalThis as Record<string, unknown>).${MARK} = true;`;
const evaluatedHere = () => (globalThis as Record<string, unknown>)[MARK];

/** A one-seat counter whose `bump` adds `step`, and whose `quit` ends the thread it runs in. */
function tableRules(step: number): string {
  return [
    "import { Action, Game, Player, actionStep, loop, sequence, type GameOptions } from 'boardsmith';",
    markLine,
    'export class CounterGame extends Game<CounterGame, Player> {',
    '  count = 0;',
    '  constructor(options: GameOptions) {',
    '    super(options);',
    `    this.registerAction(Action.create('bump').execute(() => { this.count += ${step}; }));`,
    "    this.registerAction(Action.create('quit').execute(() => { process.exit(3); }));",
    "    this.setFlow({ root: sequence(loop({ name: 'rounds', maxIterations: 50, do: actionStep({ name: 'a', actions: ['bump', 'quit'], turnScope: 'restart' }) })) });",
    '  }',
    '}',
    "export const gameDefinition = { gameClass: CounterGame, gameType: 'rules-worker-counter', minPlayers: 1, maxPlayers: 1 };",
  ].join('\n');
}

/**
 * A one-fire world whose `stoke` adds `step` logs. `feed` chooses from the
 * fire's embers, read through the world's read-only projection, so the offers
 * a page is sent carry what that projection answered. `spark` throws from a
 * timer once it has run.
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
    "      worldAction('spark').needs(() => ['fire'])",
    "      .execute(() => { setTimeout(() => { throw new Error('a spark from a timer'); }, 0); }),",
    "      worldAction('feed').needs(() => ['fire'])",
    "      .chooseFrom('ember', { choices: ({ game }: { game: Camp }) => game.all(Ember).map((ember) => ember.name!) })",
    '      .execute(() => {})],',
    "    view: () => ['fire'],",
    "    genesis: (game: Camp) => { const fire = game.create(Fire, 'fire'); fire.create(Ember, 'birch'); return { fire }; },",
    '  },',
    '};',
  ].join('\n');
}

/** A one-seat table whose `take` chooses from the game's own elements, as `boardsmith init`'s sample does. */
const STONES_RULES = [
  "import { Action, Game, Piece, Player, Space, actionStep, loop, type GameOptions } from 'boardsmith';",
  'class Stone extends Piece<StoneGame> {}',
  'export class StoneGame extends Game<StoneGame, Player> {',
  '  constructor(options: GameOptions) {',
  '    super(options);',
  '    this.registerElements([Space, Stone]);',
  "    this.create(Space, 'pile').create(Stone, 'flint');",
  "    this.registerAction(Action.create('take').chooseFrom('stone', { choices: () => [...this.all(Stone)] }).execute(() => {}));",
  "    this.setFlow({ root: loop({ name: 'turns', maxIterations: 50, do: actionStep({ name: 'a', actions: ['take'] }) }) });",
  '  }',
  '}',
  "export const gameDefinition = { gameClass: StoneGame, gameType: 'rules-worker-stones', minPlayers: 1, maxPlayers: 1 };",
].join('\n');

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
  it('answers a choice of the game\'s own elements in the shape the wire delivers it', async () => {
    const runtime = await tableProject('bs-rules-worker-stones-', STONES_RULES).load();
    closing.push(() => runtime.close());
    const table = await openTable(runtime, clients, { makeSeed: () => 'rules-worker' });

    const answer = (await table.ask('resolve_choices', { actionName: 'take', selectionName: 'stone', args: {} })) as {
      success: boolean;
      error?: string;
      choices?: Array<{ value: unknown }>;
    };

    expect(answer.error).toBeUndefined();
    expect(answer.success).toBe(true);
    // A page reads the element as its JSON, so a worker hands back exactly that: plain data, no class.
    expect(Object.getPrototypeOf(answer.choices?.[0]?.value)).toBe(Object.prototype);
    expect(JSON.stringify(answer.choices)).toContain('flint');
  }, 60_000);

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

  it('refuses rules that throw while loading with a stack at the rules file\'s own line', async () => {
    const project = tableProject('bs-rules-worker-load-throw-', `throw new Error('rules exploded while loading');\nexport const gameDefinition = {};`);
    const refused = await project.load().then(
      () => null,
      (error: Error) => error,
    );
    expect(refused?.message).toContain('rules exploded while loading');
    expect(refused?.stack).toMatch(/src[\\/]rules[\\/]index\.ts:1:\d+/);
  }, 60_000);

  it('stops the worker of an edit that builds but throws while loading, says where, and plays on the rules it had', async () => {
    const before = liveRulesWorkers();
    const table = await servedTable();
    await table.bump();
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});

    table.save(`throw new Error('rules exploded while loading');\nexport const gameDefinition = {};`);
    await table.reload();

    expect(said.mock.calls.flat().join('\n')).toMatch(
      /Your edited rules did not load, so this table is still running the ones it had: .*rules exploded while loading/,
    );
    // The terminal, never a page, is also shown where the edit threw.
    expect(said.mock.calls.flat().join('\n')).toMatch(/src[\\/]rules[\\/]index\.ts:1:\d+/);
    await table.bump();
    expect(table.count()).toBe(2);
    expect(liveRulesWorkers() - before).toBe(1);
  }, 60_000);

  it('refuses an edit that declares gameOptions in its gameDefinition with the reason alone, no stack of BoardSmith\'s', async () => {
    const table = await servedTable();
    await table.bump();
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});

    table.save(tableRules(2).replace('maxPlayers: 1 };', 'maxPlayers: 1, gameOptions: {} };'));
    await table.reload();

    const output = said.mock.calls.flat().join('\n');
    expect(output).toMatch(/Your edited rules did not load, so this table is still running the ones it had: This gameDefinition declares gameOptions/);
    expect(output).not.toMatch(/^\s+at /m);
  }, 60_000);

  it('says so when the rules end their own worker, refuses their calls, and comes back on the next save', async () => {
    const before = liveRulesWorkers();
    const table = await servedTable();
    await table.bump();
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});

    // The op that ends the worker is the call waiting on it.
    expect(await table.act('quit')).toMatchObject({ success: false, error: expect.stringContaining('exited with code 3') });
    expect(said.mock.calls.flat().join('\n')).toContain('Your rules stopped running: the rules worker exited with code 3');
    expect(await table.bump()).toMatchObject({
      success: false,
      error: expect.stringContaining('Save a rules file, or restart boardsmith dev, to start them again'),
    });
    expect(liveRulesWorkers() - before).toBe(0);

    table.save(tableRules(2));
    await table.reload();
    await table.bump();
    // 1 before the worker ended, then 2 on the rules the save started.
    expect(table.count()).toBe(3);
    expect(liveRulesWorkers() - before).toBe(1);
  }, 60_000);

  it('stops the replaced worker when the game cannot even be carried onto the edit, and comes back on the next save', async () => {
    const before = liveRulesWorkers();
    const table = await servedTable();
    await table.bump();
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Loads, but ends its worker the moment the game is rebuilt on it: `carry` rejects.
    table.save(tableRules(5).replace('super(options);', 'super(options); process.exit(4);'));
    await table.reload();
    expect(said.mock.calls.flat().join('\n')).toContain('exited with code 4');
    // The host runs the edit's rules now, so the rules it had are stopped too.
    expect(liveRulesWorkers() - before).toBe(0);

    table.save(tableRules(2));
    await table.reload();
    await table.bump();
    expect(table.count()).toBe(3);
    expect(liveRulesWorkers() - before).toBe(1);
  }, 60_000);
});

/** A world on `worldRules(1)` with one page seated, and the run's reload queue. */
async function servedWorld() {
  const { rulesPath, tempDir, save } = rulesProject('bs-rules-worker-world-', worldRules(1));
  const load = () => loadWorldRuntime(rulesPath, tempDir, 'monorepo');
  const cwd = tempTree('bs-rules-worker-world-run-');
  const run = await openWorldRun({
    cwd,
    displayName: 'Camp',
    port: 5173,
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
  const act = (action: string) => {
    const requestId = `${action}-${++request}`;
    const answer = page.next((f) => f.type === 'world_response' && f.requestId === requestId);
    page.send({ type: 'action', requestId, order: { id: `order-${request}`, at: Date.now() }, action, args: {} });
    return answer;
  };
  const stoke = () => act('stoke');
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
  return { cwd, run, server, save, reload: () => run.queue.saved(SAVED), act, stoke, logs, rejoin };
}

describe('#885: the world road', () => {
  it('refuses a second run on the same world, naming the first run (#881)', async () => {
    const world = await servedWorld();
    const { rulesPath, tempDir } = rulesProject('bs-rules-worker-second-', worldRules(1));
    const load = () => loadWorldRuntime(rulesPath, tempDir, 'monorepo');
    const runtime = await load();
    closing.push(() => runtime.worker.close());

    await expect(
      openWorldRun({ cwd: world.cwd, displayName: 'Camp', port: 5174, runtime, reloadRules: load }),
    ).rejects.toThrow(new RegExp(`already open in another \\\`boardsmith dev\\\` \\(pid ${process.pid}, port 5173\\)`));
  }, 60_000);

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

    const output = said.mock.calls.flat().join('\n');
    expect(output).toMatch(
      /Your edited rules did not load, so this world is still running the ones it had: Rules module must export a gameDefinition/,
    );
    // BoardSmith's own refusal is not a crash in the rules, so no stack frame of BoardSmith's is shown.
    expect(output).not.toMatch(/^\s+at /m);
    expect(await world.stoke()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(world.logs()).toBe(2));
    expect(liveRulesWorkers() - before).toBe(1);
  }, 60_000);

  /**
   * `spark` ends the world's worker from a timer. Resolves once the terminal
   * has said so and the worker is gone, and answers what the terminal said.
   */
  async function sparked(world: Awaited<ReturnType<typeof servedWorld>>, before: number) {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await world.act('spark')).toMatchObject({ ok: true });
    await vi.waitFor(() =>
      expect(said.mock.calls.flat().join('\n')).toContain('Your rules stopped running: a spark from a timer'),
    );
    // The message comes with the worker's `error`; its `exit`, which drops the count, lands on a later turn.
    await vi.waitFor(() => expect(liveRulesWorkers() - before).toBe(0));
    return said;
  }

  it('says so when a rule throws from a timer, refuses the world its calls, and opens it again on the next save', async () => {
    const before = liveRulesWorkers();
    const world = await servedWorld();
    expect(await world.stoke()).toMatchObject({ ok: true });
    const said = await sparked(world, before);

    const refused = world.server.received((m) => m.type === 'action');
    void world.stoke();
    await refused;
    await vi.waitFor(() =>
      expect(said.mock.calls.flat().join('\n')).toContain(
        "world message 'action' failed: Your rules stopped running (a spark from a timer). Save a rules file",
      ),
    );

    world.save(worldRules(2));
    await world.reload();
    await world.rejoin();
    expect(await world.stoke()).toMatchObject({ ok: true });
    // 1 checkpointed before the worker stopped, then 2 on the rules the save started.
    await vi.waitFor(() => expect(world.logs()).toBe(3));
    expect(liveRulesWorkers() - before).toBe(1);
  }, 60_000);

  it('prints where in the rules a crash from a timer happened, at the rules file\'s own line', async () => {
    const before = liveRulesWorkers();
    const world = await servedWorld();
    const said = await sparked(world, before);
    expect(said.mock.calls.flat().join('\n')).toMatch(/a spark from a timer[\s\S]*src[\\/]rules[\\/]index\.ts:\d+:\d+/);
  }, 60_000);

  it('says no world is open when the rules stopped and the edit cannot run it, stops that edit, and opens it on the next save', async () => {
    const before = liveRulesWorkers();
    const world = await servedWorld();
    expect(await world.stoke()).toMatchObject({ ok: true });
    const said = await sparked(world, before);

    // Loads, but the world was recorded at stateVersion 0 and this edit declares no migration (#200).
    world.save(worldRules(2).replace('maxPlayers: 1,', 'maxPlayers: 1, stateVersion: 3,'));
    await world.reload();
    expect(said.mock.calls.flat().join('\n')).toContain(
      'Those rules cannot run this world, and the rules it had stopped running, so no world is open. ' +
        'Nothing was changed on disk. Save a rules file to open it again:',
    );
    expect(liveRulesWorkers() - before).toBe(0);

    world.save(worldRules(2));
    await world.reload();
    await world.rejoin();
    expect(await world.stoke()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(world.logs()).toBe(3));
    expect(liveRulesWorkers() - before).toBe(1);
  }, 60_000);

  it('still refuses a second run once its rules have stopped on their own, since the run holds the world (#1040)', async () => {
    const before = liveRulesWorkers();
    const world = await servedWorld();
    await sparked(world, before);
    const { rulesPath, tempDir } = rulesProject('bs-rules-worker-stopped-', worldRules(1));
    const runtime = await loadWorldRuntime(rulesPath, tempDir, 'monorepo');
    closing.push(() => runtime.worker.close());

    await expect(
      openWorldRun({ cwd: world.cwd, displayName: 'Camp', port: 5174, runtime, reloadRules: async () => runtime }),
    ).rejects.toThrow(new RegExp(`already open in another \\\`boardsmith dev\\\` \\(pid ${process.pid}, port 5173\\)`));
  }, 60_000);
});

describe('#609: the dev host answers only when its rules do', () => {
  // The smoke walk does not count time the dev host spends not answering. Rules busy in their
  // worker, as a loaded machine keeps them, answer late, so the host must too.
  it('answers once the rules worker has answered what was sent it first', async () => {
    const { rulesPath, tempDir } = rulesProject('bs-rules-worker-alive-', worldRules(1));
    const runtime = await loadWorldRuntime(rulesPath, tempDir, 'monorepo');
    closing.push(() => runtime.worker.close());
    const order: string[] = [];

    const call = runtime.worker.call('attachments').finally(() => order.push('call'));
    const answered = rulesAnswered().then(() => order.push('answered'));
    await Promise.allSettled([call, answered]);

    expect(order).toEqual(['call', 'answered']);
  }, 60_000);
});
