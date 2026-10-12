import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  serializeAction,
  deserializeAction,
  isSerializedReference,
} from '../index.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from '../element/world-element-id-key.test-helper.js';

// Test game classes
class TestGame extends Game<TestGame, Player> {}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
}

class Hand extends Space<TestGame> {}

describe('Action Serialization', () => {
  let game: TestGame;
  let hand: Hand;
  let card: Card;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2, playerNames: ['Alice', 'Bob'] });
    hand = game.create(Hand, 'hand');
    card = hand.create(Card, 'ace-spades', { suit: 'S', rank: 'A' });
  });

  describe('serializeAction', () => {
    it('should serialize an action with element args', () => {
      const serialized = serializeAction(
        'play',
        game.getPlayer(1)!,
        { card },
        game
      );

      expect(serialized.name).toBe('play');
      expect(serialized.player).toBe(1);  // 1-indexed position
      expect(serialized.args.card).toEqual({ __elementRef: card.branch() });
      // No timestamp: this entry goes into engine-owned actionHistory, which a
      // snapshot serializes and a replay compares byte-for-byte (#54). The
      // session host keeps arrival times beside it (#547).
      expect(serialized).not.toHaveProperty('timestamp');
    });

    it('should serialize an action with player args', () => {
      const serialized = serializeAction(
        'attack',
        game.getPlayer(1)!,
        { target: game.getPlayer(2)! },
        game
      );

      expect(serialized.args.target).toEqual({ __playerRef: 2, seat: 2, color: game.getPlayer(2)!.color, name: 'Bob' });
    });
  });

  describe('deserializeAction', () => {
    it('should deserialize an action', () => {
      const serialized = {
        name: 'play',
        player: 1,
        args: { card: { __elementId: card.id } },
      };

      const { actionName, player, args } = deserializeAction(serialized, game);

      expect(actionName).toBe('play');
      expect(player).toBe(game.getPlayer(1)!);
      expect(args.card).toBe(card);
    });

    it('should throw for invalid player', () => {
      const serialized = {
        name: 'play',
        player: 99,
        args: {},
      };

      expect(() => deserializeAction(serialized, game)).toThrow('Player at position 99 not found.');
    });
  });

  // #497: action arguments are written by the same codec as element
  // attributes, so every shape an attribute keeps, an argument keeps too.
  describe('argument shapes', () => {
    it('round trips a Map and a Set with their contents', () => {
      const args = {
        bids: new Map<string, unknown>([['ace', card], ['score', 3]]),
        seats: new Set([1, 2]),
      };

      const saved = JSON.parse(JSON.stringify(serializeAction('bid', game.getPlayer(1)!, args, game)));
      const restored = deserializeAction(saved, game).args;

      expect(restored.bids).toBeInstanceOf(Map);
      expect([...(restored.bids as Map<string, unknown>).entries()]).toEqual([['ace', card], ['score', 3]]);
      expect((restored.bids as Map<string, unknown>).get('ace')).toBe(card);
      expect(restored.seats).toBeInstanceOf(Set);
      expect([...(restored.seats as Set<number>)]).toEqual([1, 2]);
    });

    it('refuses a cyclic argument with a message naming where the cycle is', () => {
      const plan: Record<string, unknown> = { step: 1 };
      plan.self = plan;

      expect(() => serializeAction('plan', game.getPlayer(1)!, { plan }, game)).toThrowError(
        /Cannot serialize action 'plan': circular reference detected at property 'args\.plan\.self'/,
      );
    });

    // A game bundled with its own copy of the engine hands the host's runner
    // elements of a different GameElement class, so `instanceof` cannot be
    // how the codec recognises one.
    it('writes an element from another copy of the engine as a reference, not as its object graph', async () => {
      vi.resetModules();
      // Dynamic import: after vi.resetModules(), a second copy of the engine, as a bundled game carries.
      const other = await import('../index.js');
      class OtherGame extends other.Game<OtherGame, Player> {}
      class OtherCard extends other.Piece<OtherGame> {}
      const otherGame = new OtherGame({ playerCount: 2, playerNames: ['Alice', 'Bob'] });
      const otherCard = otherGame.create(OtherCard, 'card');

      const saved = serializeAction('play', otherGame.getPlayer(1)!, { card: otherCard, by: otherGame.getPlayer(2)! }, otherGame);

      expect(otherCard).not.toBeInstanceOf(Piece);
      expect(saved.args.card).toEqual({ __elementRef: otherCard.branch() });
      expect(saved.args.by).toMatchObject({ __playerRef: 2 });
    });

    it('in world mode writes an element by id, and keeps an id that is not resident verbatim', () => {
      const world = new TestGame({ playerCount: 2, seed: 'args-world', worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
      const piece = world.create(Hand, 'hand').create(Card, 'card', { suit: 'S', rank: 'A' });

      const saved = serializeAction('play', world.getPlayer(1)!, { card: piece }, world);
      expect(saved.args.card).toEqual({ __elementId: piece.id });

      const elsewhere = { __elementId: piece.id + 1000 };
      expect(deserializeAction({ ...saved, args: { card: elsewhere } }, world).args.card).toEqual(elsewhere);
    });
  });

  describe('round-trip', () => {
    it('should preserve action through serialize/deserialize', () => {
      const original = {
        actionName: 'attack',
        player: game.getPlayer(1)!,
        args: { target: game.getPlayer(2)!, card, damage: 5 },
      };

      const serialized = serializeAction(
        original.actionName,
        original.player,
        original.args,
        game
      );

      const { actionName, player, args } = deserializeAction(serialized, game);

      expect(actionName).toBe(original.actionName);
      expect(player).toBe(original.player);
      expect(args).toEqual(original.args);
    });
  });
});

describe('isSerializedReference', () => {
  it('should identify element refs', () => {
    expect(isSerializedReference({ __elementRef: '0/1' })).toBe(true);
    expect(isSerializedReference({ __elementId: 123 })).toBe(true);
  });

  it('should identify player refs', () => {
    expect(isSerializedReference({ __playerRef: 2 })).toBe(true);
  });

  it('should reject non-refs', () => {
    expect(isSerializedReference('hello')).toBe(false);
    expect(isSerializedReference(42)).toBe(false);
    expect(isSerializedReference({ foo: 'bar' })).toBe(false);
    expect(isSerializedReference(null)).toBe(false);
  });
});
