/**
 * #955, #1496: `boardsmith mutate` runs its mutants side by side, as many at once as boardsmith.json's
 * "mutation" budget allows, or all of them with none. Each test records what a trial saw (`tests/trial.ts`): how many trials were
 * live at once, which mutant input it read, and which Vitest worker slot ran it. Nothing is timed.
 */
import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { limitWorkers, runDiffMutationCheck, writeRunConfig } from './test-step-mutation.js';
import { designProjectFixtures } from './design-project.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { fixtureSandbox } from '../../testing/fixture-sandbox.test-helper.js';
import type { MutationBudget } from '../lib/mutation-budget.js';

vi.setConfig({ testTimeout: 180_000 });

const RULES = `export function bid(high: number, offer: number): boolean {
  return offer > high;
}
export function fee(price: number): number {
  return price * 2;
}
`;

/** The sampled mutants of lines 2 and 5 no test catches, in the order they were made. */
const SURVIVORS = [
  { file: 'src/rules.ts', line: 5, description: 'return value replaced with undefined' },
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

async function project(trials: number, poolSettings = '', tests: Record<string, string> = {}) {
  const sandbox = fixtureSandbox('bs-mutant-budget-');
  const dir = await designProjectFixtures(() => sandbox.root).makeProject({
    'src/rules.ts': RULES,
    'vitest.config.ts': `export default { test: { include: ['tests/**/*.test.ts'], pool: 'forks', cache: false, testTimeout: 60000${poolSettings} } };\n`,
    'trials/barrier.json': JSON.stringify({ trials }),
    'tests/trial.ts': TRIAL,
    'tests/bid.test.ts': testFile('bid', "it('a higher offer wins', () => { expect(bid(3, 4)).toBe(true); });\nit('an equal offer loses', () => { expect(bid(3, 3)).toBe(false); });"),
    'tests/fee.test.ts': testFile('fee', "it('a fee exists', () => { expect(typeof fee).toBe('function'); });"),
    ...tests,
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

function check(dir: string, budget: MutationBudget | undefined, log: (line: string) => void = () => {}) {
  return runDiffMutationCheck({
    seed: 'fixture',
    projectDir: dir, added: new Map([['src/rules.ts', new Set([2, 5])]]), log,
    ...(budget ? { budget } : {}),
  });
}

/** Under a mutant, after the barrier: the first trial's test file kills its own Vitest, so its run leaves no report; any other trial's waits to be stopped. */
const STOPS = `import { it } from 'vitest';
import { enterTrial } from './trial';
import '../src/rules';
await enterTrial();
const mutantPath = process.env.BOARDSMITH_MUTANT;
if (mutantPath && !mutantPath.includes('/trial-')) process.kill(-process.ppid, 'SIGKILL');
if (mutantPath) await new Promise(() => {});
it('holds', () => {});
`;

describe('runDiffMutationCheck runs its mutants side by side (#955, #1496)', () => {
  it('runs as many trials at once as the budget allows, each on its own mutant input and its share of the workers', async () => {
    try {
      const dir = await project(2);
      const result = await check(dir, { trials: 2, workers: 2 });
      expect(result.summary).toEqual({ files: 1, mutants: 3, killed: 1, survived: 2, timedOut: 0, unreached: 0 });
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

  it('runs every sampled mutant at once with no budget (#1496)', async () => {
    try {
      const dir = await project(3);
      const logged: string[] = [];
      const result = await check(dir, undefined, (line) => logged.push(line));
      expect(result.survivors).toEqual(SURVIVORS);
      expect(Math.max(...(await seen(dir)).map(trialsLive))).toBe(3);
      expect(logged).toContain('Running 3 mutants at a time.');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts no mutant after one fails, and stops and removes every one it started', async () => {
    try {
      const dir = await project(2, '', { 'tests/bid.test.ts': STOPS, 'tests/fee.test.ts': STOPS });
      await expect(check(dir, { trials: 2, workers: 2 })).rejects.toThrow('vitest exited without writing its report');
      expect(new Set((await seen(dir)).map((t) => t.mutant)).size).toBe(2);
      expect(await fs.readdir(join(dir, '.boardsmith'))).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the first failure when stopping the other trials fails too, and waits for every trial before removing them', async () => {
    try {
      const dir = await project(2, '', { 'tests/bid.test.ts': STOPS, 'tests/fee.test.ts': STOPS });
      const kill = process.kill.bind(process);
      // The probe of a stopped trial's process group fails as no real system would.
      vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        if (pid < 0 && signal === 0) throw Object.assign(new Error('process group observation failed'), { code: 'EINVAL' });
        return kill(pid, signal);
      });
      const logged: string[] = [];
      await expect(check(dir, { trials: 2, workers: 2 }, (line) => logged.push(line))).rejects.toThrow('vitest exited without writing its report');
      expect(logged.some((line) => line.startsWith('Could not confirm that Vitest process group'))).toBe(true);
      expect(await fs.readdir(join(dir, '.boardsmith'))).toEqual([]);
    } finally {
      vi.restoreAllMocks();
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

describe('the budget a Vitest 4 run is held to (#1310)', () => {
  it('passes Vitest 4 no --minWorkers, which it removed, and Vitest 3 a minimum of one', () => {
    expect(limitWorkers(2, 4, {})).toEqual(['--maxWorkers=2']);
    expect(limitWorkers(2, 3, {})).toEqual(['--maxWorkers=2', '--minWorkers=1']);
  });

  /** What the generated reporter says, on starting, of a run whose root and projects resolved to `configs`. */
  async function refusal(vitestMajor: number, root: object, projects: object[]): Promise<string | undefined> {
    try {
      const dir = await project(2);
      const workDir = join(dir, '.boardsmith', 'run');
      await fs.mkdir(workDir, { recursive: true });
      const configPath = await writeRunConfig(dir, workDir, vitestMajor);
      vi.stubEnv('BOARDSMITH_WORKERS', '2');
      // Dynamic import: the config this test just generated.
      const { default: config } = await import(configPath);
      const [reporter] = (await config({ command: 'serve', mode: 'test' })).test.reporters;
      const plugins = [{ name: 'boardsmith-mutant' }];
      const ctx = { config: root, projects: projects.map((config) => ({ config, vite: { config: { plugins } } })) };
      try {
        reporter.onInit(ctx);
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it("refuses a Vitest 4 project whose own maxWorkers is over the budget, since Vitest 4 runs that project's files with it", async () => {
    const message = await refusal(4, { maxWorkers: 2 }, [{ pool: 'forks', maxWorkers: 2 }, { pool: 'forks', maxWorkers: 4 }]);
    expect(message).toMatch(/budget of 2 test workers.*VITEST_MAX_WORKERS\) sets maxWorkers, which Vitest uses/);
  });

  it('runs a Vitest 4 project whose maxWorkers is within the budget', async () => {
    expect(await refusal(4, { maxWorkers: 2 }, [{ pool: 'forks', maxWorkers: 1 }, { pool: 'forks' }])).toBeUndefined();
  });

  it('names only the custom pool as custom, beside a built-in one', async () => {
    const message = await refusal(3, { maxWorkers: 2 }, [{ pool: 'forks' }, { pool: './my-pool.ts' }]);
    expect(message).toContain('sets a different pool per project (forks, ./my-pool.ts), the custom pool ./my-pool.ts, which');
  });
});
