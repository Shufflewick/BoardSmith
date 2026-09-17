/**
 * Die3D must stay lazily loaded (BS-2 follow-up).
 *
 * Die3D is the only three.js consumer in BoardSmith, and it is statically
 * reachable from GameShell (GameShell -> ZoomPreviewOverlay -> Die3D) and from
 * the public `boardsmith/ui` barrel. When it was imported eagerly, every game
 * shipped the full WebGL renderer: go-fish, a card game that never rolls a die
 * and does not even depend on three, carried ~490KB of three.js (GLSL shader
 * source included) in its main chunk.
 *
 * The split rests on exactly one thing — `dice/index.ts` reaching Die3D.vue
 * through a dynamic `import()`. A single static import anywhere pulls three
 * back into the eager graph, and nothing about the build fails when that
 * happens; the bundle just quietly grows by half a megabyte again. These tests
 * are the alarm.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(HERE, '..', '..', '..');
const DICE_INDEX = join(HERE, 'index.ts');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|vue)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every module under `src/` whose text matches `pattern`, relative to `src/`.
 *
 * This file is skipped: it quotes the specifiers it forbids in order to assert
 * on them, and would otherwise report itself as the offender every time.
 */
function modulesMatching(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((f) => !f.endsWith('die3d-lazy.test.ts'))
    .filter((f) => pattern.test(readFileSync(f, 'utf8')))
    .map((f) => relative(SRC, f))
    .sort();
}

describe('Die3D lazy-loading invariant (BS-2 follow-up)', () => {
  it('routes Die3D.vue through a dynamic import, so three.js gets its own chunk', () => {
    const index = readFileSync(DICE_INDEX, 'utf8');

    expect(index).toMatch(/defineAsyncComponent/);
    expect(index).toMatch(/import\(\s*['"]\.\/Die3D\.vue['"]\s*\)/);
    // A static re-export would defeat the split even with the async one present.
    expect(index).not.toMatch(/^\s*(?:import|export).*from\s+['"]\.\/Die3D\.vue['"]/m);
  });

  it('is the only module in src/ that references Die3D.vue', () => {
    const referrers = modulesMatching(/['"][^'"]*Die3D\.vue['"]/);

    expect(
      referrers,
      `Only the dice barrel may name Die3D.vue: importing it anywhere else pulls three.js back into every ` +
        `game's main bundle. Import { Die3D } from components/dice/index.ts instead. Found:\n` +
        referrers.map((f) => `  - ${f}`).join('\n'),
    ).toEqual(['ui/components/dice/index.ts']);
  });

  it('keeps three.js out of every module except Die3D.vue and the barrel\u2019s lazy probe', () => {
    const importers = modulesMatching(/from\s+['"]three['"]|import\(\s*['"]three['"]\s*\)/);

    expect(
      importers,
      `Only these modules may import three.js \u2014 Die3D.vue is what the lazy chunk is built around, and the ` +
        `barrel asks the resolver for three inside the same async loader so an uninstalled optional peer ` +
        `says so (#276). Any other importer needs its own lazy boundary, or three re-enters the eager graph:\n` +
        importers.map((f) => `  - ${f}`).join('\n'),
    ).toEqual(['ui/components/dice/Die3D.vue', 'ui/components/dice/index.ts']);
  });

  it('reaches three only through a dynamic import, never a static one', () => {
    const barrel = readFileSync(DICE_INDEX, 'utf8');

    // A static `import ... from 'three'` here would put the whole renderer in
    // the eager graph of every game that draws dice, probe or no probe.
    expect(barrel).not.toMatch(/^\s*(?:import|export).*from\s+['"]three['"]/m);
    expect(barrel).toMatch(/import\(\s*['"]three['"]\s*\)/);
  });
});
