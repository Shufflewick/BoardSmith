/**
 * Server-side tutorial auto-advance on the live host (Plan 106-03).
 *
 * Proves, through `createHeadlessSession` (the snapshot host over `executeOp`):
 *   1. A step whose advanceWhen fires after the learner's action advances.
 *   2. An OPPONENT action can advance the learner's tutorial step.
 *   3. MR-03: startTutorial on a zero-steps definition is refused with an
 *      actionable error.
 *
 * A step whose advanceWhen is already true when the tutorial starts advances at
 * once on the live host (stateless-ops `startTutorial`, CR-01), so there is no
 * "no advance at start" guard to test here.
 *
 * Raw labeled-predicate advanceWhen conditions only. In-test Game subclass with
 * a public `actionCount` field so predicates can inspect accumulated actions.
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { createHeadlessSession } from './headless-session.js';
import type { TutorialDefinition } from '../engine/tutorial/types.js';

// ============================================
// Test game
// ============================================

class AutoAdvanceSpace extends Space<AutoAdvanceGame> {}

/**
 * Minimal two-player game whose actions increment a shared counter.
 * advanceWhen predicates inspect `ctx.game.actionCount` to determine
 * whether to advance — pure observable state, no engine internals.
 */
class AutoAdvanceGame extends Game<AutoAdvanceGame, Player> {
  /** Total actions performed by any player across the lifetime of the game. */
  actionCount = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([AutoAdvanceSpace]);

    // 'move': increments actionCount (both players can use it)
    const moveAction = Action.create('move')
      .prompt('Move')
      .chooseFrom('target', { choices: ['a', 'b', 'c'] })
      .execute((_args, ctx) => {
        (ctx.game as AutoAdvanceGame).actionCount++;
      });

    // 'pass': increments actionCount (both players can use it)
    const passAction = Action.create('pass')
      .prompt('Pass')
      .execute((_args, ctx) => {
        (ctx.game as AutoAdvanceGame).actionCount++;
      });

    this.registerActions(moveAction, passAction);

    this.setFlow(defineFlow({
      root: loop({
        while: () => true,
        maxIterations: 20,
        do: eachPlayer({
          do: actionStep({ actions: ['move', 'pass'] }),
        }),
      }),
    }));
  }
}

/**
 * Two-step tutorial where step-0's advanceWhen fires when actionCount >= 1
 * (the first action of ANY player triggers it).
 */
const ADVANCE_AFTER_ONE_ACTION: TutorialDefinition = {
  steps: [
    {
      id: 'intro',
      gate: { action: 'move' },
      advanceWhen: {
        'first action complete': (ctx) => (ctx.game as AutoAdvanceGame).actionCount >= 1,
      },
    },
    {
      id: 'done',
      gate: { action: 'pass' },
    },
  ],
};

/**
 * Two-step tutorial where step-0's advanceWhen fires only when actionCount >= 2
 * (requires two total actions — one learner + one opponent).
 */
const ADVANCE_AFTER_OPPONENT: TutorialDefinition = {
  steps: [
    {
      id: 'wait-for-opponent',
      gate: { action: 'move' },
      advanceWhen: {
        'opponent also acted': (ctx) => (ctx.game as AutoAdvanceGame).actionCount >= 2,
      },
    },
    {
      id: 'done',
      gate: { action: 'pass' },
    },
  ],
};

/**
 * Tutorial with zero steps — used for MR-03 test.
 */
const ZERO_STEPS: TutorialDefinition = { steps: [] };

/** A started two-seat table on the given tutorial; seat 1 is the learner. */
async function makeSession(tutorial: TutorialDefinition) {
  const session = createHeadlessSession(
    { gameClass: AutoAdvanceGame, gameType: 'auto-advance-test', minPlayers: 2, maxPlayers: 2, tutorial },
    { playerCount: 2, seed: 'test-seed', playerNames: ['Learner', 'Opponent'] },
  );
  await session.start();
  return session;
}

type Session = Awaited<ReturnType<typeof makeSession>>;

async function startTutorial(session: Session) {
  const started = await session.send(1, { type: 'startTutorial', player: 1 });
  if (!started.success) throw new Error(started.error);
}

async function act(session: Session, seat: number, actionName: 'move' | 'pass') {
  const args = actionName === 'move' ? { target: 'a' } : {};
  const result = await session.send(seat, { type: 'action', actionName, player: seat, args });
  if (!result.success) throw new Error(result.error);
}

const learnerStep = (session: Session) => session.readGame().tutorialProgress.get(1)?.stepId;

// ============================================
// Test suite
// ============================================

describe('server-side auto-advance — post-action', () => {
  it('advances the learner to the next step after a qualifying action', async () => {
    const session = await makeSession(ADVANCE_AFTER_ONE_ACTION);
    await startTutorial(session);
    expect(learnerStep(session)).toBe('intro');

    await act(session, 1, 'move');

    expect(learnerStep(session)).toBe('done');
  });
});

describe('server-side auto-advance — opponent-triggered advance', () => {
  it('advances the learner tutorial when the OPPONENT performs an action', async () => {
    const session = await makeSession(ADVANCE_AFTER_OPPONENT);
    await startTutorial(session);

    // The learner acts: actionCount is 1, the predicate needs 2, so no advance.
    await act(session, 1, 'move');
    expect(learnerStep(session)).toBe('wait-for-opponent');

    // The opponent acts: actionCount is 2, so the learner's step advances.
    await act(session, 2, 'pass');
    expect(learnerStep(session)).toBe('done');
  });
});

describe('MR-03 — fail-loud lifecycle', () => {
  it('startTutorial on a tutorial with zero steps is refused with an actionable error naming TutorialDefinition.steps', async () => {
    const session = await makeSession(ZERO_STEPS);

    const result = await session.send(1, { type: 'startTutorial', player: 1 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/TutorialDefinition\.steps/);
    expect(session.readGame().tutorialProgress.get(1)).toBeUndefined();
  });
});
