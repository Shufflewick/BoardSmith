/**
 * The in-browser smoke check (#453): `boardsmith verify`'s `smoke` check, `boardsmith smoke`, and
 * `boardsmith install-browser`.
 *
 * Unit tests mount a board with whatever context the test hands it, so a board can pass every one
 * and still throw the moment it renders in the real shell. This check opens the game the way a
 * player does. It:
 *
 *   1. copies the project's files (every file git tracks or would track) to a fresh directory under
 *      `.boardsmith/smoke/`, so the run starts from genesis and nothing it writes (a world's store,
 *      Vite's cache, the dev build) touches the designer's own `boardsmith dev` state;
 *   2. bundles `tests/browser/smoke.spec.ts` with `boardsmith/testing/browser`, BoardSmith's walk,
 *      so the game needs no Playwright of its own and runs BoardSmith's copy;
 *   3. starts `boardsmith dev` in the copy on a free port and waits for it to be ready;
 *   4. runs the spec in Chromium with Playwright, and reads its verdict from Playwright's report;
 *   5. stops every process it started, and removes the copy, whether the run passed, failed or
 *      threw, and when this process is interrupted.
 *
 * THE BROWSER. Playwright runs a Chromium build of its own version, downloaded once per machine.
 * It is never downloaded during a check: a missing one fails the check, and says to run
 * `boardsmith install-browser`, which installs exactly the build this BoardSmith's Playwright
 * expects. The check is never skipped for want of it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { build } from 'esbuild';
import { boardsmithPackageRoot } from '../lib/boardsmith-version.js';
import { collectOutput } from '../lib/child-output.js';
import { freePort } from '../lib/free-port.js';
import { gitOutput as git } from '../lib/git-output.js';
import type { VerifyCheckResult } from '../lib/verify-result.js';
import { SMOKE_ANNOTATION, SMOKE_SEEDS_ENV, SMOKE_SPEC_PATH, smokeSummary, type SmokeRecord } from '../../testing/browser-smoke-verdict.js';

/** A check's outcome, as `boardsmith verify` records it. */
type SmokeOutcome = Omit<VerifyCheckResult, 'name'>;

/** Where each run's copy of the project lives, inside the project's own `.boardsmith/`. */
const SMOKE_DIR = join('.boardsmith', 'smoke');

/** How long `boardsmith dev` gets to print that it is ready. A hang guard, not a budget. */
const DEV_READY_MS = 180_000;

/** How long a process asked to stop gets before it is killed. */
const STOP_GRACE_MS = 15_000;

/** The longest the walk may run under Playwright before Playwright ends it. A hang guard. */
const WALK_LIMIT_MS = 600_000;

/** How many free ports to try when another process takes the one found before dev binds it. */
const PORT_ATTEMPTS = 3;

/** The command that installs the browser, as every message names it. */
const INSTALL_BROWSER = '`boardsmith install-browser`';

// -------------------------------------------------------------------------------------------
// BoardSmith's own Playwright
// -------------------------------------------------------------------------------------------

/** The directory of the `@playwright/test` this BoardSmith depends on. */
function playwrightTestDir(): string {
  const require = createRequire(join(boardsmithPackageRoot(), 'package.json'));
  return dirname(require.resolve('@playwright/test/package.json'));
}

/** The Playwright version, and where it looks for the Chromium it drives. */
async function playwrightChromium(): Promise<{ version: string; executable: string }> {
  const dir = playwrightTestDir();
  const { version } = JSON.parse(await fs.readFile(join(dir, 'package.json'), 'utf-8')) as { version: string };
  // Dynamic import: Playwright is loaded only by a command that drives a browser.
  const { chromium } = (await import(pathToFileURL(join(dir, 'index.mjs')).href)) as typeof import('@playwright/test');
  return { version, executable: chromium.executablePath() };
}

/**
 * Why the smoke check cannot run a browser, or undefined when it can: the Chromium this
 * Playwright drives is not installed at `executable`.
 */
export function browserProblem(browser: { version: string; executable: string }): SmokeOutcome | undefined {
  if (existsSync(browser.executable)) return undefined;
  return {
    passed: false,
    summary:
      `The browser the smoke test runs in is not installed: Playwright ${browser.version} looks for Chromium at ` +
      `${browser.executable}, and nothing is there.`,
    next: `Run ${INSTALL_BROWSER} (a one-time download of about 150 MB), then run \`boardsmith verify\` again.`,
  };
}

