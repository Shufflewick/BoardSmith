/**
 * SEC-04 / F15: `registerDebug()` payloads (`customDebug`) must NOT be
 * present in what a seat or a spectator is sent.
 *
 * F15 found a session host attaching `registerDebug()` data (Information
 * Disclosure of hidden game state) to every player's and every spectator's
 * state. Every host runs `SnapshotSessionHost` over `executeOp`, and this
 * pins that its views carry no
 * `customDebug`, even on a host with debug ops enabled.
 */

import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { createHeadlessSession } from './headless-session.js';

const SECRET_VALUE = 'top-secret-deck-order';

class DebugGame extends Game<DebugGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerDebug('secret', () => SECRET_VALUE);

    this.registerAction(Action.create('noop').execute(() => ({ success: true })));

    this.setFlow(
      {
        root: actionStep({
          actions: ['noop'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 5,
        }),
      }
    );
  }
}

describe('SEC-04: customDebug absent from what the live session host publishes', () => {
  it('no seat and no spectator is sent customDebug, before or after a move', async () => {
    // The headless table runs its host with debug ops enabled: the debug
    // switch must not put the game's registered debug data on the wire.
    const session = createHeadlessSession(
      { gameClass: DebugGame, gameType: 'debug-gating-test', minPlayers: 2, maxPlayers: 2 },
      { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'sec04-seed' },
    );
    await session.start();
    expect((await session.send(1, { type: 'action', actionName: 'noop', player: 1, args: {} })).success).toBe(true);

    expect(session.broadcasts.length).toBeGreaterThan(1);
    for (const published of [...session.broadcasts, ...session.spectatorViews]) {
      expect(JSON.stringify(published)).not.toContain(SECRET_VALUE);
    }
    expect(session.playerState(1).customDebug).toBeUndefined();
  });
});
