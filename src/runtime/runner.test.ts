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
  type FlowContext,
} from '../engine/index.js';
import type { GameStateSnapshot } from '../engine/index.js';
import { GameRunner } from './runner.js';
import { createHeadlessSession } from '../session/testing/headless-harness.js';
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
    });

    it('should provide player views after action', () => {
      runner.start();

      const result = runner.performAction('draw', 1, {});

      expect(result.playerViews).toBeDefined();
      expect(result.playerViews).toHaveLength(2);
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

      const checkpoints = snapshot.actionCheckpoints ?? [];
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
      const checkpoints = snapshot.actionCheckpoints ?? [];
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
});
