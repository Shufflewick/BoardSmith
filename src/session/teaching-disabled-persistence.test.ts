/**
 * RST-02 / F16: `teachingDisabled` and `displayName` must survive
 * `GameSession.restore()`.
 *
 * F16 (LEGITIMATE per 131-FINDINGS-VERIFICATION.md): `StoredGameState` has
 * no field for either value, so `restore()`'s constructor call passes
 * `undefined` for both, silently re-enabling teaching features (hints,
 * heatmaps, AI-vs-AI demo) after any process restart or cold restore —
 * a LOCK-01 anti-cheat regression.
 *
 * Uses the `restore-snapshot-authoritative.test.ts` async
 * create/snapshot/JSON-round-trip/restore harness (BL-01 style). Scoped to
 * `GameSession` consumers only — no `SnapshotSessionHost`/`boardsmith dev`
 * wiring (Pitfall 2 of 131-RESEARCH.md).
 */

import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';
import type { StorageAdapter, StoredGameState } from './types.js';

class LockGame extends Game<LockGame, Player> {
  constructor(options: GameOptions) {
    super(options);

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

class RoundTripStorage implements StorageAdapter {
  saved: string | null = null;
  async save(state: StoredGameState): Promise<void> {
    this.saved = JSON.stringify(state);
  }
  async load(): Promise<StoredGameState | null> {
    return this.saved ? (JSON.parse(this.saved) as StoredGameState) : null;
  }
}

async function buildLockedSession() {
  const storage = new RoundTripStorage();
  const session = GameSession.create<LockGame>({
    gameType: 'lock-test',
    GameClass: LockGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'rst02-seed',
    storage,
    teachingDisabled: true,
    displayName: 'Locked Test Table',
  });

  // create()'s initial snapshot predates nothing here, but re-snapshot +
  // save explicitly to mirror the BL-01 cold-restart pattern exactly.
  session.storedState.snapshot = session.runner.getSnapshot();
  await storage.save(session.storedState);

  return { session, storage };
}

describe('RST-02: teachingDisabled/displayName survive GameSession.restore()', () => {
  it('teachingDisabled: true set at create() is still true after restore()', async () => {
    const { storage } = await buildLockedSession();
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();

    const restored = GameSession.restore<LockGame>(loaded!, LockGame);

    // requestHint is one of the four teach/assist ops gated by teachingDisabled
    // (LOCK-01, D-01) and is async, so the throw surfaces as a rejection. If
    // the lockout survived restore, this must still reject.
    await expect(restored.requestHint(1)).rejects.toThrow(/Teaching features are disabled/);
  });

  it('displayName set at create() survives restore()', async () => {
    const { storage } = await buildLockedSession();
    const loaded = await storage.load();

    const restored = GameSession.restore<LockGame>(loaded!, LockGame);

    expect(restored.displayName).toBe('Locked Test Table');
  });

  it('documents the pre-fix behavior: teachingDisabled getter reflects lockout state directly on the live (pre-restore) session', async () => {
    // Sanity: the live session created with teachingDisabled: true correctly
    // reports the lockout BEFORE any restore — proving the create()-side of
    // the round-trip works and isolating the bug to the restore() path.
    const { session } = await buildLockedSession();
    expect(session.teachingDisabled).toBe(true);
    expect(session.displayName).toBe('Locked Test Table');
  });
});
