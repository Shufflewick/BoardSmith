/**
 * WHAT A GAME'S COMPILER SEES OF `project-game-options.node.ts` (#701), for the
 * reason `project-test-utils.d.ts` gives: reading the project's file takes Node,
 * and a game compiles `boardsmith/testing` under a tsconfig with no Node types.
 * `test-game.ts` and the bot benchmark (`bot-trainer/benchmark.ts`) import it as
 * `#testing/project-game-options`.
 */
import type { GameOptionDefinition } from '../types/protocol.js';

/**
 * The game options declared by the nearest `boardsmith.json` at or above the
 * directory the tests run in, keyed by id, or `undefined` when the nearest
 * project above it is BoardSmith's own checkout (its own tests, which run no
 * game).
 *
 * @throws When there is no `boardsmith.json` and no BoardSmith checkout above
 * the directory, when the file is not JSON, or when its `gameOptions` list is
 * unusable, naming the problem.
 */
export function projectGameOptions(): Record<string, GameOptionDefinition> | undefined;
