// @vitest-environment jsdom
/**
 * `v-disabled-reason` — the single binding that dims a control, explains it,
 * and makes it inert.
 *
 * The three halves are tested together on purpose: they are one contract, and
 * a control that dims but still fires (or fires-but-silently) is the failure
 * this directive exists to make unrepresentable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { vDisabledReason, isDisabled } from './vDisabledReason.js';
import {
  useDisabledReasonTooltip,
  hideDisabledReason,
  DISABLED_TOOLTIP_ID,
} from '../composables/useDisabledReasonTooltip.js';

/** A button whose reason is reactive, so `updated`/`unmounted` are exercised too. */
function mountButton(initial: string | false) {
  const reason = ref<string | false>(initial);
  const onClick = vi.fn();
  const wrapper = mount(
    defineComponent({
      directives: { disabledReason: vDisabledReason },
      props: { onClick: { type: Function, required: true } },
      setup: () => ({ reason }),
      template: `<button v-disabled-reason="reason" @click="onClick">go</button>`,
    }),
    { props: { onClick } }
  );
  return { wrapper, reason, onClick, btn: wrapper.find('button') };
}

const tooltip = useDisabledReasonTooltip();

describe('vDisabledReason', () => {
  beforeEach(() => {
    hideDisabledReason();
  });

  describe('isDisabled', () => {
    it('treats a non-empty string as disabled and everything else as enabled', () => {
      expect(isDisabled('No wood.')).toBe(true);
      expect(isDisabled(false)).toBe(false);
      expect(isDisabled(undefined)).toBe(false);
      expect(isDisabled(null)).toBe(false);
    });

    it('does NOT disable on an empty string — a blank tooltip is not a reason', () => {
      expect(isDisabled('')).toBe(false);
    });
  });

  describe('attributes', () => {
    it('marks the control aria-disabled and points it at the shared tooltip', () => {
      const { btn, wrapper } = mountButton('A sheer cliff blocks your way.');

      expect(btn.attributes('aria-disabled')).toBe('true');
      expect(btn.attributes('aria-describedby')).toBe(DISABLED_TOOLTIP_ID);
      expect(btn.attributes('data-bs-disabled-reason')).toBe('A sheer cliff blocks your way.');
      wrapper.unmount();
    });

    it('never sets the native disabled attribute, which would strip the tab stop', () => {
      const { btn, wrapper } = mountButton('Blocked.');

      expect(btn.attributes('disabled')).toBeUndefined();
      expect((btn.element as HTMLButtonElement).disabled).toBe(false);
      wrapper.unmount();
    });

    it('leaves an enabled control completely untouched', () => {
      const { btn, wrapper } = mountButton(false);

      expect(btn.attributes('aria-disabled')).toBeUndefined();
      expect(btn.attributes('aria-describedby')).toBeUndefined();
      expect(btn.attributes('data-bs-disabled-reason')).toBeUndefined();
      wrapper.unmount();
    });

    it('cleans every attribute off when the reason goes away', async () => {
      const { btn, reason, wrapper } = mountButton('Blocked.');

      reason.value = false;
      await nextTick();

      expect(btn.attributes('aria-disabled')).toBeUndefined();
      expect(btn.attributes('aria-describedby')).toBeUndefined();
      expect(btn.attributes('data-bs-disabled-reason')).toBeUndefined();
      wrapper.unmount();
    });

    it('updates the wording in place when the reason is recomputed', async () => {
      const { btn, reason, wrapper } = mountButton('You need 3 wood; you have 1.');

      reason.value = 'You need 3 wood; you have 2.';
      await nextTick();

      expect(btn.attributes('data-bs-disabled-reason')).toBe('You need 3 wood; you have 2.');
      wrapper.unmount();
    });
  });

  describe('inert activation', () => {
    it('swallows the click, so the control\'s own handler never runs', async () => {
      const { btn, onClick, wrapper } = mountButton('Blocked.');

      await btn.trigger('click');

      expect(onClick).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('swallows Enter and Space, so the keyboard path is inert too', async () => {
      const { btn, onClick, wrapper } = mountButton('Blocked.');

      await btn.trigger('keydown', { key: 'Enter' });
      await btn.trigger('keydown', { key: ' ' });

      expect(onClick).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('lets other keys through — only activation is blocked', async () => {
      const onKey = vi.fn();
      const wrapper = mount(
        defineComponent({
          directives: { disabledReason: vDisabledReason },
          props: { onKey: { type: Function, required: true } },
          template: `<button v-disabled-reason="'Blocked.'" @keydown="onKey">go</button>`,
        }),
        { props: { onKey } }
      );

      await wrapper.find('button').trigger('keydown', { key: 'Tab' });

      expect(onKey).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('restores the handler the moment the control stops being disabled', async () => {
      const { btn, reason, onClick, wrapper } = mountButton('Blocked.');

      await btn.trigger('click');
      expect(onClick).not.toHaveBeenCalled();

      reason.value = false;
      await nextTick();
      await btn.trigger('click');

      expect(onClick).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });
  });

  describe('tooltip', () => {
    it('shows the reason on hover', async () => {
      const { btn, wrapper } = mountButton('A ravine blocks your way.');

      await btn.trigger('mouseenter');

      expect(tooltip.text.value).toBe('A ravine blocks your way.');
      wrapper.unmount();
    });

    it('shows the reason on focus, so the keyboard path reaches it too', async () => {
      const { btn, wrapper } = mountButton('A gorge blocks your way.');

      await btn.trigger('focus');

      expect(tooltip.text.value).toBe('A gorge blocks your way.');
      wrapper.unmount();
    });

    it('shows the reason on tap — the blocked tap IS the explanation on touch', async () => {
      const { btn, wrapper } = mountButton('A mountain blocks your way.');

      await btn.trigger('click');

      expect(tooltip.text.value).toBe('A mountain blocks your way.');
      wrapper.unmount();
    });

    it('hides on mouseleave and on blur', async () => {
      const { btn, wrapper } = mountButton('Blocked.');

      await btn.trigger('mouseenter');
      await btn.trigger('mouseleave');
      expect(tooltip.text.value).toBe(null);

      await btn.trigger('focus');
      await btn.trigger('blur');
      expect(tooltip.text.value).toBe(null);
      wrapper.unmount();
    });

    it('moves cleanly between neighbouring controls without blanking', async () => {
      // The pointer leaves A after entering B, so an unguarded hide would wipe
      // the tooltip B just opened — the flicker the anchor guard prevents.
      const wrapper = mount(
        defineComponent({
          directives: { disabledReason: vDisabledReason },
          template: `
            <div>
              <button id="a" v-disabled-reason="'Reason A.'">a</button>
              <button id="b" v-disabled-reason="'Reason B.'">b</button>
            </div>`,
        })
      );

      await wrapper.find('#a').trigger('mouseenter');
      await wrapper.find('#b').trigger('mouseenter');
      await wrapper.find('#a').trigger('mouseleave');

      expect(tooltip.text.value).toBe('Reason B.');
      wrapper.unmount();
    });

    it('hides when the described control unmounts', async () => {
      const { btn, wrapper } = mountButton('Blocked.');

      await btn.trigger('mouseenter');
      expect(tooltip.text.value).toBe('Blocked.');

      wrapper.unmount();
      expect(tooltip.text.value).toBe(null);
    });

    it('hides when the control stops being disabled while shown', async () => {
      const { btn, reason, wrapper } = mountButton('Blocked.');

      await btn.trigger('mouseenter');
      reason.value = false;
      await nextTick();

      expect(tooltip.text.value).toBe(null);
      wrapper.unmount();
    });

    it('opens on pointerdown, which is the only signal touch reliably sends', async () => {
      const { btn, wrapper } = mountButton('Blocked.');

      await btn.trigger('pointerdown');

      expect(tooltip.text.value).toBe('Blocked.');
      wrapper.unmount();
    });

    it('closes when the next press lands elsewhere — touch has no mouseleave', async () => {
      const { btn, wrapper } = mountButton('Blocked.');
      const elsewhere = document.createElement('div');
      document.body.appendChild(elsewhere);

      await btn.trigger('pointerdown');
      expect(tooltip.text.value).toBe('Blocked.');

      elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      expect(tooltip.text.value).toBe(null);
      elsewhere.remove();
      wrapper.unmount();
    });

    it('a press ON the control does not close its own tooltip', async () => {
      const { btn, wrapper } = mountButton('Blocked.');

      await btn.trigger('pointerdown');
      await btn.trigger('pointerdown');

      expect(tooltip.text.value).toBe('Blocked.');
      wrapper.unmount();
    });

    it('never opens for an enabled control', async () => {
      const { btn, wrapper } = mountButton(false);

      await btn.trigger('mouseenter');
      await btn.trigger('focus');
      await btn.trigger('pointerdown');

      expect(tooltip.text.value).toBe(null);
      wrapper.unmount();
    });
  });
});
