/**
 * Every reduced-motion rule follows the player's Reduce motion setting too (#1442).
 *
 * The `prefers-reduced-motion` media query sees only the device setting, so a
 * rule written with it would keep animating for a player who turned on Reduce
 * motion in the controls menu. `reducedMotion.ts` is the one place that reads
 * the device setting; it folds it into `prefersReducedMotion` and the shells
 * mirror that as the `bs-reduce-motion` class on `<html>`, which CSS keys on.
 * A component can be on a page with no shell, so whatever ships CSS keyed on
 * the class keeps it in step itself (#1446).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'src/ui/composables/reducedMotion.ts';
const SYNC = /\bsyncReducedMotionClass\(\)/;

const shippedSources = () => execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf-8' })
  .split('\n')
  .filter((path) => /\.(?:ts|vue|css)$/.test(path))
  .filter((path) => !/\.test\.ts$|\.test-helper\.ts$/.test(path) && path !== OWNER)
  .map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf-8') }));

describe('the device reduced-motion setting is read in one place (#1442)', () => {
  it('no shipped source but reducedMotion.ts uses prefers-reduced-motion', () => {
    const findings = shippedSources()
      .flatMap(({ path, text }) => text.split('\n')
        .flatMap((line, i) => (/prefers-reduced-motion/.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : [])));
    expect(findings, 'Key reduced-motion CSS on `.bs-reduce-motion` (set on <html> from the device setting or the player\'s Reduce motion choice), and read `prefersReducedMotion` in script.').toEqual([]);
  });
});

describe('CSS keyed on .bs-reduce-motion keeps the class in step itself (#1446)', () => {
  const sources = shippedSources();
  const css = ({ path, text }) => (path.endsWith('.vue') ? text.slice(text.indexOf('<style')) : path.endsWith('.css') ? text : '');
  const keyed = sources.filter((source) => css(source).includes('.bs-reduce-motion'));

  it('every component with such CSS calls syncReducedMotionClass()', () => {
    const findings = keyed.filter(({ path, text }) => path.endsWith('.vue') && !SYNC.test(text)).map(({ path }) => path);
    expect(findings, 'Call `syncReducedMotionClass()` in the setup of each of these components, so its reduced-motion CSS works on a page with no shell.').toEqual([]);
  });

  it('every class a stylesheet styles under it is set by a script that calls syncReducedMotionClass()', () => {
    const scripts = sources.filter(({ path }) => !path.endsWith('.css'));
    const findings = keyed.filter(({ path }) => path.endsWith('.css')).flatMap(({ path, text }) => {
      const styled = [...text.matchAll(/\.bs-reduce-motion(\s+\.[\w-]+)?/g)].map((m) => m[1]?.trim().slice(1));
      return [...new Set(styled)]
        .filter((name) => !name || !scripts.some((s) => s.text.includes(`'${name}'`) && SYNC.test(s.text)))
        .map((name) => `${path}: .bs-reduce-motion ${name ? `.${name}` : 'with no class after it'}`);
    });
    expect(findings, 'Each of these classes needs a script that sets it and calls `syncReducedMotionClass()`, so the stylesheet works on a page with no shell.').toEqual([]);
  });
});
