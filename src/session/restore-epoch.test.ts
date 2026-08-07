/**
 * B17: `restoreEpoch` — the broadcast "the runner was replaced" signal.
 *
 * `GameSession.replaceRunner` already knows that a checkpoint restore
 * invalidates every piece of state holding element ids from the old runner, and
 * clears its own (hint, heatmap, pending actions). Clients hold state of exactly
 * that kind — an open pick's `validElements` — and had no way to be told.
 *
 * These tests prove the fact is now STATED, and stated in one place:
 *   1. Every seat's broadcast state carries `restoreEpoch`, starting at 0.
 *   2. Undo bumps it. Rewind bumps it. Each restore bumps it again.
 *   3. It is durable: it survives a JSON round-trip cold restart, so a
 *      stateless host (which rebuilds the runner per request) reports the same
 *      epoch rather than resetting to 0 on every op.
 *   4. Plain rehydration (`fromSnapshot` — a cold restart, a stateless request)
 *      does NOT bump it. Only a checkpoint restore does, so a client comparing
 *      epochs can never mistake a reload for an undo.
 *   5. A READ-ONLY time-travel preview does not move the live epoch.
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { GameSession } from './game-session.js';
import type { StorageAdapter, StoredGameState } from './types.js';

class Pawn extends Piece<MoveGame> {}
class Room extends Space<MoveGame> {}

class MoveGame extends Game<MoveGame, Player> {
  rooms: Room[] = [];

  constructor(options: GameOptions) {
    super(options);

    this.rooms = ['bridge', 'engine', 'hold'].map((n) => this.create(Room, n));
    this.rooms[0].create(Pawn, 'pawn');

    this.registerAction(
      Action.create('move')
        .chooseElement('destination', {
          // Every room but the one the pawn is standing in — the answer set an
          // undo invalidates.
          elements: (ctx) => {
            const game = ctx.game as MoveGame;
            const pawn = game.first(Pawn)!;
            return game.rooms.filter((r) => r !== pawn.parent);
          },
        })
        .execute((args, ctx) => {
          const game = ctx.game as MoveGame;
          game.first(Pawn)!.putInto(args.destination as Room);
          return { success: true };
        })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['move'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 20,
        }),
      })
    );
  }

  pawnRoom(): string {
    return this.first(Pawn)!.parent!.name!;
  }
}

/** Persists a JSON round-trip, exactly like a real KV/SQLite adapter. */
class JsonRoundTripStorage implements StorageAdapter {
  saved: string | null = null;
  async save(state: StoredGameState): Promise<void> {
    this.saved = JSON.stringify(state);
  }
  async load(): Promise<StoredGameState | null> {
    return this.saved ? (JSON.parse(this.saved) as StoredGameState) : null;
  }
}

function newSession(storage: StorageAdapter) {
  return GameSession.create<MoveGame>({
    gameType: 'move',
    GameClass: MoveGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'b17-seed',
    storage,
  });
}

describe('B17: restoreEpoch is broadcast on every seat', () => {
  it('starts at 0 for every seat, including spectators', async () => {
    const session = newSession(new JsonRoundTripStorage());
    for (const seat of [0, 1, 2]) {
      expect(session.buildPlayerState(seat).restoreEpoch).toBe(0);
    }
  });

  it('bumps on undo, and again on every further restore', async () => {
    const session = newSession(new JsonRoundTripStorage());

    const moved = await session.performAction('move', 1, { destination: session.runner.game.rooms[1].id });
    expect(moved.success).toBe(true);
    expect(session.runner.game.pawnRoom()).toBe('engine');
    // A completed action does NOT look like a restore.
    expect(session.buildPlayerState(1).restoreEpoch).toBe(0);

    const undo = await session.undoToTurnStart(1);
    expect(undo.success).toBe(true);
    expect(session.runner.game.pawnRoom()).toBe('bridge');
    // The pawn is back where it started AND every seat is told the runner was
    // replaced — the two facts the client needs to keep its open pick honest.
    for (const seat of [0, 1, 2]) {
      expect(session.buildPlayerState(seat).restoreEpoch).toBe(1);
    }

    const moved2 = await session.performAction('move', 1, { destination: session.runner.game.rooms[2].id });
    expect(moved2.success).toBe(true);
    // Playing on does not bump it again — only restores do.
    expect(session.buildPlayerState(1).restoreEpoch).toBe(1);

    const undo2 = await session.undoToTurnStart(1);
    expect(undo2.success).toBe(true);
    expect(session.buildPlayerState(1).restoreEpoch).toBe(2);
  });

  it('bumps on rewind, not just undo', async () => {
    const session = newSession(new JsonRoundTripStorage());
    await session.performAction('move', 1, { destination: session.runner.game.rooms[1].id });
    await session.performAction('move', 1, { destination: session.runner.game.rooms[2].id });
    expect(session.buildPlayerState(1).restoreEpoch).toBe(0);

    const rewind = await session.rewindToAction(0);
    expect(rewind.success).toBe(true);
    expect(session.buildPlayerState(1).restoreEpoch).toBe(1);
  });

  it('survives a cold restart, and a plain restore does not bump it', async () => {
    const storage = new JsonRoundTripStorage();
    const session = newSession(storage);
    await session.performAction('move', 1, { destination: session.runner.game.rooms[1].id });
    await session.undoToTurnStart(1);
    expect(session.buildPlayerState(1).restoreEpoch).toBe(1);

    // Cold restart from the persisted JSON: the epoch is part of the snapshot,
    // so a stateless host that rebuilds the runner per request reports the same
    // number instead of resetting to 0 (which every client would misread as
    // "restored" on the first op and again on the next).
    const loaded = await storage.load();
    const restored = GameSession.restore<MoveGame>(loaded!, MoveGame);
    expect(restored.buildPlayerState(1).restoreEpoch).toBe(1);

    // Rehydrating the SAME snapshot repeatedly is not a restore.
    const again = GameRunner.fromSnapshot(loaded!.snapshot!, MoveGame);
    expect(again.restoreEpoch).toBe(1);
  });

  it('is not moved by a read-only time-travel preview', async () => {
    const session = newSession(new JsonRoundTripStorage());
    await session.performAction('move', 1, { destination: session.runner.game.rooms[1].id });

    const at0 = session.getStateAtAction(0, 1);
    expect(at0.success).toBe(true);

    // Browsing history is not a restore of the live timeline: the live epoch is
    // untouched, so a client scrubbing the log never tears down its open pick.
    expect(session.buildPlayerState(1).restoreEpoch).toBe(0);
  });
});
