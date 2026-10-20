/**
 * THE CODE BLOCKS THE DOCS MARK FOR COMPILING, AND THE TSCONFIG A GAME COMPILES THEM UNDER.
 *
 * A doc marks a fenced block as code the suite compiles by putting a line
 * `<!-- typecheck: <kind> [<path>] -->` directly above the block's opening
 * fence. `<kind>` says which gate compiles it; `<path>` (optional) is where
 * the block sits in the game it belongs to, so blocks of one doc that import
 * each other (`./game.js`, `./elements.js`) compile together.
 *
 * The docs (`docs/*.md`, `docs/api/*.md`) and the aspect templates `/design-game` copies game
 * code from (`src/cli/slash-command/aspects/*.md`, #645) both carry markers.
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
  /** The doc's path from the repo root without `.md`, e.g. `docs/getting-started`. */
  readonly doc: string;
  /** The marker's path, or `undefined` when it names none. */
  readonly path: string | undefined;
  readonly code: string;
}

const MARKER = /<!-- typecheck: ([a-z-]+)(?: (\S+))? -->\r?\n```[a-z]*\r?\n([\s\S]*?)```/g;
const ANY_MARKER = /^<!-- typecheck:/gm;

/** The kinds a gate compiles: `game` in docs-game-typecheck, `board` in aspect-boards-typecheck. */
const KNOWN_KINDS = ['game', 'board'] as const;

/**
 * The blocks of one doc (`file` is its path from the repo root, `text` its content) whose marker
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
      `${file} has ${markers} "<!-- typecheck: ... -->" lines but only ${blocks.length} sit directly ` +
        'above a fenced code block. Put each marker on the line right before the block it names.',
    );
  }
  for (const [, blockKind] of blocks) {
    if (!(KNOWN_KINDS as readonly string[]).includes(blockKind)) {
      throw new Error(
        `${file} marks a block "${blockKind}", which no gate compiles. Use one of ` +
          `${KNOWN_KINDS.map((known) => `"${known}"`).join(', ')}.`,
      );
    }
  }
  const doc = file.replace(/\.md$/, '');
  return blocks.filter(([, blockKind]) => blockKind === kind).map(([, , path, code]) => ({ doc, path, code }));
}

/**
 * The 1-based line of each opening fence in `text` whose block is a whole file
 * but carries no marker: a ts block whose first code line (after blank and `//`
 * lines) is an `import`, or a vue block that opens with its `<script>` (#1050).
 */
export function unmarkedFileBlocks(text: string): number[] {
  const lines = text.split(/\r?\n/);
  const unmarked: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lang = /^```([a-z]*)\s*$/.exec(lines[i])?.[1];
    if (lang === undefined) continue;
    let end = i + 1;
    while (end < lines.length && !lines[end].startsWith('```')) end++;
    const first = lines.slice(i + 1, end).find((line) => line.trim() !== '' && !line.startsWith('//')) ?? '';
    const isFile =
      (['ts', 'typescript'].includes(lang) && /^import\b/.test(first)) || (lang === 'vue' && /^<script\b/.test(first));
    if (isFile && !lines[i - 1]?.startsWith('<!-- typecheck:')) unmarked.push(i + 1);
    i = end;
  }
  return unmarked;
}

/** The folders whose `*.md` files may mark blocks, relative to the repo root. */
const MARKED_DIRS = ['docs', 'docs/api', 'src/cli/slash-command/aspects'];

/**
 * Every block in the `*.md` of `MARKED_DIRS` whose marker names `kind`, in
 * document order (see `parseMarkedBlocks`).
 */
export function markedDocBlocks(kind: string): MarkedDocBlock[] {
  return MARKED_DIRS.flatMap((dir) =>
    readdirSync(join(REPO_ROOT, dir))
      .filter((name) => name.endsWith('.md'))
      .sort()
      .flatMap((name) => parseMarkedBlocks(`${dir}/${name}`, readFileSync(join(REPO_ROOT, dir, name), 'utf8'), kind)),
  );
}

/**
 * Where each `game` block goes in the sandbox: `<doc>/<path>`, mapped to
 * its code. Throws on a block that would not be compiled there: one with no
 * path, a path that is not `.ts`, or a path another block of the doc took.
 */
export function gameBlockFiles(blocks: readonly MarkedDocBlock[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const block of blocks) {
    if (!block.path) {
      throw new Error(
        `${block.doc}.md marks a block "<!-- typecheck: game -->" without a path. Name the file the block ` +
          'is, e.g. "<!-- typecheck: game src/rules/actions.ts -->", so the blocks it imports resolve.',
      );
    }
    if (!block.path.endsWith('.ts')) {
      throw new Error(
        `${block.doc}.md marks "${block.path}" as game code, but only .ts game files are compiled. ` +
          'Name a .ts path, or mark a .vue board with "<!-- typecheck: board -->" instead.',
      );
    }
    const file = `${block.doc}/${block.path}`;
    if (files.has(file)) {
      throw new Error(
        `${block.doc}.md marks two blocks "${block.path}", so one would overwrite the other unseen. ` +
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
