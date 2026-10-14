/**
 * #533: EVERY BROWSER REGRESSION RUNS, IN A BROWSER, EVERY VERIFY.
 *
 * One case per `scripts/*-browser.mjs`, found by name, so a script added
 * tomorrow is run without anyone listing it. Each case runs the script as a
 * person would and passes when it exits 0; on failure the script's own report
 * (which checks failed, or why it could not start) is the message.
 *
 * This is `boardsmith test --browser` (`vitest.browser.config.ts`), not part of the
 * default suite: it needs Chromium, installed by `boardsmith install-browser`.
 */
import { describe, it, expect, onTestFinished } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserScripts } from './browser-harness.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

/** A hang guard for one script, not a budget: the slowest takes about a minute. */
const HANG_GUARD_MS = 600_000;

/** How long a hung script gets to stop what it started once asked, before it is killed. */
const STOP_GRACE_MS = 30_000;

describe('the browser regressions', () => {
  it.each(browserScripts())('%s passes in Chromium', async (name) => {
    const child = spawn(process.execPath, [join(SCRIPTS, name)], { cwd: join(SCRIPTS, '..') });
    // A script still running when the case ends hung past the guard. SIGTERM, by its own pid, lets
    // it stop what it started (a world host in-process, or a `boardsmith dev` child) and remove its
    // fixture; SIGKILL only if it has not gone after a grace, which would orphan that child.
    onTestFinished(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const killer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
      await exited;
      clearTimeout(killer);
    }, STOP_GRACE_MS + 5_000);
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const [code] = await once(child, 'exit');
    expect(code, `node scripts/${name} failed:\n${output}`).toBe(0);
  }, HANG_GUARD_MS);
});
