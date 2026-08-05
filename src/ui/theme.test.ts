// @vitest-environment jsdom
/**
 * theme.ts unit tests — Phase 98, Plan 01
 *
 * Proves:
 *   1. themeCSS contains Slate dark defaults
 *   2. themeCSS contains Slate light override
 *   3. themeCSS contains all six --bsg-seat-1..6 declarations; SEAT_PALETTE has length 6
 *   4. applyTheme({'--bsg-accent':'#abc'}) writes the inline value
 *   5. applyTheme ignores non-bsg keys (injection guard) and warns naming them (never a silent no-op)
 *   6. applyTheme({}, {scheme:'light'}) sets data-theme; scheme:'auto' removes it
 *   7. applyTheme is idempotent — injects exactly one <style id="bsg-tokens"> even when called twice
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTheme, themeCSS, SEAT_PALETTE } from './theme.js';

function cleanup(): void {
  // Remove injected style tag
  document.getElementById('bsg-tokens')?.remove();
  // Clear inline styles on documentElement
  document.documentElement.removeAttribute('style');
  // Clear forced scheme
  document.documentElement.removeAttribute('data-theme');
}

describe('themeCSS — Slate default emission', () => {
  it('contains the Slate dark background anchor', () => {
    expect(themeCSS).toContain('--bsg-bg: #121417');
  });

  it('contains the Slate dark accent anchor', () => {
    expect(themeCSS).toContain('--bsg-accent: #1fb8a6');
  });

  it('contains the Slate light background token', () => {
    expect(themeCSS).toContain('--bsg-bg: #f3f2ef');
  });

  it('gates the light bg on a prefers-color-scheme or data-theme selector', () => {
    // The light token must appear after a media or data-theme selector, not bare in :root
    const lightIdx = themeCSS.indexOf('--bsg-bg: #f3f2ef');
    const lightSection = themeCSS.slice(0, lightIdx);
    const hasMediaOrDataTheme =
      lightSection.includes('prefers-color-scheme') ||
      lightSection.includes('data-theme="light"') ||
      lightSection.includes("data-theme='light'");
    expect(hasMediaOrDataTheme).toBe(true);
  });

  it('contains all six --bsg-seat-N declarations', () => {
    for (let i = 1; i <= 6; i++) {
      expect(themeCSS).toContain(`--bsg-seat-${i}:`);
    }
  });

  it('contains motion tokens', () => {
    expect(themeCSS).toContain('--bsg-dur-fast: 120ms');
    expect(themeCSS).toContain('--bsg-dur-base: 200ms');
    expect(themeCSS).toContain('--bsg-ease:');
  });

  it('contains interaction tokens', () => {
    expect(themeCSS).toContain('--bsg-selectable:');
    expect(themeCSS).toContain('--bsg-selected:');
    expect(themeCSS).toContain('--bsg-ring:');
  });

  it('contains drag/drop tokens', () => {
    expect(themeCSS).toContain('--bsg-draggable-cursor: grab');
    expect(themeCSS).toContain('--bsg-dragging-cursor: grabbing');
    expect(themeCSS).toContain('--bsg-drag-transition:');
  });

  it('does not contain dead light-blue defaults', () => {
    expect(themeCSS).not.toContain('#4a90d9');
    expect(themeCSS).not.toContain('#f5f5f5');
  });
});

describe('SEAT_PALETTE', () => {
  it('has exactly 6 entries', () => {
    expect(SEAT_PALETTE).toHaveLength(6);
  });

  it('all entries are hex color strings', () => {
    for (const color of SEAT_PALETTE) {
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('applyTheme — override knob', () => {
  beforeEach(cleanup);

  it('writes a --bsg-* override onto documentElement inline style (TOKEN-05 proof)', () => {
    applyTheme({ '--bsg-accent': '#abc' });
    const value = document.documentElement.style.getPropertyValue('--bsg-accent');
    expect(value).toBe('#abc');
  });

  it('does not write non-bsg keys (injection guard)', () => {
    applyTheme({ 'color': 'red', '--evil': 'x', '--bsg-ok': '#0f0' });
    expect(document.documentElement.style.getPropertyValue('color')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--evil')).toBe('');
    // The valid bsg key IS written
    expect(document.documentElement.style.getPropertyValue('--bsg-ok')).toBe('#0f0');
  });

  it('warns (naming the keys) when overrides are rejected — never a silent no-op', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyTheme({ primary: '#00d9ff', background: '#1a1a2e', '--bsg-ok': '#0f0' });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain('primary');
    expect(message).toContain('background');
    expect(message).not.toContain('--bsg-ok');
    expect(message).toContain('--bsg-');
    warn.mockRestore();
  });

  it('does not warn when every override is a valid --bsg-* key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyTheme({ '--bsg-accent': '#abc' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('sets data-theme="light" when scheme is forced to light', () => {
    applyTheme(undefined, { scheme: 'light' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('sets data-theme="dark" when scheme is forced to dark', () => {
    applyTheme(undefined, { scheme: 'dark' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('removes data-theme when scheme is set to auto', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    applyTheme(undefined, { scheme: 'auto' });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('themeCSS — new tokens (Phase 99 Plan 01)', () => {
  it('contains --bsg-card-back declaration', () => {
    expect(themeCSS).toContain('--bsg-card-back:');
  });

  it('contains --bsg-display declaration', () => {
    expect(themeCSS).toContain('--bsg-display:');
  });

  it('--bsg-card-back value uses var(--bsg-*) chains, no hex literal', () => {
    const match = themeCSS.match(/--bsg-card-back:\s*([^;]+);/);
    expect(match).not.toBeNull();
    const value = match![1];
    expect(value).toContain('var(--bsg-');
    expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

describe('applyTheme — base injection idempotence', () => {
  beforeEach(cleanup);

  it('injects exactly one <style id="bsg-tokens"> even when called twice', () => {
    applyTheme();
    applyTheme();
    const elements = document.querySelectorAll('#bsg-tokens');
    expect(elements).toHaveLength(1);
  });

  it('injected style contains the dark default token', () => {
    applyTheme();
    const style = document.getElementById('bsg-tokens') as HTMLStyleElement | null;
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain('--bsg-bg: #121417');
  });
});

/**
 * Documentation drift guard.
 *
 * Regression: docs/ui-components.md "Theming" taught `applyTheme({ primary, background,
 * text, ... })` against a `ThemeConfig` type that never existed. Every one of those keys
 * was rejected by BSG_KEY_RE, so a theme copied from the docs was a total no-op. Pin the
 * documented example to the real contract: every key it teaches must actually apply, and
 * the phantom type must not come back.
 */
describe('docs/ui-components.md "Theming" example matches the real contract', () => {
  beforeEach(cleanup);

  const docs = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../docs/ui-components.md'),
    'utf-8',
  );

  // The prose deliberately names ThemeConfig to say it does NOT exist; what must never
  // come back is importing it or annotating with it.
  it('never imports or annotates with a ThemeConfig type (it does not exist in src/)', () => {
    expect(docs).not.toMatch(/type ThemeConfig|:\s*ThemeConfig|ThemeConfig\s*[=<]/);
  });

  it('every --bsg-* key in the Theming example is actually applied by applyTheme', () => {
    const section = docs.slice(docs.indexOf('## Theming'), docs.indexOf('## Animation Events'));
    const keys = [...section.matchAll(/'(--bsg-[a-z0-9-]+)'/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(0);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyTheme(Object.fromEntries(keys.map((k) => [k, '#010203'])));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    for (const key of keys) {
      expect(document.documentElement.style.getPropertyValue(key), `${key} must apply`).toBe('#010203');
    }
  });
});
