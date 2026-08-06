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
 *   D. A CSS named color ('crimson') and hsl() color render without throwing
 *      (164-CR-02: createColorOption() accepts any CSS color string).
 *   E. A genuinely unparseable color degrades to the safe default ink
 *      (no render-path crash) and emits one actionable dev warning, rather
 *      than throwing inside the computed.
 */

import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerToken from './PlayerToken.vue';
import { _clearShownWarnings } from '../../utils/dev.js';

describe('PlayerToken contrast ink', () => {
  it('renders black ink and no text-shadow for a light seat color', () => {
    const wrapper = mount(PlayerToken, {
      props: { name: 'Alice', seat: 0, color: '#ecf0f1' },
    });
    const ini = wrapper.find('.ini');
    const style = ini.attributes('style') ?? '';
    expect(style).toContain('color: rgb(0, 0, 0)');
    expect(style.toLowerCase()).not.toContain('text-shadow: 0 1px 2px rgba(0, 0, 0');
  });

  it('renders white ink and a dark-halo text-shadow for a dark seat color', () => {
    const wrapper = mount(PlayerToken, {
      props: { name: 'Bob', seat: 1, color: '#2c3e50' },
    });
    const ini = wrapper.find('.ini');
    const style = ini.attributes('style') ?? '';
    expect(style).toContain('color: rgb(255, 255, 255)');
    expect(style).toContain('text-shadow');
  });

  it('renders without throwing when color is absent', () => {
    expect(() => mount(PlayerToken, { props: { name: 'Carol', seat: 2 } })).not.toThrow();
  });

  it('renders without throwing for a CSS named color (createColorOption() allows any CSS color, 164-CR-02)', () => {
    const wrapper = mount(PlayerToken, {
      props: { name: 'Dave', seat: 3, color: 'crimson' },
    });
    const style = wrapper.find('.ini').attributes('style') ?? '';
    // crimson is dark -> white ink, matching contrastInk('crimson').
    expect(style).toContain('color: rgb(255, 255, 255)');
  });

  it('renders without throwing for an hsl() color (164-CR-02)', () => {
    expect(() =>
      mount(PlayerToken, { props: { name: 'Eve', seat: 4, color: 'hsl(200, 60%, 50%)' } })
    ).not.toThrow();
  });

  it('degrades to the default ink (no crash) and warns once for a genuinely unparseable color (164-CR-02)', () => {
    _clearShownWarnings();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const wrapper = mount(PlayerToken, {
        props: { name: 'Frank', seat: 5, color: 'not-a-real-color' },
      });
      expect(() => wrapper.find('.ini').attributes('style')).not.toThrow();
      const style = wrapper.find('.ini').attributes('style') ?? '';
      // DEFAULT_INK is white with a dark halo.
      expect(style).toContain('color: rgb(255, 255, 255)');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0].join(' ')).toContain('not-a-real-color');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
