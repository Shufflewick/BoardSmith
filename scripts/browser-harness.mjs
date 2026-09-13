/**
 * THE PLUMBING EVERY BROWSER REGRESSION SHARES.
 *
 * BoardSmith depends on no browser, so its browser regressions are deliberate
 * runs rather than part of `npx vitest run` (#227 settled that). What each of
 * them then has to do first is identical and none of it is the behaviour under
 * test: find a Playwright somebody already installed, take a port nobody is on,
 * write a throwaway world project that resolves this checkout the way a real
 * game does, serve it through the CLI's own dev host, and report checks in a
 * form a human can read at the end.
 *
 * That was ~200 duplicated lines across two scripts by the time #230 added the
 * second one, which is a real cost and not a cosmetic one: the pick-bridge
 * script's `playwrightCandidates` ordering carries a reason (Node will not
 * import a folder) that the copy in the second script had already lost. One
 * definition, so the reason cannot be dropped again.
 *
 * It also owns the whole RUN rather than just the pieces of it (#231), because
 * the order those pieces go in is the part a script got wrong every time it
 * was copied: each one removed its fixture and then exited under a world host
 * nothing had stopped. `runBrowserRegression` is the one entry point, and the
 * fixture, the host and the browser are not reachable without it.
 *
 * What is NOT here is any assertion. Each script owns its own fixture, its own
 * questions, and its own reason for existing.
 *
 * @module
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * This checkout, which is the library every fixture resolves against.
 *
 * Module-private, like `freePort`: the three things that need it -- the
 * symlinked install, the dev host's own TypeScript, and the guard that refuses
 * an uninstalled checkout -- are all in here.
 */
const REPO = resolve(HERE, '..');

// ── Playwright, or an actionable refusal ─────────────────────────────────────

/**
 * Every way of naming one Playwright, since what a person has to hand is a
 * DIRECTORY as often as an entry file -- `.../node_modules/playwright` is what
 * the #227 reporter's own harness was pointed at, and Node will not import a
 * folder. The entry files come first for that reason.
 */
function playwrightCandidates(named) {
  if (!named) return ['playwright', 'playwright-core'];
  return [join(named, 'index.mjs'), join(named, 'index.js'), named];
}

/** ESM and CJS interop both, since a Playwright arrives either way. */
const chromiumIn = (module) => module.chromium ?? module.default?.chromium;

/** Why one candidate yielded nothing, in a sentence a person can act on. */
const reason = (thrown) => (thrown instanceof Error ? thrown.message : String(thrown));

/**
 * One candidate's chromium, or `null` with the reason recorded.
 *
 * "Loaded but exports no chromium" is raised rather than pushed, so that both
 * ways of failing leave by the same door and the reason is written once.
 */
async function chromiumFrom(specifier, failures) {
  try {
    const chromium = chromiumIn(await import(specifier));
    if (!chromium) throw new Error('loaded, but exports no chromium');
    return chromium;
  } catch (thrown) {
    failures.push(`${specifier}: ${reason(thrown)}`);
    return null;
  }
}

/**
 * A real Chromium, or an exit that says how to give this run one.
 *
 * It never skips. A browser regression that quietly passes when it did not run
 * is the thing these scripts exist to replace.
 *
 * @param script the script's own filename, for the copy-pasteable command line
 */
async function loadChromium(script) {
  const failures = [];
  for (const candidate of playwrightCandidates(process.env.BOARDSMITH_PLAYWRIGHT_MODULE)) {
    const chromium = await chromiumFrom(candidate, failures);
    if (chromium) return chromium;
  }
  console.error(
    'No Playwright chromium is reachable, so this cannot be checked in a browser at all.\n' +
      '  Point this run at one you already have:\n\n' +
      '    BOARDSMITH_PLAYWRIGHT_MODULE=/abs/path/to/node_modules/playwright \\\n' +
      `      node scripts/${script}\n\n` +
      '  Tried:\n' + failures.map((line) => `    ${line}`).join('\n') + '\n\n' +
      '  BoardSmith deliberately does not depend on a browser; any Playwright already\n' +
      '  installed will do, and there is no need to add one here.',
  );
  process.exit(1);
}

