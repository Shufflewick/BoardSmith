// @vitest-environment jsdom
/**
 * HeatmapOverlay component tests.
 *
 * Contract:
 *  1. When `state.heatmap.visible === true` and entries are provided, chips
 *     render for each entry.
 *  2. When `state.heatmap.visible === false`, no chips render.
 *  3. When `state.heatmap.entries === []` (with visible true), no chips render.
 *  4. The `isBest` entry carries a class/attribute that distinguishes it from
 *     non-best entries (2px solid border class — best-move non-color cue).
 *  5. Each chip's text content includes a "%" badge (non-color cue).
 *  6. Parity: the same `data-bs-el-id` anchor resolves identically in a
 *     custom-UI-like board element and an AutoUI-grid-like element fixture.
 *
 * jsdom NOTE: getBoundingClientRect returns zeros. Assertions use chip count
 * and text content rather than positions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import HeatmapOverlay from './HeatmapOverlay.vue';
import type { HeatmapEntry } from '../../../session/types.js';

// jsdom lacks matchMedia
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

// jsdom lacks ResizeObserver
vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

// ── helpers ──────────────────────────────────────────────────────────────────

function makeGameState(entries: HeatmapEntry[], visible = true) {
  return ref({
    state: {
      heatmap: { visible, entries },
    },
  });
}

/**
 * Build HeatmapEntry objects with a `data-bs-el-id` cell ref.
 */
function makeEntry(id: number, normalizedValue: number, isBest = false): HeatmapEntry {
  return { cellRef: { id }, normalizedValue, isBest };
}

/**
 * Mount HeatmapOverlay with a .boardregion fixture containing the stub cells.
 */
