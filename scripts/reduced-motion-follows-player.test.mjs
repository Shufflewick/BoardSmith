/**
 * Every reduced-motion rule follows the player's Reduce motion setting too (#1442).
 *
 * The `prefers-reduced-motion` media query sees only the device setting, so a
 * rule written with it would keep animating for a player who turned on Reduce
 * motion in the controls menu. `reducedMotion.ts` is the one place that reads
 * the device setting; it folds it into `prefersReducedMotion` and the shells
 * mirror that as the `bs-reduce-motion` class on `<html>`, which CSS keys on.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'src/ui/composables/reducedMotion.ts';

describe('the device reduced-motion setting is read in one place (#1442)', () => {
  it('no shipped source but reducedMotion.ts uses prefers-reduced-motion', () => {
    const findings = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\n')
      .filter((path) => /\.(?:ts|vue|css)$/.test(path))
      .filter((path) => !/\.test\.ts$|\.test-helper\.ts$/.test(path) && path !== OWNER)
      .flatMap((path) => readFileSync(join(ROOT, path), 'utf-8').split('\n')
        .flatMap((text, i) => (/prefers-reduced-motion/.test(text) ? [`${path}:${i + 1}: ${text.trim()}`] : [])));
    expect(findings, 'Key reduced-motion CSS on `.bs-reduce-motion` (set on <html> from the device setting or the player\'s Reduce motion choice), and read `prefersReducedMotion` in script.').toEqual([]);
  });
});
