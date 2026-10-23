// @vitest-environment jsdom
/**
 * The shared disabled-reason tooltip: the surface that replaced the native
 * `title` attribute (which shows nothing at all on touch, waits about a second
 * on desktop, and cannot wrap a game-authored sentence).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import DisabledReasonTooltip from './DisabledReasonTooltip.vue';
import {
  showDisabledReason,
  hideDisabledReason,
  DISABLED_TOOLTIP_ID,
  DISABLED_TOOLTIP_MAX_WIDTH,
} from '../../composables/useDisabledReasonTooltip.js';
import { computePopoverPosition } from './popover-position.js';

function anchorAt(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('button');
  el.getBoundingClientRect = () => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}), ...rect,
  }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('DisabledReasonTooltip', () => {
  beforeEach(() => hideDisabledReason());
  afterEach(() => {
    hideDisabledReason();
    document.body.innerHTML = '';
  });

  it('renders nothing until a control asks for it', () => {
    const wrapper = mount(DisabledReasonTooltip);

    expect(document.getElementById(DISABLED_TOOLTIP_ID)).toBe(null);
    wrapper.unmount();
  });

  it('renders the reason with the id that aria-describedby points at', async () => {
    const wrapper = mount(DisabledReasonTooltip);

    showDisabledReason(anchorAt({ top: 100, left: 40, width: 80, height: 30, bottom: 130 }), 'A sheer cliff blocks your way.');
    await nextTick();

    const tip = document.getElementById(DISABLED_TOOLTIP_ID)!;
    expect(tip).not.toBe(null);
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toContain('A sheer cliff blocks your way.');
    wrapper.unmount();
  });

  it('caps its height to the room beside the control, so a long reason never covers the control (#1454)', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    const wrapper = mount(DisabledReasonTooltip);

    showDisabledReason(anchorAt({ top: 100, left: 40, width: 80, height: 30, bottom: 130 }), 'Blocked.');
    await flushPromises(); // the measured second pass

    expect(document.getElementById(DISABLED_TOOLTIP_ID)!.style.maxHeight).toBe(`${768 - 16 - 134}px`);
    wrapper.unmount();
  });

  it('clamps against the right edge by its rendered width, so a short reason still sits over its control (#1454)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    const wrapper = mount(DisabledReasonTooltip);

    showDisabledReason(anchorAt({ top: 100, left: 960, width: 30, height: 30, bottom: 130 }), 'Blocked.');
    await nextTick(); // the provisional pass renders the box
    Object.defineProperty(document.getElementById(DISABLED_TOOLTIP_ID)!, 'offsetWidth', { value: 100, configurable: true });
    await flushPromises(); // the measured second pass

    expect(document.getElementById(DISABLED_TOOLTIP_ID)!.style.left).toBe(`${1000 - 100 - 8}px`);
    wrapper.unmount();
  });

  it('renders the reason as TEXT, never as markup', async () => {
    const wrapper = mount(DisabledReasonTooltip);
    const xss = '<img src=x onerror="window.__pwned = true">';

    showDisabledReason(anchorAt({ top: 10, left: 10, width: 50, height: 20, bottom: 30 }), xss);
    await nextTick();

    const tip = document.getElementById(DISABLED_TOOLTIP_ID)!;
    expect(tip.querySelector('img')).toBe(null);
    expect(tip.textContent).toContain(xss);
    wrapper.unmount();
  });

  it('disappears when the reason is cleared', async () => {
    const wrapper = mount(DisabledReasonTooltip);

    showDisabledReason(anchorAt({ top: 10, left: 10, width: 50, height: 20, bottom: 30 }), 'Blocked.');
    await nextTick();
    hideDisabledReason();
    await nextTick();

    expect(document.getElementById(DISABLED_TOOLTIP_ID)).toBe(null);
    wrapper.unmount();
  });

  // NOTE: `pointer-events: none` on the tooltip box (so it never swallows the
  // click of a control it opened over) is a scoped-CSS rule. jsdom does not
  // apply scoped stylesheets, so there is nothing honest to assert for it here
  // — it is covered by the browser check instead.
});

describe('computePopoverPosition', () => {
  const rect = (o: Partial<DOMRect>) => ({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}), ...o,
  }) as DOMRect;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  it('sits just below the trigger when there is room', () => {
    const p = computePopoverPosition(rect({ top: 100, bottom: 130, left: 200, width: 80 }), 60, 260);

    expect(p.top).toBe(134);
    expect(p.left).toBe(200);
    expect(p.caretSide).toBe('top');
  });

  it('flips above when the bottom edge would crowd the viewport', () => {
    const p = computePopoverPosition(rect({ top: 760, bottom: 790, left: 200, width: 80 }), 60, 260);

    expect(p.caretSide).toBe('bottom');
    expect(p.top).toBe(760 - 60 - 4);
  });

  it('never flips above the top of the viewport (#907)', () => {
    const p = computePopoverPosition(rect({ top: 650, bottom: 680, left: 200, width: 80 }), 640, 260);

    expect(p.caretSide).toBe('bottom');
    expect(p.top).toBe(8);
  });

  it('caps a popover that fits neither side to the room below when that is larger, and starts below the trigger (#1454)', () => {
    const p = computePopoverPosition(rect({ top: 30, bottom: 60, left: 200, width: 80 }), 900, 260);

    expect(p.caretSide).toBe('top');
    expect(p.top).toBe(64);
    expect(p.maxHeight).toBe(800 - 16 - 64);
  });

  it('caps a popover that fits neither side to the room above when that is larger, and ends above the trigger (#1454)', () => {
    const p = computePopoverPosition(rect({ top: 700, bottom: 730, left: 200, width: 80 }), 900, 260);

    expect(p.caretSide).toBe('bottom');
    expect(p.top).toBe(8);
    expect(p.maxHeight).toBe(700 - 4 - 8);
  });

  it('never covers its own trigger, whatever its height and wherever the trigger sits (#1454)', () => {
    for (let triggerTop = 0; triggerTop <= 770; triggerTop += 10) {
      for (let height = 10; height <= 1200; height += 10) {
        const p = computePopoverPosition(rect({ top: triggerTop, bottom: triggerTop + 30, left: 200, width: 80 }), height, 260);
        const bottom = p.top + Math.min(height, p.maxHeight);
        expect(bottom <= triggerTop || p.top >= triggerTop + 30, `trigger at ${triggerTop}, height ${height}`).toBe(true);
      }
    }
  });

  it('clamps against the right edge instead of overflowing', () => {
    const p = computePopoverPosition(rect({ top: 100, bottom: 130, left: 950, width: 40 }), 60, 260);

    expect(p.left).toBe(1000 - 260 - 8);
  });

  it('clamps against the left edge too', () => {
    const p = computePopoverPosition(rect({ top: 100, bottom: 130, left: -50, width: 40 }), 60, 260);

    expect(p.left).toBe(8);
  });

  it('keeps the caret pointing at the trigger after a right-edge clamp', () => {
    const p = computePopoverPosition(rect({ top: 100, bottom: 130, left: 950, width: 40 }), 60, 260);
    const triggerMid = 950 + 20;

    expect(p.left + p.caretLeft).toBeCloseTo(triggerMid, 0);
  });

  it('never lets the caret overhang the popover corners', () => {
    const p = computePopoverPosition(rect({ top: 100, bottom: 130, left: 0, width: 10 }), 60, DISABLED_TOOLTIP_MAX_WIDTH);

    expect(p.caretLeft).toBeGreaterThanOrEqual(12);
    expect(p.caretLeft).toBeLessThanOrEqual(DISABLED_TOOLTIP_MAX_WIDTH - 12);
  });
});
