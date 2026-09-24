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
import { loadWorldRuntime, openWorldRun, type WorldRuntime } from './dev-world.js';

/** A one-fire world whose `stoke` adds `step` logs, written the way an author writes one. */
function rulesSource(step: number): string {
  return [
    "import { Game, Space } from 'boardsmith';",
    "import { worldAction } from 'boardsmith/world';",
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
    "    actions: [worldAction('stoke').needs(() => ['fire'])",
    `      .execute((_args: unknown, ctx: { world: { partition(name: string): unknown } }) => { (ctx.world.partition('fire') as Fire).logs += ${step}; })],`,
    "    view: () => ['fire'],",
    "    genesis: (game: Camp) => ({ fire: game.create(Fire, 'fire') }),",
    '  },',
    '};',
  ].join('\n');
}

/** A world project's rules on disk, and a way to bundle what is saved there. */
function worldRules(source: string) {
  const { rulesPath, tempDir, save } = rulesProject('bs-world-rules-reload-', source);
  return { save, load: () => loadWorldRuntime(rulesPath, tempDir, 'monorepo') };
}

// Bundling is the slow part, so it happens here, while the file is collected
// and no test timeout applies (#363).
const project = worldRules(rulesSource(1));
const beforeEdit = await project.load();
project.save(rulesSource(10));
const afterEdit = await project.load();
const brokenEdit = await buildFailure(worldRules('export const gameDefinition = ;').load);

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
async function serveWorld(edit: WorldRuntime | Error) {
  let commandArrived: Promise<void> = Promise.resolve();
  const run = await openWorldRun({
    cwd: tempTree('bs-world-rules-reload-run-'),
    displayName: 'Camp',
    runtime: beforeEdit,
    reloadRules: async () => {
      await commandArrived;
      if (edit instanceof Error) throw edit;
      return edit;
    },
  });
  closing.push(() => run.close());
  const server = await serveSockets(run.connections.accept);
  closing.push(server.close);
  const page = await openSocketPage(server.port, 'p1', (f) => f.type === 'world_offers');
  let request = 0;
  /** Stoke as the page; resolves with the host's answer. */
  const stoke = () => {
    const requestId = `stoke-${++request}`;
    const answer = page.next((f) => f.type === 'world_response' && f.requestId === requestId);
    page.send({ type: 'action', requestId, order: { id: `order-${request}`, at: Date.now() }, action: 'stoke', args: {} });
    return answer;
  };
  /** The fire's logs, as the last state frame the page was sent shows them. */
  const logs = () => {
    const view = JSON.stringify(page.frames.filter((f) => f.type === 'world_state').at(-1)?.view);
    return Number(/"logs":(\d+)/.exec(view)?.[1]);
  };
  /** Save an edit and stoke while it builds; resolves with the answer once the reload has settled. */
  const stokeDuringRebuild = async () => {
    commandArrived = server.received((m) => m.type === 'action');
    const reloaded = run.queue.saved('src/rules/index.ts');
    const answer = stoke();
    await reloaded;
    return answer;
  };
  return { page, stoke, stokeDuringRebuild, logs };
}

describe('#379: a world command sent while the edited rules are still building', () => {
  it('waits for the edited rules and runs on them', async () => {
    const world = await serveWorld(afterEdit);
    expect(await world.stoke()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(world.logs()).toBe(1));

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
    await world.stoke();
    await vi.waitFor(() => expect(world.logs()).toBe(1));

    const refused = await world.stokeDuringRebuild();
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain('Your edited rules did not load, so this world is still running the ones it had');
    expect(refused.message).toContain(brokenEdit.message);
    await vi.waitFor(() =>
      expect(world.page.frames.filter((f) => f.type === 'world_rules_reload').at(-1)).toMatchObject({
        state: 'failed',
        message: refused.message,
      }),
    );
    expect(world.page.frames.some((f) => f.type === 'world_reload')).toBe(false);

    // The world is where it was, on the rules it had: the next command adds 1.
    expect(await world.stoke()).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(world.logs()).toBe(2));
  }, 30_000);
});
