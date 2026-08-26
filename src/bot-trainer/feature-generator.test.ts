/**
 * Feature generation: which of the FEATURE_TEMPLATES apply to a discovered
 * game structure, and the helpers that summarise the result. Everything the
 * trainer later correlates against outcomes starts here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateCandidateFeatures,
  filterFeaturesByCategory,
  getFeatureSummary,
  printFeatures,
} from './feature-generator.js';
import { FEATURE_TEMPLATES } from './feature-templates.js';
import type {
  GameStructure,
  ElementTypeInfo,
  CandidateFeature,
  GameType,
} from './types.js';

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

/** A structure rich enough that most templates find something to generate. */
const richStructure = () =>
  structure({
    elementTypes: new Map([
      ['Card', elementType('Card', {
        hasOwnership: true,
        numericProperties: ['value'],
        booleanProperties: ['isRevealed'],
        stringProperties: ['suit'],
        stringEnums: { suit: new Set(['hearts', 'spades']) },
      })],
      ['Square', elementType('Square', { isSpatial: true })],
    ]),
    playerInfo: { numericProperties: ['score'], booleanProperties: [], stringProperties: [] },
    spatialInfo: {
      hasBoard: true,
      isHex: false,
      dimensions: { rows: 8, columns: 8 },
      centerRegion: { minRow: 3, maxRow: 4, minCol: 3, maxCol: 4 },
    },
    winConditionInfo: { ...structure().winConditionInfo, gameType: 'capture', scoreBased: true },
  });

const feature = (id: string, category: CandidateFeature['category']): CandidateFeature => ({
  id,
  description: id,
  category,
  evaluate: () => true,
  templateId: 't',
});

describe('generateCandidateFeatures', () => {
  it('generates nothing for a structure with no elements, players or board', () => {
    const barren = structure({ playerCount: 1 });
    expect(generateCandidateFeatures(barren)).toEqual([]);
  });

  it('generates features for a rich structure', () => {
    expect(generateCandidateFeatures(richStructure()).length).toBeGreaterThan(0);
  });

  it('gives every feature a usable shape', () => {
    for (const generated of generateCandidateFeatures(richStructure())) {
      expect(generated.id).toBeTruthy();
      expect(generated.description).toBeTruthy();
      expect(typeof generated.evaluate).toBe('function');
      expect(generated.templateId).toBeTruthy();
    }
  });

  it('never emits the same feature id twice', () => {
    const features = generateCandidateFeatures(richStructure());
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
  });

  it('only names templates that actually exist', () => {
    const templateIds = new Set(FEATURE_TEMPLATES.map((t) => t.id));
    for (const generated of generateCandidateFeatures(richStructure())) {
      expect(templateIds.has(generated.templateId)).toBe(true);
    }
  });

  it('skips ownership templates when no element type is owned', () => {
    const unowned = structure({
      elementTypes: new Map([['Card', elementType('Card', { hasOwnership: false })]]),
    });
    for (const generated of generateCandidateFeatures(unowned)) {
      const template = FEATURE_TEMPLATES.find((t) => t.id === generated.templateId)!;
      expect(template.requires.ownership).not.toBe(true);
    }
  });

  it('skips spatial templates when the game has no board', () => {
    for (const generated of generateCandidateFeatures(structure({
      elementTypes: new Map([['Card', elementType('Card', { hasOwnership: true })]]),
    }))) {
      const template = FEATURE_TEMPLATES.find((t) => t.id === generated.templateId)!;
      expect(template.requires.spatial).not.toBe(true);
    }
  });

  it('skips score templates when players carry no numeric properties', () => {
    for (const generated of generateCandidateFeatures(structure({
      elementTypes: new Map([['Card', elementType('Card', { hasOwnership: true })]]),
    }))) {
      const template = FEATURE_TEMPLATES.find((t) => t.id === generated.templateId)!;
      expect(template.requires.playerScore).not.toBe(true);
    }
  });

  it('skips multi-player templates in a solo game', () => {
    const solo = { ...richStructure(), playerCount: 1 };
    for (const generated of generateCandidateFeatures(solo)) {
      const template = FEATURE_TEMPLATES.find((t) => t.id === generated.templateId)!;
      expect(template.requires.multiPlayer).not.toBe(true);
    }
  });

  it('only applies a game-type-specific template to a matching game type', () => {
    const connection = {
      ...richStructure(),
      winConditionInfo: { ...richStructure().winConditionInfo, gameType: 'connection' as GameType },
    };
    for (const generated of generateCandidateFeatures(connection)) {
      const required = FEATURE_TEMPLATES.find((t) => t.id === generated.templateId)!.requires.gameType;
      if (required === undefined) continue;
      const allowed = Array.isArray(required) ? required : [required];
      expect(allowed).toContain('connection');
    }
  });

  it('produces a different feature set for a different game type', () => {
    const ids = (gameType: GameType) => generateCandidateFeatures({
      ...richStructure(),
      winConditionInfo: { ...richStructure().winConditionInfo, gameType },
    }).map((f) => f.id).join(',');
    expect(ids('connection')).not.toBe(ids('racing'));
  });

  it('is deterministic for the same structure', () => {
    const first = generateCandidateFeatures(richStructure()).map((f) => f.id);
    const second = generateCandidateFeatures(richStructure()).map((f) => f.id);
    expect(second).toEqual(first);
  });

  it('does not mutate the structure it reads', () => {
    const input = richStructure();
    const before = {
      types: [...input.elementTypes.keys()],
      playerCount: input.playerCount,
      spatial: { ...input.spatialInfo },
    };
    generateCandidateFeatures(input);
    expect([...input.elementTypes.keys()]).toEqual(before.types);
    expect(input.playerCount).toBe(before.playerCount);
    expect(input.spatialInfo).toEqual(before.spatial);
  });
});

