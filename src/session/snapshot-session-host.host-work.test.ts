/**
 * #388: WORK THE SESSION STARTS ITSELF WAITS FOR A PENDING RULES RELOAD.
 *
 * `boardsmith dev` holds every page's message, and every timer its host arms,
 * while an edited rules file rebuilds (#379, #387). The session starts two
 * kinds of work of its own that none of that reached:
 *
 *   - the narrated demo's next move, paced by the session's own timer;
 *   - a chain of bot moves already running when the save lands.
 *
 * Both are handed to the host's `HostWorkGate` now. These tests drive the
 * session with a gate they open and close by hand, and with "rules" that are
 * nothing but how much a move adds, so which rules a move ran on is the count.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Op, OpResult } from './stateless-ops.js';
import type { HostWorkGate } from './host-work-gate.js';
import { SnapshotSessionHost, type RulesReload } from './snapshot-session-host.js';

type Count = { count: number };

/** A gate a test closes (a save landed) and opens (the reload settled) by hand. */
function manualGate() {
  let pending = false;
  const held: Array<() => void | Promise<void>> = [];
  const gate: HostWorkGate = {
    get reloadPending() {
      return pending;
    },
    hold(work) {
      if (pending || held.length > 0) held.push(work);
      else void work();
    },
  };
  return {
    gate,
    held,
    saved: () => {
      pending = true;
    },
    /** The reload settled: what was held runs, in order. */
    settle: async () => {
      pending = false;
      while (held.length > 0) await held.shift()!();
    },
  };
}

/**
 * A one-seat game whose only move adds `rules.step`. Bots move while the count
 * is below `botsStopAt`.
 */
function countingSession(options: { botSeats?: Array<{ seat: number }>; botsStopAt?: number; onBotTurn?: () => void }) {
  const rules = { step: 1 };
  const gate = manualGate();
  const views: Count[] = [];
  const result = (snapshot: Count, extra: Partial<OpResult> = {}): OpResult => ({
    success: true,
    snapshot,
    pendingState: null,
    flowState: {},
    playerViews: [{ state: { count: snapshot.count } }],
    isComplete: false,
    winners: [],
    ...extra,
  });
  const executeOp = async (snapshot: unknown, _pending: unknown, op: Op): Promise<OpResult> => {
    const at = snapshot as Count;
    switch (op.type) {
      case 'start':
        return result({ count: 0 });
      case 'botSuggest':
        return result(at, { botPlayer: 1, suggestedAction: 'bump', suggestedArgs: {} });
      case 'action':
        return result({ count: at.count + rules.step });
      case 'botTurn':
        options.onBotTurn?.();
        if (at.count >= (options.botsStopAt ?? 0)) return result(at, { botMoved: false });
        return result({ count: at.count + rules.step }, { botMoved: true });
      default:
        throw new Error(`this test's game does not answer ${op.type}`);
    }
  };
  const host = new SnapshotSessionHost({
    playerCount: 1,
    botSeats: options.botSeats,
    executeOp,
    hostWork: gate.gate,
    push: () => {}, record: ({ players: playerViews }) => {
      const view = playerViews[0] as { state: Count & { demoControls?: { canStepBack: boolean } } } | undefined;
      if (view !== undefined) views.push(view.state);
    },
  });
  /** The edited rules are adopted, as `boardsmith dev` does once they have loaded. */
  const adopt = (step: number) =>
    host.adoptReloadedRules(async (snapshot): Promise<RulesReload> => {
      rules.step = step;
      return { kind: 'restored', result: result({ count: (snapshot as unknown as Count).count }) };
    });
  return { host, gate, views, adopt, count: () => (host.snapshot as unknown as Count).count };
}

afterEach(() => vi.useRealTimers());

/** What each case below does with the save, and what the demo's first move adds. */
const SETTLED = [
  { on: 'the edited rules once they are in place', edited: true, count: 10 },
  { on: 'the old rules when the edit does not build', edited: false, count: 1 },
];

/** A counting session whose demo has narrated its first move, paced at a second a move. */
async function demoTable() {
  vi.useFakeTimers();
  const table = countingSession({});
  await table.host.start();
  await table.host.handleOp(1, { type: 'demoStart', delay: 1_000 });
  await vi.advanceTimersByTimeAsync(0);
  /** Stop the demo; resolves with the timers still pending, which must be none. */
  const stop = async () => {
    await table.host.handleOp(1, { type: 'demoStop' });
    await vi.runAllTimersAsync();
    return vi.getTimerCount();
  };
  return { ...table, stop };
}

describe('#388: the demo move due while a rules reload is pending', () => {
  it.each(SETTLED)('waits for the reload and runs on $on', async ({ edited, count }) => {
    const table = await demoTable();

    // The move is narrated on the old rules, and the save lands while it is paced.
    table.gate.saved();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(table.gate.held).toHaveLength(1);
    expect(table.count()).toBe(0);

    if (edited) await table.adopt(10);
    await table.gate.settle();
    await vi.advanceTimersByTimeAsync(1_000);
    // The demo's first move adds the step of the rules it ran on.
    expect(table.views.find((view) => view.count > 0)?.count).toBe(count);
    expect(await table.stop()).toBe(0);
  });

  it('forgets the moves it could step back to when the rules are replaced', async () => {
    const table = await demoTable();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(table.count()).toBe(1);
    expect(table.views.at(-1)).toMatchObject({ demoControls: { canStepBack: true } });

    // Stepping back after the reload would restore a position the old rules made.
    await table.adopt(10);
    expect(table.views.at(-1)).toMatchObject({ demoControls: { canStepBack: false } });
    expect(await table.stop()).toBe(0);
  });

  it('stops when the game cannot be carried onto the edited rules', async () => {
    const table = await demoTable();
    expect(table.host.demoRunning).toBe(true);

    await table.host.adoptReloadedRules(async () => ({ kind: 'failed', reason: 'the flow has no such step' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(table.host.demoRunning).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(table.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('#388: a chain of bot moves running when a save lands', () => {
  it.each([
    { on: 'the edited rules once they are in place', edited: true, count: 11 },
    { on: 'the old rules when the edit does not build', edited: false, count: 3 },
  ])('yields to the reload between moves and goes on on $on', async ({ edited, count }) => {
    let turns = 0;
    const table = countingSession({
      botSeats: [{ seat: 1 }],
      botsStopAt: 3,
      // The save lands while the chain's first move is being made.
      onBotTurn: () => {
        if (++turns === 1) table.gate.saved();
      },
    });
    await table.host.start();
    await table.host.runBotTurns();

    // The move under way when the save landed finishes; the next waits.
    expect(table.count()).toBe(1);
    expect(table.gate.held.length).toBeGreaterThan(0);

    if (edited) await table.adopt(10);
    await table.gate.settle();
    expect(table.count()).toBe(count);
  });
});
