/**
 * A GAME'S TEST, IMPORTING `boardsmith/testing`, COMPILED UNDER THE GAME'S OWN TSCONFIG (#411).
 *
 * `exports["./testing"]` maps `types` straight at `src/testing/index.ts`, so a
 * game that imports it compiles every file that entry reaches, under the
 * game's compiler options. Those options are a browser's: `boardsmith init`
 * lists `types: ["vite/client"]` and nothing else, so no Node global and no
 * `node:` module exists for the game's compiler unless the game brings them.
 *
 * #389 put a Node-only loader (`node:module`, `node:url`, `node:path`,
 * `process.cwd()`) straight into `dom-leak.ts`, and every game that did not
 * happen to pull Node's types in some other way failed `boardsmith validate`:
 *
 *   dom-leak.ts: TS2307 Cannot find module 'node:module' or its corresponding type declarations.
 *   dom-leak.ts: TS2339 Property 'cwd' does not exist on type 'Process'.
 *
 * `boardsmith typecheck` could not see it: this repository's own config lists
 * `node` in `types`, because its CLI and tests use Node. So this compiles the
 * smallest game that uses the entry -- one test file importing it and nothing
 * else, in particular not `vitest`, whose own types would pull Node's in and
 * hide the fault -- in a sandbox holding what a consumer's install holds, under
 * the tsconfig `boardsmith init` writes.
 *
 * The sandbox holds no peer dependency: `@vue/test-utils`, which `dom-leak.ts`
 * imports, is a regular dependency (#1578), so it arrives with BoardSmith.
 */
import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateSmokeSpecTs } from '../cli/lib/project-scaffold.js';
import { gameTsConfig } from '../cli/lib/game-tsconfig.test-helper.js';
import { consumerInstall } from './consumer-install.test-helper.js';
import { expectCleanCompile } from './vue-tsc-run.test-helper.js';

/** The smallest use of the entry: a board rendered as a seat, and the preload a rendering test file calls. */
const GAME_TEST = `import { createTestGame, preloadSeatRenderer, renderAsSeat, type TestGame } from 'boardsmith/testing';
import type { Game } from 'boardsmith';

export async function renderSeatOne(game: TestGame<Game>): Promise<string> {
  await preloadSeatRenderer();
  const wrapper = await renderAsSeat(game, 1);
  return wrapper.html();
}

export const create = createTestGame;
`;

describe("`boardsmith/testing` type-checks under a game's browser tsconfig (#411, #1578)", () => {
  it('reports zero vue-tsc errors for a game test that imports it, with no @vue/test-utils in the game', () => {
    const root = consumerInstall({ entryPoints: [] });
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'tests', 'seat.test.ts'), GAME_TEST);
    writeFileSync(join(root, 'game.tsconfig.json'), gameTsConfig(['tests/**/*']));

    expectCleanCompile(
      root,
      'game.tsconfig.json',
      'a game test that imports boardsmith/testing under the tsconfig `boardsmith init` writes, which has no ' +
        'Node types, holding only our production closure and the toolchain a game brings',
      'A "Cannot find module \'node:...\'" or a missing `process` member means Node-only code is reachable from ' +
        'the entry\'s types: keep it behind a declaration, as package.json "imports" does for ' +
        '`#testing/project-test-utils` (see src/testing/project-test-utils.d.ts). A "Cannot find module" for a ' +
        'package means the entry imports something BoardSmith does not install for the game -- declare it in ' +
        '"dependencies" and refresh package-lock.json.',
    );
  }, 180_000);

  it('reports zero vue-tsc errors for a game holding only the smoke spec `boardsmith init` writes (#1306)', () => {
    const root = consumerInstall({ entryPoints: [] });
    mkdirSync(join(root, 'tests', 'browser'), { recursive: true });
    writeFileSync(join(root, 'tests', 'browser', 'smoke.spec.ts'), generateSmokeSpecTs(['move']));
    writeFileSync(join(root, 'game.tsconfig.json'), gameTsConfig(['tests/**/*']));

    expectCleanCompile(
      root,
      'game.tsconfig.json',
      'a game whose only file is the smoke spec importing boardsmith/testing/browser, under the tsconfig ' +
        '`boardsmith init` writes, which has no Node types',
      'A "Cannot find name \'process\'" means a file the entry reaches reads `process` without referencing ' +
        'src/types/node-globals.d.ts, so it compiles only when something else (the `boardsmith` entry) brings it in.',
    );
  }, 180_000);
});
