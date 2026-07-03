/**
 * SEC-04 / F15: `registerDebug()` payloads (`customDebug`) must NOT be
 * present in broadcast/`buildPlayerState` payloads by default.
 *
 * F15 (LEGITIMATE per 131-FINDINGS-VERIFICATION.md): `includeDebugData` is
 * hardcoded `true` at 10 session-layer call sites across game-session.ts,
 * pending-action-manager.ts, and state-history.ts — no session-level
 * opt-out exists, so `registerDebug()` data (Information Disclosure of
 * hidden game state) is broadcast to every player and spectator by default.
 * `stateless-ops.ts` is confirmed already safe (Pitfall 1) and is untouched.
 *
 * Scoped to `GameSession` consumers only — no `SnapshotSessionHost`/
 * `boardsmith dev` wiring (Pitfall 2 of 131-RESEARCH.md).
 */

import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';

const SECRET_VALUE = 'top-secret-deck-order';

class DebugGame extends Game<DebugGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerDebug('secret', () => SECRET_VALUE);

    this.registerAction(Action.create('noop').execute(() => ({ success: true })));

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['noop'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 5,
        }),
      })
    );
  }
}

function buildGame(debugEnabled?: boolean) {
  return GameSession.create<DebugGame>({
    gameType: 'debug-gating-test',
    GameClass: DebugGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'sec04-seed',
    debugEnabled,
  });
}

describe('SEC-04: customDebug absent from player state by default', () => {
  it('buildPlayerState() omits customDebug by default (no debugEnabled option)', () => {
    const session = buildGame();
    const state = session.buildPlayerState(1);
    expect(state.customDebug).toBeUndefined();
  });

  it('getState() omits customDebug by default', () => {
    const session = buildGame();
    const { state } = session.getState(1);
    expect(state?.customDebug).toBeUndefined();
  });

  it('buildPlayerState() includes customDebug when the session is created with debugEnabled: true', () => {
    const session = buildGame(true);
    const state = session.buildPlayerState(1);
    expect(state.customDebug).toEqual({ secret: SECRET_VALUE });
  });
});
