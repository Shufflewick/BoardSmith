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
  type WorldQuoteOutcome,
  type WorldActionOffer,
  type WorldHostMessage,
  type WorldNarration,
  type WorldPhase,
  type WorldPlayer,
  type WorldUiMessage,
} from './worldProtocol.js';

/**
 * ONE OUTSTANDING QUESTION, whatever it was a question about.
 *
 * A pick and a quote are both questions -- no order, nothing spent, an answer
 * echoed back under the id it was asked with -- so the waiting is one shape and
 * `askQuestion`/`settleQuestion` are one road. Only a COMMAND needs more than
 * this, because only a command has an order to strike out.
 */
interface Question<T> {
  resolve: (outcome: T) => void;
  timer: ReturnType<typeof setTimeout>;
}

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
  /**
   * TRUE WHILE THE WORLD ON SCREEN HAS NO OFFERS YET (BoardSmith #244).
   *
   * The view and the offers are two frames, so there is a moment after every
   * committed change where this page knows what the world IS and not yet what
   * it may do in it. `actions` is empty through that moment, and empty is
   * otherwise a real answer -- "this seat may do nothing here". This is the
   * flag that tells the two apart, so a surface can say "working out what you
   * can do" instead of drawing a world with no verbs in it.
   */
  offersPending: Ref<boolean>;
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
  /**
   * WHAT THE DRAFT IN FRONT OF THE PLAYER WOULD COST (#248).
   *
   * The action and every argument as the player has it SO FAR -- a number typed
   * into the panel's field and not yet submitted included -- answered by the
   * game's own `.quote()` as the lines to show them.
   *
   * A QUESTION, like `resolvePick`: no order, nothing to recover, nothing spent.
   * And advisory: the order that follows is validated against whatever the world
   * holds when it arrives, so a quote is what the player was told rather than a
   * price anybody is held to.
   */
  quoteDraft(
    action: string,
    args: Record<string, unknown>,
  ): Promise<WorldQuoteOutcome>;
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
/**
 * ONE ANSWER TO A QUESTION, AS ITS CALLER READS IT (#378, #248).
 *
 * A pick's answer carries a `selection` and a quote's carries a `quote`, and
 * everything else about the two is identical: whether the world said yes, what it
 * said if it said no, and the code it said it with.
 *
 * ABSENT RATHER THAN `undefined`, key by key. A caller comparing an outcome with
 * `toEqual` is comparing what the world answered, and a key holding `undefined`
 * is a key the world never sent.
 */
