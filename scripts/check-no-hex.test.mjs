/**
 * TOKEN-06: Prove the color-no-hex stylelint guard bites on new hex literals.
 *
 * This test verifies that:
 *   1. A raw hex color (e.g. #ff0000) in a non-ignored .vue <style> block produces
 *      a color-no-hex stylelint warning — the wrong path fails CI.
 *   2. The same location using a `var(--bsg-*)` token produces zero warnings —
 *      the right path passes.
 *
 * The probe file is created under src/ui/__hexprobe__/probe.vue, which is NOT in the
 * .stylelintrc.cjs ignoreFiles list, so the rule applies in full. The probe directory
 * is deleted in afterEach — no files are left behind after the test run.
 */

import { describe, it, expect, afterEach } from 'vitest';
import stylelint from 'stylelint';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Probe lives inside src/ui/ so stylelint's src/ui/**/*.vue glob picks it up,
// but the path is NOT matched by any entry in the ignoreFiles list.
const PROBE_DIR = path.join(PROJECT_ROOT, 'src', 'ui', '__hexprobe__');
const PROBE_FILE = path.join(PROBE_DIR, 'probe.vue');
const CONFIG_FILE = path.join(PROJECT_ROOT, '.stylelintrc.cjs');

/**
 * Write a minimal Vue SFC whose <style> block contains the given CSS declaration.
 */
function writeProbeVue(cssDeclaration) {
  mkdirSync(PROBE_DIR, { recursive: true });
  writeFileSync(
    PROBE_FILE,
    [
      '<template><div>probe</div></template>',
      '<style scoped>',
      `a { ${cssDeclaration} }`,
      '</style>',
      '',
    ].join('\n'),
  );
}

afterEach(() => {
  if (existsSync(PROBE_DIR)) {
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }
});

describe('color-no-hex stylelint guard (TOKEN-06)', () => {
  it('reports ≥1 color-no-hex violation for a raw hex literal in a non-ignored .vue file', async () => {
    writeProbeVue('color: #ff0000;');

    const result = await stylelint.lint({
      files: PROBE_FILE,
      configFile: CONFIG_FILE,
    });

    const hexWarnings = result.results
      .flatMap(r => r.warnings)
      .filter(w => w.rule === 'color-no-hex');

    expect(hexWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('reports zero color-no-hex warnings when a --bsg-* token is used instead', async () => {
    writeProbeVue('color: var(--bsg-accent);');

    const result = await stylelint.lint({
      files: PROBE_FILE,
      configFile: CONFIG_FILE,
    });

    const hexWarnings = result.results
      .flatMap(r => r.warnings)
      .filter(w => w.rule === 'color-no-hex');

    expect(hexWarnings.length).toBe(0);
  });
});
