import { describe, it, expect } from 'vitest';
import { scanTestCitations, resolveClaimCitation } from './trace-check.js';

/**
 * `trace-check.ts` is CHECK-03: the source-free traceability sweep. This file covers, in task
 * order: the citation scanner + three-rung resolution ladder (Task 1), the sweep/findings/
 * read-only invariant (Task 2), and the `--json`/human-report contract (Task 3).
 */

describe('scanTestCitations', () => {
  it('parses a bare single claim: "claim 12"', () => {
    const result = scanTestCitations('// see claim 12 for details');
    expect(result.claims).toEqual([12]);
    expect(result.rulings).toEqual([]);
  });

  it('parses a comma-joined 4-wide claim list: "claims 3, 4, 5, 29"', () => {
    const result = scanTestCitations('// claims 3, 4, 5, 29 all apply here');
    expect(result.claims).toEqual([3, 4, 5, 29]);
  });

  it('parses a slash-joined claim pair: "claim 4/14"', () => {
    const result = scanTestCitations('// claim 4/14 — corrected');
    expect(result.claims).toEqual([4, 14]);
  });

  it('parses a capitalised "Claim 7"', () => {
    const result = scanTestCitations('// Claim 7 is basic');
    expect(result.claims).toEqual([7]);
  });

  it('treats "CHUNK.md claim 12" identically to a bare "claim 12" — the prefix names no slug', () => {
    const result = scanTestCitations('// CHUNK.md claim 12');
    expect(result.claims).toEqual([12]);
  });

  it('splits "claim 28 / Ruling 9/15" into claims [28] and rulings [9,15], never swallowing the ruling numbers as claims', () => {
    const result = scanTestCitations('// claim 28 / Ruling 9/15');
    expect(result.claims).toEqual([28]);
    expect(result.rulings).toEqual([9, 15]);
  });

  it('parses a bare single ruling: "Ruling 23"', () => {
    const result = scanTestCitations('// Ruling 23 applies');
    expect(result.rulings).toEqual([23]);
  });

  it('parses a slash-joined ruling pair: "rulings 21/22"', () => {
    const result = scanTestCitations('// rulings 21/22 both apply');
    expect(result.rulings).toEqual([21, 22]);
  });

  it('importsRules is true for a relative import from a src/rules/ path', () => {
    const result = scanTestCitations(`import { resolveJab } from '../../src/rules/jab.js';\n`);
    expect(result.importsRules).toBe(true);
  });

  it('importsRules is false for a file importing only engine/testing packages', () => {
    const result = scanTestCitations(
      `import { TestGame } from 'boardsmith/testing';\nimport { describe, it } from 'vitest';\n`,
    );
    expect(result.importsRules).toBe(false);
  });

  it('de-duplicates repeated citations of the same number', () => {
    const result = scanTestCitations('// claim 12 ... later, claim 12 again');
    expect(result.claims).toEqual([12]);
  });
});

describe('resolveClaimCitation — the three-rung ladder', () => {
  it('rung 1 alone: exactly one owner resolves to it', () => {
    const result = resolveClaimCitation(5, ['jab'], { jab: [5, 6, 7] }, { jab: true });
    expect(result).toEqual({ status: 'resolved', chunk: 'jab' });
  });

  it('rung 2 deciding: 3 owners, only one has claim N live', () => {
    const owners = ['jab', 'block', 'rest'];
    const liveClaims = { jab: [1, 2], block: [5], rest: [9, 10] };
    const authoring = { jab: false, block: false, rest: false };
    const result = resolveClaimCitation(5, owners, liveClaims, authoring);
    expect(result).toEqual({ status: 'resolved', chunk: 'block' });
  });

  it('rung 3 deciding: 2 owners both have claim N live, one authoring (NEW/written), one editing', () => {
    const owners = ['punch', 'discard'];
    const liveClaims = { punch: [5], discard: [5] };
    const authoring = { punch: true, discard: false };
    const result = resolveClaimCitation(5, owners, liveClaims, authoring);
    expect(result).toEqual({ status: 'resolved', chunk: 'punch' });
  });

  it('ambiguous: 2 owners both live and both authoring — reports both survivors, names them', () => {
    const owners = ['a', 'b'];
    const liveClaims = { a: [5], b: [5] };
    const authoring = { a: true, b: true };
    const result = resolveClaimCitation(5, owners, liveClaims, authoring);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.sort()).toEqual(['a', 'b']);
    }
  });

  it('zero owners -> unresolved, reason no-owner', () => {
    const result = resolveClaimCitation(5, [], {}, {});
    expect(result).toEqual({ status: 'unresolved', reason: 'no-owner' });
  });

  it('all owners discarded at rung 2 (stale citation: every owning chunk stops below N) -> unresolved, no-live-claim', () => {
    const owners = ['jab', 'block'];
    const liveClaims = { jab: [1, 2, 3], block: [1, 2, 3, 4, 5] };
    const authoring = { jab: false, block: false };
    const result = resolveClaimCitation(40, owners, liveClaims, authoring);
    expect(result).toEqual({ status: 'unresolved', reason: 'no-live-claim' });
  });

  it('rung 3 empties a non-empty rung-2 set (no candidate is authoring) -> the rung-2 survivors REMAIN, ambiguous, never silently dropped', () => {
    const owners = ['a', 'b'];
    const liveClaims = { a: [5], b: [5] };
    // Neither candidate is marked authoring for this file — both are "edited".
    const authoring = { a: false, b: false };
    const result = resolveClaimCitation(5, owners, liveClaims, authoring);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.sort()).toEqual(['a', 'b']);
    }
  });
});
