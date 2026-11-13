import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { Started } from './started-processes.js';

const GROUP_RUN = fileURLToPath(new URL('./started-group.test-helper.mjs', import.meta.url));

describe('Started.spawn with ownGroup (#1648)', () => {
  it("keeps a signal to the run's process group from killing the runner before its worker, so the worker is gone by the clean-up", async () => {
    // Detached, so SIGTERM to its group reaches what a tool's time limit reaches, and not this test.
    const driver = spawn(process.execPath, [GROUP_RUN, 'driver'], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    const workerPid = await new Promise<number>((resolve) =>
      driver.stdout.on('data', (chunk: Buffer) => {
        output += chunk;
        const pid = /worker (\d+)/.exec(output)?.[1];
        if (pid) resolve(Number(pid));
      }),
    );
    try {
      const exited = once(driver, 'exit');
      process.kill(-driver.pid!, 'SIGTERM');
      await exited;
      expect(output).toContain('worker gone at clean-up');
    } finally {
      try {
        process.kill(workerPid, 'SIGKILL');
      } catch {
        // Already gone, which is what the fix makes so.
      }
    }
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
