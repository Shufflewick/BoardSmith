/**
 * Every host that starts a new game hands the runner the game's option
 * declarations (#708), so `GameRunner` gives every declared option it was not
 * passed its default and no host can start a game missing one. This scan finds
 * each `new GameRunner(` and `GameRunner.replay(` outside tests and fails on one
 * that passes no `declaredGameOptions`, unless its file is listed below with how
 * many it may skip and why it has none to pass.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

// Links the files this check reads, so `vitest run --changed` runs it when only one changes; nothing loads (#1504).
import.meta.glob(['/src/**/*.{ts,vue}', '!**/*.test.ts']);

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Each file allowed constructions without declarations: how many, and why it has none to pass. */
const NO_DECLARATIONS: Record<string, { count: number; reason: string }> = {
  'src/runtime/runner.ts': { count: 2, reason: 'fromSnapshot restores a save with its own options; replay forwards its caller\'s' },
  'src/contract/fingerprint.ts': { count: 1, reason: 'BoardSmith\'s own fixture game has no boardsmith.json' },
  'src/cli/dev-host/table-rules-reload.ts': { count: 1, reason: 'replays a saved game with the options it started with' },
};

const CONSTRUCTION = /(?:new GameRunner|GameRunner\.replay)\s*(?:<[^()]*?>)?\s*\(/g;

/** The text of each runner construction in `source`, from the call to its closing parenthesis. */
function constructions(source: string): string[] {
  return [...source.matchAll(CONSTRUCTION)].map((match) => {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < source.length; i++) {
      if (source[i] === '(') depth++;
      if (source[i] === ')' && --depth === 0) return source.slice(match.index, i + 1);
    }
    throw new Error(`Unclosed runner construction at offset ${match.index}.`);
  });
}

/**
 * Each file whose constructions without `declaredGameOptions` differ in number
 * from what `excused` allows it (none for an unlisted file), with both counts.
 */
function undeclared(
  sources: Array<{ file: string; source: string }>,
  excused: Record<string, { count: number }>,
): Array<{ file: string; found: number; allowed: number }> {
  const found = new Map(
    sources.map(({ file, source }) => [file, constructions(source).filter((text) => !text.includes('declaredGameOptions')).length]),
  );
  return [...new Set([...found.keys(), ...Object.keys(excused)])]
    .map((file) => ({ file, found: found.get(file) ?? 0, allowed: excused[file]?.count ?? 0 }))
    .filter(({ found, allowed }) => found !== allowed);
}

const sources = (readdirSync(join(root, 'src'), { recursive: true }) as string[])
  .filter((file) => /\.(ts|vue)$/.test(file) && !/\.test(-helper)?\.|\.d\.ts$/.test(file))
  .map((file) => ({ file: relative(root, join(root, 'src', file)).split('\\').join('/'), source: readFileSync(join(root, 'src', file), 'utf8') }));

describe('every new game is started with its option declarations (#708)', () => {
  it('each runner construction outside tests passes declaredGameOptions, but for the listed ones', () => {
    expect(undeclared(sources, NO_DECLARATIONS)).toEqual([]);
  });

  it('finds a construction with type arguments and spacing', () => {
    const source = 'const a = new GameRunner<X>({ GameClass });\nconst b = GameRunner.replay <X> (opts, []);';
    expect(undeclared([{ file: 'f.ts', source }], {})).toEqual([{ file: 'f.ts', found: 2, allowed: 0 }]);
  });

  it('a construction that passes declarations is not reported', () => {
    const source = 'new GameRunner<X>({ GameClass, declaredGameOptions: d })';
    expect(undeclared([{ file: 'f.ts', source }], {})).toEqual([]);
  });

  it('a listed file with one more construction than it is allowed is reported', () => {
    const source = 'new GameRunner(a); new GameRunner(b);';
    expect(undeclared([{ file: 'f.ts', source }], { 'f.ts': { count: 1 } })).toEqual([{ file: 'f.ts', found: 2, allowed: 1 }]);
  });

  it('a listed file with fewer constructions than it is allowed is reported, so the list stays current', () => {
    expect(undeclared([{ file: 'f.ts', source: '' }], { 'f.ts': { count: 1 } })).toEqual([{ file: 'f.ts', found: 0, allowed: 1 }]);
  });
});
