/**
 * theme.contrast.test.ts — Phase 99, Plan 14
 *
 * Automated guard against the invisible-text trap.
 *
 * jsdom does NOT resolve var()/color-mix cascade from stylesheets, so this test
 * computes WCAG contrast directly on the resolved hex values parsed from
 * theme.ts's dark/light token blocks (the single source of truth). Parsing is
 * done via regex against themeCSS so the test always tracks the real token values.
 *
 * Two describe blocks:
 *   1. Both-theme WCAG contrast — key surfaces in dark AND light scheme
 *   2. Atomic-pairing source guard — each key-surface component file pairs a bg
 *      token with an ink token (no half-swept, no raw hex)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { themeCSS } from './theme.js';

const __dir = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Block extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the CSS content of the first block that starts with `selector {`.
 * Uses brace counting so nested at-rules don't confuse it.
 */
function extractBlock(css: string, selector: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) return '';
  const openBrace = css.indexOf('{', idx);
  if (openBrace === -1) return '';

  let depth = 1;
  let i = openBrace + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(openBrace + 1, i - 1);
}

/**
 * Extract the first solid-hex value of a specific CSS custom property from a
 * block of CSS text.  Matches `--token-name: #rrggbb;` (3-, 6-, or 8-digit hex).
 * Returns the matched hex string, or '' if not found.
 */
function extractHex(block: string, tokenName: string): string {
  const re = new RegExp(`${tokenName}:\\s*(#[0-9a-fA-F]{3,8})`);
  const match = re.exec(block);
  return match ? match[1] : '';
}

// ---------------------------------------------------------------------------
// WCAG 2.x contrast helpers
// ---------------------------------------------------------------------------

/** Convert a sRGB channel byte (0-255) to linear light */
function toLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928
    ? srgb / 12.92
    : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a 6-digit hex color per WCAG 2.x */
function relativeLuminance(hex: string): number {
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio between two hex colors */
function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Scheme fixtures — parsed from themeCSS (no hardcoded hex values)
// ---------------------------------------------------------------------------

const DARK_BLOCK = extractBlock(themeCSS, ':root {');
const LIGHT_BLOCK = extractBlock(themeCSS, 'html[data-theme="light"] {');

const DARK = {
  bg:        extractHex(DARK_BLOCK, '--bsg-bg'),
  surface:   extractHex(DARK_BLOCK, '--bsg-surface'),
  ink:       extractHex(DARK_BLOCK, '--bsg-ink'),
  accent:    extractHex(DARK_BLOCK, '--bsg-accent'),
  accentInk: extractHex(DARK_BLOCK, '--bsg-accent-ink'),
};

const LIGHT = {
  bg:        extractHex(LIGHT_BLOCK, '--bsg-bg'),
  surface:   extractHex(LIGHT_BLOCK, '--bsg-surface'),
  ink:       extractHex(LIGHT_BLOCK, '--bsg-ink'),
  accent:    extractHex(LIGHT_BLOCK, '--bsg-accent'),
  accentInk: extractHex(LIGHT_BLOCK, '--bsg-accent-ink'),
};

// ---------------------------------------------------------------------------
// Task 1: Both-theme WCAG contrast assertions
// ---------------------------------------------------------------------------

describe('Both-theme WCAG contrast — key surfaces', () => {
  // Sanity-check that the parser extracted real values before running contrast checks
  it('parser extracts solid hex for all five dark tokens', () => {
    expect(DARK.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(DARK.surface).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(DARK.ink).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(DARK.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(DARK.accentInk).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('parser extracts solid hex for all five light tokens', () => {
    expect(LIGHT.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(LIGHT.surface).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(LIGHT.ink).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(LIGHT.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(LIGHT.accentInk).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  const SCHEMES: Array<{ name: 'dark' | 'light'; tokens: typeof DARK }> = [
    { name: 'dark', tokens: DARK },
    { name: 'light', tokens: LIGHT },
  ];

  for (const { name, tokens } of SCHEMES) {
    describe(`scheme: ${name}`, () => {
      it('app background (--bsg-bg / --bsg-ink) ≥ 4.5:1 contrast', () => {
        const ratio = contrastRatio(tokens.bg, tokens.ink);
        expect(
          ratio,
          `${name}: --bsg-bg ${tokens.bg} vs --bsg-ink ${tokens.ink} = ${ratio.toFixed(2)}:1 (need ≥ 4.5:1)`,
        ).toBeGreaterThanOrEqual(4.5);
      });

      it('board/sidebar surface (--bsg-surface / --bsg-ink) ≥ 4.5:1 contrast', () => {
        const ratio = contrastRatio(tokens.surface, tokens.ink);
        expect(
          ratio,
          `${name}: --bsg-surface ${tokens.surface} vs --bsg-ink ${tokens.ink} = ${ratio.toFixed(2)}:1 (need ≥ 4.5:1)`,
        ).toBeGreaterThanOrEqual(4.5);
      });

      it('action dock primary button (--bsg-accent / --bsg-accent-ink) ≥ 3:1 contrast', () => {
        const ratio = contrastRatio(tokens.accent, tokens.accentInk);
        expect(
          ratio,
          `${name}: --bsg-accent ${tokens.accent} vs --bsg-accent-ink ${tokens.accentInk} = ${ratio.toFixed(2)}:1 (need ≥ 3:1)`,
        ).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it('discrimination check: identical-color pair returns contrast < 1.5', () => {
    // An invisible-text trap has contrast ≈ 1:1.  This confirms the helper
    // discriminates — if this fails, the helper itself is broken.
    expect(contrastRatio(DARK.ink, DARK.ink)).toBeLessThan(1.5);
  });
});

// ---------------------------------------------------------------------------
// Task 2: Atomic-pairing source guard for key-surface components
// ---------------------------------------------------------------------------

describe('Atomic-pairing source guard — key-surface components', () => {
  const KEY_SURFACES = [
    {
      label: 'ActionPanel.vue (action dock)',
      file: resolve(__dir, 'components/auto-ui/ActionPanel.vue'),
    },
    {
      label: 'GameHistory.vue (sidebar log)',
      file: resolve(__dir, 'components/GameHistory.vue'),
    },
    {
      label: 'GridBoardRenderer.vue (board)',
      file: resolve(__dir, 'components/auto-ui/renderers/GridBoardRenderer.vue'),
    },
    {
      label: 'DevHost.vue (dev chrome)',
      file: resolve(__dir, '../cli/dev-host/DevHost.vue'),
    },
  ] as const;

  for (const { label, file } of KEY_SURFACES) {
    describe(label, () => {
      const content = readFileSync(file, 'utf-8');

      // Extract just the <style> section for the hex check to avoid false
      // positives from string literals / IDs in the <script> block.
      const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/);
      const styleContent = styleMatch ? styleMatch[1] : '';

      it('has no raw hex color literals in <style>', () => {
        const hexLiterals = styleContent.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
        expect(
          hexLiterals,
          `Found raw hex in <style>: ${hexLiterals.join(', ')}`,
        ).toHaveLength(0);
      });

      it('references at least one ink token (var(--bsg-ink) or var(--bsg-accent-ink))', () => {
        expect(content).toMatch(/var\(--bsg-(ink|accent-ink)/);
      });

      it('references at least one surface/bg/accent background token', () => {
        expect(content).toMatch(/var\(--bsg-(bg|surface|accent)\b/);
      });
    });
  }
});
