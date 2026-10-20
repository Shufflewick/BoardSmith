/**
 * #955: `boardsmith verify` runs mutation trials side by side when boardsmith.json sets a
 * "mutation" budget. Each test records what a trial saw (`tests/trial.ts`): how many trials were
 * live at once, which mutant input it read, and which Vitest worker slot ran it. Nothing is timed.
 */
import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { runDiffMutationCheck } from './test-step-mutation.js';
import { designProjectFixtures } from './design-project.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import type { MutationBudget } from '../lib/mutation-budget.js';
import type { KillerHint } from '../lib/mutant-cache.js';

vi.setConfig({ testTimeout: 180_000 });

const RULES = `export function bid(high: number, offer: number): boolean {
  return offer > high;
}
export function fee(price: number): number {
  return price * 2;
}
`;

/** The mutants of lines 2 and 5 no test catches, in the order they were made. */
const SURVIVORS = [
  { file: 'src/rules.ts', line: 5, description: 'return value replaced with undefined' },
  { file: 'src/rules.ts', line: 5, description: '* -> /' },
  { file: 'src/rules.ts', line: 5, description: '2 -> 3' },
];

/**
 * Each test file enters the trial on load: it marks itself live, waits until `trials` trials are live
 * (a trial being one runner's directory, which holds its mutant input) or an earlier file met that,
 * and records what it saw. The serial project writes trials: 1, so its barrier is met at once.
 */
const TRIAL = `import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
const root = new URL('../trials/', import.meta.url).pathname;
const { trials } = JSON.parse(readFileSync(root + 'barrier.json', 'utf8'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readLive = (name) => { try { return JSON.parse(readFileSync(root + 'active/' + name, 'utf8')); } catch { return undefined; } };
const trialOf = ({ mutantPath }) => mutantPath.slice(0, mutantPath.lastIndexOf('/'));
const put = (path, value) => { writeFileSync(path + '.partial', JSON.stringify(value)); renameSync(path + '.partial', path); };
export async function enterTrial() {
  const mutantPath = process.env.BOARDSMITH_MUTANT;
  if (!mutantPath) return;
  mkdirSync(root + 'active', { recursive: true });
  mkdirSync(root + 'seen', { recursive: true });
  const mutant = readFileSync(mutantPath, 'utf8');
  put(root + 'active/' + process.pid, { mutantPath, mutant });
  // Recorded on entry too, so a trial stopped while it waits still shows it started.
  put(root + 'seen/' + process.pid + '.json', { mutantPath, mutant, pool: process.env.VITEST_POOL_ID, live: [] });
  let live = [];
  // No poll limit: a scheduler that never runs trials together fails on the test timeout instead.
  for (;;) {
    live = readdirSync(root + 'active').filter((name) => !name.endsWith('.partial') && alive(Number(name))).map(readLive).filter(Boolean);
    if (new Set(live.map(trialOf)).size >= trials) { writeFileSync(root + 'met', ''); break; }
    if (existsSync(root + 'met')) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  put(root + 'seen/' + process.pid + '.json', { mutantPath, mutant, pool: process.env.VITEST_POOL_ID, live });
}
export const leaveTrial = () => rmSync(root + 'active/' + process.pid, { force: true });
`;

const testFile = (name: string, body: string) => `import { it, expect, afterAll } from 'vitest';
import { enterTrial, leaveTrial } from './trial';
import { ${name} } from '../src/rules';
await enterTrial();
afterAll(leaveTrial);
${body}
`;

/** How many trials a test file saw live at once. */
const trialsLive = (t: Seen) => new Set(t.live.map((l) => dirname(l.mutantPath))).size;

interface Seen { mutantPath: string; mutant: string; pool: string; live: Array<{ mutantPath: string; mutant: string }> }

async function project(trials: number, poolSettings = '') {
  const sandbox = fixtureSandbox('bs-mutant-budget-');
  const dir = await designProjectFixtures(() => sandbox.root).makeProject({
    'src/rules.ts': RULES,
    'vitest.config.ts': `export default { test: { include: ['tests/**/*.test.ts'], pool: 'forks', cache: false, testTimeout: 60000${poolSettings} } };\n`,
    'trials/barrier.json': JSON.stringify({ trials }),
    'tests/trial.ts': TRIAL,
    'tests/bid.test.ts': testFile('bid', "it('a higher offer wins', () => { expect(bid(3, 4)).toBe(true); });\nit('an equal offer loses', () => { expect(bid(3, 3)).toBe(false); });"),
    'tests/fee.test.ts': testFile('fee', "it('a fee exists', () => { expect(typeof fee).toBe('function'); });"),
  });
  await fs.symlink(INSTALLED_MODULES, join(dir, 'node_modules'), 'dir');
  for (const key of ['HOME', 'TMPDIR', 'PATH'] as const) vi.stubEnv(key, sandbox.env[key]!);
  vi.stubEnv('NODE_OPTIONS', sandbox.env.NODE_OPTIONS + ' --allow-child-process --allow-worker --allow-addons');
  return dir;
}

