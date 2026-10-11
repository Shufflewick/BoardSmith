/**
 * A bot's search runs outside the host's one-at-a-time section (#635).
 *
 * The bot searches against the snapshot the game stood on when it started, with
 * nothing held. Its move is adopted, inside the section, only if the game still
 * stands there; otherwise it is thrown away as stale and the bot searches again
 * from where the game now is. Every search here is a held promise the test
 * releases, so nothing depends on how long anything takes.
 */
import { describe, it, expect } from 'vitest';
import { executeOp, type Op } from './stateless-ops.js';
import { SnapshotSessionHost, type SnapshotSessionAdapters } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { simultaneousRoundsFixtureDefinition } from './testing/fixtures/simultaneous-rounds-fixture.js';
import { stubExecuteOp, succeeded } from './op-result.test-helper.js';

interface Snap {
  v: number;
  flowState: Record<string, unknown>;
  winners: number[];
  actionHistory: unknown[];
}

const snap = (v: number, flowState: Record<string, unknown> = {}): Snap => ({ v, flowState, winners: [], actionHistory: [] });
const answer = (snapshot: Snap, extra: Record<string, unknown> = {}) => ({
  success: true,
  snapshot,
  playerViews: [null, null],
  ...extra,
});

interface Search {
  /** The `v` of the snapshot the bot searched from. */
  from: number;
  released: boolean;
  release: (result: unknown) => void;
}

/**
 * A two-seat table, seat 2 a bot. Every human op moves the game from `v` to
 * `v + 10` (to `complete` when `endsGame` says so); every bot search waits
 * until the test releases it.
 */
function table(endsGame = false) {
  const searches: Search[] = [];
  const humanReads: number[] = [];
  const recorded: number[] = [];
  const adapters: SnapshotSessionAdapters = {
    playerCount: 2,
    executeOp: stubExecuteOp(async (snapshot, _pending, op) => {
      const from = (snapshot as Snap | null)?.v ?? -1;
      if (op.type === 'start') return answer(snap(0));
      if (op.type === 'botTurn') {
        return new Promise((resolve) => {
          const search: Search = { from, released: false, release: (r) => { search.released = true; resolve(r); } };
          searches.push(search);
        });
      }
      if (op.type === 'resolveChoices') return { success: true, choices: [] };
      humanReads.push(from);
      return answer(snap(from + 10, endsGame ? { complete: true } : {}));
    }),
    record: () => recorded.push((host.snapshot as unknown as Snap).v),
    push: () => {},
  };
  const host = new SnapshotSessionHost(adapters);
  host.setBotSeats([{ seat: 2 }]);
  return { host, searches, humanReads, recorded };
}

type Table = ReturnType<typeof table>;

/** Let every pending promise and queued task run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function untilSearches(t: Table, n: number): Promise<void> {
  await settle();
  expect(t.searches.length).toBe(n);
}

const moved = (search: Search) => answer(snap(search.from + 1), { botMoved: true, botPlayer: 2 });
const nothingDue = (search: Search) => answer(snap(search.from), { botMoved: false });

/** Answer every search still held with "nothing due" until `work` settles. */
async function finish(t: Table, ...work: Promise<unknown>[]): Promise<void> {
  let done = false;
  const all = Promise.all(work).finally(() => { done = true; });
  while (!done) {
    for (const search of t.searches) if (!search.released) search.release(nothingDue(search));
    await settle();
  }
  await all;
}

const humanMove = (host: SnapshotSessionHost) =>
  host.handleOp(1, { type: 'action', actionName: 'x', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host) });

