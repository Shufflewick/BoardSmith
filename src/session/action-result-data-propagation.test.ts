/**
 * BUG-017 / BUG-012 — `ActionResult.data` (and `.message`) must survive every
 * layer between the action's `execute()` and the caller of the op.
 *
 * The defect this file exists to catch was invisible to every author-level
 * test, because `game.performAction()` has always returned the real
 * `ActionResult`. What dropped `data` was the chain ABOVE the engine — the
 * flow state, the runner, the session, the stateless-ops envelope, and the
 * dev-host response whitelist — four hand-maintained field lists, each of
 * which silently omits a field by default.
 *
 * So every assertion here is made on the FAR side of a layer boundary. None of
 * them calls `game.performAction()`.
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  actionStep,
  loop,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { GameSession } from './game-session.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { shapeResult } from '../cli/dev-host/bridge.js';

// The map an action "returns" to the seat that paid for it. Structured, not
// prose — the exact thing `message`/`messageTo` cannot carry.
const CARTOGRAPHY = { sectors: ['a1', 'b2', 'c3'], gps: false };
const NARRATION = 'You recall the shape of the coastline.';

/**
 * A game with one single-step action and one two-step action, both of which
 * return `data` + `message` from `execute()`. Both live in the same looping
 * action step so seat 1 can take either at any time.
 */
class ReportingGame extends Game<ReportingGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('viewMap').execute(() => ({
        success: true,
        data: { cartography: CARTOGRAPHY },
        message: NARRATION,
      }))
    );

    this.registerAction(
      Action.create('appraise')
        .chooseFrom('item', { choices: ['sword', 'shield'] })
        .chooseFrom('lens', { choices: ['coarse', 'fine'] })
        .execute((args: Record<string, unknown>) => ({
          success: true,
          data: { appraisal: `${args.item as string}:${args.lens as string}` },
          message: NARRATION,
        }))
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({
            actions: ['viewMap', 'appraise'],
            player: (ctx) => ctx.game.getPlayer(1)!,
            repeatUntil: () => false,
          }),
        }),
      })
    );
  }
}

const gameDef: GameDefinitionLike = {
  gameClass: ReportingGame,
  gameType: 'reporting',
  minPlayers: 1,
  maxPlayers: 2,
};

const gameOptions = { playerCount: 2, seed: 'bug-017' };

function makeRunner(): GameRunner<ReportingGame> {
  const runner = new GameRunner({
    GameClass: ReportingGame,
    gameType: 'reporting',
    gameOptions: { playerCount: 2, seed: 'bug-017' },
  });
  runner.start();
  return runner;
}

function makeSession() {
  return GameSession.create({
    gameType: 'reporting',
    GameClass: ReportingGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'bug-017',
  });
}

