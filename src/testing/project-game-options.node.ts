/**
 * The game options, seat colours and preset seats of the project the tests run in,
 * read from its `boardsmith.json` with Node (#701, #1552, #1565). `test-game.ts`,
 * `headless-session.ts` and `bot-trainer/benchmark.ts` load this, through `#testing/project-game-options`,
 * and a compiler sees `project-game-options.d.ts` in its place (see
 * `project-test-utils.d.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  presetStartOptions as DeclaredPreset,
  projectColorOptions as DeclaredColors,
  projectGameOptions as DeclaredOptions,
} from '#testing/project-game-options';
import type { GameOptionDefinition } from '../types/protocol.js';
import type { GamePreset } from '../session/types.js';
import { assertPresetsSelectable, parseGameOptionList, selectDesignerGameOptions } from '../session/game-option-selection.js';
import { dealSeatColors, paletteGameOptions } from '../session/colors.js';
import { seatDisplayName } from '../engine/element/seat-defaults.js';
import { DEV_BOT_LEVEL, presetSeatSetup, resolveDevPlayerOptions, seatStartOptions, type SeatSetup } from '../cli/lib/player-options.js';

/**
 * Each boardsmith.json parsed so far, by path, with the text it was parsed from: a simulation starts
 * thousands of test games, and a file edited since (a watch-mode rerun) is parsed again.
 */
const parsed = new Map<
  string,
  { text: string; declared: Record<string, GameOptionDefinition>; playerOptions: unknown; colorPalette: unknown }
>();

export const projectGameOptions: typeof DeclaredOptions = () => projectDeclarations()?.declared;

export const projectColorOptions: typeof DeclaredColors = (playerCount) =>
  paletteGameOptions(projectDeclarations()?.colorPalette, playerCount);

export const presetStartOptions: typeof DeclaredPreset = (gameDefinition, name) => {
  const preset = findPreset(gameDefinition.presets, name);
  const project = projectDeclarations();
  assertPresetsSelectable(project?.declared, [preset]);
  // The same player options and palette `boardsmith dev` resolves, so a preset dev refuses is refused here.
  const playerOptions = resolveDevPlayerOptions(gameDefinition, {
    playerOptions: project?.playerOptions,
    colorPalette: project?.colorPalette as Array<string | Record<string, unknown>> | undefined,
  });
  const palette = playerOptions.color.choices;
  const seats = presetSeatSetup(preset, playerOptions, palette.map((c) => c.value));
  assertSeatCount(name, seats, gameDefinition);
  const colors = dealSeatColors(seats.map((seat) => seat.color), palette.map((c) => c.value));
  return {
    ...selectDesignerGameOptions(project?.declared, { ...preset.options }),
    playerCount: seats.length,
    ...seatStartOptions(
      playerOptions,
      seats.map((seat, index) => ({
        ...seat,
        color: colors[index],
        botLevel: seat.botLevel ?? DEV_BOT_LEVEL,
        name: seatDisplayName(index + 1),
      })),
      palette,
    ),
  };
};

function findPreset(presets: readonly GamePreset[] | undefined, name: string): GamePreset {
  const preset = presets?.find((p) => p.name === name);
  if (preset) return preset;
  const known = (presets ?? []).map((p) => p.name).join(', ');
  throw new Error(`This game declares no preset "${name}"; ${known ? `its presets are ${known}` : 'it declares none'}.`);
}

/** Throws unless a preset sets up seats, as many as the game takes. */
function assertSeatCount(
  name: string,
  seats: SeatSetup[] | undefined,
  { minPlayers, maxPlayers }: { minPlayers?: number; maxPlayers?: number },
): asserts seats is SeatSetup[] {
  if (seats === undefined) {
    throw new Error(
      `Preset "${name}" sets up no seats, so it cannot say how to seat a game. ` +
        'Give it players, or start the game with createTestGame(GameClass, { playerCount, ...preset.options }).',
    );
  }
  if (minPlayers === undefined || maxPlayers === undefined) {
    throw new Error('This game declares no minPlayers and maxPlayers, so no table can seat it. Declare both in your gameDefinition.');
  }
  if (seats.length < minPlayers || seats.length > maxPlayers) {
    throw new Error(`Preset "${name}" sets up ${seats.length} seats, but this game seats ${minPlayers} to ${maxPlayers} players. Correct the preset.`);
  }
}

function projectDeclarations() {
  const file = projectFile(process.cwd());
  if (file === undefined) return undefined;
  const text = readFileSync(file, 'utf-8');
  const cached = parsed.get(file);
  if (cached?.text === text) return cached;
  let config: { gameOptions?: unknown; playerOptions?: unknown; colorPalette?: unknown };
  try {
    config = JSON.parse(text) as typeof config;
  } catch {
    throw new Error(`${file} is not valid JSON, so the game's options cannot be read from it. Fix the file.`);
  }
  const declarations = {
    text,
    declared: parseGameOptionList(config.gameOptions),
    playerOptions: config.playerOptions,
    colorPalette: config.colorPalette,
  };
  parsed.set(file, declarations);
  return declarations;
}

/**
 * The nearest `boardsmith.json` at or above `start`, or `undefined` when the
 * nearest project above it is BoardSmith's own checkout, which is no game.
 * Anywhere else a missing file is an error: a game's tests that ran without
 * its options would play a game no host starts.
 */
function projectFile(start: string): string | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    const file = join(dir, 'boardsmith.json');
    if (existsSync(file)) return file;
    if (isBoardsmithCheckout(dir)) return undefined;
    if (dirname(dir) === dir) break;
  }
  throw new Error(
    `No boardsmith.json in ${start} or any folder above it, so the game options it declares cannot be ` +
      'filled in. Run the tests from inside the game project (boardsmith test does).',
  );
}

/** Whether `dir` holds BoardSmith's own package.json. */
function isBoardsmithCheckout(dir: string): boolean {
  const pkg = join(dir, 'package.json');
  if (!existsSync(pkg)) return false;
  try {
    return (JSON.parse(readFileSync(pkg, 'utf-8')) as { name?: unknown }).name === 'boardsmith';
  } catch {
    return false;
  }
}
