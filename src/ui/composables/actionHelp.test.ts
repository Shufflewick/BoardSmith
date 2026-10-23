import { describe, it, expect } from 'vitest';
import { hasActionHelp } from './actionHelp.js';

describe('hasActionHelp', () => {
  it('is true when an available action has help text or a disabled reason', () => {
    expect(hasActionHelp(['look', 'move'], { move: { help: 'Walk somewhere.' } }, {})).toBe(true);
    expect(hasActionHelp(['look', 'move'], {}, { move: 'The door is barred.' })).toBe(true);
  });

  it('is false when nothing available has either, including help on an action not offered', () => {
    expect(hasActionHelp(['look'], { move: { help: 'Walk somewhere.' } }, { move: 'The door is barred.' })).toBe(false);
    expect(hasActionHelp([], undefined, undefined)).toBe(false);
  });
});
