import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { readFencedJsonLedger, type FencedJsonLedgerFile } from './fenced-json-ledger.js';

const BEGIN = '<!-- test:begin -->';
const END = '<!-- test:end -->';

function ledgerFile(projectDir: string): FencedJsonLedgerFile {
  return {
    projectDir,
    path: join(projectDir, 'ledgers', 'TEST.md'),
    begin: BEGIN,
    end: END,
    name: 'test',
    remedy: 'Delete the file to start again.',
  };
}

async function writeLedger(file: FencedJsonLedgerFile, content: string): Promise<void> {
  await fs.mkdir(join(file.projectDir, 'ledgers'), { recursive: true });
  await fs.writeFile(file.path, content);
}

const asNumber = (r: Record<string, unknown>) => {
  if (typeof r.n !== 'number') throw new Error('its n is not a number.');
  return r.n;
};

describe('readFencedJsonLedger', () => {
  it('reads nothing when no ledger has been written', async () => {
    expect(await readFencedJsonLedger(ledgerFile(tempTree('bs-fenced-')), asNumber)).toEqual([]);
  });

  it('parses every non-blank line between the fences, in order', async () => {
    const file = ledgerFile(tempTree('bs-fenced-'));
    await writeLedger(file, `# T\n\n${BEGIN}\n{"n":1}\n\n{"n":2}\n${END}\n`);
    expect(await readFencedJsonLedger(file, asNumber)).toEqual([1, 2]);
  });

  it('refuses a ledger missing a fence, or with its fences the wrong way round', async () => {
    const file = ledgerFile(tempTree('bs-fenced-'));
    await writeLedger(file, `${BEGIN}\n{"n":1}\n`);
    await expect(readFencedJsonLedger(file, asNumber)).rejects.toThrow(
      'Malformed test ledger at ledgers/TEST.md: missing begin/end fence.',
    );
    await writeLedger(file, `${END}\n{"n":1}\n${BEGIN}\n`);
    await expect(readFencedJsonLedger(file, asNumber)).rejects.toThrow(/end fence appears before the begin fence/);
  });

  it('names the record and the remedy for a line that is not JSON, or that its reader refuses', async () => {
    const file = ledgerFile(tempTree('bs-fenced-'));
    await writeLedger(file, `${BEGIN}\n{"n":1}\nnot json\n${END}\n`);
    await expect(readFencedJsonLedger(file, asNumber)).rejects.toThrow(
      'Malformed test ledger at ledgers/TEST.md (record 2): not valid JSON.\nDelete the file to start again.',
    );
    await writeLedger(file, `${BEGIN}\n{"n":"one"}\n${END}\n`);
    await expect(readFencedJsonLedger(file, asNumber)).rejects.toThrow(
      'Malformed test ledger at ledgers/TEST.md (record 1): its n is not a number.\nDelete the file to start again.',
    );
  });
});
