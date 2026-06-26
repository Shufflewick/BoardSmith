/**
 * Tests for tutorial named-predicate helpers.
 *
 * Covers:
 * - afterFirstTurn(): false at game start (no flash-skip), true after the
 *   learner's first action.
 * - afterTurns(n): false before n turns, true after n turns; verified with
 *   the shared evaluateAdvanceWhen (Plan 01) to confirm integration.
 * - whenForced(actionName): false when multiple actions are available, true
 *   when the named action is the sole available action.
 * - Acceptance: no addEventListener/emit/setTimeout in predicates.ts (grep
 *   assertion is in the CI acceptance check; the tests below cover runtime
 *   behavior).
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
} from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import type { TutorialDefinition, TutorialAdvanceCondition, TutorialGateContext } from './types.js';
import { evaluateAdvanceWhen } from './progress.js';
import { afterFirstTurn, afterTurns, whenForced } from './predicates.js';

// ============================================================
// In-test game class
// ============================================================

/**
 * Minimal 2-player game for predicate testing.
 *
 * - `move` is always available (no condition).
 * - `pass` is only available when `forcedMode === false`.
 *   Setting `forcedMode = true` after construction simulates a game state
 *   where the learner has no choice but to `move`, enabling `whenForced`
 *   tests without restarting the runner.
 *
 * The flow is `loop(eachPlayer(actionStep(['move','pass'])))` with seat 1
 * going first — the documented assumption for `afterTurns`.
 */
class PredicateTestGame extends Game<PredicateTestGame, Player> {
  /** When true, the 'pass' action's condition fails → only 'move' is available. */
  forcedMode: boolean = false;

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    const moveAction = Action.create('move')
      .prompt('Move')
      .execute(() => {
        // no-op for predicate testing
      });

    const passAction = Action.create('pass')
      .prompt('Pass')
      .condition({
        'pass allowed when not forced': (ctx) =>
          !(ctx.game as PredicateTestGame).forcedMode,
      })
      .execute(() => {
        // no-op for predicate testing
      });

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
      }),
    );
  }
}

// ============================================================
// Test helpers
// ============================================================

function makeRunner(): GameRunner<PredicateTestGame> {
  const runner = new GameRunner<PredicateTestGame>({
    GameClass: PredicateTestGame,
    gameType: 'predicate-test',
    gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
  });
  runner.start();
  return runner;
}

/**
 * Extract the single predicate function from a labeled condition record and
 * call it with the given game and seat.
 */
function evalCondition(
  condition: TutorialAdvanceCondition,
  game: Game,
  seat: number,
): boolean {
  const fn = Object.values(condition)[0];
  if (!fn) throw new Error('condition is empty');
  const ctx: TutorialGateContext = { game, seat };
  return fn(ctx);
}

/** Perform an action as the specified seat (seat 1-indexed). */
function act(runner: GameRunner<PredicateTestGame>, seat: number, action = 'move'): void {
  const result = runner.performAction(action, seat, {});
  if (!result.success) {
    throw new Error(`Action '${action}' for seat ${seat} failed: ${result.error}`);
  }
}

// ============================================================
// afterFirstTurn tests
// ============================================================

describe('afterFirstTurn()', () => {
  it('returns a single-label TutorialAdvanceCondition', () => {
    const condition = afterFirstTurn();
    expect(typeof condition).toBe('object');
    const entries = Object.entries(condition);
    expect(entries).toHaveLength(1);
    expect(typeof entries[0][1]).toBe('function');
  });

  it('is FALSE at game start — no flash-skip', () => {
    const runner = makeRunner();
    // No action taken yet — predicate must be false so the intro step is not
    // immediately skipped when autoAdvanceTutorial is called at tutorial start.
    const condition = afterFirstTurn();
    expect(evalCondition(condition, runner.game, /* seat */ 1)).toBe(false);
  });

  it('is TRUE only after the learner (seat 1) completes their first action', () => {
    const runner = makeRunner();
    const condition = afterFirstTurn();

    // Still false before the learner acts
    expect(evalCondition(condition, runner.game, 1)).toBe(false);

    // Learner acts — now true
    act(runner, 1);
    expect(evalCondition(condition, runner.game, 1)).toBe(true);
  });

  it('remains TRUE after subsequent turns', () => {
    const runner = makeRunner();
    const condition = afterFirstTurn();

    act(runner, 1); // seat 1 turn 1
    act(runner, 2); // seat 2 turn 1
    act(runner, 1); // seat 1 turn 2

    expect(evalCondition(condition, runner.game, 1)).toBe(true);
  });

  it('is equivalent to afterTurns(1)', () => {
    const runner = makeRunner();
    const first = afterFirstTurn();
    const turns1 = afterTurns(1);

    // Both false at start
    expect(evalCondition(first, runner.game, 1)).toBe(false);
    expect(evalCondition(turns1, runner.game, 1)).toBe(false);

    // Both true after the first action
    act(runner, 1);
    expect(evalCondition(first, runner.game, 1)).toBe(true);
    expect(evalCondition(turns1, runner.game, 1)).toBe(true);
  });
});

