/**
 * `choiceValueKey` names a choice the way `valuesEqual` identifies one (#563):
 * two values share a key exactly when the engine counts them as the same choice.
 */
import { describe, it, expect } from 'vitest';
import { choiceValueKey, valuesEqual } from './choice-matching.js';

const VALUES: unknown[] = [
  'red',
  '1',
  1,
  2,
  true,
  'true',
  null,
  'null',
  { from: 'harbor', to: 'north' },
  { from: 'harbor', to: 'south' },
  { from: 'harbor', to: 'north' },
  '[object Object]',
  ['a', 'b'],
  'a,b',
  { id: 7, className: 'Card' },
];

describe('choiceValueKey (#563)', () => {
  it('gives two values the same key exactly when valuesEqual counts them as one choice', () => {
    for (const a of VALUES) {
      for (const b of VALUES) {
        expect(choiceValueKey(a) === choiceValueKey(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
          .toBe(valuesEqual(a, b));
      }
    }
  });
});
