import { describe, it, expect } from 'vitest';
import { hasActionHelp } from './actionHelp.js';

describe('hasActionHelp', () => {
  it('is true when an available action has help text', () => {
    expect(hasActionHelp(['look', 'move'], { move: { help: 'Walk somewhere.' } }, undefined)).toBe(true);
  });

  it('is false when nothing available has help, including help on an action not offered', () => {
    expect(hasActionHelp(['look'], { move: { help: 'Walk somewhere.' } }, undefined)).toBe(false);
    expect(hasActionHelp([], undefined, undefined)).toBe(false);
  });

  it('is true when the action in progress has help, even when it is not among the available actions (#1455)', () => {
    expect(hasActionHelp([], {}, 'Pick a card to discard.')).toBe(true);
  });
});
