/**
 * Tests for MCTS game clone constructor options preservation.
 *
 * This verifies that when MCTS clones a game for simulation, the cloned game
 * receives the same constructor options as the original (including custom
 * options like playerConfigs).
 *
 * Bug report: MERC team reported that MCTS clones receive empty playerConfigs,
 * causing player roles to be assigned incorrectly in simulations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

// Test game that uses custom constructor options (like playerConfigs)
interface TestPlayerConfig {
  name: string;
  isLeader?: boolean;
}

interface TestGameOptions extends GameOptions {
  playerConfigs?: TestPlayerConfig[];
}

let capturedPlayerConfigs: TestPlayerConfig[] | undefined;

class ConfigTestGame extends Game {
  leaderSeat: number = -1;

  constructor(options: TestGameOptions) {
    super(options);
    capturedPlayerConfigs = options.playerConfigs;

    // If playerConfigs specifies a leader, store which seat is the leader
    if (options.playerConfigs) {
      const leaderConfig = options.playerConfigs.find(c => c.isLeader);
      if (leaderConfig) {
        const leaderIndex = options.playerConfigs.indexOf(leaderConfig);
        this.leaderSeat = leaderIndex + 1; // 1-indexed seats
      }
    }

    // Simple pass action
    this.registerAction(
      Action.create('pass')
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: actionStep({ actions: ['pass'] }),
    }));
  }
}

describe('MCTS Game Clone Constructor Options', () => {
  beforeEach(() => {
    capturedPlayerConfigs = undefined;
  });

  it('should preserve playerConfigs in MCTS game clones', () => {
    // Create game with custom playerConfigs (like MERC's dictator config)
    const playerConfigs: TestPlayerConfig[] = [
      { name: 'Player 1', isLeader: true },
      { name: 'Player 2', isLeader: false },
    ];

    const game = new ConfigTestGame({
      playerCount: 2,
      playerNames: ['Player 1', 'Player 2'],
      seed: 'test-seed',
      playerConfigs,
    });
    game.startFlow();

    // Verify original game received playerConfigs
    expect(capturedPlayerConfigs).toEqual(playerConfigs);
    expect(game.leaderSeat).toBe(1);

    // Create MCTS bot and capture snapshot
    const bot = new MCTSBot(
      game,
      ConfigTestGame,
      'config-test',
      1,
      [],
      { iterations: 1, playoutDepth: 1 }
    );

    // Access private methods for testing
    const snapshot = (bot as any).captureSnapshot();
    expect(snapshot.gameOptions).toBeDefined();
    expect(snapshot.gameOptions.playerConfigs).toEqual(playerConfigs);

    // Reset captured configs to verify restoration
    capturedPlayerConfigs = undefined;

    // Restore game from snapshot
    const restoredGame = (bot as any).restoreGame(snapshot) as ConfigTestGame;

    // Verify restored game received the same playerConfigs
    expect(capturedPlayerConfigs).toEqual(playerConfigs);
    expect(restoredGame.leaderSeat).toBe(1);
  });

  it('should preserve complex nested options in MCTS game clones', () => {
    // Test with more complex nested options
    const playerConfigs: TestPlayerConfig[] = [
      { name: 'Dictator', isLeader: true },
      { name: 'Rebel 1', isLeader: false },
      { name: 'Rebel 2', isLeader: false },
      { name: 'Rebel 3', isLeader: false },
      { name: 'Rebel 4', isLeader: false },
    ];

    const game = new ConfigTestGame({
      playerCount: 5,
      playerNames: playerConfigs.map(c => c.name),
      seed: 'merc-seed',
      playerConfigs,
    });
    game.startFlow();

    // Verify original game setup
    expect(game.leaderSeat).toBe(1);
    expect(capturedPlayerConfigs).toHaveLength(5);
    expect(capturedPlayerConfigs![0].isLeader).toBe(true);
    expect(capturedPlayerConfigs![4].isLeader).toBe(false);

    // Create MCTS bot
    const bot = new MCTSBot(
      game,
      ConfigTestGame,
      'config-test',
      5, // Last player (should be Rebel in original, Rebel in clone too)
      [],
      { iterations: 1, playoutDepth: 1 }
    );

    // Reset and restore
    capturedPlayerConfigs = undefined;

    const snapshot = (bot as any).captureSnapshot();
    const restoredGame = (bot as any).restoreGame(snapshot) as ConfigTestGame;

    // Verify clone has correct leader assignment
    expect(restoredGame.leaderSeat).toBe(1); // Still player 1, not player 5
    expect(capturedPlayerConfigs).toHaveLength(5);
    expect(capturedPlayerConfigs![0].isLeader).toBe(true);
    expect(capturedPlayerConfigs![4].isLeader).toBe(false);
  });

  it('should handle games without custom options (backward compatibility)', () => {
    const game = new ConfigTestGame({
      playerCount: 2,
      playerNames: ['Player 1', 'Player 2'],
      seed: 'test-seed',
    });
    game.startFlow();

    const bot = new MCTSBot(
      game,
      ConfigTestGame,
      'config-test',
      1,
      [],
      { iterations: 1, playoutDepth: 1 }
    );

    const snapshot = (bot as any).captureSnapshot();

    // Simulate old snapshot without gameOptions by deleting it
    const oldSnapshot = { ...snapshot };
    delete oldSnapshot.gameOptions;

    // Reset and restore
    capturedPlayerConfigs = undefined;

    // Should still work (falls back to settings)
    const restoredGame = (bot as any).restoreGame(oldSnapshot);
    expect(restoredGame).toBeDefined();
    expect(restoredGame.players.length).toBe(2);
  });

  it('should include seed in gameOptions', () => {
    const game = new ConfigTestGame({
      playerCount: 2,
      playerNames: ['Player 1', 'Player 2'],
      seed: 'specific-seed-123',
    });
    game.startFlow();

    const bot = new MCTSBot(
      game,
      ConfigTestGame,
      'config-test',
      1,
      [],
      { iterations: 1, playoutDepth: 1 }
    );

    const snapshot = (bot as any).captureSnapshot();

    // Verify seed is in gameOptions
    expect(snapshot.gameOptions).toBeDefined();
    expect(snapshot.gameOptions.seed).toBe('specific-seed-123');
  });
});
