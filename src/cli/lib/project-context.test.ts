import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getProjectContext, requireBoardsmithWorkspace } from './project-context.js';

/**
 * `lint` and `audit` both run in the library repo and in a game project, and
 * both refuse to run anywhere else. The refusal lives here so the two cannot
 * drift into two different error messages.
 */
describe('requireBoardsmithWorkspace', () => {
  const dirs: string[] = [];

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'bs-context-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const workspaces: Array<[label: string, make: (dir: string) => void, context: string]> = [
    ['the library repo', (dir) => mkdirSync(join(dir, 'src', 'engine'), { recursive: true }), 'monorepo'],
    ['a game project', (dir) => writeFileSync(join(dir, 'boardsmith.json'), '{}'), 'standalone'],
  ];

  it.each(workspaces)('returns quietly in %s', (_label, make, context) => {
    const dir = tempDir();
    make(dir);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    requireBoardsmithWorkspace(dir);

    expect(exit).not.toHaveBeenCalled();
    expect(getProjectContext(dir)).toBe(context);
  });

  it('exits 1 with an actionable message anywhere else', () => {
    const dir = tempDir();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });

    requireBoardsmithWorkspace(dir);

    expect(exit).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('boardsmith.json');
  });
});
