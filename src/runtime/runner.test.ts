import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  sequence,
  execute,
  switchOn,
  type FlowContext,
} from '../engine/index.js';
import type { GameStateSnapshot } from '../engine/index.js';
import { GameRunner, describeCheckpointAbsence } from './runner.js';
import { ErrorCode } from '../types/protocol.js';
import { createHeadlessSession } from '../session/headless-session.js';
import {
  collectFixtureDefinition,
  CollectGame,
  Equipment,
} from '../session/testing/fixtures/collect-fixture.js';
import type { Op } from '../session/stateless-ops.js';

// Test game classes
class TestGame extends Game<TestGame, Player> {
  deck!: Deck;
  hands!: Hand[];

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    // Register classes
    this.registerElements([Card, Hand, Deck]);

    // Create deck
    this.deck = this.create(Deck, 'deck');
    this.deck.contentsHidden();

    // Create hands for each player
    this.hands = [];
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      this.hands.push(hand);
    }

    // Create cards
    for (let i = 0; i < 20; i++) {
      this.deck.create(Card, `card-${i}`, { suit: 'H', rank: String((i % 13) + 1) });
    }

    // Deal cards
    for (let i = 0; i < 3; i++) {
      for (const hand of this.hands) {
        const card = this.deck.first(Card);
        if (card) card.putInto(hand);
      }
    }

    // Register draw action
    const drawAction = Action.create('draw')
      .prompt('Draw a card')
      .condition({
        'deck has cards': () => this.deck.count(Card) > 0,
      })
      .execute((args, ctx) => {
        const card = this.deck.first(Card);
        if (card) {
          // player.seat is 1-indexed, hands array is 0-indexed
          const hand = this.hands[ctx.player.seat - 1];
          card.putInto(hand);
          ctx.game.message(`${ctx.player.name} drew a card`);
        }
        return { success: true };
      });

    const passAction = Action.create('pass')
      .prompt('Pass turn')
      .execute((args, ctx) => {
        ctx.game.message(`${ctx.player.name} passed`);
        return { success: true };
      });

    this.registerActions(drawAction, passAction);

    // Set up flow
    const gameFlow = defineFlow({
      root: loop({
        while: (ctx: FlowContext) => (ctx.get<number>('round') ?? 1) <= 2,
        maxIterations: 10,
        do: eachPlayer({
          do: actionStep({
            actions: ['draw', 'pass'],
          }),
        }),
      }),
      setup: (ctx) => ctx.set('round', 1),
    });
    this.setFlow(gameFlow);
  }
}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
}

class Hand extends Space<TestGame> {}
class Deck extends Space<TestGame> {}

// A game that can run for hundreds of actions, with a tree big enough that
// retaining a copy of it per action is measurable -- the shape the retention
// policy exists for. TestGame's flow ends after 20 actions, which is exactly
// the length at which this problem is invisible.
class LongGame extends Game<LongGame, Player> {
  board!: Space<LongGame>;

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);
    this.registerElements([Card, Hand, Deck]);
    this.board = this.create(Deck, 'board');
    for (let i = 0; i < 40; i++) {
      this.board.create(Card, `token-${i}`, { suit: 'S', rank: String(i) });
    }
    this.registerActions(
      Action.create('pass').prompt('Pass').execute(() => ({ success: true })),
    );
    this.setFlow(defineFlow({
      root: loop({
        while: () => true,
        maxIterations: 400,
        do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    }));
  }
}


// Minimal game whose entire flow is a single simultaneous-action-step with a
// validated action, for ENG-03 (failed simultaneous action must not be
// recorded in actionHistory).
class SimultaneousTestGame extends Game<SimultaneousTestGame, Player> {
  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    const testAction = Action.create('test')
      .chooseFrom('choice', { choices: ['a', 'b', 'c'] })
      .execute((args) => ({ success: true, data: { choice: args.choice } }));

    this.registerAction(testAction);

    const flow = defineFlow({
      root: simultaneousActionStep({
        actions: ['test'],
      }),
    });
    this.setFlow(flow);
  }
}

