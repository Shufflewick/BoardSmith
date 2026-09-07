import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useWorldHost } from './useWorldHost.js';
import { createOrderBook, type OrderBook, type OrderStorage } from './orderBook.js';
import {
  WORLD_HOST_SOURCE,
  WORLD_NARRATION_KEPT,
  WORLD_UI_SOURCE,
  type WorldHostMessage,
} from './worldProtocol.js';

/**
 * The state frame, reached through the union rather than by name.
 *
 * `worldProtocol.ts` deliberately exports only `WorldHostMessage`: a reader of
 * this protocol handles one union with one switch, and exported names nothing
 * imports are things a future change can leave behind. A test is a reader like
 * any other, so it narrows rather than asking for a second export.
 */
type WorldStateMessage = Extract<WorldHostMessage, { type: 'world_state' }>;

/**
 * THE BUNDLE SIDE OF THE WORLD WIRE (ShufflewickPub #128).
 *
 * Every one of these is a thing that only shows up in an iframe, which is
 * exactly why they are tested here rather than by mounting a shell: a request
 * that times out, an answer that arrives for a request nobody is waiting on,
 * and a frame from an origin the host never named.
 */

const HOST_ORIGIN = 'https://shufflewick.pub';

function stateFrame(over: Partial<WorldStateMessage> = {}): WorldStateMessage {
  return {
    source: WORLD_HOST_SOURCE,
    type: 'world_state',
    phase: 'watching',
    view: { player: 3, state: { id: 0, className: 'Game' } },
    seat: 3,
    actions: [{ name: 'look', prompt: 'Look around', selections: [] }],
    notice: null,
    worldName: 'Gloamhall Rooms',
    presence: [3, 5],
    ...over,
  };
}

/** A browser's storage, as a Map. */
function memoryStorage(): OrderStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
}

function deliver(host: ReturnType<typeof useWorldHost>, data: unknown, origin = HOST_ORIGIN) {
  host.handleMessage({ origin, data } as MessageEvent);
}

