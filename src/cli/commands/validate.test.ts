import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TOP_LEVEL_KEYS,
  suggestKey,
  findUnknownKeys,
} from '../lib/config-schema.js';

describe('config-schema', () => {
  it('ALLOWED_TOP_LEVEL_KEYS matches boardsmith.schema.json properties (single source, no drift)', async () => {
    const schema = (await import('../lib/boardsmith.schema.json')).default as {
      properties: Record<string, unknown>;
    };
    expect([...ALLOWED_TOP_LEVEL_KEYS].sort()).toEqual(Object.keys(schema.properties).sort());
  });

  it('suggestKey maps a near-miss typo to the correct allowed key', () => {
    expect(suggestKey('gameOption')).toBe('gameOptions');
    expect(suggestKey('playerOption')).toBe('playerOptions');
    expect(suggestKey('colorPallete')).toBe('colorPalette');
  });

  it('suggestKey returns undefined for a string far from any allowed key', () => {
    expect(suggestKey('completelyUnrelatedXyz')).toBeUndefined();
  });

  it('findUnknownKeys reports only the unknown key, with a suggestion when close enough', () => {
    const result = findUnknownKeys({ name: 'x', gameOption: {} });
    expect(result).toEqual([{ key: 'gameOption', suggestion: 'gameOptions' }]);
  });

  it('findUnknownKeys ignores every valid key and returns nothing for a fully valid config', () => {
    const result = findUnknownKeys({
      name: 'x',
      displayName: 'X',
      description: 'desc',
      gameOptions: [],
      playerOptions: [],
      colorPalette: [],
      paths: { rules: 'src/rules' },
      gameId: 'abc123',
      version: '1.0.0',
      ui: 'auto',
    });
    expect(result).toEqual([]);
  });

  it('findUnknownKeys reports an unknown key with no suggestion when nothing is close', () => {
    const result = findUnknownKeys({ name: 'x', completelyUnrelatedXyz: true });
    expect(result).toEqual([{ key: 'completelyUnrelatedXyz' }]);
  });
});
