/**
 * Audit F42: a restore must be SNAPSHOT-AUTHORITATIVE.
 *
 * A host restores game state from its stored snapshot, NOT by replaying the
 * action history. Replay is unsound: selection-step / pending-completed
 * mutations (e.g. a Piece moved inside a repeating selection's onEach) are
 * recorded in neither command nor action history, so replaying an incomplete
 * actionHistory mis-positions the flow and loses those mutations.
 *
 * These run on the live session host: `SnapshotSessionHost.restore` takes back
 * the JSON round-trip of `durableState()` (a cold restart), and every op it then
 * runs rebuilds the game from that snapshot. They prove:
 *   1. A multi-step / repeating-selection action's pending mutations survive a
 *      save -> (JSON round-trip, simulating a cold restart) -> restore EXACTLY.
 *   2. The restored host rebuilds its game with GameRunner.fromSnapshot and
 *      NEVER GameRunner.replay.
 *   3. Undo and time-travel work AFTER restore (they were silently dead when
 *      restore cold-replayed action history, because the per-action undo
 *      checkpoints were never reconstructed).
 *   4. Stored state with NO snapshot fails loud with an actionable error instead
 *      of silently falling back to unsound replay.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  loop,
  eachPlayer,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { createHeadlessSession } from './headless-session.js';
import { SnapshotSessionHost, type SnapshotHostState } from './snapshot-session-host.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { runnerFromSnapshot } from './runner-from-snapshot.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { succeeded } from './op-result.test-helper.js';
import type { PlayerGameState } from './types.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';
// The test game is a repeating selection whose onEach moves pieces. The moves
// happen DURING the multi-step selection (not in execute), so they are exactly
// the kind of "pending mutation" that action-history replay cannot reproduce.
import { RepeatingCollectGame as CollectGame, Token } from './testing/fixtures/repeating-collect-fixture.js';

/** What a store hands back after a cold restart: a JSON round-trip of what the host persisted. */
function coldStored(state: SnapshotHostState): SnapshotHostState {
  return JSON.parse(JSON.stringify(state)) as SnapshotHostState;
}

/**
 * A host restored in a fresh process from `state`, running `def` with debug ops
 * on, and the seat views it publishes. It is restored without the pages' views,
 * so it publishes the first views it builds itself, after its next op.
 */
function restoredHost(def: GameDefinitionLike, options: Parameters<typeof executeOp>[1], state: SnapshotHostState) {
  const published: Array<Array<{ state: PlayerGameState }>> = [];
  const host = SnapshotSessionHost.restore(
    {
      playerCount: options.playerCount,
      debug: true,
      executeOp: (snap, pend, op) => executeOp(def, options, snap, pend, op, { debug: true }),
      record: (views) => published.push(views.players as Array<{ state: PlayerGameState }>),
      push: () => {},
    },
    { ...state, botSeats: [] },
  );
  return { host, published };
}

const collectDef = { gameClass: CollectGame, gameType: 'collect', minPlayers: 2, maxPlayers: 2 } satisfies GameDefinitionLike;
const collectOptions = { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'f42-seed' };

async function buildPlayedSession() {
  const session = createHeadlessSession(collectDef, collectOptions);
  await session.start();

  // Drive one full multi-step 'collect': pick p1, pick p2, then stop. The two
  // picks move p1 and p2 into the hand via onEach before execute() runs.
  const pick = (value: string) =>
    session.send(1, { type: 'selectionStep', player: 1, selectionName: 'token', value, actionName: 'collect' });
  expect((await pick('p1')).success).toBe(true);
  expect((await pick('p2')).success).toBe(true);
  const done = succeeded(await pick('stop'));
  expect(done.actionComplete).toBe(true);

  return { session, stored: coldStored(session.host.durableState()) };
}

