/**
 * THE SCAFFOLDING EVERY REAL-BROWSER WORLD REGRESSION NEEDS.
 *
 * A browser regression in this repo is always the same shape: write a disposable
 * world project into a temp directory, point it at this checkout the way a real
 * game project points at it, start the real `boardsmith dev` world host on a
 * port nobody else is on, drive real Chromium at it, and report which checks
 * passed. Only the world and the driving are ever different.
 *
 * #227 wrote all of that once. #229 needed the same again, and copying it was
 * 258 duplicated lines -- which is not a style complaint: two copies of the
 * Playwright loader means the next person to add a browser check fixes the
 * refusal message in one of them, and two copies of the fixture writer means
 * one of them keeps symlinking a package list the CLI has stopped needing. So
 * it lives here and both scripts import it.
 *
 * NOT IN `npx vitest run`, and neither is anything built on it: these need
 * Chromium and BoardSmith depends on no browser. See the header of either
 * script for the full argument.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** This checkout, which is the library every fixture below is served against. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The build-time packages a generated world project resolves from here. */
const BORROWED_PACKAGES = ['vue', 'vite', '@vitejs/plugin-vue'];

const VITE_CONFIG = `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: { dedupe: ['vue'] },
});
`;

/**
 * Write a disposable world project and point it at this checkout.
 *
 * `files` is a map of project-relative path to contents, so a caller supplies
 * only its own rules and UI. The project's manifests, its Vite config and its
 * `node_modules` are the same every time and are written here.
 *
 * The fixture is generated per run rather than checked in: a game project
 * inside the library would be a second thing to keep compiling, and these are
 * disposable by design -- a world nobody has played, born at genesis, exercised
 * once. The caller is responsible for removing the directory.
 */
export function writeWorldFixture({ prefix, name, displayName, files }) {
  // `realpathSync`: on macOS the temp root is a symlink (`/var` ->
  // `/private/var`), and Vite resolves a module id to its real path -- so a root
  // given in the symlinked form puts every one of the project's own files
  // outside it.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  for (const [at, contents] of Object.entries(files)) {
    const path = join(dir, at);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  writeFileSync(join(dir, 'vite.config.ts'), VITE_CONFIG);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, private: true, type: 'module' }, null, 2),
  );
  writeFileSync(
    join(dir, 'boardsmith.json'),
    JSON.stringify({ name, backend: 'world', displayName }, null, 2),
  );
  // INSTALLED THE WAY A REAL GAME IS. `node_modules/boardsmith` is a symlink to
  // this checkout, exactly what `"boardsmith": "file:../../BoardSmith"` leaves
  // behind in `~/BoardSmithGames/*` -- so the fixture runs in STANDALONE context
  // and resolves the library through its package exports, which is the path an
  // author's own project takes.
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(dir, 'node_modules', 'boardsmith'), 'dir');
  for (const borrowed of BORROWED_PACKAGES) {
    const at = join(dir, 'node_modules', borrowed);
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(join(REPO, 'node_modules', borrowed), at, 'dir');
  }
  return dir;
}

/**
 * Every way of naming one Playwright, since what a person has to hand is a
 * DIRECTORY as often as an entry file -- `.../node_modules/playwright` is what
 * the reporter's own harness was pointed at, and Node will not import a folder.
 */
function playwrightCandidates(named) {
  if (!named) return ['playwright', 'playwright-core'];
  if (!statSync(named, { throwIfNoEntry: false })?.isDirectory()) return [named];
  return [join(named, 'index.mjs'), join(named, 'index.js'), named];
}

/** What went wrong, as a line a person can act on. */
const describeFailure = (error) => (error instanceof Error ? error.message : String(error));

/** Playwright's chromium, however this build of it chose to be exported. */
const chromiumOf = (module) => module.chromium ?? module.default?.chromium;

/** One candidate's chromium, or `null` with the reason recorded. */
async function chromiumFrom(specifier, failures) {
  try {
    const chromium = chromiumOf(await import(specifier));
    if (chromium) return chromium;
    failures.push(`${specifier}: loaded, but exports no chromium`);
  } catch (error) {
    failures.push(`${specifier}: ${describeFailure(error)}`);
  }
  return null;
}

/**
 * Chromium, or an actionable refusal.
 *
 * It never skips: with no Playwright reachable it says how to give it one and
 * the caller exits non-zero, because a browser regression that quietly passes
 * when it did not run is the thing these scripts exist to replace.
 */
