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

    // ── heatmapToggle visible=false: seat validation applied BEFORE short-circuit

    it('heatmapToggle visible=false fails loud for out-of-range seat (WR-02: seat validation before short-circuit)', async () => {
      const snapshot = await startBotGame();

      // seat:0 is out-of-range — must fail the same way as visible=true does
      const res0 = await executeOp(botGameDef, botGameOptions, snapshot, null, {
        type: 'heatmapToggle', seat: 0, visible: false,
      });
      expect(res0.success).toBe(false);
      expect(res0.category).toBe('protocol');
      expect(res0.error).toMatch(/invalid seat/i);

      // seat:99 is also out-of-range
      const res99 = await executeOp(botGameDef, botGameOptions, snapshot, null, {
        type: 'heatmapToggle', seat: 99, visible: false,
      });
      expect(res99.success).toBe(false);
      expect(res99.category).toBe('protocol');

      // seat:1 is valid — visible=false must still succeed for in-range seats
      const resOk = await executeOp(botGameDef, botGameOptions, snapshot, null, {
        type: 'heatmapToggle', seat: 1, visible: false,
      });
      expect(resOk.success).toBe(true);
      expect(resOk.heatmapUpdate!.visible).toBe(false);
    });

  });

  // ── teachingDisabled lockout (Plan 111-02) ────────────────────────────────
  //
  // When gameOptions.teachingDisabled is true, hint / heatmapToggle / startTutorial
  // must each return a protocol error with the canonical lockout message. exitTutorial
  // must remain functional (D-06). Default (absent/false) leaves all ops working.

  describe('teachingDisabled lockout guards', () => {

    // Re-use a minimal BotGame (2 choices) for hint + heatmapToggle tests.
    class LockBotGame extends Game<LockBotGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create('move')
            .chooseFrom('direction', { choices: ['left', 'right'] })
            .execute(() => ({ success: true })),
        );
        this.setFlow(defineFlow({
          root: loop({
            maxIterations: 100,
            do: actionStep({ actions: ['move'], player: (ctx) => ctx.game.getPlayer(1)! }),
          }),
        }));
      }
    }

    const lockBotAI: AIConfig = {
      objectives: (_game, _playerIndex) => ({
        moves: { checker: () => 0.5, weight: 1 },
      }),
    };

    const lockBotDef: GameDefinitionLike & { ai?: AIConfig; tutorial?: TutorialDefinition } = {
      gameClass: LockBotGame as new (...args: unknown[]) => unknown,
      gameType: 'lock-bot',
      minPlayers: 1,
      maxPlayers: 2,
      ai: lockBotAI,
      tutorial: {
        steps: [{ id: 'step-1', gate: { action: 'move' }, content: [{ text: 'Make a move.' }] }],
      },
    };

    const lockedOpts = { playerCount: 2, seed: 'lock-seed', teachingDisabled: true };
    const openOpts = { playerCount: 2, seed: 'lock-seed' };

    async function startLockGame() {
      const res = await executeOp(lockBotDef, openOpts, null, null, { type: 'start' });
      if (!res.success) throw new Error('start failed');
      return res.snapshot;
    }

    it('hint returns a protocol lockout error when teachingDisabled is true', async () => {
      const snapshot = await startLockGame();
      const res = await executeOp(lockBotDef, lockedOpts, snapshot, null, { type: 'hint', seat: 1 });

      expect(res.success).toBe(false);
      expect(res.category).toBe('protocol');
      expect(res.error).toBe('Teaching features are disabled for this session.');
    });

    it('hint succeeds normally when teachingDisabled is absent', async () => {
      const snapshot = await startLockGame();
      const res = await executeOp(lockBotDef, openOpts, snapshot, null, { type: 'hint', seat: 1 });

      expect(res.success).toBe(true);
      expect(res.hintAnnotation).toBeDefined();
    });

    it('heatmapToggle returns a protocol lockout error when teachingDisabled is true', async () => {
      const snapshot = await startLockGame();
      const res = await executeOp(lockBotDef, lockedOpts, snapshot, null, {
        type: 'heatmapToggle', seat: 1, visible: true,
      });

      expect(res.success).toBe(false);
      expect(res.category).toBe('protocol');
      expect(res.error).toBe('Teaching features are disabled for this session.');
    });

    it('heatmapToggle visible=false also returns a lockout error when teachingDisabled is true', async () => {
      const snapshot = await startLockGame();
      const res = await executeOp(lockBotDef, lockedOpts, snapshot, null, {
        type: 'heatmapToggle', seat: 1, visible: false,
      });

      expect(res.success).toBe(false);
      expect(res.category).toBe('protocol');
      expect(res.error).toBe('Teaching features are disabled for this session.');
    });

    it('startTutorial returns a protocol lockout error when teachingDisabled is true', async () => {
      const snapshot = await startLockGame();
      const res = await executeOp(lockBotDef, lockedOpts, snapshot, null, {
        type: 'startTutorial', player: 1,
      });

      expect(res.success).toBe(false);
      expect(res.category).toBe('protocol');
      expect(res.error).toBe('Teaching features are disabled for this session.');
    });

    it('exitTutorial succeeds even when teachingDisabled is true (D-06)', async () => {
      // Start the tutorial in an open session first so we have a tutorial-in-progress snapshot.
      const snapshot = await startLockGame();
      const started = await executeOp(lockBotDef, openOpts, snapshot, null, {
        type: 'startTutorial', player: 1,
      });
      expect(started.success).toBe(true);

      // exitTutorial under the locked options must still succeed.
      const res = await executeOp(lockBotDef, lockedOpts, started.snapshot, null, {
        type: 'exitTutorial', player: 1,
      });

      expect(res.success).toBe(true);
    });

    it('teachingDisabled:false leaves all three ops functional', async () => {
      const falseOpts = { ...openOpts, teachingDisabled: false };
      const snapshot = await startLockGame();

      const hintRes = await executeOp(lockBotDef, falseOpts, snapshot, null, { type: 'hint', seat: 1 });
      expect(hintRes.success).toBe(true);

      const tutRes = await executeOp(lockBotDef, falseOpts, snapshot, null, {
        type: 'startTutorial', player: 1,
      });
      expect(tutRes.success).toBe(true);
    });

  });

  // ── aiSuggest op (Plan 110-03) ────────────────────────────────────────────
  //
  // Read-only preview: runs MCTS and returns suggestedAction/suggestedArgs
  // WITHOUT mutating the snapshot. Used by runDemoLoop in SnapshotSessionHost.

  describe('aiSuggest op', () => {

    // Local BotGame fixture: player 1 chooses direction ['left','right'] with AI.
    // Re-declared here because botGameDef is scoped to 'hint + heatmapToggle' describe.
    class AISuggestBotGame extends Game<AISuggestBotGame, Player> {
      moveCount = 0;
      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create('move')
            .chooseFrom('direction', { choices: ['left', 'right'] })
            .execute(() => { this.moveCount++; return { success: true }; }),
        );
        this.setFlow(defineFlow({
          root: loop({
            maxIterations: 100,
            do: actionStep({ actions: ['move'], player: (ctx) => ctx.game.getPlayer(1)! }),
          }),
        }));
      }
    }

    interface AISuggestBotGameDef extends GameDefinitionLike { ai?: AIConfig; }

    const aiSuggestAI: AIConfig = {
      objectives: (_game, _playerIndex) => ({
        moves: {
          checker: (game) => Math.min(1, (game as AISuggestBotGame).moveCount / 20),
          weight: 1,
        },
      }),
      hintTargetFromMove: (move) => {
        const dir = (move.args as { direction?: string }).direction;
        return dir ? { notation: dir } : undefined;
      },
    };

    const aiSuggestGameDef: AISuggestBotGameDef = {
      gameClass: AISuggestBotGame as new (...args: unknown[]) => unknown,
      gameType: 'ai-suggest-game',
      minPlayers: 1,
      maxPlayers: 2,
      ai: aiSuggestAI,
    };

    const aiSuggestOpts = { playerCount: 2, seed: 'ai-suggest-seed' };

    async function startAISuggestGame() {
      const res = await executeOp(aiSuggestGameDef, aiSuggestOpts, null, null, { type: 'start' });
      if (!res.success) throw new Error('start failed');
      return res.snapshot;
    }

    // ── success path ──────────────────────────────────────────────────────

    it('aiSuggest returns success with suggestedAction + suggestedArgs + aiPlayer, snapshot unchanged', async () => {
      const snapshot = await startAISuggestGame();
      const res = await executeOp(aiSuggestGameDef, aiSuggestOpts, snapshot, null, {
        type: 'aiSuggest',
        seats: [{ seat: 1 }],
      });

      expect(res.success).toBe(true);
      expect(res.suggestedAction).toBeDefined();
      expect(typeof res.suggestedAction).toBe('string');
      expect(res.suggestedArgs).toBeDefined();
      expect(res.aiPlayer).toBe(1);

      // Read-only: no action was executed — actionHistory is still empty.
      // (MCTS simulation may update internal flow counters on the runner, but
      // no game-logical move was recorded. The invariant is "no performAction",
      // not "zero internal state mutation during MCTS".)
      const snapObj = res.snapshot as { actionHistory?: unknown[] };
      expect(snapObj.actionHistory ?? []).toHaveLength(0);

      // Game is still awaiting the same player (seat 1) for the same actions.
      const flowState = res.flowState as { currentPlayer?: number; availableActions?: string[] };
      expect(flowState.currentPlayer).toBe(1);
      expect(flowState.availableActions).toContain('move');
    });

    // ── fail-loud: no actable seat ────────────────────────────────────────

    it('aiSuggest returns a protocol error when no seat among the given seats is awaiting input', async () => {
      const snapshot = await startAISuggestGame();
      // Seat 2 never acts — only seat 1 does
      const res = await executeOp(aiSuggestGameDef, aiSuggestOpts, snapshot, null, {
        type: 'aiSuggest',
        seats: [{ seat: 2 }],
      });

      expect(res.success).toBe(false);
      expect(res.category).toBe('protocol');
      expect(res.error).toBeDefined();
    });

    // ── fail-loud: no AI config ───────────────────────────────────────────

    it('aiSuggest returns a protocol error when no AI config is on the definition', async () => {
      const { ai: _ai, ...noAiDef } = aiSuggestGameDef;
      const snapshot = await startAISuggestGame();
      const res = await executeOp(noAiDef, aiSuggestOpts, snapshot, null, {
        type: 'aiSuggest',
        seats: [{ seat: 1 }],
      });

      expect(res.success).toBe(false);
      expect(res.category).toBe('protocol');
      expect(res.error).toMatch(/No AI configuration/i);
    });

    // ── read-only classification ──────────────────────────────────────────

    it('aiSuggest is in READ_ONLY_OP_TYPES', async () => {
      const { READ_ONLY_OP_TYPES } = await import('./stateless-ops.js');
      expect(READ_ONLY_OP_TYPES.has('aiSuggest')).toBe(true);
    });

  });

  // ── startTutorial with setup callback (R-01 regression) ───────────────────

  describe('startTutorial setup callback (R-01)', () => {
    // A game with a mutable 'marker' property so setup can stamp it.
    // This isolates the test from board elements and keeps it minimal.
    class MarkerGame extends Game<MarkerGame, Player> {
      markerSet = false;

      constructor(options: GameOptions) {
        super(options);
        this.registerAction(
          Action.create('pass').execute(() => ({ success: true }))
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

    const SETUP_TUTORIAL: TutorialDefinition = {
      setup: (game) => { (game as MarkerGame).markerSet = true; },
      steps: [{ id: 'step-1', gate: { action: 'pass' } }],
    };

    const markerGameDef: GameDefinitionLike = {
      gameClass: MarkerGame as new (...args: unknown[]) => unknown,
      gameType: 'marker',
      minPlayers: 1,
      maxPlayers: 2,
      tutorial: SETUP_TUTORIAL,
    };

    it('calls setup before activating the first step so advanceWhen predicates see the preset state', async () => {
      // Verify setup runs by using an advanceWhen predicate that reads markerSet.
      // If setup runs BEFORE initialProgress + autoAdvance, and the step's
      // advanceWhen fires on markerSet===true, the tutorial immediately advances
      // to step-2 (which does not exist → status becomes 'completed').
      const SETUP_ADVANCE_TUTORIAL: TutorialDefinition = {
        setup: (game) => { (game as MarkerGame).markerSet = true; },
        steps: [
          {
            id: 'step-1',
            gate: { action: 'pass' },
            advanceWhen: {
              'marker set by setup': (ctx) => (ctx.game as MarkerGame).markerSet,
            },
          },
          { id: 'step-2', gate: { action: 'pass' } },
        ],
      };

      const advanceDef: GameDefinitionLike = {
        ...markerGameDef,
        tutorial: SETUP_ADVANCE_TUTORIAL,
      };

      const startResult = await startGame(advanceDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      const result = await executeOp(
        advanceDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'startTutorial', player: 1 },
      );

      expect(result.success).toBe(true);
      // setup set markerSet=true; the advanceWhen predicate fired → tutorial advanced to step-2.
      const view = (result.playerViews as Array<{ state: { tutorial?: { stepId?: string } } }>)?.[0];
      expect(view?.state?.tutorial?.stepId).toBe('step-2');
    });

    it('startTutorial without a setup callback leaves game state unchanged', async () => {
      const NO_SETUP_TUTORIAL: TutorialDefinition = {
        steps: [{ id: 'only', gate: { action: 'pass' } }],
      };
      const noSetupDef: GameDefinitionLike = {
        ...markerGameDef,
        tutorial: NO_SETUP_TUTORIAL,
      };

      const startResult = await startGame(noSetupDef, simpleGameOptions);
      const result = await executeOp(
        noSetupDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'startTutorial', player: 1 },
      );

      expect(result.success).toBe(true);
      const view = (result.playerViews as Array<{ state: { tutorial?: { stepId?: string } } }>)?.[0];
      expect(view?.state?.tutorial?.stepId).toBe('only');
    });
  });

  // ── exitTutorial op (R-02) ────────────────────────────────────────────────

  describe('exitTutorial', () => {
    const EXIT_TUTORIAL: TutorialDefinition = {
      steps: [
        { id: 'step-1', gate: { action: 'pass' } },
        { id: 'step-2', gate: { action: 'pass' } },
      ],
    };

    const gameWithExitTutorialDef: GameDefinitionLike = {
      ...simpleGameDef,
      tutorial: EXIT_TUTORIAL,
    };

    it('sets tutorial status to exited and removes the gate', async () => {
      const startResult = await startGame(gameWithExitTutorialDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      // Start tutorial first.
      const tutorialStarted = await executeOp(
        gameWithExitTutorialDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'startTutorial', player: 1 },
      );
      expect(tutorialStarted.success).toBe(true);
      // Tutorial is running on step-1.
      const viewRunning = (tutorialStarted.playerViews as Array<{ state: { tutorial?: { stepId?: string } } }>)?.[0];
      expect(viewRunning?.state?.tutorial?.stepId).toBe('step-1');

      // Exit the tutorial.
      const exitResult = await executeOp(
        gameWithExitTutorialDef,
        simpleGameOptions,
        tutorialStarted.snapshot,
        null,
        { type: 'exitTutorial', player: 1 },
      );

      expect(exitResult.success).toBe(true);
      // After exit, tutorialProgress status is 'exited'; the tutorial step view
      // should no longer appear (gate is lifted, progress status is not 'running').
      const viewExited = (exitResult.playerViews as Array<{ state: { tutorial?: unknown } }>)?.[0];
      // The tutorial projection is absent when status is not 'running'.
      expect(viewExited?.state?.tutorial).toBeUndefined();
    });

    it('fails with a protocol error when the game has no tutorial definition', async () => {
      const startResult = await startGame(simpleGameDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      const result = await executeOp(
        simpleGameDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'exitTutorial', player: 1 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No tutorial definition/);
      expect(result.category).toBe('protocol');
    });

    it('rejects invalid seat with a protocol error', async () => {
      const startResult = await startGame(gameWithExitTutorialDef, simpleGameOptions);
      expect(startResult.success).toBe(true);

      const result = await executeOp(
        gameWithExitTutorialDef,
        simpleGameOptions,
        startResult.snapshot,
        null,
        { type: 'exitTutorial', player: 0 },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid player seat/);
      expect(result.category).toBe('protocol');
    });
  });
});
