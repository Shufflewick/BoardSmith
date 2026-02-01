/**
 * Tests for LobbyManager and GameSession lobby integration,
 * specifically for player options handling including exclusive options.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LobbyManager } from './lobby-manager.js';
import { GameSession } from './game-session.js';
import { Game, Player, defineFlow, actionStep, Action, type GameOptions } from '../engine/index.js';
import type { LobbySlot, PlayerOptionDefinition, PlayerConfig } from './types.js';

// Test game that captures playerConfigs for verification
let capturedPlayerConfigs: PlayerConfig[] | undefined;

class TestLobbyGame extends Game {
  constructor(options: GameOptions & { playerConfigs?: PlayerConfig[] }) {
    super(options);
    // Capture playerConfigs for test verification
    capturedPlayerConfigs = options.playerConfigs;

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

describe('LobbyManager.computeDefaultPlayerOptions', () => {
  describe('exclusive player options', () => {
    it('should assign exclusive option to last player when default is "last"', () => {
      const definitions: Record<string, PlayerOptionDefinition> = {
        isDictator: {
          type: 'exclusive',
          label: 'Dictator',
          default: 'last',
        },
      };

      const lobbySlots: LobbySlot[] = [
        { seat: 1, status: 'claimed', name: 'Player 1', ready: false },
        { seat: 2, status: 'claimed', name: 'Player 2', ready: false },
        { seat: 3, status: 'claimed', name: 'Player 3', ready: false },
        { seat: 4, status: 'claimed', name: 'Player 4', ready: false },
        { seat: 5, status: 'claimed', name: 'Player 5', ready: false },
      ];

      // Seat 5 (the last player) should get isDictator=true
      const seat5Options = LobbyManager.computeDefaultPlayerOptions(5, definitions, lobbySlots, 5);
      expect(seat5Options.isDictator).toBe(true);

      // Other players should get isDictator=false
      const seat1Options = LobbyManager.computeDefaultPlayerOptions(1, definitions, lobbySlots, 5);
      expect(seat1Options.isDictator).toBe(false);

      const seat4Options = LobbyManager.computeDefaultPlayerOptions(4, definitions, lobbySlots, 5);
      expect(seat4Options.isDictator).toBe(false);
    });

    it('should assign exclusive option to first player when default is "first"', () => {
      const definitions: Record<string, PlayerOptionDefinition> = {
        isLeader: {
          type: 'exclusive',
          label: 'Leader',
          default: 'first',
        },
      };

      const lobbySlots: LobbySlot[] = [
        { seat: 1, status: 'claimed', name: 'Player 1', ready: false },
        { seat: 2, status: 'claimed', name: 'Player 2', ready: false },
        { seat: 3, status: 'claimed', name: 'Player 3', ready: false },
      ];

      // Seat 1 (the first player) should get isLeader=true
      const seat1Options = LobbyManager.computeDefaultPlayerOptions(1, definitions, lobbySlots, 3);
      expect(seat1Options.isLeader).toBe(true);

      // Other players should get isLeader=false
      const seat2Options = LobbyManager.computeDefaultPlayerOptions(2, definitions, lobbySlots, 3);
      expect(seat2Options.isLeader).toBe(false);

      const seat3Options = LobbyManager.computeDefaultPlayerOptions(3, definitions, lobbySlots, 3);
      expect(seat3Options.isLeader).toBe(false);
    });

    it('should assign exclusive option to specific player when default is a number', () => {
      const definitions: Record<string, PlayerOptionDefinition> = {
        isSpecial: {
          type: 'exclusive',
          label: 'Special',
          default: 2, // 0-indexed, so this is the 3rd player (seat 3)
        },
      };

      const lobbySlots: LobbySlot[] = [
        { seat: 1, status: 'claimed', name: 'Player 1', ready: false },
        { seat: 2, status: 'claimed', name: 'Player 2', ready: false },
        { seat: 3, status: 'claimed', name: 'Player 3', ready: false },
        { seat: 4, status: 'claimed', name: 'Player 4', ready: false },
      ];

      // Seat 3 (0-indexed position 2) should get isSpecial=true
      const seat3Options = LobbyManager.computeDefaultPlayerOptions(3, definitions, lobbySlots, 4);
      expect(seat3Options.isSpecial).toBe(true);

      // Other players should get isSpecial=false
      const seat1Options = LobbyManager.computeDefaultPlayerOptions(1, definitions, lobbySlots, 4);
      expect(seat1Options.isSpecial).toBe(false);

      const seat2Options = LobbyManager.computeDefaultPlayerOptions(2, definitions, lobbySlots, 4);
      expect(seat2Options.isSpecial).toBe(false);

      const seat4Options = LobbyManager.computeDefaultPlayerOptions(4, definitions, lobbySlots, 4);
      expect(seat4Options.isSpecial).toBe(false);
    });

    it('should default to first player when no default is specified', () => {
      const definitions: Record<string, PlayerOptionDefinition> = {
        isChosen: {
          type: 'exclusive',
          label: 'Chosen One',
          // No default specified - should default to 'first'
        },
      };

      const lobbySlots: LobbySlot[] = [
        { seat: 1, status: 'claimed', name: 'Player 1', ready: false },
        { seat: 2, status: 'claimed', name: 'Player 2', ready: false },
      ];

      // Seat 1 should get isChosen=true (defaults to first)
      const seat1Options = LobbyManager.computeDefaultPlayerOptions(1, definitions, lobbySlots, 2);
      expect(seat1Options.isChosen).toBe(true);

      // Seat 2 should get isChosen=false
      const seat2Options = LobbyManager.computeDefaultPlayerOptions(2, definitions, lobbySlots, 2);
      expect(seat2Options.isChosen).toBe(false);
    });
  });

  describe('seat validation', () => {
    it('should throw error for seat < 1', () => {
      const definitions: Record<string, PlayerOptionDefinition> = {};
      const lobbySlots: LobbySlot[] = [];

      expect(() => {
        LobbyManager.computeDefaultPlayerOptions(0, definitions, lobbySlots, 2);
      }).toThrow('Invalid seat 0: seats are 1-indexed (minimum 1)');
    });
  });
});

describe('GameSession lobby integration', () => {
  beforeEach(() => {
    capturedPlayerConfigs = undefined;
  });

  it('should pass playerConfigs to game constructor when game starts from lobby', async () => {
    // Create a session with lobby flow
    const session = GameSession.create<TestLobbyGame>({
      gameType: 'test-lobby',
      GameClass: TestLobbyGame,
      playerCount: 3,
      playerNames: ['Alice', 'Bob', 'Charlie'],
      useLobby: true,
      creatorId: 'creator-123',
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

    // Verify game is in waiting state
    expect(session.isWaitingForPlayers()).toBe(true);

    // Claim seats for all players
    await session.claimSeat(1, 'creator-123', 'Alice');
    await session.claimSeat(2, 'player-2', 'Bob');
    await session.claimSeat(3, 'player-3', 'Charlie');

    // Ready up all players to start the game
    await session.setReady('creator-123', true);
    await session.setReady('player-2', true);
    await session.setReady('player-3', true);

    // Game should have started
    expect(session.isWaitingForPlayers()).toBe(false);

    // Verify playerConfigs were passed to the game constructor
    expect(capturedPlayerConfigs).toBeDefined();
    expect(capturedPlayerConfigs).toHaveLength(3);

    // Player 3 (seat 3, the last player) should have isDictator=true
    expect(capturedPlayerConfigs![2].isDictator).toBe(true);

    // Players 1 and 2 should have isDictator=false
    expect(capturedPlayerConfigs![0].isDictator).toBe(false);
    expect(capturedPlayerConfigs![1].isDictator).toBe(false);
  });

  it('should include player options set in lobby', async () => {
    const session = GameSession.create<TestLobbyGame>({
      gameType: 'test-lobby',
      GameClass: TestLobbyGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      useLobby: true,
      creatorId: 'creator-123',
      playerConfigs: [
        { name: 'Alice' },
        { name: 'Bob' },
      ],
    });

    // Claim seats
    await session.claimSeat(1, 'creator-123', 'Alice');
    await session.claimSeat(2, 'player-2', 'Bob');

    // Set custom player options via the lobby
    await session.updatePlayerOptions('creator-123', { customOption: 'value1' });
    await session.updatePlayerOptions('player-2', { customOption: 'value2' });

    // Ready up to start
    await session.setReady('creator-123', true);
    await session.setReady('player-2', true);

    // Verify playerConfigs contain the custom options
    expect(capturedPlayerConfigs).toBeDefined();
    expect(capturedPlayerConfigs![0].customOption).toBe('value1');
    expect(capturedPlayerConfigs![1].customOption).toBe('value2');
  });
});
