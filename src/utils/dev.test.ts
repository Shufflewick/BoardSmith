/**
 * Direct unit tests for src/utils/dev.ts.
 *
 * Covers CR-04: `isDevThrowEnabled()` must require a POSITIVE dev/test signal
 * before enabling the animation composables' fail-loud throws — an
 * unlabeled/unknown environment must fall through to `false` (never throw),
 * unlike `isDevMode()` (unchanged, used only by non-fatal `devWarn`), which
 * defaults to "dev" unless positively labeled `'production'`.
 *
 * These tests exercise `_resolveDevThrowEnabled()`, the pure decision-logic
 * helper `isDevThrowEnabled()` wraps around live environment access.
 * `import.meta.env`'s mutability/evaluation-timing varies across bundlers
 * and test runners (confirmed: mutating it from a *different* module than
 * dev.ts does not affect dev.ts's own `import.meta.env` reference under
 * vitest/vite-node) — testing the pure function directly is deterministic
 * and avoids fighting that.
 */
import { describe, it, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isDevMode, isDevThrowEnabled, _resolveDevThrowEnabled } from './dev.js';

// dev.ts as a rules bundle carries it: an esbuild ESM bundle, where `import.meta.env` is unset
// and the mode comes from NODE_ENV, as in a `boardsmith simulate` worker.
const devBundle = (await build({
  entryPoints: [fileURLToPath(new URL('./dev.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
})).outputFiles[0].text;

/** Loads the bundle in a worker whose env is `env`, calls isDevMode() 1000 times, and counts NODE_ENV reads. */
function devModeInWorker(env: NodeJS.ProcessEnv): Promise<{ answers: boolean[]; nodeEnvReads: number }> {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const real = process.env;
    let nodeEnvReads = 0;
    process.env = new Proxy(real, { get: (t, k) => { if (k === 'NODE_ENV') nodeEnvReads++; return t[k]; } });
    import('data:text/javascript;base64,' + workerData.bundle).then(({ isDevMode }) => {
      const answers = Array.from({ length: 1000 }, () => isDevMode());
      parentPort.postMessage({ answers, nodeEnvReads });
    });
  `;
  const worker = new Worker(source, { eval: true, env, workerData: { bundle: Buffer.from(devBundle).toString('base64') } });
  return new Promise((resolve, reject) => {
    worker.once('message', (result) => { void worker.terminate(); resolve(result); });
    worker.once('error', reject);
  });
}

describe('_resolveDevThrowEnabled (pure decision logic)', () => {
  it('labeled-dev (Vite DEV: true) returns true', () => {
    expect(_resolveDevThrowEnabled({ viteEnv: { DEV: true, MODE: 'development' } })).toBe(true);
  });

  it('labeled-test (Vite MODE: "test") returns true', () => {
    expect(_resolveDevThrowEnabled({ viteEnv: { DEV: false, MODE: 'test' } })).toBe(true);
  });

  it('labeled-prod (Vite MODE: "production", DEV: false) returns false', () => {
    expect(_resolveDevThrowEnabled({ viteEnv: { DEV: false, MODE: 'production' } })).toBe(false);
  });

  it('unlabeled/custom Vite mode (e.g. "staging") returns false — must not crash a live game', () => {
    expect(_resolveDevThrowEnabled({ viteEnv: { DEV: false, MODE: 'staging' } })).toBe(false);
  });

  it('Vite env with MODE unset entirely returns false (common real-world misconfiguration)', () => {
    expect(_resolveDevThrowEnabled({ viteEnv: { DEV: false } })).toBe(false);
  });

  it('Node NODE_ENV="development" returns true', () => {
    expect(_resolveDevThrowEnabled({ nodeEnv: 'development' })).toBe(true);
  });

  it('Node NODE_ENV="test" returns true', () => {
    expect(_resolveDevThrowEnabled({ nodeEnv: 'test' })).toBe(true);
  });

  it('Node NODE_ENV="production" (labeled-prod) returns false', () => {
    expect(_resolveDevThrowEnabled({ nodeEnv: 'production' })).toBe(false);
  });

  it('Node NODE_ENV unset entirely (unlabeled) returns false — must not crash a live game', () => {
    expect(_resolveDevThrowEnabled({ nodeEnv: undefined })).toBe(false);
  });

  it('Node NODE_ENV set to an unrecognized custom value returns false', () => {
    expect(_resolveDevThrowEnabled({ nodeEnv: 'staging' })).toBe(false);
  });
});

describe('isDevThrowEnabled (live integration sanity check)', () => {
  it('is a boolean and does not throw when called with the real environment', () => {
    expect(typeof isDevThrowEnabled()).toBe('boolean');
  });
});

describe('isDevMode() semantics are unchanged (CR-04 must not touch existing devWarn consumers)', () => {
  it('is a boolean and does not throw when called with the real environment', () => {
    expect(typeof isDevMode()).toBe('boolean');
  });
});

describe('isDevMode() in a Node worker (#688)', () => {
  const { NODE_ENV: _unset, ...withoutNodeEnv } = process.env;

  it.each([
    ['production', false],
    ['development', true],
    ['test', true],
  ])('answers from NODE_ENV=%s, reading it once however often it is asked', async (mode, dev) => {
    const { answers, nodeEnvReads } = await devModeInWorker({ ...withoutNodeEnv, NODE_ENV: mode });
    expect(new Set(answers)).toEqual(new Set([dev]));
    expect(nodeEnvReads).toBe(1);
  });

  it('is development mode when NODE_ENV is unset', async () => {
    const { answers, nodeEnvReads } = await devModeInWorker(withoutNodeEnv);
    expect(new Set(answers)).toEqual(new Set([true]));
    expect(nodeEnvReads).toBe(1);
  });
});
