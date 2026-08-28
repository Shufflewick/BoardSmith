import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  actionStep,
  loop,
  type GameOptions,
} from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import {
  PERSIST_KEY,
  PersistenceStore,
  type PersistStartPayload,
} from '../../persistence/index.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';

/** What this file's one test client last rendered -- a browser echoes the
 *  boundary key of the state it is looking at, and so must a harness. */
const clients = createDevHostClientMemory();

/**
 * ShufflewickPub issue #41, items 2, 3 and 4: `boardsmith dev` gains a
 * persistence store, session kinds, and the `persistPrivate` strip.
 *
 * These cases drive the REAL host against the REAL engine and the REAL
 * validation core. Nothing here restates a rule: every refusal asserted below
 * is produced by `persistence.ts`, the module the platform's Durable Object
 * calls, reached through the store the dev host was given.
 */

/** Seat 1 takes one action, repeatedly, until the game declares itself over.
 *  Shared by both test games below so neither carries a flow of its own. */
function oneActionUntilFinished(action: string) {
  return defineFlow({
    root: loop({
      while: (ctx) => !ctx.game.isFinished(),
      maxIterations: 100,
      do: actionStep({ actions: [action], player: (ctx) => ctx.game.getPlayer(1)! }),
    }),
  });
}

/** A game that reads its store at start and writes to both channels at the end. */
class StoreGame extends Game<StoreGame, Player> {
  /** What the platform handed this session, echoed so a test can see it. */
  handed: PersistStartPayload | null = null;
  /** The PUBLIC commit channel (a reserved game-root attribute). */
  persist: unknown = undefined;
  /** The PRIVATE commit channel. */
  persistPrivate: unknown = undefined;

  constructor(options: GameOptions & { persist?: PersistStartPayload; write?: unknown }) {
    super(options);
    this.handed = options.persist ?? null;
    const write = options.write as
      | { persist?: unknown; persistPrivate?: unknown }
      | undefined;
    this.registerAction(
      Action.create('finish').execute(() => {
        if (write?.persist !== undefined) this.persist = write.persist;
        if (write?.persistPrivate !== undefined) this.persistPrivate = write.persistPrivate;
        this.finish([this.getPlayer(1)!]);
        return { success: true };
      }),
    );
    this.setFlow(oneActionUntilFinished('finish'));
  }
}

const def: GameDefinitionLike = {
  gameClass: StoreGame as unknown as new (...args: unknown[]) => unknown,
  gameType: 'store-game',
  minPlayers: 1,
  maxPlayers: 2,
};

/** One dev host, wired to a store, with whatever the game should write at the end. */
function makeHost(options: {
  store: PersistenceStore;
  write?: { persist?: unknown; persistPrivate?: unknown };
  sessionKind?: 'match' | 'orderEntry' | 'resolution';
  playerCount?: number;
}): { host: MultiplayerHost; sent: HostOutbound[]; startOptions: () => Record<string, unknown> } {
  const sent: HostOutbound[] = [];
  let startOptions: Record<string, unknown> = {};
  const host = new MultiplayerHost({
    playerCount: options.playerCount ?? 1,
    minPlayers: 1,
    maxPlayers: 2,
    makeSeed: () => 'persist-seed',
    sessionKind: options.sessionKind ?? 'match',
    persistence: {
      sessionKey: 'dev-session',
      gameVersion: 'dev',
      store: options.store,
      now: () => 1000,
    },
    baseGameOptions: { write: options.write },
    // harness shape, shared verbatim with the sibling multiplayer-host suites.
    // fallow-ignore-next-line code-duplication
    executeOp: (gameOptions, snap, pend, op, hostOptions) => {
      if (op.type === 'start') startOptions = gameOptions;
      return executeOp(def, gameOptions, snap, pend, op, hostOptions);
    },
    send: (clientId, msg) => {
      sent.push(msg);
      clients.remember(clientId, msg as { type: string; view?: unknown });
    },
  });
  return { host, sent, startOptions: () => startOptions };
}

