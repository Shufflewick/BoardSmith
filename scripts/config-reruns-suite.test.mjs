/**
 * A change to only `vitest.config.ts` reruns the whole suite under `vitest run --changed` (#1419).
 *
 * `agent-policy verify` runs the tests `--changed` picks. A config change can break any test, but no test
 * imports the config, so vitest relies on `forceRerunTriggers` to run them all. This asks vitest whether a
 * change to the config alone picks this test, which does not import it.
 */
import { describe, it, expect } from 'vitest';
import { createVitest } from 'vitest/node';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

// Asks vitest which tests `--changed` picks, here where no test timeout applies (#354).
const vitest = await createVitest('test', { watch: false, related: [join(ROOT, 'vitest.config.ts')] }, { root: ROOT });
const picked = (await vitest.getRelevantTestSpecifications([SELF])).map((spec) => spec.moduleId);
await vitest.close();

describe('vitest config changes (#1419)', () => {
  it('reruns the whole suite when only vitest.config.ts changes', () => {
    expect(
      picked,
      'A change to only vitest.config.ts does not rerun the suite under --changed, so verify can pass with a test ' +
        'red. Add a glob that matches it, anchored at the checkout, to `forceRerunTriggers` in vitest.config.ts.',
    ).toContain(SELF);
  });
});