describe('useWorldHost', () => {
  let posted: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(trustedOrigins?: string[], orders?: OrderBook) {
    return useWorldHost({
      post: (message) => posted.push(message),
      trustedOrigins,
      // A book per host unless a case is ABOUT what the last page left behind:
      // the shipped one is the browser's own storage, which two tests in one
      // jsdom would share.
      orders: orders ?? createOrderBook({ storage: memoryStorage() }),
    });
  }

  it('starts knowing nothing, so a UI cannot mistake silence for an empty world', () => {
    const host = make();
    expect(host.phase.value).toBe('attaching');
    expect(host.view.value).toBeNull();
    expect(host.seat.value).toBeNull();
    expect(host.actions.value).toEqual([]);
    expect(host.presence.value).toBeNull();
    expect(host.heardFromHost.value).toBe(false);
  });

  it('announces itself so the host sends what it is already holding', () => {
    const host = make();
    host.start();
    expect(posted).toEqual([{ source: WORLD_UI_SOURCE, type: 'world_ready' }]);
    host.stop();
  });

  it('takes a state frame whole', () => {
    const host = make();
    deliver(host, stateFrame());
    expect(host.phase.value).toBe('watching');
    expect(host.seat.value).toBe(3);
    expect(host.actions.value).toHaveLength(1);
    expect(host.worldName.value).toBe('Gloamhall Rooms');
    expect(host.presence.value).toEqual([3, 5]);
    expect(host.heardFromHost.value).toBe(true);
  });

  it('lets the host withdraw the presence claim, because "online now" has no last-known value', () => {
    // The platform nulls its own presence ref the moment the socket closes: a
    // kept view is a true picture of a world that existed, but a kept
    // who-is-online list is an active lie. The wire carries that null through
    // rather than flattening it into "nobody is here", which would be a claim.
    const host = make();
    deliver(host, stateFrame());
    expect(host.presence.value).toEqual([3, 5]);
    deliver(host, stateFrame({ phase: 'lost', presence: null }));
    expect(host.presence.value).toBeNull();
  });

  it('drops a frame from an origin the host never named', () => {
    const host = make([HOST_ORIGIN]);
    deliver(host, stateFrame(), 'https://evil.example.com');
    expect(host.heardFromHost.value).toBe(false);
  });

  it('drops a frame that is not the host protocol', () => {
    const host = make();
    deliver(host, { source: 'shufflewick', type: 'game_state', view: {} });
    expect(host.heardFromHost.value).toBe(false);
  });

  it('sends a command and resolves it with its own answer', async () => {
    const host = make();
    const answered = host.act('say', { text: 'hello' });
    const sent = posted[0] as { requestId: string; action: string; args: unknown; source: string };
    expect(sent.source).toBe(WORLD_UI_SOURCE);
    expect(sent.action).toBe('say');
    expect(sent.args).toEqual({ text: 'hello' });
    expect(host.acting.value).toBe(true);

    deliver(host, {
      source: WORLD_HOST_SOURCE,
      type: 'world_response',
      requestId: sent.requestId,
      ok: true,
    });
    await expect(answered).resolves.toEqual({ ok: true, message: undefined });
    expect(host.acting.value).toBe(false);
  });

  it('resolves a refusal rather than throwing it', async () => {
    const host = make();
    const answered = host.act('move', { to: 'cellar' });
    const sent = posted[0] as { requestId: string };
    deliver(host, {
      source: WORLD_HOST_SOURCE,
      type: 'world_response',
      requestId: sent.requestId,
      ok: false,
      message: 'There is no door that way.',
    });
    await expect(answered).resolves.toEqual({ ok: false, message: 'There is no door that way.' });
  });

  it('answers two commands in flight by name, in either order', async () => {
    const host = make();
    const first = host.act('look', {});
    const second = host.act('say', { text: 'oi' });
    const ids = (posted as { requestId: string }[]).map((m) => m.requestId);
    expect(new Set(ids).size).toBe(2);

    deliver(host, { source: WORLD_HOST_SOURCE, type: 'world_response', requestId: ids[1], ok: true });
    await expect(second).resolves.toEqual({ ok: true, message: undefined });
    expect(host.acting.value).toBe(true);

    deliver(host, { source: WORLD_HOST_SOURCE, type: 'world_response', requestId: ids[0], ok: false, message: 'no' });
    await expect(first).resolves.toEqual({ ok: false, message: 'no' });
    expect(host.acting.value).toBe(false);
  });

  it('fails a command the host never answers, rather than spinning forever', async () => {
    const host = make();
    const answered = host.act('look', {});
    vi.advanceTimersByTime(20_000);
    const outcome = await answered;
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/look/);
  });

  it('ignores an answer to a request nobody is waiting on', () => {
    const host = make();
    expect(() =>
      deliver(host, { source: WORLD_HOST_SOURCE, type: 'world_response', requestId: 'nope', ok: true }),
    ).not.toThrow();
  });

  it('tells everything outstanding that no answer is coming when it stops', async () => {
    const host = make();
    host.start();
    const answered = host.act('look', {});
    host.stop();
    const outcome = await answered;
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBeTruthy();
  });

  it('reports the host as silent once the hello window has passed', () => {
    const host = make();
    host.start();
    expect(host.hostSilent.value).toBe(false);
    vi.advanceTimersByTime(20_000);
    expect(host.hostSilent.value).toBe(true);
    host.stop();
  });

  it('a state frame ends the silence, whenever it arrives', () => {
    const host = make();
    host.start();
    vi.advanceTimersByTime(20_000);
    deliver(host, stateFrame());
    expect(host.hostSilent.value).toBe(false);
    host.stop();
  });
});

/**
 * ShufflewickPub #331: A WORLD'S NARRATION, WHICH HAD NO CHANNEL AT ALL.
 *
 * The platform routes every event to the seats that can see it and puts them
 * on the wire; the host page used to answer that frame with a view request and
 * drop the payloads, and this protocol had no message for one. So anything a
 * world narrates that leaves no residue in its tree -- an emote, combat text,
 * a line somebody said -- reached no screen by any route, and a game wanting
 * one had to write it into its own state and pay to store it.
 *
 * A LOG AND NOT A DELIVERY, here. The host page holds one delivery at a time
 * because it draws nothing; this side is what a UI renders from, so keeping
 * the lines is the thing that saves every world UI from writing the same
 * bounded array.
 */
