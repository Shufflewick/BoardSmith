/**
 * A bot's search runs outside the host's one-at-a-time section (#635).
 *
 * The bot searches (`botSuggest`, which changes nothing) against the snapshot
 * the game stood on when it started, with nothing held. Its move is made,
 * inside the section, as an ordinary `action` for its seat, and only if the
 * game still stands there; otherwise it is stale, never made, and the bot
 * searches again from where the game now is. Every search here is a held
 * promise the test releases, so nothing depends on how long anything takes.
 */
import { describe, it, expect } from 'vitest';
import { executeOp, isReadOnlyOp, type GameDefinitionLike, type Op, type OpSuccess } from './stateless-ops.js';
import { SnapshotSessionHost, type SnapshotSessionAdapters } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { simultaneousRoundsFixtureDefinition } from './testing/fixtures/simultaneous-rounds-fixture.js';
import { fixedDeployDefinition } from './testing/fixtures/timed-step-fixture.js';
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
  /** The seats the search was asked about, and the table's bot seats when it began. */
  asked: number[];
  roster: number[];
  released: boolean;
  release: (result: unknown) => void;
}

/**
 * A two-seat table, seat 2 a bot. Every human op moves the game from `v` to
 * `v + 10` (to `complete` when `endsGame` says so), and a human action named
 * `slow` holds the section until the test releases it. A bot's move moves the
 * game from `v` to `v + 1`. Every bot search waits until the test releases it.
 */
function table(endsGame = false) {
  const searches: Search[] = [];
  const humanReads: number[] = [];
  const botMoves: number[] = [];
  const slow: Array<() => void> = [];
  const recorded: number[] = [];
  let roster = [2];
  const adapters: SnapshotSessionAdapters = {
    playerCount: 2,
    executeOp: stubExecuteOp(async (snapshot, _pending, op) => {
      const from = (snapshot as Snap | null)?.v ?? -1;
      if (op.type === 'start') return answer(snap(0));
      if (op.type === 'botSuggest') {
        return new Promise((resolve) => {
          const search: Search = {
            from,
            asked: op.seats.map((s) => s.seat),
            roster,
            released: false,
            release: (r) => { search.released = true; resolve(r); },
          };
          searches.push(search);
        });
      }
      if (op.type === 'action' && op.player === 2) {
        botMoves.push(from);
        return answer(snap(from + 1));
      }
      if (op.type === 'action' && op.actionName === 'slow') await new Promise<void>((resolve) => slow.push(resolve));
      humanReads.push(from);
      return answer(snap(from + 10, endsGame ? { complete: true } : {}));
    }),
    record: () => recorded.push((host.snapshot as unknown as Snap).v),
    push: () => {},
  };
  const host = new SnapshotSessionHost(adapters);
  /** Make `seats` the table's bot seats. */
  const setRoster = (seats: number[]) => {
    roster = seats;
    host.setBotSeats(seats.map((seat) => ({ seat })));
  };
  setRoster([2]);
  return { host, searches, humanReads, botMoves, slow, recorded, setRoster };
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

const moved = (search: Search) =>
  answer(snap(search.from), { botPlayer: 2, suggestedAction: 'botMove', suggestedArgs: {} });
const nothingDue = (search: Search) => answer(snap(search.from));

/** Answer every search still held with "nothing due", and let every slow move go, until `work` settles. */
async function finish(t: Table, ...work: Promise<unknown>[]): Promise<void> {
  let done = false;
  const all = Promise.all(work).finally(() => { done = true; });
  while (!done) {
    for (const search of t.searches) if (!search.released) search.release(nothingDue(search));
    t.slow.splice(0).forEach((release) => release());
    await settle();
  }
  await all;
}

const humanMove = (host: SnapshotSessionHost, actionName = 'x') =>
  host.handleOp(1, { type: 'action', actionName, player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host) });

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

  it("a human's pick, one selection of a move, is made and published while a bot searches", async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    await untilSearches(t, 1);

    const pick = t.host.handleOp(1, {
      type: 'selectionStep', player: 1, selectionName: 's', value: 1, actionName: 'x', boundaryKey: boundaryKeyOfHost(t.host),
    });
    await settle();

    // The search is still held, and the pick has already been made and published.
    expect(t.searches[0].released).toBe(false);
    expect(t.humanReads).toEqual([0]);
    expect(t.recorded.at(-1)).toBe(10);
    await finish(t, pump, pick);
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

      // The stale move, chosen at v0, was never made; the fresh one was.
      expect(t.botMoves).toEqual([10]);
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
    expect(t.botMoves).toEqual([]);
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

  it('the search that holds the table asks the bot seats the table has when it begins', async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    const humans: Promise<unknown>[] = [];
    for (let i = 0; i < 2; i++) {
      await untilSearches(t, i + 1);
      humans.push(humanMove(t.host));
      await settle();
      t.searches[i].release(moved(t.searches[i]));
    }
    await untilSearches(t, 3);

    // The third search goes stale behind a slow move, while more slow moves
    // queue for the section, so the next search waits its turn for it.
    humans.push(humanMove(t.host, 'slow'));
    await settle();
    t.searches[2].release(moved(t.searches[2]));
    await settle();
    humans.push(humanMove(t.host, 'slow'));
    await settle();
    t.slow.shift()!();
    await settle();
    humans.push(humanMove(t.host, 'slow'));
    await settle();
    t.slow.shift()!();
    await settle();

    // The table changes its bot seats while a slow move holds the section.
    t.setRoster([]);
    await finish(t, pump, ...humans);

    for (const search of t.searches) expect(search.asked).toEqual(search.roster);
  });

  it('a rules reload that lands while a bot searches makes the search stale, and the bot moves on the new rules', async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    await untilSearches(t, 1);

    const reload = t.host.adoptReloadedRules(async () => ({
      kind: 'restored',
      result: answer(snap(100)) as unknown as OpSuccess<'start'>,
    }));
    await settle();
    t.searches[0].release(moved(t.searches[0])); // chosen on the old rules
    await untilSearches(t, 2);

    expect(t.searches[1].from).toBe(100);
    t.searches[1].release(moved(t.searches[1]));
    await finish(t, pump, reload);
    expect(t.botMoves).toEqual([100]);
    expect((t.host.snapshot as unknown as Snap).v).toBe(101);
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
    expect(t.botMoves).toEqual([]);
    expect(t.searches).toHaveLength(1);
  });

  it('on a real game: a human commits while the bot searches the same round, and the bot commits once, from the new position', async () => {
    const t = await realTable(simultaneousRoundsFixtureDefinition, 2, [2]);
    const pump = t.host.runBotTurns();
    await settle();
    expect(t.held).toHaveLength(1);

    // Seat 1 commits while the bot is still searching round 1.
    const human = t.host.handleOp(1, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(t.host),
    });
    await settle();
    expect(t.due.at(-1)).toEqual([2]);

    await t.releaseAll(pump, human);

    // Round 1 has one commit from each seat: the search from before seat 1's
    // commit was thrown away, never adopted as a second round-1 move.
    expect((await t.history()).slice(0, 2)).toEqual([1, 2]);
    t.expectEveryChangeAdopted();
  });

  it('on a real game with two bot seats: a human commits while the first bot searches, and each bot commits once', async () => {
    const t = await realTable(simultaneousRoundsFixtureDefinition, 3, [2, 3]);
    const pump = t.host.runBotTurns();
    await settle();
    expect(t.held).toHaveLength(1);

    const human = t.host.handleOp(1, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(t.host),
    });
    await settle();
    expect(t.due.at(-1)).toEqual([2, 3]);
    await t.releaseAll(pump, human);

    expect((await t.history()).slice(0, 3)).toEqual([1, 2, 3]);
    t.expectEveryChangeAdopted();
  });

  it("on a real game: a human's timed seat expires while the bot searches, and the bot commits once, from the new position", async () => {
    const t = await realTable(fixedDeployDefinition, 2, [2]);
    const pump = t.host.runBotTurns();
    await settle();
    expect(t.held).toHaveLength(1);

    const expiry = t.host.handleOp(1, {
      type: 'expireSeat', player: 1, idleAction: 'commit', args: {}, boundaryKey: boundaryKeyOfHost(t.host),
    });
    await settle();
    expect(t.due.at(-1)).toEqual([2]);
    await t.releaseAll(pump, expiry);

    expect((await t.history()).slice(0, 2)).toEqual([1, 2]);
    t.expectEveryChangeAdopted();
  });

  it('on a real game: a human undoes a commit while the bot searches, and the bot commits once, from the new position', async () => {
    const t = await realTable(simultaneousRoundsFixtureDefinition, 2, [2]);
    t.host.setBotSeats([]);
    succeeded(await t.host.handleOp(1, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(t.host),
    }));
    t.host.setBotSeats([{ seat: 2 }]);
    const pump = t.host.runBotTurns();
    await settle();
    expect(t.held).toHaveLength(1);

    const undo = t.host.handleOp(1, { type: 'undo', player: 1 });
    await settle();
    expect(t.due.at(-1)).toEqual([1, 2]);
    await t.releaseAll(pump, undo);
    expect((await undo).success).toBe(true);

    expect(await t.history()).toEqual([2]);
    t.expectEveryChangeAdopted();
  });
});

