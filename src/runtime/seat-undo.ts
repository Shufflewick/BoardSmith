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
 *
 * An action declared `.seatUndoable()` may also change the shared board
 * (#1787): its seat keeps, per element it changed, how that element stood
 * before, and its undo puts those back too, until another seat's op changes
 * one of them or its action picks one.
 */
import type { Game } from '../engine/index.js';
import type { HistoryEntry } from '../engine/action/types.js';
import { isSeatExpiry } from '../engine/action/types.js';
import { heldFollowUpIn } from '../engine/flow/engine.js';
import type { SeatUndoEntry, SeatUndoFence, SeatUndoStack, SeatUndoState } from '../engine/utils/snapshot.js';

/** The game split into each seat's own `Player` and everything else, as JSON text, for comparing. */
interface SeatParts {
  root: ReturnType<Game['toJSON']>;
  players: Map<number, string>;
  /** Everything outside every `Player`, one record per element: see {@link boardRecords}. */
  board: Map<string, string>;
  random: string;
  animationSeats: Record<string, number>;
  messageCount: number;
}

function seatParts(game: Game): SeatParts {
  const root = game.toJSON();
  const seatById = new Map(game.players.map((player) => [player.id, player.seat]));
  const players = new Map<number, string>();
  for (const child of root.children ?? []) {
    const seat = seatById.get(child.id);
    if (seat !== undefined) players.set(seat, JSON.stringify(child));
  }
  return {
    root,
    players,
    board: boardRecords(root, new Set(seatById.keys())),
    random: game.getRandomState(),
    animationSeats: root.animationSeqBySeat ?? {},
    messageCount: game.messageCount,
  };
}

type ElementJSON = NonNullable<ReturnType<Game['toJSON']>['children']>[number];

/** Key of the root's own record, and of the pile's, among the element ids. */
const ROOT = 'root';
const PILE = 'pile';

/**
 * Every element outside every `Player` as one record, keyed by id: its JSON
 * with its container's key and its children's ids in place of the children,
 * so a move changes the moved element and both containers, and no other
 * record. The root's record names every child, the players too.
 */
function boardRecords(root: ReturnType<Game['toJSON']>, playerIds: ReadonlySet<number>): Map<string, string> {
  const records = new Map<string, string>();
  const add = (key: string, record: object, children: readonly ElementJSON[] | undefined) => {
    records.set(key, JSON.stringify({ ...record, ...(children && { children: children.map((child) => child.id) }) }));
    for (const { children: grandchildren, ...child } of children ?? []) {
      if (!playerIds.has(child.id)) add(String(child.id), { ...child, parent: key }, grandchildren);
    }
  };
  // The animation buffer is cleared as every action starts, and its counters are checked per seat.
  const { children, pile, animationEvents: _events, animationEventSeq: _seq, animationSeqBySeat: _bySeat, ...own } = root;
  add(ROOT, own, children);
  if (pile) add(PILE, {}, pile);
  return records;
}

/** How each board record `after` changed stood in `before`, `null` for one that did not exist. */
function boardChanges(before: Map<string, string>, after: Map<string, string>): Record<string, string | null> {
  const changed: Record<string, string | null> = {};
  for (const [key, record] of before) if (after.get(key) !== record) changed[key] = record;
  for (const key of after.keys()) if (!before.has(key)) changed[key] = null;
  return changed;
}

/** The records of the elements an action's recorded args name, found in the tree the action began from. */
function elementsNamed(value: unknown, root: ReturnType<Game['toJSON']>, into: Set<string>): void {
  if (typeof value !== 'object' || value === null) return;
  if ('__elementId' in value) into.add(String(value.__elementId));
  else if ('__elementRef' in value && typeof value.__elementRef === 'string') {
    const key = recordAtBranch(root, value.__elementRef);
    if (key) into.add(key);
  } else for (const item of Object.values(value)) elementsNamed(item, root, into);
}

/** The record key of the element at `branch` (`GameElement.branch()`) in `root`. */
function recordAtBranch(root: ReturnType<Game['toJSON']>, branch: string): string | undefined {
  if (branch === '') return ROOT;
  const [head, ...rest] = branch.split('/');
  const fromPile = head === PILE;
  let siblings = fromPile ? root.pile : root.children;
  let node: ElementJSON | undefined;
  for (const index of fromPile ? rest : [head, ...rest]) {
    node = siblings?.[Number(index)];
    siblings = node?.children;
  }
  return node && String(node.id);
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
export function notUndoableMessage(entry: HistoryEntry): string {
  if (isSeatExpiry(entry)) {
    return `Cannot undo: seat ${entry.player}'s time ran out and the host closed its part of the step, which cannot be taken back.`;
  }
  if ('timedOut' in entry && entry.timedOut) {
    return `Cannot undo: seat ${entry.player}'s time ran out and the host took ${entry.name} for it, which cannot be taken back.`;
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
 * Watch one op `seat` takes (an action, one pick of one, or the cancel of an
 * action it started): call before the op runs, and call what it returns once
 * the op is done. A no-op outside a step that undoes per seat.
 */
export function watchSeatOp(host: SeatUndoHost, seat: number, cancel = false): (() => void) | undefined {
  const stepStart = seatUndoStepStart(host.game, host.actionCount);
  if (stepStart === undefined) return undefined;
  const before = seatParts(host.game);
  const followUp = heldFollowUpIn(host.game.getFlowState()!, seat);
  const countBefore = host.actionCount;

  return () => {
    const state = openState(host, stepStart);
    if (!state) return;
    const after = seatParts(host.game);
    const recorded = host.actionCount > countBefore ? host.actionHistory.at(-1) : undefined;
    const board = boardChanges(before.board, after.board);
    const touched = new Set(Object.keys(board));
    if (recorded && 'args' in recorded) elementsNamed(recorded.args, before.root, touched);
    fenceBoardDependents(state, touched, seat);
    const othersChanged = fenceOtherSeats(state, before, after, seat);
    const lines = linesFor(host.game, before.messageCount, seat);
    const stack = (state.seats[seat] ??= { entries: [] });
    const declared = recorded !== undefined && 'name' in recorded && host.game.getAction(recorded.name)?.seatUndoable === true;
    const boardChanged = Object.keys(board).length > 0;
    const fence = othersChanged ? 'outside' : fenceOf(before, after, seat, lines, boardChanged && !declared);
    const taken = takenSoFar(stack.opening ?? { player: before.players.get(seat)!, followUp, lines: [] }, lines, fence);
    if (recorded) settleAction(stack, recorded, { ...taken, ...(boardChanged && { board }) }, host.checkpointPolicy.max);
    else settlePick(stack, taken, after.players.get(seat) !== before.players.get(seat));
    if (cancel && stack.opening) settleCancel(stack, after.players.get(seat)!);
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

/**
 * Cut every other seat's undo back past its newest action whose board changes
 * `touched` (the elements `seat`'s op changed or picked) reaches: undoing that
 * one would take back what this op relied on or changed.
 */
function fenceBoardDependents(state: SeatUndoState, touched: ReadonlySet<string>, seat: number): void {
  if (touched.size === 0) return;
  for (const [other, stack] of Object.entries(state.seats)) {
    if (Number(other) === seat) continue;
    const reached = stack.entries.map((entry) => Object.keys(entry.board ?? {}).some((key) => touched.has(key))).lastIndexOf(true);
    if (reached < 0) continue;
    stack.entries = stack.entries.slice(reached + 1);
    stack.fence = "Cannot undo: another seat's action since changed or used part of the board your earlier action changed, so it cannot be taken back on its own.";
  }
}

/** End the undo of every seat but `seat` whose own `Player` the op changed; says whether there was one. */
function fenceOtherSeats(state: SeatUndoState, before: SeatParts, after: SeatParts, seat: number): boolean {
  let changed = false;
  for (const [other, json] of after.players) {
    if (other === seat || before.players.get(other) === json) continue;
    changed = true;
    // An action the seat is partway through can no longer be taken back on its own either.
    const opening = state.seats[other]?.opening;
    state.seats[other] = {
      entries: [],
      fence: "Cannot undo: another seat's action changed your own player since, so your earlier actions cannot be taken back on their own.",
      ...(opening && { opening: { ...opening, fence: 'outside' as const } }),
    };
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

/**
 * The seat gave up the action it started: what its picks did outside its own
 * `Player` already ended its undo, so nothing of them weighs on its next
 * action. Its `Player` as it stood before the picks is kept only while the
 * cancel left it changed, so its next action is taken back to there.
 */
function settleCancel(stack: SeatUndoStack, player: string): void {
  const opening = stack.opening!;
  if (opening.player === player) delete stack.opening;
  else stack.opening = { player: opening.player, followUp: opening.followUp, lines: opening.lines };
}

/** An action the seat took: one more its undo can take back, or where its undo now stops. */
function settleAction(stack: SeatUndoStack, recorded: HistoryEntry, taken: Opening & Pick<SeatUndoEntry, 'board'>, max: number): void {
  delete stack.opening;
  if (recorded.undoable === false || taken.fence) {
    stack.entries = [];
    stack.fence = taken.fence ? fenceMessage('name' in recorded ? recorded.name : 'that action', taken.fence) : notUndoableMessage(recorded);
    return;
  }
  stack.entries.push({ player: taken.player, followUp: taken.followUp, lines: taken.lines, ...(taken.board && { board: taken.board }) });
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
function fenceOf(before: SeatParts, after: SeatParts, seat: number, lines: number[] | undefined, undeclaredBoard: boolean): SeatUndoFence | undefined {
  if (undeclaredBoard) return 'outside';
  if (after.random !== before.random) return 'random';
  if (lines === undefined) return 'log';
  const recipients = new Set([...Object.keys(before.animationSeats), ...Object.keys(after.animationSeats)]);
  for (const recipient of recipients) {
    if (recipient !== String(seat) && before.animationSeats[recipient] !== after.animationSeats[recipient]) return 'animation';
  }
  return undefined;
}

/**
 * The game's tree as `toJSON()` writes it, with `seat`'s `Player`, and each
 * board element its action changed, put back as `entry` saved them: the state
 * an undo of that seat's last action restores.
 */
export function treeWithSeatRestored(game: Game, seat: number, entry: SeatUndoEntry): ReturnType<Game['toJSON']> {
  const root = game.toJSON();
  const id = game.getPlayer(seat)!.id;
  const children = root.children!.map((child) => (child.id === id ? JSON.parse(entry.player) as ElementJSON : child));
  if (!entry.board) return { ...root, children };

  const playerIds = new Set(game.players.map((player) => player.id));
  const players = new Map(children.filter((child) => playerIds.has(child.id)).map((child) => [child.id, child]));
  const records = boardRecords(root, playerIds);
  for (const [key, record] of Object.entries(entry.board)) {
    if (record === null) records.delete(key);
    else records.set(key, record);
  }
  const build = (key: string): ElementJSON => {
    const { children: ids, parent: _parent, ...own } = JSON.parse(records.get(key)!) as Omit<ElementJSON, 'children'> & { children?: number[]; parent?: string };
    return { ...own, ...(ids && { children: ids.map((child) => players.get(child) ?? build(String(child))) }) };
  };
  const { pile: _pile, ...kept } = root;
  const pile = records.has(PILE) ? build(PILE).children : undefined;
  return { ...kept, ...build(ROOT), ...(pile && { pile }) };
}