describe('useWorldHost — the world narrating (#331)', () => {
  let posted: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make() {
    return useWorldHost({ post: (message) => posted.push(message) });
  }

  function narrate(host: ReturnType<typeof useWorldHost>, events: unknown[]) {
    deliver(host, { source: WORLD_HOST_SOURCE, type: 'world_events', events });
  }

  it('starts with nothing narrated', () => {
    expect(make().events.value).toEqual([]);
  });

  it('keeps what the host delivered, in order', () => {
    const host = make();
    narrate(host, [
      { scope: 'room:hall', payload: { said: 'hello', by: 2 } },
      { scope: 'world', payload: { dawn: true } },
    ]);
    expect(host.events.value).toEqual([
      { scope: 'room:hall', payload: { said: 'hello', by: 2 } },
      { scope: 'world', payload: { dawn: true } },
    ]);
  });

  it('APPENDS across deliveries, because a world narrates one thing at a time', () => {
    const host = make();
    narrate(host, [{ scope: 'world', payload: { n: 1 } }]);
    narrate(host, [{ scope: 'world', payload: { n: 2 } }]);
    expect(host.events.value.map((event) => event.payload)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('bounds the log, dropping the oldest', () => {
    // A world runs for months. An unbounded log inside a frame that is open all
    // day is a leak with a game's name on it, and the newest lines are the ones
    // a scrolling surface is showing.
    const host = make();
    for (let n = 0; n < WORLD_NARRATION_KEPT + 10; n += 1) {
      narrate(host, [{ scope: 'world', payload: { n } }]);
    }
    expect(host.events.value).toHaveLength(WORLD_NARRATION_KEPT);
    expect(host.events.value[0]!.payload).toEqual({ n: 10 });
    expect(host.events.value[WORLD_NARRATION_KEPT - 1]!.payload).toEqual({
      n: WORLD_NARRATION_KEPT + 9,
    });
  });

  it('does not treat narration as having heard from the host about STATE', () => {
    // `heardFromHost` is what tells a UI it has been told what the world IS.
    // Narration says something happened and carries no view, no seat and no
    // actions, so a frame of it must not silence the "nobody has spoken to
    // this frame" warning -- which would replace an accurate complaint with a
    // blank board.
    const host = make();
    narrate(host, [{ scope: 'world', payload: { dawn: true } }]);
    expect(host.heardFromHost.value).toBe(false);
    expect(host.view.value).toBeNull();
  });

  it('drops narration from an origin the host never named', () => {
    const host = useWorldHost({
      post: (message) => posted.push(message),
      trustedOrigins: [HOST_ORIGIN],
    });
    deliver(
      host,
      { source: WORLD_HOST_SOURCE, type: 'world_events', events: [{ scope: 'world', payload: {} }] },
      'https://evil.example.com',
    );
    expect(host.events.value).toEqual([]);
  });
});

/**
 * WHO THE SEATS ARE (#170 §2.2).
 *
 * The shared shell draws a seat row per player and a row needs a name. A world
 * has no lobby, so the wire carries a seat number and the host -- the thing that
 * owns accounts -- composes the names. BoardSmith derives none.
 */
describe('the host names the seats, or nobody does', () => {
  it('takes the roster the host composed', () => {
    const host = useWorldHost({ post: () => {} });
    deliver(host, stateFrame({
      players: [{ seat: 2, name: 'Rook' }, { seat: 4, name: 'Ivy', color: '#0f0' }],
    }));
    expect(host.players.value).toEqual([
      { seat: 2, name: 'Rook' },
      { seat: 4, name: 'Ivy', color: '#0f0' },
    ]);
  });

  it('holds nobody when the host sent nothing, rather than inventing seats', () => {
    const host = useWorldHost({ post: () => {} });
    deliver(host, stateFrame());
    expect(host.players.value).toEqual([]);
  });
});

/**
 * THE SENTENCE, WHEN THE GAME WROTE ONE (#170 §2.4).
 *
 * `payload` stays uninterpretable all the way here. `text` is the game's own
 * line for the shared log, and it rides on the narration it belongs to.
 */
describe('narration can carry a sentence', () => {
  it('keeps text and type verbatim beside the payload', () => {
    const host = useWorldHost({ post: () => {} });
    deliver(host, {
      source: WORLD_HOST_SOURCE,
      type: 'world_events',
      events: [{ scope: 'room:cellar', payload: { kind: 'fire' }, text: 'The fire gutters.', type: 'ambient' }],
    });
    expect(host.events.value[0]).toEqual({
      scope: 'room:cellar',
      payload: { kind: 'fire' },
      text: 'The fire gutters.',
      type: 'ambient',
    });
  });
});

/**
 * #195: THE PAGE'S HALF OF AN ORDER THAT SURVIVES A LOST REPLY.
 *
 * The host's half -- answer a repeat from the order's receipt -- is asserted in
 * `cli/dev-host/world-host.test.ts` against a real store. This is what the page
 * has to do for that to be reachable: name every order durably, keep the ones
 * it heard no answer to, and ask about them again the moment the world is
 * listening. Nothing here asks the player anything.
 */
describe('useWorldHost — an order that outlives the page (#195)', () => {
  let posted: any[];
  let storage: OrderStorage;

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    storage = memoryStorage();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A page. A SECOND call is the same browser after a reload: same storage,
   *  new everything else. */
  function page() {
    return useWorldHost({
      post: (message) => posted.push(message),
      orders: createOrderBook({ storage, key: BOOK_KEY }),
    });
  }

  const BOOK_KEY = 'orders';
  const commands = () => posted.filter((message) => message.type === 'world_command');

  function answer(host: ReturnType<typeof useWorldHost>, over: Record<string, unknown> = {}) {
    const command = commands()[commands().length - 1];
    deliver(host, {
      source: WORLD_HOST_SOURCE,
      type: 'world_response',
      requestId: command.requestId,
      ok: true,
      ...over,
    });
  }

  it('names every command with a durable order id, written down before it is sent', () => {
    const host = page();
    void host.act('found', { name: 'Ceres' });
    const [command] = commands();
    expect(typeof command.order.id).toBe('string');
    expect(command.order.id.length).toBeGreaterThan(0);
    expect(typeof command.order.at).toBe('number');
    // In the book before the answer, because that is the window it exists for.
    expect(JSON.parse(storage.getItem(BOOK_KEY) ?? '[]')).toHaveLength(1);
  });

  it('forgets an order the world answered, taken or refused', async () => {
    const host = page();
    const taken = host.act('found', {});
    answer(host);
    await taken;
    const refused = host.act('build', {});
    answer(host, { ok: false, message: 'Your holding is bare.' });
    await refused;

    // A NEW PAGE OVER THE SAME STORAGE has nothing to ask about.
    const reloaded = page();
    reloaded.start();
    deliver(reloaded, stateFrame());
    expect(commands()).toHaveLength(2);
  });

  it('keeps an order the world never answered, and asks about it again after a reload', async () => {
    const host = page();
    const uncertain = host.act('found', { name: 'Ceres' });
    const sent = commands()[0];
    // Silence: the reply was lost. The command times out with nobody to hear.
    vi.advanceTimersByTime(60_000);
    expect((await uncertain).ok).toBe(false);

    const reloaded = page();
    reloaded.start();
    deliver(reloaded, stateFrame());
    await vi.advanceTimersByTimeAsync(0);

    const retry = commands()[commands().length - 1];
    expect(retry.order).toEqual(sent.order);
    expect(retry.action).toBe('found');
    // AND THE PLAYER CHOSE NOTHING AGAIN: the arguments came out of the book.
    expect(retry.args).toEqual({ name: 'Ceres' });
    expect(reloaded.recovering.value).toBe(true);
  });

  /**
   * A page that sent an order and heard nothing, then reloaded. Every case
   * below starts here; what they differ about is what the world says next.
   */
  async function reloadedHoldingAnOrder() {
    page().act('found', {});
    vi.advanceTimersByTime(60_000);
    const before = commands().length;
    const reloaded = page();
    reloaded.start();
    deliver(reloaded, stateFrame());
    await vi.advanceTimersByTimeAsync(0);
    return { reloaded, before };
  }

  it('says what became of a recovered order, and stops recovering', async () => {
    const { reloaded } = await reloadedHoldingAnOrder();
    answer(reloaded, { ok: true, replayed: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(reloaded.recovering.value).toBe(false);
    expect(reloaded.recoveryNotice.value).toContain('had already gone through');
  });

  it('asks once, not on every frame the world sends', async () => {
    const { reloaded, before } = await reloadedHoldingAnOrder();
    deliver(reloaded, stateFrame());
    deliver(reloaded, stateFrame());
    await vi.advanceTimersByTimeAsync(0);
    expect(commands().length).toBe(before + 1);
  });

  it('waits for a seat: a command needs one, so an unseated frame recovers nothing', async () => {
    page().act('found', {});
    vi.advanceTimersByTime(60_000);
    const before = commands().length;

    const reloaded = page();
    reloaded.start();
    deliver(reloaded, stateFrame({ phase: 'attaching', seat: null }));
    await vi.advanceTimersByTimeAsync(0);
    expect(commands().length).toBe(before);

    deliver(reloaded, stateFrame());
    await vi.advanceTimersByTimeAsync(0);
    expect(commands().length).toBe(before + 1);
  });

  it('gives up on an order nothing can answer, rather than asking forever', async () => {
    const { reloaded } = await reloadedHoldingAnOrder();
    answer(reloaded, {
      ok: false,
      code: 'order-outcome-unknown',
      message: 'This world can no longer say whether that order went through.',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(reloaded.recoveryNotice.value).toContain('can no longer say');

    // A third page asks about nothing: the question has been answered, even
    // though the answer is "nobody knows".
    const third = page();
    const before = commands().length;
    third.start();
    deliver(third, stateFrame());
    await vi.advanceTimersByTimeAsync(0);
    expect(commands().length).toBe(before);
  });

  it('reports a browser that cannot keep a book, rather than implying recovery it cannot do', () => {
    const blind = useWorldHost({ post: () => {}, orders: createOrderBook({ storage: null }) });
    expect(blind.ordersDurable).toBe(false);
    expect(page().ordersDurable).toBe(true);
  });
});
