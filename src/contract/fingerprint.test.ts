/**
 * `canonicalize` must render a value the way `JSON.stringify` would, only with
 * sorted keys, or a fingerprint misses a change it should catch (#808).
 */
import { describe, expect, it } from 'vitest';

import { canonicalize } from './fingerprint.js';

describe('canonicalize', () => {
  it('renders a value through its own toJSON, as JSON.stringify does', () => {
    const when = new Date(Date.UTC(2026, 0, 2));
    expect(canonicalize({ b: when, a: 1 })).toBe(`{"a":1,"b":${JSON.stringify(when)}}`);
  });

  it('refuses a Map or a Set, which JSON would show as {} whatever it holds', () => {
    expect(() => canonicalize({ seats: new Map([[1, 'A']]) })).toThrow(/Map.*plain object or array/);
    expect(() => canonicalize([new Set([1])])).toThrow(/Set.*plain object or array/);
  });
});
