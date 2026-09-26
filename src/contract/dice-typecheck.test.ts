/**
 * `boardsmith/ui/dice`, COMPILED WITH ONLY WHAT WE SHIP (BoardSmith #276).
 *
 * `Die3D.vue` imports `three`. We ship TypeScript and Vue SOURCE -- `exports`
 * maps `types` and `import` straight at `src/**` -- so a game that imports this
 * entry point compiles OUR file, and `three` has to be somewhere a game's own
 * resolver can find it. While `three` was a devDependency it was findable only
 * here, in this checkout, which is the one place no gate should be looking.
 *
 * The decision recorded by this gate is that `three` and `@types/three` are
 * OPTIONAL PEER DEPENDENCIES: 41 MB that only the dice surface needs, declared
 * so the one game in fourteen that rolls dice installs them and the other
 * thirteen do not. That decision is only safe if BOTH halves hold, so both are
 * gated here:
 *
 *   1. The install that honoured the contract compiles clean. The sandbox
 *      installs exactly what `package.json` declares -- production closure plus
 *      declared peers -- so this test moves with the packaging rather than with
 *      a list written beside it. It is red for a devDependency, and green for a
 *      peer dependency or a real dependency alike.
 *
 *   2. The install that did NOT compiles into an instruction. An optional peer
 *      is only Pit of Success if its absence says what to install; a bare
 *      "Cannot find module 'three'" inside `node_modules/boardsmith` reads as
 *      our bug, and the game author has no way to know it is theirs to fix.
 *      This drives the real compiler at a real sandbox and asserts the real
 *      diagnostics are the ones `missingThreePeerHint` turns into that
 *      instruction -- the same function `boardsmith validate` prints from.
 */
import { describe, it, expect } from 'vitest';
import { consumerInstall, declaredPeers } from './consumer-install.test-helper.js';
import { VUE_TSC, vueTscErrors } from './vue-tsc-run.test-helper.js';
import { missingThreePeerHint, THREE_PEER_INSTRUCTION } from '../ui/components/dice/three-peer.js';

/** The published entry point, exactly as `exports["./ui/dice"]` names it. */
const DICE_ENTRY_POINTS = ['src/ui/components/dice/index.ts'] as const;

describe('`boardsmith/ui/dice` type-checks from a consumer\'s install (#276)', () => {
  it('reports zero vue-tsc errors for a consumer holding what package.json declares', () => {
    const root = consumerInstall({
      entryPoints: DICE_ENTRY_POINTS,
      alsoInstalled: declaredPeers(),
    });

    const errors = vueTscErrors(root, 'tsconfig.json');

    expect(
      errors,
      errors.length === 0
        ? ''
        : `vue-tsc reports ${errors.length} error(s) compiling boardsmith/ui/dice with only the packages a ` +
          `consumer receives: our production closure plus the peer dependencies package.json declares. A ` +
          `"Cannot find module" here means the dice surface imports something no install of this package ` +
          `provides -- declare it in "dependencies" or "peerDependencies" and refresh package-lock.json. ` +
          `Repeat the run with:\n` +
          `  cd ${root} && node ${VUE_TSC} --noEmit -p tsconfig.json\n\n` +
          errors.join('\n'),
    ).toEqual([]);
  }, 180_000);

  it('turns the absent optional peer into the install instruction, not a bare resolution failure', () => {
    const root = consumerInstall({ entryPoints: DICE_ENTRY_POINTS });

    const errors = vueTscErrors(root, 'tsconfig.json');

    // The premise: without the peer, a consumer's compilation really does fail.
    // If this is ever empty, `three` is reaching the sandbox some other way and
    // the test above has stopped proving anything.
    expect(
      errors.length,
      `Compiling boardsmith/ui/dice WITHOUT three should fail, and did not. The sandbox at ${root} is ` +
        `resolving three from somewhere it should not -- check that it is not a declared dependency.`,
    ).toBeGreaterThan(0);

    expect(
      missingThreePeerHint(errors),
      `The compiler's own words for an absent three are what a game author sees, and they have to be ` +
        `recognised as the missing optional peer rather than left to read as a bug in BoardSmith. ` +
        `missingThreePeerHint did not recognise:\n` +
        errors.join('\n'),
    ).toBe(THREE_PEER_INSTRUCTION);
  }, 180_000);
});