/** The error the finishing op was refused with, or undefined if it succeeded. */
function refusalFrom(replies: HostOutbound[]): string | undefined {
  const response = replies.find((m) => m.type === 'server_response');
  const result = (response as { result: Record<string, unknown> } | undefined)?.result;
  return result?.error === undefined ? undefined : String(result.error);
}

/** Play the one action that ends the game, and hand back the host's replies. */
async function playToEnd(host: MultiplayerHost, sent: HostOutbound[]): Promise<HostOutbound[]> {
  const before = sent.length;
  await host.handleMessage('A', {
    type: 'server_request',
    requestId: 'r1',
    op: 'action',
    payload: { actionName: 'finish', args: {}, boundaryKey: clients.key('A') },
  });
  return sent.slice(before);
}

beforeEach(() => clients.reset());

describe('boardsmith dev — the persistence store (#41 item 2)', () => {
  it('injects an EMPTY store at start when the game has never written', async () => {
    const store = new PersistenceStore();
    const { host, startOptions } = makeHost({ store });
    await host.handleMessage('A', { type: 'hello' });

    const payload = startOptions()[PERSIST_KEY] as PersistStartPayload;
    expect(payload.entries).toEqual([]);
    expect(payload.sessionKey).toBe('dev-session');
  });

  it('hands the NEXT session what the last one committed', async () => {
    const store = new PersistenceStore();
    const first = makeHost({
      store,
      write: { persist: { entries: [{ key: 'hall-of-fame', value: { wins: 1 } }] } },
    });
    await first.host.handleMessage('A', { type: 'hello' });
    await playToEnd(first.host, first.sent);

    const second = makeHost({ store });
    await second.host.handleMessage('A', { type: 'hello' });
    const payload = second.startOptions()[PERSIST_KEY] as PersistStartPayload;
    expect(payload.entries).toEqual([
      { key: 'hall-of-fame', value: { wins: 1 }, gameVersion: 'dev', writtenAt: 1000 },
    ]);
  });

  it('REFUSES the finishing op when the commit is malformed, exactly as production does', async () => {
    const store = new PersistenceStore();
    const { host, sent } = makeHost({
      store,
      // `value` missing is the shape error `persistence.ts` names by index.
      write: { persist: { entries: [{ key: 'broken' }] } },
    });
    await host.handleMessage('A', { type: 'hello' });
    const replies = await playToEnd(host, sent);

    expect(refusalFrom(replies)).toContain('persist.entries[0].value is missing');
    // Nothing was written: a refused commit is all-or-nothing.
    expect(store.toState().rows).toEqual([]);
  });

  it('REFUSES a commit over the wire ceiling using the platform constant, not a local one', async () => {
    const store = new PersistenceStore();
    const { host, sent } = makeHost({
      store,
      write: { persist: { entries: [{ key: 'huge', value: 'x'.repeat(3 * 1024 * 1024) }] } },
    });
    await host.handleMessage('A', { type: 'hello' });
    const replies = await playToEnd(host, sent);

    expect(refusalFrom(replies)).toContain('wire ceiling');
    expect(store.toState().rows).toEqual([]);
  });
});

