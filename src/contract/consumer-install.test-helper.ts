/**
 * ONE SANDBOX THAT HOLDS THIS PACKAGE THE WAY A CONSUMER HOLDS IT (#273, #276).
 *
 * Every gate that compiles our source the way a game compiles it needs the same
 * unusual tree: a `node_modules` holding ONLY the production closure of
 * `package-lock.json`, our `src` symlinked in as `node_modules/boardsmith`, and
 * `preserveSymlinks` so TypeScript resolves from where a file SITS rather than
 * from where it really lives. Without that last part the compiler walks up into
 * this checkout's own `node_modules` and every devDependency resolves perfectly
 * while a consumer is broken -- which is exactly the blindness #273 was filed
 * for and #276 was found through.
 *
 * `dev-host-typecheck.test.ts` uses it for the native-host modules.
 * `dice-typecheck.test.ts` uses it for `boardsmith/ui/dice`, twice: once with
 * the optional `three` peer installed and once without.
 */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { tempTree } from '../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../testing/installed-modules.test-helper.js';
import { REPO_ROOT } from './vue-tsc-run.test-helper.js';

/**
 * What a game installs alongside us to run `vue-tsc` at all. Anything NOT in
 * this list, not named by a gate's `alsoInstalled`, and not in our production
 * closure is absent from the sandbox, which is the whole point.
 */
const SUPPLIED_BY_THE_CONSUMER = ['typescript', 'vue', 'vue-tsc'] as const;

interface LockPackage {
  readonly dev?: boolean;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

const PREFIX = 'node_modules/';

function lockPackages(): Record<string, LockPackage> {
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, LockPackage>;
  };
  return lock.packages;
}

/** Every top-level package a plain `npm install boardsmith` would produce. */
function productionClosure(): string[] {
  return Object.entries(lockPackages())
    .filter(([path, entry]) => path.startsWith(PREFIX) && !entry.dev)
    .map(([path]) => path.slice(PREFIX.length))
    .filter((name) => !name.includes(PREFIX));
}

/**
 * `names` plus everything they pull in, as TOP-LEVEL package names.
 *
 * A package the consumer installs is only usable if its own dependencies are
 * reachable from it. `vue` was the case that taught this: symlinking it alone
 * put a `vue` in the sandbox whose every internal import of `@vue/runtime-dom`
 * failed, and the compiler's report of that -- `Module '"vue"' has no exported
 * member 'ref'` -- looks nothing like the missing package it is.
 *
 * Only top-level entries are listed: a dependency npm nested UNDER a package
 * lives inside that package's own directory and arrives with the symlink.
 */
function transitiveClosure(names: readonly string[]): string[] {
  const lock = lockPackages();
  const found = new Set<string>();
  const queue = [...names];

  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (found.has(name)) continue;
    found.add(name);

    const entry = lock[`${PREFIX}${name}`];
    if (!entry) continue;
    for (const dep of Object.keys({ ...entry.dependencies, ...entry.peerDependencies })) {
      // Nested under this package? Then it is inside the directory we symlink.
      if (lock[`${PREFIX}${name}${PREFIX}${dep}`]) continue;
      queue.push(dep);
    }
  }

  return [...found];
}

interface ConsumerInstall {
  /** Paths inside `node_modules/boardsmith`, e.g. `src/ui/components/dice/index.ts`. */
  readonly entryPoints: readonly string[];
  /**
   * Packages the game installs ON TOP of our production closure, beyond the
   * toolchain every game brings. An optional peer dependency belongs here: a
   * gate proves BOTH the install that declared it and the install that did not.
   */
  readonly alsoInstalled?: readonly string[];
}

/**
 * A tree that holds this package as a consumer would hold it: our `src` under
 * `node_modules/boardsmith`, and beside it only what the install being modelled
 * actually provides. Returns the tree's root; `tsconfig.json` sits at the top.
 */
export function consumerInstall({ entryPoints, alsoInstalled = [] }: ConsumerInstall): string {
  const root = tempTree('bs-consumer-install-');
  const modules = join(root, 'node_modules');

  const present = new Set([
    ...productionClosure(),
    ...transitiveClosure([...SUPPLIED_BY_THE_CONSUMER, ...alsoInstalled]),
  ]);
  for (const name of present) {
    const from = join(INSTALLED_MODULES, name);
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
        files: entryPoints.map((entry) => `node_modules/boardsmith/${entry}`),
      },
      null,
      2,
    ),
  );

  return root;
}
