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

import type { ActionMetadata } from '../../session/types.js';

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

/**
 * How many narrated lines a world UI is handed at once.
 *
 * A resident world runs for months and narrates for as long as anybody is in
 * it, so `useWorldHost`'s log is bounded rather than left to grow for the life
 * of an open frame. The OLDEST go, which is the right end for something that
 * scrolls: what a person is reading is the recent lines.
 *
 * It is the shell's bound and not a game's. A game that wants a longer memory
 * of what was said keeps it in its own state, where it is durable and visible
 * to somebody who was not connected -- which is a different promise from this
 * one, and the reason both exist.
 */
export const WORLD_NARRATION_KEPT = 200;

/**
 * ONE ACTION THIS SEAT MAY TAKE, ENUMERATED (BoardSmith #169).
 *
 * The TABLE'S OWN `ActionMetadata`, which is the point: a world's verbs are
 * Actions now, so the shell's action panel, the board bridge and the drag-drop
 * targets read a world's answer with no translation at all. It replaces
 * `WorldCommandOffer`, a parallel vocabulary that existed only because a
 * world's verbs were not Actions -- and which could say `tend` wants a holding
 * without being able to say WHICH, because a bundle can state what a world
 * contains and not what is legal this instant.
 *
 * ITS CANDIDATES ARRIVE WITH IT. A table fetches each pick's choices on demand,
 * because a table's protocol is step-wise; a world's is single-shot, so
 * `selections[i].validElements` and `.choices` are filled in. That is
 * affordable because a world action may not declare a dependent selection, so
 * no selection's candidates are a function of another's value.
 */
export type WorldActionOffer = ActionMetadata & {
  /** Why this action is offered but cannot be taken right now. Absent when it
   *  can: a greyed button must always say why. */
  readonly disabled?: string;
};

/**
 * ONE THING THAT HAPPENED, AS THE WORLD ADDRESSED IT (ShufflewickPub #331).
 *
 * A world's narration IS its routed events, and this is one of them: the scope
 * the game named, and the payload the game wrote.
 *
 * THE AUDIENCE IS NOT ON THE WIRE. Which seats an event was addressed to is
 * the platform's own routing fact; a UI that received it would learn who else
 * is in the room from an event that was addressed to it. The platform has
 * already decided this frame's reader is in the audience, and nothing here
 * re-checks.
 *
 * `payload` IS THE GAME'S OWN SHAPE, and stays `unknown` the whole way here:
 * it is written by the game's rules and read by the game's UI, and every layer
 * between the two is deliberately incapable of interpreting it.
 *
 * NARRATION IS NOT STATE, which is why it has a message of its own rather than
 * a field on `world_state`. State is re-pushed whenever any part of it moves,
 * so a line carried on it would be re-delivered on every later push; and a
 * view answers "what is here", while an event answers "what just happened" --
 * a thing that leaves no trace in the tree for a view to report.
 */
export interface WorldNarration {
  readonly scope: string;
  readonly payload: unknown;
  /**
   * THE SENTENCE, IF THE GAME WROTE ONE (BoardSmith #170).
   *
   * `payload` is the board's and stays uninterpretable by everything between
   * the rules and the game's own UI. But the shared shell has a message log now,
   * and a log that could only print JSON would be a debug console rather than
   * chrome -- which is exactly what `WorldDevBoard` was.
   *
   * So the game writes the line it wants said, in the same shape a table's
   * `game.messages` already has (`GameHistory` takes `string | {text, type}`).
   * OPTIONAL, and absent means silence: an event with no `text` puts no line in
   * the log. The shell renders nothing rather than inventing a sentence out of a
   * scope name and a payload it is not allowed to read.
   */
  readonly text?: string;
  /** The line's kind, verbatim to `GameHistory` -- what a table's message log
   *  already carries. Presentation only; the shell never reads it as a rule. */
  readonly type?: string;
}

/**
 * ONE SEAT'S IDENTITY, AS THE HOST KNOWS IT (BoardSmith #170).
 *
 * The shared shell draws a seat row per player, and a row needs a name. A
 * TABLE's names come from `PlayerState.players`, which the session composes from
 * the lobby. A world has no lobby: the wire carries a seat number and a presence
 * set, and who seat 7 IS belongs to whoever owns accounts -- ShufflewickPub, or
 * `boardsmith dev`'s seat switcher.
 *
 * So the host composes this and BoardSmith never derives it. A host that sends
 * nothing gets seat-numbered rows, which is honest: the shell knows the seat and
 * does not know the person. Inventing "Player 7" inside the library would be a
 * name that outranks the real one on the platform that has it.
 */
export interface WorldPlayer {
  readonly seat: number;
  readonly name: string;
  readonly color?: string;
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
  /** What this seat may do, enumerated over what it can see. Empty until the
   *  world has said. */
  readonly actions: readonly WorldActionOffer[];
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
  /**
   * Who the seats are, host-composed, or absent when the host has no names to
   * give. See {@link WorldPlayer}: the shell renders seat numbers without it and
   * never derives a name of its own.
   */
  readonly players?: readonly WorldPlayer[];
}

/**
 * WHAT THE WORLD HAS JUST NARRATED to the seat this frame belongs to.
 *
 * ONE DELIVERY. Every message is news that has not been sent before, so a UI
 * appends rather than replaces -- `useWorldHost` does that appending, and its
 * `events` ref is the log a world UI renders.
 */
interface WorldEventsMessage {
  readonly source: typeof WORLD_HOST_SOURCE;
  readonly type: 'world_events';
  readonly events: readonly WorldNarration[];
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
 * The message shapes above are not exported individually on purpose: a reader
 * of this protocol only ever handles the union -- one listener, one switch --
 * and exported names nothing imports are things a future change can leave
 * behind. `WorldNarration` IS exported, because it is not a message: it is the
 * item a game's own UI declares a prop of.
 */
export type WorldHostMessage =
  | WorldStateMessage
  | WorldEventsMessage
  | WorldResponseMessage;

/** What one command becomes on the wire. */
interface WorldCommandMessage {
  readonly source: typeof WORLD_UI_SOURCE;
  readonly type: 'world_command';
  readonly requestId: string;
  /** The action's name, from the offer this seat was given. */
  readonly action: string;
  /** Every selection's resolved value, by selection name. An element selection
   *  carries the element's id, which is what `chooseElement`'s wire encoding
   *  already is. */
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