/**
 * A real game behind a host whose bot seats are `bots`. Every bot search waits
 * until the test releases it. Records each result `executeOp` returned for an
 * op that changes the game, and each snapshot the host adopted, so a test can
 * show no game-changing result was made and then thrown away.
 */
async function realTable(definition: GameDefinitionLike, playerCount: number, bots: number[]) {
  const options = { playerCount, seed: 'bs635' };
  const held: Array<() => void> = [];
  const due: number[][] = [];
  const changes: Array<{ op: string; snapshot: unknown }> = [];
  const adopted = new Set<unknown>();
  const host = new SnapshotSessionHost({
    playerCount,
    debug: true,
    executeOp: stubExecuteOp(async (snapshot, pending, op) => {
      if (op.type === 'botSuggest') await new Promise<void>((resolve) => held.push(resolve));
      const res = await executeOp(definition, options, snapshot, pending, op, { debug: true });
      if (res.success && !isReadOnlyOp(op) && 'snapshot' in res) changes.push({ op: op.type, snapshot: res.snapshot });
      return res;
    }),
    record: (_views, meta) => due.push(meta.turnBoundary.dueSeats),
    push: () => {},
    persist: (state) => { adopted.add(state.snapshot); },
  });
  host.setBotSeats(bots.map((seat) => ({ seat })));
  await host.start();
  return {
    host,
    held,
    due,
    /** Release every search as it comes until all of `work` settles. */
    async releaseAll(...work: Promise<unknown>[]): Promise<void> {
      let done = false;
      const all = Promise.all(work).finally(() => { done = true; });
      while (!done) {
        held.splice(0).forEach((release) => release());
        await settle();
      }
      await all;
    },
    /** The seat of each move in the game's history, oldest first. */
    async history(): Promise<number[]> {
      return succeeded(await host.handleOp(1, { type: 'debugHistory' })).actionHistory.map((entry) => entry.player);
    },
    /** Every game-changing result `executeOp` returned is one the host adopted. */
    expectEveryChangeAdopted(): void {
      expect(changes.filter((change) => !adopted.has(change.snapshot)).map((change) => change.op)).toEqual([]);
    },
  };
}
