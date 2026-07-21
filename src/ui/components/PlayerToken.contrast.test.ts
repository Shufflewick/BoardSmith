// @vitest-environment jsdom
/**
 * PlayerToken — luminance-adaptive glyph ink (LIBX-03, Plan 164-02, Task 2)
 *
 * Behaviors under test:
 *   A. A light seat color renders the `.ini` letter with black ink and no
 *      (or 'none') text-shadow.
 *   B. A dark seat color renders white ink and a dark-halo text-shadow.
 *   C. An absent `color` prop still renders without throwing (safe default
 *      ink; must not call the throwing parser with undefined).
 */

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerToken from './PlayerToken.vue';

describe('PlayerToken contrast ink', () => {
  it('renders black ink and no text-shadow for a light seat color', () => {
    const wrapper = mount(PlayerToken, {
      props: { name: 'Alice', index: 0, color: '#ecf0f1' },
    });
    const ini = wrapper.find('.ini');
    const style = ini.attributes('style') ?? '';
    expect(style).toContain('color: rgb(0, 0, 0)');
    expect(style.toLowerCase()).not.toContain('text-shadow: 0 1px 2px rgba(0, 0, 0');
  });

  it('renders white ink and a dark-halo text-shadow for a dark seat color', () => {
    const wrapper = mount(PlayerToken, {
      props: { name: 'Bob', index: 1, color: '#2c3e50' },
    });
    const ini = wrapper.find('.ini');
    const style = ini.attributes('style') ?? '';
    expect(style).toContain('color: rgb(255, 255, 255)');
    expect(style).toContain('text-shadow');
  });

  it('renders without throwing when color is absent', () => {
    expect(() => mount(PlayerToken, { props: { name: 'Carol', index: 2 } })).not.toThrow();
  });
});
