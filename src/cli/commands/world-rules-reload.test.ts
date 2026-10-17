/**
 * #379: A COMMAND SENT WHILE A WORLD'S EDITED RULES ARE STILL BUILDING WAITS FOR THEM.
 *
 * The world road as `boardsmith dev` runs it, minus the web server in front:
 * `openWorldRun` (the world, its pages and its rules reload queue), a real
 * socket into its connections, and real bundles of the author's rules. The
 * rebuild is held until the command has reached the host, so "sent before the
 * bundle resolved" is a fact of the test and not a race it hopes to win.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { buildFailure, rulesProject } from '../dev-host/rules-project.test-helper.js';
import { openSocketPage, serveSockets } from '../dev-host/socket-page.test-helper.js';
import { bundleWorldRules, loadWorldRuntime, openWorldRun, startWorldRuntime, type WorldRuntime } from './dev-world.js';

/**
 * A one-fire world whose `stoke` adds `step` logs, written the way an author
 * writes one. `kindle` schedules a `burn` a second later, which adds `step`
 * logs too.
 */
function rulesSource(step: number, stateVersion = 0): string {
  return [
    "import { Game, Space } from 'boardsmith';",
    "import { worldAction, worldClockAction } from 'boardsmith/world';",
    'class Fire extends Space { logs = 0; }',
    'class Camp extends Game {',
    '  constructor(options: ConstructorParameters<typeof Game>[0]) {',
    '    super(options);',
    '    this.registerElements([Fire]);',
    '  }',
    '}',
    'export const gameDefinition = {',
    '  gameClass: Camp,',
    "  gameType: 'world-rules-reload',",
    '  world: {',
    '    maxPlayers: 2,',
    `    stateVersion: ${stateVersion},`,
    "    actions: [worldAction('stoke').needs(() => ['fire'])",
    `      .execute((_args: unknown, ctx: { world: { partition(name: string): unknown } }) => { (ctx.world.partition('fire') as Fire).logs += ${step}; }),`,
    "      worldAction('kindle').needs(() => ['fire'])",
    "      .execute((_args: unknown, ctx: { world: { schedule(event: object): void } }) => { ctx.world.schedule({ delayMs: 1_000, action: 'burn', args: {} }); }),",
    "      worldClockAction('burn').needs(() => ['fire'])",
    `      .execute((_args: unknown, ctx: { world: { partition(name: string): unknown } }) => { (ctx.world.partition('fire') as Fire).logs += ${step}; })],`,
    "    view: () => ['fire'],",
    "    genesis: (game: Camp) => ({ fire: game.create(Fire, 'fire') }),",
    '  },',
    '};',
  ].join('\n');
}

/** Starts a fresh worker on one bundle of a world's rules. */
type Rules = () => Promise<WorldRuntime>;

/**
 * `source` bundled once, in a project of its own. Each start is a fresh worker
 * on that bundle, as each world a test opens needs, since a reload stops the
 * worker of the rules it replaces (#885).
 */
async function worldRules(source: string): Promise<Rules> {
  const { rulesPath, tempDir } = rulesProject('bs-world-rules-reload-', source);
  const bundlePath = await bundleWorldRules(rulesPath, tempDir, 'monorepo');
  return () => startWorldRuntime(bundlePath);
}

// Bundling is the slow part, so it happens here, while the file is collected
// and no test timeout applies (#363).
const beforeEdit = await worldRules(rulesSource(1));
const afterEdit = await worldRules(rulesSource(10));
// Builds, but cannot open a world written under stateVersion 0: it bumps the
// version and declares no migration (#381).
const unopenableEdit = await worldRules(rulesSource(10, 1));
const broken = rulesProject('bs-world-rules-reload-', 'export const gameDefinition = ;');
const brokenEdit = await buildFailure(() => loadWorldRuntime(broken.rulesPath, broken.tempDir, 'monorepo'));

const closing: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  for (const close of closing.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

/**
 * A world on `beforeEdit`, one page seated in it, whose next reload builds
 * `edit` (or fails with it). The rebuild finishes only once a command has
 * reached the host, so a command sent during it is always held.
 */
async function serveWorld(edit: Rules | Error) {
  let rebuildWaitsFor: Promise<void> = Promise.resolve();
  const cwd = tempTree('bs-world-rules-reload-run-');
  const run = await openWorldRun({
    cwd,
    displayName: 'Camp',
    runtime: await beforeEdit(),
    reloadRules: async () => {
      await rebuildWaitsFor;
      if (edit instanceof Error) throw edit;
      return edit();
    },
  });
  const server = await serveSockets(run.connections.accept);
  // In the dev server's own teardown order: forget the pages, so their sockets
  // closing is no departure, then the sockets, then the world.
  closing.push(async () => {
    run.connections.forgetAll();
    await server.close();
    await run.close();
  });
  const page = await openSocketPage(server.port, 'p1', (f) => f.type === 'world_offers');
  let request = 0;
  /** Take `action` as the page; resolves with the host's answer. */
  const act = (action: string) => {
    const requestId = `${action}-${++request}`;
    const answer = page.next((f) => f.type === 'world_response' && f.requestId === requestId);
    page.send({ type: 'action', requestId, order: { id: `order-${request}`, at: Date.now() }, action, args: {} });
    return answer;
  };
  const stoke = () => act('stoke');
  /** The fire's logs, as the last state frame the page was sent shows them. */
  const logs = () => {
    const view = JSON.stringify(page.frames.filter((f) => f.type === 'world_state').at(-1)?.view);
    return Number(/"logs":(\d+)/.exec(view)?.[1]);
  };
  /** Save an edit whose rebuild finishes once `until` has happened; resolves once the reload has settled. */
  const saveHeldUntil = (until: Promise<void>) => {
    rebuildWaitsFor = until;
    return run.queue.saved('src/rules/index.ts');
  };
  /** Save an edit and stoke while it builds; resolves with the answer once the reload has settled. */
  const stokeDuringRebuild = async () => {
    const reloaded = saveHeldUntil(server.received((m) => m.type === 'action'));
    const answer = stoke();
    await reloaded;
    return answer;
  };
  /**
   * Stoke while an edit that must not take builds: the command is refused for
   * `reason`, the pages are not told to reload, and the world goes on, on the
   * rules it had (the next command adds 1). Resolves with the refusal.
   */
  const refusedDuringRebuild = async (reason: string) => {
    const refused = await stokeDuringRebuild();
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain(reason);
    expect(page.frames.some((f) => f.type === 'world_reload')).toBe(false);
    expect(await stoke()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(logs()).toBe(2));
    return refused;
  };
  // One command made on the rules from before any edit.
  expect(await stoke()).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(logs()).toBe(1));
  return { run, server, page, act, saveHeldUntil, stokeDuringRebuild, refusedDuringRebuild, logs };
}

