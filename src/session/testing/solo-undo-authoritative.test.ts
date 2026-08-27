import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from '../headless-session.js';
import { GameSession } from '../game-session.js';
import {
  Game,
  Player,
  Action,
  defineFlow,
  sequence,
  actionStep,
  type GameOptions,
} from '../../engine/index.js';
import type { GameDefinitionLike, Op } from '../stateless-ops.js';

/**
 * UNDO-03 regression: the solo-game "wipe" defect.
 *
 * Root cause (155-RESEARCH.md §B): `getState()` only publishes `FlowState.moveCount`
 * while the ACTIVE action-step config declares `minMoves`/`maxMoves`
 * (`engine.ts:578-587`, pre-fix). A step that stays open across multiple moves via
 * `repeatUntil` (no `minMoves`/`maxMoves` declared -- the exact "no move limits"
 * shape RESEARCH.md's assumption A1 attributes to Doom Machine) therefore ALSO
 * reports `moveCount === undefined`, so `computeUndoInfo` (`session/utils.ts`)
 * falls into branch C: a backward scan for the nearest action by a DIFFERENT
 * player. In a SOLO game there is no different player, so the scan walks to
 * action index 0 -- undo restores the game's initial checkpoint, discarding
 * every action ever taken. That is the wipe (D5/UNDO-03).
 *
 * `SoloWipeGame`'s flow: two ordinary single-move `pass` turns (their own,
 * already-closed action-step frames -- history entries that a correct fix must
 * NEVER touch), followed by an OPEN-ENDED `act` step (`repeatUntil` never
 * returns true within this test's scope, and `minMoves`/`maxMoves` are BOTH
 * undefined on it -- the precise "no move limits" precondition that routes
 * pre-fix undo through the deleted fallback).
 */

class SoloWipeGame extends Game<SoloWipeGame, Player> {
  /** Plain `Game` property (not an element) so it round-trips through
   *  toJSON()/checkpoint-restore as an ordinary serialized field, and is
   *  trivially readable off a snapshot for assertions. */
  score = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(Action.create('pass').execute(() => {
      this.score += 1;
      return { success: true };
    }));
    this.registerAction(Action.create('act').execute(() => {
      this.score += 10;
      return { success: true };
    }));

    const p1 = (ctx: { game: Game }) => ctx.game.getPlayer(1)!;

    this.setFlow(
      defineFlow({
        root: sequence(
          // Two closed, single-move turns -- the "prior game history" a
          // correct fix must preserve no matter how many `act` moves follow.
          // Same seat, three steps in a row, and each one is its OWN turn --
          // the reading `turnScope: 'restart'` states. Polyhedral Potions
          // writes the identical shape and means the opposite, which is why
          // the engine asks rather than guessing.
          actionStep({ actions: ['pass'], player: p1, turnScope: 'restart' }),
          actionStep({ actions: ['pass'], player: p1, turnScope: 'restart' }),
          // The open-ended step under test: NO minMoves/maxMoves declared.
          // `repeatUntil` never becomes true within this test, so the step
          // (and therefore the SAME action-step frame) stays open across
          // repeated `act` moves -- the shape that makes moveCount meaningful
          // (branch B) once it's actually published for a limits-free step.
          actionStep({ actions: ['act'], player: p1, repeatUntil: () => false, turnScope: 'restart' }),
        ),
      }),
    );
  }
}

const soloWipeFixtureDefinition: GameDefinitionLike = {
  gameClass: SoloWipeGame,
  gameType: 'solo-wipe',
  minPlayers: 1,
  maxPlayers: 1,
};

const gameOptions = { playerCount: 1, seed: 't' };

function scoreOf(snapshot: unknown): number | undefined {
  return (snapshot as { state?: { attributes?: { score?: number } } })?.state?.attributes?.score;
}

