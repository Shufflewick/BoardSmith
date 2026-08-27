import { describe, it, expect } from 'vitest';
import {
  getTypeColor,
  formatValue,
  isExpandable,
  formatConditionValue,
  formatActionName,
  formatActionArgs,
  formatTimestamp,
  formatState,
} from './debug-format.js';

describe('getTypeColor', () => {
  it('gives every JSON type its own colour, and null a different one from undefined', () => {
    expect(getTypeColor(null)).toBe('var(--bsg-danger)');
    expect(getTypeColor(undefined)).toBe('var(--bsg-away)');
    expect(getTypeColor('s')).toBe('var(--bsg-ok)');
    expect(getTypeColor(1)).toBe('var(--bsg-accent)');
    expect(getTypeColor(false)).toBe('var(--bsg-warn)');
    expect(getTypeColor([])).toBe('var(--bsg-ink-2)');
    expect(getTypeColor({})).toBe('var(--bsg-accent-2)');
  });

  it('falls back to plain ink for anything else', () => {
    expect(getTypeColor(Symbol('x'))).toBe('var(--bsg-ink)');
    expect(getTypeColor(() => {})).toBe('var(--bsg-ink)');
  });
});

describe('formatValue', () => {
  it('summarises a value without printing it', () => {
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue('hi')).toBe('"hi"');
    expect(formatValue(true)).toBe('true');
    expect(formatValue(false)).toBe('false');
    expect(formatValue([1, 2])).toBe('Array(2)');
    expect(formatValue({ a: 1, b: 2 })).toBe('{2 keys}');
    expect(formatValue(7)).toBe('7');
  });

  it('counts an empty container as empty rather than omitting the count', () => {
    expect(formatValue([])).toBe('Array(0)');
    expect(formatValue({})).toBe('{0 keys}');
  });
});

describe('isExpandable', () => {
  it('treats only non-null objects as expandable', () => {
    expect(isExpandable({})).toBe(true);
    expect(isExpandable([])).toBe(true);
    expect(isExpandable(null)).toBe(false);
    expect(isExpandable(undefined)).toBe(false);
    expect(isExpandable('x')).toBe(false);
    expect(isExpandable(0)).toBe(false);
  });
});

describe('formatConditionValue', () => {
  it('renders each operand type readably', () => {
    expect(formatConditionValue(null)).toBe('null');
    expect(formatConditionValue(undefined)).toBe('undefined');
    expect(formatConditionValue(false)).toBe('false');
    expect(formatConditionValue(3)).toBe('3');
    expect(formatConditionValue('x')).toBe('"x"');
    expect(formatConditionValue([1, 2, 3])).toBe('[3 items]');
    expect(formatConditionValue({ a: 1 })).toBe('{"a":1}');
  });

  it('summarises an array by length rather than dumping it', () => {
    expect(formatConditionValue(new Array(500).fill(0))).toBe('[500 items]');
  });
});

describe('formatActionName', () => {
  it('turns camelCase into title case', () => {
    expect(formatActionName('playCard')).toBe('Play Card');
    expect(formatActionName('endTurn')).toBe('End Turn');
    expect(formatActionName('drawFromDiscardPile')).toBe('Draw From Discard Pile');
  });

  it('leaves an already-capitalised single word alone', () => {
    expect(formatActionName('Pass')).toBe('Pass');
  });

  it('returns nothing for an empty name', () => {
    expect(formatActionName('')).toBe('');
  });
});

describe('formatActionArgs', () => {
  it('is empty for no arguments', () => {
    expect(formatActionArgs({})).toBe('');
  });

  it('drops arguments that were never supplied', () => {
    expect(formatActionArgs({ a: 1, b: undefined, c: null })).toBe('a: 1');
  });

  it('shows an element by its notation, then its id, before falling back to JSON', () => {
    expect(formatActionArgs({ card: { __elementRef: 'AS' } })).toBe('card: AS');
    expect(formatActionArgs({ card: { __elementId: 10 } })).toBe('card: #10');
    expect(formatActionArgs({ card: { rank: 1 } })).toBe('card: {"rank":1}');
  });

  it('joins several arguments with commas', () => {
    expect(formatActionArgs({ from: 'a1', to: 'b2' })).toBe('from: a1, to: b2');
  });
});

describe('formatTimestamp', () => {
  it('is empty when an action carries no timestamp', () => {
    expect(formatTimestamp()).toBe('');
    expect(formatTimestamp(0)).toBe('');
  });

  it('renders local wall-clock time', () => {
    expect(formatTimestamp(1000)).toBe(new Date(1000).toLocaleTimeString());
  });
});

describe('formatState', () => {
  it('pretty-prints a state', () => {
    expect(formatState({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('says so when there is no state', () => {
    expect(formatState(null)).toBe('No state available');
    expect(formatState(undefined)).toBe('No state available');
  });

  it('says so rather than throwing when the state cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatState(cyclic)).toBe('Error formatting state');
  });
});
