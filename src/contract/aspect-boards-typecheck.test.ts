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
 */
import { describe, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateTsConfig } from '../cli/lib/project-scaffold.js';
import { consumerInstall, declaredPeers } from './consumer-install.test-helper.js';
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

/** The game's tsconfig as `boardsmith init` writes it, compiling the boards under `src/`. */
function gameTsConfig(): string {
  const scaffolded = JSON.parse(generateTsConfig()) as { compilerOptions: Record<string, unknown> };
  return JSON.stringify(
    {
      ...scaffolded,
      compilerOptions: {
        ...scaffolded.compilerOptions,
        noEmit: true,
        // Resolve from where the file SITS, not from where it really lives (see consumerInstall).
        preserveSymlinks: true,
      },
      include: ['src/**/*.vue'],
    },
    null,
    2,
  );
}

describe('the aspect templates\' boards type-check against boardsmith\'s own types (#516, #565)', () => {
  it('reports zero vue-tsc errors for every aspect\'s GameTable.vue', () => {
    const root = consumerInstall({ entryPoints: [], alsoInstalled: declaredPeers() });
    for (const aspect of ASPECTS) {
      const dir = join(root, 'src', aspect);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'GameTable.vue'), aspectBoard(aspect));
    }
    writeFileSync(join(root, 'game.tsconfig.json'), gameTsConfig());

    expectCleanCompile(
      root,
      'game.tsconfig.json',
      'the GameTable.vue of each aspect template (src/<aspect>/GameTable.vue is ' +
        'src/cli/slash-command/aspects/<aspect>.md)',
      'Fix the template, not this test: a board reads only what TableBoardProps (src/ui/board-props.ts) ' +
        'declares, and imports each name from the entry point package.json "exports" gives it.',
    );
  }, 180_000);
});
