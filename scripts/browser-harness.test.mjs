/**
 * #231: A BROWSER REGRESSION CANNOT REMOVE ITS FIXTURE UNDER A LIVE HOST.
 *
 * The defect was an ordering one. Each script wrote a throwaway world project,
 * served it through the CLI's dev host, removed the project in a `finally`, and
 * then called `process.exit()`. Nothing ever stopped the host, so the removal
 * raced the host's own writes: the world's lock could still be draining the
 * disconnect the closing browser had just fired, and Vite's dep optimiser could
 * still be writing into the project. A run therefore sometimes left the whole
 * fixture world behind, re-created underneath the `rmSync`.
 *
 * `process.exit()` is not a fix for that and neither is another `finally`: the
 * writes are already in flight, and an exit abandons them rather than waiting
 * for them. What was missing was an owner. `startWorldDevServer` now hands back
 * an awaitable `stop()`, and `runBrowserRegression` owns the whole run -- it
 * awaits that stop in an inner guard and removes the project in an outer one,
 * and neither the fixture, the host nor the exit is reachable without it.
 *
 * What is asserted here is that no script can opt out of that again, which is
 * the whole point of putting it in the shared module. There were three scripts
 * when this was written and the mistake had been copied into every one of them;
 * a fourth must not be able to reintroduce it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserScripts, recordWorldFrames, runBrowserRegression } from './browser-harness.mjs';
import { BROWSER_SUITE_CONFIG } from '../src/cli/commands/test.ts';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPTS, '..');

const read = (name) => readFileSync(join(SCRIPTS, name), 'utf8');

/**
 * The case names `boardsmith test --browser` would run, collected without
 * running them. Listed here at the top because collecting starts a vitest.
 */
const vitest = join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
const listed = spawnSync(process.execPath, [vitest, 'list', '--config', BROWSER_SUITE_CONFIG], {
  cwd: REPO,
  encoding: 'utf8',
});
const browserSuiteCases = `${listed.stdout}${listed.stderr}`;

