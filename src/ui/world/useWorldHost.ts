import { ref, shallowRef, type Ref, type ShallowRef } from 'vue';
import { isOriginAllowed } from '../components/GameShellInit.js';
import { createOrderBook, type OrderBook, type PendingOrder } from './orderBook.js';
import {
  WORLD_COMMAND_TIMEOUT_MS,
  WORLD_HELLO_TIMEOUT_MS,
  WORLD_HOST_SOURCE,
  WORLD_NARRATION_KEPT,
  WORLD_UI_SOURCE,
  type WorldActionOutcome,
  type WorldPickOutcome,
  type WorldActionOffer,
  type WorldHostMessage,
  type WorldNarration,
  type WorldPhase,
  type WorldPlayer,
  type WorldUiMessage,
} from './worldProtocol.js';

export interface WorldHostOptions {
  /** Where a message goes. Defaults to the parent frame. */
  post?: (message: WorldUiMessage) => void;
  /** Origins allowed to talk to this frame. Empty or unset means any, which is
   *  what `boardsmith dev` needs and what a deployed host overrides. */
  trustedOrigins?: string[];
  /** Overridable for tests; the shipped windows live in `worldProtocol.ts`. */
  helloTimeoutMs?: number;
  commandTimeoutMs?: number;
  /**
   * WHERE THIS PAGE WRITES DOWN THE ORDERS IT HAS NOT HEARD BACK ABOUT (#195).
   *
   * Defaults to a book over the browser's own storage. Injectable for the
   * reason the transport is: recovery across a reload is the behaviour, and a
   * test proves it by handing the same book to a second host.
   */
  orders?: OrderBook;
}

export interface WorldHost {
  phase: Ref<WorldPhase>;
  view: ShallowRef<unknown>;
  seat: Ref<number | null>;
  /**
   * What this seat may do, enumerated by the world over what it can see.
   *
   * `shallowRef` for the reason `view` is one: an offer carries every
   * selection's candidates resolved (#169), so a deep `ref` would install
   * proxies over every candidate of every action on every state push -- a
   * per-frame cost proportional to what the seat may do. It is only ever
   * REPLACED, never mutated in place.
   */
  actions: ShallowRef<readonly WorldActionOffer[]>;
  notice: Ref<string | null>;
  worldName: Ref<string | null>;
  /** Who holds an open connection right now, or `null` when the host has no
   *  live claim. The contract, in full, is on `world_state` in
   *  `worldProtocol.ts`; this is that field, copied and nothing more. */
  presence: Ref<readonly number[] | null>;
  /**
   * WHO THE SEATS ARE, as the host composed them, or empty when it sent
   * nothing. The shell renders seat numbers without it and never derives a name
   * of its own -- the reasoning is on `WorldPlayer` in `worldProtocol.ts`.
   */
  players: ShallowRef<readonly WorldPlayer[]>;
  /**
   * WHAT THE WORLD HAS NARRATED TO THIS SEAT, oldest first
   * (ShufflewickPub #331).
   *
   * The log a world UI renders as lines that scroll past. It APPENDS -- every
   * `world_events` message is news that has not been sent before -- and is
   * bounded at `WORLD_NARRATION_KEPT`, dropping the oldest.
   *
   * IT IS NOT A HISTORY. It starts empty on every mount, holds only what
   * arrived while this frame was listening, and is gone on reload. A game that
   * wants a newcomer to hear what was said before they arrived keeps that in
   * its own state, where it is durable and where the game decides what it
   * costs.
   */
  events: ShallowRef<readonly WorldNarration[]>;
  /** True once the host has sent one frame this UI understood. */
  heardFromHost: Ref<boolean>;
  /** True when the hello window passed with nothing from the host at all. */
  hostSilent: Ref<boolean>;
  /** True while at least one command of this player's is unanswered. */
  acting: Ref<boolean>;
  /**
   * TRUE WHILE THIS PAGE IS ASKING ABOUT AN ORDER IT DID NOT HEAR AN ANSWER TO
   * (#195).
   *
   * A page that reloads mid-order re-sends it, with the same identity, as soon
   * as it is attached and seated. The world answers a committed one from its
   * receipt without running anything again.
   */
  recovering: Ref<boolean>;
  /** What became of a recovered order, in a sentence for the player, or `null`
   *  when there was nothing to recover. */
  recoveryNotice: Ref<string | null>;
  /** Whether an order sent by this page could be recovered after a reload at
   *  all. False in a browser that refuses storage, and the shell says so rather
   *  than implying a safety net that is not there. */
  ordersDurable: boolean;
  act(command: string, args?: Record<string, unknown>): Promise<WorldActionOutcome>;
  /**
   * RE-ASK ONE PICK with the arguments bound so far (ShufflewickPub #378).
   *
   * A world's offer arrives whole, with every selection's candidates already
   * resolved against nothing bound. That is right for a candidate LIST -- a
   * world action may not declare a dependent selection -- and wrong for a
   * selection's SHAPE, which may read an earlier selection's value: a crew whose
   * size is the chosen ship's cargo hold resolved to the unbounded fallback, and
   * the panel was left holding a limit the game never meant.
   */
  resolvePick(
    action: string,
    selection: string,
    args: Record<string, unknown>,
  ): Promise<WorldPickOutcome>;
  /** Install the listener and say hello. */
  start(): void;
  /** Remove the listener and fail everything still outstanding. */
  stop(): void;
  /** The listener itself, so the paths above can be driven without a window. */
  handleMessage(event: MessageEvent): void;
}

