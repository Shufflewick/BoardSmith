/**
 * Vitest setup file for the reads guard (#1504, see `global-setup.mjs`).
 *
 * It wraps fs's file reads once per worker and logs each file inside the checkout that a test
 * file's own code (a `*.test.*` or `*.test-helper.*` file) reads, however the path was built,
 * with the test file it was read for. A test that is skipped reads nothing, so it is checked
 * only on a machine where it runs.
 */
import { expect, inject } from 'vitest';
import fs, { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const guard = inject('readsGuard');
const CURRENT = Symbol.for('boardsmith.readsGuard.current');
const TEST_CODE = /\.test(?:-helper)?\.[cm]?[jt]s$/;
/** The file of each stack frame that has one, as `at fn (/a/b.ts:1:2)` or `at /a/b.ts:1:2` gives it. */
const FRAME_FILE = /\(?(?:file:\/\/)?([^()\s]+?):\d+:\d+\)?$/;

if (guard !== undefined) {
  // This file runs again for each test file, but node:fs, and so the wrappers, last the worker's life.
  globalThis[CURRENT] = { test: expect.getState().testPath, seen: new Set() };
  if (!globalThis[Symbol.for('boardsmith.readsGuard.wrapped')]) {
    globalThis[Symbol.for('boardsmith.readsGuard.wrapped')] = true;
    for (const [owner, name] of [[fs, 'readFileSync'], [fs, 'readFile'], [fs, 'createReadStream'], [fs.promises, 'readFile']]) {
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
  const root = resolve(guard.root);
  const file = typeof path === 'string' ? resolve(path) : path instanceof URL && path.protocol === 'file:' ? fileURLToPath(path) : undefined;
  if (file === undefined || !file.startsWith(root + sep) || file.includes(`${sep}node_modules${sep}`)) return;
  // The first frame in the checkout's own code past this guard decides, so a read through `Array.map` or a spy counts.
  const reader = new Error().stack.split('\n').slice(3)
    .map((frame) => FRAME_FILE.exec(frame)?.[1])
    .find((frameFile) => frameFile?.startsWith(root) && !frameFile.includes('node_modules'));
  if (!reader || !TEST_CODE.test(reader)) return;
  const { test, seen } = globalThis[CURRENT];
  if (seen.has(file)) return;
  seen.add(file);
  // git lists paths with forward slashes on every platform.
  appendFileSync(guard.log, `${JSON.stringify({ test, file: relative(root, file).split(sep).join('/') })}\n`);
}
