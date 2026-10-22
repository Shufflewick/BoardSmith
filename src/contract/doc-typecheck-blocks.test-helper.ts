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
import { generateTsConfig } from '../cli/lib/project-scaffold.js';

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
 * but nothing compiles: a ts block with an `import` line, or a vue block with a
 * `<script>` line, anywhere in it, with neither a `typecheck:` nor a
 * `doc-test: file` marker above it (#1050).
 */
export function unmarkedFileBlocks(text: string): number[] {
  const lines = text.split(/\r?\n/);
  const unmarked: number[] = [];
  let open: number | undefined;
  lines.forEach((line, i) => {
    if (!line.startsWith('```')) return;
    if (open === undefined) {
      open = i;
      return;
    }
    const fileStart = FILE_START[lines[open].slice(3).trim()];
    const isFile = lines.slice(open + 1, i).some((code) => fileStart?.test(code));
    if (isFile && !COMPILED_MARKER.test(lines[open - 1] ?? '')) unmarked.push(open + 1);
    open = undefined;
  });
  return unmarked;
}

// Any line, not only the first: comments, indents or a template above it must not hide a file.
const IMPORT_LINE = /^\s*import\s/;
/** The line that makes a block a whole file, by fence language. */
const FILE_START: Record<string, RegExp> = { ts: IMPORT_LINE, typescript: IMPORT_LINE, vue: /^\s*<script\b/ };

// A `doc-test: file` block is compiled by the doc's own test (docs/balance-simulator.test.ts, #556).
const COMPILED_MARKER = /^<!-- (typecheck:|doc-test: file )/;

/** The `*.md` that may mark blocks, keyed by path from the repo root with a leading `/`. */
const MARKED_DOCS = import.meta.glob<string>(['/docs/*.md', '/docs/api/*.md', '/src/cli/slash-command/aspects/*.md'], {
  eager: true,
  import: 'default',
});

/**
 * Every block in `MARKED_DOCS` whose marker names `kind`, in document order
 * (see `parseMarkedBlocks`).
 */
export function markedDocBlocks(kind: string): MarkedDocBlock[] {
  return Object.entries(MARKED_DOCS).flatMap(([path, text]) => parseMarkedBlocks(path.slice(1), text, kind));
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
