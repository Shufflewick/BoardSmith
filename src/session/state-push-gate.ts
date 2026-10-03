/**
 * Never push a recipient a state identical to the last one it was sent (#487).
 *
 * In a simultaneous step with secret actions, a push that carries nothing new
 * still tells its recipient that SOMEONE acted. So every host that pushes game
 * state keeps one of these and asks it, per recipient, before each push:
 *
 * ```typescript
 * const gate = new StatePushGate<string, Frame>({
 *   playerState: (frame) => frame.view.state,
 *   perPushFields: ['serverNow'],
 * });
 * for (const socket of sockets) {
 *   const frame = frameFor(socket);
 *   if (gate.shouldPush(socket.id, frame)) socket.send(frame);
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
 * Imports nothing, so it runs wherever `SnapshotSessionHost` does.
 */
export interface StatePushGateOptions<F> {
  /**
   * The `PlayerGameState` inside a frame (`frame.state` for a `GameSession`
   * update, `view.state` for a `SnapshotSessionHost` player view), or
   * `undefined` when the frame carries none. Its `animationEvents` and
   * `lastAnimationEventId`, and its game view's `animationEvents`, are compared
   * by id as described above.
   */
  playerState: (frame: F) => unknown;
  /** Top-level frame fields stamped fresh on every push, such as a send time. */
  perPushFields?: readonly string[];
}

interface Sent {
  /** The frame as compared: everything but per-push fields and animation events. */
  body: string;
  /** The highest animation event id in the frame. */
  lastEventId: number;
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

export class StatePushGate<R, F extends object = object> {
  readonly #playerState: (frame: F) => unknown;
  readonly #perPush: ReadonlySet<string>;
  readonly #sent = new Map<R, Sent>();

  constructor(options: StatePushGateOptions<F>) {
    this.#playerState = options.playerState;
    this.#perPush = new Set(options.perPushFields ?? []);
  }

  /**
   * Whether `frame` tells `recipient` anything it was not already sent. A
   * `true` answer records `frame` as sent, so ask only when you will send it.
   */
  shouldPush(recipient: R, frame: F): boolean {
    const next = this.#measure(frame);
    const last = this.#sent.get(recipient);
    if (last !== undefined && last.body === next.body && next.lastEventId <= last.lastEventId) return false;
    this.#sent.set(recipient, next);
    return true;
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
    const state = this.#playerState(frame);
    const playerState = isHolder(state) ? state : undefined;
    const gameView = playerState !== undefined && isHolder(playerState.view) ? playerState.view : undefined;
    const lastEventId = Math.max(
      highestEventId(playerState?.animationEvents),
      highestEventId(gameView?.animationEvents),
    );
    const perPush = this.#perPush;
    const body = JSON.stringify(frame, function (this: unknown, key: string, value: unknown) {
      if (this === frame && perPush.has(key)) return undefined;
      if (this === playerState && (key === 'animationEvents' || key === 'lastAnimationEventId')) return undefined;
      if (this === gameView && key === 'animationEvents') return undefined;
      return value;
    });
    return { body, lastEventId };
  }
}