describe('#231: the fixture world has one owner', () => {
  it('finds the browser regressions to check', () => {
    // A derived list, so a script added tomorrow is held to this too. If this
    // ever reads zero, the naming changed and every assertion below went quiet.
    expect(browserScripts().length).toBeGreaterThanOrEqual(3);
  });

  it.each(browserScripts())('%s runs through runBrowserRegression', (name) => {
    expect(
      read(name),
      `${name} must run through runBrowserRegression. That is the only place that ` +
        `stops the host before removing the project and exits only after both, ` +
        `which is the whole of the fix for #231.`,
    ).toContain('runBrowserRegression(');
  });

  it.each(browserScripts())('%s does not remove a directory itself', (name) => {
    // A script holding its own `rmSync` is a script that can remove the
    // project while the host is still writing to it, which is exactly what
    // happened. The harness owns the removal because it also owns the stop.
    expect(read(name), `${name} must not remove its own fixture; the harness does`).not.toMatch(
      /\brm(Sync|dir|)\s*\(/,
    );
  });

  it.each(browserScripts())('%s cannot start a host or write a fixture on its own', (name) => {
    // All three are module-private in the harness now. Naming any of them is
    // either a stale copy or a new export that reopened the hole.
    const source = read(name);
    expect(source, `${name} must not start its own world host`).not.toContain('startWorldHost');
    expect(source, `${name} must not write its own fixture`).not.toContain('writeWorldFixture');
    for (const lifetime of ['withFixtureWorld', 'withFixtureTable']) {
      expect(source, `${name} must not take the fixture lifetime apart`).not.toContain(lifetime);
    }
  });
});

describe('every browser regression launches the one Chromium build the harness picks', () => {
  it.each(browserScripts())('%s launches through the harness, not chromium.launch()', (name) => {
    // A bare `chromium.launch()` asks for Playwright's separate headless-shell
    // build, which a machine with a perfectly good full Chromium may not have:
    // the run then refused instead of checking anything. The harness owns the
    // choice, so it is made once.
    const source = read(name);
    expect(source, `${name} must launch with the harness's launch()`).toMatch(/await launch\((\{ classicScrollbars: true \})?\)/);
    expect(source, `${name} must not choose its own browser build`).not.toContain('chromium.launch(');
  });

  it('launches the full Chromium build, headless', () => {
    expect(read('browser-harness.mjs')).toContain("chromium.launch({ channel: 'chromium',");
  });
});

describe('#231: the fixture world stops the host before it removes the project', () => {
  // The lifetime lives in TypeScript so `boardsmith typecheck` compiles its
  // call to the world dev host (#357); the harness reaches it only through
  // `runBrowserRegression`.
  const harness = readFileSync(join(SCRIPTS, 'browser-harness.mjs'), 'utf8');
  const lifetime = readFileSync(
    join(REPO, 'src', 'cli', 'commands', 'fixture-world.test-helper.ts'),
    'utf8',
  );

  it('exports no piece of the lifetime on its own', () => {
    // Exporting `writeWorldFixture` or `startWorldHost` is what let three
    // scripts each own the order and each get it wrong.
    expect(lifetime).not.toMatch(/export (async )?function (writeWorldFixture|startWorldHost)\b/);
    expect(lifetime).toMatch(/export async function withFixtureWorld\b/);
    expect(harness).not.toMatch(/export (async )?function withFixtureWorld\b/);
    expect(harness).toMatch(/export async function runBrowserRegression\b/);
  });

  const table = readFileSync(join(REPO, 'src', 'cli', 'commands', 'fixture-table.test-helper.ts'), 'utf8');

  it('withFixtureTable awaits the stop inside the guard that removes the project', () => {
    const body = table.slice(table.indexOf('async function withFixtureTable'));
    const stop = body.indexOf('await started.finish(');
    const remove = body.indexOf('rmSync(parent');
    expect(stop, 'withFixtureTable must await the host stop').toBeGreaterThan(-1);
    expect(remove, 'withFixtureTable must remove the fixture').toBeGreaterThan(-1);
    expect(
      stop,
      'the stop must be awaited BEFORE the fixture is removed, or the removal races ' +
        'the host it never stopped (#231)',
    ).toBeLessThan(remove);
  });

  it('withFixtureWorld holds the project before the host, so its holdings close the host first', () => {
    // Holdings close last-held first (shutdown.ts), on a signal too (#922).
    const body = lifetime.slice(lifetime.indexOf('async function withFixtureWorld'));
    const remove = body.indexOf('rmSync(fixture');
    const host = body.indexOf('startWorldHost(fixture');
    expect(remove, 'withFixtureWorld must hold the fixture removal').toBeGreaterThan(-1);
    expect(host, 'withFixtureWorld must start the host').toBeGreaterThan(-1);
    expect(remove, 'the project must be held BEFORE the host, or it is removed under it (#231)').toBeLessThan(host);
    expect(body).toContain('await holdings.run()');
  });
});

describe('#358: a browser regression finds the packages where Node does', () => {
  it('gets past the install check in any checkout, a worktree included', () => {
    // A worktree has no `node_modules` of its own: Node resolves its packages
    // from the main checkout's install. The harness used to look for
    // `<checkout>/node_modules/vue` and refused every run in a worktree. With
    // Playwright pointed at an empty browser directory, a run that got past the
    // install check stops at the missing-Chromium refusal (#533), before any
    // fixture or browser exists.
    const run = spawnSync(process.execPath, [join(SCRIPTS, 'world-offers-latch-browser.mjs')], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(REPO, 'no-browsers-here') },
    });
    const output = `${run.stdout}${run.stderr}`;
    expect(run.status).toBe(1);
    expect(output).not.toContain('no node_modules/vue');
    expect(output).toContain('Run `boardsmith install-browser`');
    expect(output).not.toContain('does not depend on a browser');
  });
});

describe('#533: every browser regression runs automatically', () => {
  const policy = JSON.parse(readFileSync(join(REPO, '.agent-policy.json'), 'utf8'));

  it('runs the browser suite at merge when UI, dev host, world or browser script files change', () => {
    expect(policy.merge?.extraMergeSteps, 'merge.extraMergeSteps in .agent-policy.json').toBeDefined();
    const step = policy.merge.extraMergeSteps.find((s) => s.name === 'browser');
    expect(step).toMatchObject({ run: 'node bin/boardsmith.js test --browser' });
    const runsFor = (path) => new RegExp(step.whenChanged).test(path);
    for (const path of ['src/ui/components/GameShell.vue', 'src/cli/dev-host/bridge.ts', 'src/world/engine.ts', 'scripts/ordered-list-browser.mjs']) {
      expect(runsFor(path), path).toBe(true);
    }
    for (const path of ['src/bot/mcts-bot.ts', 'src/cli/commands/verify.ts', 'docs/browser-testing.md']) {
      expect(runsFor(path), path).toBe(false);
    }
  });

  it('runs the browser suite after typecheck and before the slow related tests', () => {
    const names = policy.verify.map((check) => check.name);
    const step = policy.merge.extraMergeSteps.find((s) => s.name === 'browser');
    expect(step, 'merge.extraMergeSteps has no step named browser').toBeDefined();
    const after = step.after;
    expect(names, 'the verify list needs typecheck and related-tests').toEqual(expect.arrayContaining(['typecheck', 'related-tests']));
    expect(names, `browser runs after "${after}", which is not a verify check`).toContain(after);
    expect(names.indexOf(after)).toBeGreaterThanOrEqual(names.indexOf('typecheck'));
    expect(names.indexOf(after)).toBeLessThan(names.indexOf('related-tests'));
  });

  it('lists the browser suite without an error', () => {
    expect(listed.status, browserSuiteCases).toBe(0);
  });

  it.each(browserScripts())('%s is a case of the browser suite', (name) => {
    expect(browserSuiteCases, `${name} has no case in \`boardsmith test --browser\``).toContain(name);
  });
});

