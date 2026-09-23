import { describe, it, expect } from 'vitest';
import {
  NUMBERED_LEDGER_SPECS,
  allocateProvisional,
  duplicateProvisionalIds,
  plainNumbersAdded,
  provisionalReferences,
} from './ledger-allocation.js';

/**
 * #294: chunks built at the same time on separate branches used to each take "the next" ruling
 * number and collide (sotf Ruling 138, Shufflewick/sotf#32). A branch now writes a provisional id,
 * `Ruling @<slug>.<n>`, and `boardsmith chunk-merge` allocates the real number on the combined
 * tree, one merge at a time. These pin the allocation and the refusals around it.
 */

const RULINGS = NUMBERED_LEDGER_SPECS.find((s) => s.file === 'RULINGS.md')!;
const CONSTRAINTS_G = NUMBERED_LEDGER_SPECS.find((s) => s.file === 'CONSTRAINTS.md' && s.kind === 'G')!;

describe('allocateProvisional', () => {
  it('numbers provisional entries after the highest real number, in file order', () => {
    const ledger = [
      '### Ruling 137',
      '- Decision: a.',
      '### Ruling 138',
      '- Decision: b.',
      '### Ruling @trading.1',
      '- Decision: c.',
      '### Ruling @trading.2',
      '- Decision: d. Supersedes Ruling 137.',
      '',
    ].join('\n');
    const result = allocateProvisional({ 'design/RULINGS.md': ledger }, [{ spec: RULINGS, path: 'design/RULINGS.md' }]);
    expect(result.mapping).toEqual({ 'Ruling @trading.1': 'Ruling 139', 'Ruling @trading.2': 'Ruling 140' });
    expect(result.files['design/RULINGS.md']).toContain('### Ruling 139\n');
    expect(result.files['design/RULINGS.md']).toContain('### Ruling 140\n');
    expect(result.files['design/RULINGS.md']).not.toContain('@trading');
  });

  it('rewrites every citation of a provisional id in every file it is handed', () => {
    const files = {
      'design/RULINGS.md': '### Ruling 4\n- Decision: a.\n### Ruling @auctions.1\n- Decision: b.\n',
      'src/auction.ts': '// Ruling @auctions.1: the reserve price is hidden.\n',
      'design/chunks/auctions/CHUNK.md': 'Per Ruling @auctions.1 and Ruling 4.\n',
    };
    const result = allocateProvisional(files, [{ spec: RULINGS, path: 'design/RULINGS.md' }]);
    expect(result.files['src/auction.ts']).toBe('// Ruling 5: the reserve price is hidden.\n');
    expect(result.files['design/chunks/auctions/CHUNK.md']).toBe('Per Ruling 5 and Ruling 4.\n');
  });

  it('allocates constraint ids, whose number follows the letter directly', () => {
    const text = '### G1\n- State: a\n### G@world.1\n- State: b\n';
    const result = allocateProvisional({ 'design/CONSTRAINTS.md': text }, [
      { spec: CONSTRAINTS_G, path: 'design/CONSTRAINTS.md' },
    ]);
    expect(result.mapping).toEqual({ 'G@world.1': 'G2' });
    expect(result.files['design/CONSTRAINTS.md']).toBe('### G1\n- State: a\n### G2\n- State: b\n');
  });

  it('starts at 1 in a ledger with no real entries, and ignores the template example in a comment', () => {
    const text = '<!--\n### Ruling 1\n- Decision: example\n-->\n### Ruling @a.1\n- Decision: x.\n';
    const result = allocateProvisional({ 'design/RULINGS.md': text }, [{ spec: RULINGS, path: 'design/RULINGS.md' }]);
    expect(result.mapping).toEqual({ 'Ruling @a.1': 'Ruling 1' });
  });
});

describe('the refusals around allocation', () => {
  it('finds a provisional id used as a heading twice', () => {
    const text = '### Ruling @a.1\n- x\n### Ruling @a.1\n- y\n';
    expect(duplicateProvisionalIds(text, RULINGS)).toEqual(['Ruling @a.1']);
  });

  it('finds provisional references left in a text, so a citation of an id nobody declared is caught', () => {
    expect(provisionalReferences('see Ruling @ghost.3 and G@world.2, not Ruling 3')).toEqual([
      'Ruling @ghost.3',
      'G@world.2',
    ]);
  });

  it('names the real numbers a branch added, which a parallel branch must never do', () => {
    const base = '### Ruling 1\n- a\n';
    const tip = '### Ruling 1\n- a\n### Ruling 2\n- b\n### Ruling @x.1\n- c\n';
    expect(plainNumbersAdded(base, tip, RULINGS)).toEqual(['Ruling 2']);
  });
});
