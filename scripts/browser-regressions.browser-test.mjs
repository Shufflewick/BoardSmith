/**
 * #533: EVERY BROWSER REGRESSION RUNS, IN A BROWSER, EVERY VERIFY.
 *
 * One case per `scripts/*-browser.mjs`, found by name, so a script added
 * tomorrow is run without anyone listing it. Each case runs the script as a
 * person would and passes when it exits 0; on failure the script's own report
 * (which checks failed, or why it could not start) is the message.
 *
 * This is `boardsmith test --browser` (`vitest.browser.config.ts`), not part of the
 * default suite: it needs Chromium, installed by `boardsmith install-browser`, and WebKit,
 * installed by `npx playwright install webkit` in this checkout.
 */
import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserScripts, runUntilHung } from './browser-harness.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

/** A hang guard for one script, not a budget: the slowest takes about two minutes. */
const HANG_GUARD_MS = 600_000;

/** How long a hung script gets to stop what it started once asked, before it is killed. */
const STOP_GRACE_MS = 30_000;

describe('the browser regressions', () => {
  it.each(browserScripts())('%s passes in the browsers it names', async (name) => {
    // The guard is the script's, not the case's: a case vitest times out loses what the script printed (#1645).
    const run = await runUntilHung([join(SCRIPTS, name)], { hangGuardMs: HANG_GUARD_MS, stopGraceMs: STOP_GRACE_MS });
    expect(run.hung, `node scripts/${name} was still running after ${HANG_GUARD_MS / 60_000} minutes, so it was stopped. What it printed:\n${run.output}`).toBe(false);
    expect(run.code, `node scripts/${name} failed:\n${run.output}`).toBe(0);
  }, HANG_GUARD_MS + STOP_GRACE_MS + 10_000);
});
