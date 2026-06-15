/**
 * Regression tests for F11 (security/high):
 *   "Lobby 'host only' authorization is bypassable: the host gate compared a
 *    client-supplied playerId against creatorId with a bare `!==`, which fails
 *    OPEN when the identity is empty (`undefined === undefined`, or two empty
 *    strings). A caller that omits playerId on a lobby with no creator bound
 *    (or whose creatorId is empty) passed every host check and could add /
 *    remove slots, flip slots to AI, kick players, and mutate game options."
 *
 * The fix makes the gate FAIL CLOSED: a host action is authorized only when a
 * non-empty creatorId is bound AND the caller presents that exact secret id.
 *
 * Each "must reject" assertion below FAILS against the pre-fix `!==` behavior.
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

function createLobby(creatorId?: string) {
  return GameSession.create<TestLobbyGame>({
    gameType: 'test-lobby',
    GameClass: TestLobbyGame,
    playerCount: 3,
    playerNames: ['Alice', 'Bob', 'Charlie'],
    useLobby: true,
    creatorId,
    playerConfigs: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }],
    minPlayers: 2,
    maxPlayers: 5,
  });
}

describe('F11: host-only gate fails closed on an empty/unbound identity', () => {
  it('rejects host actions when the lobby has no creator bound and the caller omits playerId', async () => {
    const session = createLobby(/* no creatorId */);

    // The exact pre-fix bypass: undefined caller id vs undefined creatorId.
    const added = await session.addSlot(undefined as unknown as string);
    expect(added.success).toBe(false);
    expect(added.error).toBe('Only the host can add slots');

    const removed = await session.removeSlot(undefined as unknown as string, 2);
    expect(removed.success).toBe(false);

    const aiToggled = await session.setSlotAI(undefined as unknown as string, 2, true);
    expect(aiToggled.success).toBe(false);

    const optionsSet = await session.updateGameOptions(undefined as unknown as string, { x: 1 });
    expect(optionsSet.success).toBe(false);
  });

  it('rejects host actions when both creatorId and the caller id are empty strings', async () => {
    const session = createLobby('');

    const added = await session.addSlot('');
    expect(added.success).toBe(false);
    expect(added.error).toBe('Only the host can add slots');
  });

  it('never badges a slot as host when no creator is bound', () => {
    const session = createLobby(/* no creatorId */);
    const info = session.getLobbyInfo()!;
    expect(info.slots.every(s => s.isHost !== true)).toBe(true);
  });
});

describe('F11: host-only gate still authorizes the real host and rejects impostors', () => {
  let session: GameSession<TestLobbyGame>;

  beforeEach(async () => {
    session = createLobby('creator-secret');
    await session.claimSeat(1, 'creator-secret', 'Alice');
    await session.claimSeat(2, 'victim-secret', 'Bob');
  });

  it('authorizes the host presenting the correct secret id', async () => {
    const res = await session.addSlot('creator-secret');
    expect(res.success).toBe(true);
  });

  it('rejects a non-host participant who supplies their own id', async () => {
    const res = await session.kickPlayer('victim-secret', 2);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Only the host can kick players');
  });

  it('rejects a caller who supplies no id even when a creator is bound', async () => {
    const res = await session.updateGameOptions(undefined as unknown as string, { x: 1 });
    expect(res.success).toBe(false);
  });
});
