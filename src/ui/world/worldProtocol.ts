/**
 * THE WIRE BETWEEN A HOST PAGE AND A BUNDLE'S WORLD UI (ShufflewickPub #128).
 *
 * A resident world is not a table, and this file exists because trying to
 * pretend otherwise does not survive contact with either side.
 *
 * `GameShell` speaks the TABLE protocol: `{source:'shufflewick', type:'init'}`
 * then `{type:'game_state', view:{flowState, state}}`, where `state` is a full
 * `PlayerGameState` -- `isMyTurn`, `availableActions`, `actionMetadata`, a flow
 * boundary key stamped on every outbound op. A world has none of those and must
 * not invent them: its verbs are COMMANDS declared by the bundle's `world`
 * block, its projection is `{player, state, phase}` computed from the
 * partitions a seat can see, and it runs no flow at all. Feeding a world's view
 * into `GameShell` would mean fabricating a turn, a flow position and an action
 * table -- a lie the auto-UI would then render as buttons the world refuses.
 *
 * So a world UI is a SECOND ENTRY POINT in a bundle (`world.html`), mounting
 * `WorldShell` rather than `GameShell`, and these are the messages it speaks.
 *
 * ## Why the `source` strings differ from the table protocol's
 *
 * `GameShell` acts on any `{source:'shufflewick'}` message it recognises. If a
 * world host and a table shell were ever paired by mistake, a shared source
 * would let each one half-consume the other's frames -- a seat set from an
 * `init` that means something else, a `game_state` dropped silently. Distinct
 * sources make a wrong pairing INERT, and `WorldShell` says so out loud after
 * `WORLD_HELLO_TIMEOUT_MS` rather than sitting blank forever.
 */

/** What the HOST page stamps on everything it sends into the world frame. */
export const WORLD_HOST_SOURCE = 'shufflewick-world';

/** What the world UI stamps on everything it sends back out. */
export const WORLD_UI_SOURCE = 'shufflewick-world-ui';

/**
 * How long the shell waits to hear ANYTHING from the host before it says so.
 *
 * A world UI that has been told nothing is indistinguishable from an empty
 * world, which is the exact confusion `world.view` was added to end
 * (ShufflewickPub #95). Twenty seconds is generous: the first frame waits on a
 * Durable Object waking and hydrating its partitions.
 */
export const WORLD_HELLO_TIMEOUT_MS = 20_000;

/** How long one command waits for its own answer before it is failed. */
export const WORLD_COMMAND_TIMEOUT_MS = 20_000;

/** One value a `choice` argument offers, and how to say it to a person. */
export interface WorldCommandChoice {
  readonly value: string;
  readonly label: string;
}

/** One argument a world command asks for, as the bundle declared it. */
export type WorldCommandArgument =
  | {
      readonly name: string;
      readonly prompt: string;
      readonly kind: 'choice';
      readonly choices: readonly WorldCommandChoice[];
    }
  | {
      readonly name: string;
      readonly prompt: string;
      readonly kind: 'number';
      readonly min?: number;
      readonly max?: number;
      readonly integer?: boolean;
    }
  | { readonly name: string; readonly prompt: string; readonly kind: 'text' };

/** One command the world says it answers to. */
export interface WorldCommandOffer {
  readonly name: string;
  readonly prompt?: string;
  readonly args: readonly WorldCommandArgument[];
}

/**
 * Where the player is with respect to the world, as the host reports it.
 *
 * The same four the host's own attachment uses, and deliberately not fewer: a
 * world that would not let you in and a world you were watching until the
 * socket dropped want different words on the screen.
 */
export type WorldPhase = 'attaching' | 'watching' | 'lost' | 'refused';

/** What the host pushes whenever anything about the attachment changes. */
interface WorldStateMessage {
  readonly source: typeof WORLD_HOST_SOURCE;
  readonly type: 'world_state';
  readonly phase: WorldPhase;
  /** This player's own projection of the world. `null` before the first one. */
  readonly view: unknown;
  /** The seat this player holds, or `null` before the world has said. */
  readonly seat: number | null;
  /** What the world answers to. Empty until it has said. */
  readonly commands: readonly WorldCommandOffer[];
  /** The host's or the world's own sentence about the current state. */
  readonly notice: string | null;
  /** What the world's name is, for a UI that wants to say it. */
  readonly worldName: string | null;
  /**
   * The seats holding at least one open connection to this world right now,
   * platform-composed, or `null` when the host has no live claim to make
   * (before its socket has said anything, and from the moment it closes).
   *
   * The promise is exactly the platform's own (ShufflewickPub #144/#174), no
   * more: per seat, so a second tab changes nothing; derived from the open
   * sockets at each use and never stored, so a parked world reports an empty
   * set rather than a stale one; and a seat that left is indistinguishable
   * from one that dropped and is reconnecting. `null` is not `[]`: an empty
   * array says "nobody is here" and a UI must not say that on a dead socket,
   * where the truth is "this page no longer knows".
   */
  readonly presence: readonly number[] | null;
}

/** The host's answer to one command this UI sent. */
interface WorldResponseMessage {
  readonly source: typeof WORLD_HOST_SOURCE;
  readonly type: 'world_response';
  readonly requestId: string;
  readonly ok: boolean;
  readonly message?: string;
}

/**
 * EVERYTHING THE HOST SENDS, and the only name the two halves share.
 *
 * The four message shapes above are not exported individually on purpose: a
 * reader of this protocol only ever handles the union -- one listener, one
 * switch -- and four exported names nothing imports are four things a future
 * change can leave behind.
 */
export type WorldHostMessage = WorldStateMessage | WorldResponseMessage;

/** What one command becomes on the wire. */
interface WorldCommandMessage {
  readonly source: typeof WORLD_UI_SOURCE;
  readonly type: 'world_command';
  readonly requestId: string;
  readonly command: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** "I am mounted; send me what you have." The host answers with a state frame. */
interface WorldReadyMessage {
  readonly source: typeof WORLD_UI_SOURCE;
  readonly type: 'world_ready';
}

export type WorldUiMessage = WorldCommandMessage | WorldReadyMessage;

/** What acting on a world answers. A refusal RESOLVES: a world refuses commands
 *  constantly and legitimately, and a caller that had to catch one would treat
 *  "your holding is bare" as an exception. */
export interface WorldActionOutcome {
  readonly ok: boolean;
  readonly message?: string;
}
