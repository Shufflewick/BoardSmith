/**
 * Vitest `globalSetup` for the untracked-file guard (#579, see `guard.mjs`).
 *
 * Before the run it records the checkout's untracked, unignored files, so a
 * developer's own work in progress is never blamed on a test. Each test file
 * then reports, through `after-each-file.mjs`, any new ones present when it
 * finished. After the run, anything new that was seen at any point fails the
 * run with a message naming each file.
 *
 * Watch mode is left alone: files a developer creates while it runs are theirs.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newStrays, strayMessage, untrackedUnignored } from './guard.mjs';

function checkoutRoot(dir) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(
      `The untracked-file guard (scripts/untracked-guard) needs ${dir} to be inside a git checkout, ` +
        `and git could not find one: ${String(error.stderr || error.message).trim()}`,
    );
  }
}

export function setup({ config, provide }) {
  if (config.watch) return undefined;

  const root = checkoutRoot(config.root);
  const baseline = untrackedUnignored(root);
  const logDir = mkdtempSync(join(tmpdir(), 'bs-untracked-guard-'));
  const log = join(logDir, 'seen.jsonl');
  writeFileSync(log, '');
  provide('untrackedGuard', { root, baseline, log });

  return () => {
    // First sighting wins: it names the test file that finished soonest after the file appeared.
    const seen = new Map();
    for (const line of readFileSync(log, 'utf8').split('\n')) {
      if (line === '') continue;
      const { path, file } = JSON.parse(line);
      if (!seen.has(path)) seen.set(path, file);
    }
    for (const path of newStrays(root, baseline)) if (!seen.has(path)) seen.set(path, undefined);
    rmSync(logDir, { recursive: true, force: true });

    if (seen.size > 0) {
      throw new Error(strayMessage([...seen].map(([path, file]) => ({ path, file })), root));
    }
  };
}
