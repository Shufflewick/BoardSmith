/**
 * The game options of the project the tests run in, read from its
 * `boardsmith.json` with Node (#701). `test-game.ts` and `bot-trainer/benchmark.ts` load this, through
 * `#testing/project-game-options`, and a compiler sees
 * `project-game-options.d.ts` in its place (see `project-test-utils.d.ts`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { projectGameOptions as Declared } from '#testing/project-game-options';
import { parseGameOptionList } from '../session/game-option-selection.js';

export const projectGameOptions: typeof Declared = () => {
  const file = join(process.cwd(), 'boardsmith.json');
  if (!existsSync(file)) return undefined;
  let config: { gameOptions?: unknown };
  try {
    config = JSON.parse(readFileSync(file, 'utf-8')) as { gameOptions?: unknown };
  } catch {
    throw new Error(`boardsmith.json in ${process.cwd()} is not valid JSON, so its game options cannot be read. Fix the file.`);
  }
  return parseGameOptionList(config.gameOptions);
};
