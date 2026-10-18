/**
 * `boardsmith init` run from npm's `_npx` cache (#1007). Init links the game to
 * the BoardSmith that ran it (#849), and npm clears that cache, so the game
 * would lose its engine. Init refuses instead, before writing anything.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { initCommand } from './init.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { rejectionMessage } from '../../testing/rejection.test-helper.js';

const NPX_ROOT = join('/home', 'designer', '.npm', '_npx', 'a1b2c3', 'node_modules', 'boardsmith');

vi.mock('../lib/boardsmith-version.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/boardsmith-version.js')>()),
  boardsmithPackageRoot: () => NPX_ROOT,
}));

describe('initCommand from the npx cache (#1007)', () => {
  it('refuses, says what to do instead, and creates nothing', async () => {
    const parent = tempTree('bs-1007-npx-');
    const cwd = process.cwd();
    process.chdir(parent);
    try {
      const message = await rejectionMessage(initCommand('my-game', { withoutRulebook: true }));
      expect(message).toContain('_npx');
      expect(message).toMatch(/clone/i);
      expect(existsSync(join(parent, 'my-game'))).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });
});