describe('BUG-017 — ActionResult.data across layer boundaries', () => {
  describe('GameRunner.performAction', () => {
    it('returns data and message on ActionExecutionResult', () => {
      const runner = makeRunner();
      const result = runner.performAction('viewMap', 1, {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ cartography: CARTOGRAPHY });
      expect(result.message).toBe(NARRATION);
    });

    it('keeps data off the broadcast flowState and player views', () => {
      const runner = makeRunner();
      const result = runner.performAction('viewMap', 1, {});

      // `flowState` and `playerViews` reach every seat and the spectator.
      // `data` is the acting seat's private return value and must not ride them.
      expect(JSON.stringify(result.flowState)).not.toContain('cartography');
      expect(JSON.stringify(result.playerViews)).not.toContain('cartography');
    });
  });

  describe('GameRunner.processSelectionStep (multi-step, session-free)', () => {
    it('returns the completed action data on the final step only', () => {
      const runner = makeRunner();
      runner.startPendingAction('appraise', 1);

      const mid = runner.processSelectionStep(1, 'item', 'shield');
      expect(mid.actionComplete).toBe(false);
      expect(mid.data).toBeUndefined();

      const done = runner.processSelectionStep(1, 'lens', 'coarse');
      expect(done.actionComplete).toBe(true);
      expect(done.data).toEqual({ appraisal: 'shield:coarse' });
      expect(done.message).toBe(NARRATION);
    });
  });

  describe('GameSession.performAction', () => {
    it('returns data and message to the acting seat', async () => {
      const session = makeSession();
      const result = await session.performAction('viewMap', 1, {});

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ cartography: CARTOGRAPHY });
      expect(result.message).toBe(NARRATION);
    });
  });

  describe('GameSession.processSelectionStep', () => {
    it('returns data and message on the step that completes the action', async () => {
      const session = makeSession();

      const mid = await session.processSelectionStep(1, 'item', 'sword', 'appraise');
      expect(mid.actionComplete).toBeFalsy();
      expect(mid.data).toBeUndefined();

      const done = await session.processSelectionStep(1, 'lens', 'fine');
      expect(done.actionComplete).toBe(true);
      expect(done.data).toEqual({ appraisal: 'sword:fine' });
      expect(done.message).toBe(NARRATION);
      expect(done.actionResult?.data).toEqual({ appraisal: 'sword:fine' });
    });
  });

  describe('executeOp — the shape the executor returns over the wire', () => {
    it('action op carries data and message', async () => {
      const start = await executeOp(gameDef, gameOptions, null, null, { type: 'start' });
      expect(start.success).toBe(true);

      const result = await executeOp(gameDef, gameOptions, start.snapshot, null, {
        type: 'action',
        actionName: 'viewMap',
        player: 1,
        args: {},
        boundaryKey: boundaryKeyOf(start.snapshot),
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ cartography: CARTOGRAPHY });
      expect(result.message).toBe(NARRATION);
    });

    it('selectionStep op carries data and message on the completing step', async () => {
      const start = await executeOp(gameDef, gameOptions, null, null, { type: 'start' });

      const step1 = await executeOp(gameDef, gameOptions, start.snapshot, null, {
        type: 'selectionStep',
        actionName: 'appraise',
        player: 1,
        selectionName: 'item',
        value: 'shield',
        boundaryKey: boundaryKeyOf(start.snapshot),
      });
      expect(step1.success).toBe(true);
      expect(step1.data).toBeUndefined();

      const step2 = await executeOp(gameDef, gameOptions, step1.snapshot, step1.pendingState, {
        type: 'selectionStep',
        actionName: 'appraise',
        player: 1,
        selectionName: 'lens',
        value: 'fine',
        boundaryKey: boundaryKeyOf(step1.snapshot),
      });

      expect(step2.actionComplete).toBe(true);
      expect(step2.data).toEqual({ appraisal: 'shield:fine' });
      expect(step2.message).toBe(NARRATION);
    });

    it('does not publish data into any seat\'s player view', async () => {
      const start = await executeOp(gameDef, gameOptions, null, null, { type: 'start' });
      const result = await executeOp(gameDef, gameOptions, start.snapshot, null, {
        type: 'action',
        actionName: 'viewMap',
        player: 1,
        args: {},
        boundaryKey: boundaryKeyOf(start.snapshot),
      });

      // The whole point of `data` is that it goes to the acting caller only.
      // A view that carried it would leak one seat's private report to the table.
      for (const view of result.playerViews as Array<{ flowState?: Record<string, unknown> }>) {
        expect(view.flowState?.data).toBeUndefined();
      }
      expect(JSON.stringify(result.playerViews)).not.toContain('cartography');
      expect(JSON.stringify(result.spectatorView ?? null)).not.toContain('cartography');
    });
  });

  describe('shapeResult — the dev-host response whitelist', () => {
    it('action responses keep data and message', async () => {
      const start = await executeOp(gameDef, gameOptions, null, null, { type: 'start' });
      const opResult = await executeOp(gameDef, gameOptions, start.snapshot, null, {
        type: 'action',
        actionName: 'viewMap',
        player: 1,
        args: {},
        boundaryKey: boundaryKeyOf(start.snapshot),
      });

      const shaped = shapeResult('action', opResult);

      expect(shaped.data).toEqual({ cartography: CARTOGRAPHY });
      expect(shaped.message).toBe(NARRATION);
    });

    it('selection_step responses keep data and message', async () => {
      const start = await executeOp(gameDef, gameOptions, null, null, { type: 'start' });
      const step1 = await executeOp(gameDef, gameOptions, start.snapshot, null, {
        type: 'selectionStep',
        actionName: 'appraise',
        player: 1,
        selectionName: 'item',
        value: 'sword',
        boundaryKey: boundaryKeyOf(start.snapshot),
      });
      const step2 = await executeOp(gameDef, gameOptions, step1.snapshot, step1.pendingState, {
        type: 'selectionStep',
        actionName: 'appraise',
        player: 1,
        selectionName: 'lens',
        value: 'coarse',
        boundaryKey: boundaryKeyOf(step1.snapshot),
      });

      const shaped = shapeResult('selection_step', step2);

      expect(shaped.data).toEqual({ appraisal: 'sword:coarse' });
      expect(shaped.message).toBe(NARRATION);
    });
  });
});
