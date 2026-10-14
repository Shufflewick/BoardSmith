/**
 * WHAT A GAME'S COMPILER SEES OF `project-game-options.node.ts` (#701), for the
 * reason `project-test-utils.d.ts` gives: reading the project's file takes Node,
 * and a game compiles `boardsmith/testing` under a tsconfig with no Node types.
 * `test-game.ts` and the bot benchmark (`bot-trainer/benchmark.ts`) import it as
 * `#testing/project-game-options`.
 */
import type { GameOptionDefinition } from '../types/protocol.js';

/**
 * The game options `boardsmith.json` declares in the directory the tests run
 * in, keyed by id, or `undefined` when that directory has no `boardsmith.json`
 * (BoardSmith's own tests, which run no project).
 *
 * @throws When the file is not JSON or its `gameOptions` list is unusable, naming the problem.
 */
export function projectGameOptions(): Record<string, GameOptionDefinition> | undefined;