describe('boardsmith dev — the persistPrivate strip (#41 item 4)', () => {
  it('never broadcasts the private attribute, and still commits it', async () => {
    const store = new PersistenceStore();
    const { host, sent } = makeHost({
      store,
      write: {
        persistPrivate: { entries: [{ key: 'sealed-scenario', value: { act: 2 } }] },
      },
    });
    await host.handleMessage('A', { type: 'hello' });
    const replies = await playToEnd(host, sent);

    const frames = replies.filter((m) => m.type === 'game_state');
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(JSON.stringify(frame)).not.toContain('sealed-scenario');
    }
    expect(store.toState().rows.map((r) => r.key)).toEqual(['sealed-scenario']);
  });

  // The two ways a sealed row can be written illegally. Both refuse the
  // finishing op and leave the store byte-identical, and they are stated as one
  // table because "refused, and nothing written" is the single guarantee.
  it.each([
    {
      what: 'a sealed key on the PUBLIC channel, which broadcasts what it carries',
      write: { persist: { entries: [{ key: 'player:dev-player-1/sheet', value: { hp: 3 } }] } },
      because: 'broadcast to every spectator',
    },
    {
      what: 'a sealed key belonging to a player this session does not seat',
      write: {
        persistPrivate: { entries: [{ key: 'player:somebody-else/sheet', value: { hp: 3 } }] },
      },
      because: 'does not act',
    },
  ])('REFUSES $what', async ({ write, because }) => {
    const store = new PersistenceStore();
    const { host, sent } = makeHost({ store, write });
    await host.handleMessage('A', { type: 'hello' });
    const replies = await playToEnd(host, sent);

    expect(refusalFrom(replies)).toContain(because);
    expect(store.toState().rows).toEqual([]);
  });

  it('accepts a sealed key on the PRIVATE channel for a player this session seats', async () => {
    const store = new PersistenceStore();
    const { host, sent } = makeHost({
      store,
      write: {
        persistPrivate: { entries: [{ key: 'player:dev-player-1/sheet', value: { hp: 3 } }] },
      },
    });
    await host.handleMessage('A', { type: 'hello' });
    await playToEnd(host, sent);
    expect(store.toState().rows.map((r) => r.key)).toEqual(['player:dev-player-1/sheet']);
  });

});

describe('boardsmith dev — session kinds (#41 item 3)', () => {
  it('seats nobody in a resolution, so no client can play the resolver', async () => {
    const store = new PersistenceStore();
    const { host, sent } = makeHost({ store, sessionKind: 'resolution' });
    await host.handleMessage('A', { type: 'hello' });

    const lobby = sent.find((m) => m.type === 'lobby') as
      | { seats: Array<{ clientId: string | null }> }
      | undefined;
    expect(lobby?.seats.every((s) => s.clientId === null)).toBe(true);
  });

  it('routes an orderEntry commit to the round ORDERS, not to the store', async () => {
    const store = new PersistenceStore();
    const { host, sent } = makeHost({
      store,
      sessionKind: 'orderEntry',
      write: { persistPrivate: { entries: [{ key: 'orders', value: { move: 'north' } }] } },
    });
    await host.handleMessage('A', { type: 'hello' });
    await playToEnd(host, sent);

    const state = store.toState();
    expect(state.rows).toEqual([]);
    expect(state.orders.map((o) => ({ token: o.playerToken, key: o.key }))).toEqual([
      { token: 'dev-player-1', key: 'orders' },
    ]);
  });

  it('hands a RESOLUTION every sealed row, because it acts for the whole world', async () => {
    const store = new PersistenceStore();
    store.commit({
      kind: 'match',
      players: [{ seat: 1, playerId: 'someone' }],
      spectatorView: null,
      persistPrivate: { entries: [{ key: 'player:someone/sheet', value: { hp: 9 } }] },
      gameVersion: 'dev',
      now: () => 1,
    });

    const { host, startOptions } = makeHost({ store, sessionKind: 'resolution' });
    await host.handleMessage('A', { type: 'hello' });
    const payload = startOptions()[PERSIST_KEY] as PersistStartPayload;
    expect(payload.entries.map((e) => e.key)).toEqual(['player:someone/sheet']);
  });
});

/**
 * THE THING #41 SAYS IS IMPOSSIBLE TODAY: run a resolver once, locally, before
 * the game has ever been published.
 *
 * A world round is not a sitting. It reads the store, advances the world and
 * writes it back, on a seat no human holds -- so with no local store and no
 * seatless session kind there was nothing to run it against. This drives the
 * whole path: orders submitted by an order-entry session, a resolution session
 * started with nobody in it, the resolver handed those orders and the roster
 * under the reserved argument keys, and the world's new state committed.
 */
class WorldGame extends Game<WorldGame, Player> {
  persist: unknown = undefined;

