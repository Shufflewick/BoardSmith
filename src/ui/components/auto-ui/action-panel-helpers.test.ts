import { describe, it, expect } from 'vitest';
import { splitAnchoredChoices } from './action-panel-helpers.js';
import type { ChoiceWithRefs } from '../../composables/useActionControllerTypes.js';

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
