/**
 * THE BOARD EACH ASPECT TEMPLATE TEACHES, COMPILED AS A GAME COMPILES IT (#516, #565).
 *
 * `/design-game` copies the `GameTable.vue` block of an aspect template
 * (`src/cli/slash-command/aspects/*.md`) into a new game. A read the board prop
 * contract does not provide, or an import from an entry point that does not
 * export the name, fails that game's `vue-tsc` -- and a check on the template's
 * text cannot see either: `gameView?.isFinished` and `Die3D` from
 * `boardsmith/ui` both passed one. So this extracts each block and compiles it
 * under the tsconfig `boardsmith init` writes, in a sandbox holding what a
 * consumer's install holds, declared peers included (`Die3D` needs `three`).
 *
 * The docs teach boards too. A ```vue block in `docs/*.md` placed right after
 * a `<!-- typecheck: board -->` line (read by `markedDocBlocks`) is compiled
 * the same way (#570): its
 * `props.gameView.settings` read compiled nowhere while `GameViewElement` did
 * not declare the game root's fields.
 */
import { describe, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { consumerInstall, declaredPeers } from './consumer-install.test-helper.js';
import { gameTsConfig, markedDocBlocks } from './doc-typecheck-blocks.test-helper.js';
import { REPO_ROOT, expectCleanCompile } from './vue-tsc-run.test-helper.js';

const ASPECTS = ['dice', 'hex-grid', 'playing-cards', 'square-grid'] as const;

/** The one ```vue block of an aspect template: the board a game is given. */
function aspectBoard(aspect: string): string {
  const text = readFileSync(join(REPO_ROOT, 'src/cli/slash-command/aspects', `${aspect}.md`), 'utf8');
  const blocks = [...text.matchAll(/```vue\n([\s\S]*?)```/g)].map((match) => match[1]);
  if (blocks.length !== 1) {
    throw new Error(
      `The ${aspect} aspect template has ${blocks.length} \`\`\`vue blocks; this test compiles exactly one, ` +
        `the GameTable.vue a game is given. Keep one board per aspect, or extend this test to name which.`,
    );
  }
  return blocks[0];
}

describe('the aspect templates\' boards type-check against boardsmith\'s own types (#516, #565)', () => {
  it('reports zero vue-tsc errors for every aspect\'s GameTable.vue', () => {
    const root = consumerInstall({ entryPoints: [], alsoInstalled: declaredPeers() });
    for (const aspect of ASPECTS) {
      const dir = join(root, 'src', aspect);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'GameTable.vue'), aspectBoard(aspect));
    }
    writeFileSync(join(root, 'game.tsconfig.json'), gameTsConfig(['src/**/*.vue']));

    expectCleanCompile(
      root,
      'game.tsconfig.json',
      'the GameTable.vue of each aspect template (src/<aspect>/GameTable.vue is ' +
        'src/cli/slash-command/aspects/<aspect>.md)',
      'Fix the template, not this test: a board reads only what TableBoardProps (src/ui/board-props.ts) ' +
        'declares, and imports each name from the entry point package.json "exports" gives it.',
    );
  }, 180_000);

  it('reports zero vue-tsc errors for every board the docs mark for type-checking (#570)', () => {
    const boards = markedDocBlocks('board');
    if (boards.length === 0) {
      throw new Error('No doc marks a board with "<!-- typecheck: board -->", so this test would compile nothing.');
    }
    const root = consumerInstall({ entryPoints: [], alsoInstalled: declaredPeers() });
    const perDoc = new Map<string, number>();
    for (const { doc, code } of boards) {
      const n = (perDoc.get(doc) ?? 0) + 1;
      perDoc.set(doc, n);
      const dir = join(root, 'src', `${doc}-${n}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'Board.vue'), code);
    }
    writeFileSync(join(root, 'game.tsconfig.json'), gameTsConfig(['src/**/*.vue']));

    expectCleanCompile(
      root,
      'game.tsconfig.json',
      'the boards the docs mark with "<!-- typecheck: board -->" (src/<doc>-<n>/Board.vue is the ' +
        'n-th marked block of docs/<doc>.md)',
      'Fix the doc, not this test: a board reads only what TableBoardProps (src/ui/board-props.ts) ' +
        'declares, and imports each name from the entry point package.json "exports" gives it.',
    );
  }, 180_000);
});
