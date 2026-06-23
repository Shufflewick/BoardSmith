// @vitest-environment jsdom
/**
 * theme.ts unit tests — Phase 98, Plan 01
 *
 * Proves:
 *   1. themeCSS contains Slate dark defaults
 *   2. themeCSS contains Slate light override
 *   3. themeCSS contains all six --bsg-seat-1..6 declarations; SEAT_PALETTE has length 6
 *   4. applyTheme({'--bsg-accent':'#abc'}) writes the inline value
 *   5. applyTheme ignores non-bsg keys (injection guard)
 *   6. applyTheme({}, {scheme:'light'}) sets data-theme; scheme:'auto' removes it
 *   7. applyTheme is idempotent — injects exactly one <style id="bsg-tokens"> even when called twice
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
