/**
 * `npm run typecheck` compiles every TypeScript and Vue file in the package
 * (#312).
 *
 * A type check is only as wide as its tsconfig's `include`. This repository has
 * had two checks that looked green while checking far less than they seemed to:
 * `tsc -p tsconfig.json` with no `include` stopped on a config error before
 * compiling anything, and plain `tsc` never reads a `.vue` file. So this asks
 * `vue-tsc` which files the program holds and requires every tracked `.ts` and
 * `.vue` file under `src/` and `docs/` to be among them. The only files allowed
 * out are the ones `tsconfig.json` excludes by name, and each of those is
 * named here too, so widening that list is a visible change to this test.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VUE_TSC = path.join(PROJECT_ROOT, 'node_modules/vue-tsc/bin/vue-tsc.js');

/** Tests that import game packages this repository does not contain. */
const EXCLUDED = [
  'src/bot/mcts-bot.test.ts',
  'src/bot/mcts-cache.test.ts',
  'src/bot/mcts-stats-checkers.test.ts',
  'src/bot/cribbage-bot.test.ts',
];

function lines(command, args) {
  const result = spawnSync(command, args, { cwd: PROJECT_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.split('\n').filter(Boolean);
}

describe('npm run typecheck covers the whole package (#312)', () => {
  it('compiles every tracked .ts and .vue file under src/ and docs/', () => {
    const tracked = lines('git', ['ls-files', 'src/**.ts', 'src/**.vue', 'docs/**.ts']);
    const compiled = new Set(
      lines(process.execPath, [VUE_TSC, '-p', 'tsconfig.json', '--listFilesOnly']).map((file) =>
        path.relative(PROJECT_ROOT, file),
      ),
    );

    const missing = tracked.filter((file) => !compiled.has(file) && !EXCLUDED.includes(file));

    expect(tracked.length).toBeGreaterThan(900);
    expect(
      missing,
      `npm run typecheck does not compile these files, so a type error in them would pass the gate. ` +
        `Widen "include" in tsconfig.json:\n${missing.join('\n')}`,
    ).toEqual([]);
    expect(EXCLUDED.filter((file) => compiled.has(file))).toEqual([]);
  }, 60_000);
});