/** `boardsmith install-browser`: installs the Chromium this BoardSmith's Playwright drives. */
export async function installBrowserCommand(): Promise<void> {
  const cli = join(playwrightTestDir(), 'cli.js');
  const child = spawn(process.execPath, [cli, 'install', 'chromium', '--no-shell'], { stdio: 'inherit' });
  const [code] = (await once(child, 'exit')) as [number | null];
  if (code !== 0) {
    throw new Error(
      `Playwright could not install Chromium (exit code ${code}). Its output above says why; ` +
        `fix that (usually the network), then run ${INSTALL_BROWSER} again.`,
    );
  }
  console.log(chalk.green('Chromium is installed. `boardsmith verify` can run the smoke test now.'));
}

// -------------------------------------------------------------------------------------------
// The processes a run starts, and stopping them
// -------------------------------------------------------------------------------------------

/**
 * Every process a run starts, so each is stopped however the run ends. While the run is live,
 * SIGINT or SIGTERM to this process stops them at once, and is raised again once the run has
 * cleaned up (`finish`), so an interrupted `boardsmith verify` leaves nothing running.
 */
class Started {
  readonly children: ChildProcess[] = [];
  private interruptedBy: NodeJS.Signals | undefined;
  private readonly onSignal = (signal: NodeJS.Signals) => {
    this.interruptedBy ??= signal;
    void this.stopAll();
  };

  constructor() {
    process.on('SIGINT', this.onSignal);
    process.on('SIGTERM', this.onSignal);
  }

  /**
   * Starts `args` under this Node, with `env` added to this process's environment (a name given
   * undefined is kept from the child), keeping its output. Refuses once the run was interrupted.
   */
  spawn(args: string[], cwd: string, env: Record<string, string | undefined> = {}): { child: ChildProcess; output: () => string } {
    if (this.interruptedBy !== undefined) throw new Error(`The smoke check was interrupted (${this.interruptedBy}).`);
    const environment: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0' };
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete environment[name];
      else environment[name] = value;
    }
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: environment });
    this.children.push(child);
    return { child, output: collectOutput(child) };
  }

  /** The ids of every process started, for a caller that checks they are gone. */
  get pids(): number[] {
    return this.children.map((child) => child.pid).filter((pid): pid is number => pid !== undefined);
  }

  /** Stops every process still running: asked first, killed if it has not gone after a grace. */
  async stopAll(): Promise<void> {
    await Promise.all(this.children.map(stop));
  }

  /** Stops everything, runs `cleanUp`, then lets the signals go, raising again one that came. */
  async finish(cleanUp: () => Promise<void>): Promise<void> {
    await this.stopAll();
    await cleanUp();
    process.off('SIGINT', this.onSignal);
    process.off('SIGTERM', this.onSignal);
    if (this.interruptedBy !== undefined) process.kill(process.pid, this.interruptedBy);
  }
}

const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

async function stop(child: ChildProcess): Promise<void> {
  if (!running(child)) return;
  const exited = once(child, 'exit');
  // SIGINT is the signal both `boardsmith dev` and Playwright stop in order on.
  child.kill('SIGINT');
  const killer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
  await exited;
  clearTimeout(killer);
}

// -------------------------------------------------------------------------------------------
// The copy the run serves
// -------------------------------------------------------------------------------------------

/** A fresh, empty directory for one run's copy, under `.boardsmith/smoke/`. */
async function freshCopyDir(projectDir: string): Promise<string> {
  const parent = join(projectDir, SMOKE_DIR);
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(join(parent, 'run-'));
}

/**
 * Copies every file git tracks or would track in `projectDir` (not what `.gitignore` leaves out)
 * into `copy`. Modules still resolve from the project's own `node_modules`, which is above it.
 */
