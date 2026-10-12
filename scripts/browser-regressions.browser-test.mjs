/**
 * #533: EVERY BROWSER REGRESSION RUNS, IN A BROWSER, EVERY VERIFY.
 *
 * One case per `scripts/*-browser.mjs`, found by name, so a script added
 * tomorrow is run without anyone listing it. Each case runs the script as a
 * person would and passes when it exits 0; on failure the script's own report
 * (which checks failed, or why it could not start) is the message.
 *
 * This is `npm run test:browser` (`vitest.browser.config.ts`), not part of the
 * default suite: it needs Chromium, installed by `boardsmith install-browser`.
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserScripts } from './browser-harness.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

/** A hang guard for one script, not a budget: the slowest takes about a minute. */
const HANG_GUARD_MS = 600_000;

describe('the browser regressions', () => {
  it.each(browserScripts())('%s passes in Chromium', async (name) => {
    const child = spawn(process.execPath, [join(SCRIPTS, name)], { cwd: join(SCRIPTS, '..') });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const [code] = await once(child, 'exit');
    expect(code, `node scripts/${name} failed:\n${output}`).toBe(0);
  }, HANG_GUARD_MS);
});