function answerOf<T extends { readonly ok: boolean }>(
  message: Extract<WorldHostMessage, { type: 'world_pick_result' | 'world_quote_result' }>,
  payload: keyof T & string,
): T {
  const data = message as unknown as Record<string, unknown>;
  const answer: Record<string, unknown> = { ok: data.ok === true };
  for (const key of [payload, 'message', 'code']) {
    if (data[key] !== undefined) answer[key] = data[key];
  }
  // The one cast on this road, and it is the wire's: what arrived is `unknown`
  // until something says what shape it is, and the message type that named this
  // payload key is what says so.
  return answer as T;
}

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
  const offersPending = ref(false);
  /** The committed state this page is showing, and the one `actions` is about.
   *  `null` before the host has said anything. */
  let stateRevision: number | null = null;
  /**
   * THE NEWEST OFFER SET THIS PAGE HAS BEEN SENT, held whether or not it could
   * be shown when it arrived (#250).
   *
   * Not an optimisation: it is what makes the panel a function of what the page
   * HOLDS rather than of the order two messages happened to land in. A push is
   * two frames, and nothing in the protocol promises which reaches this
   * listener first -- a host relays both into a frame that may not be listening
   * yet, a page can join mid-stream, and a QUIET WORLD NEVER SENDS A SECOND
   * SET. So a set judged once, at arrival, and thrown away is a world whose
   * verbs are a coin toss; judged here, against the state on screen, it is the
   * same question asked again every time either half moves.
   */
  let heldOffers: { revision: number; actions: readonly WorldActionOffer[] } | null = null;
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
  const picks = new Map<string, Question<WorldPickOutcome>>();
  /**
   * A QUOTE IN FLIGHT (#248), on the same terms as a pick and in its own map.
   *
   * Separate from the picks for the reason those are separate from the commands:
   * the two answer different messages, and one map holding both would have to be
   * keyed on something other than the id the host echoes.
   */
  const quotes = new Map<string, Question<WorldQuoteOutcome>>();
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
    // A NEW STATE RETIRES THE OFFERS THAT WERE ABOUT THE OLD ONE (#244).
    //
    // The offers arrive on their own frame now, after this one, so between the
    // two there is a moment where the page is showing a world it has not been
    // told the verbs for. Keeping the previous set on screen through that
    // moment would be showing buttons enumerated against a world that has
    // moved; `offersPending` is how the shell says "not yet" rather than
    // "nothing", which is a different sentence and the only honest one.
    //
    // A RE-PUSH OF THE SAME STATE KEEPS THEM. Presence changes, a seat switch
    // and a notice all re-send this frame without the world having moved, and
    // clearing there would flicker every panel for no reason.
    if (data.revision !== stateRevision) {
      stateRevision = data.revision;
      // THE SET THIS PAGE IS HOLDING MAY ALREADY BE ABOUT THIS STATE (#250) --
      // the offers frame of this very push, arrived first. Asked before the
      // panel is blanked, so the ordinary case of a state arriving ahead of its
      // offers is the only one that ever says "not yet".
      if (!showHeldOffers()) {
        actions.value = [];
        offersPending.value = true;
      }
    }
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
   * SHOW THE HELD SET IF IT IS ABOUT THE WORLD ON SCREEN (#244, #250).
   *
   * The one rule, and now the only place it is applied: a set is shown only when
   * the state it was enumerated over is the state this page is showing. A set
   * stamped with any other revision stays HELD and unshown -- silently, because
   * it is not an error. It is either an answer to a question the world has moved
   * past, or one about a state this page has not been told about yet, and it is
   * shown in the second case the moment that state arrives.
   *
   * Not showing it is what keeps an offer from reading as a permission it is
   * not. It was never a permission -- every command is validated against the
   * state it finds when it is submitted, offer or no offer -- but a panel drawn
   * from a set enumerated over another state would invite presses the world is
   * bound to refuse, which is the same lie one layer up.
   *
   * @returns whether the panel is now drawn from it
   */
  function showHeldOffers(): boolean {
    if (heldOffers === null || heldOffers.revision !== stateRevision) return false;
    actions.value = heldOffers.actions;
    offersPending.value = false;
    return true;
  }

  /**
   * WHAT THIS SEAT MAY DO, TAKEN WHETHER OR NOT IT CAN BE SHOWN YET (#250).
   *
   * The newest set replaces the one held before it and nothing else happens
   * here: whether it reaches the screen is `showHeldOffers`'s single question,
   * asked again on every state frame. That is the whole of the #250 fix -- this
   * used to RETURN on a revision that was not the one on screen, which threw
   * away the offers frame of a push whose state frame was still behind it in
   * the queue, and a quiet world sends no second set to recover with.
   */
  function takeOffers(data: Extract<WorldHostMessage, { type: 'world_offers' }>): void {
    heldOffers = { revision: data.revision, actions: data.actions };
    showHeldOffers();
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
  function settleQuestion<T>(
    waiting: Map<string, Question<T>>,
    requestId: string,
    outcome: T,
  ): void {
    const asked = waiting.get(requestId);
    if (asked === undefined) return;
    clearTimeout(asked.timer);
    waiting.delete(requestId);
    asked.resolve(outcome);
  }

  /**
   * ONE QUESTION ON THE WIRE, and the promise that waits for its own answer.
   *
   * `dispatch`'s counterpart for everything that is NOT a command: it mints the
   * id, arms the timeout that keeps a panel from spinning forever, and posts
   * whatever the caller wants asked. No order is written down, `acting` never
   * rises, and nothing is recovered after a reload -- because nothing has been
   * spent by asking.
   *
   * THE JSON ROUND TRIP is taken on the way in, for the reason the order book
   * takes it: structured clone cannot carry a Vue proxy, and a panel's args are
   * the controller's own reactive object.
   */
  function askQuestion<T>(
    waiting: Map<string, Question<T>>,
    prefix: string,
    timedOut: T,
    message: (requestId: string) => WorldUiMessage,
  ): Promise<T> {
    sequence += 1;
    const requestId = `${prefix}-${sequence}`;
    const answered = new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        if (waiting.delete(requestId)) resolve(timedOut);
      }, commandTimeoutMs);
      waiting.set(requestId, { resolve, timer });
    });
    post(message(requestId));
    return answered;
  }

  /** Hand one answered question to whoever is waiting on it. The payload key is
   *  the only thing that differs between the two roads. */
  function settleAnswer(
    data: Extract<WorldHostMessage, { type: 'world_pick_result' | 'world_quote_result' }>,
  ): void {
    if (data.type === 'world_pick_result') {
      settleQuestion(picks, data.requestId, answerOf<WorldPickOutcome>(data, 'selection'));
      return;
    }
    settleQuestion(quotes, data.requestId, answerOf<WorldQuoteOutcome>(data, 'quote'));
  }

  /**
   * THE MESSAGE, IF IT IS ONE OF OURS, or null.
   *
   * Two rules and neither is about what arrived: the origin has to be allowed --
   * a deployed host names its own, `boardsmith dev` allows any -- and the frame
   * has to be stamped by a world HOST. A wrong pairing with a table shell is
   * inert here rather than half-consumed, which is why the two protocols stamp
   * different sources at all.
   */
  function fromTheHost(event: MessageEvent): WorldHostMessage | null {
    if (!isOriginAllowed(event.origin, options.trustedOrigins)) return null;
    const data = event.data as WorldHostMessage | undefined;
    if (!data || data.source !== WORLD_HOST_SOURCE) return null;
    return data;
  }

  function handleMessage(event: MessageEvent): void {
    const data = fromTheHost(event);
    if (data === null) return;

    if (data.type === 'world_response') {
      settle(data.requestId, outcomeOf(data), { answered: true });
      return;
    }
    // ONE ROAD FOR EVERY QUESTION'S ANSWER (#378, #248), so this switch stays
    // about which KIND of frame arrived rather than about what each one carries.
    if (data.type === 'world_pick_result' || data.type === 'world_quote_result') {
      settleAnswer(data);
      return;
    }
    if (data.type === 'world_events') {
      takeNarration(data.events);
      return;
    }
    if (data.type === 'world_offers') {
      takeOffers(data);
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
    return askQuestion(
      picks,
      'wp',
      {
        ok: false,
        message:
          `The world did not answer what "${selection}" may be. Nothing has been sent, so ` +
          'nothing has happened; try the action again.',
      },
      (requestId) => ({
        source: WORLD_UI_SOURCE,
        type: 'world_pick',
        requestId,
        action,
        selection,
        args: JSON.parse(JSON.stringify(args)) as Record<string, unknown>,
      }),
    );
  }

  /**
   * WHAT THE DRAFT WOULD COST, ASKED OF THE GAME (#248).
   *
   * `resolvePick`'s twin one step on: a pick asks what one selection may be, and
   * this asks what the whole draft adds up to. It is on the question road rather
   * than the command road, so nothing is written down and nothing is spent --
   * being told a price is not paying one.
   *
   * A TIMEOUT LEAVES NO PRICE ON SCREEN. The refusal it resolves with says the
   * world did not answer; what the panel must never do is show the last price it
   * heard beside a draft that has moved, which is why the controller stamps every
   * quote with the draft it was computed for.
   */
  function quoteDraft(
    action: string,
    args: Record<string, unknown>,
  ): Promise<WorldQuoteOutcome> {
    return askQuestion(
      quotes,
      'wq',
      {
        ok: false,
        message:
          `The world did not say what "${action}" would cost. Nothing has been sent, so nothing ` +
          'has happened.',
      },
      (requestId) => ({
        source: WORLD_UI_SOURCE,
        type: 'world_quote',
        requestId,
        action,
        args: JSON.parse(JSON.stringify(args)) as Record<string, unknown>,
      }),
    );
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
    // A QUESTION HAS NO ORDER TO STRIKE OUT -- but a promise nobody resolves is
    // still a panel that spins forever, and a quote is as unanswerable as a pick
    // once this frame has stopped listening.
    for (const outstanding of [picks, quotes]) {
      for (const [requestId, waiting] of [...outstanding]) {
        clearTimeout(waiting.timer);
        outstanding.delete(requestId);
        waiting.resolve({ ok: false, message: DROPPED_BEFORE_ANSWER });
      }
    }
  }

  return {
    phase,
    view,
    seat,
    actions,
    offersPending,
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
    quoteDraft,
    start,
    stop,
    handleMessage,
  };
}
