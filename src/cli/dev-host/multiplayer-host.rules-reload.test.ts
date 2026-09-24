/**
 * #343: A RULES EDIT REACHES THE TABLE HOST, NOT ONLY THE BROWSER.
 *
 * `boardsmith dev` bundles a table's rules once, and the browser gets every
 * later edit through Vite. Before this, the page ran the edited rules while the
 * authoritative host kept running the ones it started with, until the command
 * was restarted: the table-side version of what #201 fixed for worlds.
 *
 * These tests drive the real road: a game project on disk, bundled by the same
 * loader `boardsmith dev` uses, a rule EDITED on disk, the bundle loaded again,
 * and the running host handed the result. Nothing here is a hand-built runtime.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TableRuntime } from '../commands/dev-table-runtime.js';
import type { WorldHostClock } from './node-world-clock.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import { openTable, tableProject } from './table-host.test-helper.js';
import { createDevHostClientMemory } from './test-client-memory.js';

const clients = createDevHostClientMemory();
beforeEach(() => clients.reset());
afterEach(() => vi.restoreAllMocks());

/** The flows a test edits between. */
const FLOWS = {
  /** Three one-move steps, one after another. */
  three: `sequence(
    actionStep({ name: 'a', actions: ['bump'], turnScope: 'restart' }),
    actionStep({ name: 'b', actions: ['bump'], turnScope: 'restart' }),
    actionStep({ name: 'c', actions: ['bump'], turnScope: 'restart' }),
  )`,
  /** One step, repeated: every move the three-step game made is still legal here. */
  looped: `sequence(
    loop({ name: 'rounds', maxIterations: 5, do: actionStep({ name: 'a', actions: ['bump'], turnScope: 'restart' }) }),
  )`,
  /** One move and the game is over, so a history of two moves cannot be replayed. */
  one: `sequence(actionStep({ name: 'a', actions: ['bump'] }))`,
  /** One timed step, repeated. */
  timed: (limitMs: number) => `sequence(
    loop({ name: 'rounds', maxIterations: 5, do: actionStep({ name: 'a', actions: ['bump'], turnScope: 'restart', timeLimitMs: ${limitMs} }) }),
  )`,
};

/** A one-seat counter game whose `bump` adds `step`, written the way an author writes one. */
function rulesSource(args: { step: number; flow: string }): string {
  return [
    "import { Action, Game, Player, actionStep, defineFlow, loop, sequence, type GameOptions } from 'boardsmith';",
    'export class CounterGame extends Game<CounterGame, Player> {',
    '  count = 0;',
    '  constructor(options: GameOptions) {',
    '    super(options);',
    `    this.registerAction(Action.create('bump').execute(() => { this.count += ${args.step}; }));`,
    `    this.setFlow(defineFlow<CounterGame>({ root: ${args.flow} }));`,
    '  }',
    '}',
    'export const gameDefinition = {',
    '  gameClass: CounterGame,',
    "  gameType: 'rules-reload-counter',",
    '  minPlayers: 1,',
    '  maxPlayers: 1,',
    '};',
  ].join('\n');
}

/** A table project on disk, saved with the rules an author writes. */
function counterProject(initial: { step: number; flow: string }) {
  const project = tableProject('bs-table-rules-reload-', rulesSource(initial));
  return { save: (rules: { step: number; flow: string }) => project.save(rulesSource(rules)), load: project.load };
}

const START = 1_700_000_000_000;

/** A hand-driven clock, so a timed step's window is observable without waiting. */
function fakeClock() {
  let now = START;
  const armed: Array<number | null> = [];
  return {
    clock: {
      now: () => now,
      yieldTurn: async () => {},
      arm(delayMs: number | null) {
        armed.push(delayMs);
      },
    } satisfies WorldHostClock,
    advance(ms: number) {
      now += ms;
    },
    armed,
  };
}

async function openCounterTable(runtime: TableRuntime, clock = fakeClock()) {
  const table = await openTable(runtime, clients, {
    makeSeed: () => 'rules-reload',
    clock: clock.clock,
    idleAction: { name: 'bump' },
  });
  return { ...table, bump: () => table.act('bump') };
}

/** The counter as the last frame the seat was sent shows it. */
function shownCount(frames: Array<Extract<HostOutbound, { type: 'game_state' }>>): number {
  const view = frames.at(-1)?.view as { state: { view: { attributes: { count: number } } } };
  return view.state.view.attributes.count;
}

