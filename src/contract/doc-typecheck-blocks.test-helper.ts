/**
 * THE CODE BLOCKS THE DOCS MARK FOR COMPILING, AND THE TSCONFIG A GAME COMPILES THEM UNDER.
 *
 * A doc marks a fenced block as code the suite compiles by putting a line
 * `<!-- typecheck: <kind> [<path>] -->` directly above the block's opening
 * fence. `<kind>` says which gate compiles it; `<path>` (optional) is where
 * the block sits in the game it belongs to, so blocks of one doc that import
 * each other (`./game.js`, `./elements.js`) compile together.
 *
 * `docs-game-typecheck.test.ts` compiles the `game` blocks (#511).
 * `aspect-boards-typecheck.test.ts` compiles the `board` blocks (#570), and
 * the boards the aspect templates teach under the same `gameTsConfig`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { generateTsConfig } from '../cli/lib/project-scaffold.js';
import { REPO_ROOT } from './vue-tsc-run.test-helper.js';

/** One marked block: the doc it is in, what its marker says, and its code. */
export interface MarkedDocBlock {
  /** The doc's file name without `.md`, e.g. `getting-started`. */
  readonly doc: string;
  readonly kind: string;
  /** The marker's path, or `undefined` when it names none. */
  readonly path: string | undefined;
  readonly code: string;
}

const MARKER = /<!-- typecheck: ([a-z-]+)(?: (\S+))? -->\n```[a-z]*\n([\s\S]*?)```/g;
const ANY_MARKER = /^<!-- typecheck:/gm;

/**
 * Every block in `docs/*.md` whose marker names `kind`, in document order.
 *
 * Throws when a doc has a marker that does not sit directly above a fence:
 * a block whose marker drifted away from it would otherwise compile nothing,
 * silently.
 */
export function markedDocBlocks(kind: string): MarkedDocBlock[] {
  const docsDir = join(REPO_ROOT, 'docs');
  const found: MarkedDocBlock[] = [];
  for (const file of readdirSync(docsDir).filter((name) => name.endsWith('.md')).sort()) {
    const text = readFileSync(join(docsDir, file), 'utf8');
    const blocks = [...text.matchAll(MARKER)];
    const markers = text.match(ANY_MARKER)?.length ?? 0;
    if (markers !== blocks.length) {
      throw new Error(
        `docs/${file} has ${markers} "<!-- typecheck: ... -->" lines but only ${blocks.length} sit directly ` +
          'above a fenced code block. Put each marker on the line right before the block it names.',
      );
    }
    for (const [, blockKind, path, code] of blocks) {
      if (blockKind === kind) found.push({ doc: file.replace(/\.md$/, ''), kind: blockKind, path, code });
    }
  }
  return found;
}

/** The game's tsconfig as `boardsmith init` writes it, compiling the files `include` names. */
export function gameTsConfig(include: readonly string[]): string {
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
      include,
    },
    null,
    2,
  );
}
