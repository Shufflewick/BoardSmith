// @vitest-environment jsdom
/**
 * PieceRenderer asset-fallback tests — ASSET-01
 *
 * Proves the image branch (engine pieceVisual image AND the presentationEntry
 * overlay-image override, D-04 — both share one effective-src computed and one
 * load-guard) reveals the real <img> only after its own @load fires, and
 * reverts to the drawn .piece-token label fallback on @error. jsdom cannot
 * decode real images, so both cases are driven with synthetic
 * `.trigger('load')` / `.trigger('error')` events — never a `naturalWidth`
 * assertion (Pitfall 4).
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PieceRenderer from './PieceRenderer.vue';

function makePieceElement(id = 1) {
  return {
    id,
    className: 'Piece',
    name: 'white-knight',
    attributes: { $images: 'https://example.test/white-knight.png' },
  };
}

describe('PieceRenderer asset fallback (ASSET-01)', () => {
  it('shows the drawn piece-token fallback and hides the real <img> before any load event', () => {
    const wrapper = mount(PieceRenderer, {
      props: { element: makePieceElement(), depth: 0 },
    });

    const img = wrapper.find('img.piece-image');
    expect(img.exists()).toBe(true);
    expect(img.classes()).not.toContain('is-loaded');

    const fallback = wrapper.find('.piece-token');
    expect(fallback.exists()).toBe(true);
    expect(fallback.text()).toContain('white-knight');
  });

  it('reveals the real image once its @load event fires', async () => {
    const wrapper = mount(PieceRenderer, {
      props: { element: makePieceElement(), depth: 0 },
    });

    const img = wrapper.find('img.piece-image');
    await img.trigger('load');

    expect(wrapper.find('img.piece-image').classes()).toContain('is-loaded');
  });

  it('reverts to the drawn piece-token fallback when the image @error fires', async () => {
    const wrapper = mount(PieceRenderer, {
      props: { element: makePieceElement(), depth: 0 },
    });

    const img = wrapper.find('img.piece-image');
    await img.trigger('load');
    expect(wrapper.find('img.piece-image').classes()).toContain('is-loaded');

    await img.trigger('error');

    expect(wrapper.find('img.piece-image').classes()).not.toContain('is-loaded');
    // The drawn fallback stays in the DOM the whole time (zero-layout-diff).
    expect(wrapper.find('.piece-token').exists()).toBe(true);
  });
});
