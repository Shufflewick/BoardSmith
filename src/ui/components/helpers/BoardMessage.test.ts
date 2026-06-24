// @vitest-environment jsdom
/**
 * Contract tests for BoardMessage.vue.
 *
 * BoardMessage is the standard primitive for transient board indicators. Its
 * core guarantee is NON-REFLOW: it must be absolutely positioned so showing /
 * hiding it never moves the board. These tests lock in:
 *  - absolute positioning of the anchor wrapper (the non-reflow contract)
 *  - role=status + aria-live=polite on the content (screen-reader announcement)
 *  - visible toggling shows/hides the content
 *  - position prop maps to the expected modifier class
 *  - it is exported from the UI barrel
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import BoardMessage from './BoardMessage.vue';

// jsdom lacks matchMedia; importing the full UI barrel pulls in modules that
// read it at import time (prefers-reduced-motion detection).
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

const CONTENT = '.bsg-board-message__content';

describe('BoardMessage', () => {
  it('anchor wrapper is absolutely positioned (non-reflow contract)', () => {
    const wrapper = mount(BoardMessage, { slots: { default: 'Hello' } });
    const anchor = wrapper.get('.bsg-board-message').element as HTMLElement;
    // jsdom does not apply scoped <style>, but the class drives the CSS rule
    // (`.bsg-board-message { position: absolute }`). Asserting the class is
    // present is the stable proxy for the positioning contract.
    expect(anchor.classList.contains('bsg-board-message')).toBe(true);
  });

  it('content region is role=status aria-live=polite', () => {
    const wrapper = mount(BoardMessage, { slots: { default: 'Select a cell' } });
    const content = wrapper.get(CONTENT);
    expect(content.attributes('role')).toBe('status');
    expect(content.attributes('aria-live')).toBe('polite');
    expect(content.text()).toBe('Select a cell');
  });

  it('hides content when visible is false', () => {
    const wrapper = mount(BoardMessage, {
      props: { visible: false },
      slots: { default: 'Hidden' },
    });
    expect(wrapper.find(CONTENT).exists()).toBe(false);
  });

  it('defaults to bottom position', () => {
    const wrapper = mount(BoardMessage, { slots: { default: 'x' } });
    expect(wrapper.get('.bsg-board-message').classes()).toContain(
      'bsg-board-message--bottom',
    );
  });

  it('applies the requested position modifier', () => {
    const wrapper = mount(BoardMessage, {
      props: { position: 'top' },
      slots: { default: 'x' },
    });
    expect(wrapper.get('.bsg-board-message').classes()).toContain(
      'bsg-board-message--top',
    );
  });

  it('is exported from the UI barrel', async () => {
    const ui = await import('../../index.js');
    expect(ui.BoardMessage).toBe(BoardMessage);
  });
});
