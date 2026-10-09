/**
 * TOKEN-06: Prove the color-no-hex stylelint guard bites on new hex literals.
 *
 * This test verifies that:
 *   1. A raw hex color (e.g. #ff0000) in a non-ignored .vue <style> block produces
 *      a color-no-hex stylelint warning — the wrong path fails CI.
 *   2. The same location using a `var(--bsg-*)` token produces zero warnings —
 *      the right path passes.
 *
 * The probe is linted as source text under the name src/ui/__hexprobe__/probe.vue,
 * which is NOT in the .stylelintrc.cjs ignoreFiles list, so the rule applies in full.
 * Stylelint applies its ignore rules to that name exactly as it would to a file there.
 *
 * Nothing is written to disk. A probe file in the checkout is an untracked file every
 * other test file running at the same moment can see, and `boardsmith verify`'s mutant
 * cache keys outcomes by this checkout's untracked files, so its reuse test failed
 * whenever the probe existed while one verify opened the cache and not the other (#571).
 */

import { describe, it, expect } from 'vitest';
import stylelint from 'stylelint';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// The name the probe is linted under: inside src/ui/, as every .vue file the guard
// covers is, and matched by no entry in the ignoreFiles list.
const PROBE_FILE = path.join(PROJECT_ROOT, 'src', 'ui', '__hexprobe__', 'probe.vue');
const CONFIG_FILE = path.join(PROJECT_ROOT, '.stylelintrc.cjs');

/** The color-no-hex warnings for a minimal Vue SFC whose <style> block holds `cssDeclaration`. */
async function hexWarningsFor(cssDeclaration) {
  const result = await stylelint.lint({
    code: ['<template><div>probe</div></template>', '<style scoped>', `a { ${cssDeclaration} }`, '</style>', ''].join('\n'),
    codeFilename: PROBE_FILE,
    configFile: CONFIG_FILE,
  });
  // A name ignored by .stylelintignore yields no result, and one ignored by the config's
  // ignoreFiles yields a result marked ignored with no warnings; either would make the token
  // case pass vacuously, so the probe must come back as exactly one linted result.
  expect(result.results).toHaveLength(1);
  expect(result.results[0].ignored).toBeFalsy();
  return result.results.flatMap((r) => r.warnings).filter((w) => w.rule === 'color-no-hex');
}

describe('color-no-hex stylelint guard (TOKEN-06)', () => {
  it('reports ≥1 color-no-hex violation for a raw hex literal in a non-ignored .vue file', async () => {
    expect((await hexWarningsFor('color: #ff0000;')).length).toBeGreaterThanOrEqual(1);
  });

  it('reports zero color-no-hex warnings when a --bsg-* token is used instead', async () => {
    expect(await hexWarningsFor('color: var(--bsg-accent);')).toHaveLength(0);
  });
});
