import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { withLedgerLock } from './ledger-lock.js';

function ledgerInTempTree(): string {
  const tree = tempTree('bs-ledger-lock-');
  return join(tree, 'LEDGER.md');
}

describe('withLedgerLock (#831)', () => {
  it('runs parallel read-modify-writes one at a time, so none is lost', async () => {
    const ledger = ledgerInTempTree();
    await fs.writeFile(ledger, '');
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((line) =>
        withLedgerLock(ledger, async () => {
          const text = await fs.readFile(ledger, 'utf-8');
          await new Promise((done) => setImmediate(done));
          await fs.writeFile(ledger, `${text}${line}\n`);
        }),
      ),
    );
    expect((await fs.readFile(ledger, 'utf-8')).split('\n').filter(Boolean).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    await expect(fs.access(`${ledger}.lock`)).rejects.toThrow();
  });

  it('releases the lock when the work throws', async () => {
    const ledger = ledgerInTempTree();
    await expect(withLedgerLock(ledger, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(fs.access(`${ledger}.lock`)).rejects.toThrow();
    expect(await withLedgerLock(ledger, async () => 'again')).toBe('again');
  });

  it('gives up after its tries on a lock left behind, naming the file and how to clear it', async () => {
    const ledger = ledgerInTempTree();
    await fs.writeFile(`${ledger}.lock`, '');
    let ran = false;
    const attempt = withLedgerLock(ledger, async () => (ran = true), 2);
    await expect(attempt).rejects.toThrow(`${ledger}.lock`);
    await expect(attempt).rejects.toThrow(/delete it/);
    expect(ran).toBe(false);
    await expect(fs.access(`${ledger}.lock`)).resolves.toBeUndefined();
  });
});
