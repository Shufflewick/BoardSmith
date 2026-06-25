/**
 * Tutorial action-gating engine tests (TUT-02).
 *
 * Verifies that the tutorial gate substrate:
 *   1. Surfaces a reason for out-of-step actions via getTutorialDisabledActions —
 *      not silently dropped (success criterion #3).
 *   2. Disables non-allowed targets in getChoices with a non-empty reason string,
 *      leaving the allowed target enabled (target-level granularity).
 *   3. hasValidSelectionPath keeps the gated action available when ≥1 target allowed.
 *   4. validateSelection rejects a disabled (non-allowed) value with "Selection disabled:".
 *   5. With NO tutorial running, gating is inert — all choices enabled, empty
 *      disabled-action map (zero overhead in normal play).
 *
 * Uses a minimal in-test Game subclass; does NOT depend on external game packages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Action, ActionExecutor } from '../index.js';
import type { TutorialDefinition, TutorialProgress } from '../tutorial/types.js';

// ============================================================
// Minimal test game
// ============================================================

/**
 * Minimal two-player game with:
 *   - `move` action: choose piece (c3, e5) then choose destination (d4, f6)
 *   - `pass` action: no selections, just end turn
 */
class TutorialTestGame extends Game<TutorialTestGame, Player> {}

/** Build the move action definition (two-step: piece → destination). */
function makeMoveAction() {
  return Action.create('move')
    .chooseFrom('piece', { choices: ['c3', 'e5'] })
    .chooseFrom('destination', { choices: ['d4', 'f6'] })
    .execute(() => {});
}

/** Build the pass action definition (no selections). */
function makePassAction() {
  return Action.create('pass')
    .execute(() => {});
}

/** Tutorial definition: step 1 gates to `move` only, piece c3 → destination d4. */
const tutorialDef: TutorialDefinition = {
  steps: [
    {
      id: 'step1',
      gate: { action: 'move', from: 'c3', to: 'd4' },
    },
  ],
};

/** Running progress for seat 1 at step1. */
const runningProgress: TutorialProgress = { stepId: 'step1', status: 'running' };

// ============================================================
// Test setup helpers
// ============================================================

function makeGame(withTutorial: boolean): TutorialTestGame {
  const game = new TutorialTestGame({ playerCount: 2 });
  game.registerActions(makeMoveAction(), makePassAction());

  if (withTutorial) {
    game.tutorialDefinition = tutorialDef;
    game.tutorialProgress.set(1, runningProgress);
  }

  return game;
}

// ============================================================
// Tests
// ============================================================

