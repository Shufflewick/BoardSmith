// @vitest-environment jsdom
/**
 * HintOverlay component tests.
 *
 * Contract:
 *  1. When `state.hint.annotation` targets a `data-bs-el-id` anchor present in
 *     the DOM, the ring renders and resolves the element.
 *  2. When the hint is absent (`state.hint = undefined`), the overlay renders
 *     nothing (v-if guards).
 *  3. Parity: the same `data-bs-el-id` anchor resolves identically whether the
 *     surrounding markup resembles a custom-UI board element or an AutoUI grid
 *     cell — parity is structural (shared anchor attribute, not renderer shape).
 *
 * jsdom NOTE: getBoundingClientRect always returns zeros. Assertions use:
 *   - bubble text presence (deterministic regardless of positioning)
 *   - ring existence (present ↔ anchor found in DOM, absent ↔ anchor missing)
 *   - no throw when anchor is missing
 *
 * These are the honest, deterministic assertions for a jsdom environment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import HintOverlay from './HintOverlay.vue';
import type { Annotation } from '../../../engine/tutorial/types.js';

// jsdom lacks matchMedia; modules that read it at import time would throw.
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

function makeGameState(annotation?: Annotation) {
  return ref({
    state: {
      hint: annotation ? { annotation } : undefined,
    },
  });
}

/**
 * Mount HintOverlay inside a fixture div that acts as .boardregion.
 * Extra DOM stubs are passed as innerHTML fragments so the overlay's
 * querySelector can find anchors.
 */
