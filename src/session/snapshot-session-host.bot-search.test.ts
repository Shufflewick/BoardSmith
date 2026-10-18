/**
 * A bot's search runs outside the host's one-at-a-time section (#635).
 *
 * The bot searches (`botSuggest`, which changes nothing) against the snapshot
 * the game stood on when it started, with nothing held. Its move is made,
 * inside the section, as an ordinary `action` for its seat, and only if the
 * game still stands there; otherwise it is stale, never made, and the bot
 * searches again from where the game now is. After three stale searches in a
 * row, the move is made on the table as it stands if it is still legal there
 * (#700). Every search here is a held promise the test releases, so nothing
 * depends on how long anything takes.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { executeOp, isReadOnlyOp, STALE_SUBMISSION_MESSAGE, type ExecutableOp, type GameDefinitionLike, type Op, type OpSuccess } from './stateless-ops.js';
import { SnapshotSessionHost, type SeatOp, type SnapshotSessionAdapters } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { simultaneousRoundsFixtureDefinition } from './testing/fixtures/simultaneous-rounds-fixture.js';
import { fixedDeployDefinition } from './testing/fixtures/timed-step-fixture.js';
import { stubExecuteOp, succeeded } from './op-result.test-helper.js';
import { ErrorCode } from '../types/protocol.js';

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
 * Every bot search, hint and heatmap computed waits until the test releases it;
 * turning a heatmap off answers at once unless the test holds it.
 */
function table(endsGame = false) {
  const searches: Search[] = [];
  const humanReads: number[] = [];
  const botMoves: number[] = [];
  const refuseBot: unknown[] = [];
  const heatmaps: HeatmapCompute[] = [];
  const hints: HeatmapCompute[] = [];
  /** Set `on` to hold turning a heatmap off too, as a compute is held. */
  const holdHeatmapOff = { on: false };
  const slow: Array<() => void> = [];
  const recorded: number[] = [];
  const backgroundErrors: unknown[] = [];
  let roster = [2];
  /** A bot search from `v` = `from`, held until the test releases it. */
  const search = (from: number, asked: number[]) =>
    new Promise((resolve) => {
      const held: Search = { from, asked, roster, released: false, release: (r) => { held.released = true; resolve(r); } };
      searches.push(held);
    });
  /** A hint computed from `v` = `from`, held until the test releases it. */
  const hint = async (from: number, op: Extract<ExecutableOp, { type: 'hint' }>) => {
    await new Promise<void>((release, fail) => hints.push({ from, release, fail }));
    return { success: true, hintAnnotation: { seat: op.seat, annotation: { text: `from ${from}` } } };
  };
  /** A human's op from `v` = `from` (a hint is held as {@link hint}); an action named `slow` waits until the test releases it. */
  const humanOp = async (from: number, op: ExecutableOp) => {
    if (op.type === 'hint') return hint(from, op);
    if (op.type === 'action' && op.actionName === 'slow') await new Promise<void>((resolve) => slow.push(resolve));
    humanReads.push(from);
    return answer(snap(from + 10, endsGame ? { complete: true } : {}));
  };
  /** A heatmap computed from `v` = `from`, held until the test releases it; turning it off answers at once unless `holdHeatmapOff` is on. */
  const heatmap = async (from: number, op: Extract<ExecutableOp, { type: 'heatmapToggle' }>) => {
    if (op.visible || holdHeatmapOff.on) await new Promise<void>((release, fail) => heatmaps.push({ from, release, fail }));
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
    onBackgroundError: (error) => backgroundErrors.push(error),
  };
  const host = new SnapshotSessionHost(adapters);
  /** Make `seats` the table's bot seats. */
  const setRoster = (seats: number[]) => {
    roster = seats;
    host.setBotSeats(seats.map((seat) => ({ seat })));
  };
  setRoster([2]);
  return { host, searches, humanReads, botMoves, refuseBot, heatmaps, hints, holdHeatmapOff, slow, recorded, backgroundErrors, setRoster };
}

type Table = ReturnType<typeof table>;

/** Let every pending promise and queued task run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Expect `op` to be answered before any held search is released, and hand back its answer. */
async function answeredWhileSearching<T>(op: Promise<T>): Promise<T> {
  let answered = false;
  const result = op.then((res) => { answered = true; return res; });
  await settle();
  expect(answered).toBe(true);
  return result;
}

