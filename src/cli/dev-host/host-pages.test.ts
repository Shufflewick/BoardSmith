/**
 * The dev host's own pages name their icon (#453).
 *
 * A page with no icon makes the browser ask the server for `/favicon.ico`, which the dev server
 * answers 404, and Chromium logs that as a console error on every load. The in-browser smoke test
 * fails on any console error, so a page that asks for nothing is the fix, not a filter.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('the dev host pages', () => {
  it.each(['host.html', 'world-host.html'])('%s declares an inline icon, so no /favicon.ico is requested', (page) => {
    expect(readFileSync(join(here, page), 'utf-8')).toContain('<link rel="icon" href="data:," />');
  });
});
