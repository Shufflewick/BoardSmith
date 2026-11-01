/**
 * `boardsmith dev --preset` SETS UP EACH SEAT (#1544).
 *
 * A preset's `players` set each seat's colour, bot and player options,
 * including which seat holds an exclusive option, and a preset seat the
 * platform's lobby would refuse is refused when the game loads. Spawned
 * through the real CLI, so the road under test is the rules' presets,
 * boardsmith.json, load, flags, host and lobby message.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { devProject, spawnDev } from './dev-project.test-helper.js';
import { freePort } from '../lib/free-port.js';
import { createDevHostClient } from '../../client/dev-host-client.js';

// Each run bundles the project's rules and starts Vite. A hang guard, not a budget.
vi.setConfig({ testTimeout: 120_000 });

const ROLE = { id: 'role', type: 'exclusive', label: 'Dictator', default: 'last', choices: [{ value: 'dictator', label: 'Dictator' }] };
const PALETTE = [
  { hex: '#e74c3c', label: 'Red' },
  { hex: '#3498db', label: 'Blue' },
  { hex: '#95a5a6', label: 'Grey' },
];

/** A scaffolded table project with an exclusive `role` option, a palette and `presets` in its gameDefinition. */
async function projectWithPresets(presets: string): Promise<string> {
  const cwd = await devProject(false);
  const rules = join(cwd, 'src', 'rules', 'index.ts');
  const source = readFileSync(rules, 'utf-8');
  const anchor = '  metrics,\n} as const;';
  expect(source).toContain(anchor);
  writeFileSync(rules, source.replace(anchor, `  metrics,\n  presets: ${presets},\n} as const;`));
  const configPath = join(cwd, 'boardsmith.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  writeFileSync(configPath, JSON.stringify({ ...config, playerOptions: [ROLE], colorPalette: PALETTE }, null, 2));
  return cwd;
}

type Seat = { seat: number; bot: boolean; playerOptions: Record<string, unknown> };
type Started = { view: { state: { players: Array<{ seat: number; color: string }> } } };

/** The first game a page is sent from `boardsmith dev` run in `cwd` with `flags`, and the lobby's seats once it started. */
async function tableOf(cwd: string, flags: string[]): Promise<{ started: Started; seats: Seat[]; output: string }> {
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
    const firstGame = new Promise<Started>((resolve) => {
      client.onMessage((msg) => {
        if (msg.type === 'game_state') resolve(msg as unknown as Started);
      });
    });
    client.hello();
    const started = await firstGame;
    const lobby = await client.getLobby();
    client.close();
    // The wire's seat carries `bot` and `playerOptions`, which the client's reply type leaves out.
    return { started, seats: lobby.seats as unknown as Seat[], output: run.output() };
  } finally {
    run.child.kill('SIGINT');
    await run.ended;
  }
}

describe('boardsmith dev --preset sets up each seat (#1544)', () => {
  it('gives the exclusive option, colours and bots to the seats the preset names', async () => {
    const cwd = await projectWithPresets(
      `[{ name: 'Play as Dictator', players: [{ color: '#95a5a6', playerOptions: { role: 'dictator' } }, { color: '#e74c3c', isBot: true, botLevel: 'easy' }] }]`,
    );

    const { started, seats, output } = await tableOf(cwd, ['--preset', 'Play as Dictator']);

    expect(output).toContain('Seats: 2 (open seats play as bot, level medium; seats left to bots: 2 at easy).');

    expect(started.view.state.players.map(({ seat, color }) => ({ seat, color }))).toEqual([
      { seat: 1, color: '#95a5a6' },
      { seat: 2, color: '#e74c3c' },
    ]);
    expect(seats.map(({ seat, bot, playerOptions }) => ({ seat, bot, playerOptions }))).toEqual([
      { seat: 1, bot: false, playerOptions: { role: 'dictator' } },
      { seat: 2, bot: true, playerOptions: {} },
    ]);
  });

  it('refuses to start a game whose preset seat sets a player option outside playerOptions, naming the preset', async () => {
    const cwd = await projectWithPresets(`[{ name: 'Old shape', players: [{ role: true }, { role: false }] }]`);

    const ended = await spawnDev(cwd, await freePort()).ended;

    expect(ended.code, ended.output).toBe(1);
    expect(ended.output).toContain('This game\'s preset "Old shape" cannot be used: seat 1 sets "role", which a preset seat does not take.');
  });
});
