/**
 * Tests that playerConfigs survives GameSession.restore() for lobby games.
 *
 * Bug: After HMR or server restart, storedState.gameOptions only contained
 * host-level options (not playerConfigs). The constructor ran without
 * playerConfigs, so constructor-time logic (e.g. setting up AI flags,
 * roles like isDictator) produced wrong results. MCTS clones then
 * captured these incomplete options via getConstructorOptions(), causing
 * flow divergence in simulations.
 *
 * Fix: GameSession now reconstructs playerConfigs from lobbySlots in all
 * game reconstruction paths (restore, HMR dev transfer, HMR replay,
 * checkpoint restore).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameSession } from './game-session.js';
import { Game, Player, defineFlow, actionStep, Action, type GameOptions } from '../engine/index.js';
import type { PlayerConfig, PlayerOptionDefinition } from './types.js';

// Track what playerConfigs the constructor received
let capturedPlayerConfigs: PlayerConfig[] | undefined;

class RestoreTestGame extends Game {
  leaderSeat: number = -1;

  constructor(options: GameOptions & { playerConfigs?: PlayerConfig[] }) {
    super(options);
    capturedPlayerConfigs = options.playerConfigs;

    if (options.playerConfigs) {
      const leader = options.playerConfigs.find(c => (c as any).isDictator === true);
      if (leader) {
        this.leaderSeat = options.playerConfigs.indexOf(leader) + 1;
      }
    }

    this.registerAction(
      Action.create('pass')
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: actionStep({ actions: ['pass'] }),
    }));
  }
}

describe('playerConfigs survives GameSession.restore()', () => {
  beforeEach(() => {
    capturedPlayerConfigs = undefined;
  });

  it('should reconstruct playerConfigs from lobbySlots on restore', async () => {
    // Create a lobby game with exclusive player option (like MERC's isDictator)
    const session = GameSession.create<RestoreTestGame>({
      gameType: 'restore-test',
      GameClass: RestoreTestGame,
      playerCount: 3,
      playerNames: ['Alice', 'Bob', 'Charlie'],
      useLobby: true,
      creatorId: 'creator-1',
      playerConfigs: [
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ],
      playerOptionsDefinitions: {
        isDictator: {
          type: 'exclusive',
          label: 'Dictator',
          default: 'last',
        },
      },
    });

    // Start the game through the lobby flow
    await session.claimSeat(1, 'creator-1', 'Alice');
    await session.claimSeat(2, 'player-2', 'Bob');
    await session.claimSeat(3, 'player-3', 'Charlie');
    await session.setReady('creator-1', true);
    await session.setReady('player-2', true);
    await session.setReady('player-3', true);

    // Game should be playing now
    expect(session.isWaitingForPlayers()).toBe(false);

    // Verify the original game got playerConfigs with isDictator on last player
    expect(capturedPlayerConfigs).toBeDefined();
    expect(capturedPlayerConfigs![2].isDictator).toBe(true);
    expect(capturedPlayerConfigs![0].isDictator).toBe(false);

    const originalGame = session.runner.game as RestoreTestGame;
    expect(originalGame.leaderSeat).toBe(3);

    // Verify getConstructorOptions includes playerConfigs
    const constructorOpts = originalGame.getConstructorOptions();
    expect(constructorOpts.playerConfigs).toBeDefined();

    // Now simulate restore (like server restart or HMR replay)
    capturedPlayerConfigs = undefined;
    const storedState = session.storedState;

    const restored = GameSession.restore<RestoreTestGame>(
      storedState,
      RestoreTestGame,
    );

    // The restored game's constructor should have received playerConfigs
    expect(capturedPlayerConfigs).toBeDefined();
    expect(capturedPlayerConfigs).toHaveLength(3);
    expect(capturedPlayerConfigs![2].isDictator).toBe(true);
    expect(capturedPlayerConfigs![0].isDictator).toBe(false);

    const restoredGame = restored.runner.game as RestoreTestGame;
    expect(restoredGame.leaderSeat).toBe(3);

    // And getConstructorOptions on the restored game should also have playerConfigs
    const restoredOpts = restoredGame.getConstructorOptions();
    expect(restoredOpts.playerConfigs).toBeDefined();
    expect((restoredOpts.playerConfigs as any[])[2].isDictator).toBe(true);
  });

  it('should not add playerConfigs for non-lobby games', () => {
    // Non-lobby game (e.g., --ai mode or direct creation)
    const session = GameSession.create<RestoreTestGame>({
      gameType: 'restore-test',
      GameClass: RestoreTestGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
    });

    capturedPlayerConfigs = undefined;
    const storedState = session.storedState;

    const restored = GameSession.restore<RestoreTestGame>(
      storedState,
      RestoreTestGame,
    );

    // No lobbySlots → no playerConfigs reconstruction
    expect(capturedPlayerConfigs).toBeUndefined();
  });

  it('should not add playerConfigs for lobby games still in waiting state', () => {
    // Lobby game that hasn't started yet (still waiting for players)
    const session = GameSession.create<RestoreTestGame>({
      gameType: 'restore-test',
      GameClass: RestoreTestGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      useLobby: true,
      creatorId: 'creator-1',
      playerConfigs: [
        { name: 'Alice' },
        { name: 'Bob' },
      ],
    });

    expect(session.isWaitingForPlayers()).toBe(true);

    capturedPlayerConfigs = undefined;
    const storedState = session.storedState;

    const restored = GameSession.restore<RestoreTestGame>(
      storedState,
      RestoreTestGame,
    );

    // Game is still in waiting state → don't reconstruct playerConfigs
    // (the onGameStart callback will handle it when the game actually starts)
    expect(capturedPlayerConfigs).toBeUndefined();
  });
});