/** What an outstanding command is told when the frame goes before its answer
 *  does. A promise nobody resolves is a button that spins forever. */
const DROPPED_BEFORE_ANSWER =
  'The page stopped listening to this world before it answered.';

/**
 * WHAT A BUNDLE'S WORLD UI KNOWS, AND HOW IT ACTS (ShufflewickPub #128).
 *
 * The world twin of `usePlatformTransport`, and it is a different shape for the
 * reason `worldProtocol.ts` states at length: a world has no flow, no turn and
 * no action table, so there is no boundary key to stamp and no op vocabulary to
 * relay. There is one verb -- send a command, wait for its own answer -- and
 * one inbound frame that carries the whole of what this UI renders.
 *
 * REQUEST CORRELATION IS THE WHOLE MECHANISM. Two commands in flight are two
 * promises: the host echoes each `requestId` onto the answer it belongs to, so
 * nothing here has to guess from arrival order, which is precisely the
 * assumption a busy world breaks.
 *
 * A REFUSAL RESOLVES. `{ ok: false, message }` is an ordinary outcome -- a
 * contested claim, a door that is not there -- and a caller that had to catch
 * one would be treating the rules working correctly as an exception.
 */
export function useWorldHost(options: WorldHostOptions = {}): WorldHost {
  const post =
    options.post ?? ((message: WorldUiMessage) => window.parent.postMessage(message, '*'));
  const helloTimeoutMs = options.helloTimeoutMs ?? WORLD_HELLO_TIMEOUT_MS;
  const commandTimeoutMs = options.commandTimeoutMs ?? WORLD_COMMAND_TIMEOUT_MS;

  const phase = ref<WorldPhase>('attaching');
  /**
   * `shallowRef`, deliberately, for the reason the host page uses one: a
   * world's view is an arbitrarily deep engine projection that is only ever
   * REPLACED wholesale, and a deep `ref` would walk the whole tree installing
   * proxies on every refresh -- a per-frame cost proportional to what the
   * player can see.
   */
  const view = shallowRef<unknown>(null);
  const seat = ref<number | null>(null);
  const actions = shallowRef<readonly WorldActionOffer[]>([]);
  const notice = ref<string | null>(null);
  const worldName = ref<string | null>(null);
  const presence = ref<readonly number[] | null>(null);
  const players = shallowRef<readonly WorldPlayer[]>([]);
  const events = shallowRef<readonly WorldNarration[]>([]);
  const heardFromHost = ref(false);
  const hostSilent = ref(false);
  const acting = ref(false);
  const recovering = ref(false);
  const recoveryNotice = ref<string | null>(null);
  const orders = options.orders ?? createOrderBook();
  /** Recovery runs once per page load, when the world is first ready to hear
   *  it. A second run would be a second question about a settled order. */
  let recovered = false;

  const pending = new Map<
    string,
    {
      resolve: (outcome: WorldActionOutcome) => void;
      timer: ReturnType<typeof setTimeout>;
      /** The order this request is one attempt at (#195). */
      orderId: string;
    }
  >();
  /**
   * A PICK IN FLIGHT (ShufflewickPub #378), kept apart from a command in flight.
   *
   * Deliberately not the same map: a pick carries no order, is never recovered,
   * and does not raise `acting` -- a panel asking what a selection may be is not
   * a player mid-press, and a spinner over the board would say it was.
   */
  const picks = new Map<
    string,
    { resolve: (outcome: WorldPickOutcome) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let sequence = 0;
  let helloTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * ONE REQUEST'S ANSWER.
   *
   * `answered` is what tells a HOST'S answer from this page giving up on one,
   * and it is the whole of what decides whether the order is struck out of the
   * book (#195): an answer -- taken or refused -- settles the order's fate, and
   * silence is exactly the case a reload has to be able to ask about again.
   */
  function settle(
    requestId: string,
    outcome: WorldActionOutcome,
    source: { answered: boolean },
  ): void {
    const waiting = pending.get(requestId);
    if (waiting === undefined) return;
    pending.delete(requestId);
    clearTimeout(waiting.timer);
    if (source.answered) orders.settle(waiting.orderId);
    waiting.resolve(outcome);
    acting.value = pending.size > 0;
  }

  /**
   * WHAT THE WORLD IS, taken whole.
   *
   * This is also the frame that ENDS THE SILENCE: `heardFromHost` is what
   * stops `WorldShell` saying nobody has spoken to this frame, and only a
   * state frame earns it.
   */
  function takeState(data: Extract<WorldHostMessage, { type: 'world_state' }>): void {
    heardFromHost.value = true;
    hostSilent.value = false;
    if (helloTimer !== null) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }

    phase.value = data.phase;
    view.value = data.view;
    seat.value = data.seat;
    actions.value = data.actions ?? [];
    notice.value = data.notice;
    worldName.value = data.worldName;
    presence.value = data.presence;
    // Absent is not empty: a host with no names to give leaves the shell with
    // seat numbers, which is what it honestly knows.
    players.value = data.players ?? [];

    // THE FIRST MOMENT AN UNCERTAIN ORDER CAN BE ASKED ABOUT (#195): the world
    // is answering this page and it holds a seat, which is what a command needs
    // to be dispatched at all.
    if (!recovered && data.phase === 'watching' && data.seat !== null) {
      recovered = true;
      void recover();
    }
  }

  /**
   * ASK AGAIN ABOUT EVERY ORDER THIS PAGE DID NOT HEAR AN ANSWER TO.
   *
   * The SAME identity and the same arguments, so a committed one is answered
   * from its receipt without the handler running or its candidates being
   * re-enumerated -- and one that never committed simply runs, which is the
   * order the player already pressed for and never got.
   *
   * The player is asked nothing. The whole mechanism is transport bookkeeping,
   * and a question about a sequence number in the middle of a game is the
   * failure this replaces.
   */
  async function recover(): Promise<void> {
    const outstanding = orders.pending();
    if (outstanding.length === 0) return;
    recovering.value = true;
    const notices: string[] = [];
    try {
      for (const order of outstanding) {
        const outcome = await dispatch(order);
        if (outcome.replayed === true) {
          notices.push(`"${order.action}" had already gone through, so it was not done again.`);
        } else if (!outcome.ok && outcome.message !== undefined) {
          notices.push(outcome.message);
        }
      }
    } finally {
      recovering.value = false;
      recoveryNotice.value = notices.length > 0 ? notices.join(' ') : null;
    }
  }

  /**
   * WHAT JUST HAPPENED, WHICH IS NOT WHAT THE WORLD IS (ShufflewickPub #331).
   *
   * Appended, because every delivery is news that has not been sent before,
   * and bounded from the front, because a world runs for months.
   *
   * Deliberately NOT counted as hearing from the host: narration carries no
   * view, no seat and no commands, so treating it as state would replace
   * `WorldShell`'s accurate "nobody has spoken to this frame" with a blank
   * board.
   */
  function takeNarration(delivery: readonly WorldNarration[]): void {
    const kept = [...events.value, ...delivery];
    events.value =
      kept.length > WORLD_NARRATION_KEPT ? kept.slice(kept.length - WORLD_NARRATION_KEPT) : kept;
  }

  /** One answer, as the caller of `act` sees it. Absent fields stay absent:
   *  "the host said nothing about this" is not "the host said undefined". */
  function outcomeOf(
    data: Extract<WorldHostMessage, { type: 'world_response' }>,
  ): WorldActionOutcome {
    return {
      ok: data.ok === true,
      ...(data.message === undefined ? {} : { message: data.message }),
      ...(data.code === undefined ? {} : { code: data.code }),
      ...(data.replayed === undefined ? {} : { replayed: data.replayed }),
    };
  }

  /**
   * ONE RE-ASKED PICK'S ANSWER (ShufflewickPub #378).
   *
   * `settle`'s twin, and separate for the same reason the map is: a pick is a
   * question rather than an order, so there is nothing to strike out of the
   * book and nothing to stop `acting` spinning over. An answer for a request
   * nobody is waiting on is dropped -- a timeout already resolved it, and
   * resolving twice would be a second answer to one question.
   */
  function settlePick(data: Extract<WorldHostMessage, { type: 'world_pick_result' }>): void {
    const waiting = picks.get(data.requestId);
    if (waiting === undefined) return;
    clearTimeout(waiting.timer);
    picks.delete(data.requestId);
    waiting.resolve({
      ok: data.ok === true,
      ...(data.selection === undefined ? {} : { selection: data.selection }),
      ...(data.message === undefined ? {} : { message: data.message }),
      ...(data.code === undefined ? {} : { code: data.code }),
    });
  }

  function handleMessage(event: MessageEvent): void {
    if (!isOriginAllowed(event.origin, options.trustedOrigins)) return;
    const data = event.data as WorldHostMessage | undefined;
    if (!data || data.source !== WORLD_HOST_SOURCE) return;

    if (data.type === 'world_response') {
      settle(data.requestId, outcomeOf(data), { answered: true });
      return;
    }
    if (data.type === 'world_pick_result') {
      settlePick(data);
      return;
    }
    if (data.type === 'world_events') {
      takeNarration(data.events);
      return;
    }
    if (data.type === 'world_state') takeState(data);
  }

  /**
   * ONE COMMAND ON THE WIRE, UNDER AN ORDER THAT IS ALREADY WRITTEN DOWN.
   *
   * Shared by a fresh press and by a recovery, and that sharing is the point: a
   * retry is not a different kind of message, it is the same order sent again.
   *
   * An answer -- taken OR refused -- strikes the order out, because either way
   * its fate is known. A timeout does not: "the world did not answer" is the
   * one outcome the book exists to remember, and an order struck out there is
   * an order a reload can no longer ask about.
   */
  function dispatch(order: PendingOrder): Promise<WorldActionOutcome> {
    sequence += 1;
    const requestId = `wc-${sequence}`;
    const answered = new Promise<WorldActionOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (pending.delete(requestId)) {
          acting.value = pending.size > 0;
          resolve({
            ok: false,
            message:
              `The world did not answer "${order.action}". It may still have taken it -- this ` +
              'page will ask again with the same order, so it cannot happen twice.',
          });
        }
      }, commandTimeoutMs);
      pending.set(requestId, { resolve, timer, orderId: order.id });
    });
    acting.value = true;
    post({
      source: WORLD_UI_SOURCE,
      type: 'world_command',
      requestId,
      order: { id: order.id, at: order.at },
      action: order.action,
      args: order.args,
    });
    return answered;
  }

  /**
   * RE-ASK ONE PICK, WITH THE ARGUMENTS BOUND SO FAR (ShufflewickPub #378).
   *
   * Its own promise map for the reason `dispatch` has one: two picks in flight
   * are two answers, and the host echoes each `requestId` onto the one it
   * belongs to. It carries NO order -- a pick is a question, not a command, so
   * there is nothing to make idempotent and nothing to recover after a reload.
   *
   * A refusal RESOLVES, exactly as a command's does.
   */
  function resolvePick(
    action: string,
    selection: string,
    args: Record<string, unknown>,
  ): Promise<WorldPickOutcome> {
    sequence += 1;
    const requestId = `wp-${sequence}`;
    const answered = new Promise<WorldPickOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (picks.delete(requestId)) {
          resolve({
            ok: false,
            message:
              `The world did not answer what "${selection}" may be. Nothing has been sent, so ` +
              'nothing has happened; try the action again.',
          });
        }
      }, commandTimeoutMs);
      picks.set(requestId, { resolve, timer });
    });
    post({
      source: WORLD_UI_SOURCE,
      type: 'world_pick',
      requestId,
      action,
      selection,
      // THE JSON ROUND TRIP the order book takes, and for the same reason:
      // structured clone cannot carry a Vue proxy, and a panel's args are the
      // controller's own reactive object.
      args: JSON.parse(JSON.stringify(args)) as Record<string, unknown>,
    });
    return answered;
  }

  async function act(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<WorldActionOutcome> {
    // WRITTEN DOWN BEFORE IT IS SENT (#195). An order minted after the post
    // would have a window in which the world could commit something this page
    // has no name for.
    //
    // Structured clone cannot carry a Vue proxy, and a UI's natural
    // `someRef.value` is exactly what a caller will hand this -- so the book
    // takes the JSON round trip on the way in, and what it stores is what goes
    // on the wire.
    return await dispatch(orders.open(command, args ?? {}));
  }

  function start(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleMessage);
    }
    helloTimer = setTimeout(() => {
      helloTimer = null;
      if (!heardFromHost.value) hostSilent.value = true;
    }, helloTimeoutMs);
    // THE HOST PUSHES; THIS ASKS IT TO PUSH NOW. A world frame commonly mounts
    // after the host already holds a view (the socket opens while the iframe is
    // still loading), and without this the UI would sit blank until the world
    // next moved -- which in a quiet world is never.
    post({ source: WORLD_UI_SOURCE, type: 'world_ready' });
  }

  function stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', handleMessage);
    }
    if (helloTimer !== null) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
    for (const requestId of [...pending.keys()]) {
      settle(requestId, { ok: false, message: DROPPED_BEFORE_ANSWER }, { answered: false });
    }
    // A pick is a question, so there is no order to strike out -- but a promise
    // nobody resolves is still a panel that spins forever.
    for (const [requestId, waiting] of [...picks]) {
      clearTimeout(waiting.timer);
      picks.delete(requestId);
      waiting.resolve({ ok: false, message: DROPPED_BEFORE_ANSWER });
    }
  }

  return {
    phase,
    view,
    seat,
    actions,
    notice,
    worldName,
    presence,
    players,
    events,
    heardFromHost,
    hostSilent,
    acting,
    recovering,
    recoveryNotice,
    ordersDurable: orders.durable,
    act,
    resolvePick,
    start,
    stop,
    handleMessage,
  };
}
