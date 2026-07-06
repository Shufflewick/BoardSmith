// @vitest-environment jsdom
/**
 * CardRenderer asset-fallback tests — ASSET-01
 *
 * Proves the url-image branch (Baseline 1) reveals the real <img> only after
 * its own @load fires, and reverts to the drawn .card-face fallback on @error.
 * jsdom cannot decode real images, so both cases are driven with synthetic
 * `.trigger('load')` / `.trigger('error')` events — never a `naturalWidth`
 * assertion (Pitfall 4).
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CardRenderer from './CardRenderer.vue';

function makeCardElement(id = 1) {
  return {
    id,
    className: 'Card',
    name: 'ace-of-spades',
    attributes: {
      $images: { face: 'https://example.test/ace-of-spades.png', back: 'https://example.test/back.png' },
    },
  };
}

describe('CardRenderer asset fallback (ASSET-01)', () => {
  it('shows the drawn card-face fallback and hides the real <img> before any load event', () => {
    const wrapper = mount(CardRenderer, {
      props: { element: makeCardElement(), depth: 0 },
    });

    const img = wrapper.find('img.card-image');
    expect(img.exists()).toBe(true);
    expect(img.classes()).not.toContain('is-loaded');

    // Drawn fallback is present underneath regardless of load state.
    const fallback = wrapper.find('.card-face');
    expect(fallback.exists()).toBe(true);
    expect(fallback.text()).toContain('ace-of-spades');
  });

  it('reveals the real image once its @load event fires', async () => {
    const wrapper = mount(CardRenderer, {
      props: { element: makeCardElement(), depth: 0 },
    });

    const img = wrapper.find('img.card-image');
    await img.trigger('load');

    expect(wrapper.find('img.card-image').classes()).toContain('is-loaded');
  });

  it('reverts to the drawn card-face fallback when the image @error fires', async () => {
    const wrapper = mount(CardRenderer, {
      props: { element: makeCardElement(), depth: 0 },
    });

    const img = wrapper.find('img.card-image');
    await img.trigger('load');
    expect(wrapper.find('img.card-image').classes()).toContain('is-loaded');

    await img.trigger('error');

    expect(wrapper.find('img.card-image').classes()).not.toContain('is-loaded');
    // The drawn fallback stays in the DOM the whole time (zero-layout-diff).
    expect(wrapper.find('.card-face').exists()).toBe(true);
  });

  it('resets loaded to false when the resolved src changes (reused element re-guards)', async () => {
    const wrapper = mount(CardRenderer, {
      props: { element: makeCardElement(1), depth: 0 },
    });

    await wrapper.find('img.card-image').trigger('load');
    expect(wrapper.find('img.card-image').classes()).toContain('is-loaded');

    // Same instance re-bound to a different card's art must re-guard: the new
    // <img> stays hidden (drawn fallback shown) until its own load/error fires,
    // never flashing the stale image at full opacity.
    await wrapper.setProps({
      element: {
        id: 2,
        className: 'Card',
        name: 'king-of-hearts',
        attributes: { $images: { face: 'https://example.test/king-of-hearts.png' } },
      },
    });

    expect(wrapper.find('img.card-image').classes()).not.toContain('is-loaded');
  });
});
