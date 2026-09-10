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
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPTS, '..');

/** Every browser regression, found rather than listed. */
const browserScripts = () =>
  readdirSync(SCRIPTS)
    .filter((name) => name.endsWith('-browser.mjs'))
    .sort();

const read = (name) => readFileSync(join(SCRIPTS, name), 'utf8');

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
    expect(source, `${name} must not take the fixture lifetime apart`).not.toContain(
      'withFixtureWorld',
    );
  });
});

describe('#231: the harness stops the host before it removes the project', () => {
  const harness = readFileSync(join(SCRIPTS, 'browser-harness.mjs'), 'utf8');

  it('exports no piece of the lifetime on its own', () => {
    // Exporting `writeWorldFixture`, `startWorldHost` or `withFixtureWorld` is
    // what let three scripts each own the order and each get it wrong.
    expect(harness).not.toMatch(
      /export (async )?function (writeWorldFixture|startWorldHost|withFixtureWorld)\b/,
    );
    expect(harness).toMatch(/export async function runBrowserRegression\b/);
  });

  it('awaits the stop inside the guard that removes the project', () => {
    const body = harness.slice(harness.indexOf('async function withFixtureWorld'));
    const stop = body.indexOf('await stop()');
    const remove = body.indexOf('rmSync(fixture');
    expect(stop, 'withFixtureWorld must await the host stop').toBeGreaterThan(-1);
    expect(remove, 'withFixtureWorld must remove the fixture').toBeGreaterThan(-1);
    expect(
      stop,
      'the stop must be awaited BEFORE the fixture is removed, or the removal races ' +
        'the host it never stopped (#231)',
    ).toBeLessThan(remove);
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
    expect(source).toMatch(/return \{ hostUrl, stop \}/);
  });

  it('closes the world, then Vite, and only then lets the process go', () => {
    // The order is the guarantee. `worldHost.close()` drains the world lock and
    // closes the store handle, so no world write can follow it; Vite is closed
    // after it because Vite's watcher and dep optimiser write into the same
    // project. `process.exit` is outside the teardown, so a programmatic stop
    // does not end the process and a signalled one still does.
    expect(at('await worldHost.close()')).toBeLessThan(at('await vite.close()'));
    expect(at('await stop();')).toBeLessThan(at('process.exit(0)'));
  });
});