async function copyProject(projectDir: string, copy: string): Promise<void> {
  const listed = await git(projectDir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).catch(() => {
    throw new Error(
      `The smoke check copies the files git tracks, and ${projectDir} is not a git repository. ` +
        'Run `git init`, commit the game, then run it again.',
    );
  });
  for (const path of new Set(listed.split('\0').filter(Boolean))) {
    const from = join(projectDir, path);
    const stat = await fs.lstat(from).catch(() => undefined);
    if (stat === undefined) continue; // tracked, but deleted in the working tree
    const to = join(copy, path);
    await fs.mkdir(dirname(to), { recursive: true });
    if (stat.isSymbolicLink()) await fs.symlink(await fs.readlink(from), to);
    else await fs.copyFile(from, to, fs.constants.COPYFILE_FICLONE);
  }
}

/** Removes a run's copy, and the smoke directory once no run is left in it. */
async function removeCopy(projectDir: string, copy: string): Promise<void> {
  await fs.rm(copy, { recursive: true, force: true });
  await fs.rmdir(join(projectDir, SMOKE_DIR)).catch(() => undefined);
}

// -------------------------------------------------------------------------------------------
// The run
// -------------------------------------------------------------------------------------------

/**
 * Bundles the spec with BoardSmith's walk, which it imports, into `<work>/smoke.spec.mjs`. The
 * walk's `@playwright/test` is left an import of BoardSmith's own copy, the one the runner loads.
 */
async function bundleSpec(copy: string, work: string): Promise<string | SmokeOutcome> {
  const entry = pathToFileURL(join(playwrightTestDir(), 'index.mjs')).href;
  try {
    await build({
      entryPoints: [join(copy, SMOKE_SPEC_PATH)],
      outfile: join(work, 'smoke.spec.mjs'),
      absWorkingDir: copy,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
      plugins: [
        {
          name: 'boardsmith-playwright',
          setup(bundle) {
            bundle.onResolve({ filter: /^@playwright\/test$/ }, () => ({ path: entry, external: true }));
          },
        },
      ],
    });
    return join(work, 'smoke.spec.mjs');
  } catch (error) {
    return {
      passed: false,
      summary: `${SMOKE_SPEC_PATH} could not be bundled: ${(error as Error).message.split('\n').slice(0, 4).join(' ')}`,
      next: `Fix it (\`boardsmith typecheck\` shows type errors), then run the check again.`,
    };
  }
}

/** The last lines of a process's output, for a message saying why it stopped. */
const tail = (output: string, lines = 12) => output.trim().split('\n').slice(-lines).join('\n');

/**
 * Starts `boardsmith dev` in the copy and resolves with its URL once it says it is ready, or with
 * a failed outcome carrying its last output when it stops or hangs first.
 */
async function startDev(started: Started, copy: string): Promise<string | SmokeOutcome> {
  const bin = join(boardsmithPackageRoot(), 'bin', 'boardsmith.js');
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const dev = started.spawn([bin, 'dev', '--port', String(port), '--no-open', '--bot-level', 'easy'], copy);
    const ready = await new Promise<boolean>((resolve) => {
      const guard = setTimeout(() => resolve(false), DEV_READY_MS);
      const check = () => {
        if (dev.output().includes('Ready!')) {
          clearTimeout(guard);
          resolve(true);
        }
      };
      dev.child.stdout?.on('data', check);
      dev.child.on('exit', () => {
        clearTimeout(guard);
        resolve(false);
      });
    });
    if (ready) return `http://127.0.0.1:${port}`;
    if (/already in use/.test(dev.output()) && attempt < PORT_ATTEMPTS) continue;
    const why = running(dev.child) ? `did not say it was ready within ${DEV_READY_MS / 1000}s` : 'stopped before it was ready';
    return {
      passed: false,
      summary: `\`boardsmith dev\` ${why}. Its last output: ${tail(dev.output()).replace(/\s*\n\s*/g, ' ')}`,
      next: 'Run `boardsmith dev` to see it fail, fix what it names, then run the check again.',
    };
  }
}

/**
 * The longest any one action or read of an element may wait under Playwright (#464). The walk
 * bounds its own waits more tightly; this is the floor under any it does not, so nothing waits
 * out the whole run.
 */
const ACTION_LIMIT_MS = 15_000;

/**
 * The longest `boardsmith dev` may take to start answering a page load. The walk loads each page only
 * that far (`waitUntil: 'commit'`) and waits for the game to show on the page's clock (#609).
 */
const NAVIGATION_LIMIT_MS = 90_000;