describe('FEATURE_TEMPLATES', () => {
  it('is not empty — the trainer has nothing to try otherwise', () => {
    expect(FEATURE_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('gives every template a unique id', () => {
    const ids = FEATURE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every template a category, description and generator', () => {
    for (const template of FEATURE_TEMPLATES) {
      expect(template.category).toBeTruthy();
      expect(template.descriptionTemplate).toBeTruthy();
      expect(typeof template.generate).toBe('function');
      expect(template.requires).toBeTypeOf('object');
    }
  });

  it('generates features whose templateId points back at the template', () => {
    for (const template of FEATURE_TEMPLATES) {
      for (const generated of template.generate(richStructure())) {
        expect(generated.templateId).toBe(template.id);
      }
    }
  });

  it('every generator survives an empty structure without throwing', () => {
    for (const template of FEATURE_TEMPLATES) {
      expect(() => template.generate(structure()), `${template.id} threw`).not.toThrow();
    }
  });
});

describe('filterFeaturesByCategory', () => {
  const features = [
    feature('a', 'count'),
    feature('b', 'spatial'),
    feature('c', 'count'),
  ];

  it('keeps only the requested category', () => {
    expect(filterFeaturesByCategory(features, ['count']).map((f) => f.id)).toEqual(['a', 'c']);
  });

  it('accepts several categories at once', () => {
    expect(filterFeaturesByCategory(features, ['count', 'spatial'])).toHaveLength(3);
  });

  it('returns nothing for a category none of the features use', () => {
    expect(filterFeaturesByCategory(features, ['ratio'])).toEqual([]);
  });

  it('returns nothing when no category is requested', () => {
    expect(filterFeaturesByCategory(features, [])).toEqual([]);
  });

  it('preserves the original order', () => {
    expect(filterFeaturesByCategory(features, ['count', 'spatial']).map((f) => f.id))
      .toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    filterFeaturesByCategory(features, ['count']);
    expect(features).toHaveLength(3);
  });
});

describe('getFeatureSummary', () => {
  it('counts features per category', () => {
    expect(getFeatureSummary([feature('a', 'count'), feature('b', 'count'), feature('c', 'spatial')]))
      .toEqual({ count: 2, spatial: 1, total: 3 });
  });

  it('reports a total of 0 for no features', () => {
    expect(getFeatureSummary([])).toEqual({ total: 0 });
  });

  it('the per-category counts add up to the total', () => {
    const summary = getFeatureSummary(generateCandidateFeatures(richStructure()));
    const { total, ...categories } = summary;
    expect(Object.values(categories).reduce((sum, n) => sum + n, 0)).toBe(total);
  });
});

describe('printFeatures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const capture = (features: CandidateFeature[]): string => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printFeatures(features);
    return log.mock.calls.map((call) => call.join(' ')).join('\n');
  };

  it('reports the total count', () => {
    expect(capture([feature('a', 'count'), feature('b', 'spatial')])).toContain('2 total');
  });

  it('groups the listing by category', () => {
    const output = capture([feature('a', 'count'), feature('b', 'spatial')]);
    expect(output).toContain('COUNT');
    expect(output).toContain('SPATIAL');
  });

  it('lists every feature with its description', () => {
    const output = capture([feature('centre-control', 'spatial')]);
    expect(output).toContain('centre-control');
  });

  it('handles an empty list without throwing', () => {
    expect(() => capture([])).not.toThrow();
  });
});
