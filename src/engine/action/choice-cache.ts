/**
 * A pick's candidates, worked out once per game state (#631).
 *
 * The game's candidate code for a pick (`choices`, `elements`, or `from` with
 * `filter`) is run once for a seat in a given state, and every later question
 * about the same pick in the same state is answered from that run: the flow's
 * offer, move enumeration, validation, resolving a submitted value and the
 * UI's request. The game's state version (`../element/state-version.ts`) says
 * when the state has changed; the answers are kept for one version only.
 *
 * An answer is filed under the pick, the seat, and the earlier picks its
 * callbacks actually READ, recorded as they run. A destination list that
 * never reads which piece was picked is worked out once for every piece; a
 * rank list that reads the target seat is worked out once per target.
 *
 * Not reused: in development mode, which works every answer out afresh so a
 * test may write to a game directly between two questions; while game code
 * that may change the game is running (an `execute`, a flow step), which may
 * ask, write and ask again; in world mode,
 * where handing out an element is what marks its partition for the dirty-set
 * comparison, so every candidate must be found through the tree each time;
 * an answer whose own callbacks changed the game (moved an element or drew
 * from the random source), which is run again as it always was; and an answer
 * whose callbacks read the flow's state (`game.getFlowState()`), since the
 * flow asks for a step's choices before it has moved to that step.
 */
import { isDevMode } from '../../utils/dev.js';
import { isElement } from '../element/game-element.js';
import { flowStateReadCount } from '../element/state-version.js';
import type { Game } from '../element/game.js';
import type { ActionContext, Selection } from './types.js';

/** One worked-out answer, and the earlier picks it depends on: each read pick's key, or the whole args' key. */
interface Answer {
  reads: ReadonlyMap<string, string> | string;
  candidates: readonly unknown[];
}

/** The answers worked out in one state version. */
interface Answers {
  version: number;
  /** By pick, then by seat: a restore makes new player objects for the same seats. */
  bySelection: Map<Selection, Map<number | undefined, Answer[]>>;
}

const answersByGame = new WeakMap<Game, Answers>();

/**
 * The candidates `workOut` gives for `selection` in `context`, from an earlier
 * run in the same game state when there is one.
 *
 * `workOut` is the game's candidate code with the engine's call around it; it
 * is handed a context whose `args` record what it reads. The array returned
 * may be shared with other callers, and must not be changed.
 */
export function reusedCandidates<T>(
  selection: Selection,
  context: ActionContext,
  workOut: (context: ActionContext) => T[],
): T[] {
  const { game } = context;
  if (isDevMode() || game.worldMode || game._ctx._changingDepth > 0) return workOut(context);

  const known = answersFor(game, selection, context.player?.seat);
  const found = known.find((answer) => answerFits(answer, context.args));
  if (found) return found.candidates as T[];

  const reading = readingArgs(context.args);
  const flowReads = flowStateReadCount();
  const candidates = workOut({ ...context, args: reading.args });
  // An answer whose callbacks changed the game is filed under a version that
  // has passed, so it is never found. One that read the flow's position is not
  // filed at all: the version does not follow the flow.
  if (flowStateReadCount() !== flowReads) return candidates;
  const reads = reading.readsKey();
  if (reads !== undefined) known.push({ reads, candidates });
  return candidates;
}

/** The answers kept for `selection` and `seat` in the game's current state version, dropping any older ones. */
function answersFor(game: Game, selection: Selection, seat: number | undefined): Answer[] {
  const version = game._ctx._stateVersion;
  let answers = answersByGame.get(game);
  if (answers?.version !== version) {
    answers = { version, bySelection: new Map() };
    answersByGame.set(game, answers);
  }
  let bySeat = answers.bySelection.get(selection);
  if (!bySeat) answers.bySelection.set(selection, (bySeat = new Map()));
  let known = bySeat.get(seat);
  if (!known) bySeat.set(seat, (known = []));
  return known;
}

function answerFits(answer: Answer, args: Record<string, unknown>): boolean {
  if (typeof answer.reads === 'string') return keyOf(args) === answer.reads;
  for (const [name, key] of answer.reads) {
    if (keyOf(args[name]) !== key) return false;
  }
  return true;
}

/**
 * `args` behind a proxy that records which picks are read. Listing its keys
 * (spreading it, `Object.keys`) makes the answer depend on all of them, and
 * writing to it makes the answer not reusable at all.
 */
function readingArgs(args: Record<string, unknown>): {
  args: Record<string, unknown>;
  readsKey: () => ReadonlyMap<string, string> | string | undefined;
} {
  const read = new Set<string>();
  let readAll = false;
  let wrote = false;
  const proxy = new Proxy(args, {
    get(target, name, receiver) {
      if (typeof name === 'string') read.add(name);
      return Reflect.get(target, name, receiver);
    },
    has(target, name) {
      if (typeof name === 'string') read.add(name);
      return Reflect.has(target, name);
    },
    getOwnPropertyDescriptor(target, name) {
      if (typeof name === 'string') read.add(name);
      return Reflect.getOwnPropertyDescriptor(target, name);
    },
    ownKeys(target) {
      readAll = true;
      return Reflect.ownKeys(target);
    },
    set(target, name, value, receiver) {
      wrote = true;
      return Reflect.set(target, name, value, receiver);
    },
    defineProperty(target, name, attributes) {
      wrote = true;
      return Reflect.defineProperty(target, name, attributes);
    },
    deleteProperty(target, name) {
      wrote = true;
      return Reflect.deleteProperty(target, name);
    },
  });
  return {
    args: proxy,
    readsKey: () => {
      if (wrote) return undefined;
      if (readAll) return keyOf(args);
      const keys = new Map<string, string>();
      for (const name of read) {
        const key = keyOf(args[name]);
        if (key === undefined) return undefined;
        keys.set(name, key);
      }
      return keys;
    },
  };
}

/**
 * A pick's value as a string that two equal values share: an element by its
 * id, arrays and plain objects by their contents. Undefined for a value it
 * cannot key (a class instance, a function, a symbol), whose answer is not kept.
 */
function keyOf(value: unknown): string | undefined {
  if (typeof value === 'object' && value !== null) return objectKey(value);
  if (value === undefined) return 'u';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function objectKey(value: object): string | undefined {
  if (isElement(value)) return `#${value.id}`;
  if (Array.isArray(value)) return joinKeys('[', value.map(keyOf), ']');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const entries = Object.keys(value)
    .sort()
    .map((name) => {
      const key = keyOf((value as Record<string, unknown>)[name]);
      return key === undefined ? undefined : `${JSON.stringify(name)}:${key}`;
    });
  return joinKeys('{', entries, '}');
}

function joinKeys(open: string, keys: (string | undefined)[], close: string): string | undefined {
  return keys.includes(undefined) ? undefined : `${open}${keys.join(',')}${close}`;
}
