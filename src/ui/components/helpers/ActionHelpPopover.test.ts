// @vitest-environment jsdom
/**
 * ActionHelpPopover component tests.
 *
 * Contract:
 *  1. Renders a .action-help-btn trigger with correct aria-label and aria-expanded="false" when closed.
 *  2. Clicking the trigger opens a Teleported tooltip with role="tooltip", id, and aria-describedby.
 *  3. Content rendering: helpText only, disabledReason only (no divider), both (with divider).
 *  4. Escape key closes the popover; outside mousedown closes it.
 *  5. Text content reaches DOM via interpolation — never v-html.
 *  6. Reduced-motion: component renders without errors and does not depend on animation timing.
 *  7. Parity: identical tooltip content in custom-UI-like div host vs AutoUI-like td/grid cell host.
 *
 * jsdom NOTE: getBoundingClientRect returns zeros. Assertions use element presence and
 * text content rather than positions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ActionHelpPopover from './ActionHelpPopover.vue';

// jsdom lacks matchMedia
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Mount ActionHelpPopover with Teleport stubbed so teleported content renders inline.
 */
function mountPopover(props: {
  actionName: string;
  triggerLabel: string;
  helpText?: string;
  disabledReason?: string;
}) {
  return mount(ActionHelpPopover, {
    props,
    global: {
      stubs: { Teleport: true },
    },
    attachTo: document.body,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ActionHelpPopover', () => {
  afterEach(() => {
    // Clean up any document listeners by unmounting
    document
      .querySelectorAll('[data-test-popover]')
      .forEach((el) => el.parentNode?.removeChild(el));
  });

  // ── Case 1: trigger button attributes ────────────────────────────────────

  describe('trigger button', () => {
    it('renders .action-help-btn with aria-label "Help for {triggerLabel}"', () => {
      const wrapper = mountPopover({
        actionName: 'move',
        triggerLabel: 'Move Piece',
        helpText: 'Click a square to move.',
      });
      const btn = wrapper.find('.action-help-btn');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes('aria-label')).toBe('Help for Move Piece');
      wrapper.unmount();
    });

    it('trigger has aria-expanded="false" when popover is closed', () => {
      const wrapper = mountPopover({
        actionName: 'move',
        triggerLabel: 'Move Piece',
        helpText: 'Click a square to move.',
      });
      const btn = wrapper.find('.action-help-btn');
      expect(btn.attributes('aria-expanded')).toBe('false');
      wrapper.unmount();
    });

    it('trigger has aria-controls pointing to ${actionName}-help-tip', () => {
      const wrapper = mountPopover({
        actionName: 'move',
        triggerLabel: 'Move Piece',
        helpText: 'Click a square to move.',
      });
      const btn = wrapper.find('.action-help-btn');
      expect(btn.attributes('aria-controls')).toBe('move-help-tip');
      wrapper.unmount();
    });

    it('trigger does NOT have aria-describedby when popover is closed', () => {
      const wrapper = mountPopover({
        actionName: 'move',
        triggerLabel: 'Move Piece',
        helpText: 'Click a square to move.',
      });
      const btn = wrapper.find('.action-help-btn');
      expect(btn.attributes('aria-describedby')).toBeUndefined();
      wrapper.unmount();
    });
  });

  // ── Case 2: open/close via click ─────────────────────────────────────────

  describe('open/close behavior', () => {
    it('clicking trigger opens tooltip with role="tooltip" and correct id', async () => {
      const wrapper = mountPopover({
        actionName: 'attack',
        triggerLabel: 'Attack',
        helpText: 'Strike an adjacent enemy.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.attributes('id')).toBe('attack-help-tip');
      wrapper.unmount();
    });

    it('clicking trigger sets aria-expanded to "true"', async () => {
      const wrapper = mountPopover({
        actionName: 'attack',
        triggerLabel: 'Attack',
        helpText: 'Strike an adjacent enemy.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      expect(wrapper.find('.action-help-btn').attributes('aria-expanded')).toBe('true');
      wrapper.unmount();
    });

    it('trigger gains aria-describedby when popover is open', async () => {
      const wrapper = mountPopover({
        actionName: 'attack',
        triggerLabel: 'Attack',
        helpText: 'Strike an adjacent enemy.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      expect(wrapper.find('.action-help-btn').attributes('aria-describedby')).toBe('attack-help-tip');
      wrapper.unmount();
    });

    it('clicking trigger again closes the popover (toggle)', async () => {
      const wrapper = mountPopover({
        actionName: 'defend',
        triggerLabel: 'Defend',
        helpText: 'Reduce incoming damage.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
      expect(wrapper.find('.action-help-btn').attributes('aria-expanded')).toBe('false');
      wrapper.unmount();
    });
  });

  // ── Case 3: content rendering ─────────────────────────────────────────────

  describe('content rendering', () => {
    it('with helpText only: shows help text, no divider, no disabled section', async () => {
      const wrapper = mountPopover({
        actionName: 'build',
        triggerLabel: 'Build',
        helpText: 'Place a structure on an empty tile.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.text()).toContain('Place a structure on an empty tile.');
      expect(wrapper.find('.help-divider').exists()).toBe(false);
      expect(tooltip.text()).not.toContain('Note:');
      wrapper.unmount();
    });

    it('with disabledReason only: shows "Note:" + reason, no divider', async () => {
      const wrapper = mountPopover({
        actionName: 'build',
        triggerLabel: 'Build',
        disabledReason: 'You need at least 3 wood.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.text()).toContain('Note:');
      expect(tooltip.text()).toContain('You need at least 3 wood.');
      expect(wrapper.find('.help-divider').exists()).toBe(false);
      wrapper.unmount();
    });

    it('with both helpText and disabledReason: shows help text + divider + disabled section', async () => {
      const wrapper = mountPopover({
        actionName: 'cast',
        triggerLabel: 'Cast Spell',
        helpText: 'Cast a powerful arcane bolt.',
        disabledReason: 'Not enough mana.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.text()).toContain('Cast a powerful arcane bolt.');
      expect(tooltip.text()).toContain('Note:');
      expect(tooltip.text()).toContain('Not enough mana.');
      expect(wrapper.find('.help-divider').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  // ── Case 4: dismiss behavior ──────────────────────────────────────────────

  describe('dismiss behavior', () => {
    it('Escape key closes the popover', async () => {
      const wrapper = mountPopover({
        actionName: 'flee',
        triggerLabel: 'Flee',
        helpText: 'Escape from combat.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);

      // Dispatch Escape keydown on document
      const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escEvent);
      await nextTick();

      expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('mousedown outside the trigger closes the popover', async () => {
      const wrapper = mountPopover({
        actionName: 'flee',
        triggerLabel: 'Flee',
        helpText: 'Escape from combat.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);

      // Mousedown on an unrelated element
      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);
      const mousedownEvent = new MouseEvent('mousedown', { bubbles: true });
      outsideEl.dispatchEvent(mousedownEvent);
      await nextTick();

      expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
      outsideEl.remove();
      wrapper.unmount();
    });

    it('mouseenter shows popover, mouseleave hides it', async () => {
      const wrapper = mountPopover({
        actionName: 'move',
        triggerLabel: 'Move',
        helpText: 'Move to an adjacent square.',
      });
      const btn = wrapper.find('.action-help-btn');

      await btn.trigger('mouseenter');
      await nextTick();
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(true);

      await btn.trigger('mouseleave');
      await nextTick();
      expect(wrapper.find('[role="tooltip"]').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  // ── Case 5: no v-html — text via interpolation ────────────────────────────

  describe('security: no v-html', () => {
    it('help text reaches DOM as text content, not parsed HTML', async () => {
      const xssAttempt = '<script>alert("xss")</script>';
      const wrapper = mountPopover({
        actionName: 'attack',
        triggerLabel: 'Attack',
        helpText: xssAttempt,
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      const tooltip = wrapper.find('[role="tooltip"]');
      // The literal string should appear as text, not as a parsed script element
      expect(tooltip.text()).toContain('<script>');
      expect(tooltip.find('script').exists()).toBe(false);
      wrapper.unmount();
    });

    it('disabledReason reaches DOM as text content, not parsed HTML', async () => {
      const xssAttempt = '<img src=x onerror="alert(1)">';
      const wrapper = mountPopover({
        actionName: 'attack',
        triggerLabel: 'Attack',
        disabledReason: xssAttempt,
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.text()).toContain('<img');
      expect(tooltip.find('img').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  // ── Case 6: reduced-motion ────────────────────────────────────────────────

  describe('reduced-motion', () => {
    it('renders and shows content without throwing in a reduced-motion environment', async () => {
      // Simulate prefers-reduced-motion: reduce
      vi.stubGlobal(
        'matchMedia',
        vi.fn((query: string) => ({
          matches: query.includes('reduce'),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );

      const wrapper = mountPopover({
        actionName: 'skip',
        triggerLabel: 'Skip',
        helpText: 'Skip your turn.',
      });

      // Should not throw
      expect(() => wrapper.find('.action-help-btn')).not.toThrow();

      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.text()).toContain('Skip your turn.');

      wrapper.unmount();

      // Restore default matchMedia stub
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
    });
  });

  // ── Case 7: parity — identical rendering in different host contexts ───────

  describe('parity: custom-UI-like div vs AutoUI-like td host', () => {
    it('renders identical tooltip content in a custom-UI-like plain div host', async () => {
      const wrapper = mount(ActionHelpPopover, {
        props: {
          actionName: 'move',
          triggerLabel: 'Move Piece',
          helpText: 'Click a square to move.',
          disabledReason: 'No valid moves.',
        },
        global: { stubs: { Teleport: true } },
        attachTo: (() => {
          // Simulate a custom-UI host: a plain div wrapper
          const host = document.createElement('div');
          host.className = 'custom-ui-panel';
          document.body.appendChild(host);
          return host;
        })(),
      });

      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();
      const tooltipA = wrapper.find('[role="tooltip"]');
      const textA = tooltipA.text();

      wrapper.unmount();

      const wrapper2 = mount(ActionHelpPopover, {
        props: {
          actionName: 'move',
          triggerLabel: 'Move Piece',
          helpText: 'Click a square to move.',
          disabledReason: 'No valid moves.',
        },
        global: { stubs: { Teleport: true } },
        attachTo: (() => {
          // Simulate an AutoUI-like host: a td inside a table
          const table = document.createElement('table');
          const tbody = document.createElement('tbody');
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.className = 'auto-action-cell';
          tr.appendChild(td);
          tbody.appendChild(tr);
          table.appendChild(tbody);
          document.body.appendChild(table);
          return td;
        })(),
      });

      await wrapper2.find('.action-help-btn').trigger('click');
      await nextTick();
      const tooltipB = wrapper2.find('[role="tooltip"]');
      const textB = tooltipB.text();

      wrapper2.unmount();

      // Both must contain identical help text and disabled reason
      expect(textA).toContain('Click a square to move.');
      expect(textA).toContain('Note:');
      expect(textA).toContain('No valid moves.');

      expect(textB).toContain('Click a square to move.');
      expect(textB).toContain('Note:');
      expect(textB).toContain('No valid moves.');

      // And they must be equal
      expect(textA).toBe(textB);

      // Clean up fixture elements
      document.querySelectorAll('.custom-ui-panel').forEach(el => el.remove());
      document.querySelectorAll('table').forEach(el => el.remove());
    });

    it('divider is present in both hosts when both helpText and disabledReason exist', async () => {
      async function mountAndCheck(hostEl: HTMLElement) {
        const wrapper = mount(ActionHelpPopover, {
          props: {
            actionName: 'cast',
            triggerLabel: 'Cast',
            helpText: 'Launch a fireball.',
            disabledReason: 'No mana.',
          },
          global: { stubs: { Teleport: true } },
          attachTo: hostEl,
        });
        await wrapper.find('.action-help-btn').trigger('click');
        await nextTick();
        const hasDivider = wrapper.find('.help-divider').exists();
        wrapper.unmount();
        return hasDivider;
      }

      const divHost = document.createElement('div');
      document.body.appendChild(divHost);
      const hasDividerA = await mountAndCheck(divHost);

      const tdHost = document.createElement('td');
      const table = document.createElement('table');
      document.body.appendChild(table);
      const hasDividerB = await mountAndCheck(tdHost);

      expect(hasDividerA).toBe(true);
      expect(hasDividerB).toBe(true);

      divHost.remove();
      table.remove();
    });
  });

  // ── Case 8: positioning — WR-01 (actual height) + WR-02 (caret offset) ──────
  //
  // jsdom returns 0 for all layout metrics, so we test the logic via mocked
  // offsetHeight / getBoundingClientRect rather than real pixel positions.

  describe('positioning (WR-01: actual height, WR-02: caret offset)', () => {
    it('WR-01: popover renders below trigger when there is enough viewport space', async () => {
      // jsdom innerHeight = 768; trigger at bottom = 100 → 100 + actualHeight should fit
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true, writable: true });

      const wrapper = mountPopover({
        actionName: 'move',
        triggerLabel: 'Move',
        helpText: 'Move to an adjacent tile.',
      });

      await wrapper.find('.action-help-btn').trigger('mouseenter');
      await nextTick();
      await nextTick(); // second tick for Phase 2 position update

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.exists()).toBe(true);
      // Caret should point up (popover is below trigger)
      expect(wrapper.find('.ahp-caret--top').exists()).toBe(true);
      expect(wrapper.find('.ahp-caret--bottom').exists()).toBe(false);

      wrapper.unmount();
    });

    it('WR-01: popover flips above trigger when viewport has no room below (mocked offsetHeight)', async () => {
      // Simulate trigger near the viewport bottom so there is not enough room below.
      const originalInnerHeight = window.innerHeight;
      Object.defineProperty(window, 'innerHeight', { value: 200, configurable: true, writable: true });

      // Patch getBoundingClientRect on the mounted trigger so it reports bottom=190
      // (only 2px above our 200-8=192 threshold → not enough room for any height > 2).
      const wrapper = mountPopover({
        actionName: 'cast',
        triggerLabel: 'Cast',
        helpText: 'Cast a powerful spell.',
        disabledReason: 'No mana remaining.',
      });

      const triggerEl = wrapper.find('.action-help-btn').element as HTMLButtonElement;
      const origRect = triggerEl.getBoundingClientRect.bind(triggerEl);
      vi.spyOn(triggerEl, 'getBoundingClientRect').mockReturnValue({
        top: 180, bottom: 190, left: 50, right: 74, width: 24, height: 10,
        x: 50, y: 180, toJSON: origRect().toJSON ?? (() => ({})),
      } as DOMRect);

      // Patch offsetHeight on the popover element by overriding the ref after mount
      // via a MutationObserver shim: instead, patch it globally after nextTick.
      await wrapper.find('.action-help-btn').trigger('mouseenter');
      await nextTick(); // Phase 1 renders the element

      // Now the popoverRef element is in the DOM; mock its offsetHeight to 200
      // (tall dual-section popover — the value the check must use, not 80).
      const popoverEl = document.querySelector('.action-help-popover') as HTMLElement | null;
      if (popoverEl) {
        Object.defineProperty(popoverEl, 'offsetHeight', { value: 200, configurable: true });
      }

      await nextTick(); // Phase 2 reads offsetHeight and recomputes

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.exists()).toBe(true);
      // With bottom=190 and innerHeight=200 (threshold 8), top+200=190+4+200=394 > 192 → flip
      expect(wrapper.find('.ahp-caret--bottom').exists()).toBe(true);
      expect(wrapper.find('.ahp-caret--top').exists()).toBe(false);

      // Restore
      Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true, writable: true });
      wrapper.unmount();
    });

    it('WR-02: caret --ahp-caret-left style is set on the caret span', async () => {
      const wrapper = mountPopover({
        actionName: 'defend',
        triggerLabel: 'Defend',
        helpText: 'Reduce incoming damage.',
      });

      await wrapper.find('.action-help-btn').trigger('mouseenter');
      await nextTick();
      await nextTick(); // Phase 2

      const caret = wrapper.find('.ahp-caret');
      expect(caret.exists()).toBe(true);
      // The --ahp-caret-left CSS variable should be set inline on the caret element
      const caretLeft = (caret.element as HTMLElement).style.getPropertyValue('--ahp-caret-left');
      // In jsdom, getBoundingClientRect returns zeros → caretLeft clamped to 12px (Math.max(12, 0-0))
      expect(caretLeft).toBe('12px');

      wrapper.unmount();
    });
  });
});
