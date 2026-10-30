/**
 * Per-seat undo in a simultaneous step declared `seatUndo: true` (#1526).
 *
 * A checkpoint is the whole game at one point of the interleaved history, so
 * restoring one would take back every other seat's actions too. Here each seat
 * keeps, per action, how its own `Player` stood before it, and an undo puts
 * that one element back in place, leaving everything else as it is. That is
 * sound only for an action that changed nothing else, so every op a seat takes
 * in the step is checked: an action that changed anything outside the seat's
 * own `Player`, drew a random number, or wrote a log line or animation another
 * seat receives is where that seat's undo stops. Still restore, never replay.
 */
import type { Game } from '../engine/index.js';
import type { HistoryEntry } from '../engine/action/types.js';
import { isSeatExpiry } from '../engine/action/types.js';
import { heldFollowUpIn } from '../engine/flow/engine.js';
import type { SeatUndoEntry, SeatUndoFence, SeatUndoStack, SeatUndoState } from '../engine/utils/snapshot.js';

/** The game split into each seat's own `Player` and everything else, as JSON text, for comparing. */
interface SeatParts {
  players: Map<number, string>;
  rest: string;
  random: string;
  animationSeats: Record<string, number>;
  messageCount: number;
}

function seatParts(game: Game): SeatParts {
  const root = game.toJSON();
  const seatById = new Map(game.players.map((player) => [player.id, player.seat]));
  const players = new Map<number, string>();
  const others = [];
  for (const child of root.children ?? []) {
    const seat = seatById.get(child.id);
    if (seat === undefined) others.push(child);
    else players.set(seat, JSON.stringify(child));
  }
  // The animation buffer is cleared as every action starts, and its counters are checked per seat below.
  const { animationEvents: _events, animationEventSeq: _seq, animationSeqBySeat, ...shared } = root;
  return {
    players,
    rest: JSON.stringify({ ...shared, children: others }),
    random: game.getRandomState(),
    animationSeats: animationSeqBySeat ?? {},
    messageCount: game.messageCount,
  };
}

/** The refusal a seat reads once `name` ended its undo's reach for `fence`. */
function fenceMessage(name: string, fence: SeatUndoFence): string {
  switch (fence) {
    case 'outside': return `Cannot undo: ${name} changed the game outside your own player, so it cannot be taken back on its own.`;
    case 'random': return `Cannot undo: ${name} drew a random number, which an undo cannot take back without drawing it again.`;
    case 'log': return `Cannot undo: ${name} wrote a line other seats can read.`;
    case 'animation': return `Cannot undo: ${name} played an animation other seats can see.`;
  }
}

/** Why a history entry that is not undoable ends its seat's undo. */
function notUndoableMessage(entry: HistoryEntry): string {
  if (isSeatExpiry(entry)) {
    return `Cannot undo: seat ${entry.player}'s time ran out and the host closed its part of the step, which cannot be taken back.`;
  }
  return `Cannot undo: ${'name' in entry ? entry.name : 'that action'} is marked notUndoable.`;
}

/** The parts of the runner {@link watchSeatOp} reads and writes. */
interface SeatUndoHost {
  readonly game: Game;
  readonly actionCount: number;
  readonly actionHistory: readonly HistoryEntry[];
  /** `max` is how many undo steps a seat keeps. */
  readonly checkpointPolicy: { readonly max: number };
  /** The open step's per-seat undo, if a step that undoes per seat is open. */
  seatUndo: SeatUndoState | undefined;
}

/** The action count the open step began at, while that step undoes per seat. */
export function seatUndoStepStart(game: Game, actionCount: number): number | undefined {
  const flow = game.getFlowState();
  return flow?.seatUndo ? actionCount - (flow.moveCount ?? 0) : undefined;
}

/**
 * Watch one op `seat` takes (an action, or one pick of one): call before the
 * op runs, and call what it returns once the op is done. A no-op outside a
 * step that undoes per seat.
 */
export function watchSeatOp(host: SeatUndoHost, seat: number): (() => void) | undefined {
  const stepStart = seatUndoStepStart(host.game, host.actionCount);
  if (stepStart === undefined) return undefined;
  const before = seatParts(host.game);
  const followUp = heldFollowUpIn(host.game.getFlowState()!, seat);
  const countBefore = host.actionCount;

  return () => {
    const state = openState(host, stepStart);
    if (!state) return;
    const after = seatParts(host.game);
    const othersChanged = fenceOtherSeats(state, before, after, seat);
    const lines = linesFor(host.game, before.messageCount, seat);
    const stack = (state.seats[seat] ??= { entries: [] });
    const fence = othersChanged ? 'outside' : fenceOf(before, after, seat, lines);
    const taken = takenSoFar(stack.opening ?? { player: before.players.get(seat)!, followUp, lines: [] }, lines, fence);
    const recorded = host.actionCount > countBefore ? host.actionHistory.at(-1) : undefined;
    if (recorded) settleAction(stack, recorded, taken, host.checkpointPolicy.max);
    else settlePick(stack, taken, after.players.get(seat) !== before.players.get(seat));
  };
}