function mountOverlay(
  entries: HeatmapEntry[],
  visible: boolean,
  extraHtml: string,
) {
  const gameState = makeGameState(entries, visible);

  const fixture = document.createElement('div');
  fixture.className = 'boardregion';
  fixture.style.position = 'relative';
  fixture.innerHTML = extraHtml;
  document.body.appendChild(fixture);

  const wrapper = mount(HeatmapOverlay, {
    global: {
      provide: { gameState },
      // Stub Teleport so chips render inline for wrapper.findAll() assertions.
      stubs: { Teleport: true },
    },
    attachTo: fixture,
  });

  return { wrapper, fixture, gameState };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HeatmapOverlay', () => {
  beforeEach(() => {
    document
      .querySelectorAll('.boardregion')
      .forEach((el) => el.parentNode?.removeChild(el));
  });

  // ── Case 1: chips render when visible + entries ───────────────────────────

  describe('visible with entries', () => {
    it('renders a chip for each entry when visible:true', async () => {
      const entries = [
        makeEntry(1, 0.7, true),
        makeEntry(2, 0.3),
        makeEntry(3, 0.5),
      ];
      const { wrapper } = mountOverlay(
        entries,
        true,
        `<div data-bs-el-id="1"></div>
         <div data-bs-el-id="2"></div>
         <div data-bs-el-id="3"></div>`,
      );
      await nextTick();

      // One chip per entry (chips are the direct children of .bsg-heatmap-overlay)
      const overlay = wrapper.find('.bsg-heatmap-overlay');
      expect(overlay.exists()).toBe(true);
      const chips = overlay.findAll('div');
      expect(chips.length).toBe(3);
    });

    it('each chip text contains a "%" badge', async () => {
      const entries = [makeEntry(1, 0.73, true), makeEntry(2, 0.45)];
      const { wrapper } = mountOverlay(
        entries,
        true,
        '<div data-bs-el-id="1"></div><div data-bs-el-id="2"></div>',
      );
      await nextTick();

      const overlay = wrapper.find('.bsg-heatmap-overlay');
      const chips = overlay.findAll('div');
      for (const chip of chips) {
        expect(chip.text()).toMatch(/%/);
      }
    });

    it('chip badge text equals round(value×100) + "%"', async () => {
      const { wrapper } = mountOverlay(
        [makeEntry(10, 0.73)],
        true,
        '<div data-bs-el-id="10"></div>',
      );
      await nextTick();

      const overlay = wrapper.find('.bsg-heatmap-overlay');
      const chips = overlay.findAll('div');
      expect(chips[0].text()).toBe('73%');
    });
  });

  // ── Case 2: no chips when visible:false ───────────────────────────────────

  describe('not visible', () => {
    it('renders zero chips when visible:false', async () => {
      const { wrapper } = mountOverlay(
        [makeEntry(1, 0.7, true)],
        false,
        '<div data-bs-el-id="1"></div>',
      );
      await nextTick();

      expect(wrapper.find('.bsg-heatmap-overlay').exists()).toBe(false);
    });
  });

  // ── Case 3: no chips when entries is empty ────────────────────────────────

  describe('empty entries', () => {
    it('renders zero chips when entries array is empty', async () => {
      const { wrapper } = mountOverlay([], true, '');
      await nextTick();

      expect(wrapper.find('.bsg-heatmap-overlay').exists()).toBe(false);
    });
  });

  // ── Case 4: isBest chip has the 2px solid border (non-color cue) ─────────
  //
  // We verify by checking the inline style for 'border' containing 'solid'.
  // The non-best entries get a 1px border; the best entry gets 2px solid.

  describe('isBest chip visual cue', () => {
    it('isBest chip inline border is "2px solid ..." (non-color shape cue)', async () => {
      const entries = [
        makeEntry(20, 0.9, true),   // best
        makeEntry(21, 0.4, false),  // not best
      ];
      const { wrapper } = mountOverlay(
        entries,
        true,
        '<div data-bs-el-id="20"></div><div data-bs-el-id="21"></div>',
      );
      await nextTick();

      const overlay = wrapper.find('.bsg-heatmap-overlay');
      const chips = overlay.findAll('div');
      expect(chips.length).toBe(2);

      // Find the best chip (value 0.9 → badge "90%") and non-best (0.4 → "40%")
      const bestChip = chips.find(c => c.text() === '90%')!;
      const nonBestChip = chips.find(c => c.text() === '40%')!;

      expect(bestChip).toBeDefined();
      expect(nonBestChip).toBeDefined();

      const bestStyle = (bestChip.element as HTMLElement).style.border;
      const nonBestStyle = (nonBestChip.element as HTMLElement).style.border;

      // Best chip must have "2px solid" border; non-best must NOT
      expect(bestStyle).toContain('2px solid');
      expect(nonBestStyle).not.toContain('2px solid');
    });
  });

  // ── Case 5: chips are aria-hidden ─────────────────────────────────────────

  describe('accessibility', () => {
    it('all chips carry aria-hidden="true" (decorative layer)', async () => {
      const entries = [makeEntry(30, 0.6), makeEntry(31, 0.3)];
      const { wrapper } = mountOverlay(
        entries,
        true,
        '<div data-bs-el-id="30"></div><div data-bs-el-id="31"></div>',
      );
      await nextTick();

      const overlay = wrapper.find('.bsg-heatmap-overlay');
      const chips = overlay.findAll('[aria-hidden="true"]');
      expect(chips.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Case 6: parity — same data-bs-el-id resolves across fixture types ─────
  //
  // Mirrors the TutorialOverlay dual-path parity test. The SAME data-bs-el-id
  // value must yield a chip whether the cell lives inside a custom-UI-like
  // board or an AutoUI grid table cell.

  describe('parity: custom-UI-like vs AutoUI-grid-like fixture', () => {
    it('renders a chip in a custom-UI-like board element fixture', async () => {
      const gameState = makeGameState([makeEntry(50, 0.5)], true);
      const fixture = document.createElement('div');
      fixture.className = 'boardregion';
      fixture.innerHTML = `
        <div class="custom-board">
          <div class="board-square" data-bs-el-id="50">Square</div>
        </div>
      `;
      document.body.appendChild(fixture);

      const wrapper = mount(HeatmapOverlay, {
        global: { provide: { gameState }, stubs: { Teleport: true } },
        attachTo: fixture,
      });
      await nextTick();

      const chips = wrapper.find('.bsg-heatmap-overlay').findAll('div');
      expect(chips.length).toBe(1);
      expect(chips[0].text()).toBe('50%');
      wrapper.unmount();
    });

    it('renders a chip for the SAME data-bs-el-id in an AutoUI-grid-like fixture', async () => {
      const gameState = makeGameState([makeEntry(50, 0.5)], true);
      const fixture = document.createElement('div');
      fixture.className = 'boardregion';
      fixture.innerHTML = `
        <table class="auto-grid">
          <tbody>
            <tr><td class="auto-cell" data-bs-el-id="50">Cell</td></tr>
          </tbody>
        </table>
      `;
      document.body.appendChild(fixture);

      const wrapper = mount(HeatmapOverlay, {
        global: { provide: { gameState }, stubs: { Teleport: true } },
        attachTo: fixture,
      });
      await nextTick();

      // Same id=50 anchor → same chip count and same badge text
      const chips = wrapper.find('.bsg-heatmap-overlay').findAll('div');
      expect(chips.length).toBe(1);
      expect(chips[0].text()).toBe('50%');
      wrapper.unmount();
    });
  });
});
