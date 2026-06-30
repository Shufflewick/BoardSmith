/**
 * TEST-01: Typed observable state — getPlayerView annotation + JSDoc
 *
 * Verifies that:
 * (1) testGame.getPlayerView(seat) returns an object whose shape matches
 *     PlayerStateView (IDE surfaces the type; no JSON parsing required).
 * (2) Hidden-info exclusion: the perspective filter is in effect — a player
 *     cannot see another player's hand contents through their own view.
 * (3) Typed per-game access: testGame.game exposes the concrete game class so
 *     custom properties are readable without casts.
 *
 * Cross-layer boundary: testing → engine (createPlayerView / toJSONForPlayer)
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Hand,
  Card,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type ElementJSON,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import type { PlayerStateView } from '../runtime/index.js';

// ---------------------------------------------------------------------------
// Fixture: a minimal 2-player card game with per-player hands
// ---------------------------------------------------------------------------

/** Card element used in the fixture game */
class FixtureCard extends Card<FixtureGame> {
  rank!: string;
}

/**
 * Minimal game fixture for TEST-01.
 *
 * Each player receives one card in an owner-only hand so we can verify both
 * the PlayerStateView shape and the hidden-info perspective filter.
 * The `score` property demonstrates typed per-game custom-property access via
 * `testGame.game.score`.
 */
class FixtureGame extends Game<FixtureGame, Player> {
  /** Custom game property — readable via testGame.game.score (typed as number) */
  score = 0;

  constructor(options: GameOptions) {
    super(options);

    // Register custom element classes so they survive serialization
    this.registerElements([FixtureCard]);

    // Deal one card per player into an owner-only hand
    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      // Hand defaults to contentsVisibleToOwner() — call it explicitly for clarity
      hand.contentsVisibleToOwner();
      hand.create(FixtureCard, `card-p${player.seat}`, { rank: String(player.seat) });
    }

