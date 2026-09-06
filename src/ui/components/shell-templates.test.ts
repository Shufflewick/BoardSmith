/**
 * A SHELL'S TEMPLATE HAS NO ORPHANED COMMENT (#170).
 *
 * The #170 extraction moved ~450 lines of markup out of `GameShell` and into
 * `PlayShell`, and one slice landed in the MIDDLE of an HTML comment. The
 * opener stayed behind, so eight lines of explanatory prose about the game-over
 * scrim rendered as TEXT across the top of every board.
 *
 * Every unit test stayed green: a stray text node in the board region breaks no
 * assertion anybody had written. It was the browser pass that found it, and this
 * is what stops the next one needing a browser pass to find.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const SHELLS = [
  join(HERE, 'GameShell.vue'),
  join(HERE, 'PlayShell.vue'),
  join(HERE, '..', 'world', 'WorldShell.vue'),
];

/** The `<template>` block, which is the only part where a comment can leak. */
function template(path: string): string {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf('<template>');
  const end = source.lastIndexOf('</template>');
  expect(start, `${path} has no <template>`).toBeGreaterThan(-1);
  return source.slice(start, end);
}

describe.each(SHELLS)('%s', (path) => {
  it('opens and closes every comment it contains', () => {
    const tpl = template(path);
    let depth = 0;
    for (const match of tpl.matchAll(/<!--|-->/g)) {
      depth += match[0] === '<!--' ? 1 : -1;
      expect(
        depth,
        `an unopened "-->" near template line ${tpl.slice(0, match.index).split('\n').length}: ` +
        'the comment above it lost its opener, so its prose renders as text on the page',
      ).toBeGreaterThanOrEqual(0);
    }
    expect(depth, 'a comment was opened and never closed').toBe(0);
  });
});
