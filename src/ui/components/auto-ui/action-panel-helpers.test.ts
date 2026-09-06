import { describe, it, expect } from 'vitest';
import { splitAnchoredChoices, shouldDeferElementPickToBoard } from './action-panel-helpers.js';
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
