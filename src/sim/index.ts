/**
 * boardsmith/sim - the balance simulator's policies (#556).
 *
 * A project lists the policies `boardsmith simulate --policy <name>` may use
 * in its `src/sim/index.ts`:
 *
 * ```typescript
 * import { greedy } from 'boardsmith/sim';
 * import type { MyGame } from '../rules/game.js';
 *
 * export const policies = {
 *   greedy: greedy<MyGame>((game, move, seat) => game.scoreAfter(move, seat)),
 * };
 * ```
 *
 * `random` and `mcts:<level>` are always available by name.
 *
 * @packageDocumentation
 */
export {
  random,
  greedy,
  mcts,
  type Policy,
  type PolicyTurn,
  type PolicyMove,
  type PolicyChoice,
  type SimulatedGame,
} from './policies.js';
export { playGame, type PlayGameConfig } from './play-game.js';