describe('a bot search runs outside the one-at-a-time section (#635)', () => {
  it("a human's move made while a bot searches is made and published at once, before the search ends", async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    await untilSearches(t, 1);

    const human = humanMove(t.host);
    await settle();

    // The search is still held, and the human's move has already landed.
    expect(t.searches[0].released).toBe(false);
    expect(t.humanReads).toEqual([0]);
    expect((t.host.snapshot as unknown as Snap).v).toBe(10);
    expect(t.recorded.at(-1)).toBe(10);

    await finish(t, pump, human);
  });

  it("a human's view request answers while a bot searches", async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    await untilSearches(t, 1);

    const view = await t.host.handleOp(1, {
      type: 'resolveChoices', actionName: 'x', player: 1, selectionName: 's', args: {},
    });

    expect(view.success).toBe(true);
    expect(t.searches[0].released).toBe(false);
    await finish(t, pump);
  });

  const humanOps: Array<[string, (host: SnapshotSessionHost) => Op]> = [
    ['a move', (host) => ({ type: 'action', actionName: 'x', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host) })],
    ['a timed seat expiring', (host) => ({ type: 'expireSeat', player: 1, idleAction: 'pass', args: {}, boundaryKey: boundaryKeyOfHost(host) })],
    ['an undo', () => ({ type: 'undo', player: 1 })],
  ];

  it.each(humanOps)(
    'a bot move searched from a position that %s has since changed is thrown away, and the bot moves from the new one',
    async (_name, op) => {
      const t = table();
      await t.host.start();
      const pump = t.host.runBotTurns();
      await untilSearches(t, 1);

      const human = t.host.handleOp(1, op(t.host));
      await settle();
      t.searches[0].release(moved(t.searches[0])); // chosen from v0, which is gone
      await untilSearches(t, 2);

      expect(t.searches[1].from).toBe(10);
      t.searches[1].release(moved(t.searches[1]));
      await finish(t, pump, human);

      // The stale move (v1) was never adopted; the fresh one (v11) was.
      expect(t.recorded).not.toContain(1);
      expect((t.host.snapshot as unknown as Snap).v).toBe(11);
    },
  );

  it('a game that ends while a bot searches takes no bot move and asks for no other search', async () => {
    const t = table(true);
    await t.host.start();
    const pump = t.host.runBotTurns();
    await untilSearches(t, 1);

    const human = humanMove(t.host);
    await settle();
    t.searches[0].release(moved(t.searches[0]));
    await Promise.all([pump, human]);

    expect(t.host.isComplete).toBe(true);
    expect((t.host.snapshot as unknown as Snap).v).toBe(10);
    expect(t.searches).toHaveLength(1);
  });

  it('after three searches in a row are thrown away, the next one holds the table until its move is made', async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    const humans: Promise<unknown>[] = [];

    for (let i = 0; i < 3; i++) {
      await untilSearches(t, i + 1);
      humans.push(humanMove(t.host));
      await settle();
      t.searches[i].release(moved(t.searches[i]));
    }

    // The fourth search runs inside the section: a human move sent now waits.
    await untilSearches(t, 4);
    expect(t.searches[3].from).toBe(30);
    humans.push(humanMove(t.host));
    await settle();
    expect(t.humanReads).toEqual([0, 10, 20]);

    t.searches[3].release(moved(t.searches[3]));
    await settle();
    // The bot's move (v31) was made first, and the human then moved from it.
    expect(t.humanReads).toEqual([0, 10, 20, 31]);

    await finish(t, pump, ...humans);
  });

  it('a wake that arrives while a search finds nothing due makes the bot look again', async () => {
    const t = table();
    await t.host.start();
    const first = t.host.runBotTurns();
    await untilSearches(t, 1);

    // A second wake (a roster change and its convertSeatToBot, say) arrives mid-search.
    const second = t.host.runBotTurns();
    t.searches[0].release(nothingDue(t.searches[0]));
    await untilSearches(t, 2);

    await finish(t, first, second);
    expect(t.searches).toHaveLength(2);
  });

  it('a host disposed while a bot searches publishes nothing more and asks for no other search', async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    await untilSearches(t, 1);
    const published = t.recorded.length;

    t.host.dispose();
    t.searches[0].release(moved(t.searches[0]));
    await pump;

    expect(t.recorded).toHaveLength(published);
    expect(t.searches).toHaveLength(1);
  });

  it('on a real game: a human commits while the bot searches the same round, and the bot commits once, from the new position', async () => {
    const options = { playerCount: 2, seed: 'bs635' };
    const held: Array<() => void> = [];
    const due: number[][] = [];
    const host = new SnapshotSessionHost({
      playerCount: 2,
      debug: true,
      executeOp: async (snapshot, pending, op) => {
        if (op.type === 'botTurn') await new Promise<void>((resolve) => held.push(resolve));
        return executeOp(simultaneousRoundsFixtureDefinition, options, snapshot, pending, op, { debug: true });
      },
      record: (_views, meta) => due.push(meta.turnBoundary.dueSeats),
      push: () => {},
    });
    host.setBotSeats([{ seat: 2 }]);
    await host.start();
    expect(due.at(-1)).toEqual([1, 2]);

    const pump = host.runBotTurns();
    await settle();
    expect(held).toHaveLength(1);

    // Seat 1 commits while the bot is still searching round 1.
    const human = host.handleOp(1, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host),
    });
    await settle();
    expect(due.at(-1)).toEqual([2]);

    // Release every search as it comes, until the bot has nothing left to do.
    let done = false;
    const all = Promise.all([pump, human]).finally(() => { done = true; });
    while (!done) {
      held.splice(0).forEach((release) => release());
      await settle();
    }
    await all;

    // Round 1 has one commit from each seat: the search from before seat 1's
    // commit was thrown away, never adopted as a second round-1 move.
    const history = succeeded(await host.handleOp(1, { type: 'debugHistory' })).actionHistory;
    expect(history.slice(0, 2).map((entry) => entry.player)).toEqual([1, 2]);
  });
});
