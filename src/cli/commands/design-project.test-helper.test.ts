import { describe, it, expect } from 'vitest';
import { readChunkTemplate, withInterpretation } from './design-project.test-helper.js';

describe('withInterpretation (#296)', () => {
  it('replaces the real template placeholder claim with the given interpretation', async () => {
    const text = withInterpretation(await readChunkTemplate(), '1. A claim — cites rulebook/01-setup.md');
    expect(text).toContain('1. A claim — cites rulebook/01-setup.md');
    expect(text).not.toContain('<!-- claim text -->');
  });

  it('refuses a text that does not carry the placeholder, naming what to update', () => {
    expect(() => withInterpretation('# no placeholder here\n', 'x')).toThrow(/INTERPRETATION_PLACEHOLDER/);
  });
});
