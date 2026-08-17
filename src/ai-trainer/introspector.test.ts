/**
 * Introspection is step one of training: build a throwaway game, walk its
 * element tree, and describe what the feature templates have to work with.
 * Everything downstream (features, weights, generated ai.ts) is derived from
 * what this reports, so a missed property is a silently weaker AI.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  introspectGame,
  createIntrospectionGame,
  estimateComplexity,
  printGameStructure,
} from './introspector.js';
import type { GameStructure, GameType } from './types.js';
import {
  Game,
  Player,
  Piece,
  Space,
  Grid,
  GridCell,
  type GameOptions,
} from '../engine/index.js';

class Card extends Piece<CardGame> {
  value = 3;
  suit = 'hearts';
  isRevealed = false;
}

class Hand extends Space<CardGame> {}

class CardPlayer extends Player {
  score = 0;
  isDealer = false;
}

class CardGame extends Game<CardGame, CardPlayer> {
  static PlayerClass = CardPlayer;

  constructor(options: GameOptions) {
    super(options);
    for (const player of this.players) {
      const hand = this.create(Hand, 'hand', { player });
      hand.create(Card, 'card', { player, value: 5, suit: 'spades' });
    }
  }
}

class Square extends GridCell<BoardGame> {
  row!: number;
  column!: number;
}

class Board extends Grid<BoardGame> {}

class BoardGame extends Game<BoardGame, Player> {
  constructor(options: GameOptions & { size?: number }) {
    super(options);
    const size = options.size ?? 8;
    const board = this.create(Board, 'board');
    for (let row = 1; row <= size; row++) {
      for (let column = 1; column <= size; column++) {
        board.create(Square, `${row}-${column}`, { row, column });
      }
    }
  }
}

class BareGame extends Game<BareGame, Player> {}

const structure = (overrides: Partial<GameStructure> = {}): GameStructure => ({
  elementTypes: new Map(),
  playerInfo: { numericProperties: [], booleanProperties: [], stringProperties: [] },
  spatialInfo: { hasBoard: false, isHex: false },
  playerCount: 2,
  winConditionInfo: {
    gameType: 'unknown' as GameType,
    confidence: 0.5,
    indicators: [],
    scoreBased: false,
    eliminationBased: false,
    connectionBased: false,
    collectionBased: false,
  },
  ...overrides,
});

describe('createIntrospectionGame', () => {
  it('builds a playable instance of the game class', () => {
    expect(createIntrospectionGame(CardGame)).toBeInstanceOf(CardGame);
  });

  it('defaults to two players', () => {
    expect(createIntrospectionGame(CardGame).players).toHaveLength(2);
  });

  it('honours an explicit player count', () => {
    expect(createIntrospectionGame(CardGame, 4).players).toHaveLength(4);
  });

  it('uses a fixed seed, so introspection is reproducible', () => {
    const first = createIntrospectionGame(CardGame);
    const second = createIntrospectionGame(CardGame);
    expect(first.random()).toBe(second.random());
  });

  it('produces a structure that does not vary between runs', () => {
    const first = introspectGame(createIntrospectionGame(CardGame));
    const second = introspectGame(createIntrospectionGame(CardGame));
    expect(second).toEqual(first);
  });
});

describe('introspectGame', () => {
  it('counts the players', () => {
    expect(introspectGame(createIntrospectionGame(CardGame, 3)).playerCount).toBe(3);
  });

  it('discovers the game element classes', () => {
    const found = introspectGame(createIntrospectionGame(CardGame));
    expect([...found.elementTypes.keys()]).toEqual(expect.arrayContaining(['Card', 'Hand']));
  });

  it('classifies element properties by type', () => {
    const card = introspectGame(createIntrospectionGame(CardGame)).elementTypes.get('Card')!;
    expect(card.numericProperties).toContain('value');
    expect(card.stringProperties).toContain('suit');
    expect(card.booleanProperties).toContain('isRevealed');
  });

  it('records the values a string property actually takes', () => {
    const card = introspectGame(createIntrospectionGame(CardGame)).elementTypes.get('Card')!;
    expect(card.stringEnums.suit).toBeInstanceOf(Set);
    expect(card.stringEnums.suit.has('spades')).toBe(true);
  });

  it('marks an owned element type as having ownership', () => {
    const card = introspectGame(createIntrospectionGame(CardGame)).elementTypes.get('Card')!;
    expect(card.hasOwnership).toBe(true);
  });

  it('discovers player properties by type', () => {
    const playerInfo = introspectGame(createIntrospectionGame(CardGame)).playerInfo;
    expect(playerInfo.numericProperties).toContain('score');
    expect(playerInfo.booleanProperties).toContain('isDealer');
  });

  it('reports no board for a card game', () => {
    expect(introspectGame(createIntrospectionGame(CardGame)).spatialInfo.hasBoard).toBe(false);
  });

  it('detects a board and its dimensions for a grid game', () => {
    const spatial = introspectGame(createIntrospectionGame(BoardGame)).spatialInfo;
    expect(spatial.hasBoard).toBe(true);
    expect(spatial.dimensions).toEqual({ rows: 8, columns: 8 });
  });

  it('marks grid cells as spatial', () => {
    const square = introspectGame(createIntrospectionGame(BoardGame)).elementTypes.get('Square')!;
    expect(square.isSpatial).toBe(true);
  });

  it('always reports a win-condition classification', () => {
    const info = introspectGame(createIntrospectionGame(CardGame)).winConditionInfo;
    expect(typeof info.gameType).toBe('string');
    expect(info.confidence).toBeGreaterThanOrEqual(0);
    expect(info.confidence).toBeLessThanOrEqual(1);
  });

  it('survives a game with no elements at all', () => {
    const found = introspectGame(createIntrospectionGame(BareGame));
    expect(found.playerCount).toBe(2);
    expect(found.spatialInfo.hasBoard).toBe(false);
  });

  it('does not describe the Game element itself as an element type', () => {
    const found = introspectGame(createIntrospectionGame(CardGame));
    expect(found.elementTypes.has('Game')).toBe(false);
    expect(found.elementTypes.has('GameElement')).toBe(false);
  });

  it('does not mutate the game it inspects', () => {
    const game = createIntrospectionGame(CardGame);
    const before = JSON.stringify(game.toJSON());
    introspectGame(game);
    expect(JSON.stringify(game.toJSON())).toBe(before);
  });
});

describe('estimateComplexity', () => {
  it('scores a bare structure at the bottom of the scale', () => {
    const complexity = estimateComplexity(structure());
    expect(complexity.score).toBeLessThan(30);
    expect(complexity.category).toBe('simple');
  });

  it('keeps the score inside 0..100', () => {
    const huge = structure({
      elementTypes: new Map(Array.from({ length: 40 }, (_, i) =>
        [`T${i}`, {
          className: `T${i}`, numericProperties: [], booleanProperties: [],
          stringProperties: [], hasOwnership: false, isSpatial: false, stringEnums: {},
        }])),
      spatialInfo: { hasBoard: true, isHex: false, dimensions: { rows: 100, columns: 100 } },
      playerInfo: {
        numericProperties: Array.from({ length: 20 }, (_, i) => `n${i}`),
        booleanProperties: Array.from({ length: 20 }, (_, i) => `b${i}`),
        stringProperties: [],
      },
    });
    const complexity = estimateComplexity(huge);
    expect(complexity.score).toBeGreaterThanOrEqual(0);
    expect(complexity.score).toBeLessThanOrEqual(100);
  });

  it('returns an integer score', () => {
    expect(Number.isInteger(estimateComplexity(structure()).score)).toBe(true);
  });

  it('reports the factors it derived the score from', () => {
    const complexity = estimateComplexity(structure({
      spatialInfo: { hasBoard: true, isHex: false, dimensions: { rows: 8, columns: 8 } },
    }));
    expect(complexity.factors.hasSpatial).toBe(true);
    expect(complexity.factors.boardSize).toBe(64);
  });

  it('reports board size 0 when there are no dimensions', () => {
    expect(estimateComplexity(structure()).factors.boardSize).toBe(0);
  });

  it('estimates a modest branching factor for a non-spatial game', () => {
    const complexity = estimateComplexity(structure());
    expect(complexity.factors.estimatedBranchingFactor).toBeLessThanOrEqual(10);
  });

  it('estimates a larger branching factor as the board grows', () => {
    const branching = (rows: number, columns: number) =>
      estimateComplexity(structure({
        spatialInfo: { hasBoard: true, isHex: false, dimensions: { rows, columns } },
      })).factors.estimatedBranchingFactor;
    expect(branching(8, 8)).toBeLessThan(branching(10, 10));
    expect(branching(10, 10)).toBeLessThan(branching(19, 19));
  });

  it('scores a Go-sized board as more complex than a chess-sized one', () => {
    const score = (rows: number, columns: number) =>
      estimateComplexity(structure({
        spatialInfo: { hasBoard: true, isHex: false, dimensions: { rows, columns } },
      })).score;
    expect(score(19, 19)).toBeGreaterThan(score(8, 8));
  });

  it('rates a checkers-shaped structure simple, matching its documented calibration', () => {
    const checkers = structure({
      elementTypes: new Map([
        ['Piece', { className: 'Piece', numericProperties: [], booleanProperties: ['isKing'], stringProperties: [], hasOwnership: true, isSpatial: false, stringEnums: {} }],
        ['Square', { className: 'Square', numericProperties: ['row', 'column'], booleanProperties: [], stringProperties: [], hasOwnership: false, isSpatial: true, stringEnums: {} }],
      ]),
      spatialInfo: { hasBoard: true, isHex: false, dimensions: { rows: 8, columns: 8 } },
    });
    expect(estimateComplexity(checkers).category).toBe('simple');
  });

  it('recommends more MCTS iterations for a more complex game', () => {
    const simple = estimateComplexity(structure());
    const complex = estimateComplexity(structure({
      spatialInfo: { hasBoard: true, isHex: false, dimensions: { rows: 19, columns: 19 } },
      playerInfo: { numericProperties: ['a', 'b', 'c'], booleanProperties: ['d', 'e'], stringProperties: [] },
    }));
    expect(complex.recommendedMCTS).toBeGreaterThan(simple.recommendedMCTS);
  });

  it('keeps category and recommended iterations consistent', () => {
    const expected: Record<string, number> = {
      simple: 15, moderate: 25, complex: 50, 'very-complex': 100,
    };
    for (const size of [0, 8, 10, 19, 40]) {
      const complexity = estimateComplexity(structure({
        spatialInfo: size
          ? { hasBoard: true, isHex: false, dimensions: { rows: size, columns: size } }
          : { hasBoard: false, isHex: false },
      }));
      expect(complexity.recommendedMCTS).toBe(expected[complexity.category]);
    }
  });

  it('works on a structure discovered from a real game', () => {
    const complexity = estimateComplexity(introspectGame(createIntrospectionGame(BoardGame)));
    expect(complexity.score).toBeGreaterThan(0);
    expect(['simple', 'moderate', 'complex', 'very-complex']).toContain(complexity.category);
  });
});

describe('printGameStructure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const capture = (input: GameStructure): string => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printGameStructure(input);
    return log.mock.calls.map((call) => call.join(' ')).join('\n');
  };

  it('reports the player count', () => {
    expect(capture(structure({ playerCount: 4 }))).toContain('Players: 4');
  });

  it('lists each element type with its properties', () => {
    const output = capture(introspectGame(createIntrospectionGame(CardGame)));
    expect(output).toContain('Card');
    expect(output).toContain('value');
    expect(output).toContain('suit');
    expect(output).toContain('isRevealed');
  });

  it('lists the values of a small string enum', () => {
    expect(capture(introspectGame(createIntrospectionGame(CardGame)))).toContain('spades');
  });

  it('reports the player properties', () => {
    expect(capture(introspectGame(createIntrospectionGame(CardGame)))).toContain('score');
  });

  it('reports board dimensions when there is a board', () => {
    expect(capture(introspectGame(createIntrospectionGame(BoardGame)))).toContain('8 x 8');
  });

  it('says there is no board when there is none', () => {
    expect(capture(structure())).toContain('Has Board: false');
  });

  it('handles an empty structure without throwing', () => {
    expect(() => capture(structure())).not.toThrow();
  });
});
