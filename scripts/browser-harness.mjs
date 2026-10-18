/**
 * THE PLUMBING EVERY BROWSER REGRESSION SHARES.
 *
 * These browser regressions run as their own suite, `boardsmith test --browser`,
 * which `agent-policy verify` runs (#533) and the default `boardsmith test`
 * leaves out, so the ordinary suite needs no Chromium. What each of them has to
 * do first is identical and none of it is the behaviour under test: find
 * BoardSmith's own Chromium the way the smoke check does, serve a throwaway
 * world project through the CLI's own dev host (`withFixtureWorld`, in
 * `src/cli/commands/fixture-world.test-helper.ts`, where it is type-checked and
 * run by the ordinary suite, #357) or `boardsmith init`'s table sample through
 * `boardsmith dev` (`withFixtureTable`, #703), and report checks in a form a
 * human can read at the end.
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
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

/** This checkout, whose own TypeScript the fixture world is served by. */
const REPO = join(SCRIPTS, '..');

// ── Chromium, or an actionable refusal ─────────────────────────────────────

/**
 * BoardSmith's own Playwright Chromium, found exactly as `boardsmith verify`'s
 * smoke check finds it (`playwrightChromium` in `src/cli/commands/smoke.ts`),
 * or an exit that says to run `boardsmith install-browser`.
 *
 * It never skips. A browser regression that quietly passes when it did not run
 * is the thing these scripts exist to replace. Reached only after
 * `loadFixtures`, which has loaded `tsx`.
 */
async function loadChromium() {
  const { playwrightChromium, browserProblem } = await import(join(REPO, 'src/cli/commands/smoke.ts'));
  const browser = await playwrightChromium();
  const problem = browserProblem(browser);
  if (problem) {
    console.error(`${problem.summary}\n  ${problem.next}`);
    process.exit(1);
  }
  return browser.chromium;
}

/** Every browser regression in `scripts/`, found by name rather than listed. */
export const browserScripts = () =>
  readdirSync(SCRIPTS)
    .filter((name) => name.endsWith('-browser.mjs'))
    .sort();

/**
 * The world surface inside the dev chrome's iframe.
 *
 * Everything a player touches is in there: the outer page is the dev bar.
 */
export const surfaceOf = (page) => page.frameLocator('.world-dev__frame');

/**
 * Every frame that crosses `page`'s world socket, each way, in order, parsed.
 * A frame that is not a JSON object is kept as `{ unparsed: <text> }`, so a run
 * can read it instead of crashing on it. The arrays fill as the page runs.
 */
export function recordWorldFrames(page) {
  const sent = [];
  const received = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/__boardsmith/world')) return;
    ws.on('framesent', ({ payload }) => sent.push(readFrame(String(payload))));
    ws.on('framereceived', ({ payload }) => received.push(readFrame(String(payload))));
  });
  return { sent, received };
}

function readFrame(text) {
  try {
    const frame = JSON.parse(text);
    if (frame !== null && typeof frame === 'object') return frame;
  } catch {
    // Not JSON: kept as text below.
  }
  return { unparsed: text };
}

/** Wait for the panel to be offering the action `name` to a seated player. */
export async function waitForAction(page, name) {
  await surfaceOf(page).locator(`[data-bs-action="${name}"]`).waitFor({ timeout: 30_000 });
}

/** The table sample's game frame on `page`, once its Action Panel offers a choice. */
export async function openTableSample(page, hostUrl) {
  await page.goto(hostUrl);
  await page.locator('.dev-host__frame').waitFor({ timeout: 60_000 });
  const frame = page.frameLocator('.dev-host__frame');
  await frame.locator('[data-testid="bs-actionbar"] .choice-btn').first().waitFor({ timeout: 60_000 });
  return frame;
}

/**
 * Play the table sample's first offered choice until the game-over card shows;
 * true once it does. The draw needs no choice, so it runs itself; clicks go
 * through the DOM because driving is not under test.
 */
export function playTableSampleToTheEnd(frame) {
  return frame.locator('body').evaluate(async (body) => {
    const doc = body.ownerDocument;
    for (let step = 0; step < 2000; step++) {
      if (doc.querySelector('.game-over-card')) return true;
      doc.querySelector('[data-testid="bs-actionbar"] .choice-btn')?.click();
      await new Promise((settle) => setTimeout(settle, 100));
    }
    return false;
  });
}

