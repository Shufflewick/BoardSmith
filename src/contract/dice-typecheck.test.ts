/**
 * `boardsmith/ui/dice`, COMPILED WITH ONLY WHAT WE SHIP (BoardSmith #276, #1577).
 *
 * `Die3D.vue` imports `three`. We ship TypeScript and Vue SOURCE -- `exports`
 * maps `types` and `import` straight at `src/**` -- so a game that imports this
 * entry point compiles OUR file, and `three` has to be somewhere a game's own
 * resolver can find it.
 *
 * `three` and `@types/three` are regular dependencies (#1577): a game that
 * draws dice declares nothing for them, since only Die3D uses three. The
 * sandbox installs our production closure and the toolchain every game brings,
 * and no peer, so this is red the moment three stops arriving with BoardSmith.
 */
import { describe, it } from 'vitest';
import { consumerInstall } from './consumer-install.test-helper.js';
import { expectCleanCompile } from './vue-tsc-run.test-helper.js';

/** The published entry point, exactly as `exports["./ui/dice"]` names it. */
const DICE_ENTRY_POINTS = ['src/ui/components/dice/index.ts'] as const;

describe('`boardsmith/ui/dice` type-checks from a consumer\'s install (#276, #1577)', () => {
  it('reports zero vue-tsc errors for a game that declares nothing for three', () => {
    const root = consumerInstall({ entryPoints: DICE_ENTRY_POINTS });

    expectCleanCompile(
      root,
      'tsconfig.json',
      'boardsmith/ui/dice with only our production closure and the toolchain a game brings (no three in the game)',
      'A "Cannot find module" here means the dice surface imports something BoardSmith does not install for ' +
        'the game -- declare it in "dependencies" and refresh package-lock.json.',
    );
  }, 180_000);
});
