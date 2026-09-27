import { describe, it, expect } from 'vitest';
import { parseLedgerEntries } from './ledger-entries.js';

/**
 * A chunk built on a parallel branch writes provisional headings (`### Filing @slug.n`) until
 * `chunk-merge` allocates real numbers (#294). Every ledger reader goes through
 * `parseLedgerEntries`, so a provisional heading must end the entry above it here, or each
 * reader folds the provisional entry's fields into the numbered one (#436).
 */
describe('parseLedgerEntries', () => {
  it('treats a provisional heading as its own entry (#436)', () => {
    const text = [
      '### Filing 25',
      '- Reported: posted',
      '',
      '### Filing @ranged-units.1',
      '- Reported: recorded',
      '',
      '### Filing @ranged-units.2',
      '- Reported: recorded',
      '',
    ].join('\n');
    const entries = parseLedgerEntries(text, 'Filing');
    expect(entries.map((e) => [e.id, e.line])).toEqual([
      ['25', 1],
      ['@ranged-units.1', 4],
      ['@ranged-units.2', 7],
    ]);
    expect(entries[0].body).toBe('- Reported: posted\n\n');
    expect(entries[1].body).toBe('- Reported: recorded\n\n');
  });

  it('reads only the kind asked for, and nothing inside an HTML comment', () => {
    const text = ['<!--', '### Decision @demo.1', '-->', '### Decision 3', '- a', '### Ruling @demo.1', '- b'].join('\n');
    expect(parseLedgerEntries(text, 'Decision').map((e) => e.id)).toEqual(['3']);
  });
});
