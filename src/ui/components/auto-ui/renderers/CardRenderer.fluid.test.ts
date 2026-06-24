// @vitest-environment jsdom
/**
 * CardRenderer fluid sizing test (IA-05)
 *
 * Verifies that all three card-family renderers (CardRenderer, HandRenderer,
 * DeckRenderer) use the --card-w / --card-h CSS custom properties for card
 * dimensions instead of hardcoded 60px / 84px values.
 *
 * Strategy: scoped CSS is not applied by JSDOM, so we use two complementary
 * approaches:
 *
 *   1. Source inspection — read each .vue file and assert the <style scoped>
 *      block uses var(--card-w) / var(--card-h) and does NOT contain the old
 *      fixed-pixel literals.  This is the primary RED/GREEN gate.
 *
 *   2. Mount test — confirm CardRenderer mounts and renders its card-container
 *      root without throwing, which catches component-level regressions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import CardRenderer from './CardRenderer.vue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DIR = resolve(import.meta.dirname ?? __dirname);

function styleBlock(filename: string): string {
  const source = readFileSync(resolve(DIR, filename), 'utf-8');
  const parts = source.split('<style scoped>');
  return parts[1] ?? '';
}

interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  __hidden?: boolean;
}

function buildCardElement(overrides: Partial<GameElement> = {}): GameElement {
  return { id: 1, className: 'Card', name: 'ace-of-spades', attributes: {}, ...overrides };
}

// ---------------------------------------------------------------------------
// CardRenderer source assertions
// ---------------------------------------------------------------------------
describe('CardRenderer.vue — fluid card-w token (IA-05)', () => {
  const style = styleBlock('CardRenderer.vue');

  it('defines --card-w in the scoped style block', () => {
    expect(style).toContain('--card-w');
  });

  it('defines --card-h in the scoped style block', () => {
    expect(style).toContain('--card-h');
  });

  it('does NOT use the hardcoded 60px card width in the scoped style block', () => {
    expect(style).not.toContain('width: 60px');
  });

  it('does NOT use the hardcoded 84px card height in the scoped style block', () => {
    // 84px should only appear as the clamp ceiling (inside clamp(…84px)), not as a
    // standalone dimension.  A raw "height: 84px" rule means it was not converted.
    expect(style).not.toMatch(/height\s*:\s*84px/);
  });

  it('sizes --card-w from the natural --bsg-card-w token', () => {
    expect(style).toContain('--card-w: var(--bsg-card-w)');
  });
});

// ---------------------------------------------------------------------------
// HandRenderer source assertions
// ---------------------------------------------------------------------------
describe('HandRenderer.vue — fluid card-w token (IA-05)', () => {
  const style = styleBlock('HandRenderer.vue');

  it('defines --card-w in the scoped style block', () => {
    expect(style).toContain('--card-w');
  });

  it('does NOT use the hardcoded 60px card width in the scoped style block', () => {
    expect(style).not.toContain('width: 60px');
  });

  it('does NOT use the hardcoded 84px card height in the scoped style block', () => {
    expect(style).not.toMatch(/height\s*:\s*84px/);
  });
});

// ---------------------------------------------------------------------------
// DeckRenderer source assertions
// ---------------------------------------------------------------------------
describe('DeckRenderer.vue — fluid card-w token (IA-05)', () => {
  const style = styleBlock('DeckRenderer.vue');

  it('defines --card-w in the scoped style block', () => {
    expect(style).toContain('--card-w');
  });

  it('does NOT use the hardcoded 60px width on .deck-stack', () => {
    expect(style).not.toContain('width: 60px');
  });

  it('does NOT use the hardcoded 84px height on .deck-stack', () => {
    expect(style).not.toMatch(/height\s*:\s*84px/);
  });
});

// ---------------------------------------------------------------------------
// Mount integration: CardRenderer renders without throwing
// ---------------------------------------------------------------------------
describe('CardRenderer mount', () => {
  it('renders a visible card without error', () => {
    const wrapper = mount(CardRenderer, {
      props: { element: buildCardElement(), depth: 0 },
      global: { provide: {} },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('.card-container').exists()).toBe(true);
  });

  it('renders a hidden card (card-back) without error', () => {
    const wrapper = mount(CardRenderer, {
      props: { element: buildCardElement({ __hidden: true }), depth: 0 },
      global: { provide: {} },
    });
    expect(wrapper.exists()).toBe(true);
  });
});
