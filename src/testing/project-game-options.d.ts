/**
 * WHAT A GAME'S COMPILER SEES OF `project-game-options.node.ts` (#701), for the
 * reason `project-test-utils.d.ts` gives: reading the project's file takes Node,
 * and a game compiles `boardsmith/testing` under a tsconfig with no Node types.
 * `test-game.ts`, `headless-session.ts` and the bot benchmark (`bot-trainer/benchmark.ts`) import it as
 * `#testing/project-game-options`.
 */
import type { GameOptionDefinition } from '../types/protocol.js';
import type { GameDefinition } from '../session/types.js';

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

/**
 * The `colors` and `colorLabels` game options that seat a `playerCount` table
 * in the colours the same `boardsmith.json`'s `colorPalette` declares, as the
 * dev host seats it, or none when it declares no palette or the tests run in
 * BoardSmith's own checkout (#1552).
 *
 * @throws As {@link projectGameOptions} does, and when the palette is not a list.
 */
export function projectColorOptions(playerCount: number): { colors?: string[]; colorLabels?: Record<string, string> };

/**
 * The options `createTestGame` takes to start a game as `boardsmith dev
 * --preset` and the dev lobby's preset picker start it (#1565): the preset's
 * game options and each seat's player options, colour and bot, as the start op
 * carries them (`playerOptions`, `exclusiveSeats`, `playerIsBot`,
 * `playerConfigs`, `colors`, `colorLabels`). The player options and palette are the game's
 * and the same `boardsmith.json`'s, as dev reads them.
 *
 * @example
 * ```typescript
 * const { game } = createTestGame(MyGame, presetStartOptions(gameDefinition, 'Play as Sheriff'));
 * ```
 *
 * Each seat a preset gives no `botLevel` plays at dev's default level, as
 * `boardsmith dev` without `--bot-level` gives it, and every game option the
 * project declares that the preset leaves out is at its default.
 *
 * @throws When the game declares no preset `name`, when it sets up no seats or
 * more or fewer than the game seats, and when dev would refuse it.
 */
export function presetStartOptions(
  gameDefinition: Pick<GameDefinition, 'presets' | 'playerOptions' | 'colorPalette' | 'minPlayers' | 'maxPlayers'>,
  name: string,
): { playerCount: number } & Record<string, unknown>;