describe('#231: the world dev host hands back an awaitable stop', () => {
  const source = readFileSync(join(REPO, 'src', 'cli', 'commands', 'dev-world.ts'), 'utf8');
  const at = (needle) => {
    const index = source.indexOf(needle);
    expect(index, `dev-world.ts no longer contains ${JSON.stringify(needle)}`).toBeGreaterThan(-1);
    return index;
  };

  it('returns the stop rather than only registering a signal handler', () => {
    // The old teardown existed only as the body handed to `onShutdown`, and
    // that body ends in `process.exit`. A caller with no signal to send had no
    // orderly stop available at all.
    expect(source).toContain('interface WorldDevServer');
    expect(source).toMatch(/return \{ hostUrl, stop: \(\) => options\.holdings\.run\(\) \}/);
  });

  it('closes the pages and Vite, then the world, and only then lets the process go', () => {
    // The order is the guarantee. What the host holds closes newest first
    // (#386), and the world is held when it opens, before the pages and Vite
    // are served in front of it. So a stop forgets the pages, closes Vite and
    // the HTTP server, after which nothing can reach the world, and then
    // `run.close()` (the world host's own close, through `openWorldRun`, #379)
    // drains the world lock and closes the store handle. Vite's watcher and
    // dep optimiser write into the same project, and both are stopped before
    // the stop resolves. Ending the process belongs to `onShutdown`, never to
    // this file, so a programmatic stop does not end the process and a
    // signalled one still does.
    expect(at('(opened) => [closesWorld(opened)]')).toBeLessThan(at('(opened) => [...pages, ...opened.resources]'));
    expect(source).not.toMatch(/process\.exit\(/);
  });
});

describe('#922: one recorder for the world socket\'s frames', () => {
  /** A page that opens one socket to `url` and returns it, to emit frames on. */
  function pageWithSocket(page, url) {
    const ws = Object.assign(new EventEmitter(), { url: () => url });
    page.emit('websocket', ws);
    return ws;
  }

  it('parses the frames each way and keeps one that is not a JSON object as text, rather than crashing', () => {
    const page = new EventEmitter();
    const frames = recordWorldFrames(page);
    const world = pageWithSocket(page, 'ws://127.0.0.1:5173/__boardsmith/world');
    const vite = pageWithSocket(page, 'ws://127.0.0.1:5173/?token=vite-hmr');
    world.emit('framesent', { payload: '{"type":"pick","requestId":1}' });
    world.emit('framesent', { payload: 'ping' });
    world.emit('framereceived', { payload: 'null' });
    world.emit('framereceived', { payload: '{"type":"world_pick_result","requestId":1}' });
    vite.emit('framesent', { payload: '{"type":"vite"}' });
    expect(frames.sent).toEqual([{ type: 'pick', requestId: 1 }, { unparsed: 'ping' }]);
    expect(frames.received).toEqual([{ unparsed: 'null' }, { type: 'world_pick_result', requestId: 1 }]);
  });

  it.each(browserScripts())('%s records socket frames through recordWorldFrames', (name) => {
    expect(read(name), `${name} listens for socket frames itself; use recordWorldFrames`).not.toMatch(
      /framesent|framereceived/,
    );
  });
});

describe('#1318: a table fixture is `true` or `{ files }`', () => {
  it.each([[{}], [{ file: {} }], [{ files: null }]])('refuses table: %j before it serves anything', async (table) => {
    await expect(runBrowserRegression({ script: 'x-browser.mjs', table }, () => 0)).rejects.toThrow(
      'x-browser.mjs: `table` is `true` or `{ files: { <path in the project>: <text> } }`',
    );
  });
});