async function untilSearches(t: Table, n: number): Promise<void> {
  await settle();
  expect(t.searches.length).toBe(n);
}

/** A search's answers: a move for seat 2, or nothing due. A search returns no state (#675). */
const moved = { success: true, botPlayer: 2, suggestedAction: 'botMove', suggestedArgs: {} };
const nothingDue = { success: true };

/** Answer every search still held with "nothing due", and let every slow move go, until `work` settles. */
async function finish(t: Table, ...work: Promise<unknown>[]): Promise<void> {
  let done = false;
  const all = Promise.all(work).finally(() => { done = true; });
  while (!done) {
    for (const search of t.searches) if (!search.released) search.release(nothingDue);
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

  const humanOps: Array<[string, (host: SnapshotSessionHost) => SeatOp]> = [
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
      t.searches[0].release(moved); // chosen from v0, which is gone
      await untilSearches(t, 2);

      expect(t.searches[1].from).toBe(10);
      t.searches[1].release(moved);
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
    t.searches[0].release(moved);
    await Promise.all([pump, human]);

    expect(t.host.isComplete).toBe(true);
    expect((t.host.snapshot as unknown as Snap).v).toBe(10);
    expect(t.botMoves).toEqual([]);
    expect(t.searches).toHaveLength(1);
  });

  it("after three searches in a row are thrown away, a human's move during the next one is answered at once, and the bot's move is made on the table as it stands (#700)", async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    const humans: Promise<unknown>[] = [];

    for (let i = 0; i < 3; i++) {
      await untilSearches(t, i + 1);
      humans.push(humanMove(t.host));
      await settle();
      t.searches[i].release(moved);
    }

    // The fourth search holds nothing: a human move sent now is made and answered while it runs.
    await untilSearches(t, 4);
    expect(t.searches[3].from).toBe(30);
    succeeded(await answeredWhileSearching(humanMove(t.host)));
    expect(t.searches[3].released).toBe(false);
    expect(t.humanReads).toEqual([0, 10, 20, 30]);

    // The table changed during every search, and the bot still moves on the fourth: the
    // move it chose at v30 is still legal at v40, so it is made there, after the human's.
    t.searches[3].release(moved);
    await settle();
    expect(t.botMoves).toEqual([40]);
    expect(t.recorded.slice(-2)).toEqual([40, 41]);

    await finish(t, pump, ...humans);
  });

  /** Three searches thrown away, then a fourth during which a human moves the table from v30 to v40. */
  async function staleThriceThenMoved(t: Table): Promise<Promise<unknown>[]> {
    const humans: Promise<unknown>[] = [];
    for (let i = 0; i < 4; i++) {
      await untilSearches(t, i + 1);
      humans.push(humanMove(t.host));
      await settle();
      if (i < 3) t.searches[i].release(moved);
    }
    return humans;
  }

  const refusalsOfAMovedTable: Array<[string, unknown]> = [
    ["the game's rules (the move is no longer legal)", { success: false, error: 'That card is gone.', category: 'bundle' }],
    ['a closed round (the move names a round that has ended)', {
      success: false, error: STALE_SUBMISSION_MESSAGE, category: 'protocol', errorCode: ErrorCode.STALE_SUBMISSION,
    }],
  ];

  it.each(refusalsOfAMovedTable)(
    'a move chosen before the table moved and refused by %s is not made, holds no seat back, and the bot searches again (#700)',
    async (_name, refusal) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const t = table();
      await t.host.start();
      const pump = t.host.runBotTurns();
      const humans = await staleThriceThenMoved(t);

      t.refuseBot.push(refusal);
      t.searches[3].release(moved); // chosen at v30, refused at v40
      await untilSearches(t, 5);
      expect(t.searches[4].from).toBe(40);
      expect((t.host.snapshot as unknown as Snap).v).toBe(40);

      t.searches[4].release(moved);
      await finish(t, pump, ...humans);
      expect(t.botMoves).toEqual([40, 40]);
      expect((t.host.snapshot as unknown as Snap).v).toBe(41);
      // A refusal of a move chosen on another position says nothing about this one: no hold-back, nothing logged.
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    },
  );

  const answersAboutTheSearchedTable: Array<[string, unknown]> = [
    ['a stalled seat', { success: true, botStalled: { seat: 2, reason: 'The bot found no move.' } }],
    ['a refused search', { success: false, error: 'The bot could not load the game.', category: 'executor' }],
  ];

  it.each(answersAboutTheSearchedTable)(
    'after three stale searches, a fourth that answers %s while the table moves is stale: no seat is held back, nothing is logged, and the bot searches again (#700)',
    async (_name, answer) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const t = table();
      await t.host.start();
      const pump = t.host.runBotTurns();
      const humans = await staleThriceThenMoved(t);

      t.searches[3].release(answer); // about v30, which is gone
      await untilSearches(t, 5);
      expect(t.searches[4].from).toBe(40);
      expect(t.searches[4].asked).toEqual([2]);
      expect(errors).not.toHaveBeenCalled();

      t.searches[4].release(moved);
      await finish(t, pump, ...humans);
      expect(t.botMoves).toEqual([40]);
      errors.mockRestore();
    },
  );

  it("a crash inside the rules while making a move chosen before the table moved is logged at once, holds no seat back, and the bot searches again (#700)", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    const humans = await staleThriceThenMoved(t);

    t.refuseBot.push({ success: false, error: 'Cannot read properties of undefined.', category: 'bundle', errorCode: ErrorCode.ENGINE_ERROR });
    t.searches[3].release(moved); // chosen at v30, crashed at v40
    await untilSearches(t, 5);
    const logged = errors.mock.calls.map((call) => String(call[0]));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/REJECTED the move the bot chose for seat 2: Cannot read properties of undefined\. \(ENGINE_ERROR\)/);
    expect(logged[0]).toMatch(/searches again/);
    // Not held back at v40, a state the bot never searched: the next search still asks seat 2.
    expect(t.searches[4].from).toBe(40);
    expect(t.searches[4].asked).toEqual([2]);

    t.searches[4].release(moved);
    await finish(t, pump, ...humans);
    expect(t.botMoves).toEqual([40, 40]);
    errors.mockRestore();
  });

  it('a bot run whose move, made on a table that moved, throws is reported once, and the human moves stand (#700)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = table();
    await t.host.start();
    succeeded(await humanMove(t.host));
    const humans = await staleThriceThenMoved(t);

    // Rejects only once the host makes the move, as an executor that throws does.
    t.refuseBot.push({ then: (_resolve: unknown, reject: (e: Error) => void) => reject(new Error('The executor did not answer in time.')) });
    t.searches[3].release(moved);
    await Promise.all(humans);
    await t.host.settled();

    expect(t.botMoves).toEqual([50]);
    expect(t.backgroundErrors.map((e) => (e as Error).message)).toEqual(['The executor did not answer in time.']);
    expect(errors.mock.calls.filter((call) => String(call[0]).includes('did not answer'))).toHaveLength(1);
    expect((t.host.snapshot as unknown as Snap).v).toBe(50);
    errors.mockRestore();
  });

  it('each search asks the bot seats the table has when it begins, however long it waited for the section', async () => {
    const t = table();
    await t.host.start();
    const pump = t.host.runBotTurns();
    const humans: Promise<unknown>[] = [];
    for (let i = 0; i < 2; i++) {
      await untilSearches(t, i + 1);
      humans.push(humanMove(t.host));
      await settle();
      t.searches[i].release(moved);
    }
    await untilSearches(t, 3);

    // The third search goes stale behind a slow move, while more slow moves
    // queue for the section, so the next search waits its turn for it.
    humans.push(humanMove(t.host, 'slow'));
    await settle();
    t.searches[2].release(moved);
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
    t.searches[0].release(moved); // chosen on the old rules
    await untilSearches(t, 2);

    expect(t.searches[1].from).toBe(100);
    t.searches[1].release(moved);
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
    t.searches[0].release(nothingDue);
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
    t.searches[0].release(moved);
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

  it("on a real game: a human who commits and undoes during four searches in a row is answered each time, and the bot commits once, in that round (#700)", async () => {
    const t = await realTable(simultaneousRoundsFixtureDefinition, 2, [2]);
    const pump = t.host.runBotTurns();
    for (let i = 0; i < 4; i++) {
      await settle();
      expect(t.held).toHaveLength(1);
      const op: Op = i % 2 === 0
        ? { type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(t.host) }
        : { type: 'undo', player: 1 };
      succeeded(await answeredWhileSearching(t.host.handleOp(1, op)));
      t.held.shift()!();
    }
    await t.releaseAll(pump);

    // Seat 1's commit was undone; the bot's commit, chosen before that undo, was made in the same round.
    expect(await t.history()).toEqual([2]);
    expect(t.due.at(-1)).toEqual([1]);
    t.expectEveryChangeAdopted();
  });

  it("on a real game: a round that closes without the bot during its fourth search refuses the bot's move for it, and the bot commits in the next round (#700)", async () => {
    const t = await realTable(fixedDeployDefinition, 2, [2]);
    const pump = t.host.runBotTurns();
    const commit = (): SeatOp => ({ type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(t.host) });
    const ops: Array<[number, () => SeatOp]> = [
      [1, commit],
      [1, () => ({ type: 'undo', player: 1 })],
      [1, commit],
      // The platform closes the bot's seat at the deadline: round 1 ends without the bot's own move.
      [2, () => ({ type: 'expireSeat', player: 2, idleAction: 'commit', args: {}, boundaryKey: boundaryKeyOfHost(t.host) })],
    ];
    for (const [seat, op] of ops) {
      await settle();
      expect(t.held).toHaveLength(1);
      succeeded(await answeredWhileSearching(t.host.handleOp(seat, op())));
      t.held.shift()!();
    }
    await t.releaseAll(pump);

    // Round 1: seat 1's commit and seat 2's idle commit. The bot's round-1 move was refused; its round-2 move was made.
    expect(await t.history()).toEqual([1, 2, 2]);
    expect(t.due.at(-1)).toEqual([1]);
    t.expectEveryChangeAdopted();
  });
});

