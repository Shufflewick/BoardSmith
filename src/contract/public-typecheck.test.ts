/**
 * THE GATE THAT WAS MISSING (BoardSmith #179).
 *
 * `boardsmith validate` runs a game's `vue-tsc`, and `boardsmith publish`
 * refuses a game that fails it. A game installs `boardsmith` as a SYMLINK to
 * this checkout, and this package ships TypeScript SOURCE, so that `vue-tsc`
 * compiles OUR `.ts` and `.vue` files as ordinary source and reports our errors
 * against the game. Nothing in a game repo can fix one.
 *
 * Nothing here checked that. `tsc -p tsconfig.json` cannot see inside a `.vue`
 * file at all, so the shell's SFCs were type-checked by nobody in this repo and
 * by every game downstream. Four errors reached `main` that way and made every
 * one of the fifteen catalogue games unpublishable at once.
 *
 * So this test performs a consumer's compilation: `tsconfig.public.json` names
 * the entry points in `package.json`'s `exports`, `vue-tsc` walks everything
 * reachable from them, and the count must be ZERO. Not a sample, not advisory —
 * a fifth error fails the suite exactly as the first four would have, and the
 * failure message names the file and line so it is fixed here rather than
 * discovered in a game.
 *
 * Scope note: `tsconfig.json` (which sweeps `src/**` including tests and the
 * CLI) carries a documented backlog — see docs/typecheck.md. No game imports
 * those files, so they cannot break `validate`, and folding them in would mean
 * a gate that can never be zero, which is the same as no gate.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe("BoardSmith's public surface type-checks the way a game checks it", () => {
  it('reports zero vue-tsc errors from tsconfig.public.json', () => {
    const run = spawnSync(
      process.execPath,
      [resolve(REPO_ROOT, 'node_modules/vue-tsc/bin/vue-tsc.js'), '--noEmit', '-p', 'tsconfig.public.json'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );

    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const errors = output.split('\n').filter(line => /error TS\d+:/.test(line));

    expect(
      errors,
      errors.length === 0
        ? ''
        : `vue-tsc reports ${errors.length} error(s) on BoardSmith's public surface. Every catalogue game inherits these ` +
          `through its symlinked node_modules/boardsmith, so \`boardsmith validate\` fails in ALL of them until they are ` +
          `fixed HERE — a game repo cannot fix one. Reproduce with:\n` +
          `  npx vue-tsc --noEmit -p tsconfig.public.json\n\n${errors.join('\n')}`,
    ).toEqual([]);
  }, 180_000);
});
