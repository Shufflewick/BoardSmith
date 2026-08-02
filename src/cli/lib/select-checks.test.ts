import { describe, it, expect } from 'vitest';
import { selectChecks } from './select-checks.js';

/**
 * The bare command must be the thorough one. `boardsmith lint` and
 * `boardsmith audit` each bundle several sub-checks, and the pit-of-success
 * rule is that you get all of them without knowing they exist — narrowing is
 * the deliberate act, not the default.
 */

describe('selectChecks', () => {
  it('runs everything when no selector flag is set', () => {
    const wants = selectChecks({ eslint: undefined, css: undefined, pitfalls: undefined });

    expect(wants('eslint')).toBe(true);
    expect(wants('css')).toBe(true);
    expect(wants('pitfalls')).toBe(true);
  });

  it('treats explicitly-false flags as "not selected", so everything still runs', () => {
    // Commander leaves unset boolean options undefined, but a caller passing
    // `false` means the same thing — neither is a request to narrow.
    const wants = selectChecks({ eslint: false, css: false });

    expect(wants('eslint')).toBe(true);
    expect(wants('css')).toBe(true);
  });

  it('narrows to exactly the selected checks once any flag is set', () => {
    const wants = selectChecks({ eslint: true, css: undefined, pitfalls: undefined });

    expect(wants('eslint')).toBe(true);
    expect(wants('css')).toBe(false);
    expect(wants('pitfalls')).toBe(false);
  });

  it('supports selecting several checks at once', () => {
    const wants = selectChecks({ eslint: true, css: true, pitfalls: undefined });

    expect(wants('eslint')).toBe(true);
    expect(wants('css')).toBe(true);
    expect(wants('pitfalls')).toBe(false);
  });

  it('runs nothing extra for a check that was never declared', () => {
    const wants = selectChecks<'eslint' | 'css'>({ eslint: true });

    expect(wants('css')).toBe(false);
  });
});