/** The per-seat undo of the step that opened at `stepStart`, or none (dropping it) once that step is over. */
function openState(host: SeatUndoHost, stepStart: number): SeatUndoState | undefined {
  if (seatUndoStepStart(host.game, host.actionCount) !== stepStart) {
    host.seatUndo = undefined;
    return undefined;
  }
  if (host.seatUndo?.stepStart !== stepStart) host.seatUndo = { stepStart, seats: {} };
  return host.seatUndo;
}

/** How the seat stood before the action now being taken, with what this op added to it. */
function takenSoFar(opening: Opening, lines: number[] | undefined, fence: SeatUndoFence | undefined): Opening {
  return { ...opening, lines: [...opening.lines, ...(lines ?? [])], fence: opening.fence ?? fence };
}

/** End the undo of every seat but `seat` whose own `Player` the op changed; says whether there was one. */
function fenceOtherSeats(state: SeatUndoState, before: SeatParts, after: SeatParts, seat: number): boolean {
  let changed = false;
  for (const [other, json] of after.players) {
    if (other === seat || before.players.get(other) === json) continue;
    changed = true;
    state.seats[other] = { entries: [], fence: "Cannot undo: another seat's action changed your own player since, so your earlier actions cannot be taken back on their own." };
  }
  return changed;
}

type Opening = NonNullable<SeatUndoStack['opening']>;

/** A pick of an action not yet taken: remember how the seat stood before it, and end its undo at a pick it cannot take back. */
function settlePick(stack: SeatUndoStack, taken: Opening, changedPlayer: boolean): void {
  if (stack.opening || changedPlayer || taken.lines.length > 0 || taken.fence) stack.opening = taken;
  if (!taken.fence) return;
  stack.entries = [];
  stack.fence = 'Cannot undo: a pick you made changed what other seats can see, so it cannot be taken back on its own.';
}

/** An action the seat took: one more its undo can take back, or where its undo now stops. */
function settleAction(stack: SeatUndoStack, recorded: HistoryEntry, taken: Opening, max: number): void {
  delete stack.opening;
  if (recorded.undoable === false || taken.fence) {
    stack.entries = [];
    stack.fence = taken.fence ? fenceMessage('name' in recorded ? recorded.name : 'that action', taken.fence) : notUndoableMessage(recorded);
    return;
  }
  stack.entries.push({ player: taken.player, followUp: taken.followUp, lines: taken.lines });
  if (stack.entries.length <= max) return;
  stack.entries.shift();
  stack.fence = `Cannot undo further back: this game keeps at most ${max} undo steps (checkpoints: { max: ${max} }).`;
}

/** The log positions an op wrote since `from`, or `undefined` when one of them reached anyone but `seat`. */
function linesFor(game: Game, from: number, seat: number): number[] | undefined {
  const lines: number[] = [];
  for (let position = from; position < game.messageCount; position++) {
    const to = game.messages[position - game.messagesEvicted]?.to;
    if (!to || to.length === 0 || to.some((s) => s !== seat)) return undefined;
    lines.push(position);
  }
  return lines;
}

/** Why the op cannot be taken back on its own, if it cannot. */
function fenceOf(before: SeatParts, after: SeatParts, seat: number, lines: number[] | undefined): SeatUndoFence | undefined {
  if (after.rest !== before.rest) return 'outside';
  if (after.random !== before.random) return 'random';
  if (lines === undefined) return 'log';
  const recipients = new Set([...Object.keys(before.animationSeats), ...Object.keys(after.animationSeats)]);
  for (const recipient of recipients) {
    if (recipient !== String(seat) && before.animationSeats[recipient] !== after.animationSeats[recipient]) return 'animation';
  }
  return undefined;
}

/**
 * The game's tree as `toJSON()` writes it, with `seat`'s `Player` put back as
 * `entry` saved it: the state an undo of that seat's last action restores.
 */
export function treeWithSeatRestored(game: Game, seat: number, entry: SeatUndoEntry): ReturnType<Game['toJSON']> {
  const root = game.toJSON();
  const id = game.getPlayer(seat)!.id;
  return { ...root, children: root.children!.map((child) => (child.id === id ? JSON.parse(entry.player) : child)) };
}