describe("a human's op resolves once it is made, not after the bot run it wakes (#698)", () => {
  it("a human's move that hands the turn to a bot resolves while the bot still searches", async () => {
    const t = table();
    await t.host.start();
    let resolved = false;
    const human = humanMove(t.host).then((res) => { resolved = true; return res; });
    await untilSearches(t, 1);

    expect(t.searches[0].released).toBe(false);
    expect(resolved).toBe(true);
    succeeded(await human);
    await finish(t, t.host.settled());
  });

  it('a second move made while the woken bot searches resolves at once too, and the bot moves from it', async () => {
    const t = table();
    await t.host.start();
    succeeded(await humanMove(t.host));
    await untilSearches(t, 1);

    // The table moves on while the bot thinks: that move is answered without waiting either.
    succeeded(await humanMove(t.host));
    expect(t.searches[0].released).toBe(false);
    expect((t.host.snapshot as unknown as Snap).v).toBe(20);

    t.searches[0].release(moved); // chosen at v10, which is gone
    await untilSearches(t, 2);
    expect(t.searches[1].from).toBe(20);
    t.searches[1].release(moved);
    await finish(t, t.host.settled());
    expect(t.botMoves).toEqual([20]);
    expect((t.host.snapshot as unknown as Snap).v).toBe(21);
  });

  it('a bot run that throws after a move is logged and handed to onBackgroundError, once; the move stands', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = table();
    await t.host.start();
    succeeded(await humanMove(t.host));
    await untilSearches(t, 1);
    // An executor call that throws (a timeout on a platform, say): the search rejects.
    t.searches[0].release(Promise.reject(new Error('The executor did not answer in time.')));

    await t.host.settled();
    expect(t.backgroundErrors.map((e) => (e as Error).message)).toEqual(['The executor did not answer in time.']);
    expect(String(errors.mock.calls.at(-1)?.[0])).toMatch(
      /the bot run after seat 1's action failed: The executor did not answer in time\./,
    );
    expect((t.host.snapshot as unknown as Snap).v).toBe(10);

    // The next move wakes the bots again.
    succeeded(await humanMove(t.host));
    await untilSearches(t, 2);
    t.searches[1].release(moved);
    await finish(t, t.host.settled());
    expect(t.botMoves).toEqual([20]);
    expect(t.backgroundErrors).toHaveLength(1);
    errors.mockRestore();
  });

  it('a bot run that several moves joined, and that throws, is reported once', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = table();
    await t.host.start();
    succeeded(await humanMove(t.host));
    await untilSearches(t, 1);
    succeeded(await humanMove(t.host));
    succeeded(await humanMove(t.host));
    t.searches[0].release(Promise.reject(new Error('The executor did not answer in time.')));

    await t.host.settled();
    expect(t.backgroundErrors).toHaveLength(1);
    expect(errors.mock.calls.filter((call) => String(call[0]).includes('did not answer'))).toHaveLength(1);
    errors.mockRestore();
  });

  it("a runBotTurns() that joins a move's bot run, which then throws, is the run's one report", async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = table();
    await t.host.start();
    succeeded(await humanMove(t.host));
    await untilSearches(t, 1);
    // A platform's own wake (an alarm, say) joins the run the move woke.
    const wake = t.host.runBotTurns();
    succeeded(await humanMove(t.host));
    t.searches[0].release(Promise.reject(new Error('The executor did not answer in time.')));

    await expect(wake).rejects.toThrow('The executor did not answer in time.');
    await t.host.settled();
    expect(t.backgroundErrors).toEqual([]);
    expect(errors.mock.calls.filter((call) => String(call[0]).includes('did not answer'))).toEqual([]);
    errors.mockRestore();
  });

  it('a run several moves joined that throws something other than an Error is reported once', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = table();
    await t.host.start();
    succeeded(await humanMove(t.host));
    await untilSearches(t, 1);
    succeeded(await humanMove(t.host));
    succeeded(await humanMove(t.host));
    t.searches[0].release(Promise.reject('executor gone'));

    await t.host.settled();
    expect(t.backgroundErrors).toEqual(['executor gone']);
    errors.mockRestore();
  });

  it('two runs that fail with the same error object are each reported', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const shared = new Error('The executor is unavailable.');
    const t = table();
    await t.host.start();
    for (let i = 0; i < 2; i++) {
      succeeded(await humanMove(t.host));
      await untilSearches(t, i + 1);
      t.searches[i].release(Promise.reject(shared));
      await t.host.settled();
    }
    expect(t.backgroundErrors).toEqual([shared, shared]);
    errors.mockRestore();
  });

  it('settled() waits for work that starts while it waits and outlives the work it began waiting for', async () => {
    const t = table();
    await t.host.start();
    // An undo wakes the bots and refreshes no heatmap: its work ends with the bot run.
    succeeded(await t.host.handleOp(1, { type: 'undo', player: 1 }));
    await untilSearches(t, 1);
    let settled = false;
    const waiting = t.host.settled().then(() => { settled = true; });

    // A move made now joins that run, then refreshes seat 1's heatmap, which outlives it.
    t.host.transientTeachingState.set(1, { heatmap: { visible: true, entries: [] } });
    succeeded(await humanMove(t.host));
    t.searches[0].release(nothingDue); // stale: the move landed during it
    await untilSearches(t, 2);
    t.searches[1].release(nothingDue);
    await settle();
    expect(t.heatmaps).toHaveLength(1);
    expect(settled).toBe(false);

    t.heatmaps[0].release();
    await waiting;
    expect(t.host.transientTeachingState.get(1)?.heatmap?.entries).toEqual([{ from: 20 }]);
  });

  it('a host disposed while the bot a move woke searches publishes nothing more, and settles', async () => {
    const t = table();
    await t.host.start();
    succeeded(await humanMove(t.host));
    await untilSearches(t, 1);
    const published = t.recorded.length;

    t.host.dispose();
    t.searches[0].release(moved);
    await t.host.settled();

    expect(t.recorded).toHaveLength(published);
    expect(t.botMoves).toEqual([]);
    expect(t.searches).toHaveLength(1);
  });

  it("on a real game: the human's commit is answered and pushed, and the bot's commit follows as a push of its own", async () => {
    const t = await realTable(simultaneousRoundsFixtureDefinition, 2, [2]);
    const human = await t.host.handleOp(1, {
      type: 'action', actionName: 'commit', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(t.host),
    });
    succeeded(human);
    await settle();
    expect(t.held).toHaveLength(1);
    const pushedBeforeBot = t.pushes.length;
    expect(pushedBeforeBot).toBeGreaterThan(0);

    await t.releaseAll(t.host.settled());
    // Round 1 has one commit from each seat; the bot goes on to commit in round 2.
    expect((await t.history()).slice(0, 2)).toEqual([1, 2]);
    const botPush = t.pushes[pushedBeforeBot];
    expect(botPush.cause).toBe('change');
    expect(botPush.seats).toContain(1);
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
    t.searches[0].release(moved);
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
    t.searches[0].release(moved);
    await first;

    expect(t.botMoves).toEqual([0]);
    expect(t.searches).toHaveLength(1);
    const logged = errors.mock.calls.map((call) => String(call[0]));

    // The game did not change, and a later wake (a resume, say) still moves the bot.
    const second = t.host.runBotTurns();
    await untilSearches(t, 2);
    t.searches[1].release(moved);
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
    t.searches[0].release(moved);
    await finish(t, pump);

    expect(t.botMoves).toEqual([]);
    expect((t.host.snapshot as unknown as Snap).v).toBe(0);
  });
});

