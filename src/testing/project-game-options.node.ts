/**
 * The game options of the project the tests run in, read from its
 * `boardsmith.json` with Node (#701). `test-game.ts` and
 * `bot-trainer/benchmark.ts` load this, through `#testing/project-game-options`,
 * and a compiler sees `project-game-options.d.ts` in its place (see
 * `project-test-utils.d.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { projectGameOptions as Declared } from '#testing/project-game-options';
import type { GameOptionDefinition } from '../types/protocol.js';
import { parseGameOptionList } from '../session/game-option-selection.js';

/** Each boardsmith.json read so far, by path: a simulation starts thousands of test games. */
const parsed = new Map<string, Record<string, GameOptionDefinition>>();

export const projectGameOptions: typeof Declared = () => {
  const file = projectFile(process.cwd());
  if (file === undefined) return undefined;
  let declared = parsed.get(file);
  if (declared === undefined) {
    let config: { gameOptions?: unknown };
    try {
      config = JSON.parse(readFileSync(file, 'utf-8')) as { gameOptions?: unknown };
    } catch {
      throw new Error(`${file} is not valid JSON, so the game's options cannot be read from it. Fix the file.`);
    }
    declared = parseGameOptionList(config.gameOptions);
    parsed.set(file, declared);
  }
  return declared;
};

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
