// GENERATED FILE — do not hand-edit. Regenerate with:
//   boardsmith verify-example-emit --chunk roll-condition-symbology
// One example test file per chunk (178-CONTEXT.md decision 8) — re-running this command for this chunk regenerates ONLY this file, never another chunk's.

import { describe, it, expect } from 'vitest';
import { isSatisfiedBy } from '../../src/rules/roll-conditions.js';

describe('roll-condition-symbology — worked examples', () => {
  // UNEXECUTABLE — rulebook/01-dice-roll-symbology.md:6: Translator declined (verdictHint=unexecutable, unexecutableReason=unmodeled-component-state).

  // UNEXECUTABLE — rulebook/01-dice-roll-symbology.md:9: Translator declined (verdictHint=unexecutable, unexecutableReason=unmodeled-component-state).

  // UNEXECUTABLE — rulebook/01-dice-roll-symbology.md:12: Translator declined (verdictHint=unexecutable, unexecutableReason=no-matching-symbol).

  // UNEXECUTABLE — rulebook/01-dice-roll-symbology.md:15: Translator declined (verdictHint=unexecutable, unexecutableReason=unmodeled-component-state).

  // UNEXECUTABLE — rulebook/01-dice-roll-symbology.md:21: Translator declined (verdictHint=unexecutable, unexecutableReason=unmodeled-component-state).

  // rulebook/01-dice-roll-symbology.md:18 (p.1 (panel -13-))
  // Source: (verbatim source recorded in the CHECK-06 ledger for this exampleId)
  it('is satisfied when one die shows a 3 and the other shows a value greater than 3', () => {
    const condition = { kind: 'greater-than', value: 3 };
    expect(isSatisfiedBy(condition, [3, 4])).toBe(true);
  });

});