async function loadChromium(scriptName) {
  const failures = [];
  for (const candidate of playwrightCandidates(process.env.BOARDSMITH_PLAYWRIGHT_MODULE)) {
    const chromium = await chromiumFrom(candidate, failures);
    if (chromium) return chromium;
  }
  throw new Error(
    'This regression drives a real browser and found no Playwright to drive it with.\n'
      + `  Tried: ${failures.join('\n         ')}\n`
      + '  BoardSmith depends on no browser, so point it at one you already have:\n'
      + '    BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \\\n'
      + `      node scripts/${scriptName}\n`
      + '  A directory or an entry file both work, and any checkout with Playwright\n'
      + '  installed will do; there is no need to add one here.',
  );
}

/** A port nobody else is on. */
function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

/**
 * Start the real world dev host over a generated fixture, and return its URL.
 *
 * `tsx` first, exactly as `bin/boardsmith.js` does it: everything below is the
 * CLI's own TypeScript, run from source with no build step.
 */
export async function startWorldHost({ fixture, displayName }) {
  const port = await freePort();
  await import('tsx');
  const { startWorldDevServer } = await import(join(REPO, 'src/cli/commands/dev-world.ts'));
  const { loadGameDefinition } = await import(join(REPO, 'src/cli/commands/game-runtime.ts'));

  const tempDir = join(fixture, '.boardsmith');
  mkdirSync(tempDir, { recursive: true });
  const rulesPath = join(fixture, 'src', 'rules');
  const { gameDefinition } = await loadGameDefinition(rulesPath, tempDir, 'standalone');

  await startWorldDevServer({
    cwd: fixture,
    uiPath: fixture,
    gameDefinition,
    displayName,
    context: 'standalone',
    port,
    host: '127.0.0.1',
    tempDir,
    openBrowser: false,
    reloadRules: async () =>
      (await loadGameDefinition(rulesPath, tempDir, 'standalone')).gameDefinition,
  });

  return `http://127.0.0.1:${port}/`;
}

/**
 * The world surface inside the dev chrome's iframe.
 *
 * Everything a player touches is in there: the outer page is the dev bar.
 */
export const surfaceOf = (page) => page.frameLocator('.world-dev__frame');

/** A checklist that reports as it goes and totals up at the end. */
export function checklist() {
  const results = [];
  return {
    async check(name, body) {
      let error = null;
      try {
        await body();
      } catch (thrown) {
        error = thrown instanceof Error ? thrown : new Error(String(thrown));
      }
      results.push({ name, error });
      console.log(error ? `  FAIL  ${name}\n        ${error.message}` : `  ok    ${name}`);
    },
    /** The process exit code: 0 only when every check passed. */
    report(what) {
      const failed = results.filter((result) => result.error);
      console.log(
        `\n${results.length - failed.length}/${results.length} checks passed through ${what}.`,
      );
      return failed.length === 0 ? 0 : 1;
    },
  };
}

/**
 * Poll `read` until `accept` likes what it returns, then hand that back.
 *
 * A single read is a race with a round trip: the surface renders the state it
 * has and rewrites it when the world answers, so what a check is asserting
 * about is the SECOND state. Polling is what makes the difference between the
 * two an assertion rather than a coin toss.
 *
 * It returns the last value it saw rather than throwing, so the caller's own
 * assertion is the one that reports -- with the value it actually found, which
 * is the sentence a reader needs.
 */
export async function waitUntil(read, accept, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let seen = await read();
  while (!accept(seen) && Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 100));
    seen = await read();
  }
  return seen;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Refuse to run in a checkout that cannot serve a fixture world at all.
 *
 * Separate from the Playwright refusal because it is a different mistake with a
 * different fix, and a script that failed halfway through Vite's own resolution
 * would report it as a broken world.
 */
/**
 * The whole life of one browser regression: find a Chromium, write the fixture,
 * drive it, and remove the fixture whatever happened.
 *
 * The fixture is removed in a `finally` from the moment it exists, because a
 * temp world left behind by a crashed run is exactly the litter these scripts
 * must not leave.
 */
export async function runBrowserRegression({ script, writeFixture, drive }) {
  const chromium = await loadChromium(script);
  const fixture = writeFixture();
  try {
    return await drive({ chromium, fixture });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

export function requireInstalledCheckout() {
  if (existsSync(join(REPO, 'node_modules', 'vue'))) return;
  console.error(
    'This checkout has no node_modules/vue, so the fixture world cannot be served.\n'
      + '  Run `npm install` in the repository root first.',
  );
  process.exit(1);
}
