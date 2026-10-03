/**
 * THE PLUMBING EVERY BROWSER REGRESSION SHARES.
 *
 * These browser regressions are deliberate runs rather than part of
 * `npx vitest run` (#227 settled that); the suite's one browser run is
 * `boardsmith verify`'s smoke check (#453). What each of
 * them then has to do first is identical and none of it is the behaviour under
 * test: find a Playwright somebody already installed, serve a throwaway world
 * project through the CLI's own dev host (`withFixtureWorld`, in
 * `src/cli/commands/fixture-world.test-helper.ts`, where it is type-checked and
 * run by the ordinary suite, #357), and report checks in a form a human can
 * read at the end.
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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This checkout, whose own TypeScript the fixture world is served by. */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
 * The fixture world's lifetime, or an exit that says how to install what it
 * needs.
 *
 * `withFixtureWorld` lives in `src/cli/commands/fixture-world.test-helper.ts`,
 * TypeScript, so `boardsmith typecheck` compiles its call to the world dev host
 * and the ordinary suite starts one (#357). It links the fixture's build-time
 * packages from wherever Node finds this checkout's install: a worktree under
 * `.worktrees/<name>` has none of its own and resolves the main checkout's
 * (#358). So a checkout with nothing installed fails here, which is said
 * before Chromium is looked for because it is the cheaper answer and the
 * likelier mistake.
 *
 * `tsx` first, exactly as `bin/boardsmith.js` does it: everything reached from
 * here is the library's own TypeScript, run from source with no build step.
 *
 * @param script the script's own filename, for the copy-pasteable command line
 */
async function loadFixtureWorld(script) {
  try {
    await import('tsx');
    return (await import(join(REPO, 'src/cli/commands/fixture-world.test-helper.ts')))
      .withFixtureWorld;
  } catch (thrown) {
    console.error(
      'BoardSmith\'s packages cannot be found from this checkout, so the fixture world cannot be served.\n' +
        `  ${reason(thrown)}\n\n` +
        '  Run `npm install` in the BoardSmith checkout (for a worktree, in the main\n' +
        '  checkout it was made from), then:\n\n' +
        `    node scripts/${script}`,
    );
    process.exit(1);
  }
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
 * @param run.fixture the world project, as `withFixtureWorld` takes it
 * @param body        called with `{ launch, hostUrl }`; returns `summarise`
 */
export async function runBrowserRegression(run, body) {
  const withFixtureWorld = await loadFixtureWorld(run.script);
  const chromium = await loadChromium(run.script);
  process.exit(
    await withFixtureWorld(run.fixture, ({ hostUrl }) => body({ launch: () => launchChromium(chromium), hostUrl })),
  );
}

/**
 * Launch the FULL Chromium build, headless.
 *
 * A bare `chromium.launch()` asks for Playwright's separate headless-shell
 * build, which `npx playwright install chromium --only-shell` and some partial
 * installs have but a plain `npx playwright install chromium` on a machine that
 * has updated Playwright since may not: the regressions then refused to run on
 * a machine with a perfectly good Chromium. The `chromium` channel is the full
 * build every `playwright install chromium` provides, run in the same headless
 * mode, so one choice works on a developer's machine and in CI alike.
 */
function launchChromium(chromium) {
  return chromium.launch({ channel: 'chromium' });
}
