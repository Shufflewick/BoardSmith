/**
 * The smoke check serves its copy with no file watcher (#1594): nothing edits the copy, and a sync
 * client writing metadata on the fresh files (Dropbox) made the watcher reload rules and pages
 * under the walk.
 */
import { describe, expect, it, vi } from 'vitest';
import { runSmoke } from './smoke.js';
import { smokeProject } from './smoke-project.test-helper.js';
import { quiet } from './smoke-walk.test-helper.js';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });

const devFlags = vi.hoisted(() => [] as string[][]);
vi.mock('../lib/started-processes.js', async (original) => ({
  ...(await original<typeof import('../lib/started-processes.js')>()),
  startDev: async (_started: unknown, _cwd: string, flags: readonly string[] = []) => {
    devFlags.push([...flags]);
    return { passed: false, summary: 'stopped here by the test' };
  },
}));

describe('boardsmith verify: the smoke check', () => {
  it('starts `boardsmith dev` on its copy with --no-watch', async () => {
    const dir = await smokeProject(false);
    const { outcome } = await runSmoke({ projectDir: dir, log: quiet });
    expect(outcome.summary).toBe('stopped here by the test');
    expect(devFlags).toEqual([expect.arrayContaining(['--no-watch'])]);
  });
});
