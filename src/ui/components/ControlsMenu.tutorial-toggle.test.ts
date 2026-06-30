// @vitest-environment jsdom
/**
 * ControlsMenu — Tutorial group toggle (R-02)
 *
 * Tests the isTutorialRunning prop:
 *   A. When isTutorialRunning is false (or absent), the button shows "Start tutorial"
 *      and emits 'start-tutorial'.
 *   B. When isTutorialRunning is true, the button shows "Exit tutorial"
 *      and emits 'exit-tutorial'.
 *
 * The popover is Teleported to <body>; assertions use document.body queries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ControlsMenu from './ControlsMenu.vue';

// jsdom lacks matchMedia
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})));

// jsdom lacks ResizeObserver
vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
})));

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(ControlsMenu, {
    props: {
      autoEndTurn: false,
      zoom: 1,
      canUndo: false,
      hasTutorial: true,
      ...props,
    },
    attachTo: document.body,
  });
}

/** Find the tutorial action button within the teleported popover. */
function findTutorialButton(): HTMLElement | undefined {
  const buttons = document.body.querySelectorAll<HTMLElement>('[role="menuitem"]');
  return Array.from(buttons).find(b => {
    const text = b.textContent?.trim() ?? '';
    return text === 'Start tutorial' || text === 'Exit tutorial';
  });
}

describe('ControlsMenu — Tutorial group toggle (R-02)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('A: shows "Start tutorial" and emits start-tutorial when isTutorialRunning is false', async () => {
    const wrapper = mountMenu({ isTutorialRunning: false });
    await wrapper.find('button.menubtn').trigger('click');

    const btn = findTutorialButton();
    expect(btn, 'Expected tutorial button to be present').toBeDefined();
    expect(btn!.textContent?.trim()).toBe('Start tutorial');

    btn!.click();
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('teaching-action') as string[][];
    expect(emitted).toBeDefined();
    expect(emitted.some(args => args[0] === 'start-tutorial')).toBe(true);
    wrapper.unmount();
  });

  it('B: shows "Exit tutorial" and emits exit-tutorial when isTutorialRunning is true', async () => {
    const wrapper = mountMenu({ isTutorialRunning: true });
    await wrapper.find('button.menubtn').trigger('click');

    const btn = findTutorialButton();
    expect(btn, 'Expected tutorial button to be present').toBeDefined();
    expect(btn!.textContent?.trim()).toBe('Exit tutorial');

    btn!.click();
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted('teaching-action') as string[][];
    expect(emitted).toBeDefined();
    expect(emitted.some(args => args[0] === 'exit-tutorial')).toBe(true);
    wrapper.unmount();
  });

  it('A-default: shows "Start tutorial" when isTutorialRunning is omitted', async () => {
    // isTutorialRunning defaults to undefined (falsy) — should behave like false.
    const wrapper = mountMenu(/* no isTutorialRunning */);
    await wrapper.find('button.menubtn').trigger('click');

    const btn = findTutorialButton();
    expect(btn, 'Expected tutorial button to be present').toBeDefined();
    expect(btn!.textContent?.trim()).toBe('Start tutorial');
    wrapper.unmount();
  });

  it('tutorial group is hidden when hasTutorial is false/absent', async () => {
    const wrapper = mountMenu({ hasTutorial: false });
    await wrapper.find('button.menubtn').trigger('click');

    const btn = findTutorialButton();
    expect(btn).toBeUndefined();
    wrapper.unmount();
  });
});

// ── Host teaching lockout: teachingDisabled prop (Phase 111, Plan 03) ─────────
//
// LOCK-01 criterion 2 — client-side gating:
//   When teachingDisabled is true, the Teaching group and Tutorial group do NOT
//   render, regardless of showHint and hasTutorial. Action help (Show action help
//   toggle) is NEVER gated — it explains the rules, not a good move (D-06).
//
// Parity note: ControlsMenu is shared by custom UI and AutoUI (both use the same
// component via GameShell). A single render assertion here covers BOTH UI modes.

