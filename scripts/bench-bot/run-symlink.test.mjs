/**
 * The bench runs when started through a symlink (#922), as it is from a game's
 * `node_modules/boardsmith/scripts/bench-bot/run.mjs`. Node gives the script's
 * real path in `import.meta.url` but the path as typed in `process.argv[1]`.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../../src/testing/temp-tree.test-helper.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('bench-bot through a symlink', () => {
  it('runs main, so a game it cannot find is refused rather than silently skipped', () => {
    const tree = tempTree('bs-bench-link-');
    const link = join(tree, 'boardsmith');
    symlinkSync(REPO, link);
    const ran = spawnSync(process.execPath, [join(link, 'scripts', 'bench-bot', 'run.mjs'), '/no-such-game'], {
      encoding: 'utf8',
    });
    expect(ran.stderr).toContain('"/no-such-game" is neither a catalogue game');
    expect(ran.status).toBe(1);
  });
});