async function seen(dir: string): Promise<Seen[]> {
  const names = await fs.readdir(join(dir, 'trials/seen'));
  return Promise.all(names.filter((n) => n.endsWith('.json')).map(async (n) => JSON.parse(await fs.readFile(join(dir, 'trials/seen', n), 'utf8'))));
}

/** Holds no outcomes, so every mutant runs, and keeps killer hints (#954) by mutated text in `hints`. */
const memoryCache = (hints = new Map<string, KillerHint>()) => ({
  fingerprint: () => undefined, get: () => undefined, set: () => {}, save: async () => {},
  killerHint: (m: { source: string }) => hints.get(m.source),
  setKillerHint: (m: { source: string }, hint: KillerHint) => { hints.set(m.source, hint); },
});

function check(dir: string, budget: MutationBudget | undefined, contextChange?: () => Promise<string | undefined>, hints?: Map<string, KillerHint>) {
  return runDiffMutationCheck({
    projectDir: dir, added: new Map([['src/rules.ts', new Set([2, 5])]]), cache: memoryCache(hints), log: () => {},
    ...(budget ? { budget } : {}), ...(contextChange ? { contextChange } : {}),
  });
}

describe('runDiffMutationCheck with a mutation budget (#955)', () => {
  it('runs as many trials at once as the budget allows, each on its own mutant input and its share of the workers', async () => {
    try {
      const dir = await project(2);
      const result = await check(dir, { trials: 2, workers: 2 });
      expect(result.summary).toEqual({ files: 1, mutants: 5, killed: 2, survived: 3, timedOut: 0, equivalent: 0, unreached: 0 });
      // Outcomes fold in the order the mutants were made, whichever trial finished first.
      expect(result.survivors).toEqual(SURVIVORS);

      const trials = await seen(dir);
      expect(Math.max(...trials.map(trialsLive))).toBe(2);
      for (const { live } of trials.filter((t) => trialsLive(t) === 2)) expect(new Set(live.map((l) => l.mutant)).size).toBe(2);
      expect(new Set(trials.map((t) => dirname(t.mutantPath))).size).toBe(2);
      // Two workers shared by two trials: each trial's Vitest runs one worker.
      expect(new Set(trials.map((t) => t.pool))).toEqual(new Set(['1']));
      expect(await fs.readdir(join(dir, '.boardsmith'))).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps a killer hint for each killed mutant, whichever trial ran it, and a rerun killed by its hints keeps to the budget', async () => {
    try {
      const dir = await project(2);
      const hints = new Map<string, KillerHint>();
      await check(dir, { trials: 2, workers: 2 }, undefined, hints);
      // Both killed mutants are on line 2, and only bid.test.ts tests bid.
      expect([...hints.values()].map((h) => h.file)).toEqual(['tests/bid.test.ts', 'tests/bid.test.ts']);

      const rerun = await check(dir, { trials: 2, workers: 2 }, undefined, hints);
      expect(rerun.summary).toEqual({ files: 1, mutants: 5, killed: 2, survived: 3, timedOut: 0, equivalent: 0, unreached: 0 });
      expect(new Set((await seen(dir)).map((t) => t.pool))).toEqual(new Set(['1']));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('runs one trial at a time with no budget', async () => {
    try {
      const dir = await project(1);
      const result = await check(dir, undefined);
      expect(result.survivors).toEqual(SURVIVORS);
      expect(Math.max(...(await seen(dir)).map(trialsLive))).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts no trial after one fails, and stops and removes every trial it started', async () => {
    try {
      const dir = await project(2);
      let calls = 0;
      // Calls 1 and 2 start the two trials; call 3 is the first finished trial's check after its run.
      const changed = async () => (++calls === 3 ? 'the linked package moved' : undefined);
      await expect(check(dir, { trials: 2, workers: 2 }, changed)).rejects.toThrow(/what the tests run with changed .*: the linked package moved/);
      expect(new Set((await seen(dir)).map((t) => t.mutant)).size).toBe(2);
      expect(await fs.readdir(join(dir, '.boardsmith'))).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  for (const [settings, named] of [
    [", poolOptions: { forks: { maxForks: 4 } }", 'poolOptions.forks.maxForks'],
    [", poolMatchGlobs: [['tests/fee.test.ts', 'threads']]", 'poolMatchGlobs'],
  ] as const) {
    it(`refuses a Vitest config whose ${named} would run more workers than the budget`, async () => {
      try {
        const dir = await project(2, settings);
        await expect(check(dir, { trials: 2, workers: 2 })).rejects.toThrow(new RegExp(`budget of 2 test workers.*sets ${named.replaceAll('.', '\\.')}`));
      } finally {
        vi.unstubAllEnvs();
      }
    });
  }
});
