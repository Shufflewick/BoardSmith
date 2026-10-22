/**
 * A change to only a vitest config file reruns the whole suite under `vitest run --changed` (#1419).
 *
 * `agent-policy verify` runs the tests `--changed` picks. A config change can break any test, but no test
 * imports the config, so vitest relies on `forceRerunTriggers` to run them all. This asks vitest whether a
 * change to each config alone picks this test, which imports neither.
 */
import { describe, it, expect } from 'vitest';
import { createVitest } from 'vitest/node';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
const CONFIGS = ['vitest.config.ts', 'vitest.browser.config.ts'];

// Asks vitest which tests `--changed` picks, here where no test timeout applies (#354).
const vitest = await createVitest('test', { watch: false }, { root: ROOT });
const missed = [];
for (const config of CONFIGS) {
  vitest.config.related = [join(ROOT, config)];
  const picked = await vitest.getRelevantTestSpecifications([SELF]);
  if (!picked.some((spec) => spec.moduleId === SELF)) missed.push(config);
}
await vitest.close();

describe('vitest config changes (#1419)', () => {
  it('reruns the whole suite when only a vitest config file changes', () => {
    expect(
      missed,
      'A change to only these files does not rerun the suite under --changed, so verify can pass with a test red. ' +
        "Add a glob that matches each one to `forceRerunTriggers` in vitest.config.ts.",
    ).toEqual([]);
  });
});
