import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions, type TutorialDefinition } from '../engine/index.js';
import type { AIConfig } from '../ai/types.js';
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
        .chooseFrom('color', {
          choices: ['red', 'blue', 'green'],
        })
        .chooseFrom('size', { choices: ['S', 'M', 'L'] })
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

  // ── startTutorial ─────────────────────────────────────────────────────────

  describe('startTutorial', () => {
    const SIMPLE_TUTORIAL: TutorialDefinition = {
      steps: [
        {
          id: 'intro',
          gate: { action: 'pass' },
          content: [{ text: 'Take a pass action.' }],
        },
      ],
    };

    const simpleGameWithTutorialDef: GameDefinitionLike = {
      ...simpleGameDef,
      tutorial: SIMPLE_TUTORIAL,
    };

    it('succeeds and sets tutorialProgress for the given seat when tutorial definition is present', async () => {
      const startResult = await startGame(simpleGameWithTutorialDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      const result = await executeOp(
        simpleGameWithTutorialDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'startTutorial', player: 1 },
      );

      expect(result.success).toBe(true);
      expect(result.snapshot).toBeTruthy();
      // The tutorial step view for seat 1 should now be present in the player view
      const view = (result.playerViews as Array<{ state: { tutorial?: unknown } }>)?.[0];
      expect(view?.state?.tutorial).toBeDefined();
    });

    it('fails with an error when the game has no tutorial definition', async () => {
      const startResult = await startGame(simpleGameDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      const result = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'startTutorial', player: 1 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No tutorial definition/);
      expect(result.category).toBe('protocol');
    });

    it('broadcasts hasTutorial: true in state when tutorial definition is present', async () => {
      const startResult = await startGame(simpleGameWithTutorialDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      // hasTutorial must be present in the initial broadcast (not just after startTutorial)
      const view = (startResult.playerViews as Array<{ state: { hasTutorial?: boolean } }>)?.[0];
      expect(view?.state?.hasTutorial).toBe(true);
    });

    it('rejects invalid seat (0) with a protocol error', async () => {
      const startResult = await startGame(simpleGameWithTutorialDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      const result = await executeOp(
        simpleGameWithTutorialDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'startTutorial', player: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid player seat/);
      expect(result.category).toBe('protocol');
    });
  });

  // ── autoAdvanceTutorial in handleAction (CR-01 regression) ───────────────

  describe('autoAdvanceTutorial in handleAction (CR-01 regression)', () => {
    // A game with a passCount property so advanceWhen can read game state.
    // passCount increments when the 'pass' action executes — used to prove the
    // post-action auto-advance pump fires inside executeOp.
    class CountingGame extends Game<CountingGame, Player> {
      passCount = 0;

      constructor(options: GameOptions) {
        super(options);

        const game = this;
        this.registerAction(
          Action.create('pass')
            .execute(() => {
              game.passCount++;
              return { success: true };
            })
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

    const TWO_STEP_TUTORIAL: TutorialDefinition = {
      steps: [
        {
          id: 'step-1',
          gate: { action: 'pass' },
          advanceWhen: {
            'passed once': (ctx) => (ctx.game as CountingGame).passCount >= 1,
          },
        },
        {
          id: 'step-2',
          gate: { action: 'pass' },
        },
      ],
    };

    const countingGameDef: GameDefinitionLike = {
      gameClass: CountingGame as new (...args: unknown[]) => unknown,
      gameType: 'counting',
      minPlayers: 1,
      maxPlayers: 2,
      tutorial: TWO_STEP_TUTORIAL,
    };

    const countingGameOptions = { playerCount: 2, seed: 'count-seed' };

    it('tutorial auto-advances after action in the dev-host stateless path', async () => {
      // Start the game.
      const startResult = await executeOp(countingGameDef, countingGameOptions, null, null, { type: 'start' });
      expect(startResult.success).toBe(true);

      // Start tutorial for seat 1 — tutorial should land on step-1.
      const tutorialStartResult = await executeOp(
        countingGameDef,
        countingGameOptions,
        startResult.snapshot,
        null,
        { type: 'startTutorial', player: 1 },
      );
      expect(tutorialStartResult.success).toBe(true);
      const viewBefore = (tutorialStartResult.playerViews as Array<{ state: { tutorial?: { stepId?: string } } }>)?.[0];
      expect(viewBefore?.state?.tutorial?.stepId).toBe('step-1');

      // Perform 'pass' — advanceWhen fires because passCount goes from 0 to 1.
      const actionResult = await executeOp(
        countingGameDef,
        countingGameOptions,
        tutorialStartResult.snapshot,
        null,
        { type: 'action', actionName: 'pass', player: 1, args: {} },
      );
      expect(actionResult.success).toBe(true);

      // Tutorial MUST advance to step-2 — proves autoAdvanceTutorial is called
      // in handleAction (the dev-host / stateless executor path). Without the
      // CR-01 fix, the tutorial stays on step-1 because autoAdvanceTutorial was
      // never called in this path.
      const viewAfter = (actionResult.playerViews as Array<{ state: { tutorial?: { stepId?: string } } }>)?.[0];
      expect(viewAfter?.state?.tutorial?.stepId).toBe('step-2');
    });
  });

  // ── Teaching ops: hint + heatmapToggle (Plan 110-02) ──────────────────────
  //
  // Uses an inline BotGame fixture: two-player game where player 1 chooses from
  // 'direction': ['left', 'right'] — 2+ legal moves so MCTS has a real choice.
  // MEMORY: MCTS short-circuits when only 1 move is available (skips clone).
  // 2+ choices guarantee real MCTS branching for hint/heatmap tests.

  describe('hint + heatmapToggle teaching ops', () => {

    // BotGame: player 1 loops choosing from ['left', 'right'] — 2 legal moves.
    class BotGame extends Game<BotGame, Player> {
      moveCount = 0;

      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create('move')
            .chooseFrom('direction', { choices: ['left', 'right'] })
            .execute(() => {
              this.moveCount++;
              return { success: true };
            }),
        );
        this.setFlow(
          defineFlow({
            root: loop({
              maxIterations: 100,
              do: actionStep({
                actions: ['move'],
                player: (ctx) => ctx.game.getPlayer(1)!,
              }),
            }),
          }),
        );
      }
    }

    interface BotGameDefinitionLike extends GameDefinitionLike {
      ai?: AIConfig;
    }

    const botGameAI: AIConfig = {
      objectives: (_game, _playerIndex) => ({
        moves: {
          checker: (game) => Math.min(1, (game as BotGame).moveCount / 20),
          weight: 1,
        },
      }),
      // Extract 'direction' arg as notation so heatmap entries have a cell ref.
      // Without this, DEST_ARGS fallback wouldn't find 'direction' and entries would
      // be empty (heatmap dedup only aggregates moves that have an extractable target).
      hintTargetFromMove: (move) => {
        const dir = (move.args as { direction?: string }).direction;
        return dir ? { notation: dir } : undefined;
      },
    };

    const botGameDef: BotGameDefinitionLike = {
      gameClass: BotGame as new (...args: unknown[]) => unknown,
      gameType: 'bot-game',
      minPlayers: 1,
      maxPlayers: 2,
      ai: botGameAI,
    };

    const botGameOptions = { playerCount: 2, seed: 'bot-seed' };

    async function startBotGame() {
      const res = await executeOp(botGameDef, botGameOptions, null, null, { type: 'start' });
      if (!res.success) throw new Error('start failed');
      return res.snapshot;
    }

    // ── hint: success path ─────────────────────────────────────────────────

    it('hint returns hintAnnotation with text "Suggested move" when seat is awaiting input', async () => {
      const snapshot = await startBotGame();
      const res = await executeOp(botGameDef, botGameOptions, snapshot, null, { type: 'hint', seat: 1 });

      expect(res.success).toBe(true);
      expect(res.hintAnnotation).toBeDefined();
      expect(res.hintAnnotation!.seat).toBe(1);
      expect(res.hintAnnotation!.annotation.text).toBe('Suggested move');
    });

    // ── hint: fail-loud — seat not awaiting input ─────────────────────────

    it('hint returns a protocol error when seat is not awaiting input', async () => {
      const snapshot = await startBotGame();
      // Seat 2 never acts in BotGame — seat 1 always goes
      const res = await executeOp(botGameDef, botGameOptions, snapshot, null, { type: 'hint', seat: 2 });

      expect(res.success).toBe(false);
      expect(res.category).toBe('protocol');
      expect(res.error).toMatch(/not awaiting input/i);
    });

    // ── hint: fail-loud — no AI config ────────────────────────────────────

    it('hint returns a protocol error when no AI config is on the definition', async () => {
      const snapshot = await startBotGame();
      // Explicitly exclude `ai` so the def has no AI config.
      const { ai: _ai, ...noAiDef } = botGameDef;
      const res = await executeOp(noAiDef, botGameOptions, snapshot, null, { type: 'hint', seat: 1 });

      expect(res.success).toBe(false);
      expect(res.category).toBe('protocol');
      expect(res.error).toMatch(/No AI configuration/i);
    });

    // ── heatmapToggle visible=true: success path ───────────────────────────

    it('heatmapToggle visible=true returns heatmapUpdate with exactly one isBest entry', async () => {
      const snapshot = await startBotGame();
      const res = await executeOp(botGameDef, botGameOptions, snapshot, null, {
        type: 'heatmapToggle', seat: 1, visible: true,
      });

      expect(res.success).toBe(true);
      expect(res.heatmapUpdate).toBeDefined();
      expect(res.heatmapUpdate!.seat).toBe(1);
      expect(res.heatmapUpdate!.visible).toBe(true);

      const entries = res.heatmapUpdate!.entries;
      expect(entries.length).toBeGreaterThan(0);
      const bestCount = entries.filter((e) => e.isBest).length;
      expect(bestCount).toBe(1);
    });

    // ── heatmapToggle visible=false: short-circuit — no bot call ──────────

    it('heatmapToggle visible=false returns empty entries without running MCTS', async () => {
      // Use a def with NO ai config — if the bot were constructed it would error.
      // visible=false must short-circuit BEFORE checking for ai config.
      const { ai: _ai, ...noAiDef } = botGameDef;
      const snapshot = await startBotGame();
      const res = await executeOp(noAiDef, botGameOptions, snapshot, null, {
        type: 'heatmapToggle', seat: 1, visible: false,
      });

      expect(res.success).toBe(true);
      expect(res.heatmapUpdate).toBeDefined();
      expect(res.heatmapUpdate!.visible).toBe(false);
      expect(res.heatmapUpdate!.entries).toHaveLength(0);
    });

  });
});
