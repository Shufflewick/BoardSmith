/**
 * `boardsmith dev` AND A DESIGNER-ONLY GAME OPTION (#687).
 *
 * A designer-only option (`designerOnly: true`) is never a player's to choose,
 * but the dev host is the designer's table: `--game-option` sets it. A preset
 * is a shortcut a player picks, so one naming the option is refused when the
 * game loads, and an option marked designer-only in `boardsmith.json` (whose
 * options the platform's lobby lists) is refused too. Spawned through the real
 * CLI, so the road under test is flag, load, selection, host and lobby message.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { devProject, spawnDev } from './dev-project.test-helper.js';
import { freePort } from '../lib/free-port.js';
import { createDevHostClient } from '../../client/dev-host-client.js';

// Each run bundles the project's rules and starts Vite. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

const KNOB = `lootScale: { type: 'number', label: 'Loot scale', min: 0.5, max: 2, step: 0.5, default: 1, designerOnly: true }`;

/** A scaffolded table project whose gameDefinition also declares `extra` (gameOptions, presets). */
async function projectDeclaring(extra: string): Promise<string> {
  const cwd = await devProject(false);
  const rules = join(cwd, 'src', 'rules', 'index.ts');
  const source = readFileSync(rules, 'utf-8');
  const anchor = '  metrics,\n} as const;';
  expect(source).toContain(anchor);
  writeFileSync(rules, source.replace(anchor, `  metrics,\n${extra}\n} as const;`));
  return cwd;
}

describe('boardsmith dev and a designer-only game option (#687)', () => {
  it('--game-option sets it, and the lobby a page receives carries the value', async () => {
    const cwd = await projectDeclaring(`  gameOptions: { ${KNOB} },`);
    const port = await freePort();
    const run = spawnDev(cwd, port, ['--game-option', 'lootScale=1.5']);
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

      expect(lobby.gameOptions).toEqual({ lootScale: 1.5 });
    } finally {
      run.child.kill('SIGINT');
      await run.ended;
    }
  });

  it('refuses to start a game whose preset sets it, naming the preset', async () => {
    const cwd = await projectDeclaring(
      `  gameOptions: { ${KNOB} },\n  presets: [{ name: 'Rich', options: { lootScale: 2 } }],`,
    );
    const ended = await spawnDev(cwd, await freePort()).ended;

    expect(ended.code, ended.output).toBe(1);
    expect(ended.output).toContain('This game\'s preset "Rich" cannot be used: Game option "lootScale" is designer-only');
  });

  it('refuses to start a game whose boardsmith.json also declares a designer-only option of the rules', async () => {
    const cwd = await projectDeclaring(`  gameOptions: { ${KNOB} },`);
    const configPath = join(cwd, 'boardsmith.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.gameOptions = [{ id: 'lootScale', type: 'number', label: 'Loot scale', default: 1 }];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const ended = await spawnDev(cwd, await freePort()).ended;

    expect(ended.code, ended.output).toBe(1);
    expect(ended.output).toContain('boardsmith.json declares game option "lootScale"');
    expect(ended.output).toContain('Move "lootScale" into gameDefinition.gameOptions');
  });

  it('starts a game whose preset sets only its players', async () => {
    const cwd = await projectDeclaring(`  presets: [{ name: 'Pair', players: [{ name: 'A' }, { name: 'B' }] }],`);
    const port = await freePort();
    const run = spawnDev(cwd, port, ['--preset', 'Pair']);
    try {
      const ready = await new Promise<boolean>((resolve) => {
        run.child.stdout.on('data', () => {
          if (run.output().includes('Ready!')) resolve(true);
        });
        run.child.on('exit', () => resolve(false));
      });
      expect(ready, run.output()).toBe(true);
    } finally {
      run.child.kill('SIGINT');
      await run.ended;
    }
  });

  it('refuses to start a game whose boardsmith.json marks an option designer-only', async () => {
    const cwd = await devProject(false);
    const configPath = join(cwd, 'boardsmith.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.gameOptions = [{ id: 'lootScale', type: 'number', label: 'Loot scale', default: 1, designerOnly: true }];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const ended = await spawnDev(cwd, await freePort()).ended;

    expect(ended.code, ended.output).toBe(1);
    expect(ended.output).toContain('boardsmith.json declares game option "lootScale" as designerOnly');
  });
});
