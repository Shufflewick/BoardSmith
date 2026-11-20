import { describe, it, expect } from 'vitest';
import { selectChecks } from './select-checks.js';

/**
 * The bare command must be the thorough one. `boardsmith audit` bundles
 * several sub-checks, and the pit-of-success rule is that you get all of them
 * without knowing they exist — narrowing is the deliberate act, not the default.
 */

describe('selectChecks', () => {
  it('runs everything when no selector flag is set', () => {
    const wants = selectChecks({ changes: undefined, health: undefined, duplication: undefined });

    expect(wants('changes')).toBe(true);
    expect(wants('health')).toBe(true);
    expect(wants('duplication')).toBe(true);
  });

  it('treats explicitly-false flags as "not selected", so everything still runs', () => {
    // Commander leaves unset boolean options undefined, but a caller passing
    // `false` means the same thing — neither is a request to narrow.
    const wants = selectChecks({ changes: false, health: false });

    expect(wants('changes')).toBe(true);
    expect(wants('health')).toBe(true);
  });

  it('narrows to exactly the selected checks once any flag is set', () => {
    const wants = selectChecks({ changes: true, health: undefined, duplication: undefined });

    expect(wants('changes')).toBe(true);
    expect(wants('health')).toBe(false);
    expect(wants('duplication')).toBe(false);
  });

  it('supports selecting several checks at once', () => {
    const wants = selectChecks({ changes: true, health: true, duplication: undefined });

    expect(wants('changes')).toBe(true);
    expect(wants('health')).toBe(true);
    expect(wants('duplication')).toBe(false);
  });

  it('runs nothing extra for a check that was never declared', () => {
    const wants = selectChecks<'changes' | 'health'>({ changes: true });

    expect(wants('health')).toBe(false);
  });
});
