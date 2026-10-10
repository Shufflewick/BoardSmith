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
import { beforeEach, describe, expect, it } from 'vitest';

import { openTable, tableProject } from './table-host.test-helper.js';
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
    "import { Action, Game, Player, actionStep, type GameOptions } from 'boardsmith';",
    'export class PolicyGame extends Game<PolicyGame, Player> {',
    '  moves = 0;',
    '  lastRoll = 0;',
    '  constructor(options: GameOptions) {',
    '    super(options);',
    "    this.registerAction(Action.create('move').execute(() => { this.moves += 1; }));",
    "    this.registerAction(Action.create('roll').execute(() => { this.lastRoll = this.random(); }));",
    '    this.setFlow({',
    "      root: actionStep({ actions: ['move', 'roll'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false }),",
    '    });',
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

async function openPolicyTable(policy: string) {
  const runtime = await tableProject('bs-table-undo-policy-', rulesSource(policy)).load();
  const table = await openTable(runtime, clients, { makeSeed: () => 'undo-policy' });
  return { ...table, runtime, undo: () => table.ask('undo', {}) };
}

/** Undo, and expect the host to refuse it with `reason`. */
async function expectUndoRefused(table: Awaited<ReturnType<typeof openPolicyTable>>, reason: RegExp) {
  const undo = await table.undo();
  expect(undo?.success).toBe(false);
  expect(undo?.error).toMatch(reason);
}

const FENCED = 'undo: { fenceRandomRewind: true },';
const NO_CHECKPOINTS = 'checkpoints: { enabled: false },';

describe('#361: the table dev host enforces the game definition', () => {
  it("refuses an undo across a random draw when the game's undo policy fences it", async () => {
    const table = await openPolicyTable(FENCED);
    expect((await table.act('roll'))?.success).toBe(true);

    await expectUndoRefused(table, /a random draw was consumed since the point being restored/);
  }, 30_000);

  it('still allows an undo the fence does not cover, so the policy and not undo itself is what refused', async () => {
    const table = await openPolicyTable(FENCED);
    expect((await table.act('move'))?.success).toBe(true);
    expect((await table.undo())?.success).toBe(true);
  }, 30_000);

  it('captures no checkpoints when the game turns them off, so there is nothing to undo to', async () => {
    const table = await openPolicyTable(NO_CHECKPOINTS);
    expect((await table.act('move'))?.success).toBe(true);

    await expectUndoRefused(table, /Cannot undo to the start of this turn/);
  }, 30_000);

  it('keeps enforcing the policy after the rules are reloaded', async () => {
    const table = await openPolicyTable(FENCED);
    expect((await table.act('move'))?.success).toBe(true);

    const outcome = await table.host.reloadRules(table.runtime.rules);
    expect(outcome?.kind).toBe('restored');

    expect((await table.act('roll'))?.success).toBe(true);
    await expectUndoRefused(table, /a random draw was consumed since the point being restored/);
  }, 30_000);
});
