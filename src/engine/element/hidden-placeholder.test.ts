import { describe, expect, it } from 'vitest';
import { isPlaceholderId } from './hidden-placeholder.js';

describe('isPlaceholderId', () => {
  it('is true for the negative ids a seat view gives placeholders', () => {
    expect(isPlaceholderId(-1)).toBe(true);
    expect(isPlaceholderId(-42)).toBe(true);
  });

  it('is false for real ids, including 0', () => {
    expect(isPlaceholderId(0)).toBe(false);
    expect(isPlaceholderId(1)).toBe(false);
    expect(isPlaceholderId(2 ** 48 - 1)).toBe(false);
  });
});
