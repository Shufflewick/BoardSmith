/**
 * Never push a recipient a state identical to the last one it was sent (#487).
 *
 * In a simultaneous step with secret actions, a push that carries nothing new
 * still tells its recipient that SOMEONE acted. So every host that pushes game
 * state keeps one of these and asks it, per recipient, before each push:
 *
 * ```typescript
 * const gate = new StatePushGate<string, Frame>({ perPushFields: ['serverNow'] });
 * for (const socket of sockets) {
 *   const push = gate.toPush(socket.id, frameFor(socket));
 *   if (push) socket.send(push);
 * }
 * ```
 *
 * A recipient is one CONNECTION, not one seat: a page that reconnects is a new
 * recipient and must get the full state. Call {@link recordSent} for a frame sent
 * outside the push path (on connect, on reconnect, as the answer to a request),
 * so the next push is compared against what the page really holds, and
 * {@link forget} when the connection closes.
 *
 * What "identical" means: the frame as the recipient would receive it, with two
 * exceptions. Fields listed in `perPushFields` (a send time) are stamped fresh
 * on every push, so they never make two frames differ; they advance only when
 * something else does. Animation events are compared by id: the engine empties
 * its buffer at the start of every action, so a buffer emptied by someone
 * else's action is not news to a client that has played those events, and only
 * an event with an id above the highest one the recipient was sent is.
 *
 * The frame to send is the one `toPush` returns, not the one it was handed:
 * its game log carries only the lines the recipient was not sent (#1614).
 * `messages` then starts at line `messagesFrom`, the first line that differs
 * from what the recipient holds, and the page keeps its lines before that one
 * (`mergeMessageLog` in `boardsmith/client`). A frame's player state is its
 * `view.state`.
 *
 * Imports nothing, so it runs wherever `SnapshotSessionHost` does.
 */
export interface StatePushGateOptions {
  /** Top-level frame fields stamped fresh on every push, such as a send time. */
  perPushFields?: readonly string[];
}

/** The log a recipient was sent: the line number of its first line, and a hash of each line. */
interface SentLog {
  from: number;
  lines: number[];
}

interface Sent {
  /**
   * A 128-bit digest of the frame as compared (everything but per-push fields
   * and animation events). A digest rather than the text, so a gate holds a few
   * bytes per recipient rather than a copy of every frame it sent.
   */
  body: string;
  /** The highest animation event id in the frame. */
  lastEventId: number;
  /** The whole log the frame's player state carries, when it has one. */
  log: SentLog | undefined;
}

type Holder = Record<string, unknown>;

function isHolder(value: unknown): value is Holder {
  return typeof value === 'object' && value !== null;
}

function highestEventId(events: unknown): number {
  if (!Array.isArray(events)) return 0;
  let highest = 0;
  for (const event of events) {
    const id = isHolder(event) ? event.id : undefined;
    if (typeof id === 'number' && id > highest) highest = id;
  }
  return highest;
}

/**
 * cyrb128's four independently mixed 32-bit lanes over `text`.
 * Not cryptographic, which it need not be: no one chooses the frames compared
 * here to collide, and with the text's length appended, two different frames
 * of one recipient sharing a digest by accident is vanishingly unlikely.
 * Synchronous and import-free, because the gate runs inside a Worker as well
 * as in Node.
 */
function lanes(text: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4];
}

/** A 128-bit digest of `text`, its length appended. */
function digest(text: string): string {
  return lanes(text).map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('') + `:${text.length}`;
}

/** A 53-bit hash of one log line: a number, so a recipient's log costs 8 bytes a line to remember. */
function lineHash(line: unknown): number {
  const [h1, h2] = lanes(JSON.stringify(line));
  return (h2 & 0x1fffff) * 0x100000000 + (h1 >>> 0);
}

export class StatePushGate<R, F extends object = object> {
  readonly #perPush: ReadonlySet<string>;
  readonly #sent = new Map<R, Sent>();

  constructor(options: StatePushGateOptions = {}) {
    this.#perPush = new Set(options.perPushFields ?? []);
  }

  /**
   * The frame to send `recipient`, its log cut to the lines it was not sent,
   * or `undefined` when `frame` tells it nothing it was not already sent. A
   * frame returned is recorded as sent, so ask only when you will send it.
   */
  toPush(recipient: R, frame: F): F | undefined {
    const next = this.#measure(frame);
    const last = this.#sent.get(recipient);
    if (last !== undefined && last.body === next.body && next.lastEventId <= last.lastEventId) return undefined;
    this.#sent.set(recipient, next);
    return last?.log && next.log ? withLogAfter(frame, last.log, next.log) : frame;
  }

  /** Record `frame` as sent to `recipient` without asking: a connect, a reconnect, an answer to a request. */
  recordSent(recipient: R, frame: F): void {
    this.#sent.set(recipient, this.#measure(frame));
  }

  /** Forget `recipient`, whose connection closed. Its next frame is sent in full. */
  forget(recipient: R): void {
    this.#sent.delete(recipient);
  }

  /** Forget every recipient not in `present`. */
  retainOnly(present: Iterable<R>): void {
    const keep = new Set(present);
    for (const recipient of [...this.#sent.keys()]) {
      if (!keep.has(recipient)) this.#sent.delete(recipient);
    }
  }

  #measure(frame: F): Sent {
    const playerState = playerStateOf(frame);
    const gameView = playerState !== undefined && isHolder(playerState.view) ? playerState.view : undefined;
    const lastEventId = Math.max(
      highestEventId(playerState?.animationEvents),
      highestEventId(gameView?.animationEvents),
    );
    const perPush = this.#perPush;
    const text = JSON.stringify(frame, function (this: unknown, key: string, value: unknown) {
      if (this === frame && perPush.has(key)) return undefined;
      if (this === playerState && (key === 'animationEvents' || key === 'lastAnimationEventId')) return undefined;
      if (this === gameView && key === 'animationEvents') return undefined;
      return value;
    });
    const messages = playerState?.messages;
    const log = playerState === undefined
      ? undefined
      : { from: lineNumber(playerState.messageOffset), lines: Array.isArray(messages) ? messages.map(lineHash) : [] };
    return { body: digest(text), lastEventId, log };
  }
}

function playerStateOf(frame: object): Holder | undefined {
  const view = (frame as Holder).view;
  return isHolder(view) && isHolder(view.state) ? view.state : undefined;
}

function lineNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/** `frame` with its log cut to start at the first line `now` does not share with `held`. */
function withLogAfter<F extends object>(frame: F, held: SentLog, now: SentLog): F {
  let line = now.from;
  // A log starting before the lines the recipient holds is sent whole.
  if (now.from >= held.from) {
    const end = Math.min(held.from + held.lines.length, now.from + now.lines.length);
    while (line < end && held.lines[line - held.from] === now.lines[line - now.from]) line++;
  }
  if (line === now.from) return frame;
  const view = (frame as Holder).view as Holder;
  const { messages, ...state } = view.state as Holder;
  const rest = (messages as unknown[] | undefined)?.slice(line - now.from) ?? [];
  return {
    ...frame,
    view: { ...view, state: { ...state, ...(rest.length > 0 && { messages: rest }), messagesFrom: line } },
  };
}
