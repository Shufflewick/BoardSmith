// @vitest-environment jsdom
/**
 * The shared debug controls (#157).
 *
 * These exist so the panel's per-tab split does not have to duplicate the rules
 * they carry, so what is pinned here is the part other code depends on: the
 * class names the panel's own rules and its tests still address, and the
 * modifier mapping each call site used to write by hand.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DebugButton from './DebugButton.vue';
import DebugSearchInput from './DebugSearchInput.vue';

describe('DebugButton', () => {
  it('keeps the debug-btn class the panel rules and tests address', () => {
    const w = mount(DebugButton, { slots: { default: 'Copy' } });
    expect(w.get('button').classes()).toContain('debug-btn');
    expect(w.text()).toBe('Copy');
    // A debug control must never submit an enclosing form by accident.
    expect(w.get('button').attributes('type')).toBe('button');
  });

  it('maps each variant onto the modifier the stylesheet expects', () => {
    expect(mount(DebugButton, { props: { size: 'small' } }).get('button').classes()).toContain('small');
    expect(mount(DebugButton, { props: { tone: 'danger' } }).get('button').classes()).toContain('danger');
    expect(mount(DebugButton, { props: { tone: 'primary' } }).get('button').classes()).toContain('primary');
    expect(mount(DebugButton, { props: { active: true } }).get('button').classes()).toContain('active');

    const plain = mount(DebugButton).get('button').classes();
    expect(plain).toEqual(['debug-btn']);
  });

  it('passes a panel-specific class and a listener through to the button', async () => {
    const w = mount(DebugButton, { attrs: { class: 'live-btn' } });
    expect(w.get('button').classes()).toEqual(expect.arrayContaining(['debug-btn', 'live-btn']));

    await w.get('button').trigger('click');
    expect(w.emitted('click')).toHaveLength(1);
  });

  it('disables the button rather than only dimming it', () => {
    const w = mount(DebugButton, { props: { disabled: true } });
    expect(w.get('button').attributes('disabled')).toBeDefined();
  });
});

describe('DebugSearchInput', () => {
  it('keeps the search-input class and round-trips the value', async () => {
    const w = mount(DebugSearchInput, { props: { modelValue: 'ace', placeholder: 'Search state...' } });
    const input = w.get('input.search-input');

    expect((input.element as HTMLInputElement).value).toBe('ace');
    expect(input.attributes('placeholder')).toBe('Search state...');

    await input.setValue('king');
    expect(w.emitted('update:modelValue')).toEqual([['king']]);
  });

  it('takes an accessible name when the box has no visible label', () => {
    const w = mount(DebugSearchInput, { props: { modelValue: '', ariaLabel: 'Search elements' } });
    expect(w.get('input').attributes('aria-label')).toBe('Search elements');
  });
});