describe('#379: a world command sent while the edited rules are still building', () => {
  it('waits for the edited rules and runs on them', async () => {
    const world = await serveWorld(afterEdit);
    const reloadNow = world.page.next((f) => f.type === 'world_reload');
    expect(await world.stokeDuringRebuild()).toMatchObject({ ok: true });
    await reloadNow;
    // 1 from the command before the save, 10 from the one sent during the
    // rebuild, answered before the page was told to start again.
    expect(world.logs()).toBe(11);
    const told = world.page.frames
      .filter((f) => f.type === 'world_rules_reload' || f.type === 'world_reload')
      .map((f) => f.state ?? f.type);
    expect(told).toEqual(['reloading', 'world_reload']);
  }, 30_000);

  it('refuses the command with the rebuild error when the edit does not build, and stays on the old rules', async () => {
    const world = await serveWorld(brokenEdit);
    const refused = await world.refusedDuringRebuild(
      'Your edited rules did not load, so this world is still running the ones it had',
    );
    expect(refused.message).toContain(brokenEdit.message);
    await vi.waitFor(() =>
      expect(world.page.frames.filter((f) => f.type === 'world_rules_reload').at(-1)).toMatchObject({
        state: 'failed',
        message: refused.message,
      }),
    );
  }, 30_000);
});

/**
 * #381: RULES THAT BUILD BUT CANNOT OPEN THE WORLD LEAVE IT RUNNING.
 *
 * The reload closes the running world before it opens it on the new rules, so
 * a refusal from that open used to leave the dev host holding a closed world:
 * every later command failed inside a closed store until `boardsmith dev` was
 * restarted.
 */
describe('#381: an edit that builds but cannot open the world', () => {
  it('refuses the held command, and the world goes on, on the rules it had', async () => {
    const world = await serveWorld(unopenableEdit);
    // Still open, still seated, still on the old rules afterwards.
    const refused = await world.refusedDuringRebuild(
      'Those rules cannot run this world, so it is still running the ones it had',
    );
    expect(refused.message).toContain('stateVersion');
  }, 30_000);
});

/**
 * #387: A WORLD'S SCHEDULED EVENT WAITS FOR THE EDITED RULES TOO.
 *
 * #379 held the pages' commands while an edit rebuilt, but the world's own
 * alarm is not a page's command: an event that came due during the rebuild ran
 * on the rules from before the save. The alarm goes through the same queue now.
 *
 * The world's clock is its worker's (#885), so the test does not drive it. It
 * makes "came due during the rebuild" a fact by order instead: the save is
 * heard in the same turn the `kindle` reaches the host, before the burn it
 * schedules can even be armed, and the rebuild finishes only once the burn's
 * alarm has been handed to the queue.
 */
async function burnDuringRebuild(edit: Rules | Error) {
  const world = await serveWorld(edit);
  const queue = world.run.queue;
  const hold = queue.hold.bind(queue);
  const alarmHeld = new Promise<void>((resolve) => {
    vi.spyOn(queue, 'hold').mockImplementation((work) => {
      resolve();
      hold(work);
    });
  });
  const kindled = world.server.received((m) => m.type === 'action' && m.action === 'kindle');
  const answered = world.act('kindle');
  await kindled;
  const reloaded = world.saveHeldUntil(alarmHeld);
  expect(await answered).toMatchObject({ ok: true });
  await reloaded;
  return world;
}

describe('#387: a scheduled event that comes due while the edited rules are still building', () => {
  it('runs on the edited rules once they are in place', async () => {
    const world = await burnDuringRebuild(afterEdit);
    await vi.waitFor(() => expect(world.page.frames.some((f) => f.type === 'world_reload')).toBe(true));
    // The page starts again on the reloaded world, as a browser does.
    const greeted = world.page.next((f) => f.type === 'world_offers');
    world.page.send({ type: 'hello', clientId: 'p1' });
    await greeted;
    // The world reopened on the edited rules found the burn due, and ran it on
    // them. 1 from the stoke before the save, 10 from the burn.
    await vi.waitFor(() => expect(world.logs()).toBe(11));
  }, 30_000);

  it('runs on the old rules when the edit does not build', async () => {
    const world = await burnDuringRebuild(brokenEdit);
    await vi.waitFor(() => expect(world.logs()).toBe(2));
  }, 30_000);
});