describe('ControlsMenu — teachingDisabled lockout (Phase 111 LOCK-01)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** Find any Teaching group item (hint, demo, heatmap, tutorial) in document.body. */
  function findTeachingItems(): HTMLElement[] {
    const all = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'));
    const teachingLabels = ['Get a hint', 'Watch AI demo', 'Stop demo', 'Show move quality', 'Start tutorial', 'Exit tutorial'];
    return all.filter(el => {
      const text = el.textContent?.trim() ?? '';
      return teachingLabels.some(label => text.includes(label));
    });
  }

  /** Find the "Show action help" toggle (must remain unaffected by lockout). */
  function findActionHelpToggle(): Element | undefined {
    const buttons = document.body.querySelectorAll('[role="menuitemcheckbox"]');
    return Array.from(buttons).find(b => b.textContent?.includes('Show action help'));
  }

  it('LOCK-01-A: hides ALL four teaching affordances when teachingDisabled=true, even with showHint=true and hasTutorial=true', async () => {
    const wrapper = mountMenu({
      showHint: true,
      hasTutorial: true,
      teachingDisabled: true,
    });
    await wrapper.find('button.menubtn').trigger('click');

    const items = findTeachingItems();
    expect(items, 'No Teaching/Tutorial items should render when teachingDisabled=true').toHaveLength(0);
    wrapper.unmount();
  });

  it('LOCK-01-B: action help toggle (Show action help) still renders when teachingDisabled=true and hasActionHelp=true', async () => {
    // D-06: Action help is in the Play group (not Teaching) and is never gated by teachingDisabled.
    const wrapper = mountMenu({
      showHint: true,
      hasTutorial: true,
      teachingDisabled: true,
      hasActionHelp: true,
    });
    await wrapper.find('button.menubtn').trigger('click');

    const toggle = findActionHelpToggle();
    expect(toggle, 'Show action help toggle must be visible when teachingDisabled=true (D-06)').toBeDefined();
    wrapper.unmount();
  });

  it('LOCK-01-C: existing render is unchanged when teachingDisabled=false (default behavior)', async () => {
    // teachingDisabled=false must not suppress the Teaching group.
    const wrapper = mountMenu({
      showHint: true,
      hasTutorial: true,
      teachingDisabled: false,
    });
    await wrapper.find('button.menubtn').trigger('click');

    const items = findTeachingItems();
    // Expect Get a hint, Watch AI demo, Show move quality, Start tutorial
    expect(items.length, 'Teaching items should render when teachingDisabled=false').toBeGreaterThanOrEqual(4);
    wrapper.unmount();
  });

  it('LOCK-01-D: existing render is unchanged when teachingDisabled is absent (default behavior)', async () => {
    // Omitting teachingDisabled (defaults to false) must behave identically to false.
    const wrapper = mountMenu({
      showHint: true,
      hasTutorial: true,
      // teachingDisabled: absent — defaults to false
    });
    await wrapper.find('button.menubtn').trigger('click');

    const items = findTeachingItems();
    expect(items.length, 'Teaching items should render when teachingDisabled is omitted').toBeGreaterThanOrEqual(4);
    wrapper.unmount();
  });
});

// ── Heatmap toggle gating: heatmapSupported prop (gridless games) ──────────────
//
// The "Show move quality" heatmap paints a per-move score chip onto a distinct
// board cell. For gridless games (e.g. card games like Go Fish) every move
// anchors to the same rank group, so the chips collide and the overlay is
// misleading. GameShell computes heatmapSupported from the game's archetype
// ($layout grid/hex-grid → grid-board) and hides the toggle when false.
//
// Only the heatmap toggle is gated — Get a hint and Watch AI demo still render,
// since they remain meaningful for gridless games (hint highlights the rank to
// ask; demo narrates AI play).

describe('ControlsMenu — heatmap toggle gating (heatmapSupported)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** Find the "Show move quality" heatmap toggle within the teleported popover. */
  function findHeatmapToggle(): Element | undefined {
    const buttons = document.body.querySelectorAll('[role="menuitemcheckbox"]');
    return Array.from(buttons).find(b => b.textContent?.includes('Show move quality'));
  }

  /** Find a Teaching menuitem by visible label. */
  function findTeachingItem(label: string): Element | undefined {
    const all = document.body.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]');
    return Array.from(all).find(el => el.textContent?.includes(label));
  }

  it('shows the heatmap toggle when heatmapSupported=true (spatial board)', async () => {
    const wrapper = mountMenu({ showHint: true, heatmapSupported: true });
    await wrapper.find('button.menubtn').trigger('click');

    expect(findHeatmapToggle(), 'Show move quality must render for grid/hex games').toBeDefined();
    wrapper.unmount();
  });

  it('shows the heatmap toggle when heatmapSupported is omitted (defaults to true)', async () => {
    const wrapper = mountMenu({ showHint: true /* heatmapSupported absent → default true */ });
    await wrapper.find('button.menubtn').trigger('click');

    expect(findHeatmapToggle(), 'Show move quality must default to visible').toBeDefined();
    wrapper.unmount();
  });

  it('hides ONLY the heatmap toggle when heatmapSupported=false (gridless game)', async () => {
    const wrapper = mountMenu({ showHint: true, heatmapSupported: false });
    await wrapper.find('button.menubtn').trigger('click');

    // Heatmap toggle gone…
    expect(findHeatmapToggle(), 'Show move quality must hide for gridless games').toBeUndefined();
    // …but the other AI aids remain (only the heatmap is gated).
    expect(findTeachingItem('Get a hint'), 'Get a hint stays available for gridless games').toBeDefined();
    expect(findTeachingItem('Watch AI demo'), 'Watch AI demo stays available for gridless games').toBeDefined();
    wrapper.unmount();
  });
});
