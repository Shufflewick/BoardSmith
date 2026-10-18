/**
 * #392: A PICK MAY ONLY DEPEND ON A PICK ASKED BEFORE IT.
 *
 * Picks are asked in the order the action declares them, optional ones
 * included. That order honours `dependsOn` and `filterBy` only when the pick
 * they name comes earlier -- a pick naming a later one would be asked while its
 * source is still unanswered and draw an empty list. So the builder refuses the
 * forward reference where the action is declared, rather than leaving the
 * player to find the empty list.
 */
import { describe, it, expect } from 'vitest';
import { Action } from '../index.js';

describe('dependsOn and filterBy name an earlier pick (#392)', () => {
  it('accepts a chooseFrom that depends on an earlier pick', () => {
    expect(() =>
      Action.create('mail')
        .chooseFrom('to', { choices: ['a', 'b'] })
        .chooseFrom('recipient', { dependsOn: 'to', optional: true, choices: ['a1', 'b1'] }),
    ).not.toThrow();
  });

  it('refuses a chooseFrom whose dependsOn names a pick declared after it', () => {
    expect(() =>
      Action.create('mail')
        .chooseFrom('recipient', { dependsOn: 'to', choices: ['a1', 'b1'] })
        .chooseFrom('to', { choices: ['a', 'b'] }),
    ).toThrow(/chooseFrom\('recipient'\) depends on 'to', which is not declared before it/);
  });

  it('refuses a chooseFrom whose filterBy names a pick not declared before it', () => {
    expect(() =>
      Action.create('move')
        .chooseFrom('destination', {
          filterBy: { key: 'from', selectionName: 'piece' },
          choices: [{ from: 1, to: 2 }],
        }),
    ).toThrow(/chooseFrom\('destination'\) filters by 'piece', which is not declared before it/);
  });

  it('refuses a chooseElement and a chooseElements with a forward dependsOn', () => {
    expect(() => Action.create('a').chooseElement('die', { dependsOn: 'slot', elements: [] })).toThrow(
      /chooseElement\('die'\) depends on 'slot', which is not declared before it/,
    );
    expect(() => Action.create('b').chooseElements('dice', { dependsOn: 'slot', elements: [] })).toThrow(
      /chooseElements\('dice'\) depends on 'slot', which is not declared before it/,
    );
  });
});

/**
 * #1173: filterBy matches ONE earlier value against each choice's key, so a
 * source pick that answers with a list (chooseElements, multiSelect,
 * orderedList, a repeating pick) has no meaning there. Refused where the
 * action is declared, pointing to dependsOn.
 */
describe('filterBy names a pick of one value (#1173)', () => {
  const filterByPieces = { filterBy: { key: 'from', selectionName: 'pieces' }, choices: [{ from: 1 }] };
  const refusal = /Action "move": chooseFrom\('destination'\) filters by 'pieces' \(filterBy key 'from'\), but 'pieces' answers with a list\..*dependsOn: 'pieces'/s;

  it('refuses filterBy on a chooseElements pick', () => {
    expect(() => Action.create('move').chooseElements('pieces', { elements: [] }).chooseFrom('destination', filterByPieces))
      .toThrow(refusal);
  });

  it('refuses filterBy on a multiSelect or orderedList chooseFrom', () => {
    expect(() => Action.create('move').chooseFrom('pieces', { choices: [1, 2], multiSelect: 2 }).chooseFrom('destination', filterByPieces))
      .toThrow(refusal);
    expect(() => Action.create('move').chooseFrom('pieces', { choices: [1, 2], orderedList: 2 }).chooseFrom('destination', filterByPieces))
      .toThrow(refusal);
  });

  it('refuses filterBy on a repeating chooseElement or chooseFrom', () => {
    expect(() => Action.create('move').chooseElement('pieces', { elements: [], repeat: { until: () => true } }).chooseFrom('destination', filterByPieces))
      .toThrow(refusal);
    expect(() => Action.create('move').chooseFrom('pieces', { choices: [1, 2], repeatUntil: 2 }).chooseFrom('destination', filterByPieces))
      .toThrow(refusal);
  });

  it('accepts filterBy on a chooseElement or a single chooseFrom', () => {
    expect(() => Action.create('move').chooseElement('pieces', { elements: [] }).chooseFrom('destination', filterByPieces)).not.toThrow();
    expect(() => Action.create('move').chooseFrom('pieces', { choices: [1, 2] }).chooseFrom('destination', filterByPieces)).not.toThrow();
  });
});
