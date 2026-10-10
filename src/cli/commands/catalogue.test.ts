/**
 * What `boardsmith catalogue` prints and exits with (#591). The run itself is
 * `src/cli/lib/catalogue-check.test.ts`; this is the report a reader holding an
 * unrelated BoardSmith change sees.
 */
import { describe, it, expect } from 'vitest';
import { catalogueReport } from './catalogue.js';

const hex = { slug: 'hex', dir: '/games/hex', commit: '836f3ad0000000000000000000000000000000000' };
const cribbage = { slug: 'cribbage', dir: '/games/cribbage', commit: 'a06bf140000000000000000000000000000000000' };

describe('the catalogue report (#591)', () => {
  it('passes when every game validates, naming cached passes and the folders not checked', () => {
    const report = catalogueReport({
      results: [{ ...hex, status: 'cached' }, { ...cribbage, status: 'passed' }],
      notChecked: [{ slug: 'LacunaExpanse', reason: 'pins its own boardsmith (file:./vendor/b.tgz)' }],
    });
    expect(report.ok).toBe(true);
    expect(report.text).toContain('hex: validates against this tree (passed before on these inputs)');
    expect(report.text).toContain('cribbage: validates against this tree');
    expect(report.text).toContain('LacunaExpanse: pins its own boardsmith (file:./vendor/b.tgz)');
  });

  it("fails on a game that does not validate, with the validator's output, the commit and where to fix it", () => {
    const report = catalogueReport({
      results: [{ ...hex, status: 'passed' }, { ...cribbage, status: 'failed', output: 'TS2322: TableBoardProps\n' }],
      notChecked: [],
    });
    expect(report.ok).toBe(false);
    expect(report.text).toContain('cribbage FAILED boardsmith validate on its main (a06bf140) against this BoardSmith tree');
    expect(report.text).toContain('TS2322: TableBoardProps');
    expect(report.text).toContain('/games/cribbage');
  });
});
