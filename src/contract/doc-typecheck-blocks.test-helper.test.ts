/**
 * A marker the doc-typecheck gates cannot act on must fail loud, never compile
 * nothing (#511 review): a misspelt kind, a game block that is not `.ts`, and
 * two game blocks that would land on one file. And a doc block that shows its
 * imports is a file an author copies, so it must carry a marker (#1050).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { gameBlockFiles, parseMarkedBlocks, unmarkedFileBlocks } from './doc-typecheck-blocks.test-helper.js';
import { REPO_ROOT } from './vue-tsc-run.test-helper.js';

const block = (marker: string, code = 'export {};\n') => `${marker}\n\`\`\`typescript\n${code}\`\`\`\n`;

describe('the doc typecheck markers (#511)', () => {
  it('reads a known kind and its path', () => {
    expect(parseMarkedBlocks('docs/a.md', block('<!-- typecheck: game src/a.ts -->'), 'game')).toEqual([
      { doc: 'docs/a', path: 'src/a.ts', code: 'export {};\n' },
    ]);
  });

  it('reads a marked block from a doc saved with CRLF line endings (#808)', () => {
    const text = block('<!-- typecheck: game src/a.ts -->').replaceAll('\n', '\r\n');
    expect(parseMarkedBlocks('docs/a.md', text, 'game')).toEqual([
      { doc: 'docs/a', path: 'src/a.ts', code: 'export {};\r\n' },
    ]);
  });

  it('refuses a kind no gate compiles, naming the doc and the known kinds', () => {
    expect(() => parseMarkedBlocks('docs/a.md', block('<!-- typecheck: gmae src/a.ts -->'), 'game')).toThrow(
      /docs\/a\.md marks a block "gmae".*"game", "board"/,
    );
  });

  it('refuses a game block that is not a .ts file, pointing a board to its own marker', () => {
    const blocks = parseMarkedBlocks('docs/a.md', block('<!-- typecheck: game src/Board.vue -->'), 'game');
    expect(() => gameBlockFiles(blocks)).toThrow(/docs\/a\.md.*src\/Board\.vue.*\.ts.*typecheck: board/);
  });

  it('refuses two game blocks with one path in one doc', () => {
    const text = block('<!-- typecheck: game src/a.ts -->') + block('<!-- typecheck: game src/a.ts -->');
    expect(() => gameBlockFiles(parseMarkedBlocks('docs/a.md', text, 'game'))).toThrow(
      /docs\/a\.md marks two blocks "src\/a\.ts"/,
    );
  });
});

describe('every doc block that shows its imports is compiled (#1050)', () => {
  const fence = (lang: string, code: string) => `\`\`\`${lang}\n${code}\`\`\`\n`;

  it('reports a ts block that opens with an import, or a vue block that opens with its script, by line', () => {
    const text =
      'Intro\n' +
      fence('typescript', "import { Game } from 'boardsmith';\n") +
      fence('ts', "// src/rules/game.ts\n\nimport { Game } from 'boardsmith';\n") +
      fence('vue', '<script setup lang="ts">\n</script>\n');
    expect(unmarkedFileBlocks(text)).toEqual([2, 5, 10]);
  });

  it('passes a marked block, a fragment without imports, a template-only vue block and other languages', () => {
    const text =
      "<!-- typecheck: game src/a.ts -->\n" +
      fence('typescript', "import { Game } from 'boardsmith';\n") +
      fence('typescript', 'game.players.length;\n') +
      fence('vue', '<template><div /></template>\n') +
      fence('bash', 'import x\n');
    expect(unmarkedFileBlocks(text)).toEqual([]);
  });

  it('finds none in docs/*.md and docs/api/*.md', () => {
    const unmarked = ['docs', 'docs/api'].flatMap((dir) =>
      readdirSync(join(REPO_ROOT, dir))
        .filter((name) => name.endsWith('.md'))
        .flatMap((name) =>
          unmarkedFileBlocks(readFileSync(join(REPO_ROOT, dir, name), 'utf8')).map((line) => `${dir}/${name}:${line}`),
        ),
    );
    expect(
      unmarked,
      'These blocks show their imports, so an author copies them as a file, but nothing compiles them. Mark each ' +
        'with "<!-- typecheck: game <path> -->" (or "<!-- typecheck: board -->" for a .vue file) on the line ' +
        'above its fence and make it compile, or cut it to a fragment without imports (docs/typecheck.md).',
    ).toEqual([]);
  });
});