describe('#343: a table dev host reloads its rules on the server', () => {
  it('runs the edited rule on the next move, from the position the game was in', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.looped });
    const table = await openCounterTable(await project.load());
    await table.bump();
    expect(shownCount(table.frames())).toBe(1);

    project.save({ step: 10, flow: FLOWS.looped });
    const outcome = await table.host.reloadRules((await project.load()).rules);

    expect(outcome?.kind).toBe('restored');
    await table.bump();
    // 1 from the move made on the old rule, 10 from the move made on the new one.
    expect(shownCount(table.frames())).toBe(11);
  }, 30_000);

  it('rebuilds the game by replaying its moves when the saved position no longer fits the flow', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.three });
    const table = await openCounterTable(await project.load());
    await table.bump();
    await table.bump();

    // Two moves in, the game stands at the third step of a three-step sequence.
    // The edited flow has one child there, so that position cannot be restored.
    project.save({ step: 1, flow: FLOWS.looped });
    const outcome = await table.host.reloadRules((await project.load()).rules);

    expect(outcome?.kind).toBe('replayed');
    expect(outcome?.kind === 'replayed' && outcome.moves).toBe(2);
    expect(shownCount(table.frames())).toBe(2);
    // And the table goes on, on the edited flow.
    const result = await table.bump();
    expect(result?.success).toBe(true);
    expect(shownCount(table.frames())).toBe(3);
    expect(table.errors()).toEqual([]);
  }, 30_000);

  it('tells every client and the terminal when the moves cannot be replayed either', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.three });
    const table = await openCounterTable(await project.load());
    // A second page on a one-seat table takes the seat, so the first takes it
    // back: both stay connected, and both must hear about the failure.
    await table.host.handleMessage('spectator', { type: 'hello' });
    await table.host.handleMessage('dev', { type: 'hello' });
    await table.bump();
    await table.bump();

    const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A one-move game: the position does not fit, and the second move of the
    // history is made after the game is over, so replay fails too.
    project.save({ step: 1, flow: FLOWS.one });
    const outcome = await table.host.reloadRules((await project.load()).rules);

    expect(outcome?.kind).toBe('failed');
    const said = table.errors();
    expect(said.map((e) => e.to).sort()).toEqual(['dev', 'spectator']);
    for (const { message } of said) {
      expect(message).toContain('cannot continue on your edited rules');
      expect(message).toContain('New game');
    }
    expect(printed).toHaveBeenCalledWith(expect.stringContaining('cannot continue on your edited rules'));

    // A page that reloads is seated again (which clears its banner) and told again.
    const before = table.sent.length;
    await table.host.handleMessage('dev', { type: 'hello' });
    const replayed = table.sent.slice(before).filter((e) => e.clientId === 'dev').map((e) => e.msg.type);
    expect(replayed.indexOf('error')).toBeGreaterThan(replayed.indexOf('init'));

    // It does not carry on quietly: a move is refused with the same instruction.
    const refused = await table.bump();
    expect(refused).toBeUndefined();
    expect(table.errors().at(-1)?.message).toContain('New game');

    // And "New game" is the way forward, on the edited rules.
    await table.host.handleMessage('dev', { type: 'restart' });
    const next = await table.bump();
    expect(next?.success).toBe(true);
    expect(shownCount(table.frames())).toBe(1);
  }, 30_000);

  it('re-arms a timed step from the restored boundary, and the edited limit from the next step', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.timed(10_000) });
    const time = fakeClock();
    const table = await openCounterTable(await project.load(), time);
    expect(table.frames().at(-1)?.deadlineAt).toBe(START + 10_000);

    time.advance(4_000);
    time.armed.length = 0;
    project.save({ step: 1, flow: FLOWS.timed(20_000) });
    const outcome = await table.host.reloadRules((await project.load()).rules);

    expect(outcome?.kind).toBe('restored');
    // The old window was cleared and a new one armed from the moment the table
    // was carried across. The open step keeps the limit it opened with: a
    // step's limit is resolved when the step opens, and is part of its state.
    expect(time.armed).toEqual([null, 10_000]);
    expect(table.frames().at(-1)?.deadlineAt).toBe(START + 4_000 + 10_000);

    // The next step opens under the edited rules, with the edited limit.
    await table.bump();
    expect(time.armed.at(-1)).toBe(20_000);
    expect(table.frames().at(-1)?.deadlineAt).toBe(START + 4_000 + 20_000);
  }, 30_000);

  it('only swaps the rules when no game is running, so the next start uses them', async () => {
    const project = counterProject({ step: 1, flow: FLOWS.looped });
    const sent: HostOutbound[] = [];
    const host = new MultiplayerHost({
      playerCount: 1,
      minPlayers: 1,
      maxPlayers: 1,
      makeSeed: () => 'rules-reload',
      clock: fakeClock().clock,
      executeOp: (await project.load()).rules.executeOp,
      send: (_clientId, msg) => {
        sent.push(msg);
        clients.remember('dev', msg);
      },
    });

    project.save({ step: 7, flow: FLOWS.looped });
    expect(await host.reloadRules((await project.load()).rules)).toBeNull();

    await host.handleMessage('dev', { type: 'hello' });
    await host.handleMessage('dev', {
      type: 'server_request',
      requestId: 'one',
      op: 'action',
      payload: { actionName: 'bump', args: {}, boundaryKey: clients.key('dev') },
    });
    const frames = sent.filter((m): m is Extract<HostOutbound, { type: 'game_state' }> => m.type === 'game_state');
    expect(shownCount(frames)).toBe(7);
  }, 30_000);
});
