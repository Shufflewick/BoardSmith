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

describe('Ready-state preservation across unrelated lobby operations', () => {
  let session: GameSession<TestLobbyGame>;

  beforeEach(async () => {
    capturedPlayerConfigs = undefined;
    session = GameSession.create<TestLobbyGame>({
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
      minPlayers: 2,
      maxPlayers: 4,
    });

    await session.claimSeat(1, 'creator-123', 'Alice');
    await session.claimSeat(2, 'player-2', 'Bob');
    // Leave seat 3 open for join tests
  });

  it('should preserve ready state when another player updates their options', async () => {
    await session.setReady('creator-123', true);

    // Player 2 changes their color
    const result = await session.updatePlayerOptions('player-2', { color: '#ff0000' });
    expect(result.success).toBe(true);

    // Player 1 should still be ready
    const aliceSlot = result.lobby!.slots.find(s => s.playerId === 'creator-123');
    expect(aliceSlot!.ready).toBe(true);
  });

  it('should preserve ready state when a new player joins', async () => {
    await session.setReady('creator-123', true);
    await session.setReady('player-2', true);

    // New player joins seat 3
    const result = await session.claimSeat(3, 'player-3', 'Charlie');

    // Both existing players should still be ready
    const aliceSlot = result.lobby!.slots.find(s => s.playerId === 'creator-123');
    const bobSlot = result.lobby!.slots.find(s => s.playerId === 'player-2');
    expect(aliceSlot!.ready).toBe(true);
    expect(bobSlot!.ready).toBe(true);
  });

  it('should preserve ready state when host changes game options', async () => {
    await session.setReady('player-2', true);

    // Host changes a game option
    const result = await session.updateGameOptions('creator-123', { someOption: 'newValue' });
    expect(result.success).toBe(true);

    // Player 2 should still be ready
    const bobSlot = result.lobby!.slots.find(s => s.playerId === 'player-2');
    expect(bobSlot!.ready).toBe(true);
  });
});

describe('LobbyManager slot limits from game definition', () => {
  it('should enforce maxPlayers from game definition when adding slots', async () => {
    // Create a session with explicit minPlayers/maxPlayers
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
      minPlayers: 2,
      maxPlayers: 3, // Can only have 3 players max
    });

    // Currently have 2 slots, max is 3
    // Adding one more should succeed
    const result1 = await session.addSlot('creator-123');
    expect(result1.success).toBe(true);
    expect(result1.lobby?.slots).toHaveLength(3);

    // Adding another should fail - would exceed maxPlayers
    const result2 = await session.addSlot('creator-123');
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('3');
  });

  it('should enforce minPlayers from game definition when removing slots', async () => {
    // Create a session with explicit minPlayers/maxPlayers
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
      minPlayers: 2, // Must have at least 2 players
      maxPlayers: 4,
    });

    // Currently have 3 slots, min is 2
    // Removing one should succeed (leaves 2)
    const result1 = await session.removeSlot('creator-123', 3);
    expect(result1.success).toBe(true);
    expect(result1.lobby?.slots).toHaveLength(2);

    // Removing another should fail - would go below minPlayers
    const result2 = await session.removeSlot('creator-123', 2);
    expect(result2.success).toBe(false);
    expect(result2.error).toContain('2');
  });

  it('should use game definition limits not hardcoded defaults', async () => {
    // Create a session with a very restrictive maxPlayers (less than the hardcoded 10)
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
      minPlayers: 2,
      maxPlayers: 2, // Only 2 players allowed
    });

    // Should NOT be able to add any slots since we're already at max
    const result = await session.addSlot('creator-123');
    expect(result.success).toBe(false);
    expect(result.error).toContain('2');
  });
});

