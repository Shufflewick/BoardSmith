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
import { afterEach, describe, it, expect, vi } from 'vitest';
import { executeOp, isReadOnlyOp, type ExecutableOp, type GameDefinitionLike, type Op, type OpSuccess } from './stateless-ops.js';
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

/** A heatmap computed from `v` = `from`, held until the test releases it. */
interface HeatmapCompute {
  from: number;
  release: () => void;
  /** Make the compute fail, as an executor call that throws does. */
  fail: (error: Error) => void;
}

/**
 * A two-seat table, seat 2 a bot. Every human op moves the game from `v` to
 * `v + 10` (to `complete` when `endsGame` says so), and a human action named
 * `slow` holds the section until the test releases it. A bot's move moves the
 * game from `v` to `v + 1`, unless the test queued a refusal in `refuseBot`.
 * Every bot search, and every heatmap computed, waits until the test releases it;
 * turning a heatmap off answers at once.
 */
function table(endsGame = false) {
  const searches: Search[] = [];
  const humanReads: number[] = [];
  const botMoves: number[] = [];
  const refuseBot: unknown[] = [];
  const heatmaps: HeatmapCompute[] = [];
  const slow: Array<() => void> = [];
  const recorded: number[] = [];
  let roster = [2];
  /** A bot search from `v` = `from`, held until the test releases it. */
  const search = (from: number, asked: number[]) =>
    new Promise((resolve) => {
      const held: Search = { from, asked, roster, released: false, release: (r) => { held.released = true; resolve(r); } };
      searches.push(held);
    });
  /** A human's op from `v` = `from`; an action named `slow` waits until the test releases it. */
  const humanOp = async (from: number, op: ExecutableOp) => {
    if (op.type === 'action' && op.actionName === 'slow') await new Promise<void>((resolve) => slow.push(resolve));
    humanReads.push(from);
    return answer(snap(from + 10, endsGame ? { complete: true } : {}));
  };
  /** A heatmap computed from `v` = `from`, held until the test releases it; turning it off answers at once. */
  const heatmap = async (from: number, op: Extract<ExecutableOp, { type: 'heatmapToggle' }>) => {
    if (op.visible) await new Promise<void>((release, fail) => heatmaps.push({ from, release, fail }));
    return { success: true, heatmapUpdate: { seat: op.seat, visible: op.visible, entries: op.visible ? [{ from }] : [] } };
  };
  const adapters: SnapshotSessionAdapters = {
    playerCount: 2,
    executeOp: stubExecuteOp(async (snapshot, _pending, op) => {
      const from = (snapshot as Snap | null)?.v ?? -1;
      if (op.type === 'start') return answer(snap(0));
      if (op.type === 'botSuggest') return search(from, op.seats.map((s) => s.seat));
      if (op.type === 'action' && op.player === 2) {
        botMoves.push(from);
        return refuseBot.shift() ?? answer(snap(from + 1));
      }
      if (op.type === 'heatmapToggle') return heatmap(from, op);
      return humanOp(from, op);
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
  return { host, searches, humanReads, botMoves, refuseBot, heatmaps, slow, recorded, setRoster };
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

describe('a refused bot move (#635)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const errorLog = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it("the game's own refusal holds the seat back until the game changes, and says to check the bot's moves", async () => {
    const errors = errorLog();
    const t = table();
    await t.host.start();
    t.refuseBot.push({ success: false, error: 'Seat 2 may never move.', category: 'bundle' });
    const first = t.host.runBotTurns();
    await untilSearches(t, 1);
    t.searches[0].release(moved(t.searches[0]));
    await first;

    expect(t.botMoves).toEqual([0]);
    expect(String(errors.mock.calls.at(-1)?.[0])).toMatch(/Seat 2 may never move\..*move enumeration/);
    // Nothing changed, so a wake does not ask the refused seat again.
    await t.host.runBotTurns();
    expect(t.searches).toHaveLength(1);
  });

  it("a refusal that is not the game's (the platform's, say) stops the bot without holding its seat, so the next wake moves it", async () => {
    const errors = errorLog();
    const t = table();
    await t.host.start();
    t.refuseBot.push({
      success: false,
      error: 'The platform was briefly unreachable. Nothing was lost -- take the same move again.',
      category: 'executor',
    });
    const first = t.host.runBotTurns();
    await untilSearches(t, 1);
    t.searches[0].release(moved(t.searches[0]));
    await first;

    expect(t.botMoves).toEqual([0]);
    expect(t.searches).toHaveLength(1);
    const logged = errors.mock.calls.map((call) => String(call[0]));

    // The game did not change, and a later wake (a resume, say) still moves the bot.
    const second = t.host.runBotTurns();
    await untilSearches(t, 2);
    t.searches[1].release(moved(t.searches[1]));
    await finish(t, second);
    expect(t.botMoves).toEqual([0, 0]);
    expect((t.host.snapshot as unknown as Snap).v).toBe(1);

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/briefly unreachable/);
    expect(logged[0]).toMatch(/not by the game's rules \(executor\)/);
    expect(logged[0]).not.toMatch(/selections|move enumeration/);
  });

  it('a refused search says which seats it was for and why, and does not say who refused it', async () => {
    const errors = errorLog();
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    await untilSearches(t, 1);
    // A platform may report a search's failure under any category, the game's own included.
    t.searches[0].release({ success: false, error: 'The bot could not load the game.', category: 'bundle' });
    await pump;

    const logged = errors.mock.calls.map((call) => String(call[0]));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/The bot search for seat\(s\) 2 was refused: The bot could not load the game\./);
    expect(logged[0]).not.toMatch(/game's rules/);
    expect(t.botMoves).toEqual([]);
  });

  it('a move found for a seat a human has taken since the search began is never made', async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    await untilSearches(t, 1);

    t.setRoster([]);
    t.searches[0].release(moved(t.searches[0]));
    await finish(t, pump);

    expect(t.botMoves).toEqual([]);
    expect((t.host.snapshot as unknown as Snap).v).toBe(0);
  });
});

