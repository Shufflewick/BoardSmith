/**
 * `boardsmith dev` AND A DESIGNER-ONLY GAME OPTION (#687, #701).
 *
 * A designer-only option (`designerOnly: true`, declared in `boardsmith.json`
 * like every option) is never a player's to choose, but the dev host is the
 * designer's table: `--game-option` sets it, and left alone it starts at its
 * default. A preset is a shortcut a player picks, so one naming the option is
 * refused when the game loads. A gameDefinition that still declares
 * gameOptions is refused, saying where they go. Spawned through the real CLI,
 * so the road under test is boardsmith.json, flag, load, selection, host and
 * lobby message.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { devProject, spawnDev } from './dev-project.test-helper.js';
import { freePort } from '../lib/free-port.js';
import { createDevHostClient } from '../../client/dev-host-client.js';

// Each run bundles the project's rules and starts Vite. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

const KNOB = { id: 'lootScale', type: 'number', label: 'Loot scale', min: 0.5, max: 2, step: 0.5, default: 1, designerOnly: true };

/**
 * A scaffolded table project whose boardsmith.json declares `gameOptions` and
 * whose gameDefinition also declares `extra` (presets, or a stale gameOptions).
 */
async function projectDeclaring(gameOptions: unknown[], extra = ''): Promise<string> {
  const cwd = await devProject(false);
  const rules = join(cwd, 'src', 'rules', 'index.ts');
  const source = readFileSync(rules, 'utf-8');
  const anchor = '  metrics,\n} as const;';
  expect(source).toContain(anchor);
  writeFileSync(rules, source.replace(anchor, `  metrics,\n${extra}\n} as const;`));
  const configPath = join(cwd, 'boardsmith.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  writeFileSync(configPath, JSON.stringify({ ...config, gameOptions }, null, 2));
  return cwd;
}

/** The lobby a page receives from `boardsmith dev` run in `cwd` with `flags`. */
async function lobbyOf(cwd: string, flags: string[]): Promise<{ gameOptions?: Record<string, unknown> }> {
  const port = await freePort();
  const run = spawnDev(cwd, port, flags);
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
    return lobby;
  } finally {
    run.child.kill('SIGINT');
    await run.ended;
  }
}

describe('boardsmith dev and a designer-only game option (#687, #701)', () => {
  it('declared in boardsmith.json, --game-option sets it, and the lobby a page receives carries the value', async () => {
    const cwd = await projectDeclaring([KNOB]);
    expect((await lobbyOf(cwd, ['--game-option', 'lootScale=1.5'])).gameOptions).toEqual({ lootScale: 1.5 });
  });

  it('left alone, it starts at its declared default', async () => {
    const cwd = await projectDeclaring([KNOB]);
    expect((await lobbyOf(cwd, [])).gameOptions).toEqual({ lootScale: 1 });
  });

  it('refuses to start a game whose preset sets it, naming the preset', async () => {
    const cwd = await projectDeclaring([KNOB], `  presets: [{ name: 'Rich', options: { lootScale: 2 } }],`);
    const ended = await spawnDev(cwd, await freePort()).ended;

    expect(ended.code, ended.output).toBe(1);
    expect(ended.output).toContain('This game\'s preset "Rich" cannot be used: Game option "lootScale" is designer-only');
  });

  it('refuses to start a game whose gameDefinition still declares gameOptions, saying to move them to boardsmith.json', async () => {
    const cwd = await projectDeclaring([], `  gameOptions: { lootScale: { type: 'number', label: 'Loot scale', default: 1 } },`);
    const ended = await spawnDev(cwd, await freePort()).ended;

    expect(ended.code, ended.output).toBe(1);
    expect(ended.output).toContain('This gameDefinition declares gameOptions');
    expect(ended.output).toContain('boardsmith.json');
  });

  it('starts a game whose preset sets only its players', async () => {
    const cwd = await projectDeclaring([], `  presets: [{ name: 'Pair', players: [{ name: 'A' }, { name: 'B' }] }],`);
    expect(await lobbyOf(cwd, ['--preset', 'Pair'])).toBeDefined();
  });
});
