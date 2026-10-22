/**
 * WHAT A NEW GAME'S BOARD STARTS FROM DECLARES THE SHELL'S PROP CONTRACT (#516).
 *
 * The docs teach `defineProps<TableBoardProps>()` (or `WorldBoardProps` for a
 * world). A scaffold or aspect template that hand-writes a prop list teaches
 * the opposite, and its list drifts from what the shell binds.
 */
import { describe, it, expect } from 'vitest';
import { generateGameTableVue } from './project-scaffold.js';
import { generateWorldBoardVue } from './world-scaffold.js';

const ASPECTS = import.meta.glob<string>('../slash-command/aspects/*.md', { eager: true, import: 'default' });

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
      expect(declaredProps(ASPECTS[`../slash-command/aspects/${aspect}.md`])).toEqual(['TableBoardProps']);
    });
  }
});