describe('a visible heatmap, refreshed after a move (#635)', () => {
  it('moves made while a heatmap computes join that refresh: it computes once more, on the newest position, and stores only that (#676)', async () => {
    const t = table();
    t.setRoster([]);
    await t.host.start();
    t.host.transientTeachingState.set(1, { heatmap: { visible: true, entries: [] } });

    const first = humanMove(t.host);
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([10]);
    // Three more moves land while that heatmap computes. None starts a compute of its own.
    const more = [humanMove(t.host), humanMove(t.host), humanMove(t.host)];
    await settle();
    expect((t.host.snapshot as unknown as Snap).v).toBe(40);
    expect(t.heatmaps.map((h) => h.from)).toEqual([10]);

    // The heatmap from position 10 is thrown away, and computed once more, from 40.
    t.heatmaps[0].release();
    await settle();
    expect(t.host.transientTeachingState.get(1)?.heatmap?.entries).toEqual([]);
    expect(t.heatmaps.map((h) => h.from)).toEqual([10, 40]);
    t.heatmaps[1].release();
    await Promise.all([first, ...more]);
    expect(t.host.transientTeachingState.get(1)?.heatmap?.entries).toEqual([{ from: 40 }]);
    expect(t.heatmaps).toHaveLength(2);
  });

  it('a heatmap compute that fails rejects the move that started it, and the next move starts a new compute (#676)', async () => {
    const t = table();
    t.setRoster([]);
    await t.host.start();
    t.host.transientTeachingState.set(1, { heatmap: { visible: true, entries: [] } });

    const first = humanMove(t.host);
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([10]);
    t.heatmaps[0].fail(new Error('executor unavailable'));
    await expect(first).rejects.toThrow('executor unavailable');

    const next = humanMove(t.host);
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([10, 20]);
    t.heatmaps[1].release();
    succeeded(await next);
    expect(t.host.transientTeachingState.get(1)?.heatmap?.entries).toEqual([{ from: 20 }]);
  });

  it('a heatmap turned off while it is being refreshed stays off, and nothing is published for it', async () => {
    const t = table();
    t.setRoster([]);
    await t.host.start();
    t.host.transientTeachingState.set(1, { heatmap: { visible: true, entries: [] } });
    const move = humanMove(t.host);
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([10]);

    succeeded(await t.host.handleOp(1, { type: 'heatmapToggle', seat: 1, visible: false }));
    const published = t.recorded.length;
    t.heatmaps[0].release();
    await move;

    expect(t.host.transientTeachingState.get(1)?.heatmap).toEqual({ visible: false, entries: [] });
    expect(t.recorded).toHaveLength(published);
  });

  it('an undo made while a heatmap is being refreshed leaves it cleared, as every undo does', async () => {
    const t = table();
    t.setRoster([]);
    await t.host.start();
    t.host.transientTeachingState.set(1, { heatmap: { visible: true, entries: [] } });
    const move = humanMove(t.host);
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([10]);

    succeeded(await t.host.handleOp(1, { type: 'undo', player: 1 }));
    expect((t.host.snapshot as unknown as Snap).v).toBe(20);
    const published = t.recorded.length;
    t.heatmaps[0].release();
    await move;

    // The heatmap computed before the undo was not stored, and none was computed after it.
    expect(t.host.transientTeachingState.has(1)).toBe(false);
    expect(t.heatmaps).toHaveLength(1);
    expect(t.recorded).toHaveLength(published);
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
