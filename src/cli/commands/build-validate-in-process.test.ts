/**
 * `boardsmith verify` runs validate in its own process (#532), and tests call `buildProject` in
 * theirs, so neither may depend on what a shell would have given it, nor leave anything behind.
 *
 * - The project path may run through a symlink (macOS's /var is /private/var; `--project` can be
 *   any link). A shell's working directory is always a real path, and Vite names each HTML entry,
 *   and validate compares vue-tsc's program to vitest's file list, by paths that only agree when
 *   both are real. The link here is explicit, so this holds on Linux too.
 * - Vite sets NODE_ENV to `production` when it is unset and never puts it back. A process started
 *   after it with this process's environment (`boardsmith dev`, Playwright, vitest) would run
 *   against Vue's production build. verify runs build in a child process for this reason (#1495).
 *
 * NODE_ENV is unset for the run, as it is when a designer runs `boardsmith verify` (vitest sets it
 * to `test`). Both steps run while the file is collected, where no test timeout applies (#363).
 */
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { smokeProject } from './smoke-project.test-helper.js';
import { buildProject } from './build.js';
import { validateProject } from './validate.js';

const project = await smokeProject(false);
const linkTree = tempTree('bs-in-process-link-');
const link = join(linkTree, 'game');
symlinkSync(project, link, 'dir');

/** Runs `step`, returning what it threw and the environment it left. */
async function runStep(step: () => Promise<void>): Promise<{ thrown: unknown; envAfter: NodeJS.ProcessEnv }> {
  try {
    await step();
    return { thrown: undefined, envAfter: { ...process.env } };
  } catch (thrown) {
    return { thrown, envAfter: { ...process.env } };
  }
}

const vitestNodeEnv = process.env.NODE_ENV;
delete process.env.NODE_ENV;
const envBefore = { ...process.env };
const printed: string[] = [];
const log = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void printed.push(String(line)));
const error = vi.spyOn(console, 'error').mockImplementation(() => {});
const build = await runStep(() => buildProject(link, {}));
const validate = await runStep(() => validateProject(link));
log.mockRestore();
error.mockRestore();
process.env.NODE_ENV = vitestNodeEnv;

// styleText colours the verdict, so the line is matched without its escape codes.
const coverageLine = printed.map(stripVTControlCharacters).find((line) => line.includes('Test Type Coverage'));

describe("build and validate inside verify's process (#532)", () => {
  it('builds a project reached through a symlink', () => {
    expect(build.thrown).toBeUndefined();
  });

  it('validates a project reached through a symlink, its test-coverage check included', () => {
    expect(validate.thrown).toBeUndefined();
    expect(coverageLine).toContain('PASS');
  });

  it('leaves the environment as it found it, NODE_ENV unset included', () => {
    expect(build.envAfter.NODE_ENV).toBeUndefined();
    expect(build.envAfter).toEqual(envBefore);
    expect(validate.envAfter).toEqual(envBefore);
  });
});
