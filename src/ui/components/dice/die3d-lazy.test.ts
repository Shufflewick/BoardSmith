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

describe('Die3D lazy-loading invariant (BS-2 follow-up)', () => {
  it('routes Die3D.vue through a dynamic import, so three.js gets its own chunk', () => {
    const index = readFileSync(DICE_INDEX, 'utf8');

    expect(index).toMatch(/defineAsyncComponent/);
    expect(index).toMatch(/import\(\s*['"]\.\/Die3D\.vue['"]\s*\)/);
    // A static re-export would defeat the split even with the async one present.
    expect(index).not.toMatch(/^\s*(?:import|export).*from\s+['"]\.\/Die3D\.vue['"]/m);
  });

  it('is the only module in src/ that references Die3D.vue', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => f !== DICE_INDEX)
      .filter((f) => !f.endsWith('die3d-lazy.test.ts'))
      .filter((f) => /['"][^'"]*Die3D\.vue['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));

    expect(
      offenders,
      `These modules import Die3D.vue directly, which pulls three.js back into every game's ` +
        `main bundle. Import { Die3D } from the dice barrel (components/dice/index.ts) instead:\n` +
        offenders.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps three.js out of every module except Die3D.vue', () => {
    const importers = sourceFiles(SRC)
      .filter((f) => /from\s+['"]three['"]|import\(\s*['"]three['"]\s*\)/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));

    expect(
      importers,
      `Only Die3D.vue may import three.js — it is the module the lazy chunk is built around. ` +
        `Any other importer needs its own lazy boundary, or three re-enters the eager graph:\n` +
        importers.map((f) => `  - ${f}`).join('\n'),
    ).toEqual(['ui/components/dice/Die3D.vue']);
  });
});
