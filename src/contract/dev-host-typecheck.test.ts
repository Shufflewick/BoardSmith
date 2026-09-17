/**
 * THE DEVELOPMENT HOST, COMPILED WITH ONLY WHAT WE SHIP (BoardSmith #273).
 *
 * `src/contract/public-typecheck.test.ts` performs a game's compilation of our
 * public entry points, and it is the right gate for the errors a game sees. It
 * structurally cannot see the error class BELOW, because it runs INSIDE this
 * checkout: every `devDependency` is installed here, so a declaration file that
 * never reaches a consumer resolves perfectly while the gate is looking.
 *
 * That is exactly how #273 shipped. `ws` is a real dependency, but `@types/ws`
 * was a devDependency, so this package's OWN source imported typings that no
 * install of it ever received. A harness driving the real native host -- rather
 * than a browser -- imports these three modules as ordinary TypeScript (we ship
 * `src`, and `exports` maps `types` straight at it) and got:
 *
 *   dev-server.ts: TS7016 Could not find a declaration file for module 'ws'
 *   dev-server.ts: TS7006 Parameter 'ws' implicitly has an 'any' type
 *   world-store.ts: TS2322 Type 'string | undefined' is not assignable to 'string'
 *
 * So this test compiles those modules somewhere our devDependencies DO NOT
 * EXIST: a sandbox whose `node_modules` holds the production closure of
 * `package-lock.json` and nothing else, plus the toolchain a game brings
 * itself. `preserveSymlinks` is what makes that real -- without it TypeScript
 * resolves each source file to its true path in this checkout and walks up into
 * our own `node_modules`, which is the blindness being fixed.
 *
 * There is deliberately no `tsconfig.dev-host.json` to run by hand: a config
 * in this repo's root would be compiled against this repo's `node_modules` and
 * would report zero errors while a consumer is broken. The sandbox IS the gate,
 * and a failure prints its path so the run can be repeated there.
 */
import { describe, it, expect } from 'vitest';

import { consumerInstall } from './consumer-install.test-helper.js';
import { VUE_TSC, vueTscErrors } from './vue-tsc-run.test-helper.js';

/**
 * THE MODULES A NATIVE-HOST HARNESS IMPORTS, and the reason this list is short.
 *
 * Not the whole CLI: the rest of it is reached through `bin/boardsmith.js` as a
 * PROGRAM, never compiled by anyone downstream, and `docs/typecheck.md` records
 * the backlog it carries. These three are imported as source by consumers, so
 * these three are held to a consumer's compilation.
 */
const DEV_HOST_ENTRY_POINTS = [
  'src/cli/dev-host/world-host.ts',
  'src/cli/dev-host/world-store.ts',
  'src/cli/commands/dev-server.ts',
] as const;

describe("BoardSmith's development host type-checks from a consumer's install (#273)", () => {
  it('reports zero vue-tsc errors with only the declared dependencies present', () => {
    const root = consumerInstall({ entryPoints: DEV_HOST_ENTRY_POINTS });

    const errors = vueTscErrors(root, 'tsconfig.json');

    expect(
      errors,
      errors.length === 0
        ? ''
        : `vue-tsc reports ${errors.length} error(s) compiling BoardSmith's development host with only the ` +
          `packages a consumer receives. A TS7016 here means a typings package is a devDependency and so never ` +
          `ships -- move it into "dependencies" in package.json and refresh package-lock.json. Any other error ` +
          `is an ordinary type error in our source. Repeat the run with:\n` +
          `  cd ${root} && node ${VUE_TSC} --noEmit -p tsconfig.json\n\n` +
          errors.join('\n'),
    ).toEqual([]);
  }, 180_000);
});
