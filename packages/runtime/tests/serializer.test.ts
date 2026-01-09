import { describe, it, expect, beforeEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
} from '@boardsmith/engine';
import {
  serializeValue,
  deserializeValue,
  serializeAction,
  deserializeAction,
  isSerializedReference,
} from '../src/index.js';

// Test game classes
class TestGame extends Game<TestGame, Player> {}

class Card extends Piece<TestGame> {
  suit!: string;
  rank!: string;
}

class Hand extends Space<TestGame> {}

describe('Value Serialization', () => {
  let game: TestGame;
  let hand: Hand;
  let card: Card;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2, playerNames: ['Alice', 'Bob'] });
    hand = game.create(Hand, 'hand');
    card = hand.create(Card, 'ace-spades', { suit: 'S', rank: 'A' });
  });

  describe('serializeValue', () => {
    it('should serialize primitives unchanged', () => {
      expect(serializeValue('hello', game)).toBe('hello');
      expect(serializeValue(42, game)).toBe(42);
      expect(serializeValue(true, game)).toBe(true);
      expect(serializeValue(null, game)).toBe(null);
      expect(serializeValue(undefined, game)).toBe(undefined);
    });

    it('should serialize elements with branch paths', () => {
      const serialized = serializeValue(card, game, { useBranchPaths: true });
      expect(serialized).toEqual({ __elementRef: card.branch() });
    });

    it('should serialize elements with IDs by default', () => {
      const serialized = serializeValue(card, game);
      expect(serialized).toEqual({ __elementId: card.id });
    });

    it('should serialize players', () => {
      const player = game.getPlayer(1)!;
      const serialized = serializeValue(player, game);
      expect(serialized).toEqual({ __playerRef: 1 });
    });

    it('should serialize arrays', () => {
      const arr = [card, 'test', 123];
      const serialized = serializeValue(arr, game);
      expect(serialized).toEqual([
        { __elementId: card.id },
        'test',
        123,
      ]);
    });

    it('should serialize nested objects', () => {
      const obj = {
        target: game.getPlayer(2)!,
        card: card,
        value: 'test',
      };
      const serialized = serializeValue(obj, game);
      expect(serialized).toEqual({
        target: { __playerRef: 2 },
        card: { __elementId: card.id },
        value: 'test',
      });
    });
  });

  describe('deserializeValue', () => {
    it('should deserialize primitives unchanged', () => {
      expect(deserializeValue('hello', game)).toBe('hello');
      expect(deserializeValue(42, game)).toBe(42);
      expect(deserializeValue(null, game)).toBe(null);
    });

    it('should deserialize element refs by branch', () => {
      const ref = { __elementRef: card.branch() };
      const deserialized = deserializeValue(ref, game);
      expect(deserialized).toBe(card);
    });

    it('should deserialize element refs by ID', () => {
      const ref = { __elementId: card.id };
      const deserialized = deserializeValue(ref, game);
      expect(deserialized).toBe(card);
    });

    it('should deserialize player refs', () => {
      const ref = { __playerRef: 1 };
      const deserialized = deserializeValue(ref, game);
      expect(deserialized).toBe(game.getPlayer(1)!);
    });

    it('should deserialize arrays', () => {
      const arr = [
        { __elementId: card.id },
        'test',
        { __playerRef: 1 },
      ];
      const deserialized = deserializeValue(arr, game) as unknown[];
      expect(deserialized[0]).toBe(card);
      expect(deserialized[1]).toBe('test');
      expect(deserialized[2]).toBe(game.getPlayer(1)!);
    });

    it('should deserialize nested objects', () => {
      const obj = {
        target: { __playerRef: 1 },
        card: { __elementId: card.id },
        value: 'test',
      };
      const deserialized = deserializeValue(obj, game) as Record<string, unknown>;
      expect(deserialized.target).toBe(game.getPlayer(1)!);
      expect(deserialized.card).toBe(card);
      expect(deserialized.value).toBe('test');
    });
  });

  describe('round-trip', () => {
    it('should preserve values through serialize/deserialize', () => {
      const original = {
        player: game.getPlayer(1)!,
        cards: [card],
        rank: 'A',
        count: 3,
      };

      const serialized = serializeValue(original, game);
      const deserialized = deserializeValue(serialized, game);

      expect(deserialized).toEqual(original);
    });
  });
});

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
      expect(serialized.args.card).toEqual({ __elementId: card.id });
      expect(serialized.timestamp).toBeDefined();
    });

    it('should serialize an action with player args', () => {
      const serialized = serializeAction(
        'attack',
        game.getPlayer(1)!,
        { target: game.getPlayer(2)! },
        game
      );

      expect(serialized.args.target).toEqual({ __playerRef: 2 });
    });
  });

  describe('deserializeAction', () => {
    it('should deserialize an action', () => {
      const serialized = {
        name: 'play',
        player: 1,
        args: { card: { __elementId: card.id } },
        timestamp: Date.now(),
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
        timestamp: Date.now(),
      };

      expect(() => deserializeAction(serialized, game)).toThrow('Player at position 99 not found.');
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
