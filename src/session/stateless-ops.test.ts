import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';

// ---------------------------------------------------------------------------
// Inline game: player 1 repeatedly takes a "pass" action in a loop.
// Using a loop means player 1 remains the current player after each pass,
// which allows undo tests to work (undo checks currentPlayer === player).
// ---------------------------------------------------------------------------

class SimpleGame extends Game<SimpleGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pass')
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({
          actions: ['pass'],
          player: (ctx) => ctx.game.getPlayer(1)!,
        }),
      }),
    }));
  }
}

const simpleGameDef: GameDefinitionLike = {
  gameClass: SimpleGame as new (...args: unknown[]) => unknown,
  gameType: 'simple',
  minPlayers: 1,
  maxPlayers: 4,
};

const simpleGameOptions = { playerCount: 2, seed: 'test-seed' };

// ---------------------------------------------------------------------------
// Inline game: action returns a followUp chain
// ---------------------------------------------------------------------------

class FollowUpGame extends Game<FollowUpGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('begin')
        .execute(() => ({
          success: true,
          followUp: { action: 'finish', args: {} },
        }))
    );

    this.registerAction(
      Action.create('finish')
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({
          actions: ['begin', 'finish'],
          player: (ctx) => ctx.game.getPlayer(1)!,
        }),
      }),
    }));
  }
}

const followUpGameDef: GameDefinitionLike = {
  gameClass: FollowUpGame as new (...args: unknown[]) => unknown,
  gameType: 'followup',
  minPlayers: 1,
  maxPlayers: 2,
};

const followUpGameOptions = { playerCount: 2, seed: 'fu-seed' };

// ---------------------------------------------------------------------------
// Inline game: two-step selection action (for selectionStep / resolveChoices /
// cancelAction tests). Mirrors the TwoStepGame in pending-action-manager.test.ts.
// ---------------------------------------------------------------------------

class TwoStepGame extends Game<TwoStepGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom<string>('color', {
          choices: ['red', 'blue', 'green'],
        })
        .chooseFrom<string>('size', { choices: ['S', 'M', 'L'] })
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({
          actions: ['pick'],
          player: (ctx) => ctx.game.getPlayer(1)!,
        }),
      }),
    }));
  }
}

const twoStepGameDef: GameDefinitionLike = {
  gameClass: TwoStepGame as new (...args: unknown[]) => unknown,
  gameType: 'twostep',
  minPlayers: 1,
  maxPlayers: 2,
};