/**
 * Open the world in a fresh browser context and run `body` against it.
 *
 * The context is closed whatever `body` does, so a failed check never leaves a
 * page open for the next one to share.
 *
 * @param browser        a launched browser, from `launch()`
 * @param hostUrl        the dev host's URL
 * @param contextOptions passed to `browser.newContext` (viewport, colorScheme)
 * @param ready          awaited with the page once it has loaded, e.g. to wait for a seat
 * @param body           called with `(page, surface)`, `surface` being `surfaceOf(page)`
 */
export async function onFreshPage(browser, hostUrl, contextOptions, ready, body) {
  const context = await browser.newContext(contextOptions);
  try {
    const page = await context.newPage();
    await page.goto(hostUrl);
    await ready(page);
    await body(page, surfaceOf(page));
  } finally {
    await context.close();
  }
}

/**
 * WHERE THE ACTION BAR SITS AGAINST THE STRIP THE BOARD RESERVES (#444).
 *
 * The board is fitted above the board region's padding-bottom and the bar is
 * capped at it, so "the bar covers no board" is `top >= strip` and "everything
 * fits" is `!scrolls`. `outside` names each of `selectors` (looked up inside the
 * bar) that is missing or not wholly in view inside the bar and the viewport;
 * `clipped` names each one whose own text is cut off sideways (wider than its
 * box), which an ellipsis or `overflow: hidden` does to a prompt.
 * A measurement, not an assertion: each script says what it expects of it.
 *
 * @param surface   the world surface, from `surfaceOf(page)`
 * @param selectors controls that must be in view inside the bar
 */
export function barGeometry(surface, selectors = []) {
  return surface.locator('[data-testid="bs-actionbar"]').evaluate((bar, selectors) => {
    const region = document.querySelector('.boardregion');
    const strip = region.getBoundingClientRect().bottom - parseFloat(getComputedStyle(region).paddingBottom);
    const box = bar.getBoundingClientRect();
    const outside = selectors.filter((selector) => {
      const el = bar.querySelector(selector);
      if (!el) return true;
      const r = el.getBoundingClientRect();
      return r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.bottom > window.innerHeight + 1;
    });
    const clipped = selectors.filter((selector) => {
      const el = bar.querySelector(selector);
      return el !== null && el.scrollWidth > el.clientWidth + 1;
    });
    return {
      strip: Math.round(strip),
      top: Math.round(box.top),
      height: Math.round(box.height),
      scrolls: bar.scrollHeight > bar.clientHeight + 1,
      outside,
      clipped,
    };
  }, selectors);
}

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
 * The fixture lifetimes (a world, or `boardsmith init`'s table sample), or an
 * exit that says how to install what they need.
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
async function loadFixtures(script) {
  try {
    await import('tsx');
    const { withFixtureWorld } = await import(join(REPO, 'src/cli/commands/fixture-world.test-helper.ts'));
    const { withFixtureTable } = await import(join(REPO, 'src/cli/commands/fixture-table.test-helper.ts'));
    return { withFixtureWorld, withFixtureTable };
  } catch (thrown) {
    console.error(
      'BoardSmith\'s packages cannot be found from this checkout, so the fixture world cannot be served.\n' +
        `  ${thrown instanceof Error ? thrown.message : String(thrown)}\n\n` +
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
 * @param run.table   instead of `fixture`: `true` serves `boardsmith init`'s table
 *                    sample through `boardsmith dev` (`withFixtureTable`, #703)
 * @param body        called with `{ launch, hostUrl, fixture }`, `fixture` being the served
 *                    project's directory; returns `summarise`
 */
export async function runBrowserRegression(run, body) {
  const { withFixtureWorld, withFixtureTable } = await loadFixtures(run.script);
  const chromium = await loadChromium();
  const drive = ({ hostUrl, fixture }) => body({ launch: () => launchChromium(chromium), hostUrl, fixture });
  process.exit(await (run.table === true ? withFixtureTable(drive) : withFixtureWorld(run.fixture, drive)));
}

/**
 * Launch the FULL Chromium build, headless.
 *
 * A bare `chromium.launch()` asks for Playwright's separate headless-shell
 * build, which a machine with only the full build does not have: the
 * regressions then refused to run on a machine with a perfectly good Chromium.
 * The `chromium` channel is the full build, run in the same headless mode.
 *
 * Not every install provides that build: `playwright install chromium
 * --only-shell` installs the headless shell alone. Install it with
 * `boardsmith install-browser`, which installs exactly the full build this
 * BoardSmith's Playwright drives (`--no-shell`), the same browser
 * `boardsmith verify`'s smoke check uses.
 */
function launchChromium(chromium) {
  return chromium.launch({ channel: 'chromium' });
}
