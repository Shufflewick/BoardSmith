/**
 * Regression tests for F10 (security/high):
 *   "WebSocket identity is self-asserted via URL params; playerId is also
 *    broadcast in lobby state."
 *
 * Two impersonation paths are covered:
 *   1. Identity leak — getLobbyInfo() must never expose another player's
 *      playerId (a per-seat capability) nor the creator's secret id.
 *   2. Self-asserted seat — resolveSeatForPlayer() must derive a seat ONLY
 *      from an authenticated playerId, never from a guessed/absent id.
 *
 * Both assertions FAIL against the pre-fix behavior (slots carried every
 * playerId, LobbyInfo carried creatorId, and the WS upgrade trusted ?player=N).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameSession } from './game-session.js';
import {
  Game,
  defineFlow,
  actionStep,
  Action,
  type GameOptions,
} from '../engine/index.js';
import type { PlayerConfig } from './types.js';

class TestLobbyGame extends Game {
  constructor(options: GameOptions & { playerConfigs?: PlayerConfig[] }) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(defineFlow({ root: actionStep({ actions: ['pass'] }) }));
  }
}

function createLobby() {
  const session = GameSession.create<TestLobbyGame>({
    gameType: 'test-lobby',
    GameClass: TestLobbyGame,
    playerCount: 3,
    playerNames: ['Alice', 'Bob', 'Charlie'],
    useLobby: true,
    creatorId: 'creator-secret',
    playerConfigs: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }],
    minPlayers: 2,
    maxPlayers: 4,
  });
  return session;
}

describe('F10: lobby identity is not leaked to other clients', () => {
  let session: GameSession<TestLobbyGame>;

  beforeEach(async () => {
    session = createLobby();
    await session.claimSeat(1, 'creator-secret', 'Alice');
    await session.claimSeat(2, 'victim-secret', 'Bob');
  });

  it('never exposes the creator/host secret id in LobbyInfo', () => {
    const info = session.getLobbyInfo('victim-secret')!;
    expect(info).toBeDefined();
    // creatorId must not be present on the client-facing payload at all.
    expect((info as Record<string, unknown>).creatorId).toBeUndefined();
    // The host is still identifiable via a non-identifying boolean.
    const hostSlot = info.slots.find(s => s.seat === 1)!;
    expect(hostSlot.isHost).toBe(true);
    const nonHostSlot = info.slots.find(s => s.seat === 2)!;
    expect(nonHostSlot.isHost).toBe(false);
  });

  it('masks every other player\'s playerId, exposing only the viewer\'s own', () => {
    // Bob is the viewer: only Bob's own slot carries a playerId.
    const bobView = session.getLobbyInfo('victim-secret')!;
    const bobOwn = bobView.slots.find(s => s.seat === 2)!;
    const bobOthers = bobView.slots.filter(s => s.seat !== 2);
    expect(bobOwn.playerId).toBe('victim-secret');
    for (const slot of bobOthers) {
      expect(slot.playerId).toBeUndefined();
    }
    // Critically, Alice (the creator) cannot learn Bob's secret from her view.
    const aliceView = session.getLobbyInfo('creator-secret')!;
    const aliceSeesBob = aliceView.slots.find(s => s.seat === 2)!;
    expect(aliceSeesBob.playerId).toBeUndefined();
  });

  it('strips all playerIds for an anonymous/spectator view', () => {
    const anon = session.getLobbyInfo()!;
    for (const slot of anon.slots) {
      expect(slot.playerId).toBeUndefined();
    }
    expect((anon as Record<string, unknown>).creatorId).toBeUndefined();
  });
});

describe('F10: seat is resolved only from an authenticated identity', () => {
  let session: GameSession<TestLobbyGame>;

  beforeEach(async () => {
    session = createLobby();
    await session.claimSeat(1, 'creator-secret', 'Alice');
    await session.claimSeat(2, 'victim-secret', 'Bob');
  });

  it('returns the real seat for a known playerId', () => {
    expect(session.resolveSeatForPlayer('creator-secret')).toBe(1);
    expect(session.resolveSeatForPlayer('victim-secret')).toBe(2);
  });

  it('returns spectator (-1) for an unknown or missing playerId', () => {
    // An attacker who did not claim a seat cannot be granted one.
    expect(session.resolveSeatForPlayer('attacker-guess')).toBe(-1);
    expect(session.resolveSeatForPlayer(undefined)).toBe(-1);
    expect(session.resolveSeatForPlayer('')).toBe(-1);
  });
});

describe('F10: non-lobby games still resolve seats from registered playerIds', () => {
  it('maps a registered playerId to its index and rejects unknowns', () => {
    const session = GameSession.create<TestLobbyGame>({
      gameType: 'test-lobby',
      GameClass: TestLobbyGame,
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      playerIds: ['alice-id', 'bob-id'],
    });
    expect(session.resolveSeatForPlayer('alice-id')).toBe(0);
    expect(session.resolveSeatForPlayer('bob-id')).toBe(1);
    expect(session.resolveSeatForPlayer('intruder')).toBe(-1);
  });
});