function mountOverlay(
  annotation: Annotation | undefined,
  extraHtml = '',
) {
  const gameState = makeGameState(annotation);

  const fixture = document.createElement('div');
  fixture.className = 'boardregion';
  fixture.style.position = 'relative';
  fixture.innerHTML = extraHtml;
  document.body.appendChild(fixture);

  const wrapper = mount(HintOverlay, {
    global: {
      provide: { gameState },
      // Stub Teleport so overlay content renders inline for wrapper.find() assertions.
      stubs: { Teleport: true },
    },
    attachTo: fixture,
  });

  return { wrapper, fixture, gameState };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HintOverlay', () => {
  beforeEach(() => {
    document
      .querySelectorAll('.boardregion')
      .forEach((el) => el.parentNode?.removeChild(el));
  });

  // ── Case 1: annotation with data-bs-el-id target ──────────────────────────

  describe('element target (id)', () => {
    it('renders a ring when the data-bs-el-id anchor exists in the DOM', async () => {
      const { wrapper } = mountOverlay(
        { text: 'Suggested move', target: { kind: 'element', ref: { id: 7 } } },
        '<div data-bs-el-id="7"></div>',
      );
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
    });

    it('renders the bubble text', async () => {
      const { wrapper } = mountOverlay(
        { text: 'Suggested move', target: { kind: 'element', ref: { id: 7 } } },
        '<div data-bs-el-id="7"></div>',
      );
      await nextTick();

      expect(wrapper.text()).toContain('Suggested move');
    });

    it('calls getBoundingClientRect on the resolved anchor element', async () => {
      const gameState = makeGameState({
        text: 'Suggested move',
        target: { kind: 'element', ref: { id: 42 } },
      });

      const fixture = document.createElement('div');
      fixture.className = 'boardregion';
      fixture.style.position = 'relative';
      fixture.innerHTML = '<div data-bs-el-id="42"></div>';
      document.body.appendChild(fixture);

      const stubEl = fixture.querySelector('[data-bs-el-id="42"]') as Element;
      const rectSpy = vi.spyOn(stubEl, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(10, 20, 40, 40),
      );

      const wrapper = mount(HintOverlay, {
        global: {
          provide: { gameState },
          stubs: { Teleport: true },
        },
        attachTo: fixture,
      });
      await nextTick();

      expect(rectSpy).toHaveBeenCalled();
      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);

      wrapper.unmount();
    });
  });

  // ── Case 2: no hint → zero markup ─────────────────────────────────────────

  describe('no hint', () => {
    it('renders zero markup when hint is undefined', async () => {
      const { wrapper } = mountOverlay(undefined, '');
      await nextTick();

      expect(wrapper.find('.bsg-hint-overlay').exists()).toBe(false);
    });
  });

  // ── Case 3: target absent from DOM → bubble-only, no ring ────────────────

  describe('target anchor absent from DOM', () => {
    it('renders bubble text without a ring when anchor is missing', async () => {
      const { wrapper } = mountOverlay(
        { text: 'Suggested move', target: { kind: 'element', ref: { id: 99 } } },
        '', // no anchor in DOM
      );
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(false);
      expect(wrapper.text()).toContain('Suggested move');
    });
  });

  // ── Case 4: parity assertion ──────────────────────────────────────────────
  //
  // Both a custom-UI-like fixture (e.g. a <div class="board-cell">) and an
  // AutoUI-grid-like fixture (e.g. a <td class="grid-cell">) carry the SAME
  // `data-bs-el-id` attribute. The overlay resolves both identically because
  // buildSelector targets the attribute, not the surrounding structure.

  describe('parity: same data-bs-el-id in custom-UI-like vs AutoUI-grid-like fixture', () => {
    it('resolves data-bs-el-id in a custom-UI-like board element fixture', async () => {
      // Custom-UI-like: board piece inside a named board wrapper
      const gameState = makeGameState({
        text: 'Suggested move',
        target: { kind: 'element', ref: { id: 11 } },
      });
      const fixture = document.createElement('div');
      fixture.className = 'boardregion';
      fixture.innerHTML = `
        <div class="custom-board">
          <div class="board-piece" data-bs-el-id="11">Piece</div>
        </div>
      `;
      document.body.appendChild(fixture);

      const wrapper = mount(HintOverlay, {
        global: { provide: { gameState }, stubs: { Teleport: true } },
        attachTo: fixture,
      });
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
      wrapper.unmount();
    });

    it('resolves the SAME data-bs-el-id in an AutoUI-grid-like fixture', async () => {
      // AutoUI-grid-like: table cell inside a rendered grid
      const gameState = makeGameState({
        text: 'Suggested move',
        target: { kind: 'element', ref: { id: 11 } },
      });
      const fixture = document.createElement('div');
      fixture.className = 'boardregion';
      fixture.innerHTML = `
        <table class="auto-grid">
          <tbody>
            <tr><td class="auto-cell" data-bs-el-id="11">Cell</td></tr>
          </tbody>
        </table>
      `;
      document.body.appendChild(fixture);

      const wrapper = mount(HintOverlay, {
        global: { provide: { gameState }, stubs: { Teleport: true } },
        attachTo: fixture,
      });
      await nextTick();

      // Same anchor attribute → ring must render regardless of surrounding markup
      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  // ── XSS safety ─────────────────────────────────────────────────────────────

  it('renders hint text as plain text (no XSS via v-html)', async () => {
    const xssPayload = '<img src=x onerror=alert(1)>';
    const { wrapper } = mountOverlay({ text: xssPayload });
    await nextTick();

    expect(wrapper.text()).toContain(xssPayload);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  // ── Accessibility: no aria-hidden on bubble ancestor ─────────────────────

  it('role=status bubble has no aria-hidden="true" ancestor', async () => {
    const { wrapper } = mountOverlay(
      { text: 'Suggested move', target: { kind: 'element', ref: { id: 5 } } },
      '<div data-bs-el-id="5"></div>',
    );
    await nextTick();

    const bubble = wrapper.find('[role="status"]');
    expect(bubble.exists()).toBe(true);

    let el: Element | null = bubble.element;
    while (el && el !== document.body) {
      expect(el.getAttribute('aria-hidden')).not.toBe('true');
      el = el.parentElement;
    }
  });
});
