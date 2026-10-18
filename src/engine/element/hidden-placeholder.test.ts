import { describe, expect, it } from 'vitest';
import { isPositionalPlaceholderId } from './hidden-placeholder.js';

describe('isPositionalPlaceholderId', () => {
  it('is true for the negative ids a seat view gives positional placeholders', () => {
    expect(isPositionalPlaceholderId(-1)).toBe(true);
    expect(isPositionalPlaceholderId(-42)).toBe(true);
  });

  it('is false for real ids, including 0', () => {
    expect(isPositionalPlaceholderId(0)).toBe(false);
    expect(isPositionalPlaceholderId(1)).toBe(false);
    expect(isPositionalPlaceholderId(2 ** 48 - 1)).toBe(false);
  });
});
