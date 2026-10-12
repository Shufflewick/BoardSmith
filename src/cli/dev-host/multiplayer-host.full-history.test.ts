/**
 * #504: `boardsmith dev` KEEPS THE FULL CHECKPOINT HISTORY.
 *
 * A hosted table keeps checkpoints only back to the turn start. The dev host
 * keeps every one, so time travel reaches the first action, and it does so
 * whether or not debugging is on: with two people at the table debugging is
 * off (`MultiplayerHost.debugOn`), and the history must not be pruned then
 * only to be missing when one of them leaves and debugging comes back.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Action, Game, Player, actionStep, eachPlayer, loop, type GameOptions } from '../../engine/index.js';
import { executeOp, type GameDefinitionLike } from '../../session/index.js';
import type { GameStateSnapshot } from '../../runtime/index.js';
import { MultiplayerHost } from './multiplayer-host.js';
import { createDevHostClientMemory } from './test-client-memory.js';

const clients = createDevHostClientMemory();
beforeEach(() => clients.reset());

/** Two seats taking one-action turns: the default would keep one checkpoint. */
class PassGame extends Game<PassGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({ maxIterations: 50, do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }) }),
    });
  }
}

const passDef = {
  gameClass: PassGame,
  gameType: 'pass-history',
  minPlayers: 2,
  maxPlayers: 2,
} satisfies GameDefinitionLike;

describe('#504: the dev host keeps full checkpoint history', () => {
  it('keeps every checkpoint at a two-person table, where debugging is off', async () => {
    let last: GameStateSnapshot | undefined;
    const debugFlags = new Set<boolean | undefined>();
    const host = new MultiplayerHost({
      playerCount: 2,
      minPlayers: 2,
      maxPlayers: 2,
      makeSeed: () => 'history',
      executeOp: async (gameOptions, snap, pend, op, hostOptions) => {
        debugFlags.add(hostOptions?.debug);
        const result = await executeOp(passDef, gameOptions, snap, pend, op, hostOptions);
        if (result.success && 'snapshot' in result) last = result.snapshot;
        return result;
      },
      send: (clientId, msg) => clients.remember(clientId, msg),
    });
    await host.handleMessage('A', { type: 'hello' });
    await host.handleMessage('B', { type: 'join', seat: 2, name: 'B' });

    const PASSES = 6;
    for (let i = 0; i < PASSES; i++) {
      const seat = i % 2 === 0 ? 'A' : 'B';
      await host.handleMessage(seat, {
        type: 'server_request',
        requestId: `pass-${i}`,
        op: 'action',
        payload: { actionName: 'pass', args: {}, boundaryKey: clients.key(seat) },
      });
    }

    expect(last!.actionHistory).toHaveLength(PASSES);
    expect(last!.actionCheckpoints!.baseIndex).toBe(0);
    expect(last!.actionCheckpoints!.entries).toHaveLength(PASSES + 1);
    // Debugging was off for these ops: the history is the dev host's own choice.
    expect(debugFlags.has(false)).toBe(true);
  });
});
