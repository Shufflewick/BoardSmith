import { describe, expect, it } from 'vitest';
import { escapeRegExp } from './regexp.js';

describe('escapeRegExp', () => {
  it('matches the text literally, metacharacters included', () => {
    const text = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    expect(new RegExp(`^${escapeRegExp('a.b')}$`).test('axb')).toBe(false);
  });
});