describe('UNDO-03 solo-wipe regression (stateless)', () => {
  it('one undo removes exactly the pending act move -- the two prior pass turns survive', async () => {
    const session = createHeadlessSession(soloWipeFixtureDefinition, gameOptions);
    await session.start();

    // Two closed turns: history = [pass, pass], score = 2.
    expect((await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} } as Op)).success).toBe(true);
    expect((await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} } as Op)).success).toBe(true);

    // One move into the open `act` step: history = [pass, pass, act], score = 12.
    const act = await session.send(1, { type: 'action', actionName: 'act', player: 1, args: {} } as Op);
    expect(act.success).toBe(true);
    expect(scoreOf(act.snapshot)).toBe(12);

    const undo = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo.success).toBe(true);

    // OBSERVABLE outcome: exactly the pending `act` move was undone. The two
    // prior, already-closed `pass` turns are NOT touched -- this is the
    // opposite of the pre-fix symptom (see RED capture in the SUMMARY), which
    // wipes ALL THREE actions and returns score 0.
    expect(scoreOf(undo.snapshot)).toBe(2);

    const debugState = (await session.send(1, { type: 'debugFlowState', player: 1 } as Op)) as unknown as {
      success: boolean;
      snapshot: { actionHistory?: unknown[] };
    };
    expect(debugState.success).toBe(true);
  });

  it('undo is incremental and repeatable -- a second act-then-undo cycle never approaches an empty history', async () => {
    const session = createHeadlessSession(soloWipeFixtureDefinition, gameOptions);
    await session.start();

    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} } as Op);
    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} } as Op);

    // First act-then-undo cycle.
    await session.send(1, { type: 'action', actionName: 'act', player: 1, args: {} } as Op);
    const undo1 = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo1.success).toBe(true);
    expect(scoreOf(undo1.snapshot)).toBe(2);

    // A second, independent act-then-undo cycle proves the fix is not a
    // one-shot fluke: it behaves the SAME way every time, never cascading
    // further back into the two `pass` turns and never wiping the game.
    await session.send(1, { type: 'action', actionName: 'act', player: 1, args: {} } as Op);
    const undo2 = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo2.success).toBe(true);
    expect(scoreOf(undo2.snapshot)).toBe(2);
  });

  it('two undos in a row (no intervening action) never wipes the game -- the second is safely refused', async () => {
    const session = createHeadlessSession(soloWipeFixtureDefinition, gameOptions);
    await session.start();

    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} } as Op);
    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} } as Op);
    await session.send(1, { type: 'action', actionName: 'act', player: 1, args: {} } as Op);

    const undo1 = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo1.success).toBe(true);
    expect(scoreOf(undo1.snapshot)).toBe(2);

    // Nothing pending in the (now-fresh) `act` step -- refused, not a
    // cascading rewind into the two `pass` turns. This is the direct proof
    // that the fix bounds undo to the CURRENTLY open action-step frame and
    // never falls back to scanning arbitrarily far into history.
    const undo2 = await session.send(1, { type: 'undo', player: 1 } as Op);
    expect(undo2.success).toBe(false);
  });
});

describe('UNDO-03 solo-wipe regression (stateful)', () => {
  function newStatefulSession() {
    return GameSession.create<SoloWipeGame>({
      gameType: 'solo-wipe',
      GameClass: SoloWipeGame,
      playerCount: 1,
      playerNames: ['A'],
      seed: 't',
    });
  }

  it('one undo removes exactly the pending act move -- the two prior pass turns survive', async () => {
    const session = newStatefulSession();

    expect((await session.performAction('pass', 1, {})).success).toBe(true);
    expect((await session.performAction('pass', 1, {})).success).toBe(true);

    const act = await session.performAction('act', 1, {});
    expect(act.success).toBe(true);
    expect((session.runner.getSnapshot().state as { attributes?: { score?: number } }).attributes?.score).toBe(12);

    const undo = await session.undoToTurnStart(1);
    expect(undo.success).toBe(true);
    expect((session.runner.getSnapshot().state as { attributes?: { score?: number } }).attributes?.score).toBe(2);
  });

  it('undo is incremental and repeatable across two act-then-undo cycles', async () => {
    const session = newStatefulSession();

    await session.performAction('pass', 1, {});
    await session.performAction('pass', 1, {});

    await session.performAction('act', 1, {});
    const undo1 = await session.undoToTurnStart(1);
    expect(undo1.success).toBe(true);
    expect((session.runner.getSnapshot().state as { attributes?: { score?: number } }).attributes?.score).toBe(2);

    await session.performAction('act', 1, {});
    const undo2 = await session.undoToTurnStart(1);
    expect(undo2.success).toBe(true);
    expect((session.runner.getSnapshot().state as { attributes?: { score?: number } }).attributes?.score).toBe(2);
  });

  it('two undos in a row (no intervening action) never wipes the game', async () => {
    const session = newStatefulSession();

    await session.performAction('pass', 1, {});
    await session.performAction('pass', 1, {});
    await session.performAction('act', 1, {});

    const undo1 = await session.undoToTurnStart(1);
    expect(undo1.success).toBe(true);
    expect((session.runner.getSnapshot().state as { attributes?: { score?: number } }).attributes?.score).toBe(2);

    const undo2 = await session.undoToTurnStart(1);
    expect(undo2.success).toBe(false);
  });
});
