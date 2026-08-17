// @vitest-environment jsdom
/**
 * The shared Button. Its whole design rests on one rule: disabling requires a
 * REASON — there is no boolean `disabled` prop — so a player can never meet a
 * dead control with no explanation. These tests exist mostly to keep that
 * property from being quietly softened into a boolean.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Button from './Button.vue';
import { vDisabledReason } from '../../directives/vDisabledReason.js';

const button = (props: Record<string, unknown> = {}, slot = 'Go') =>
  mount(Button, {
    props,
    slots: { default: slot },
    global: { directives: { 'disabled-reason': vDisabledReason } },
  });

describe('Button', () => {
  it('renders its slot content', () => {
    expect(button({}, 'Execute').text()).toBe('Execute');
  });

  it('renders a real <button>, not a clickable div', () => {
    expect(button().element.tagName).toBe('BUTTON');
  });

  it('defaults to a primary, default-size, type=button control', () => {
    const wrapper = button();
    expect(wrapper.classes()).toContain('btn');
    expect(wrapper.classes()).toContain('btn--primary');
    expect(wrapper.classes()).toContain('btn--default');
    expect(wrapper.attributes('type')).toBe('button');
  });

  it.each(['primary', 'secondary', 'danger', 'ghost', 'icon'])(
    'applies the %s variant class',
    (variant) => {
      expect(button({ variant }).classes()).toContain(`btn--${variant}`);
    },
  );

  it.each(['small', 'default', 'large'])('applies the %s size class', (size) => {
    expect(button({ size }).classes()).toContain(`btn--${size}`);
  });

  it('honours an explicit button type', () => {
    expect(button({ type: 'submit' }).attributes('type')).toBe('submit');
  });

  it('emits click with the event when enabled', async () => {
    const wrapper = button();
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
    expect(wrapper.emitted('click')![0][0]).toBeInstanceOf(MouseEvent);
  });

  it('is not marked disabled without a reason', () => {
    expect(button().attributes('aria-disabled')).toBeUndefined();
  });

  describe('disabling requires a reason', () => {
    it('marks the button disabled to assistive tech when given one', () => {
      expect(button({ disabledReason: 'Nothing to undo yet.' }).attributes('aria-disabled'))
        .toBe('true');
    });

    it('swallows the click, so a disabled button cannot fire an action', async () => {
      const wrapper = button({ disabledReason: 'Nothing to undo yet.' });
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toBeUndefined();
    });

    it('carries the reason where a player can read it', () => {
      const wrapper = button({ disabledReason: 'Two wood short.' });
      expect(wrapper.html()).toContain('Two wood short.');
    });

    it('treats false as enabled — that is the "not disabled" value', async () => {
      const wrapper = button({ disabledReason: false });
      expect(wrapper.attributes('aria-disabled')).toBeUndefined();
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toHaveLength(1);
    });

    it('re-enables when the reason goes away', async () => {
      const wrapper = button({ disabledReason: 'Not yet.' });
      await wrapper.setProps({ disabledReason: false });
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toHaveLength(1);
    });

    it('disables when a reason appears', async () => {
      const wrapper = button({ disabledReason: false });
      await wrapper.setProps({ disabledReason: 'Now blocked.' });
      await wrapper.trigger('click');
      expect(wrapper.emitted('click')).toBeUndefined();
    });

    it('offers no boolean disabled prop to reach for instead', () => {
      // If a plain `disabled` prop is ever added, the reason becomes optional
      // and the guarantee is gone. A stray attribute must not disable it.
      const wrapper = button({ disabled: true } as Record<string, unknown>);
      expect(wrapper.attributes('aria-disabled')).toBeUndefined();
    });
  });
});
