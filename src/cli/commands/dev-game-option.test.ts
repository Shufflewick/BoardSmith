/**
 * `boardsmith dev --game-option` REACHES THE LOBBY (#541).
 *
 * The flag was applied to the game the host started, but the lobby showed the
 * option's declared default, because nothing told the page which value was
 * applied. This spawns the real CLI with the flag and reads the lobby a page
 * receives, so the whole road (flag, selection, host, lobby message, client)
 * is the one under test.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { devProject, spawnDev } from './dev-project.test-helper.js';
import { freePort } from '../lib/free-port.js';
import { createDevHostClient } from '../../client/dev-host-client.js';

// The run bundles the project's rules and starts Vite. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

describe('boardsmith dev --game-option (#541)', () => {
  it('the lobby a page receives carries the value the flag selected, not the declared default', async () => {
    const cwd = await devProject(false);
    const configPath = join(cwd, 'boardsmith.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.gameOptions = [{ id: 'targetScore', type: 'number', label: 'Target Score', min: 31, max: 121, step: 10, default: 121 }];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const port = await freePort();
    const run = spawnDev(cwd, port, ['--game-option', 'targetScore=61']);
    try {
      const ready = await new Promise<boolean>((resolve) => {
        run.child.stdout.on('data', () => {
          if (run.output().includes('Ready!')) resolve(true);
        });
        run.child.on('exit', () => resolve(false));
      });
      expect(ready, run.output()).toBe(true);

      const client = createDevHostClient(`ws://127.0.0.1:${port}/__boardsmith/ws`);
      await client.opened;
      client.hello();
      const lobby = await client.getLobby();
      client.close();

      expect(lobby.gameOptions).toEqual({ targetScore: 61 });
    } finally {
      run.child.kill('SIGINT');
      await run.ended;
    }
  });
});