describe('a hint or heatmap asked for while a move lands (#742)', () => {
  it('a hint computed on a position the game has left is refused, not stored', async () => {
    const t = table();
    t.setRoster([]);
    await t.host.start();
    const hint = t.host.handleOp(1, { type: 'hint', seat: 1 });
    await settle();
    expect(t.hints.map((h) => h.from)).toEqual([0]);
    succeeded(await humanMove(t.host));

    t.hints[0].release();
    const res = await hint;
    expect(res.success).toBe(false);
    expect(t.host.transientTeachingState.has(1)).toBe(false);
  });

  it('a heatmap turned on and computed on a position the game has left is refused, not stored', async () => {
    const t = table();
    t.setRoster([]);
    await t.host.start();
    const toggle = t.host.handleOp(1, { type: 'heatmapToggle', seat: 1, visible: true });
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([0]);
    succeeded(await humanMove(t.host));

    t.heatmaps[0].release();
    const res = await toggle;
    expect(res.success).toBe(false);
    expect(t.host.transientTeachingState.has(1)).toBe(false);
  });

  it('a heatmap turned off while a move lands is turned off: off does not depend on the position', async () => {
    const t = table();
    t.setRoster([]);
    await t.host.start();
    t.host.transientTeachingState.set(1, { heatmap: { visible: true, entries: [] } });
    t.holdHeatmapOff.on = true;
    const off = t.host.handleOp(1, { type: 'heatmapToggle', seat: 1, visible: false });
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([0]);
    const move = humanMove(t.host);
    await settle();
    expect((t.host.snapshot as unknown as Snap).v).toBe(10);
    // The move's own refresh of seat 1's heatmap, still visible then, is held too.
    expect(t.heatmaps.map((h) => h.from)).toEqual([0, 10]);

    t.heatmaps[0].release();
    succeeded(await off);
    t.heatmaps[1].release();
    await Promise.all([move, t.host.settled()]);
    expect(t.host.transientTeachingState.get(1)?.heatmap).toEqual({ visible: false, entries: [] });
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
    await Promise.all([first, ...more, t.host.settled()]);
    expect(t.host.transientTeachingState.get(1)?.heatmap?.entries).toEqual([{ from: 40 }]);
    expect(t.heatmaps).toHaveLength(2);
  });

  it('a heatmap compute that fails is logged and handed to onBackgroundError, the move stands, and the next move starts a new compute (#676, #698)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = table();
    t.setRoster([]);
    await t.host.start();
    t.host.transientTeachingState.set(1, { heatmap: { visible: true, entries: [] } });

    succeeded(await humanMove(t.host));
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([10]);
    t.heatmaps[0].fail(new Error('executor unavailable'));
    await t.host.settled();
    expect(t.backgroundErrors.map((e) => (e as Error).message)).toEqual(['executor unavailable']);
    expect(String(errors.mock.calls.at(-1)?.[0])).toMatch(/heatmap refresh after seat 1's action failed: executor unavailable\. That move was made/);
    expect((t.host.snapshot as unknown as Snap).v).toBe(10);

    succeeded(await humanMove(t.host));
    await settle();
    expect(t.heatmaps.map((h) => h.from)).toEqual([10, 20]);
    t.heatmaps[1].release();
    await t.host.settled();
    expect(t.host.transientTeachingState.get(1)?.heatmap?.entries).toEqual([{ from: 20 }]);
    errors.mockRestore();
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
    await Promise.all([move, t.host.settled()]);

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
    await Promise.all([move, t.host.settled()]);

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
  const pushes: Array<{ cause: string; seats: number[] }> = [];
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
    push: (changed, meta) => pushes.push({ cause: meta.cause, seats: changed.map((c) => c.seat) }),
    persist: (state) => { adopted.add(state.snapshot); },
  });
  host.setBotSeats(bots.map((seat) => ({ seat })));
  await host.start();
  return {
    host,
    held,
    due,
    /** Each push: why, and the seats it went to. */
    pushes,
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