const twoStepGameOptions = { playerCount: 2, seed: 'step-seed' };

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function startGame(def: GameDefinitionLike, gameOptions: { playerCount: number; seed?: string }) {
  return executeOp(def, gameOptions, null, null, { type: 'start' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeOp', () => {

  // ── start ────────────────────────────────────────────────────────────────

  describe('start', () => {
    it('returns success, a truthy snapshot, views per player, and null pendingState', async () => {
      const result = await startGame(simpleGameDef, simpleGameOptions);

      expect(result.success).toBe(true);
      expect(result.snapshot).toBeTruthy();
      expect(result.playerViews).toHaveLength(simpleGameOptions.playerCount);
      expect(result.pendingState).toBeNull();
      expect(result.isComplete).toBe(false);
    });

    it('fails when playerCount is below minPlayers', async () => {
      // simpleGameDef.minPlayers = 1, so 0 is out-of-range
      const result = await executeOp(simpleGameDef, { playerCount: 0, seed: 'x' }, null, null, { type: 'start' });
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toMatch(/playerCount/);
      expect(result.category).toBe('protocol');
    });
  });

  // ── action ───────────────────────────────────────────────────────────────

  describe('action', () => {
    it('a valid action returns success and a changed snapshot', async () => {
      const startResult = await startGame(simpleGameDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      const actionResult = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'action', actionName: 'pass', player: 1, args: {} },
      );

      expect(actionResult.success).toBe(true);
      expect(JSON.stringify(actionResult.snapshot)).not.toBe(JSON.stringify(startResult.snapshot));
    });

    it('an unknown action returns success:false', async () => {
      const startResult = await startGame(simpleGameDef, simpleGameOptions);

      const result = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'action', actionName: 'nonexistent', player: 1, args: {} },
      );

      expect(result.success).toBe(false);
    });

    it('surfaces followUp with metadata when the action produces one', async () => {
      const startResult = await startGame(followUpGameDef, followUpGameOptions);
      expect(startResult.success).toBe(true);

      const actionResult = await executeOp(
        followUpGameDef,
        followUpGameOptions,
        startResult.snapshot,
        null,
        { type: 'action', actionName: 'begin', player: 1, args: {} },
      );

      expect(actionResult.success).toBe(true);
      expect(actionResult.followUp).toBeDefined();
      const fu = actionResult.followUp as { action: string; metadata?: unknown };
      expect(fu.action).toBe('finish');
      expect(fu.metadata).toBeDefined();
    });
  });

  // ── selectionStep ─────────────────────────────────────────────────────────

  describe('selectionStep', () => {
    it('first step returns actionComplete:false and non-null pendingState', async () => {
      const startResult = await startGame(twoStepGameDef, twoStepGameOptions);
      expect(startResult.success).toBe(true);

      const step1 = await executeOp(
        twoStepGameDef,
        twoStepGameOptions,
        startResult.snapshot,
        null,
        { type: 'selectionStep', player: 1, selectionName: 'color', value: 'red', actionName: 'pick' },
      );

      expect(step1.success).toBe(true);
      expect(step1.actionComplete).toBe(false);
      expect(step1.pendingState).not.toBeNull();
    });

    it('second step (feeding pendingState back) completes the action (pendingState round-trip)', async () => {
      const startResult = await startGame(twoStepGameDef, twoStepGameOptions);

      const step1 = await executeOp(
        twoStepGameDef,
        twoStepGameOptions,
        startResult.snapshot,
        null,
        { type: 'selectionStep', player: 1, selectionName: 'color', value: 'red', actionName: 'pick' },
      );
      expect(step1.success).toBe(true);
      expect(step1.pendingState).not.toBeNull();

      const step2 = await executeOp(
        twoStepGameDef,
        twoStepGameOptions,
        step1.snapshot,
        step1.pendingState,
        {
          type: 'selectionStep',
          player: 1,
          selectionName: 'size',
          value: 'M',
          actionName: 'pick',
          initialArgs: { color: 'red' },
        },
      );

      expect(step2.success).toBe(true);
      expect(step2.actionComplete).toBe(true);
      expect(step2.pendingState).toBeNull();
    });
  });

  // ── resolveChoices ────────────────────────────────────────────────────────

  describe('resolveChoices', () => {
    it('returns choices array for a chooseFrom selection', async () => {
      const startResult = await startGame(twoStepGameDef, twoStepGameOptions);
      expect(startResult.success).toBe(true);

      const result = await executeOp(
        twoStepGameDef,
        twoStepGameOptions,
        startResult.snapshot,
        null,
        {
          type: 'resolveChoices',
          actionName: 'pick',
          player: 1,
          selectionName: 'color',
          args: {},
        },
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.choices)).toBe(true);
      expect((result.choices as unknown[]).length).toBeGreaterThan(0);
    });
  });

  // ── cancelAction ──────────────────────────────────────────────────────────

  describe('cancelAction', () => {
    it('returns success with pendingState null after a partial selection', async () => {
      const startResult = await startGame(twoStepGameDef, twoStepGameOptions);

      const step1 = await executeOp(
        twoStepGameDef,
        twoStepGameOptions,
        startResult.snapshot,
        null,
        { type: 'selectionStep', player: 1, selectionName: 'color', value: 'red', actionName: 'pick' },
      );
      expect(step1.success).toBe(true);

      const cancelResult = await executeOp(
        twoStepGameDef,
        twoStepGameOptions,
        step1.snapshot,
        step1.pendingState,
        { type: 'cancelAction', player: 1 },
      );

      expect(cancelResult.success).toBe(true);
      expect(cancelResult.pendingState).toBeNull();
    });
  });

  // ── undo ─────────────────────────────────────────────────────────────────

  describe('undo', () => {
    it('restores the game to the state before the last action', async () => {
      const startResult = await startGame(simpleGameDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      // Player 1 takes a pass action. Because the flow is a loop, player 1
      // remains the current player after passing, so undo is allowed.
      const afterAction = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'action', actionName: 'pass', player: 1, args: {} },
      );
      expect(afterAction.success).toBe(true);
      const snapshotAfterAction = JSON.stringify(afterAction.snapshot);

      const undoResult = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        afterAction.snapshot,
        null,
        { type: 'undo', player: 1 },
      );

      expect(undoResult.success).toBe(true);
      expect(JSON.stringify(undoResult.snapshot)).not.toBe(snapshotAfterAction);
    });

    it('fails when there are no actions to undo', async () => {
      const startResult = await startGame(simpleGameDef, simpleGameOptions);

      const undoResult = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'undo', player: 1 },
      );

      expect(undoResult.success).toBe(false);
    });
  });

  // ── aiTurn ────────────────────────────────────────────────────────────────

  describe('aiTurn', () => {
    it('returns aiMoved:true when a flagged AI seat is due to act', async () => {
      const startResult = await startGame(simpleGameDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      // Player 1 is the current player; flag seat 1 as AI.
      const aiResult = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'aiTurn', seats: [{ seat: 1, level: 'easy' }] },
      );

      expect(aiResult.success).toBe(true);
      expect(aiResult.aiMoved).toBe(true);
      expect(aiResult.aiPlayer).toBe(1);
    });

    it('returns aiMoved:false when no flagged AI seat is currently due', async () => {
      const startResult = await startGame(simpleGameDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      // Seat 2 is flagged but player 1 is due to act — bot should not move.
      const aiResult = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'aiTurn', seats: [{ seat: 2, level: 'easy' }] },
      );

      expect(aiResult.success).toBe(true);
      expect(aiResult.aiMoved).toBe(false);
    });
  });
});
