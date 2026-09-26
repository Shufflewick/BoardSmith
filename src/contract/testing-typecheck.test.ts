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
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateTsConfig } from '../cli/lib/project-scaffold.js';
import { consumerInstall, declaredPeers } from './consumer-install.test-helper.js';
import { VUE_TSC, vueTscErrors } from './vue-tsc-run.test-helper.js';

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

/** The game's tsconfig as `boardsmith init` writes it, compiling only the one test file. */
function gameTsConfig(): string {
  const scaffolded = JSON.parse(generateTsConfig()) as {
    compilerOptions: Record<string, unknown>;
    include: string[];
  };
  return JSON.stringify(
    {
      ...scaffolded,
      compilerOptions: {
        ...scaffolded.compilerOptions,
        noEmit: true,
        // Resolve from where the file SITS, not from where it really lives (see consumerInstall).
        preserveSymlinks: true,
      },
      include: ['tests/**/*'],
    },
    null,
    2,
  );
}

describe("`boardsmith/testing` type-checks under a game's browser tsconfig (#411)", () => {
  it('reports zero vue-tsc errors for a game test that imports it', () => {
    // The declared peers are installed because `@vue/test-utils` is one, and a
    // game that renders a seat installs it (`boardsmith init` does).
    const root = consumerInstall({ entryPoints: [], alsoInstalled: declaredPeers() });
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'tests', 'seat.test.ts'), GAME_TEST);
    writeFileSync(join(root, 'game.tsconfig.json'), gameTsConfig());

    const errors = vueTscErrors(root, 'game.tsconfig.json');

    expect(
      errors,
      errors.length === 0
        ? ''
        : `vue-tsc reports ${errors.length} error(s) compiling a game test that imports boardsmith/testing ` +
          `under the tsconfig \`boardsmith init\` writes, which has no Node types. A "Cannot find module ` +
          `'node:...'" or a missing \`process\` member means Node-only code is reachable from the entry's ` +
          `types: keep it behind a declaration, as package.json "imports" does for ` +
          `\`#testing/project-test-utils\` (see src/testing/project-test-utils.d.ts). Repeat the run with:\n` +
          `  cd ${root} && node ${VUE_TSC} --noEmit -p game.tsconfig.json\n\n` +
          errors.join('\n'),
    ).toEqual([]);
  }, 180_000);
});
