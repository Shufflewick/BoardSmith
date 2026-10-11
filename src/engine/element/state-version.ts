/**
 * The game's state version (#631): a number every change to the game
 * advances, so an answer worked out from the game (a pick's choices) can be
 * reused for as long as the number stands still.
 *
 * THE RULE: a game changes only through its elements' tree methods (create,
 * move, remove, shuffle and the rest, which pass through `childrenChanged`)
 * and inside the game code the engine runs to change it, which runs inside
 * {@link changing}: an action's `execute`, a pick's `onSelect`, `onCancel` and
 * `onEach`, the flow's `setup`, `execute` steps and phase hooks, a space's
 * `onEnter`/`onExit` handlers, a bot's `determinize` sampler and a tutorial's
 * `setup`. Besides those, a random draw, a restore of the tree and the engine's
 * own writes of `game.phase` advance it. An attribute is a bare property with
 * no write chokepoint, so a write from anywhere else (a describing callback
 * such as `filter`, or code outside the game holding it directly) is not seen.
 * Development mode reuses no answer, which is what lets a test write to a game
 * directly between two questions.
 *
 * The flow's own position is not part of what the version describes (the flow
 * asks for a step's choices before it publishes that step), so an answer that
 * reads it is not kept; see {@link flowStateRead}.
 */
import type { ElementContext } from './types.js';

let flowStateReads = 0;

/**
 * Note a read of a flow's state. The flow's position is not part of what the
 * version describes: the flow asks for a step's choices before it publishes
 * that step, so an answer that read the flow's state is not kept.
 */
export function flowStateRead(): void {
  flowStateReads++;
}

/** How many reads of a flow's state there have been, to tell whether some code made one. */
export function flowStateReadCount(): number {
  return flowStateReads;
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
