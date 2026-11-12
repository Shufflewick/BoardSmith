import { diffPushedView, digest, revOf, type ViewPatch } from './view-patch.js';

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
 * The frame to send is the one `toPush` returns, not the one it was handed
 * (#1616). The first frame a recipient is pushed carries its whole `view`;
 * every later one carries a `patch` instead (`ViewPatch` in `view-patch.ts`),
 * made against the view it was last sent, whose `rev` the patch names as its
 * `base`. A view without a `rev` is always sent whole. A frame's player state is
 * its `view.state`.
 *
 * Imports only `view-patch.ts`, which imports nothing, so it runs wherever
 * `SnapshotSessionHost` does.
 */
export interface StatePushGateOptions {
  /** Top-level frame fields stamped fresh on every push, such as a send time. */
  perPushFields?: readonly string[];
}

interface Sent {
  /**
   * A 128-bit digest of the frame as compared (everything but per-push fields,
   * animation events and the view's `rev`, which names the events too).
   */
  body: string;
  /** The highest animation event id in the frame. */
  lastEventId: number;
  /** The view the frame carried, which the next push is a patch against. */
  view: unknown;
}

/** A frame whose `view` was replaced by the patch that turns the recipient's last view into it. */
export type PatchedFrame<F> = Omit<F, 'view'> & { patch: ViewPatch };

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

export class StatePushGate<R, F extends { view: unknown } = { view: unknown }> {
  readonly #perPush: ReadonlySet<string>;
  readonly #sent = new Map<R, Sent>();

  constructor(options: StatePushGateOptions = {}) {
    this.#perPush = new Set(options.perPushFields ?? []);
  }

  /**
   * The frame to send `recipient`, as a patch against the view it was last
   * sent when it was sent one with a `rev`, or `undefined` when `frame` tells
   * it nothing it was not already sent. A frame returned is recorded as sent,
   * so ask only when you will send it.
   */
  toPush(recipient: R, frame: F): F | PatchedFrame<F> | undefined {
    const next = this.#measure(frame);
    const last = this.#sent.get(recipient);
    if (last !== undefined && last.body === next.body && next.lastEventId <= last.lastEventId) return undefined;
    this.#sent.set(recipient, next);
    const base = revOf(last?.view);
    if (base === undefined || revOf(frame.view) === undefined) return frame;
    const { view, ...rest } = frame;
    return { ...rest, patch: { base, ops: diffPushedView(last!.view, view) } };
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
    // The keys left out of the comparison, by the object that holds them.
    const skipped = new Map<unknown, ReadonlySet<string>>([
      [gameView, GAME_VIEW_SKIPPED],
      [playerState, PLAYER_STATE_SKIPPED],
      [frame.view, VIEW_SKIPPED],
      [frame, this.#perPush],
    ]);
    const text = JSON.stringify(frame, function (this: unknown, key: string, value: unknown) {
      return skipped.get(this)?.has(key) ? undefined : value;
    });
    return { body: digest(text), lastEventId, view: frame.view };
  }
}

const VIEW_SKIPPED: ReadonlySet<string> = new Set(['rev']);
const PLAYER_STATE_SKIPPED: ReadonlySet<string> = new Set(['animationEvents', 'lastAnimationEventId']);
const GAME_VIEW_SKIPPED: ReadonlySet<string> = new Set(['animationEvents']);

function playerStateOf(frame: { view: unknown }): Holder | undefined {
  const view = frame.view;
  return isHolder(view) && isHolder(view.state) ? view.state : undefined;
}
