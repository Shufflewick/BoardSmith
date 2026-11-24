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
 * one of them or picks one. Element references in the saved JSON are written
 * by id, so a restore that moves elements leaves no reference pointing at a
 * shifted branch.
 */
import type { Game } from '../engine/index.js';
import { isElement } from '../engine/element/game-element.js';
import type { HistoryEntry } from '../engine/action/types.js';
import { isSeatExpiry } from '../engine/action/types.js';
import { heldFollowUpIn } from '../engine/flow/engine.js';
import type { SeatUndoEntry, SeatUndoFence, SeatUndoStack, SeatUndoState } from '../engine/utils/snapshot.js';

/** The game split into each seat's own `Player` and everything else, as JSON text, for comparing. */
interface SeatParts {
  players: Map<number, string>;
  /** Everything outside every `Player`, one record per element: see {@link boardRecords}. */
  board: Map<string, string>;
  /** The log's eviction counters, which only the log owns. */
  eviction: string;
  random: string;
  animationSeats: Record<string, number>;
  messageCount: number;
}

function seatParts(game: Game): SeatParts {
  const root = treeByIds(game);
  const seatById = new Map(game.players.map((player) => [player.id, player.seat]));
  const players = new Map<number, string>();
  for (const child of root.children ?? []) {
    const seat = seatById.get(child.id);
    if (seat !== undefined) players.set(seat, JSON.stringify(child));
  }
  const { messagesEvicted, messagesEvictedPublic, messagesEvictedTo, messagesShownFrom } = root;
  return {
    players,
    board: boardRecords(root, new Set(seatById.keys())),
    eviction: JSON.stringify([messagesEvicted, messagesEvictedPublic, messagesEvictedTo, messagesShownFrom]),
    random: game.getRandomState(),
    animationSeats: root.animationSeqBySeat ?? {},
    messageCount: game.messageCount,
  };
}

type GameJSON = ReturnType<Game['toJSON']>;
type ElementJSON = NonNullable<GameJSON['children']>[number];

/** The game as `toJSON()` writes it, with every element reference by id rather than by branch. */
function treeByIds(game: Game): GameJSON {
  const root = game.toJSON();
  const ids = new Map<string, number>([['', root.id]]);
  const index = (nodes: readonly ElementJSON[] | undefined, prefix: string) => nodes?.forEach((node, i) => {
    const branch = prefix === '' ? String(i) : `${prefix}/${i}`;
    ids.set(branch, node.id);
    index(node.children, branch);
  });
  index(root.children, '');
  index(root.pile, PILE);
  const byId = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(byId);
    if (typeof value !== 'object' || value === null) return value;
    if ('__elementRef' in value && typeof value.__elementRef === 'string' && ids.has(value.__elementRef)) {
      return { __elementId: ids.get(value.__elementRef) };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, byId(item)]));
  };
  return byId(root) as GameJSON;
}

/** Key of the root's own record, and of the pile's, among the element ids. */
const ROOT = 'root';
const PILE = 'pile';

/**
 * Every element outside every `Player` as one record, keyed by id: its JSON
 * with its container's key and its children's ids in place of the children,
 * so a move changes the moved element and both containers, and no other
 * record. The root's record names every child, the players too.
 */
function boardRecords(root: GameJSON, playerIds: ReadonlySet<number>): Map<string, string> {
  const records = new Map<string, string>();
  const add = (key: string, record: object, children: readonly ElementJSON[] | undefined) => {
    records.set(key, JSON.stringify({ ...record, ...(children && { children: children.map((child) => child.id) }) }));
    for (const { children: grandchildren, ...child } of children ?? []) {
      if (!playerIds.has(child.id)) add(String(child.id), { ...child, parent: key }, grandchildren);
    }
  };
  const { children, pile, ...own } = withoutBookkeeping(root);
  add(ROOT, own, children);
  if (pile) add(PILE, {}, pile);
  return records;
}

/**
 * The root less what is not the board's: the animation buffer, cleared as
 * every action starts, and its counters, checked per seat; and the log's
 * eviction counters, which a restore leaves as the log has them.
 */
function withoutBookkeeping(root: GameJSON) {
  const { animationEvents: _events, animationEventSeq: _seq, animationSeqBySeat: _bySeat, messagesEvicted: _evicted, messagesEvictedPublic: _public, messagesEvictedTo: _to, messagesShownFrom: _shown, ...board } = root;
  return board;
}

/** How each board record `after` changed stood in `before`, `null` for one that did not exist. */
function boardChanges(before: Map<string, string>, after: Map<string, string>): Record<string, string | null> {
  const changed: Record<string, string | null> = {};
  for (const [key, record] of before) if (after.get(key) !== record) changed[key] = record;
  for (const key of after.keys()) if (!before.has(key)) changed[key] = null;
  return changed;
}

/** The ids of the elements `value` (an op's args or picks) names: each element, and each number, which may be an element's id. */
function elementsNamed(value: unknown, into: Set<string>): void {
  if (typeof value === 'number') into.add(String(value));
  else if (isElement(value)) into.add(String(value.id));
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) elementsNamed(item, into);
}

