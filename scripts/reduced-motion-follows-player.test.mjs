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

// Links the files this check reads, so `vitest run --changed` runs it when only one changes; nothing loads (#1504).
import.meta.glob(['/src/**/*.{ts,vue,css}', '!**/*.test.ts']);

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

describe('motion driven from script reads prefersReducedMotion (#1447)', () => {
  it('every source that tweens over time, runs element.animate() or sets an inline transition checks it', () => {
    const code = (text) => text.split('\n').filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line)).join('\n');
    const tweens = (text) => /requestAnimationFrame/.test(text) && /Date\.now\(\)|performance\.now\(\)/.test(text);
    const animates = (text) => /\)\.animate\(|\w\.animate\(\s*\[/.test(text);
    const transitions = (text) => /setProperty\(\s*'transition',(?!\s*'none')|\.transition\s*=(?!\s*'none')/.test(text);
    const findings = shippedSources()
      .filter(({ path }) => !path.endsWith('.css'))
      .filter(({ text }) => [tweens, animates, transitions].some((moves) => moves(code(text))))
      .filter(({ text }) => !/\bprefersReducedMotion\b/.test(text))
      .map(({ path }) => path);
    expect(findings, 'Each of these moves things from script; read `prefersReducedMotion` and skip or shorten the motion when it is on.').toEqual([]);
  });
});