// Minimal game whose flow throws from an unguarded `execute()` node
// immediately after the triggering action completes, so the exception
// propagates uncaught through FlowEngine.run() -> continueFlow() and lands in
// GameRunner.performAction's try/catch (ENGINE_ERROR gap branch coverage).
// Unlike an exception thrown inside Action.execute() (which ActionExecutor
// wraps and converts into a normal action-failure result), this path is
// genuinely unguarded further up the flow-processing stack.
class ThrowingFlowGame extends Game<ThrowingFlowGame, Player> {
  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    const triggerAction = Action.create('trigger')
      .prompt('Trigger')
      .execute(() => ({ success: true }));

    this.registerActions(triggerAction);

    const flow = defineFlow({
      root: sequence(
        actionStep({ actions: ['trigger'] }),
        execute(() => {
          throw new Error('Kaboom');
        })
      ),
    });
    this.setFlow(flow);
  }
}

// WR-02: a switchOn immediately following an action step, whose `on` yields
// an unmatched runtime value (no matching case, no default). The throw fires
// AFTER the triggering action has committed game state, so the runner must
// keep actionHistory consistent with the applied state instead of dropping
// the committed action (replay/undo/snapshot divergence).
class UnmatchedSwitchGame extends Game<UnmatchedSwitchGame, Player> {
  mode = 'initial';

  constructor(options: { playerCount: number; seed?: string }) {
    super(options);

    const setMode = Action.create('setMode')
      .prompt('Set mode')
      .execute((args, ctx) => {
        (ctx.game as UnmatchedSwitchGame).mode = 'unexpected';
        return { success: true };
      });
    this.registerActions(setMode);

    this.setFlow(defineFlow({
      root: sequence(
        actionStep({ actions: ['setMode'] }),
        switchOn({
          on: (ctx) => (ctx.game as UnmatchedSwitchGame).mode,
          cases: {
            expected: execute(() => {}),
          },
        })
      ),
    }));
  }
}

