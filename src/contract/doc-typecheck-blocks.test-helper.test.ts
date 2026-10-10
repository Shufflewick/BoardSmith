/**
 * A marker the doc-typecheck gates cannot act on must fail loud, never compile
 * nothing (#511 review): a misspelt kind, a game block that is not `.ts`, and
 * two game blocks that would land on one file.
 */
import { describe, expect, it } from 'vitest';

import { gameBlockFiles, parseMarkedBlocks } from './doc-typecheck-blocks.test-helper.js';

const block = (marker: string, code = 'export {};\n') => `${marker}\n\`\`\`typescript\n${code}\`\`\`\n`;

describe('the doc typecheck markers (#511)', () => {
  it('reads a known kind and its path', () => {
    expect(parseMarkedBlocks('a.md', block('<!-- typecheck: game src/a.ts -->'), 'game')).toEqual([
      { doc: 'a', path: 'src/a.ts', code: 'export {};\n' },
    ]);
  });

  it('refuses a kind no gate compiles, naming the doc and the known kinds', () => {
    expect(() => parseMarkedBlocks('a.md', block('<!-- typecheck: gmae src/a.ts -->'), 'game')).toThrow(
      /docs\/a\.md marks a block "gmae".*"game", "board"/,
    );
  });

  it('refuses a game block that is not a .ts file, pointing a board to its own marker', () => {
    const blocks = parseMarkedBlocks('a.md', block('<!-- typecheck: game src/Board.vue -->'), 'game');
    expect(() => gameBlockFiles(blocks)).toThrow(/docs\/a\.md.*src\/Board\.vue.*\.ts.*typecheck: board/);
  });

  it('refuses two game blocks with one path in one doc', () => {
    const text = block('<!-- typecheck: game src/a.ts -->') + block('<!-- typecheck: game src/a.ts -->');
    expect(() => gameBlockFiles(parseMarkedBlocks('a.md', text, 'game'))).toThrow(
      /docs\/a\.md marks two blocks "src\/a\.ts"/,
    );
  });
});
