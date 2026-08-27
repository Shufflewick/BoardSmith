// @vitest-environment jsdom
/**
 * AssetImage — the one sanctioned path for rendering game art (issue #81).
 *
 * The behaviors pinned here are the ones that were copy-pasted into five games
 * and drifted: a missing or failed image must never be what the player sees, and
 * an AssetImage reused for a different asset must re-guard rather than flash the
 * previous art at full opacity.
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AssetImage from './AssetImage.vue';

const BASE = { aspectRatio: '2 / 3', alt: 'A card' };

describe('AssetImage — the fallback is always what a missing asset shows', () => {
  it('renders no <img> at all when there is no src', () => {
    const wrapper = mount(AssetImage, {
      props: { ...BASE, src: null },
      slots: { default: '<span class="drawn">7 of spades</span>' },
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.drawn').text()).toBe('7 of spades');
  });

  it('renders the default slot as the fallback layer beneath the image', () => {
    const wrapper = mount(AssetImage, {
      props: { ...BASE, src: '/cards/7s.png' },
      slots: { default: '<span class="drawn">7 of spades</span>' },
    });

    const fallback = wrapper.find('.asset-image-fallback');
    expect(fallback.exists()).toBe(true);
    expect(fallback.find('.drawn').exists()).toBe(true);
  });

  it('keeps the loaded image hidden until it has actually loaded', () => {
    const wrapper = mount(AssetImage, {
      props: { ...BASE, src: '/cards/7s.png' },
    });

    expect(wrapper.find('img').classes()).not.toContain('is-loaded');
  });
});

describe('AssetImage — load and error state machine', () => {
  it('reveals the image on @load', async () => {
    const wrapper = mount(AssetImage, {
      props: { ...BASE, src: '/cards/7s.png' },
    });

    await wrapper.find('img').trigger('load');

    expect(wrapper.find('img').classes()).toContain('is-loaded');
  });

  it('reverts to the fallback on @error so a broken image is never visible', async () => {
    const wrapper = mount(AssetImage, {
      props: { ...BASE, src: '/cards/missing.png' },
    });

    await wrapper.find('img').trigger('load');
    expect(wrapper.find('img').classes()).toContain('is-loaded');

    await wrapper.find('img').trigger('error');
    expect(wrapper.find('img').classes()).not.toContain('is-loaded');
  });

  it('re-guards when the src changes so the previous art cannot flash', async () => {
    const wrapper = mount(AssetImage, {
      props: { ...BASE, src: '/cards/7s.png' },
    });

    await wrapper.find('img').trigger('load');
    expect(wrapper.find('img').classes()).toContain('is-loaded');

    await wrapper.setProps({ src: '/cards/8s.png' });

    expect(wrapper.find('img').classes()).not.toContain('is-loaded');
  });
});

describe('AssetImage — layout and asset contract', () => {
  it('reserves the caller-supplied aspect ratio on the wrapper', () => {
    const wrapper = mount(AssetImage, {
      props: { aspectRatio: '5 / 7', alt: '', src: null },
    });

    expect(wrapper.find('.asset-image').attributes('style')).toContain('aspect-ratio: 5 / 7');
  });

  it('passes alt through to the image', () => {
    const wrapper = mount(AssetImage, {
      props: { aspectRatio: '2 / 3', alt: 'Seven of spades', src: '/cards/7s.png' },
    });

    expect(wrapper.find('img').attributes('alt')).toBe('Seven of spades');
  });

  it('decodes off the main thread — safe because the image cross-fades in', () => {
    const wrapper = mount(AssetImage, {
      props: { ...BASE, src: '/cards/7s.png' },
    });

    expect(wrapper.find('img').attributes('decoding')).toBe('async');
  });
});