    // Simple flow: one turn per player, awaiting input from the active player
    this.registerAction(
      Action.create<FixtureGame>('pass').execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => false, // single pass-through then complete
          maxIterations: 10,
          do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function findChildByName(
  json: ElementJSON,
  name: string,
): ElementJSON | undefined {
  return json.children?.find((c) => c.name === name);
}

// ---------------------------------------------------------------------------
// TEST-01 tests
// ---------------------------------------------------------------------------

describe('TestGame.getPlayerView — TEST-01: typed observable state', () => {
  // Use a fixed seed so the fixture is deterministic
  let testGame: TestGame<FixtureGame>;

  // Create a fresh game before each test so state cannot leak between tests
  function makeGame() {
    return TestGame.create(FixtureGame, { playerCount: 2, seed: 'test-01-seed' });
  }

  // -------------------------------------------------------------------------
  // (1) PlayerStateView shape
  // -------------------------------------------------------------------------

  describe('getPlayerView(seat) returns a PlayerStateView', () => {
    it('returns an object with the player field matching the requested seat', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(1);
      expect(view.player).toBe(1);
    });

    it('returns view.player === 2 when seat 2 is requested', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(2);
      expect(view.player).toBe(2);
    });

    it('returns a view with a phase field (string)', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(1);
      expect(typeof view.phase).toBe('string');
    });

    it('returns a view with a complete field (boolean)', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(1);
      expect(typeof view.complete).toBe('boolean');
    });

    it('returns a view with a flowState field reflecting the active turn', () => {
      testGame = makeGame();
      const view = testGame.getPlayerView(1);
      // flowState is set while the game is awaiting input
      expect(view.flowState).toBeDefined();
      expect(typeof view.flowState!.awaitingInput).toBe('boolean');
      expect(typeof view.flowState!.isMyTurn).toBe('boolean');
    });

    it('view.flowState.isMyTurn is true for the active seat and false for others', () => {
      testGame = makeGame();
      const activeFlowState = testGame.getFlowState();
      const activePlayer = activeFlowState?.currentPlayer;
      expect(activePlayer).toBeDefined();

      const activeView = testGame.getPlayerView(activePlayer!);
      expect(activeView.flowState?.isMyTurn).toBe(true);

      // The other player's view should report isMyTurn === false
      const otherSeat = activePlayer === 1 ? 2 : 1;
      const otherView = testGame.getPlayerView(otherSeat);
      expect(otherView.flowState?.isMyTurn).toBe(false);
    });

    it('return type satisfies PlayerStateView (type-level — state field is ElementJSON)', () => {
      testGame = makeGame();
      // Assign to a typed variable — TS will fail to compile if the type is wrong
      const view: PlayerStateView = testGame.getPlayerView(1);
      // state is ElementJSON (perspective-filtered tree), not the typed game model
      expect(view.state).toBeDefined();
      expect(typeof view.state).toBe('object');
    });
  });

  // -------------------------------------------------------------------------
  // (2) Hidden-info exclusion (cross-layer: testing → engine perspective filter)
  // -------------------------------------------------------------------------

  describe('hidden-info exclusion — perspective filter is in effect', () => {
    it('player 1 cannot see the contents of player 2 hand (cards are hidden)', () => {
      testGame = makeGame();
      const p1View = testGame.getPlayerView(1);

      // Locate player 2's hand in player 1's view
      const hand2 = findChildByName(p1View.state, 'hand-2');
      expect(hand2).toBeDefined(); // the hand element itself must appear
      expect(hand2!.children).toBeDefined();
      expect(hand2!.children!.length).toBeGreaterThan(0); // placeholder present

      // All children of hand-2 in player 1's view must be marked hidden
      for (const child of hand2!.children!) {
        expect(
          child.attributes.__hidden,
          `card in hand-2 should be hidden from player 1's view`,
        ).toBe(true);
        // The card's rank attribute must NOT be disclosed to the non-owner
        expect(
          child.attributes.rank,
          `card rank must not be visible to non-owner`,
        ).toBeUndefined();
      }
    });

    it('player 2 cannot see the contents of player 1 hand (cards are hidden)', () => {
      testGame = makeGame();
      const p2View = testGame.getPlayerView(2);

      const hand1 = findChildByName(p2View.state, 'hand-1');
      expect(hand1).toBeDefined();
      expect(hand1!.children).toBeDefined();
      expect(hand1!.children!.length).toBeGreaterThan(0);

      for (const child of hand1!.children!) {
        expect(
          child.attributes.__hidden,
          `card in hand-1 should be hidden from player 2's view`,
        ).toBe(true);
        expect(child.attributes.rank).toBeUndefined();
      }
    });

    it('each player CAN see the contents of their own hand', () => {
      testGame = makeGame();

      const p1View = testGame.getPlayerView(1);
      const ownHand1 = findChildByName(p1View.state, 'hand-1');
      expect(ownHand1).toBeDefined();
      const ownCards1 = ownHand1!.children ?? [];
      expect(ownCards1.length).toBeGreaterThan(0);
      for (const card of ownCards1) {
        expect(card.attributes.__hidden).toBeUndefined();
        expect(card.attributes.rank).toBe('1');
      }

      const p2View = testGame.getPlayerView(2);
      const ownHand2 = findChildByName(p2View.state, 'hand-2');
      expect(ownHand2).toBeDefined();
      const ownCards2 = ownHand2!.children ?? [];
      expect(ownCards2.length).toBeGreaterThan(0);
      for (const card of ownCards2) {
        expect(card.attributes.__hidden).toBeUndefined();
        expect(card.attributes.rank).toBe('2');
      }
    });

    it('views for seat 1 and seat 2 are distinct (per-seat perspective)', () => {
      testGame = makeGame();
      const p1View = testGame.getPlayerView(1);
      const p2View = testGame.getPlayerView(2);

      expect(p1View.player).not.toBe(p2View.player);
      expect(p1View.flowState?.isMyTurn).not.toBe(p2View.flowState?.isMyTurn);
    });
  });

  // -------------------------------------------------------------------------
  // (3) Typed per-game access — testGame.game is the concrete class
  // -------------------------------------------------------------------------

  describe('testGame.game gives typed access to per-game custom properties', () => {
    it('testGame.game.score is accessible as a number without casting', () => {
      testGame = makeGame();
      // TypeScript infers testGame.game as FixtureGame — score is typed as number
      const score: number = testGame.game.score;
      expect(score).toBe(0);
    });

    it('testGame.game is the same instance used by the runner', () => {
      testGame = makeGame();
      // game and runner.game must reference the same object
      expect(testGame.game).toBe(testGame.runner.game);
    });
  });
});