// ============================================================
// afterTurns tests
// ============================================================

describe('afterTurns(n)', () => {
  it('returns a labeled condition with a descriptive key', () => {
    expect(Object.keys(afterTurns(1))[0]).toBe('after 1 turn');
    expect(Object.keys(afterTurns(2))[0]).toBe('after 2 turns');
    expect(Object.keys(afterTurns(3))[0]).toBe('after 3 turns');
  });

  it('afterTurns(2): false at start, false after 1 turn, true after 2 turns', () => {
    const runner = makeRunner();
    const condition = afterTurns(2);

    // Start: 0 turns
    expect(evalCondition(condition, runner.game, 1)).toBe(false);

    // After seat 1's first turn
    act(runner, 1);
    expect(evalCondition(condition, runner.game, 1)).toBe(false);

    // After seat 2's first turn (round 1 complete)
    act(runner, 2);
    expect(evalCondition(condition, runner.game, 1)).toBe(false);

    // After seat 1's second turn — should now be true
    act(runner, 1);
    expect(evalCondition(condition, runner.game, 1)).toBe(true);
  });

  it('afterTurns(2) remains true after further turns', () => {
    const runner = makeRunner();
    const condition = afterTurns(2);

    act(runner, 1); // turn 1
    act(runner, 2);
    act(runner, 1); // turn 2

    expect(evalCondition(condition, runner.game, 1)).toBe(true);

    act(runner, 2);
    act(runner, 1); // turn 3

    expect(evalCondition(condition, runner.game, 1)).toBe(true);
  });

  it('integrates with evaluateAdvanceWhen from Plan 01 — fired=false after 1 turn, true after 2', () => {
    const runner = makeRunner();

    const tutorialDef: TutorialDefinition = {
      steps: [
        {
          id: 'intro',
          gate: { action: 'move' },
          advanceWhen: { ...afterTurns(2) },
        },
        { id: 'next', gate: { action: 'pass' } },
      ],
    };

    runner.game.tutorialDefinition = tutorialDef;
    runner.game.tutorialProgress.set(1, { stepId: 'intro', status: 'running' });

    // Before any action
    expect(evaluateAdvanceWhen(runner.game, 1).fired).toBe(false);

    // After seat 1's first turn
    act(runner, 1);
    expect(evaluateAdvanceWhen(runner.game, 1).fired).toBe(false);

    // After seat 2's first turn (round 1 complete)
    act(runner, 2);
    expect(evaluateAdvanceWhen(runner.game, 1).fired).toBe(false);

    // After seat 1's second turn — evaluateAdvanceWhen must report fired=true
    act(runner, 1);
    expect(evaluateAdvanceWhen(runner.game, 1).fired).toBe(true);
  });

  it('returns false when game has no flow state (safety guard)', () => {
    // Game with no flow set
    const bareGame = new PredicateTestGame({ playerCount: 2 });
    const condition = afterTurns(1);
    expect(evalCondition(condition, bareGame, 1)).toBe(false);
  });
});

// ============================================================
// whenForced tests
// ============================================================

describe('whenForced(actionName)', () => {
  it('returns a labeled condition with a descriptive key', () => {
    const key = Object.keys(whenForced('move'))[0];
    expect(key).toBe('move is the only available action');
  });

  it('is FALSE when multiple actions are available', () => {
    const runner = makeRunner();
    // Both 'move' and 'pass' are available by default (forcedMode = false)
    const condition = whenForced('move');
    expect(evalCondition(condition, runner.game, 1)).toBe(false);
  });

  it('is TRUE when the named action is the sole available action', () => {
    const runner = makeRunner();
    runner.game.forcedMode = true; // disables 'pass' → only 'move' available
    const condition = whenForced('move');
    expect(evalCondition(condition, runner.game, 1)).toBe(true);
  });

  it('is FALSE when a DIFFERENT action is the sole available one', () => {
    const runner = makeRunner();
    runner.game.forcedMode = true; // only 'move' available
    // We check for 'pass', which is NOT the sole available action
    const condition = whenForced('pass');
    expect(evalCondition(condition, runner.game, 1)).toBe(false);
  });

  it('is FALSE when the seat has no player', () => {
    const runner = makeRunner();
    runner.game.forcedMode = true;
    // Seat 99 does not exist
    const condition = whenForced('move');
    expect(evalCondition(condition, runner.game, 99)).toBe(false);
  });
});

// ============================================================
// Labeled key / spread composition
// ============================================================

describe('predicate composition and label uniqueness', () => {
  it('helpers produce distinct labels enabling safe object-spread into advanceWhen', () => {
    const combined: TutorialAdvanceCondition = {
      ...afterTurns(2),
      ...whenForced('capture'),
    };
    const keys = Object.keys(combined);
    expect(keys).toHaveLength(2);
    expect(keys).toContain('after 2 turns');
    expect(keys).toContain('capture is the only available action');
  });
});
