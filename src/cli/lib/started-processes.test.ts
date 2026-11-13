import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Started } from './started-processes.js';

const GROUP_RUN = fileURLToPath(new URL('./started-group.test-helper.mjs', import.meta.url));

/**
 * Runs the driver over `runner` and returns what it printed, once `afterReady` (given the driver)
 * has run and the driver has exited. The worker is killed afterwards, whatever happened.
 */
async function groupRun(runner: string, afterReady: (driver: ReturnType<typeof spawn>) => void): Promise<string> {
  // Detached, so SIGTERM to its group reaches what a tool's time limit reaches, and not this test.
  const driver = spawn(process.execPath, [GROUP_RUN, 'driver', runner], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(driver, 'exit');
  let output = '';
  const workerPid = await new Promise<number>((resolve) =>
    driver.stdout.on('data', (chunk: Buffer) => {
      output += chunk;
      const pid = /worker (\d+)/.exec(output)?.[1];
      if (pid) resolve(Number(pid));
    }),
  );
  try {
    afterReady(driver);
    await exited;
    return output;
  } finally {
    try {
      process.kill(workerPid, 'SIGKILL');
    } catch {
      // Already gone, which is what the fix makes so.
    }
  }
}

describe('Started.spawn with ownGroup (#1648)', () => {
  it("keeps a signal to the run's process group from killing the runner before its worker, so the worker is gone by the clean-up", async () => {
    const output = await groupRun('runner', (driver) => process.kill(-driver.pid!, 'SIGTERM'));
    expect(output).toContain('worker gone at clean-up');
  });

  it('stops a worker its runner left behind by exiting on its own, before the clean-up (#1648 review F1)', async () => {
    const output = await groupRun('crashing-runner', () => {});
    expect(output).toContain('worker gone at clean-up');
  });
});

describe('Started.finish', () => {
  it('lets the signals go even when the clean-up throws (#853)', async () => {
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    const started = new Started();
    await expect(started.finish(() => Promise.reject(new Error('clean-up failed')))).rejects.toThrow('clean-up failed');
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(before);
  });
});