// ── A port nobody else is on ─────────────────────────────────────────────────

/** Module-private: the only thing that needs a port is `startWorldHost`. */
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

// ── The fixture project ──────────────────────────────────────────────────────

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
 * MODULE-PRIVATE, and `startWorldHost` with it: a fixture and the host serving
 * it are one lifetime, so `withFixtureWorld` is the only way to have either
 * (#231).
 *
 * @param spec.slug        the project and game-type name
 * @param spec.displayName what the dev host calls it
 * @param spec.gameClass   the game class the UI registry keys on
 * @param spec.rules       the whole of `src/rules/index.ts`
 * @param spec.boardFile   the board component's basename, e.g. `FleetBoard`
 * @param spec.board       the whole of that component
 * @returns the project directory
 */
function writeWorldFixture(spec) {
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
  // author's own project takes. Its build-time packages come from here too.
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
 * Serve a fixture through the CLI's own world dev host, on a free port.
 *
 * `tsx` first, exactly as `bin/boardsmith.js` does it: everything reached from
 * here is the CLI's own TypeScript, run from source with no build step.
 *
 * @returns the host, whose `stop()` is the only thing that ends it
 */
async function startWorldHost({ fixture, displayName }) {
  const port = await freePort();
  await import('tsx');
  const { startWorldDevServer } = await import(join(REPO, 'src/cli/commands/dev-world.ts'));
  const { loadGameDefinition } = await import(join(REPO, 'src/cli/commands/game-runtime.ts'));

  const tempDir = join(fixture, '.boardsmith');
  mkdirSync(tempDir, { recursive: true });
  const rulesPath = join(fixture, 'src', 'rules');
  const { gameDefinition } = await loadGameDefinition(rulesPath, tempDir, 'standalone');

  const host = await startWorldDevServer({
    cwd: fixture,
    uiPath: fixture,
    gameDefinition,
    displayName,
    context: 'standalone',
    port,
    host: '127.0.0.1',
    tempDir,
    openBrowser: false,
    reloadRules: async () => (await loadGameDefinition(rulesPath, tempDir, 'standalone')).gameDefinition,
  });

  // The host reports the URL Vite resolved, which is `localhost`; a check has
  // to reach the interface the port was actually taken on.
  return { hostUrl: `http://127.0.0.1:${port}/`, stop: host.stop };
}

/**
 * A FIXTURE WORLD, SERVED, AND GONE AFTERWARDS -- IN THAT ORDER (#231).
 *
 * This is the only way a regression gets either half, because getting the
 * ORDER wrong is the mistake, and it is not a mistake a script should be able
 * to make on its own. Both halves used to be a script's business: it wrote the
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
 * @param spec the fixture project, as `writeWorldFixture` takes it
 * @param body called with `{ hostUrl, fixture }`; its return value is passed on
 */
async function withFixtureWorld(spec, body) {
  const fixture = writeWorldFixture(spec);
  try {
    const { hostUrl, stop } = await startWorldHost({ fixture, displayName: spec.displayName });
    try {
      return await body({ hostUrl, fixture });
    } finally {
      await stop();
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

/**
 * The world surface inside the dev chrome's iframe.
 *
 * Everything a player touches is in there: the outer page is the dev bar.
 */
export const surfaceOf = (page) => page.frameLocator('.world-dev__frame');

/**
 * READING ONE STORED FIELD OUT OF A PROJECTED VIEW -- source, for a fixture board.
 *
 * Every regression that submits something has to read back what the world
 * STORED rather than what the player typed, because the stored value is the only
 * place a resolver's own argument can be observed. The projection is a tree of
 * nodes carrying `attributes`, so reading one field is a walk, and the walk was
 * the same twelve lines in two fixture boards by the time #252 added the second
 * -- the finding `boardsmith audit --dupes-baseline` reported against it.
 *
 * A STRING and not a function, because a fixture board is compiled inside a
 * throwaway project that resolves only `boardsmith`, `vue` and Vite: it cannot
 * import from this directory. Interpolate it into the board's source, above the
 * component, and call `findAttr(props.gameView as Node | undefined, 'field')`.
 */
export const VIEW_FIELD_READER = `type Node = { attributes?: Record<string, unknown>; children?: Node[] };

/** The first node in the projected view that carries the field, or undefined. */
const findAttr = (node: Node | undefined, key: string): unknown => {
  if (!node) return undefined;
  const own = node.attributes?.[key];
  if (own !== undefined) return own;
  for (const child of node.children ?? []) {
    const found = findAttr(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
};`;

// ── The assertions ───────────────────────────────────────────────────────────

const results = [];

/** Run one named check, recording its outcome rather than throwing. */
export async function check(name, body) {
  try {
    await body();
    results.push({ name, error: null });
    console.log(`  ok    ${name}`);
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    results.push({ name, error });
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Poll `read` until `accept` likes what it returns, then hand that back.
 *
 * A single read is a race with a round trip. The surface renders the state it
 * has and rewrites it when the world answers, so what a check is asserting
 * about is usually the SECOND state -- and reading once makes the difference
 * between the two a coin toss rather than an assertion. #227's own crew count
 * and #229's stored description are both that shape.
 *
 * It returns the last value it saw rather than throwing, so the caller's
 * `assert` is what reports, naming the value actually found. That is the
 * sentence a reader needs, and it is why this does not take a message.
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

/**
 * Report what the run found and answer with the process's exit code.
 *
 * @param what how to finish the sentence "N/M checks passed …"
 */
export function summarise(what) {
  const failed = results.filter((result) => result.error);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed ${what}`);
  return failed.length === 0 ? 0 : 1;
}

// ── One whole run ────────────────────────────────────────────────────────────

/**
 * Refuse before doing anything expensive if this checkout cannot serve a world.
 *
 * The fixture resolves the library by symlink, so a checkout with nothing
 * installed cannot serve one. Said before Chromium is looked for, because it is
 * the cheaper answer and the likelier mistake.
 *
 * @param script the script's own filename, for the copy-pasteable command line
 */
function requireInstalledCheckout(script) {
  if (existsSync(join(REPO, 'node_modules', 'vue'))) return;
  console.error(
    'This checkout has no node_modules/vue, so the fixture world cannot be served.\n' +
      '  Run `npm install` in the repository root first, then:\n\n' +
      `    node scripts/${script}`,
  );
  process.exit(1);
}

/**
 * RUN ONE BROWSER REGRESSION, END TO END.
 *
 * A script's whole job is its checks. Everything around them is the same in
 * every script, in a fixed order, and every step of that order has a reason a
 * script should not have to remember: the library has to be installed, a
 * Chromium has to be found or the run refused, the fixture world has to be
 * written and served, the HOST has to be stopped before its project is removed
 * (#231), and the process may exit only after all of that.
 *
 * Each of those was a copied paragraph in each script, and each copy was a
 * chance to get the order wrong. There is one copy now, and the exit is the
 * last thing that happens rather than the thing that pre-empted the cleanup.
 *
 * It does not return: the code the body reports becomes the process's.
 *
 * @param run.script  the script's own filename, for the refusal's command line
 * @param run.fixture the world project, as `writeWorldFixture` takes it
 * @param body        called with `{ chromium, hostUrl }`; returns `summarise`
 */
export async function runBrowserRegression(run, body) {
  requireInstalledCheckout(run.script);
  const chromium = await loadChromium(run.script);
  process.exit(await withFixtureWorld(run.fixture, ({ hostUrl }) => body({ chromium, hostUrl })));
}
