/**
 * The game's state version (#631): a number every change the engine can see
 * advances, so an answer worked out from the game (a pick's choices) can be
 * reused for as long as the number stands still.
 *
 * WHAT ADVANCES IT: the elements' tree methods (create, move, remove, shuffle
 * and the rest, which pass through `childrenChanged`); every call into game
 * code that runs inside {@link changing} (an action's `execute`, a pick's
 * `onSelect`, `onCancel` and `onEach`, the flow's `setup`, `execute` steps and
 * phase hooks, a space's `onEnter`/`onExit` handlers, a bot's `determinize`
 * sampler and a tutorial's `setup`); a random draw; a restore of the tree;
 * every write of `game.phase` (`start()`, `finish()`, the flow starting and
 * ending); and a write through `actionTempState`.
 *
 * WHAT IT DOES NOT SEE: an attribute is a bare property with no write
 * chokepoint, so an attribute or `game.settings` write made anywhere else (a
 * describing callback such as `choices` or `filter`, a flow condition such as
 * a `while`, an `eachPlayer` `filter` or an `actionStep` `player`, or code
 * outside the game holding it directly) is not seen until the next change that
 * is. Development mode reuses no answer, which is what lets a test write to a
 * game directly between two questions.
 *
 * The flow's position is not versioned at all; an answer that reads it is not
 * kept (see {@link flowStateRead}).
 *
 * Two things reuse answers by it: a pick's candidates (`../action/choice-cache.ts`)
 * and the facts a game remembers with `game.oncePerState` ({@link oncePerState}).
 */
import { isDevMode } from '../../utils/dev.js';
import type { ElementContext } from './types.js';

/**
 * Note a read of the flow's state (its position or its last action's result).
 * The flow asks for a step's choices before it publishes that step, so an
 * answer that read the flow's state is not kept.
 */
export function flowStateRead(ctx: ElementContext): void {
  ctx._flowStateReads++;
}

/**
 * Whether an answer worked out earlier in this state version may be given
 * again now. Development mode works every answer out afresh, so a test may
 * write to a game directly between two questions; world mode must find every
 * element through the tree, since handing one out is what marks its partition;
 * and game code that may change the game may ask, write, and ask again.
 */
export function answersReusable(ctx: ElementContext): boolean {
  return !isDevMode() && ctx._worldMode !== true && ctx._changingDepth === 0;
}

/** The facts remembered with {@link oncePerState} in one state version, by key. */
const remembered = new WeakMap<ElementContext, { version: number; values: Map<string, unknown> }>();

/**
 * `workOut()`'s value for `key`, from an earlier run in the same state version
 * when there is one (`Game.oncePerState` says how a game uses it).
 */
export function oncePerState<T>(ctx: ElementContext, key: string, workOut: () => T): T {
  if (!answersReusable(ctx)) return workOut();
  let kept = remembered.get(ctx);
  if (kept?.version !== ctx._stateVersion) remembered.set(ctx, (kept = { version: ctx._stateVersion, values: new Map() }));
  if (kept.values.has(key)) return kept.values.get(key) as T;
  const flowReads = ctx._flowStateReads;
  const value = workOut();
  // A value whose work changed the game is filed under a version that has
  // passed, so it is never found. One that read the flow's state is not filed.
  if (ctx._flowStateReads === flowReads) kept.values.set(key, value);
  return value;
}

/** Mark the game changed: every answer worked out before now is stale. */
export function stateChanged(ctx: ElementContext): void {
  ctx._stateVersion++;
}

/**
 * Run game code that may change the game. While it runs, no answer is reused
 * (it may write, then ask again), and afterwards the game is marked changed,
 * whether the code returned or threw.
 */
export function changing<T>(ctx: ElementContext, run: () => T): T {
  ctx._changingDepth++;
  try {
    return run();
  } finally {
    ctx._changingDepth--;
    stateChanged(ctx);
  }
}
