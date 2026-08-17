/**
 * A GameStructure holds Maps and Sets, which structured cloning to a worker
 * thread cannot carry through the trainer's message protocol. These two
 * functions are the boundary; a lossy round trip silently changes which
 * features a worker generates.
 */
import { describe, it, expect } from 'vitest';
import { serializeGameStructure, deserializeGameStructure } from './simulator.js';
import type { GameStructure, ElementTypeInfo, GameType } from './types.js';

const elementType = (
  className: string,
  overrides: Partial<ElementTypeInfo> = {},
): ElementTypeInfo => ({
  className,
  numericProperties: [],
  booleanProperties: [],
  stringProperties: [],
  hasOwnership: false,
  isSpatial: false,
  stringEnums: {},
  ...overrides,
});

const structure = (overrides: Partial<GameStructure> = {}): GameStructure => ({
  elementTypes: new Map([
    ['Card', elementType('Card', {
      hasOwnership: true,
      numericProperties: ['value'],
      booleanProperties: ['isRevealed'],
      stringProperties: ['suit'],
      stringEnums: { suit: new Set(['hearts', 'spades', 'clubs', 'diamonds']) },
    })],
    ['Square', elementType('Square', { isSpatial: true })],
  ]),
  playerInfo: { numericProperties: ['score'], booleanProperties: ['isDealer'], stringProperties: [] },
  spatialInfo: {
    hasBoard: true,
    isHex: false,
    dimensions: { rows: 8, columns: 8 },
    centerRegion: { minRow: 3, maxRow: 4, minCol: 3, maxCol: 4 },
  },
  playerCount: 3,
  winConditionInfo: {
    gameType: 'capture' as GameType,
    confidence: 0.8,
    indicators: ['piece removal'],
    scoreBased: false,
    eliminationBased: true,
    connectionBased: false,
    collectionBased: false,
  },
  ...overrides,
});

describe('serializeGameStructure', () => {
  it('turns the element-type Map into a plain object keyed the same way', () => {
    const serialized = serializeGameStructure(structure());
    expect(Object.keys(serialized.elementTypes)).toEqual(['Card', 'Square']);
  });

  it('turns each stringEnums Set into an array', () => {
    const serialized = serializeGameStructure(structure());
    expect(serialized.elementTypes.Card.stringEnums.suit)
      .toEqual(['hearts', 'spades', 'clubs', 'diamonds']);
  });

  it('carries the player, spatial, count and win-condition blocks unchanged', () => {
    const input = structure();
    const serialized = serializeGameStructure(input);
    expect(serialized.playerInfo).toEqual(input.playerInfo);
    expect(serialized.spatialInfo).toEqual(input.spatialInfo);
    expect(serialized.playerCount).toBe(3);
    expect(serialized.winConditionInfo).toEqual(input.winConditionInfo);
  });

  it('produces something structured cloning can actually carry', () => {
    const serialized = serializeGameStructure(structure());
    expect(() => structuredClone(serialized)).not.toThrow();
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });

  it('handles a structure with no element types', () => {
    const serialized = serializeGameStructure(structure({ elementTypes: new Map() }));
    expect(serialized.elementTypes).toEqual({});
  });

  it('handles an element type with no string enums', () => {
    const serialized = serializeGameStructure(structure({
      elementTypes: new Map([['Token', elementType('Token')]]),
    }));
    expect(serialized.elementTypes.Token.stringEnums).toEqual({});
  });

  it('does not mutate the structure it serializes', () => {
    const input = structure();
    serializeGameStructure(input);
    expect(input.elementTypes.get('Card')!.stringEnums.suit).toBeInstanceOf(Set);
  });
});

describe('deserializeGameStructure', () => {
  it('rebuilds the element types as a Map', () => {
    const restored = deserializeGameStructure(serializeGameStructure(structure()));
    expect(restored.elementTypes).toBeInstanceOf(Map);
    expect([...restored.elementTypes.keys()]).toEqual(['Card', 'Square']);
  });

  it('rebuilds stringEnums as Sets, which is what the templates read', () => {
    const restored = deserializeGameStructure(serializeGameStructure(structure()));
    const suits = restored.elementTypes.get('Card')!.stringEnums.suit;
    expect(suits).toBeInstanceOf(Set);
    expect(suits.has('hearts')).toBe(true);
    expect(suits.size).toBe(4);
  });

  it('handles an empty element-type map', () => {
    const restored = deserializeGameStructure(serializeGameStructure(
      structure({ elementTypes: new Map() })
    ));
    expect(restored.elementTypes.size).toBe(0);
  });
});

describe('round trip', () => {
  it('reproduces the structure exactly', () => {
    const input = structure();
    expect(deserializeGameStructure(serializeGameStructure(input))).toEqual(input);
  });

  it('survives a real structured clone in between, as a worker message would', () => {
    const input = structure();
    const overTheWire = structuredClone(serializeGameStructure(input));
    expect(deserializeGameStructure(overTheWire)).toEqual(input);
  });

  it('is stable across repeated trips', () => {
    const input = structure();
    let current = input;
    for (let i = 0; i < 3; i++) {
      current = deserializeGameStructure(serializeGameStructure(current));
    }
    expect(current).toEqual(input);
  });

  it('preserves duplicate-free enum semantics', () => {
    const input = structure({
      elementTypes: new Map([['Card', elementType('Card', {
        stringEnums: { suit: new Set(['red', 'red', 'black']) },
      })]]),
    });
    const restored = deserializeGameStructure(serializeGameStructure(input));
    expect(restored.elementTypes.get('Card')!.stringEnums.suit.size).toBe(2);
  });

  it('preserves an absent optional spatial field rather than inventing one', () => {
    const input = structure({ spatialInfo: { hasBoard: false, isHex: false } });
    const restored = deserializeGameStructure(serializeGameStructure(input));
    expect(restored.spatialInfo.dimensions).toBeUndefined();
    expect(restored.spatialInfo.centerRegion).toBeUndefined();
  });
});
