// @vitest-environment jsdom
/**
 * GameShell theme integration test — Phase 98, Plan 04
 *
 * Proves the TOKEN-05 receiver is wired:
 *   1. consumeInitMessage installs the Slate base token <style> when called the
 *      first time (simulating the onMounted applyTheme() call).
 *   2. An init message with `theme: { '--bsg-accent': '#abc' }` calls applyTheme
 *      and the resolved inline token value updates to '#abc'.
 *   3. An init message WITHOUT a `theme` field invokes the seat/screen updates
 *      and does not throw.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { consumeInitMessage } from './GameShellInit.js';
import { applyTheme } from '../../ui/theme.js';

function cleanup(): void {
  document.getElementById('bsg-tokens')?.remove();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
}

describe('GameShell init theme receiver (consumeInitMessage)', () => {
  beforeEach(cleanup);

  it('installs the Slate base token stylesheet when called without a theme override', () => {
    consumeInitMessage({ type: 'init', seat: 0 }, { applyTheme });
    const styleEl = document.getElementById('bsg-tokens');
    expect(styleEl).not.toBeNull();
    expect(styleEl!.textContent).toContain('--bsg-bg');
  });

  it('applies a host theme override from init.theme so the resolved token updates', () => {
    consumeInitMessage({ type: 'init', seat: 0, theme: { '--bsg-accent': '#abc' } }, { applyTheme });
    const resolved = document.documentElement.style.getPropertyValue('--bsg-accent');
    expect(resolved.trim()).toBe('#abc');
  });

  it('does not throw when init message has no theme field', () => {
    expect(() =>
      consumeInitMessage({ type: 'init', seat: 1 }, { applyTheme })
    ).not.toThrow();
  });

  it('honors data.scheme when present in the init message', () => {
    consumeInitMessage({ type: 'init', seat: 0, scheme: 'light' }, { applyTheme });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
