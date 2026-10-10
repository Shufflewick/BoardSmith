/**
 * Regression test for CR-02 (phase 131 review): `Game.toJSON()` must emit
 * COPIES of `messages`, `settings`, `_visibility` and `_zoneVisibility`,
 * never live references.
 *
 * Before the fix, `toJSON()` returned `messages: this.messages` and
 * `settings: this.settings` by reference (and `game-element.ts` /
 * `space.ts` emitted the live `_visibility` / `_zoneVisibility` objects).
 * `createActionCheckpoint`/`createSnapshot` store the result as-is, and the
 * in-process undo/rewind/time-travel paths never JSON-round-trip it, so:
 *
 *   1. every retained checkpoint shared ONE settings object and ONE messages
 *      array with the live game — post-checkpoint mutations retroactively
 *      corrupted "frozen" checkpoints; and
 *   2. undo/rewind silently failed to roll back `game.message()` output,
 *      `game.settings` (which backs `actionTempState()`/`persistentMap()`/
 *      `settings.winners`), and in-place visibility grants
 *      (`addVisibleTo`/`addZoneVisibleTo`/`hideContentsFrom`).
 *
 * DELIBERATELY no JSON.stringify round-trips in these tests — the cold
 * paths deep-copy incidentally, which is exactly what masked the bug.
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  actionStep,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/index.js';
import { createHeadlessSession } from '../../session/headless-session.js';

class Card extends Piece<AliasGame> {}
class Zone extends Space<AliasGame> {}

class AliasGame extends Game<AliasGame, Player> {
  zone!: Zone;

  constructor(options: GameOptions) {
    super(options);

    this.zone = this.create(Zone, 'zone');
    this.zone.contentsHidden();
    this.zone.create(Card, 'card');

    this.registerAction(Action.create('noop').execute(() => ({ success: true })));
    this.registerAction(
      Action.create('logAndStash').execute((_args, ctx) => {
        const game = ctx.game as AliasGame;
        game.message('a message logged by an undone action');
        game.settings.stash = { nested: 'undone-value' };
        return { success: true };
      })
    );
    this.registerAction(
      Action.create('grantVisibility').execute((_args, ctx) => {
        const game = ctx.game as AliasGame;
        // In-place mutations of _zoneVisibility / _visibility (CR-02 point 3).
        game.zone.addZoneVisibleTo(2);
        game.zone.first(Card)?.addVisibleTo(2);
        return { success: true };
      })
    );

    this.setFlow(
      {
        root: actionStep({
          actions: ['noop', 'logAndStash', 'grantVisibility'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      }
    );
  }
}

function buildRunner(): GameRunner<AliasGame> {
  const runner = new GameRunner<AliasGame>({
    GameClass: AliasGame,
    gameType: 'checkpoint-aliasing-test',
    gameOptions: { playerCount: 2, seed: 'alias-seed' },
  });
  runner.start();
  return runner;
}

/**
 * A started two-seat table on the host every platform runs, driven in process:
 * its ops hand snapshots and checkpoints around as live objects, never as JSON.
 *
 * The host rebuilds the game from its snapshot on every op, so a checkpoint
 * there is never shared with the game a later op mutates. The two undo tests
 * that use it hold the rollback itself; the copy guarantee CR-02 is about is
 * held by the three `toJSON()`/`fromSnapshot` tests above them.
 */
async function startAliasSession() {
  const session = createHeadlessSession(
    { gameClass: AliasGame, gameType: 'checkpoint-aliasing-test', minPlayers: 2, maxPlayers: 2 },
    { playerCount: 2, seed: 'alias-seed' },
  );
  await session.start();
  return session;
}

