import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectContext, requireBoardsmithWorkspace } from './project-context.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * `lint` and `audit` both run in the library repo and in a game project, and
 * both refuse to run anywhere else. The refusal lives here so the two cannot
 * drift into two different error messages.
 */
describe('requireBoardsmithWorkspace', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const workspaces: Array<[label: string, make: (dir: string) => void, context: string]> = [
    ['the library repo', (dir) => mkdirSync(join(dir, 'src', 'engine'), { recursive: true }), 'monorepo'],
    ['a game project', (dir) => writeFileSync(join(dir, 'boardsmith.json'), '{}'), 'standalone'],
  ];

  it.each(workspaces)('returns quietly in %s', (_label, make, context) => {
    const dir = tempTree('bs-context-');
    make(dir);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    requireBoardsmithWorkspace(dir);

    expect(exit).not.toHaveBeenCalled();
    expect(getProjectContext(dir)).toBe(context);
  });

  it('exits 1 with an actionable message anywhere else', () => {
    const dir = tempTree('bs-context-');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });

    requireBoardsmithWorkspace(dir);

    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('boardsmith.json');
  });

  it('prints plain text, with no colour codes, when stdout is not a terminal (#931)', () => {
    // The shell running the suite may force or forbid colour; this test is about the piped stdout alone.
    vi.stubEnv('FORCE_COLOR', undefined);
    vi.stubEnv('NO_COLOR', undefined);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });

    requireBoardsmithWorkspace(tempTree('bs-context-'));

    // The test runner pipes stdout, so styleText must leave the message unstyled.
    expect(errors[0]).toBe('Error: not a BoardSmith workspace');
  });
});