  constructor(options: GameOptions & { persist?: PersistStartPayload }) {
    super(options);
    const handed = options.persist ?? null;
    this.registerAction(
      Action.create('resolve').execute((args: Record<string, unknown>) => {
        const round =
          (handed?.entries.find((e) => e.key === 'round')?.value as number | undefined) ?? 0;
        // The world's new state, plus what the PLATFORM handed this round --
        // written through the store so the test asserts what the resolver
        // actually received rather than reaching inside the game object.
        this.persist = {
          entries: [
            { key: 'round', value: round + 1 },
            { key: 'orders-seen', value: args.worldOrders },
            { key: 'roster-seen', value: args.worldRoster },
          ],
        };
        this.finish([this.getPlayer(1)!]);
        return { success: true };
      }),
    );
    this.setFlow(oneActionUntilFinished('resolve'));
  }
}

const worldDef: GameDefinitionLike = {
  gameClass: WorldGame as unknown as new (...args: unknown[]) => unknown,
  gameType: 'world-game',
  minPlayers: 1,
  maxPlayers: 1,
};

describe('boardsmith dev — a resolver runs once, before first publish (#41)', () => {
  it('resolves a round against the store and the round it was handed', async () => {
    const store = new PersistenceStore();
    store.enrol({ playerId: 'dev-player-1', displayName: 'Player 1' });
    store.commit({
      kind: 'orderEntry',
      players: [{ seat: 1, playerId: 'dev-player-1' }],
      spectatorView: null,
      persistPrivate: { entries: [{ key: 'orders', value: { move: 'north' } }] },
      gameVersion: 'dev',
      now: () => 5,
    });

    const host = new MultiplayerHost({
      playerCount: 1,
      minPlayers: 1,
      maxPlayers: 1,
      makeSeed: () => 'world-seed',
      sessionKind: 'resolution',
      persistence: { sessionKey: 'dev-round-1', gameVersion: 'dev', store, now: () => 7 },
      executeOp: (gameOptions, snap, pend, op, hostOptions) =>
        executeOp(worldDef, gameOptions, snap, pend, op, hostOptions),
      send: () => {},
    });

    // The CLI standing in for the platform's alarm: a resolution seats nobody,
    // so nothing else would ever start it.
    await host.hello('boardsmith-dev-resolver');
    const outcome = await host.resolveRound({ name: 'resolve' });

    expect(outcome).toEqual({ ok: true, complete: true });
    // The world advanced, and its new state is what the NEXT round will read.
    const rows = Object.fromEntries(store.toState().rows.map((r) => [r.key, JSON.parse(r.value)]));
    expect(rows.round).toBe(1);
    // The round's orders reached the resolver, attributed by the PLATFORM: the
    // game never says whose orders these are or which round they belong to.
    expect(rows['orders-seen']).toEqual([
      {
        playerToken: 'dev-player-1',
        key: 'orders',
        value: { move: 'north' },
        gameVersion: 'dev',
        submittedAt: 5,
      },
    ]);
    // ...and so did the roster, which is enrolment -- a fact a game cannot
    // observe and so cannot derive from the orders.
    expect(rows['roster-seen']).toEqual([
      { playerId: 'dev-player-1', displayName: 'Player 1' },
    ]);
    // The round's orders were consumed by the resolution that committed them,
    // so the next round cannot resolve against them a second time.
    expect(store.toState().orders).toEqual([]);
  });

  it('refuses to resolve from a session that is not a resolution', async () => {
    const store = new PersistenceStore();
    const host = new MultiplayerHost({
      playerCount: 1,
      minPlayers: 1,
      maxPlayers: 1,
      makeSeed: () => 'world-seed',
      persistence: { sessionKey: 'dev-match', gameVersion: 'dev', store },
      executeOp: (gameOptions, snap, pend, op, hostOptions) =>
        executeOp(worldDef, gameOptions, snap, pend, op, hostOptions),
      send: () => {},
    });
    await host.hello('A');
    expect(await host.resolveRound({ name: 'resolve' })).toEqual({
      ok: false,
      reason:
        'this host is running a match session; a round is resolved by a session started with --kind resolution',
    });
  });
});
