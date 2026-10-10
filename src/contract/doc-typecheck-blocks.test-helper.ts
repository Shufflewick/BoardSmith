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

/** One marked block: the doc it is in, the path its marker names, and its code. */
export interface MarkedDocBlock {
  /** The doc's file name without `.md`, e.g. `getting-started`. */
  readonly doc: string;
  /** The marker's path, or `undefined` when it names none. */
  readonly path: string | undefined;
  readonly code: string;
}

const MARKER = /<!-- typecheck: ([a-z-]+)(?: (\S+))? -->\n```[a-z]*\n([\s\S]*?)```/g;
const ANY_MARKER = /^<!-- typecheck:/gm;

/** The kinds a gate compiles: `game` in docs-game-typecheck, `board` in aspect-boards-typecheck. */
const KNOWN_KINDS = ['game', 'board'] as const;

/**
 * The blocks of one doc (`file` is its name, `text` its content) whose marker
 * names `kind`, in document order.
 *
 * Throws when a marker does not sit directly above a fence: a block whose
 * marker drifted away from it would otherwise compile nothing, silently.
 */
export function parseMarkedBlocks(file: string, text: string, kind: string): MarkedDocBlock[] {
  const blocks = [...text.matchAll(MARKER)];
  const markers = text.match(ANY_MARKER)?.length ?? 0;
  if (markers !== blocks.length) {
    throw new Error(
      `docs/${file} has ${markers} "<!-- typecheck: ... -->" lines but only ${blocks.length} sit directly ` +
        'above a fenced code block. Put each marker on the line right before the block it names.',
    );
  }
  for (const [, blockKind] of blocks) {
    if (!(KNOWN_KINDS as readonly string[]).includes(blockKind)) {
      throw new Error(
        `docs/${file} marks a block "${blockKind}", which no gate compiles. Use one of ` +
          `${KNOWN_KINDS.map((known) => `"${known}"`).join(', ')}.`,
      );
    }
  }
  const doc = file.replace(/\.md$/, '');
  return blocks.filter(([, blockKind]) => blockKind === kind).map(([, , path, code]) => ({ doc, path, code }));
}

/** Every block in `docs/*.md` whose marker names `kind`, in document order (see `parseMarkedBlocks`). */
export function markedDocBlocks(kind: string): MarkedDocBlock[] {
  const docsDir = join(REPO_ROOT, 'docs');
  return readdirSync(docsDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .flatMap((file) => parseMarkedBlocks(file, readFileSync(join(docsDir, file), 'utf8'), kind));
}

/**
 * Where each `game` block goes in the sandbox: `docs/<doc>/<path>`, mapped to
 * its code. Throws on a block that would not be compiled there: one with no
 * path, a path that is not `.ts`, or a path another block of the doc took.
 */
export function gameBlockFiles(blocks: readonly MarkedDocBlock[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const block of blocks) {
    if (!block.path) {
      throw new Error(
        `docs/${block.doc}.md marks a block "<!-- typecheck: game -->" without a path. Name the file the block ` +
          'is, e.g. "<!-- typecheck: game src/rules/actions.ts -->", so the blocks it imports resolve.',
      );
    }
    if (!block.path.endsWith('.ts')) {
      throw new Error(
        `docs/${block.doc}.md marks "${block.path}" as game code, but only .ts game files are compiled. ` +
          'Name a .ts path, or mark a .vue board with "<!-- typecheck: board -->" instead.',
      );
    }
    const file = `docs/${block.doc}/${block.path}`;
    if (files.has(file)) {
      throw new Error(
        `docs/${block.doc}.md marks two blocks "${block.path}", so one would overwrite the other unseen. ` +
          'Give each block its own path.',
      );
    }
    files.set(file, block.code);
  }
  return files;
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