describe('GameRunner', () => {
  describe('creation', () => {
    it('should create a game runner', () => {
      const runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'] },
      });

      expect(runner.game).toBeDefined();
      expect(runner.gameType).toBe('test-game');
      expect(runner.actionHistory).toEqual([]);
    });
  });

  describe('game flow', () => {
    let runner: GameRunner<TestGame>;

    beforeEach(() => {
      runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
      });
    });

    it('should start the game flow', () => {
      const state = runner.start();

      expect(state.awaitingInput).toBe(true);
      expect(state.currentPlayer).toBe(1);
      expect(state.availableActions).toContain('draw');
      expect(state.availableActions).toContain('pass');
    });

    it('should perform an action and record it', () => {
      runner.start();

      const result = runner.performAction('draw', 1, {});

      expect(result.success).toBe(true);
      expect(result.serializedAction).toBeDefined();
      expect(result.serializedAction?.name).toBe('draw');
      expect(result.serializedAction?.player).toBe(1);
      expect(runner.actionHistory).toHaveLength(1);
    });

    it('should reject action from wrong player', () => {
      runner.start();

      // Player 2 tries to act when it's player 1's turn
      const result = runner.performAction('draw', 2, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('turn');
      // The runner emits a structured code at the point of failure so callers
      // never have to re-infer NOT_YOUR_TURN from the message prose.
      expect(result.errorCode).toBe(ErrorCode.NOT_YOUR_TURN);
    });

    it('should report INVALID_PLAYER for an unknown seat', () => {
      runner.start();

      const result = runner.performAction('draw', 99, {});

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(ErrorCode.INVALID_PLAYER);
    });

    it('should provide player views after action', () => {
      runner.start();

      const result = runner.performAction('draw', 1, {});

      expect(result.playerViews).toBeDefined();
      expect(result.playerViews).toHaveLength(2);
    });

    it('should report ENGINE_ERROR when continueFlow throws', () => {
      const throwingRunner = new GameRunner({
        GameClass: ThrowingFlowGame,
        gameType: 'throwing-flow-game',
        gameOptions: { playerCount: 1, seed: 'test' },
      });
      throwingRunner.start();

      const result = throwingRunner.performAction('trigger', 1, {});

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(ErrorCode.ENGINE_ERROR);
      expect(result.error).toContain('Kaboom');
      // Pit of success guard: never leak stack-frame text or file paths.
      expect(result.error).not.toContain(' at ');
      expect(result.error).not.toMatch(/\.ts:\d+/);
    });

    it('should report ACTION_EXECUTION_ERROR when flowState.actionError is set', () => {
      runner.start();

      // Not in the actionStep's allow-list -> engine sets flowState.actionError
      // without throwing.
      const result = runner.performAction('nonexistent-action', 1, {});

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(ErrorCode.ACTION_EXECUTION_ERROR);
      expect(result.error).toContain('nonexistent-action');
    });

    it('WR-02: records the committed action in history when the flow halts on an unmatched switchOn value', () => {
      const haltingRunner = new GameRunner({
        GameClass: UnmatchedSwitchGame,
        gameType: 'unmatched-switch-game',
        gameOptions: { playerCount: 1, seed: 'test' },
      });
      haltingRunner.start();

      const result = haltingRunner.performAction('setMode', 1, {});

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(ErrorCode.ENGINE_ERROR);
      // The error must be clearly non-retryable: the game is halted by a
      // flow-definition bug, not a per-action failure.
      expect(result.error).toContain('halted');
      expect(result.error).toContain('no matching case');

      // The action committed (game state mutated) before the flow threw, so
      // it MUST be recorded — otherwise actionHistory diverges from applied
      // state and replay/undo/snapshot are inconsistent.
      expect(haltingRunner.game.mode).toBe('unexpected');
      expect(haltingRunner.actionHistory).toHaveLength(1);
      expect(haltingRunner.actionHistory[0].name).toBe('setMode');
    });

    it('ENG-03: a failing simultaneous action returns {success:false} and is NOT recorded in actionHistory', () => {
      const simRunner = new GameRunner({
        GameClass: SimultaneousTestGame,
        gameType: 'simultaneous-test-game',
        gameOptions: { playerCount: 3, seed: 'test' },
      });
      simRunner.start();

      expect(simRunner.actionHistory).toHaveLength(0);

      // 'z' is not among the registered choices -> validation failure.
      const result = simRunner.performAction('test', 1, { choice: 'z' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(simRunner.actionHistory).toHaveLength(0);
    });
  });

  describe('snapshots', () => {
    let runner: GameRunner<TestGame>;

    beforeEach(() => {
      runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
      });
      runner.start();
    });

    it('should create a snapshot', () => {
      runner.performAction('draw', 1, {});

      const snapshot = runner.getSnapshot();

      expect(snapshot.gameType).toBe('test-game');
      expect(snapshot.actionHistory).toHaveLength(1);
      expect(snapshot.seed).toBe('test');
    });

    it('should get player views', () => {
      const view = runner.getPlayerView(1);

      expect(view.player).toBe(1);
      expect(view.flowState?.isMyTurn).toBe(true);
    });

    it('should get all player views', () => {
      const views = runner.getAllPlayerViews();

      expect(views).toHaveLength(2);
      expect(views[0].flowState?.isMyTurn).toBe(true);
      expect(views[1].flowState?.isMyTurn).toBe(false);
    });

    it('persists a direct tree mutation (recorded in neither command nor action history) across fromSnapshot', () => {
      // Simulate a pending-action mutation: move a piece directly via putInto,
      // bypassing performAction so it lands in NEITHER commandHistory NOR
      // actionHistory — the exact shape that previously vanished on restore.
      const card = runner.game.deck.first(Card)!;
      const cardId = card.id;
      const hand = runner.game.hands[0];
      card.putInto(hand);
      expect(runner.actionHistory).toHaveLength(0);

      const snapshot = runner.getSnapshot();
      const restored = GameRunner.fromSnapshot(snapshot, TestGame);

      // The moved card must still be in the hand (not back in the deck) after the
      // snapshot round-trip.
      expect(restored.game.hands[0].all(Card).some(c => c.id === cardId)).toBe(true);
      expect(restored.game.deck.all(Card).some(c => c.id === cardId)).toBe(false);
    });
  });

  describe('fromSnapshot is state-authoritative (no replay)', () => {
    it('restores the seeded RNG so the next random() draw matches the live game', () => {
      const runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'rng-test' },
      });
      runner.start();

      // Advance the RNG past its initial state with a few draws.
      for (let i = 0; i < 5; i++) runner.game.random();

      const snapshot = runner.getSnapshot();
      expect(snapshot.randomState).toBe(runner.game.getRandomState());

      const restored = GameRunner.fromSnapshot(snapshot, TestGame);

      // The restored generator must be at the SAME position as the live one: the
      // next draw matches, and they stay in lock-step for subsequent draws. This
      // proves the RNG position is restored directly, not re-derived by replay.
      expect(restored.game.random()).toBe(runner.game.random());
      expect(restored.game.random()).toBe(runner.game.random());
    });

    it('keeps the authoritative flow position instead of re-deriving it from actionHistory', () => {
      const runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'auth-test' },
      });
      runner.start();
      // Advance the flow to player 2's turn.
      runner.performAction('draw', 1, {});
      expect(runner.game.getFlowState()?.currentPlayer).toBe(2);

      const snapshot = runner.getSnapshot();

      // Inject an extra action that would be INVALID to replay from the restored
      // position (player 1 is no longer awaiting). The old replay-based restore
      // re-ran the whole actionHistory and could mis-position or throw — the exact
      // MERC "Player N is not awaiting action" crash class. The authoritative
      // restore must IGNORE the history for positioning and land on player 2.
      snapshot.actionHistory.push({ ...snapshot.actionHistory[0] });

      const restored = GameRunner.fromSnapshot(snapshot, TestGame);
      const fs = restored.game.getFlowState();
      expect(fs?.currentPlayer).toBe(2);
      expect(fs?.awaitingInput).toBe(true);
      // actionHistory is still preserved for the undo op, just not replayed.
      expect(restored.actionHistory).toHaveLength(2);
    });

    it('restores a pending-action-gated flow (selection-step mutations) without throwing', async () => {
      // Drive the MERC-shaped collect flow through the real stateless path to a
      // mid-collect snapshot: explore -> collect one item via a selection step.
      // The item move happens inside a pending execute (recorded in NEITHER
      // command nor action history). Restoring that snapshot directly via
      // fromSnapshot must NOT throw and must preserve the mutation + flow.
      const session = createHeadlessSession(collectFixtureDefinition, { playerCount: 1, seed: 't' });
      await session.start();

      const explore = await session.send(1, {
        type: 'action', actionName: 'explore', player: 1, args: {},
      });
      const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

      const before = await session.send(1, {
        type: 'resolveChoices', actionName: 'collect', player: 1, selectionName: 'item', args: {},
      } as Op);
      const itemsBefore = (before.validElements as Array<{ id: number }>) ?? [];
      const firstId = itemsBefore[0].id;

      const step = await session.send(1, {
        type: 'selectionStep',
        player: 1,
        selectionName: 'item',
        value: firstId,
        actionName: 'collect',
        initialArgs: followUpArgs,
      } as Op);
      expect(step.success).toBe(true);

      const snapshot = step.snapshot as GameStateSnapshot;

      // Direct authoritative restore — this is the operation that previously
      // crashed when it replayed an incomplete actionHistory.
      const restored = GameRunner.fromSnapshot(snapshot, CollectGame);

      // No throw, flow is intact, and the collected item moved out of the stash.
      expect(restored.game.getFlowState()).toBeDefined();
      const stashCount = restored.game.sector.stash.all(Equipment).length;
      const heldCount = restored.game.held.all(Equipment).length;
      expect(stashCount).toBe(itemsBefore.length - 1);
      expect(heldCount).toBe(1);
    });
  });

  describe('replay', () => {
    it('should replay actions to recreate game state', () => {
      // Play a game
      const runner1 = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'replay-test' },
      });
      runner1.start();
      runner1.performAction('draw', 1, {}); // Player 1 draws
      runner1.performAction('pass', 2, {}); // Player 2 passes (it's now their turn)

      // Replay it
      const runner2 = GameRunner.replay(
        {
          GameClass: TestGame,
          gameType: 'test-game',
          gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'replay-test' },
        },
        runner1.actionHistory
      );

      // Should have same state
      expect(runner2.actionHistory).toHaveLength(2);

      // Cards should be in same positions (deterministic with seed)
      const hand1_1 = runner1.game.hands[0].count(Card); // hands is a regular array, keep 0-indexed
      const hand1_2 = runner2.game.hands[0].count(Card);
      expect(hand1_2).toBe(hand1_1);
    });
  });

  describe('checkpoint memory (F16)', () => {
    it('does not copy commandHistory into any retained per-action checkpoint', () => {
      // Regression for F16: each retained per-action undo checkpoint used to carry
      // a full `commandHistory: [...game.commandHistory]` copy. Since commandHistory
      // grows O(N) over a game and one checkpoint is kept per action, that produced
      // O(N^2) command-entry copies retained for the game lifetime — pure dead
      // weight, because restore (GameRunner.fromSnapshot) is state-authoritative and
      // NEVER reads commandHistory. The fix drops commandHistory from snapshots, so
      // no checkpoint may carry it.
      const runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'cp' },
      });
      runner.start();

      // Grow the LIVE game's commandHistory with real invertible commands, so the
      // pre-fix copy would have been non-trivial (this is the O(N) array that used
      // to be cloned into EACH retained checkpoint).
      for (const card of runner.game.deck.all(Card).slice(0, 4)) {
        runner.game.execute({ type: 'MOVE', elementId: card.id, destinationId: runner.game.hands[0].id });
      }
      expect(runner.game.commandHistory.length).toBe(4);

      // Drive several actions, refreshing the per-action checkpoint after each one
      // exactly as GameSession does from its broadcast funnel (game-session.ts).
      // This is what accumulates one retained full snapshot per action.
      for (const [action, seat] of [['draw', 1], ['draw', 2], ['draw', 1], ['draw', 2]] as const) {
        expect(runner.performAction(action, seat, {}).success).toBe(true);
        runner.captureCheckpoint();
      }

      const snapshot = runner.getSnapshot();
      // The LIVE game still has its commandHistory (untouched); the SNAPSHOT must
      // not carry a copy.
      expect(runner.game.commandHistory.length).toBeGreaterThan(0);
      expect('commandHistory' in snapshot).toBe(false);

      const checkpoints = snapshot.actionCheckpoints?.entries ?? [];
      expect(checkpoints.length).toBeGreaterThan(1);
      for (const checkpoint of checkpoints) {
        expect('commandHistory' in checkpoint).toBe(false);
      }
    });

    it('still restores authoritatively from a checkpoint without commandHistory', () => {
      // The functional contract must survive the memory fix: a checkpoint that no
      // longer carries commandHistory must still reconstruct the exact tree, flow
      // position, sequence, and RNG via the state-authoritative restore path.
      const runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'cp2' },
      });
      runner.start();
      runner.performAction('draw', 1, {});
      runner.performAction('pass', 2, {});

      const handCountBefore = runner.game.hands[0].count(Card);
      const snapshot = runner.getSnapshot();
      expect('commandHistory' in snapshot).toBe(false);

      const restored = GameRunner.fromSnapshot(snapshot, TestGame);
      expect(restored.actionHistory).toHaveLength(2);
      expect(restored.game.hands[0].count(Card)).toBe(handCountBefore);
      expect(restored.getFlowState()).toBeDefined();
    });
  });

  describe('checkpoint payload (F17)', () => {
    it('does not embed actionHistory or gameOptions in any per-action checkpoint', () => {
      // Regression for F17: each retained per-action checkpoint used to be a full
      // `createSnapshot`, re-embedding an O(k) `actionHistory` copy and a duplicate
      // `gameOptions`/`gameType`/`seed`. With one checkpoint per action, a single
      // persisted snapshot therefore carried O(N^2) action entries and N duplicate
      // option blobs — growing per op and per game (O(N^2) storage, hitting
      // KV/object-store value-size caps mid-session). The lean ActionCheckpoint
      // carries ONLY the per-action-varying state; the invariants + history prefix
      // are rehydrated from the enclosing snapshot by fromCheckpoint.
      const runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'f17' },
      });
      runner.start();

      for (const [action, seat] of [['draw', 1], ['pass', 2], ['draw', 1], ['pass', 2]] as const) {
        expect(runner.performAction(action, seat, {}).success).toBe(true);
        runner.captureCheckpoint();
      }

      const snapshot = runner.getSnapshot();
      const checkpoints = snapshot.actionCheckpoints?.entries ?? [];
      expect(checkpoints.length).toBeGreaterThan(1);

      // No per-action checkpoint may re-embed any snapshot-wide / O(k) field. This
      // is the heart of the fix: the OLD full-snapshot checkpoints carried all of
      // these, producing the O(N^2) blowup; the lean ones must carry none.
      let totalEmbeddedActionEntries = 0;
      for (const checkpoint of checkpoints) {
        expect('actionHistory' in checkpoint).toBe(false);
        expect('gameOptions' in checkpoint).toBe(false);
        expect('gameType' in checkpoint).toBe(false);
        expect('seed' in checkpoint).toBe(false);
        expect('actionCheckpoints' in checkpoint).toBe(false);
        // The lean entry keeps exactly the per-action-varying state.
        expect(checkpoint.state).toBeDefined();
        totalEmbeddedActionEntries +=
          (checkpoint as { actionHistory?: unknown[] }).actionHistory?.length ?? 0;
      }
      // Old design: sum(0..N) action entries embedded across checkpoints. Fixed: 0.
      expect(totalEmbeddedActionEntries).toBe(0);
    });

    it('fromCheckpoint rehydrates the history prefix and restores the tree authoritatively', () => {
      // The functional contract must survive the payload fix: restoring a lean
      // checkpoint at index k must reproduce EXACTLY the state when k actions were
      // recorded — the history prefix (length k), the element tree, the flow
      // position, and the RNG — by rehydrating the invariants from the enclosing
      // snapshot. This is the single restore primitive used by undo + time-travel.
      const runner = new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'f17b' },
      });
      runner.start();

      const handAfter: number[] = [runner.game.hands[0].count(Card)];
      for (const [action, seat] of [['draw', 1], ['pass', 2], ['draw', 1]] as const) {
        expect(runner.performAction(action, seat, {}).success).toBe(true);
        runner.captureCheckpoint();
        handAfter.push(runner.game.hands[0].count(Card));
      }

      const snapshot = runner.getSnapshot();

      // Restore at each historical action index and verify the prefix + tree match.
      for (let k = 0; k < handAfter.length; k++) {
        const restored = GameRunner.fromCheckpoint(snapshot, k, TestGame);
        expect(restored).not.toBeNull();
        expect(restored!.actionHistory).toHaveLength(k);
        expect(restored!.game.hands[0].count(Card)).toBe(handAfter[k]);
        expect(restored!.getFlowState()).toBeDefined();
      }

      // Out-of-range index yields null (caller surfaces the actionable error).
      expect(GameRunner.fromCheckpoint(snapshot, 999, TestGame)).toBeNull();
    });
  });
  // ==========================================================================
  // Checkpoint retention (BUG-001)
  // ==========================================================================

  describe('checkpoint retention policy', () => {
    /** A runner `actions` actions in, under the given retention policy. */
    function playedRunner(actions: number, checkpoints?: { max?: number; enabled?: boolean }) {
      const runner = new GameRunner({
        GameClass: LongGame,
        gameType: 'long-game',
        gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'retain' },
        checkpoints,
      });
      runner.start();
      for (let i = 0; i < actions; i++) {
        expect(runner.performAction('pass', (i % 2) + 1, {}).success).toBe(true);
        runner.captureCheckpoint();
      }
      return runner;
    }

    it('retains one checkpoint per action by default — the growth this policy exists to bound', () => {
      const snapshot = playedRunner(12).getSnapshot();
      expect(snapshot.actionCheckpoints).toBeDefined();
      expect(snapshot.actionCheckpoints!.baseIndex).toBe(0);
      expect(snapshot.actionCheckpoints!.entries).toHaveLength(13); // start + 12 actions
    });

    it('keeps only the most recent `max`, dropping the oldest first', () => {
      const snapshot = playedRunner(12, { max: 4 }).getSnapshot();
      const window = snapshot.actionCheckpoints!;
      expect(window.entries).toHaveLength(4);
      // The retained window ENDS at the current action count: the entries are
      // for actions 9..12, which is the range undo can still reach.
      expect(window.baseIndex).toBe(9);
    });

    it('holds the snapshot flat as the game runs long — the actual fix', () => {
      const short = JSON.stringify(playedRunner(10, { max: 5 }).getSnapshot()).length;
      const long = JSON.stringify(playedRunner(60, { max: 5 }).getSnapshot()).length;
      // Not identical: actionHistory still grows by one entry per action. But
      // the tree-sized term is capped, so 6x the actions must not cost
      // anything like 6x the bytes.
      expect(long).toBeLessThan(short * 1.5);

      // Falsification: the same game with no policy DOES grow with the tree.
      const unbounded = JSON.stringify(playedRunner(60).getSnapshot()).length;
      expect(unbounded).toBeGreaterThan(short * 4);
    });

    it('pays nothing for the dropped range — no holes, no nulls', () => {
      const serialized = JSON.stringify(playedRunner(40, { max: 3 }).getSnapshot());
      const window = JSON.parse(serialized).actionCheckpoints;
      expect(window.entries).toHaveLength(3);
      expect(window.entries.every((e: unknown) => e !== null)).toBe(true);
    });

    it('restores within the retained window and refuses below it, with an actionable reason', () => {
      const snapshot = playedRunner(12, { max: 4 }).getSnapshot();

      // Inside the window: a real authoritative restore.
      const restored = GameRunner.fromCheckpoint(snapshot, 10, LongGame, { checkpoints: { max: 4 } });
      expect(restored).not.toBeNull();
      expect(restored!.actionHistory).toHaveLength(10);

      // Below it: refused, and the message says the policy dropped it (not that
      // something is broken) and how to reach further back.
      expect(GameRunner.fromCheckpoint(snapshot, 2, LongGame)).toBeNull();
      const why = describeCheckpointAbsence(snapshot.actionCheckpoints, 2);
      expect(why).toContain('older than');
      expect(why).toContain('checkpoints: { max }');

      // Above it: a different absence, with a different fix.
      const never = describeCheckpointAbsence(snapshot.actionCheckpoints, 999);
      expect(never).toContain('no checkpoint was captured');
      expect(never).not.toContain('older than');
    });

    it('carries the policy through a snapshot round-trip', () => {
      // The policy is NOT persisted -- it is re-supplied on every restore. A
      // restore that drops it silently reverts the game to unbounded retention
      // from that point on, which is the defect reintroduced one call site at
      // a time.
      let snapshot = playedRunner(12, { max: 4 }).getSnapshot();
      for (let round = 0; round < 3; round++) {
        const runner = GameRunner.fromSnapshot(snapshot, LongGame, { checkpoints: { max: 4 } });
        expect(runner.performAction('pass', (runner.actionHistory.length % 2) + 1, {}).success).toBe(true);
        snapshot = runner.getSnapshot();
        expect(snapshot.actionCheckpoints!.entries).toHaveLength(4);
      }
    });

    it('captures nothing at all when disabled, and says so when undo is attempted', () => {
      const snapshot = playedRunner(8, { enabled: false }).getSnapshot();
      expect(snapshot.actionCheckpoints!.entries).toHaveLength(0);
      expect(GameRunner.fromCheckpoint(snapshot, 4, LongGame)).toBeNull();
      expect(describeCheckpointAbsence(snapshot.actionCheckpoints, 4)).toContain('enabled: false');
    });

    it('still advances the execute() barrier with checkpointing disabled', () => {
      // The barrier FENCES undo; it is not part of undo's payload. Losing it
      // with checkpoints off would silently unfence a game that has none.
      const runner = playedRunner(4, { enabled: false });
      expect(runner.executeBarrierIndex).toBeGreaterThanOrEqual(0);
      expect(() => runner.getSnapshot()).not.toThrow();
    });

    it('rejects a max below 1 rather than silently retaining nothing', () => {
      expect(() => new GameRunner({
        GameClass: TestGame,
        gameType: 'test-game',
        gameOptions: { playerCount: 2 },
        checkpoints: { max: 0 },
      })).toThrow(/at least 1/);
    });

    it('rebuilds its window at the current action count when a snapshot carries none', () => {
      // A snapshot written before the window existed carries no usable window.
      // Restoring must not leave a hole per preceding action -- those would
      // serialize as nulls forever and read back as "missing", not "not kept".
      const runner = playedRunner(6);
      const snapshot = runner.getSnapshot();
      delete (snapshot as { actionCheckpoints?: unknown }).actionCheckpoints;

      const restored = GameRunner.fromSnapshot(snapshot, LongGame);
      const next = restored.getSnapshot();
      expect(next.actionCheckpoints!.baseIndex).toBe(6);
      expect(next.actionCheckpoints!.entries).toHaveLength(1);
      expect(JSON.stringify(next.actionCheckpoints)).not.toContain('null');
    });
  });
});
