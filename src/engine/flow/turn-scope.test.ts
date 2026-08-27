import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _clearShownWarnings } from '../../utils/dev.js';
import { createHeadlessSession } from '../../session/headless-session.js';
import {
  Game,
  Player,
  Action,
  defineFlow,
  sequence,
  actionStep,
  loop,
  eachPlayer,
  execute,
  type GameOptions,
} from '../index.js';
import type { GameDefinitionLike, Op } from '../../session/stateless-ops.js';

/**
 * A turn made of several actions has exactly two shapes in this API, and until
 * this file they behaved completely differently for undo:
 *
 *  - `actionStep({ repeatUntil })` keeps ONE action-step frame open, so
 *    `frame.data.moveCount` accumulates and `computeUndoInfo`
 *    (`session/utils.ts`) anchors the rewind at the start of the run.
 *  - Anything that RE-ENTERS an action step -- a `loop` around it, or a
 *    `sequence` of several different steps -- creates a FRESH frame for each
 *    action, so `moveCount` is back to 0 at every decision point and undo
 *    reaches nothing.
 *
 * The second shape is the one most turns need (`repeatUntil` cannot express a
 * turn whose steps offer DIFFERENT actions), and it silently disabled undo.
 *
 * The engine cannot infer which was meant. `SoloWipeGame`
 * (`session/testing/solo-undo-authoritative.test.ts`) is a `sequence` of
 * same-seat action steps that are deliberately SEPARATE turns; Polyhedral
 * Potions' `playerTurn` is a `sequence` of same-seat action steps that are
 * deliberately ONE turn. The two are structurally identical and mean opposite
 * things, so the author has to say which -- and `turnScope` is where they say
 * it. Leaving it out on an ambiguous step is an error, not a default.
 */

const opts = { playerCount: 1, seed: 't' };
const twoSeatOpts = { playerCount: 2, seed: 't' };

function def(cls: GameDefinitionLike['gameClass'], gameType: string, maxPlayers = 1): GameDefinitionLike {
  return {
    gameClass: cls,
    gameType,
    minPlayers: 1,
    maxPlayers,
  };
}

function scoreOf(snapshot: unknown): number | undefined {
  return (snapshot as { state?: { attributes?: { score?: number } } })?.state?.attributes?.score;
}

/** Base game: one `act` action worth a point, plus a move counter. */
abstract class ScoreGame extends Game<ScoreGame, Player> {
  score = 0;
  moves = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('act').execute(() => {
        this.score += 1;
        this.moves += 1;
        return { success: true };
      }),
    );
  }
}

const seatOne = (ctx: { game: Game }) => ctx.game.getPlayer(1)!;

/**
 * The idiom under test: a turn loop whose body re-enters the same step, with
 * the run declared as ONE turn.
 */
class ContinueLoopGame extends ScoreGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow(
      defineFlow({
        root: loop({
          name: 'turn-loop',
          while: (ctx) => (ctx.game as ContinueLoopGame).moves < 4,
          maxIterations: 10,
          do: sequence(
            // A non-action node between the actions, exactly like Go Fish's
            // empty-hand refill: the carry must survive it.
            execute(() => {}),
            actionStep({ name: 'act-step', actions: ['act'], player: seatOne, turnScope: 'continue' }),
          ),
        }),
      }),
    );
  }
}

/** The same loop, declared as a fresh turn per iteration. */
class RestartLoopGame extends ScoreGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow(
      defineFlow({
        root: loop({
          name: 'turn-loop',
          while: (ctx) => (ctx.game as RestartLoopGame).moves < 4,
          maxIterations: 10,
          do: actionStep({ name: 'act-step', actions: ['act'], player: seatOne, turnScope: 'restart' }),
        }),
      }),
    );
  }
}

/** The same loop with nothing declared -- the shape that used to go quiet. */
class UndeclaredLoopGame extends ScoreGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow(
      defineFlow({
        root: loop({
          name: 'turn-loop',
          while: (ctx) => (ctx.game as UndeclaredLoopGame).moves < 4,
          maxIterations: 10,
          do: actionStep({ name: 'act-step', actions: ['act'], player: seatOne }),
        }),
      }),
    );
  }
}

/**
 * A turn built from DIFFERENT steps in a `sequence` -- the Polyhedral Potions
 * shape, which `repeatUntil` cannot express at all.
 */
class SequenceTurnGame extends ScoreGame {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('finish').execute(() => {
        this.score += 10;
        this.moves += 1;
        return { success: true };
      }),
    );
    this.setFlow(
      defineFlow({
        root: sequence(
          actionStep({ name: 'first', actions: ['act'], player: seatOne }),
          actionStep({ name: 'second', actions: ['act'], player: seatOne, turnScope: 'continue' }),
          actionStep({ name: 'third', actions: ['finish'], player: seatOne, turnScope: 'continue' }),
        ),
      }),
    );
  }
}

/**
 * Alternating seats: the shape Hex has. No seat is ever re-prompted after its
 * own action, so nothing here is ambiguous and nothing needs declaring.
 */
