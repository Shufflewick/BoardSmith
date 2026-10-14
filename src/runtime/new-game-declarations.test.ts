/**
 * Every host that starts a new game hands the runner the game's option
 * declarations (#708), so `GameRunner` gives every declared option it was not
 * passed its default and no host can start a game missing one. This scan finds
 * each `new GameRunner(` and `GameRunner.replay(` outside tests and fails on one
 * that passes no `declaredGameOptions`, unless its file is listed below with
 * the reason it has none to pass.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));

const NO_DECLARATIONS: Record<string, string> = {
  'src/runtime/runner.ts': 'fromSnapshot restores a save with its own options; replay forwards its caller\'s',
  'src/contract/fingerprint.ts': 'BoardSmith\'s own fixture game has no boardsmith.json',
  'src/cli/dev-host/table-rules-reload.ts': 'replays a saved game with the options it started with',
};

/** The text of each runner construction in `source`, from the call to its closing parenthesis. */
function constructions(source: string): string[] {
  return [...source.matchAll(/new GameRunner\(|GameRunner\.replay\(/g)].map((match) => {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < source.length; i++) {
      if (source[i] === '(') depth++;
      if (source[i] === ')' && --depth === 0) return source.slice(match.index, i + 1);
    }
    throw new Error(`Unclosed runner construction at offset ${match.index}.`);
  });
}

const sources = (readdirSync(join(root, 'src'), { recursive: true }) as string[])
  .filter((file) => /\.(ts|vue)$/.test(file) && !/\.test(-helper)?\.|\.d\.ts$/.test(file))
  .map((file) => ({ file: relative(root, join(root, 'src', file)).split('\\').join('/'), source: readFileSync(join(root, 'src', file), 'utf8') }))
  .filter(({ source }) => constructions(source).length > 0);

describe('every new game is started with its option declarations (#708)', () => {
  it('each runner construction outside tests passes declaredGameOptions', () => {
    const missing = sources
      .filter(({ file }) => !(file in NO_DECLARATIONS))
      .flatMap(({ file, source }) =>
        constructions(source).filter((text) => !text.includes('declaredGameOptions')).map(() => file),
      );
    expect(missing).toEqual([]);
  });

  it('every file excused from passing declarations still constructs a runner', () => {
    const constructing = new Set(sources.map(({ file }) => file));
    expect(Object.keys(NO_DECLARATIONS).filter((file) => !constructing.has(file))).toEqual([]);
  });
});
