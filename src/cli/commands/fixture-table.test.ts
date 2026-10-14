/**
 * #703: THE BROWSER REGRESSIONS' TABLE FIXTURE STARTS, SERVES AND STOPS.
 *
 * `withFixtureTable` serves `boardsmith init`'s table sample through a spawned
 * `boardsmith dev --no-open` for `scripts/*-browser.mjs`, which need a browser
 * and so run only under `boardsmith test --browser`. This runs the lifetime in
 * the ordinary suite with no browser: the host answers while the body runs,
 * and afterwards it no longer answers and the project is gone.
 */
import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { withFixtureTable } from './fixture-table.test-helper.js';

describe('withFixtureTable (#703)', () => {
  it('serves the table sample through boardsmith dev, then stops it and removes the project', async () => {
    const seen = await withFixtureTable(async ({ hostUrl, fixture }) => ({
      hostUrl,
      fixture,
      status: (await fetch(hostUrl)).status,
    }));
    expect(seen.status).toBe(200);
    await expect(fetch(seen.hostUrl), 'the dev host outlived its fixture').rejects.toThrow();
    expect(existsSync(seen.fixture), 'the fixture outlived its host').toBe(false);
  }, 240_000);
});