describe('joinLobby', () => {
  function createLobbySession(playerCount = 3) {
    return GameSession.create<TestLobbyGame>({
      gameType: 'test-lobby',
      GameClass: TestLobbyGame,
      playerCount,
      playerNames: Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`),
      useLobby: true,
      creatorId: 'creator-123',
      playerConfigs: Array.from({ length: playerCount }, (_, i) => ({ name: `Player ${i + 1}` })),
    });
  }

  it('should assign the first open seat', async () => {
    const session = createLobbySession(3);

    // Creator claims seat 1 via claimSeat (host auto-assignment)
    await session.claimSeat(1, 'creator-123', 'Host');

    // Player joins — should get seat 2 (first open)
    const result = await session.joinLobby('player-2', 'Alice');
    expect(result.success).toBe(true);
    expect(result.seat).toBe(2);
    expect(result.lobby).toBeDefined();

    // Verify the slot is claimed
    const slot = result.lobby!.slots.find(s => s.seat === 2);
    expect(slot?.status).toBe('claimed');
    expect(slot?.name).toBe('Alice');
    expect(slot?.playerId).toBe('player-2');
  });

  it('should return error when no open seats available', async () => {
    const session = createLobbySession(2);

    // Fill both seats
    await session.claimSeat(1, 'creator-123', 'Host');
    await session.claimSeat(2, 'player-2', 'Bob');

    // Third player tries to join
    const result = await session.joinLobby('player-3', 'Charlie');
    expect(result.success).toBe(false);
    expect(result.error).toBe('No open seats available');
  });

  it('should return error when player already has a seat', async () => {
    const session = createLobbySession(3);

    await session.claimSeat(1, 'creator-123', 'Host');
    await session.joinLobby('player-2', 'Alice');

    // Same player tries to join again
    const result = await session.joinLobby('player-2', 'Alice Again');
    expect(result.success).toBe(false);
    expect(result.error).toBe('You already have a seat in this lobby');
  });

  it('should assign different seats to two players joining sequentially', async () => {
    const session = createLobbySession(4);

    await session.claimSeat(1, 'creator-123', 'Host');

    // Two players join one after the other (simulates concurrent requests handled sequentially)
    const result1 = await session.joinLobby('player-2', 'Alice');
    const result2 = await session.joinLobby('player-3', 'Bob');

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.seat).toBe(2);
    expect(result2.seat).toBe(3);
    // Different seats
    expect(result1.seat).not.toBe(result2.seat);
  });

  it('should assign default player options and color', async () => {
    const session = GameSession.create<TestLobbyGame>({
      gameType: 'test-lobby',
      GameClass: TestLobbyGame,
      playerCount: 3,
      playerNames: ['Player 1', 'Player 2', 'Player 3'],
      useLobby: true,
      creatorId: 'creator-123',
      playerConfigs: [
        { name: 'Player 1' },
        { name: 'Player 2' },
        { name: 'Player 3' },
      ],
      playerOptionsDefinitions: {
        color: {
          type: 'color',
          label: 'Color',
          choices: [
            { value: 'red', label: 'Red' },
            { value: 'blue', label: 'Blue' },
            { value: 'green', label: 'Green' },
          ],
        },
      },
    });

    // Host claims seat 1 — gets 'red' (first available)
    await session.claimSeat(1, 'creator-123', 'Host');

    // Player joins via joinLobby — should get 'blue' (first untaken)
    const result = await session.joinLobby('player-2', 'Alice');
    expect(result.success).toBe(true);
    const slot = result.lobby!.slots.find(s => s.seat === result.seat);
    expect(slot?.playerOptions?.color).toBe('blue');
  });

  it('should skip AI slots when finding open seats', async () => {
    const session = createLobbySession(4);

    // Host claims seat 1
    await session.claimSeat(1, 'creator-123', 'Host');
    // Host sets seat 2 to AI
    await session.setSlotAI('creator-123', 2, true, 'medium');

    // Player joins — should skip AI seat 2, get seat 3
    const result = await session.joinLobby('player-2', 'Alice');
    expect(result.success).toBe(true);
    expect(result.seat).toBe(3);
  });

  it('should return error when game has already started', async () => {
    const session = createLobbySession(2);

    await session.claimSeat(1, 'creator-123', 'Host');
    await session.claimSeat(2, 'player-2', 'Alice');
    await session.setReady('creator-123', true);
    await session.setReady('player-2', true);

    // Game should have started
    expect(session.isWaitingForPlayers()).toBe(false);

    const result = await session.joinLobby('player-3', 'Bob');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Game has already started');
  });
});
