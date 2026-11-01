// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createHideChrome, HIDE_CHROME_KEY, useHideChrome } from './hideChrome.js';

describe('hide chrome (#1538)', () => {
  it('hides while any board asks, and shows again when the asking board unmounts', () => {
    const chrome = createHideChrome();
    const fieldOnly = ref(true);
    const Board = defineComponent({
      setup() {
        useHideChrome(() => fieldOnly.value);
        return () => h('div');
      },
    });
    const wrapper = mount(Board, { global: { provide: { [HIDE_CHROME_KEY]: chrome } } });
    expect(chrome.hidden.value).toBe(true);
    fieldOnly.value = false;
    expect(chrome.hidden.value).toBe(false);
    fieldOnly.value = true;
    wrapper.unmount();
    expect(chrome.hidden.value).toBe(false);
  });

  it('names the fix when called outside a shell', () => {
    const Board = defineComponent({
      setup() {
        useHideChrome(() => true);
        return () => h('div');
      },
    });
    expect(() => mount(Board)).toThrow(/useHideChrome\(\) was called outside a board/);
  });
});
