/**
 * WHAT A NEW GAME'S BOARD STARTS FROM DECLARES THE SHELL'S PROP CONTRACT (#516).
 *
 * The docs teach `defineProps<TableBoardProps>()` (or `WorldBoardProps` for a
 * world). A scaffold or aspect template that hand-writes a prop list teaches
 * the opposite, and its list drifts from what the shell binds.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateGameTableVue } from './project-scaffold.js';
import { generateWorldBoardVue } from './world-scaffold.js';

const ASPECTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'slash-command', 'aspects');

/** Every `defineProps<...>()` argument in a source text. */
function declaredProps(text: string): string[] {
  return [...text.matchAll(/defineProps<([\s\S]*?)>\(\)/g)].map((match) => match[1].trim());
}

describe('scaffolded boards declare the exported board prop types (#516)', () => {
  it('the table scaffold board declares TableBoardProps', () => {
    const out = generateGameTableVue();
    expect(declaredProps(out)).toEqual(['TableBoardProps']);
    expect(out).toMatch(/\bTableBoardProps\b[^;]*from 'boardsmith\/ui'/);
  });

  it('the world scaffold board declares WorldBoardProps', () => {
    const out = generateWorldBoardVue();
    expect(declaredProps(out)).toEqual(['WorldBoardProps']);
    expect(out).toMatch(/\bWorldBoardProps\b[^;]*from 'boardsmith\/ui'/);
  });

  for (const aspect of ['playing-cards', 'hex-grid', 'dice', 'square-grid']) {
    it(`the ${aspect} aspect's board declares TableBoardProps`, () => {
      const text = readFileSync(join(ASPECTS, `${aspect}.md`), 'utf-8');
      expect(declaredProps(text)).toEqual(['TableBoardProps']);
    });
  }
});
