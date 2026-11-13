/**
 * The processes a run starts, `boardsmith dev` among them, and stopping every one of them however
 * the run ends: the smoke check (`commands/smoke.ts`) and the browser regressions' table fixture
 * (`commands/fixture-table.test-helper.ts`, #703) both run through it.
 *
 * @module
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { boardsmithPackageRoot } from './boardsmith-version.js';
import { collectOutput } from './child-output.js';
import { freePort } from './free-port.js';
import type { VerifyCheckOutcome } from './verify-result.js';

/** How long `boardsmith dev` gets to print that it is ready. A hang guard, not a budget. */
const DEV_READY_MS = 180_000;

/** How long a process asked to stop gets before it is killed. */
const STOP_GRACE_MS = 15_000;

/** How many free ports to try when another process takes the one found before dev binds it. */
const PORT_ATTEMPTS = 3;

/** The last lines of a process's output, for a message saying why it stopped. */
export const tail = (output: string, lines = 12) => output.trim().split('\n').slice(-lines).join('\n');

/**
 * Every process a run starts, so each is stopped however the run ends. While the run is live,
 * SIGINT or SIGTERM to this process stops them at once, and is raised again once the run has
 * cleaned up (`finish`), so an interrupted run leaves nothing running.
 */
export class Started {
  readonly children: ChildProcess[] = [];
  private readonly groups = new Set<ChildProcess>();
  private interruptedBy: NodeJS.Signals | undefined;
  private signalled: (signal: NodeJS.Signals) => void = () => {};
  /** Settles with the signal that interrupted the run, for a caller waiting on something else. */
  readonly interrupted = new Promise<NodeJS.Signals>((resolve) => (this.signalled = resolve));
  private readonly onSignal = (signal: NodeJS.Signals) => {
    this.interruptedBy ??= signal;
    this.signalled(signal);
    void this.stopAll();
  };

  constructor() {
    process.on('SIGINT', this.onSignal);
    process.on('SIGTERM', this.onSignal);
  }

  /**
   * Starts `args` under this Node, with `env` added to this process's environment (a name given
   * undefined is kept from the child), keeping its output. Refuses once the run was interrupted.
   * With `ownGroup`, the child leads its own process group, which is signalled whole when it is
   * stopped, so a signal to this run's group cannot end it before the processes it started, and
   * any it leaves behind are killed once it has gone (#1648). Windows has no such groups.
   */
  spawn(
    args: string[],
    cwd: string,
    env: Record<string, string | undefined> = {},
    { ownGroup = false }: { ownGroup?: boolean } = {},
  ): { child: ChildProcess; output: () => string } {
    if (this.interruptedBy !== undefined) throw new Error(`The run was interrupted (${this.interruptedBy}).`);
    const environment: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0' };
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete environment[name];
      else environment[name] = value;
    }
    const group = ownGroup && process.platform !== 'win32';
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: environment, detached: group });
    this.children.push(child);
    if (group) this.groups.add(child);
    return { child, output: collectOutput(child) };
  }

  /** The ids of every process started, for a caller that checks they are gone. */
  get pids(): number[] {
    return this.children.map((child) => child.pid).filter((pid): pid is number => pid !== undefined);
  }

  /** Stops every process still running: asked first, killed if it has not gone after a grace. */
  async stopAll(): Promise<void> {
    await Promise.all(this.children.map((child) => stop(child, this.groups.has(child))));
  }

  /** Stops everything, runs `cleanUp`, then lets the signals go, raising again one that came. */
  async finish(cleanUp: () => Promise<void>): Promise<void> {
    try {
      await this.stopAll();
      await cleanUp();
    } finally {
      process.off('SIGINT', this.onSignal);
      process.off('SIGTERM', this.onSignal);
    }
    if (this.interruptedBy !== undefined) process.kill(process.pid, this.interruptedBy);
  }
}

const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;

/** How often a stopped group is looked at until it is empty. */
const GROUP_CHECK_MS = 50;

/** Sends `signal` to `child`, or to its whole process group when it leads one; false once that group is empty. */
function signalChild(child: ChildProcess, group: boolean, signal: NodeJS.Signals): boolean {
  if (!group) return child.kill(signal);
  try {
    process.kill(-child.pid!, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

/** Kills what is left of `child`'s group and resolves once it is empty, so nothing in it writes on (#1648 review F1). */
async function killGroup(child: ChildProcess): Promise<void> {
  // A hang guard, not a budget: SIGKILL ends a process at once unless the system is stuck.
  for (let waited = 0; signalChild(child, true, 'SIGKILL'); waited += GROUP_CHECK_MS) {
    if (waited >= STOP_GRACE_MS) {
      throw new Error(`A process the run started (in group ${child.pid}) did not stop after SIGKILL. Stop it by its pid, then run the check again.`);
    }
    await sleep(GROUP_CHECK_MS);
  }
}

async function stop(child: ChildProcess, group: boolean): Promise<void> {
  if (running(child)) {
    const exited = once(child, 'exit');
    // SIGINT is the signal both `boardsmith dev` and Playwright stop in order on.
    signalChild(child, group, 'SIGINT');
    const killer = setTimeout(() => signalChild(child, group, 'SIGKILL'), STOP_GRACE_MS);
    await exited;
    clearTimeout(killer);
  }
  // A worker its leader left behind (a runner that crashed) would go on writing into what the run removes next.
  if (group) await killGroup(child);
}

/**
 * Starts `boardsmith dev --no-open` in `cwd`, adding `flags`, and resolves with its URL once it says
 * it is ready, or with a failed outcome carrying its last output when it stops or hangs first.
 */
export async function startDev(started: Started, cwd: string, flags: readonly string[] = []): Promise<string | VerifyCheckOutcome> {
  const bin = join(boardsmithPackageRoot(), 'bin', 'boardsmith.js');
  for (let attempt = 1; ; attempt++) {
    const port = await freePort();
    const dev = started.spawn([bin, 'dev', '--port', String(port), '--no-open', ...flags], cwd);
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
