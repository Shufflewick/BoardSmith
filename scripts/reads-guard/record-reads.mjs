/**
 * Vitest setup file for the reads guard (#1504, see `global-setup.mjs`).
 *
 * It wraps `readFileSync` and `fs.promises.readFile` once per worker and logs each file inside
 * the checkout that a test file's own code (a `*.test.*` or `*.test-helper.*` file) reads,
 * however the path was built, with the test file it was read for.
 */
import { expect, inject } from 'vitest';
import fs, { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = inject('readsGuard');
const CURRENT = Symbol.for('boardsmith.readsGuard.current');
const TEST_CODE = /\.test(?:-helper)?\.[cm]?[jt]s:\d+:\d+\)?$/;

if (guard !== undefined) {
  // This file runs again for each test file, but node:fs, and so the wrappers, last the worker's life.
  globalThis[CURRENT] = { test: expect.getState().testPath, seen: new Set() };
  if (!globalThis[Symbol.for('boardsmith.readsGuard.wrapped')]) {
    globalThis[Symbol.for('boardsmith.readsGuard.wrapped')] = true;
    for (const [owner, name] of [[fs, 'readFileSync'], [fs.promises, 'readFile']]) {
      const original = owner[name];
      owner[name] = function (path, ...rest) {
        record(path);
        return original.call(this, path, ...rest);
      };
    }
    syncBuiltinESMExports();
  }
}

function record(path) {
  const file = typeof path === 'string' ? resolve(path) : path instanceof URL && path.protocol === 'file:' ? fileURLToPath(path) : undefined;
  if (file === undefined || !file.startsWith(guard.root + sep) || file.includes(`${sep}node_modules${sep}`)) return;
  // [0] is the message, [1] this function, [2] the wrapper, [3] the code that read the file.
  if (!TEST_CODE.test(new Error().stack.split('\n')[3] ?? '')) return;
  const { test, seen } = globalThis[CURRENT];
  if (seen.has(file)) return;
  seen.add(file);
  appendFileSync(guard.log, `${JSON.stringify({ test, file: relative(guard.root, file) })}\n`);
}
