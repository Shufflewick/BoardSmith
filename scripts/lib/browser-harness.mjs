/**
 * THE PLUMBING EVERY BROWSER REGRESSION IN THIS REPOSITORY SHARES.
 *
 * BoardSmith's suite is hermetic and depends on no browser, so a defect that
 * only a real browser can see gets a script of its own, run deliberately
 * (`scripts/world-pick-bridge-browser.mjs` for #227, `scripts/action-menu-browser.mjs`
 * for #228). What differs between them is the world they drive and what they
 * assert. What does NOT differ is everything in this file: finding a Chromium,
 * finding a port, writing a throwaway game project that resolves this checkout
 * the way a real game does, starting the real world dev server, and reporting
 * pass or fail.
 *
 * It exists because the second such script duplicated the first almost
 * exactly, which is debt with no upside: two copies of "how do I find a
 * Playwright" drift, and the one that drifts is the one nobody ran this week.
 *
 * NOTHING HERE SKIPS. A browser regression that quietly passes when it did not
 * run is worse than no regression at all, so a missing Chromium exits non-zero
 * with the command that would fix it.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** This checkout, which is what a fixture project is pointed at. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── Playwright, or an actionable refusal ─────────────────────────────────────

/**
 * Every way of naming one Playwright, since what a person has to hand is a
 * DIRECTORY as often as an entry file -- `.../node_modules/playwright` is what
 * #227's reporter pointed their own harness at, and Node will not import a
 * folder.
 */
function playwrightCandidates(named) {
  if (!named) return ['playwright', 'playwright-core'];
  if (!statSync(named, { throwIfNoEntry: false })?.isDirectory()) return [named];
  return [join(named, 'index.mjs'), join(named, 'index.js'), named];
}

/** One candidate's chromium, or `null` with the reason recorded. */
async function chromiumFrom(specifier, failures) {
  try {
    const module = await import(specifier);
    const chromium = module.chromium ?? module.default?.chromium;
    if (chromium) return chromium;
    failures.push(`${specifier}: loaded, but exports no chromium`);
  } catch (error) {
    failures.push(`${specifier}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}

/**
 * A Chromium, or an exit that says how to give it one.
 *
 * @param scriptPath - How to spell this script on the command line, so the
 *   refusal names the command the reader actually wants to run.
 */
export async function loadChromium(scriptPath) {
  const failures = [];
  for (const candidate of playwrightCandidates(process.env.BOARDSMITH_PLAYWRIGHT_MODULE)) {
    const chromium = await chromiumFrom(candidate, failures);
    if (chromium) return chromium;
  }
  console.error(
    'No Playwright Chromium is reachable, so this browser regression cannot run.\n'
      + '  BoardSmith depends on no browser, so point it at one you already have:\n\n'
      + `    BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \\\n`
      + `      node ${scriptPath}\n\n`
      + `  Tried:\n${failures.map((line) => `    ${line}`).join('\n')}`,
  );
  process.exit(1);
}

/** A port nobody is on, since two of these may run at once. */
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
 * Refuse before doing anything expensive if this checkout cannot serve a world.
 *
 * @param scriptPath - How to spell this script, for the same reason as above.
 */
export function requireInstalledCheckout(scriptPath) {
  if (existsSync(join(REPO, 'node_modules', 'vue'))) return;
  console.error(
    'This checkout has no node_modules/vue, so a fixture world cannot be served.\n'
      + '  Run `npm install` in the repository root first, then:\n\n'
      + `    node ${scriptPath}`,
  );
  process.exit(1);
}

// ── The throwaway game project ───────────────────────────────────────────────

/**
 * Write a fixture game project into a fresh temp directory.
 *
 * IT IS NOT CHECKED IN, on purpose: a game project inside the library would be
 * a second thing to keep compiling, and these are disposable by design -- the
 * point is a world nobody has played, born at genesis, exercised once.
 *
 * INSTALLED THE WAY A REAL GAME IS. `node_modules/boardsmith` is a symlink to
 * this checkout, which is exactly what `"boardsmith": "file:../../BoardSmith"`
 * leaves behind in `~/BoardSmithGames/*` -- so the fixture runs in STANDALONE
 * context and resolves the library through its package exports, the path an
 * author's own project takes. Its build-time packages come from here too.
 *
 * @param options.slug - The project's name, and the temp directory's prefix
 * @param options.displayName - What the dev chrome calls it
 * @param options.files - Relative path to contents, written verbatim
 * @returns The project's absolute, real path
 */
export function writeFixtureProject({ slug, displayName, files }) {
  // `realpathSync`: on macOS the temp root is a symlink (`/var` -> `/private/var`),
  // and Vite resolves a module id to its real path -- so a root given in the
  // symlinked form puts every one of the project's own files outside it.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `bs-${slug}-`)));
  for (const [at, contents] of Object.entries(files)) {
    const full = join(dir, at);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  writeFileSync(
    join(dir, 'vite.config.ts'),
    "import { defineConfig } from 'vite';\n"
      + "import vue from '@vitejs/plugin-vue';\n\n"
      + 'export default defineConfig({\n'
      + '  plugins: [vue()],\n'
      + "  resolve: { dedupe: ['vue'] },\n"
      + '});\n',
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: slug, private: true, type: 'module' }, null, 2),
  );
  writeFileSync(
    join(dir, 'boardsmith.json'),
    JSON.stringify({ name: slug, backend: 'world', displayName }, null, 2),
  );
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  symlinkSync(REPO, join(dir, 'node_modules', 'boardsmith'), 'dir');
  for (const name of ['vue', 'vite', '@vitejs/plugin-vue']) {
    const at = join(dir, 'node_modules', name);
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(join(REPO, 'node_modules', name), at, 'dir');
  }
  return dir;
}

/**
 * Start the real world dev server over a fixture project, and answer its url.
 *
 * tsx first, exactly as `bin/boardsmith.js` does it: everything reached below
 * is the CLI's own TypeScript, run from source with no build step. That is the
 * point of these scripts -- the chrome, the frame and the host under test are
 * the ones a developer runs, not a stand-in.
 */
export async function startFixtureWorld({ fixture, displayName }) {
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

// ── Reporting ───────────────────────────────────────────────────────────────

/**
 * A running list of named checks, printed as they resolve.
 *
 * Deliberately not a test framework: these scripts drive one long session in
 * one browser, and each check reads state the previous one left behind. A
 * runner that reordered or isolated them would be describing a different
 * program from the one under test.
 */
export function createChecklist(what) {
  const results = [];

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  const check = async (name, body) => {
    let error = null;
    try {
      await body();
    } catch (raised) {
      error = raised instanceof Error ? raised : new Error(String(raised));
    }
    results.push({ name, error });
    console.log(error ? `  FAIL  ${name}\n        ${error.message}` : `  ok    ${name}`);
  };

  /** Exit code: 0 only if every check passed. */
  const summarize = () => {
    const failed = results.filter((result) => result.error);
    console.log(
      `\n${results.length - failed.length}/${results.length} checks passed through ${what}.`,
    );
    return failed.length === 0 ? 0 : 1;
  };

  return { assert, check, summarize };
}