class AlternatingGame extends ScoreGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow(
      defineFlow({
        root: loop({
          name: 'game-loop',
          while: (ctx) => (ctx.game as AlternatingGame).moves < 4,
          maxIterations: 10,
          do: eachPlayer({
            name: 'seats',
            do: actionStep({ name: 'place', actions: ['act'] }),
          }),
        }),
      }),
    );
  }
}

async function act(session: ReturnType<typeof createHeadlessSession>, seat = 1) {
  return session.send(seat, { type: 'action', actionName: 'act', player: seat, args: {} } as Op);
}

async function undo(session: ReturnType<typeof createHeadlessSession>, seat = 1) {
  return session.send(seat, { type: 'undo', player: seat } as Op);
}

describe("turnScope: 'continue' gives a re-entered step real undo reach", () => {
  it('rewinds the whole run of the turn, not just nothing', async () => {
    const session = createHeadlessSession(def(ContinueLoopGame, 'continue-loop'), opts);
    await session.start();

    expect(scoreOf((await act(session)).snapshot)).toBe(1);
    expect(scoreOf((await act(session)).snapshot)).toBe(2);
    const third = await act(session);
    expect(scoreOf(third.snapshot)).toBe(3);

    // The defect this file exists for: before `turnScope`, this was refused
    // with "No actions to undo" while the seat was still mid-turn.
    const rewound = await undo(session);
    expect(rewound.success).toBe(true);
    expect(scoreOf(rewound.snapshot)).toBe(0);
  });

  it('publishes the run length as moveCount at every decision point', async () => {
    const session = createHeadlessSession(def(ContinueLoopGame, 'continue-loop'), opts);
    await session.start();

    const counts: Array<number | undefined> = [];
    for (let i = 0; i < 3; i++) {
      const result = await act(session);
      counts.push((result.snapshot as { flowState?: { moveCount?: number } })?.flowState?.moveCount);
    }
    expect(counts).toEqual([1, 2, 3]);
  });

  it('carries across a sequence of DIFFERENT steps, which repeatUntil cannot express', async () => {
    const session = createHeadlessSession(def(SequenceTurnGame, 'sequence-turn'), opts);
    await session.start();

    expect(scoreOf((await act(session)).snapshot)).toBe(1);
    expect(scoreOf((await act(session)).snapshot)).toBe(2);

    const rewound = await undo(session);
    expect(rewound.success).toBe(true);
    expect(scoreOf(rewound.snapshot)).toBe(0);
  });
});

describe("turnScope: 'restart' keeps each entry its own turn", () => {
  it('reaches back nothing, and says so in the refusal', async () => {
    const session = createHeadlessSession(def(RestartLoopGame, 'restart-loop'), opts);
    await session.start();

    await act(session);
    await act(session);

    const refused = await undo(session);
    expect(refused.success).toBe(false);
    expect((refused as { error?: string }).error).toBe('No actions to undo');
  });
});

describe('an undeclared same-seat re-entry is loud, not a silent zero', () => {
  beforeEach(() => {
    _clearShownWarnings();
  });
  afterEach(() => {
    _clearShownWarnings();
  });

  it('warns in dev the first time the flow reaches the shape', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const session = createHeadlessSession(def(UndeclaredLoopGame, 'undeclared-loop'), opts);
      await session.start();

      // Nothing is ambiguous until a seat has actually committed something.
      expect(warn).not.toHaveBeenCalled();

      // Committing opens the next entry, and THAT is the ambiguous one: the
      // same seat, prompted again, in a fresh frame. The game keeps playing;
      // the warning is the diagnostic.
      expect((await act(session)).success).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);

      // Deduped -- one line per step, not one per move.
      expect((await act(session)).success).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);

      const message = warn.mock.calls[0]?.[0] as string;
      expect(message).toContain('[BoardSmith]');
      expect(message).toContain("Flow step 'act-step'");
      expect(message).toContain('seat 1');
      expect(message).toContain("turnScope: 'continue'");
      expect(message).toContain("turnScope: 'restart'");
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses the undo with the reason, not with the misleading "No actions to undo"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const session = createHeadlessSession(def(UndeclaredLoopGame, 'undeclared-loop'), opts);
      await session.start();

      await act(session);
      await act(session);

      const refused = await undo(session);
      expect(refused.success).toBe(false);
      const message = (refused as { error?: string }).error ?? '';
      expect(message).not.toBe('No actions to undo');
      expect(message).toContain("flow step 'act-step'");
      expect(message).toContain("turnScope: 'continue'");
      expect(message).toContain("turnScope: 'restart'");
    } finally {
      warn.mockRestore();
    }
  });
});

describe('alternating seats are not ambiguous and are left alone', () => {
  it('needs no declaration and still refuses undo once the turn has passed', async () => {
    const session = createHeadlessSession(def(AlternatingGame, 'alternating', 2), twoSeatOpts);
    await session.start();

    const first = await act(session, 1);
    expect(first.success).toBe(true);

    // Seat 1's single-action turn is over the instant it commits, so the
    // refusal is about WHOSE turn it is -- not about undo reach. No flow shape
    // can change that, which is why Hex is not one of the games this fixes.
    const refused = await undo(session, 1);
    expect(refused.success).toBe(false);
    expect((refused as { error?: string }).error).toBe("It's not your turn");

    const second = await act(session, 2);
    expect(second.success).toBe(true);
  });
});
