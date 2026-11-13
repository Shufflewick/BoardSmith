// Reached by `spawn`, never by an import: it is the far side of the process boundary it tests.
// fallow-ignore-file unused-file
/**
 * A run shaped like the smoke check's browser run, for `started-processes.test.ts` (#1648).
 *
 * - `driver` starts a `runner` through `Started`, as `runSmoke` starts Playwright, prints the
 *   worker's pid, waits for the runner to exit, then says in its clean-up whether the worker is
 *   still alive, which is when `runSmoke` removes the copy the worker writes into.
 * - `runner` forks a `worker`, as Playwright's runner does. It dies at once on SIGTERM (it has no
 *   handler), and on SIGINT stops its worker and waits for it to exit before it exits itself.
 * - `worker` ignores SIGINT and SIGTERM and outlives its runner, as Playwright's workers do; only a
 *   `stop` message from the runner, or SIGKILL, ends it.
 *
 * Every line goes out with `writeSync`, so a line written just before a signal ends the process is
 * not lost in a pipe's buffer.
 *
 * Usage: `node started-group.test-helper.mjs driver`
 */
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const say = (line) => writeSync(1, `${line}\n`);
const mode = process.argv[2];

if (mode === 'worker') {
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
  process.on('message', (message) => message === 'stop' && process.exit(0));
  // Keeps the worker alive once its runner is gone, as a Playwright worker's teardown does.
  setInterval(() => {}, 1 << 30);
  process.send('ready');
} else if (mode === 'runner') {
  const worker = fork(self, ['worker']);
  await once(worker, 'message');
  process.on('SIGINT', async () => {
    worker.send('stop');
    await once(worker, 'exit');
    process.exit(130);
  });
  say(`worker ${worker.pid}`);
} else if (mode === 'driver') {
  await import('tsx');
  const { Started } = await import('./started-processes.ts');
  const started = new Started();
  const runner = started.spawn([self, 'runner'], process.cwd(), {}, { ownGroup: true });
  const [line] = await once(runner.child.stdout, 'data');
  const workerPid = Number(/worker (\d+)/.exec(String(line))[1]);
  say(`worker ${workerPid}`);
  await once(runner.child, 'exit');
  await started.finish(async () => {
    const alive = (() => {
      try {
        process.kill(workerPid, 0);
        return true;
      } catch {
        return false;
      }
    })();
    say(alive ? 'worker alive at clean-up' : 'worker gone at clean-up');
  });
}
