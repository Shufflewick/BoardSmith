/**
 * #361: `boardsmith dev` ENFORCES A TABLE GAME'S UNDO AND CHECKPOINT POLICIES.
 *
 * The platform hands the bundle's whole `gameDefinition` to `executeOp`, so a
 * game's `undo` and `checkpoints` reach every runner it builds. The dev host
 * used to copy six named fields out of the definition and drop the rest, so a
 * game that fenced undo across random draws, or turned checkpoints off, could
 * undo freely under `boardsmith dev` and nowhere else.
 *
 * These tests drive the real road: a game project on disk, bundled by the same
 * loader `boardsmith dev` uses, run through `MultiplayerHost`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { loadTableRuntime, type TableRuntime } from '../commands/dev-table-runtime.js';
import { MultiplayerHost, type HostOutbound } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';

const clients = createDevHostClientMemory();
beforeEach(() => clients.reset());

/**
 * A one-seat game whose `roll` draws and whose `move` does not, every move in
 * one repeating step so undo always has a turn to take back. `policy` is the
 * source text of the definition's policy fields.
 */
function rulesSource(policy: string): string {
  return [
    "import { Action, Game, Player, actionStep, defineFlow, type GameOptions } from 'boardsmith';",
    'export class PolicyGame extends Game<PolicyGame, Player> {',
    '  moves = 0;',
    '  lastRoll = 0;',
    '  constructor(options: GameOptions) {',
    '    super(options);',
    "    this.registerAction(Action.create('move').execute(() => { this.moves += 1; }));",
    "    this.registerAction(Action.create('roll').execute(() => { this.lastRoll = this.random(); }));",
    '    this.setFlow(defineFlow<PolicyGame>({',
    "      root: actionStep({ actions: ['move', 'roll'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false }),",
    '    }));',
    '  }',
    '}',
    'export const gameDefinition = {',
    '  gameClass: PolicyGame,',
    "  gameType: 'undo-policy-game',",
    '  minPlayers: 1,',
    '  maxPlayers: 1,',
    `  ${policy}`,
    '};',
  ].join('\n');
}

async function loadProject(policy: string): Promise<TableRuntime> {
  const dir = tempTree('bs-table-undo-policy-');
  const rulesPath = join(dir, 'src', 'rules');
  mkdirSync(rulesPath, { recursive: true });
  const tempDir = join(dir, '.boardsmith');
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(join(rulesPath, 'index.ts'), rulesSource(policy));
  return loadTableRuntime(rulesPath, tempDir, 'monorepo');
}

async function openTable(runtime: TableRuntime) {
  const sent: Array<{ clientId: string; msg: HostOutbound }> = [];
  const host = new MultiplayerHost({
    playerCount: 1,
    minPlayers: 1,
    maxPlayers: 1,
    makeSeed: () => 'undo-policy',
    executeOp: runtime.rules.executeOp,
    send: (clientId, msg) => {
      sent.push({ clientId, msg });
      clients.remember(clientId, msg);
    },
  });
  await host.handleMessage('dev', { type: 'hello' });
  let request = 0;
  const ask = async (op: string, payload: Record<string, unknown>) => {
    const requestId = `${op}-${++request}`;
    await host.handleMessage('dev', { type: 'server_request', requestId, op, payload });
    const response = sent
      .filter((e) => e.msg.type === 'server_response')
      .map((e) => e.msg as Extract<HostOutbound, { type: 'server_response' }>)
      .find((m) => m.requestId === requestId);
    return response?.result as { success: boolean; error?: string } | undefined;
  };
  return {
    host,
    act: (actionName: string) => ask('action', { actionName, args: {}, boundaryKey: clients.key('dev') }),
    undo: () => ask('undo', {}),
  };
}

const FENCED = 'undo: { fenceRandomRewind: true },';
const NO_CHECKPOINTS = 'checkpoints: { enabled: false },';

describe('#361: the table dev host enforces the game definition', () => {
  it("refuses an undo across a random draw when the game's undo policy fences it", async () => {
    const table = await openTable(await loadProject(FENCED));
    expect((await table.act('roll'))?.success).toBe(true);

    const undo = await table.undo();
    expect(undo?.success).toBe(false);
    expect(undo?.error).toMatch(/a random draw was consumed there/);
  }, 30_000);

  it('still allows an undo the fence does not cover, so the policy and not undo itself is what refused', async () => {
    const table = await openTable(await loadProject(FENCED));
    expect((await table.act('move'))?.success).toBe(true);
    expect((await table.undo())?.success).toBe(true);
  }, 30_000);

  it('captures no checkpoints when the game turns them off, so there is nothing to undo to', async () => {
    const table = await openTable(await loadProject(NO_CHECKPOINTS));
    expect((await table.act('move'))?.success).toBe(true);

    const undo = await table.undo();
    expect(undo?.success).toBe(false);
    expect(undo?.error).toMatch(/Cannot undo to the start of this turn/);
  }, 30_000);

  it('keeps enforcing the policy after the rules are reloaded', async () => {
    const runtime = await loadProject(FENCED);
    const table = await openTable(runtime);
    expect((await table.act('move'))?.success).toBe(true);

    const outcome = await table.host.reloadRules(runtime.rules);
    expect(outcome?.kind).toBe('restored');

    expect((await table.act('roll'))?.success).toBe(true);
    const undo = await table.undo();
    expect(undo?.success).toBe(false);
    expect(undo?.error).toMatch(/a random draw was consumed there/);
  }, 30_000);
});
