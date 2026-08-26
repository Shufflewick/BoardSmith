/**
 * `boardsmith lint`'s heuristic rules run on raw text, not on an AST, so each
 * one has to be narrow enough that a false positive is rarer than a real hit.
 *
 * The element-equality rule was not (#34): it matched any of a handful of
 * domain words appearing anywhere to the right of `===`, which meant it fired
 * on `a.id === card.id` — the exact pattern its own message recommends. On a
 * clean codebase that produced 111 warnings of pure noise, which is how a team
 * learns to ignore lint output. The AST rule that gets this right already
 * exists as the ESLint plugin's `no-element-identity-comparison`.
 */
import { describe, it, expect } from 'vitest';
import { lintFile } from './lint.js';

const rulesFor = (code: string): string[] =>
  lintFile('game.ts', code).map((issue) => issue.rule);

describe('element identity comparison is left to the AST rule (#34)', () => {
  it.each([
    'const same = m.id === merc.id;',
    'const same = c.id === card.id;',
    'const same = s.sectorId === sectorId;',
    'const same = a.id === piece.id;',
    'const found = squads.find((s) => s.id === squad.id);',
  ])('does not flag the .id comparison it recommends: %s', (code) => {
    expect(rulesFor(code)).not.toContain('element-equality');
  });

  it('leaves no element-equality rule behind to false-positive with', () => {
    // The check is gone entirely rather than tightened — a text regex cannot
    // tell `a === b` on two elements from `a === b` on two numbers, and the
    // plugin rule can.
    expect(rulesFor('const same = cardA === cardB;')).not.toContain('element-equality');
  });
});

describe('element-indexof stays narrow', () => {
  it('flags indexOf on what is plainly an element', () => {
    expect(rulesFor('const i = hand.indexOf(card);')).toContain('element-indexof');
  });

  it('does not flag indexOf on an id, which is a value comparison', () => {
    expect(rulesFor('const i = ids.indexOf(cardId);')).not.toContain('element-indexof');
    expect(rulesFor('const i = ids.indexOf(sectorId);')).not.toContain('element-indexof');
  });
});

describe('the rules that were never the problem still fire', () => {
  it('still flags .includes() on a collection of elements', () => {
    expect(rulesFor('const has = hand.includes(card);')).toContain('element-includes');
  });

  it('leaves ordinary game code alone', () => {
    expect(rulesFor('const total = game.all(Card).length + 1;')).toEqual([]);
  });
});
