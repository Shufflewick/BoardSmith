import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { endsWithTest } from './dev-project.test-helper.js';

/**
 * #1304: a test that spawns `boardsmith dev` and then fails before it stops
 * the child left a live dev server holding a port and a build directory.
 * `endsWithTest` ends the child when its test finishes, whatever the outcome.
 */
describe('endsWithTest (#1304)', () => {
  let child: ChildProcess;

  it('registers a child that would outlive its test', () => {
    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    endsWithTest(child);
    expect(child.exitCode).toBeNull();
  });

  it('the child was ended when that test finished', async () => {
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    expect(child.signalCode).toBe('SIGKILL');
  });
});
