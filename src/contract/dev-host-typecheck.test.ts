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
import { mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { tempTree } from '../testing/temp-tree.test-helper.js';
import { REPO_ROOT, VUE_TSC, vueTscErrors } from './vue-tsc-run.test-helper.js';

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

/**
 * What a game installs alongside us to run `vue-tsc` at all. Anything NOT in
 * this list and not in our production closure is absent from the sandbox, which
 * is the whole point: `three` and `@types/three` are devDependencies here, and
 * a consumer of the development host does not get them.
 */
const SUPPLIED_BY_THE_CONSUMER = ['typescript', 'vue', 'vue-tsc'] as const;

interface LockPackage {
  readonly dev?: boolean;
}

/** Every top-level package a plain `npm install boardsmith` would produce. */
function productionClosure(): string[] {
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, LockPackage>;
  };
  const prefix = 'node_modules/';
  return Object.entries(lock.packages)
    .filter(([path, entry]) => path.startsWith(prefix) && !entry.dev)
    .map(([path]) => path.slice(prefix.length))
    .filter((name) => !name.includes('node_modules/'));
}

/**
 * A tree that holds this package as a consumer would hold it: our `src` under
 * `node_modules/boardsmith`, and beside it only what we declare.
 */
function consumerInstall(): string {
  const root = tempTree('bs-dev-host-consumer-');
  const modules = join(root, 'node_modules');

  for (const name of new Set([...productionClosure(), ...SUPPLIED_BY_THE_CONSUMER])) {
    const from = join(REPO_ROOT, 'node_modules', name);
    if (!existsSync(from)) continue;
    const to = join(modules, name);
    mkdirSync(dirname(to), { recursive: true });
    symlinkSync(from, to);
  }

  // `src` and `package.json` only -- NOT the checkout, whose `node_modules`
  // would put every devDependency back within reach of the lookup.
  const installed = join(modules, 'boardsmith');
  mkdirSync(installed, { recursive: true });
  symlinkSync(join(REPO_ROOT, 'src'), join(installed, 'src'));
  symlinkSync(join(REPO_ROOT, 'package.json'), join(installed, 'package.json'));

  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          jsx: 'preserve',
          types: ['vite/client', 'node'],
          noEmit: true,
          // Resolve from where the file SITS, not from where it really lives.
          preserveSymlinks: true,
        },
        files: DEV_HOST_ENTRY_POINTS.map((entry) => `node_modules/boardsmith/${entry}`),
      },
      null,
      2,
    ),
  );

  return root;
}

describe("BoardSmith's development host type-checks from a consumer's install (#273)", () => {
  it('reports zero vue-tsc errors with only the declared dependencies present', () => {
    const root = consumerInstall();

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