/** The Playwright configuration for one run, as the module the runner loads. */
export function playwrightConfig(work: string, baseURL: string): string {
  const config = {
    testDir: work,
    testMatch: 'smoke.spec.mjs',
    outputDir: join(work, 'results'),
    timeout: WALK_LIMIT_MS,
    globalTimeout: WALK_LIMIT_MS,
    workers: 1,
    retries: 0,
    reporter: [['list'], ['json', { outputFile: join(work, 'report.json') }]],
    use: {
      baseURL,
      channel: 'chromium',
      headless: true,
      actionTimeout: ACTION_LIMIT_MS,
      navigationTimeout: NAVIGATION_LIMIT_MS,
      trace: 'off',
      screenshot: 'off',
      video: 'off',
    },
  };
  return `export default ${JSON.stringify(config, null, 2)};\n`;
}

/** The part of Playwright's JSON report the verdict is read from. */
interface PlaywrightReport {
  suites: PlaywrightSuite[];
  errors?: Array<{ message?: string }>;
}
interface PlaywrightSuite {
  suites?: PlaywrightSuite[];
  specs?: Array<{ tests: PlaywrightTest[] }>;
}
interface PlaywrightTest {
  annotations?: Array<{ type: string; description?: string }>;
  results: Array<{ status: string; errors?: Array<{ message?: string }> }>;
}

const plainText = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

/**
 * What a failed test said, without the source excerpt and stack Playwright appends to it: the
 * lines before the first `  41 | ...` excerpt line or `    at ...` frame, with no `Error: `.
 */
function whatItSaid(message: string): string {
  const lines = plainText(message).split('\n');
  const end = lines.findIndex((line) => /^\s*(>\s*)?\d+ \|/.test(line) || /^\s+at /.test(line));
  return (end === -1 ? lines : lines.slice(0, end)).join('\n').replace(/^Error: /, '').trim();
}

/** The first test's results and annotations, wherever Playwright nested them. */
function firstTest(suites: PlaywrightSuite[]): PlaywrightTest | undefined {
  for (const suite of suites) {
    const test: PlaywrightTest | undefined = suite.specs?.[0]?.tests[0] ?? firstTest(suite.suites ?? []);
    if (test) return test;
  }
  return undefined;
}

/** A passing test's outcome, from what the walk recorded on it: a spec that never walked fails. */
function passedTest(test: PlaywrightTest): SmokeOutcome {
  const recorded = test.annotations?.find((a) => a.type === SMOKE_ANNOTATION)?.description;
  if (recorded === undefined) {
    return {
      passed: false,
      summary: `${SMOKE_SPEC_PATH} passed without walking the game: it has no \`defineSmokeTest\` call, so nothing took an action.`,
      next: `Make it the one call \`defineSmokeTest({ actions: [...] })\` from 'boardsmith/testing/browser', then run the check again.`,
    };
  }
  const record = JSON.parse(recorded) as SmokeRecord;
  return { passed: true, summary: smokeSummary(record), counts: { actions: record.taken.length, controls: record.controls } };
}

/** A failed walk's outcome: what the test said, else how Playwright exited. */
function failedWalk(said: string[], code: number | null, output: string): SmokeOutcome {
  return {
    passed: false,
    summary: said.length > 0 ? said.join(' ').replace(/\s*\n\s*/g, ' ') : `Playwright exited with code ${code}: ${tail(plainText(output), 6)}`,
    next: 'Run `boardsmith smoke` to watch the walk and see every problem, fix what it names, then run `boardsmith verify` again.',
  };
}

/** Everything a run's errors said: its test's, then the run's own. */
function saidByTheRun(report: PlaywrightReport, test: PlaywrightTest | undefined): string[] {
  const errors = [...(test?.results[0]?.errors ?? []), ...(report.errors ?? [])];
  return errors.map((e) => whatItSaid(e.message ?? '')).filter(Boolean);
}

/** The outcome Playwright's report and exit code describe. */
function verdict(report: PlaywrightReport | undefined, code: number | null, output: string): SmokeOutcome {
  if (report === undefined) return failedWalk([], code, output);
  const test = firstTest(report.suites);
  if (test !== undefined && code === 0 && test.results[0]?.status === 'passed') return passedTest(test);
  return failedWalk(saidByTheRun(report, test), code, output);
}