/** The refusal a seat reads once `name` ended its undo's reach for `fence`. */
function fenceMessage(name: string, fence: SeatUndoFence): string {
  switch (fence) {
    case 'outside': return `Cannot undo: ${name} changed the game outside your own player, so it cannot be taken back on its own.`;
    case 'random': return `Cannot undo: ${name} drew a random number, which an undo cannot take back without drawing it again.`;
    case 'log': return `Cannot undo: ${name} wrote a line other seats can read.`;
    case 'animation': return `Cannot undo: ${name} played an animation other seats can see.`;
    case 'board': return `Cannot undo: another seat's action since changed or used part of the board ${name} changed, so it cannot be taken back on its own.`;
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

/** One op a seat takes, as {@link watchSeatOp} is told it. */
export interface SeatOp {
  /** The action the op takes, or the pending action it picks for or cancels. */
  action?: string;
  /** The args or picks the op hands the action, whose elements it relies on. */
  named?: unknown;
  /** The op cancels the action the seat started. */
  cancel?: boolean;
}

/**
 * Watch one op `seat` takes (an action, one pick of one, or the cancel of an
 * action it started): call before the op runs, and call what it returns once
 * the op is done. A no-op outside a step that undoes per seat.
 */
export function watchSeatOp(host: SeatUndoHost, seat: number, op: SeatOp): (() => void) | undefined {
  const stepStart = seatUndoStepStart(host.game, host.actionCount);
  if (stepStart === undefined) return undefined;
  const before = seatParts(host.game);
  const followUp = heldFollowUpIn(host.game.getFlowState()!, seat);
  const countBefore = host.actionCount;

  return () => {
    const state = openState(host, stepStart);
    if (!state) return;
    const after = seatParts(host.game);
    const board = boardChanges(before.board, after.board);
    const touched = new Set(Object.keys(board));
    elementsNamed(op.named, touched);
    fenceBoardDependents(state, touched, seat);
    const othersChanged = fenceOtherSeats(state, before, after, seat);
    const lines = linesFor(host.game, before.messageCount, seat);
    const stack = (state.seats[seat] ??= { entries: [] });
    const fence = othersChanged ? 'outside' : fenceOf(before, after, seat, lines, undeclaredBoardChange(host.game, op, board));
    const taken = takenSoFar(stack.opening ?? { player: before.players.get(seat)!, followUp, lines: [] }, lines, fence, board);
    const recorded = host.actionCount > countBefore ? host.actionHistory.at(-1) : undefined;
    if (recorded) settleAction(stack, recorded, taken, host.checkpointPolicy.max);
    else settlePick(stack, taken, after.players.get(seat) !== before.players.get(seat), fence);
    if (op.cancel && stack.opening) settleCancel(stack, after.players.get(seat)!, after.board);
  };
}

/** Whether the op changed the board for an action not declared `.seatUndoable()`. */
function undeclaredBoardChange(game: Game, op: SeatOp, board: Record<string, string | null>): boolean {
  return Object.keys(board).length > 0 && (op.action === undefined || game.getAction(op.action)?.seatUndoable !== true);
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
function takenSoFar(opening: Opening, lines: number[] | undefined, fence: SeatUndoFence | undefined, board: Record<string, string | null>): Opening {
  // An element an earlier pick already changed is put back as it stood before that pick.
  const changed = { ...board, ...opening.board };
  return {
    ...opening,
    lines: [...opening.lines, ...(lines ?? [])],
    fence: opening.fence ?? fence,
    ...(Object.keys(changed).length > 0 && { board: changed }),
  };
}

/**
 * Cut every other seat's undo back past its newest action whose board changes
 * `touched` (the elements `seat`'s op changed or picked) reaches: undoing that
 * one would take back what this op relied on or changed.
 */
function fenceBoardDependents(state: SeatUndoState, touched: ReadonlySet<string>, seat: number): void {
  if (touched.size === 0) return;
  const reaches = (entry: SeatUndoEntry) => Object.keys(entry.board ?? {}).some((key) => touched.has(key));
  for (const [other, stack] of Object.entries(state.seats)) {
    if (Number(other) === seat) continue;
    if (stack.opening && reaches(stack.opening)) stack.opening.fence = 'board';
    const reached = stack.entries.map(reaches).lastIndexOf(true);
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
function settlePick(stack: SeatUndoStack, taken: Opening, changedPlayer: boolean, fence: SeatUndoFence | undefined): void {
  if (stack.opening || changedPlayer || taken.lines.length > 0 || taken.fence || taken.board) stack.opening = taken;
  if (!fence) return;
  stack.entries = [];
  stack.fence = 'Cannot undo: a pick you made changed what other seats can see, so it cannot be taken back on its own.';
}

/**
 * The seat gave up the action it started: what its picks did outside its own
 * `Player` already ended its undo, unless the action is `.seatUndoable()`,
 * whose board changes the cancel must have put back, or they end it here. So
 * nothing of them weighs on its next action. Its `Player` as it stood before
 * the picks is kept only while the cancel left it changed, so its next action
 * is taken back to there.
 */
function settleCancel(stack: SeatUndoStack, player: string, board: ReadonlyMap<string, string>): void {
  const opening = stack.opening!;
  if (Object.entries(opening.board ?? {}).some(([key, record]) => (board.get(key) ?? null) !== record)) {
    delete stack.opening;
    stack.entries = [];
    stack.fence = 'Cannot undo: you gave up an action whose picks changed the board, and the board stays as they left it.';
    return;
  }
  if (opening.player === player) delete stack.opening;
  else stack.opening = { player: opening.player, followUp: opening.followUp, lines: opening.lines };
}

/** An action the seat took: one more its undo can take back, or where its undo now stops. */
function settleAction(stack: SeatUndoStack, recorded: HistoryEntry, taken: Opening, max: number): void {
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
  if (undeclaredBoard || after.eviction !== before.eviction) return 'outside';
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
export function treeWithSeatRestored(game: Game, seat: number, entry: SeatUndoEntry): GameJSON {
  const root = treeByIds(game);
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