describe('CR-02: toJSON emits copies — checkpoints do not alias live game state', () => {
  it('a retained toJSON()/messageLog pair is immune to later live mutations', () => {
    const runner = buildRunner();
    const checkpoint = runner.game.toJSON();
    // The log is no longer part of the tree — it is serialized separately (see
    // GameStateSnapshot.messageLog). Both still have to be COPIES.
    const frozenLog = runner.game.serializeMessageLog();
    const messagesBefore = frozenLog.length;

    const result = runner.performAction('logAndStash', 1, {});
    expect(result.success).toBe(true);
    expect(runner.game.messages.length).toBe(messagesBefore + 1);
    expect(runner.game.settings.stash).toEqual({ nested: 'undone-value' });

    // Both were "frozen" before the action — neither must have moved.
    expect(frozenLog.length).toBe(messagesBefore);
    expect(checkpoint.settings.stash).toBeUndefined();
  });

  it('a retained toJSON() result is immune to later in-place visibility grants', () => {
    const runner = buildRunner();
    const checkpoint = runner.game.toJSON();
    const zoneJson = checkpoint.children?.find((c) => c.name === 'zone');
    expect(zoneJson?.zoneVisibility?.addPlayers).toBeUndefined();

    const result = runner.performAction('grantVisibility', 1, {});
    expect(result.success).toBe(true);

    // Live game changed; the frozen checkpoint must not have.
    expect(runner.game.zone.getZoneVisibility()?.addPlayers).toEqual([2]);
    expect(zoneJson?.zoneVisibility?.addPlayers).toBeUndefined();
    const cardJson = zoneJson?.children?.find((c) => c.name === 'card');
    expect(cardJson?.visibility?.addPlayers).toBeUndefined();
  });

  it('a restored game does not share mutable state with the snapshot it was restored from', () => {
    const runner = buildRunner();
    runner.performAction('logAndStash', 1, {});

    // NO JSON round-trip: restore directly from the in-memory snapshot.
    const snapshot = runner.getSnapshot();
    const restored = GameRunner.fromSnapshot<AliasGame>(snapshot, AliasGame);
    const snapshotMessages = snapshot.messageLog!.length;

    restored.game.message('mutation on the restored game');
    (restored.game.settings.stash as { nested: string }).nested = 'mutated-after-restore';

    // The snapshot must still read as it did when taken — including its log,
    // which is now a sibling of `state` rather than a field inside it. The
    // aliasing hazard is identical: `fromSnapshot` hands the array to the
    // restored game, so it has to be a copy on one side or the other.
    const state = snapshot.state as ReturnType<AliasGame['toJSON']>;
    expect(snapshot.messageLog!.length).toBe(snapshotMessages);
    expect((state.settings.stash as { nested: string }).nested).toBe('undone-value');
  });

  it('undo rolls back game.message() output and settings mutations (in-process host, no JSON round-trip)', async () => {
    const session = await startAliasSession();
    const messagesBefore = session.readGame().messages.length;

    const actionResult = await session.send(1, { type: 'action', actionName: 'logAndStash', player: 1, args: {} });
    expect(actionResult.success).toBe(true);
    expect(session.readGame().messages.length).toBe(messagesBefore + 1);
    expect(session.readGame().settings.stash).toBeDefined();

    const undoResult = await session.send(1, { type: 'undo', player: 1 });
    expect(undoResult.success).toBe(true);

    // Both the message and the settings mutation from the undone action must
    // be gone — before the fix they survived (the checkpoint aliased them).
    expect(session.readGame().messages.length).toBe(messagesBefore);
    expect(session.readGame().settings.stash).toBeUndefined();
  });

  it('undo rolls back an in-place zone-visibility grant (in-process host, no JSON round-trip)', async () => {
    const session = await startAliasSession();

    const actionResult = await session.send(1, { type: 'action', actionName: 'grantVisibility', player: 1, args: {} });
    expect(actionResult.success).toBe(true);
    expect(session.readGame().zone.getZoneVisibility()?.addPlayers).toEqual([2]);

    const undoResult = await session.send(1, { type: 'undo', player: 1 });
    expect(undoResult.success).toBe(true);

    // The grant from the undone action must be rolled back — seat 2 must not
    // see the hidden zone's contents after undo.
    expect(session.readGame().zone.getZoneVisibility()?.addPlayers ?? []).not.toContain(2);
  });
});