function tokenNames(space: Space<CollectGame>): string[] {
  return space
    .all(Token)
    .map((t) => t.name)
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe('F42: a restored SnapshotSessionHost is snapshot-authoritative', () => {
  it('persists a snapshot and reconstructs the exact post-multi-step state', async () => {
    const { session, stored } = await buildPlayedSession();

    // Sanity: the pending mutations actually happened in the game.
    const liveGame = session.readGame();
    expect(tokenNames(liveGame.hand)).toEqual(['p1', 'p2']);
    expect(tokenNames(liveGame.stash)).toEqual(['p3']);
    const liveJson = JSON.stringify(liveGame.toJSON());

    expect(stored.snapshot).not.toBeNull();
    const { host } = restoredHost(collectDef, collectOptions, stored);

    // The restored tree is byte-for-byte identical to the live one — the pending
    // onEach moves survived because state, not action history, was authoritative.
    const restoredGame = runnerFromSnapshot(host.snapshot!, { ...collectDef, randomness: 'allowed' }).game as CollectGame;
    expect(JSON.stringify(restoredGame.toJSON())).toEqual(liveJson);
    expect(tokenNames(restoredGame.hand)).toEqual(['p1', 'p2']);
    expect(tokenNames(restoredGame.stash)).toEqual(['p3']);

    // actionHistory is preserved (for undo turn-detection) — exactly one entry
    // for the completed multi-step action.
    const history = succeeded(await host.handleOp(1, { type: 'debugHistory' })).actionHistory;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ name: 'collect' });
  });

  it('rebuilds with GameRunner.fromSnapshot and never GameRunner.replay', async () => {
    const { stored } = await buildPlayedSession();

    const fromSnapshotSpy = vi.spyOn(GameRunner, 'fromSnapshot');
    const replaySpy = vi.spyOn(GameRunner, 'replay');

    try {
      const { host } = restoredHost(collectDef, collectOptions, stored);
      expect(host.snapshot).toEqual(stored.snapshot);
      expect((await host.handleOp(1, { type: 'undo', player: 1 })).success).toBe(true);

      expect(fromSnapshotSpy).toHaveBeenCalled();
      expect(fromSnapshotSpy.mock.calls[0][0]).toEqual(stored.snapshot);
      expect(replaySpy).not.toHaveBeenCalled();
    } finally {
      fromSnapshotSpy.mockRestore();
      replaySpy.mockRestore();
    }
  });

  it('supports undo after restore (dead under the old replay restore)', async () => {
    const { stored } = await buildPlayedSession();
    const { host } = restoredHost(collectDef, collectOptions, stored);

    // It is still player 1's turn (the action-step repeats), so the just-completed
    // 'collect' is undoable. Under the OLD replay restore this returned the
    // "cold-restored ... cannot undo across pending mutations" error because the
    // per-action undo checkpoints were never reconstructed. With fromSnapshot the
    // snapshot carries them, so undo succeeds and rewinds the action history.
    //
    // (Note: a multi-step action's onEach mutations fold into the turn-start
    // checkpoint, so the board view is not asserted here — that fold is an
    // orthogonal, pre-existing checkpoint property. What F42 fixes is that undo is
    // no longer DEAD after a restore.)
    const undo = await host.handleOp(1, { type: 'undo', player: 1 });
    expect(undo.success).toBe(true);
    expect(succeeded(await host.handleOp(1, { type: 'debugHistory' })).actionHistory).toHaveLength(0);
  });

  it('supports time-travel (debugStateAt) after restore', async () => {
    const { stored } = await buildPlayedSession();
    const { host } = restoredHost(collectDef, collectOptions, stored);

    // State at action 0 (turn start, before collect).
    expect((await host.handleOp(1, { type: 'debugStateAt', actionIndex: 0, player: 1 })).success).toBe(true);
    // State at action 1 (after collect completed) — current state.
    expect((await host.handleOp(1, { type: 'debugStateAt', actionIndex: 1, player: 1 })).success).toBe(true);

    // The restored game still reflects the collected state — viewing history
    // did not mutate it.
    const game = runnerFromSnapshot(host.snapshot!, { ...collectDef, randomness: 'allowed' }).game as CollectGame;
    expect(tokenNames(game.hand)).toEqual(['p1', 'p2']);
  });

  it('fails loud when stored state has no snapshot (no silent replay fallback)', async () => {
    const { stored } = await buildPlayedSession();

    expect(() => restoredHost(collectDef, collectOptions, { ...stored, snapshot: null })).toThrow(
      /restore requires the snapshot of a started game/,
    );
  });
});

// ---------------------------------------------------------------------------
// BL-01: a restore must keep the tutorial definition, so gating and the
// tutorial's lifecycle survive a cold restart (snapshot round-trip). The
// definition is not serialized; the live host threads it from the game
// definition onto every game it rebuilds.
// ---------------------------------------------------------------------------

class TutorialRestoreGame extends Game<TutorialRestoreGame, Player> {
  /** How many `move`s have been made; RESTORE_TUTORIAL's first step advances on one. */
  moves = 0;

  constructor(options: GameOptions) {
    super(options);

    const moveAction = Action.create('move')
      .prompt('Move')
      .chooseFrom('piece', { choices: ['a', 'b', 'c'] })
      .execute(() => {
        this.moves += 1;
      });

    const passAction = Action.create('pass')
      .prompt('Pass')
      .execute(() => {});

    this.registerActions(moveAction, passAction);

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 20,
          do: eachPlayer({
            do: actionStep({ actions: ['move', 'pass'] }),
          }),
        }),
      })
    );
  }
}

const RESTORE_TUTORIAL: TutorialDefinition = {
  steps: [
    {
      id: 'step-1',
      gate: { action: 'move' },
      advanceWhen: { 'a piece has moved': ({ game }) => (game as TutorialRestoreGame).moves > 0 },
    },
    { id: 'step-2', gate: { action: 'pass' } },
  ],
};