/** Runs the bundled spec against `baseURL` and reads the verdict. */
async function runWalk(
  started: Started,
  copy: string,
  work: string,
  baseURL: string,
  log: (line: string) => void,
  seeds: readonly string[] | undefined,
): Promise<SmokeOutcome> {
  const configPath = join(work, 'playwright.config.mjs');
  await fs.writeFile(configPath, playwrightConfig(work, baseURL));
  // The walk reads its seeds from this variable alone, so a run with none to hand it must not let it
  // inherit another run's: a check run inside a `boardsmith smoke --seed` deals from the spec's seeds.
  const env = { [SMOKE_SEEDS_ENV]: seeds === undefined ? undefined : JSON.stringify(seeds) };
  const walk = started.spawn([join(playwrightTestDir(), 'cli.js'), 'test', '--config', configPath], copy, env);
  walk.child.stdout?.on('data', (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).forEach(log));
  const [code] = (await once(walk.child, 'exit')) as [number | null];
  const report = await fs
    .readFile(join(work, 'report.json'), 'utf-8')
    .then((text) => JSON.parse(text) as PlaywrightReport)
    .catch(() => undefined);
  return verdict(report, code, walk.output());
}

/** Why the project has no smoke test to run, or undefined when it has one. */
function specMissing(projectDir: string): SmokeOutcome | undefined {
  if (existsSync(join(projectDir, SMOKE_SPEC_PATH))) return undefined;
  return {
    passed: false,
    summary: `This project has no ${SMOKE_SPEC_PATH}, so nothing opens the game in a browser.`,
    next:
      `Write it (a new \`boardsmith init\` project has one): \`import { defineSmokeTest } from 'boardsmith/testing/browser'; ` +
      `defineSmokeTest({ actions: [/* every action a player can take */] });\`, commit it, then run \`boardsmith verify\` again.`,
  };
}

/** What a finished run reports, and the processes it started (all stopped by then). */
interface SmokeRun {
  outcome: SmokeOutcome;
  pids: number[];
}

/**
 * Runs the game's smoke test against `boardsmith dev`, from a copy of the project's files, and
 * stops everything it started before it returns (see the file comment). With `seeds`, the walk deals
 * from them instead of the spec's (#460).
 */
export async function runSmoke(options: { projectDir: string; log: (line: string) => void; seeds?: readonly string[] }): Promise<SmokeRun> {
  const { projectDir, log } = options;
  const cannot = specMissing(projectDir) ?? browserProblem(await playwrightChromium());
  if (cannot) return { outcome: cannot, pids: [] };

  const copy = await freshCopyDir(projectDir);
  const started = new Started();
  try {
    await copyProject(projectDir, copy);
    const work = join(copy, '.smoke');
    await fs.mkdir(work, { recursive: true });
    const spec = await bundleSpec(copy, work);
    if (typeof spec !== 'string') return { outcome: spec, pids: started.pids };
    const baseURL = await startDev(started, copy);
    if (typeof baseURL !== 'string') return { outcome: baseURL, pids: started.pids };
    log(`boardsmith dev is serving a fresh copy of the game at ${baseURL}`);
    return { outcome: await runWalk(started, copy, work, baseURL, log, options.seeds), pids: started.pids };
  } finally {
    await started.finish(() => removeCopy(projectDir, copy));
  }
}

/**
 * `boardsmith smoke [--project <dir>] [--seed <seeds...>]`: the smoke check alone, on the working
 * tree as it stands, dealt from the seeds `--seed` names instead of the spec's when it names any.
 */
export async function smokeCommand(options: { project?: string; seed?: string[] }): Promise<void> {
  const projectDir = pathResolve(options.project ?? process.cwd());
  if (!existsSync(join(projectDir, 'boardsmith.json'))) {
    throw new Error(`boardsmith smoke runs a game project, and ${projectDir} has no boardsmith.json. Run it in the game's directory, or pass --project <dir>.`);
  }
  const { outcome } = await runSmoke({ projectDir, log: (line) => console.error(chalk.dim(line)), seeds: options.seed });
  if (outcome.passed) {
    console.log(chalk.green(outcome.summary));
    return;
  }
  console.error(chalk.red(outcome.summary));
  if (outcome.next) console.error(outcome.next);
  process.exitCode = 1;
}
