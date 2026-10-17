/**
 * #879: TEXT A PAGE CHOSE IS PRINTED QUOTED AND CAPPED. The dev server does not
 * check a socket's origin (#719), so a page's client id or message type can be
 * a megabyte long or carry newlines and terminal escape codes.
 */
import { describe, expect, it } from 'vitest';

import { quotedForLog } from './socket-message.js';

describe('quotedForLog', () => {
  it('quotes ordinary text', () => {
    expect(quotedForLog('p1')).toBe('"p1"');
  });

  it('keeps hostile text to one short line with no control characters', () => {
    const shown = quotedForLog(`evil\n\u001b[31m${'x'.repeat(1_000_000)}`);
    expect(shown).not.toMatch(/[\u0000-\u001f]/);
    expect(shown.length).toBeLessThanOrEqual(64 + 2 + 5 * 6);
    expect(shown.startsWith('"evil\\n\\u001b[31m')).toBe(true);
  });
});
