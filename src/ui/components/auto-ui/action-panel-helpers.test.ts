import { describe, it, expect } from 'vitest';
import {
  splitAnchoredChoices,
  shouldDeferElementPickToBoard,
  textLengthHint,
  numberRangeHint,
} from './action-panel-helpers.js';
import type { ChoiceWithRefs, ValidElement } from '../../composables/useActionControllerTypes.js';

describe('splitAnchoredChoices', () => {
  const notationChoice: ChoiceWithRefs = {
    value: 'a5',
    display: 'a5',
    refs: [{ ref: { notation: 'a5' }, role: 'target' }],
  };
  const anotherNotationChoice: ChoiceWithRefs = {
    value: 'b3',
    display: 'b3',
    refs: [{ ref: { notation: 'b3' }, role: 'target' }],
  };
  // id-only ref: highlights on board but is NOT a clickable board selection surface
  const idOnlyChoice: ChoiceWithRefs = {
    value: 'hearts',
    display: 'Hearts',
    refs: [{ ref: { id: 10 }, role: 'highlight' }],
  };
  const noRefChoice: ChoiceWithRefs = {
    value: 'skip',
    display: 'Skip',
  };

  it('returns all choices as primary for non-choice pickType', () => {
    const result = splitAnchoredChoices([notationChoice, idOnlyChoice], 'element');
    expect(result.primary).toHaveLength(2);
    expect(result.anchored).toHaveLength(0);
  });

  it('returns all choices as primary when pickType is undefined', () => {
    const result = splitAnchoredChoices([notationChoice, idOnlyChoice], undefined);
    expect(result.primary).toHaveLength(2);
    expect(result.anchored).toHaveLength(0);
  });

  it('partitions notation-anchored choices into anchored and rest into primary for choice pickType', () => {
    const result = splitAnchoredChoices([notationChoice, idOnlyChoice, noRefChoice], 'choice');
    expect(result.primary).toHaveLength(2);
    expect(result.primary).toContain(idOnlyChoice);
    expect(result.primary).toContain(noRefChoice);
    expect(result.anchored).toHaveLength(1);
    expect(result.anchored[0]).toBe(notationChoice);
  });

  it('anchored choices are never dropped — they appear in the anchored array', () => {
    const result = splitAnchoredChoices([notationChoice, anotherNotationChoice], 'choice');
    expect(result.primary).toHaveLength(0);
    expect(result.anchored).toHaveLength(2);
    expect(result.anchored).toContain(notationChoice);
    expect(result.anchored).toContain(anotherNotationChoice);
  });

  it('returns all choices as primary when no choices are notation-anchored', () => {
    const result = splitAnchoredChoices([idOnlyChoice, noRefChoice], 'choice');
    expect(result.primary).toHaveLength(2);
    expect(result.anchored).toHaveLength(0);
  });

  it('does not count id-only refs as anchored', () => {
    const result = splitAnchoredChoices([idOnlyChoice], 'choice');
    expect(result.anchored).toHaveLength(0);
    expect(result.primary).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// #172 — the panel defers a large anchored element pick to the board
// ---------------------------------------------------------------------------

describe('shouldDeferElementPickToBoard', () => {
  const anchored = (n: number): ValidElement[] =>
    Array.from({ length: n }, (_, i) => ({ id: i, display: `c${i}`, refs: [{ role: 'target' as const, ref: { id: i, notation: `n${i}` } }] }));

  it('defers an element pick larger than the threshold when every candidate is on the board', () => {
    expect(shouldDeferElementPickToBoard('element', anchored(25), 24)).toBe(true);
  });

  it('keeps a pick at the threshold in the panel', () => {
    expect(shouldDeferElementPickToBoard('element', anchored(24), 24)).toBe(false);
  });

  it('applies to multi-element picks too', () => {
    expect(shouldDeferElementPickToBoard('elements', anchored(40), 24)).toBe(true);
  });

  it('never defers a choice pick — choice values are not board elements', () => {
    expect(shouldDeferElementPickToBoard('choice', anchored(40), 24)).toBe(false);
  });

  it('never defers when a candidate carries no board ref — that one would vanish', () => {
    const mixed = [...anchored(40), { id: 999, display: 'off-board' }];
    expect(shouldDeferElementPickToBoard('element', mixed, 24)).toBe(false);
  });

  it('never defers an empty candidate list', () => {
    expect(shouldDeferElementPickToBoard('element', [], 0)).toBe(false);
  });
});

/**
 * #229 reported the hint rendering as `(?-1000 chars)` for a field with a
 * maximum and no minimum -- which is every field declared the way `enterText`
 * is normally declared, because `maxLength` always has a value and `minLength`
 * usually does not. A question mark where a number belongs reads as a bug in
 * the game, and "?-1000" does not say the thing the player needs to know.
 *
 * The fix is one function so the single-line field and the multiline field can
 * never disagree about the sentence, which was the second half of the report:
 * one of them being right would have left the other wrong.
 */
describe('textLengthHint', () => {
  it('states only the maximum when there is no minimum', () => {
    expect(textLengthHint({ maxLength: 1000 })).toBe('up to 1000 characters');
  });

  it('states only the minimum when there is no maximum', () => {
    expect(textLengthHint({ minLength: 10 })).toBe('at least 10 characters');
  });

  it('states the range when the field has both', () => {
    expect(textLengthHint({ minLength: 10, maxLength: 1000 })).toBe('10 to 1000 characters');
  });

  it('says nothing at all when the field is bounded by neither', () => {
    // No hint beats an empty pair of brackets. `enterText` always applies a
    // maximum, so this is the shape of a pick a host hand-built.
    expect(textLengthHint({})).toBeUndefined();
  });

  it('never renders a question mark, which is what the report was about', () => {
    for (const rules of [{ maxLength: 1000 }, { minLength: 10 }, { minLength: 1, maxLength: 2 }]) {
      expect(textLengthHint(rules)).not.toContain('?');
    }
  });

  it('speaks in whole words, because a screen reader reads it aloud', () => {
    // The hint is bound to the field through `aria-describedby`, so "chars" was
    // being read out as an abbreviation to the one player who cannot see the
    // field it belongs to.
    expect(textLengthHint({ maxLength: 20 })).toContain('characters');
  });
});

/**
 * #234: THE SAME DEFECT, ON THE PICK TWO LINES ABOVE IT.
 *
 * `enterNumber('waste', { min: 1, integer: true })` rendered `(1-?, integer)`,
 * for the reason `textLengthHint` exists: a range built by interpolating
 * `min ?? '?'` and `max ?? '?'` says nothing when only one end is declared, and
 * a one-sided bound is the common case.
 *
 * Worded for numbers rather than borrowed from the text helper, and carrying
 * the `integer` rule in words, because "integer" is a programmer's noun and the
 * hint is a sentence for a player.
 */
describe('numberRangeHint', () => {
  it('states only the minimum when there is no maximum', () => {
    // The exact shape of the report.
    expect(numberRangeHint({ min: 1, integer: true })).toBe('at least 1, whole numbers');
  });

  it('states only the maximum when there is no minimum', () => {
    expect(numberRangeHint({ max: 10 })).toBe('up to 10');
  });

  it('states the range when the pick has both ends', () => {
    expect(numberRangeHint({ min: 1, max: 10 })).toBe('1 to 10');
  });

  it('states the integer rule on its own when the pick is unbounded', () => {
    // A rule the field enforces (`step="1"`) and nothing said it. The bounds
    // are what is absent here, not the rule.
    expect(numberRangeHint({ integer: true })).toBe('whole numbers');
  });

  it('says nothing at all when there is no rule to state', () => {
    expect(numberRangeHint({})).toBeUndefined();
  });

  it('never renders a question mark, which is what the report was about', () => {
    const rules = [
      { min: 1, integer: true },
      { max: 10 },
      { min: 1, max: 10, integer: true },
      { integer: true },
    ];
    for (const one of rules) expect(numberRangeHint(one)).not.toContain('?');
  });

  it('never says "integer", which is a word for a programmer', () => {
    expect(numberRangeHint({ min: 1, integer: true })).not.toContain('integer');
  });

  it('reads 0 as a bound, because 0 is a number and not an absent one', () => {
    // `min ?? '?'` was at least right about this; a truthiness test would not
    // have been, and this is the pick that would have caught it.
    expect(numberRangeHint({ min: 0, max: 5 })).toBe('0 to 5');
    expect(numberRangeHint({ max: 0 })).toBe('up to 0');
  });
});
