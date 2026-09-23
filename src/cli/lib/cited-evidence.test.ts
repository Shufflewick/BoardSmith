import { describe, it, expect } from 'vitest';
import { citedEvidencePaths } from './cited-evidence.js';

/**
 * `citedEvidencePaths` (#292): which strings in a design record are citations of a script or a
 * capture, so `ledger-check` can hold each one to "it is in git". Everything it returns is held
 * to that rule, so a false positive fails a close; everything it skips is never checked, so a
 * false negative lets uncommitted evidence through. Both directions are pinned here.
 */

function paths(text: string): string[] {
  return citedEvidencePaths(text).map((c) => c.path);
}

describe('citedEvidencePaths — what counts as a cited script or capture', () => {
  it('finds a scratch harness cited in backticks, with its line', () => {
    const text = ['### Decision 257', '- Decision: measured with `.boardsmith/scratch/food-invariant.mjs`.'].join('\n');
    expect(citedEvidencePaths(text)).toEqual([{ path: '.boardsmith/scratch/food-invariant.mjs', line: 2 }]);
  });

  it('finds scripts and captures by extension, bare or quoted, in prose or a list', () => {
    const text = [
      'Driver: chunks/world-shell/evidence/playtest-driver.mjs ran clean.',
      '- screenshot "chunks/world-shell/evidence/after.png" and (tests/food.test.ts)',
      'Recording at design/chunks/world-shell/evidence/run.webm, then scripts/measure.sh.',
    ].join('\n');
    expect(paths(text)).toEqual([
      'chunks/world-shell/evidence/playtest-driver.mjs',
      'chunks/world-shell/evidence/after.png',
      'tests/food.test.ts',
      'design/chunks/world-shell/evidence/run.webm',
      'scripts/measure.sh',
    ]);
  });

  it('keeps a path that carries a line suffix, without the suffix', () => {
    expect(paths('see `src/rules/food.ts:42`')).toEqual(['src/rules/food.ts']);
  });

  it('finds an absolute path, which can never be in the game repository', () => {
    expect(paths('ran /tmp/harness.mjs by hand')).toEqual(['/tmp/harness.mjs']);
  });

  it('skips what is not a file in this game: URLs, other repositories, placeholders, globs', () => {
    const text = [
      'https://github.com/Shufflewick/BoardSmith/blob/main/src/engine/game.ts',
      'BoardSmith:src/engine/element/piece.ts is where the gap is.',
      'Evidence goes in chunks/<slug>/evidence/<name>.mjs.',
      'All of src/**/*.ts and tests/{a,b}.test.ts.',
    ].join('\n');
    expect(paths(text)).toEqual([]);
  });

  it('skips a bare file name, other extensions, and anything inside an HTML comment', () => {
    const text = [
      'Edit game.ts and read design/RULINGS.md and package.json.',
      '<!-- example: `.boardsmith/scratch/example.mjs` -->',
    ].join('\n');
    expect(paths(text)).toEqual([]);
  });
});