describe('Tutorial gate — TUT-02', () => {
  let game: TutorialTestGame;
  let executor: ActionExecutor;
  let player1: Player;
  let player2: Player;

  describe('with tutorial running for seat 1', () => {
    beforeEach(() => {
      game = makeGame(true);
      executor = game.getActionExecutor();
      player1 = game.getPlayer(1)!;
      player2 = game.getPlayer(2)!;
    });

    // ------------------------------------------------------------------
    // Behavior 1: Out-of-step action surfaces a reason (not silent)
    // ------------------------------------------------------------------

    it('getTutorialDisabledActions names the out-of-step action with a reason', () => {
      const disabled = game.getTutorialDisabledActions(1);

      expect(typeof disabled).toBe('object');
      // `pass` is NOT the gated step's action — it must appear with a non-empty reason
      expect('pass' in disabled).toBe(true);
      expect(disabled['pass']).toBeTruthy();
      expect(disabled['pass'].length).toBeGreaterThan(0);
    });

    it('getTutorialDisabledActions does NOT include the allowed action', () => {
      const disabled = game.getTutorialDisabledActions(1);

      // `move` IS the allowed action for this step — must not be listed
      expect('move' in disabled).toBe(false);
    });

    // ------------------------------------------------------------------
    // Behavior 2: Target gating — allowed target enabled, others disabled
    // ------------------------------------------------------------------

    it('getChoices: piece selection — c3 enabled (matches gate.from), e5 disabled with reason', () => {
      const moveAction = game.getAction('move')!;
      const pieceSel = moveAction.selections[0]; // 'piece' selection

      const choices = executor.getChoices(pieceSel, player1, {}, 'move');

      const c3Entry = choices.find(c => c.value === 'c3');
      const e5Entry = choices.find(c => c.value === 'e5');

      expect(c3Entry).toBeDefined();
      expect(c3Entry!.disabled).toBe(false);

      expect(e5Entry).toBeDefined();
      expect(typeof e5Entry!.disabled).toBe('string');
      expect((e5Entry!.disabled as string).length).toBeGreaterThan(0);
    });

    it('getChoices: destination selection — d4 enabled (matches gate.to), f6 disabled with reason', () => {
      const moveAction = game.getAction('move')!;
      const destSel = moveAction.selections[1]; // 'destination' selection

      const choices = executor.getChoices(destSel, player1, {}, 'move');

      const d4Entry = choices.find(c => c.value === 'd4');
      const f6Entry = choices.find(c => c.value === 'f6');

      expect(d4Entry).toBeDefined();
      expect(d4Entry!.disabled).toBe(false);

      expect(f6Entry).toBeDefined();
      expect(typeof f6Entry!.disabled).toBe('string');
      expect((f6Entry!.disabled as string).length).toBeGreaterThan(0);
    });

    it('the disabled reason string for a non-allowed target is consistent with getTutorialDisabledActions pattern', () => {
      const moveAction = game.getAction('move')!;
      const destSel = moveAction.selections[1];

      const choices = executor.getChoices(destSel, player1, {}, 'move');
      const f6Entry = choices.find(c => c.value === 'f6')!;

      // Reason must be a non-empty, actionable string
      expect(f6Entry.disabled).not.toBe(false);
      expect(typeof f6Entry.disabled).toBe('string');
      expect((f6Entry.disabled as string).trim().length).toBeGreaterThan(0);
    });

    // ------------------------------------------------------------------
    // Behavior 3: hasValidSelectionPath keeps gated action available
    // ------------------------------------------------------------------

    it('move action remains available despite target gating (hasValidSelectionPath)', () => {
      // getAvailableActions uses isActionAvailable → hasValidSelectionPath
      const available = game.getAvailableActions(player1);
      const names = available.map(a => a.name);

      expect(names).toContain('move');
    });

    it('pass action also remains available (it is not value-gated, just action-level flagged)', () => {
      const available = game.getAvailableActions(player1);
      const names = available.map(a => a.name);

      expect(names).toContain('pass');
    });

    // ------------------------------------------------------------------
    // Behavior 4: validateSelection rejects a disabled (non-allowed) value
    // ------------------------------------------------------------------

    it('validateSelection rejects a non-allowed destination with "Selection disabled:"', () => {
      const moveAction = game.getAction('move')!;
      const destSel = moveAction.selections[1]; // 'destination' selection

      const result = executor.validateSelection(destSel, 'f6', player1, {}, 'move');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.startsWith('Selection disabled:'))).toBe(true);
    });

    it('validateSelection accepts the allowed destination', () => {
      const moveAction = game.getAction('move')!;
      const destSel = moveAction.selections[1];

      const result = executor.validateSelection(destSel, 'd4', player1, {}, 'move');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    // ------------------------------------------------------------------
    // Gate isolation: player 2 (not tutorialized) is unaffected
    // ------------------------------------------------------------------

    it('player 2 (no tutorial progress) sees all destinations enabled', () => {
      const moveAction = game.getAction('move')!;
      const destSel = moveAction.selections[1];

      const choices = executor.getChoices(destSel, player2, {}, 'move');

      expect(choices.every(c => c.disabled === false)).toBe(true);
    });

    it('getTutorialDisabledActions returns {} for seat 2 (no tutorial running)', () => {
      const disabled = game.getTutorialDisabledActions(2);

      expect(disabled).toEqual({});
    });
  });

  // ------------------------------------------------------------------
  // Behavior 5: Without tutorial — gating is fully inert
  // ------------------------------------------------------------------

  describe('without tutorial (normal play)', () => {
    beforeEach(() => {
      game = makeGame(false);
      executor = game.getActionExecutor();
      player1 = game.getPlayer(1)!;
    });

    it('getChoices for destination selection: all choices enabled (no gate)', () => {
      const moveAction = game.getAction('move')!;
      const destSel = moveAction.selections[1];

      const choices = executor.getChoices(destSel, player1, {}, 'move');

      expect(choices).toEqual([
        { value: 'd4', disabled: false },
        { value: 'f6', disabled: false },
      ]);
    });

    it('getChoices for piece selection: all choices enabled (no gate)', () => {
      const moveAction = game.getAction('move')!;
      const pieceSel = moveAction.selections[0];

      const choices = executor.getChoices(pieceSel, player1, {}, 'move');

      expect(choices).toEqual([
        { value: 'c3', disabled: false },
        { value: 'e5', disabled: false },
      ]);
    });

    it('getTutorialDisabledActions returns {} (no tutorial)', () => {
      const disabled = game.getTutorialDisabledActions(1);

      expect(disabled).toEqual({});
    });

    it('both move and pass are available in normal play', () => {
      const available = game.getAvailableActions(player1);
      const names = available.map(a => a.name);

      expect(names).toContain('move');
      expect(names).toContain('pass');
    });

    it('validateSelection on any destination is valid (no gate)', () => {
      const moveAction = game.getAction('move')!;
      const destSel = moveAction.selections[1];

      const result = executor.validateSelection(destSel, 'f6', player1, {}, 'move');

      expect(result.valid).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Predicate gate variant (escape hatch)
  // ------------------------------------------------------------------

  describe('predicate gate (escape hatch)', () => {
    it('blocks all available actions when predicate returns false', () => {
      const predicateGame = makeGame(false);
      predicateGame.tutorialDefinition = {
        steps: [
          {
            id: 'pred-step',
            gate: (_ctx) => false, // always block
          },
        ],
      };
      predicateGame.tutorialProgress.set(1, { stepId: 'pred-step', status: 'running' });
      predicateGame.registerActions(makeMoveAction(), makePassAction());

      const disabled = predicateGame.getTutorialDisabledActions(1);

      expect('move' in disabled).toBe(true);
      expect('pass' in disabled).toBe(true);
    });

    it('permits all actions when predicate returns true', () => {
      const predicateGame = makeGame(false);
      predicateGame.tutorialDefinition = {
        steps: [
          {
            id: 'pred-step',
            gate: (_ctx) => true, // always permit
          },
        ],
      };
      predicateGame.tutorialProgress.set(1, { stepId: 'pred-step', status: 'running' });
      predicateGame.registerActions(makeMoveAction(), makePassAction());

      const disabled = predicateGame.getTutorialDisabledActions(1);

      expect(disabled).toEqual({});
    });

    it('does not apply per-value gating for predicate gates', () => {
      const predicateGame = makeGame(false);
      predicateGame.tutorialDefinition = {
        steps: [
          {
            id: 'pred-step',
            gate: (_ctx) => false, // block at action level
          },
        ],
      };
      predicateGame.tutorialProgress.set(1, { stepId: 'pred-step', status: 'running' });
      predicateGame.registerActions(makeMoveAction(), makePassAction());

      const pred1Executor = predicateGame.getActionExecutor();
      const pred1Player1 = predicateGame.getPlayer(1)!;
      const moveAction = predicateGame.getAction('move')!;
      const destSel = moveAction.selections[1];

      // Predicate gate: per-value choices are NOT gated (no from/to available)
      const choices = pred1Executor.getChoices(destSel, pred1Player1, {}, 'move');

      expect(choices.every(c => c.disabled === false)).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Completed/exited tutorial — gate is lifted
  // ------------------------------------------------------------------

  describe('when tutorial is completed or exited', () => {
    it('completed status: gating is inert', () => {
      game = makeGame(false);
      game.tutorialDefinition = tutorialDef;
      game.tutorialProgress.set(1, { stepId: 'step1', status: 'completed' });
      game.registerActions(makeMoveAction(), makePassAction());

      const disabled = game.getTutorialDisabledActions(1);
      expect(disabled).toEqual({});
    });

    it('exited status: gating is inert', () => {
      game = makeGame(false);
      game.tutorialDefinition = tutorialDef;
      game.tutorialProgress.set(1, { stepId: 'step1', status: 'exited' });
      game.registerActions(makeMoveAction(), makePassAction());

      const disabled = game.getTutorialDisabledActions(1);
      expect(disabled).toEqual({});
    });
  });
});
