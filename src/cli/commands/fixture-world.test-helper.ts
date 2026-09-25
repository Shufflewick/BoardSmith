/**
 * A THROWAWAY WORLD PROJECT, SERVED BY THE CLI'S OWN WORLD DEV HOST, AND GONE
 * AFTERWARDS -- the fixture every browser regression in `scripts/*-browser.mjs`
 * runs against, through `runBrowserRegression` in `scripts/browser-harness.mjs`.
 *
 * It is TypeScript and lives under `src/` so that `boardsmith typecheck`
 * compiles its call to `startWorldDevServer` (#357). It used to be in the
 * harness, a `.mjs` file nothing type-checks, and the scripts need a browser,
 * so nothing runs them either: when #283 changed that call's signature every
 * script broke before its first check, silently. `fixture-world.test.ts` also
 * starts and stops one of these in the ordinary suite, with no browser.
 *
 * `withFixtureWorld` is the only export, because a fixture and the host
 * serving it are one lifetime and getting its order wrong is the mistake
 * (#231): see that function.
 *
 * @module
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { freePort } from './free-port.test-helper.js';
import { hostHoldings } from '../dev-host/shutdown.js';
import { loadWorldRuntime, startWorldDevServer } from './dev-world.js';

/** This checkout, which is the library every fixture resolves against. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A fixture world project, as a browser regression describes it. */
interface FixtureWorldSpec {
  /** The project and game-type name. */
  readonly slug: string;
  /** What the dev host calls it. */
  readonly displayName: string;
  /** The game class the UI registry keys on. */
  readonly gameClass: string;
  /** The whole of `src/rules/index.ts`. */
  readonly rules: string;
  /** The board component's basename, e.g. `FleetBoard`. */
  readonly boardFile: string;
  /** The whole of that component. */
  readonly board: string;
}

/** What a fixture's body is handed while its host is serving. */
interface ServedFixture {
  /** Where the dev chrome is served, on the interface the port was taken on. */
  readonly hostUrl: string;
  /** The project directory. */
  readonly fixture: string;
}

const VITE_CONFIG = `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: { dedupe: ['vue'] },
});
`;

/**
 * Write a throwaway world project and point it at this checkout.
 *
 * A checked-in game project inside the library would be a second thing to keep
 * compiling; these are disposable by design -- born at genesis, exercised once,
 * removed when its host has stopped.
 *
 * @returns the project directory
 */
function writeWorldFixture(spec: FixtureWorldSpec): string {
  // `realpathSync`: on macOS the temp root is a symlink (`/var` -> `/private/var`),
  // and Vite resolves a module id to its real path -- so a root given in the
  // symlinked form puts every one of the project's own files outside it.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `bs-${spec.slug}-`)));
  mkdirSync(join(dir, 'src', 'rules'), { recursive: true });
  mkdirSync(join(dir, 'src', 'ui'), { recursive: true });
  writeFileSync(join(dir, 'src', 'rules', 'index.ts'), spec.rules);
  writeFileSync(join(dir, 'src', 'ui', `${spec.boardFile}.ts`), spec.board);
  writeFileSync(
    join(dir, 'src', 'ui', 'uis.ts'),
    `import { defineGameUIs, defaultUI } from 'boardsmith/ui';\n` +
      `import ${spec.boardFile} from './${spec.boardFile}.js';\n\n` +
      `export default defineGameUIs({ ${spec.gameClass}: defaultUI(${spec.boardFile}) });\n`,
  );
  writeFileSync(join(dir, 'vite.config.ts'), VITE_CONFIG);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: spec.slug, private: true, type: 'module' }, null, 2),
  );
  writeFileSync(
    join(dir, 'boardsmith.json'),
    JSON.stringify({ name: spec.slug, backend: 'world', displayName: spec.displayName }, null, 2),
  );
  // INSTALLED THE WAY A REAL GAME IS. `node_modules/boardsmith` is a symlink to
  // this checkout, exactly what `"boardsmith": "file:../../BoardSmith"` leaves
  // behind in `~/BoardSmithGames/*` -- so the fixture runs in STANDALONE context
  // and resolves the library through its package exports, which is the path an
  // author's own project takes. Its build-time packages come from this
  // checkout's install, wherever Node finds it (#358).
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(dir, 'node_modules', 'boardsmith'), 'dir');
  for (const name of ['vue', 'vite', '@vitejs/plugin-vue']) {
    const at = join(dir, 'node_modules', name);
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(join(INSTALLED_MODULES, name), at, 'dir');
  }
  return dir;
}

/**
 * Serve a fixture through the CLI's own world dev host, on a free port, the
 * way `boardsmith dev` does: the rules and the host that runs them come out of
 * one bundle (#283), and a rule reload rebuilds both.
 *
 * @returns the host, whose `stop()` is the only thing that ends it
 */
async function startWorldHost(fixture: string, displayName: string) {
  const port = await freePort();
  const tempDir = join(fixture, '.boardsmith');
  mkdirSync(tempDir, { recursive: true });
  const rulesPath = join(fixture, 'src', 'rules');
  const host = await startWorldDevServer({
    cwd: fixture,
    uiPath: fixture,
    runtime: await loadWorldRuntime(rulesPath, tempDir, 'standalone'),
    displayName,
    context: 'standalone',
    port,
    host: '127.0.0.1',
    // The fixture is removed whole once the host has stopped, so the build
    // directory inside it is not held separately.
    holdings: hostHoldings(),
    openBrowser: false,
    reloadRules: () => loadWorldRuntime(rulesPath, tempDir, 'standalone'),
  });
  // The host reports the URL Vite resolved, which is `localhost`; a check has
  // to reach the interface the port was actually taken on.
  return { hostUrl: `http://127.0.0.1:${port}/`, stop: host.stop };
}

/**
 * A FIXTURE WORLD, SERVED, AND GONE AFTERWARDS -- IN THAT ORDER (#231).
 *
 * This is the only way to get either half, because getting the ORDER wrong is
 * the mistake, and it is not a mistake a caller should be able to make on its
 * own. Both halves used to be each browser script's business: it wrote the
 * fixture, started the host, removed the fixture in a `finally`, and then
 * exited. Nothing ever stopped the host.
 *
 * That is a race and it was observed as one. The world's own lock can still be
 * draining a disconnect the closing browser fired, and Vite's dep optimiser
 * can still be writing into the project, while `rmSync` is walking the same
 * tree -- so a run sometimes left the whole fixture world behind, re-created
 * underneath the removal. `process.exit()` cannot rescue that: the writes are
 * already in flight, and an exit does not wait for them, it abandons them.
 *
 * So the host's `stop()` is awaited in the INNER guard and the fixture is
 * removed in the OUTER one. When `stop()` resolves the world lock has drained,
 * the store handle is closed and Vite is down: there is no writer left to race.
 * Both guards are `finally`, so a body that throws is cleaned up the same way
 * as one that passes -- and neither guard can be skipped by an exit, because
 * this function returns before any script exits.
 *
 * @param body called with the served fixture; its return value is passed on
 */
export async function withFixtureWorld<T>(
  spec: FixtureWorldSpec,
  body: (served: ServedFixture) => Promise<T>,
): Promise<T> {
  const fixture = writeWorldFixture(spec);
  try {
    const { hostUrl, stop } = await startWorldHost(fixture, spec.displayName);
    try {
      return await body({ hostUrl, fixture });
    } finally {
      await stop();
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
