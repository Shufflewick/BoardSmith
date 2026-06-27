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
      expect(tooltip.text()).not.toContain('Why disabled:');
      wrapper.unmount();
    });

    it('with disabledReason only: shows "Why disabled:" + reason, no divider', async () => {
      const wrapper = mountPopover({
        actionName: 'build',
        triggerLabel: 'Build',
        disabledReason: 'You need at least 3 wood.',
      });
      await wrapper.find('.action-help-btn').trigger('click');
      await nextTick();

      const tooltip = wrapper.find('[role="tooltip"]');
      expect(tooltip.text()).toContain('Why disabled:');
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
      expect(tooltip.text()).toContain('Why disabled:');
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
      expect(textA).toContain('Why disabled:');
      expect(textA).toContain('No valid moves.');

      expect(textB).toContain('Click a square to move.');
      expect(textB).toContain('Why disabled:');
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
});