const tutorialDef = {
  gameClass: TutorialRestoreGame,
  gameType: 'tutorial-restore',
  minPlayers: 2,
  maxPlayers: 2,
  tutorial: RESTORE_TUTORIAL,
} satisfies GameDefinitionLike;

/** A table whose seat 1 has started the tutorial, as a store holds it after a cold restart. */
async function storedTutorialTable(seed: string) {
  const options = { playerCount: 2, playerNames: ['Alice', 'Bob'], seed };
  const session = createHeadlessSession(tutorialDef, options);
  await session.start();
  expect((await session.send(1, { type: 'startTutorial', player: 1 })).success).toBe(true);
  return { options, stored: coldStored(session.host.durableState()) };
}

describe('BL-01: a restored SnapshotSessionHost keeps the tutorial definition', () => {
  it('gating survives snapshot → restore', async () => {
    const { options, stored } = await storedTutorialTable('bl01-seed');
    const { host } = restoredHost(tutorialDef, options, stored);

    // After restore, gating must still be active: 'pass' is out of step and refused.
    const pass = await host.handleOp(1, {
      type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host),
    });
    expect(pass).toMatchObject({ success: false, error: expect.stringContaining('Tutorial step requires') });

    // The allowed action 'move' is not.
    const move = await host.handleOp(1, {
      type: 'action', actionName: 'move', player: 1, args: { piece: 'a' }, boundaryKey: boundaryKeyOfHost(host),
    });
    expect(move.success).toBe(true);
  });

  it('the running step advances after restore', async () => {
    const { options, stored } = await storedTutorialTable('bl01-seed-2');
    const { host, published } = restoredHost(tutorialDef, options, stored);

    const move = await host.handleOp(1, {
      type: 'action', actionName: 'move', player: 1, args: { piece: 'a' }, boundaryKey: boundaryKeyOfHost(host),
    });
    expect(move.success).toBe(true);

    // step-1's advanceWhen fired, so seat 1 is on step-2, which gates to 'pass'.
    const seat1 = published.at(-1)![0]!.state;
    expect(seat1.tutorial?.stepId).toBe('step-2');
    expect(seat1.disabledActions?.['move']).toBeTruthy();
    expect(seat1.disabledActions?.['pass']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SEC-01/F1/F7 companion assertion (case d of the D-SEC-01 coverage contract
// in plan 131-02): a host's restore must preserve `Space._zoneVisibility` so a
// hidden zone stays hidden to the opponent after a cold restore. This is the
// session-host restore path — the other paths (fromSnapshot, undo, rewind,
// stateless-ops) are asserted in
// src/engine/element/zone-visibility-restore.test.ts.
//
// Uses a plain `Space` (not `Deck`/`Hand`): those classes set their OWN
// zone-visibility default in their own constructors (F32 secure-by-default),
// so a restore that does `new ElementClass(ctx)` incidentally re-applies that
// default and would mask the F1/F7 bug for the common case. A plain `Space`
// has no built-in default (effectively visible to all), so explicitly
// diverging via `contentsHidden()` genuinely exercises the restore path.
// ---------------------------------------------------------------------------

class SecretCard extends Piece<ZoneGame> {
  suit!: string;
}

class SecretZone extends Space<ZoneGame> {}

class ZoneGame extends Game<ZoneGame, Player> {
  hiddenZone!: SecretZone;

  constructor(options: GameOptions) {
    super(options);

    this.hiddenZone = this.create(SecretZone, 'hidden-zone');
    this.hiddenZone.contentsHidden();
    this.hiddenZone.createMany(3, SecretCard, 'card', (i) => ({ suit: ['H', 'S', 'D'][i] }));

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

const zoneDef = { gameClass: ZoneGame, gameType: 'zone-vis-session-test', minPlayers: 2, maxPlayers: 2 } satisfies GameDefinitionLike;

describe('SEC-01/F1/F7 companion: a restored SnapshotSessionHost preserves zone visibility', () => {
  it("the opponent's view of a hidden zone is byte-identical with and without a cold restore", async () => {
    const options = { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'sec01-seed' };
    const session = createHeadlessSession(zoneDef, options);
    await session.start();
    const { host, published } = restoredHost(zoneDef, options, coldStored(session.host.durableState()));

    // The same move, on the table that never restarted and on the restored one.
    expect((await session.send(1, { type: 'action', actionName: 'noop', player: 1, args: {} })).success).toBe(true);
    const restoredMove = await host.handleOp(1, {
      type: 'action', actionName: 'noop', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host),
    });
    expect(restoredMove.success).toBe(true);

    const before = session.playerState(2).view;
    expect(JSON.stringify(before)).not.toContain('"suit"');
    expect(JSON.stringify(published.at(-1)![1]!.state.view)).toBe(JSON.stringify(before));
  });
});
