/**
 * #1356, #1362: the "Testing your sampler" recipe in `docs/bot-system.md` must
 * build the copy the bot searches. It does that through `searchCopyForSeat`,
 * which the bot's own restore shares, rather than by steps a game author copies
 * by hand and an internal method.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bot-system.md'), 'utf-8');

describe('the sampler-testing recipe in docs/bot-system.md (#1362)', () => {
  it('builds the sandbox with searchCopyForSeat, not by hand', () => {
    const section = doc.slice(doc.indexOf('### Testing your sampler'), doc.indexOf('### What the check costs'));

    expect(section, 'the recipe should build the sandbox with searchCopyForSeat').toContain('searchCopyForSeat(game, 1,');
    expect(section, 'the recipe should not send authors to an internal method').not.toContain('_afterRestoreSubtree');
  });
});
