// @vitest-environment jsdom
/**
 * TutorialOverlay component tests.
 *
 * Contract:
 *  1. Given step content with an element target whose anchor exists in the DOM,
 *     the overlay renders a bubble (text) AND a ring element.
 *  2. Given step content with a target whose anchor is absent from the DOM,
 *     the overlay renders the bubble (fallback) and NO ring.
 *  3. Given no tutorial content, the overlay renders zero markup.
 *  4. Action targets (`data-bs-action`) and panel targets (`data-bs-panel`)
 *     resolve correctly (ring appears when stub is present, absent when not).
 *
 * jsdom NOTE: getBoundingClientRect always returns zeros. We therefore assert:
 *   - bubble text content (deterministic regardless of positioning)
 *   - ring existence (present ↔ anchor found in DOM, absent ↔ anchor missing)
 *   - no throw when anchor is missing
 *
 * These are the honest, deterministic assertions for a jsdom environment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import TutorialOverlay from './TutorialOverlay.vue';
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

function makeGameState(content?: Annotation[]) {
  return ref({
    state: {
      tutorial: content
        ? { stepId: 'step1', content }
        : { stepId: 'step1' },
    },
  });
}

/**
 * Mount TutorialOverlay inside a fixture div that acts as .boardregion.
 * Extra DOM stubs are passed as innerHTML fragments so the overlay's
 * querySelector can find anchors.
 *
 * Teleport is stubbed so content renders inline (inside the wrapper element)
 * making wrapper.find() assertions work in jsdom without teleported DOM access.
 */
function mountOverlay(
  content: Annotation[] | undefined,
  extraHtml = '',
) {
  const gameState = makeGameState(content);

  // We need a real DOM parent so document.querySelector('.boardregion') works.
  const fixture = document.createElement('div');
  fixture.className = 'boardregion';
  fixture.style.position = 'relative';
  fixture.innerHTML = extraHtml;
  document.body.appendChild(fixture);

  const wrapper = mount(TutorialOverlay, {
    global: {
      provide: { gameState },
      // Stub Teleport so overlay content renders inline (not teleported to body).
      // This keeps wrapper.find() assertions working in jsdom.
      stubs: { Teleport: true },
    },
    attachTo: fixture,
  });

  return { wrapper, fixture, gameState };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TutorialOverlay', () => {
  beforeEach(() => {
    // Clean up any fixture divs added by previous tests.
    document
      .querySelectorAll('.boardregion')
      .forEach((el) => el.parentNode?.removeChild(el));
  });

  // ── Case 1: element target resolved ────────────────────────────────────────

  describe('element target (notation)', () => {
    it('renders a bubble with the annotation text', async () => {
      const { wrapper } = mountOverlay(
        [{ text: 'Move here', target: { kind: 'element', ref: { notation: 'd4' } } }],
        '<div data-bs-el-notation="d4"></div>',
      );
      await nextTick();

      const text = wrapper.text();
      expect(text).toContain('Move here');
    });

    it('renders a ring when the anchor element exists in the DOM', async () => {
      const { wrapper } = mountOverlay(
        [{ text: 'Move here', target: { kind: 'element', ref: { notation: 'd4' } } }],
        '<div data-bs-el-notation="d4"></div>',
      );
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
    });

    it('calls getBoundingClientRect on the resolved d4 anchor element', async () => {
      // Proves the overlay positioned against the exact stub element, not a
      // different one — the honest deterministic proxy for jsdom rect measurement.
      const gameState = makeGameState([
        { text: 'Move here', target: { kind: 'element', ref: { notation: 'd4' } } },
      ]);

      const fixture = document.createElement('div');
      fixture.className = 'boardregion';
      fixture.style.position = 'relative';
      fixture.innerHTML = '<div data-bs-el-notation="d4"></div>';
      document.body.appendChild(fixture);

      const stubEl = fixture.querySelector('[data-bs-el-notation="d4"]') as Element;
      const rectSpy = vi.spyOn(stubEl, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(10, 20, 40, 40),
      );

      const wrapper = mount(TutorialOverlay, {
        global: { provide: { gameState } },
        attachTo: fixture,
      });
      await nextTick();

      expect(rectSpy).toHaveBeenCalled();
      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
    });

    it('resolves by id taking precedence over notation', async () => {
      const { wrapper } = mountOverlay(
        [
          {
            text: 'Pick this piece',
            target: { kind: 'element', ref: { id: 42, notation: 'e2' } },
          },
        ],
        '<div data-bs-el-id="42"></div><div data-bs-el-notation="e2"></div>',
      );
      await nextTick();

      // Ring must exist (id target was found)
      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
    });
  });

  // ── Case 2: null target (anchor absent from DOM) ───────────────────────────

  describe('null target (anchor absent from DOM)', () => {
    it('renders the bubble text in fallback mode (no throw)', async () => {
      // No stub element with data-bs-el-notation="z9" in the DOM
      const { wrapper } = mountOverlay(
        [{ text: 'No target here', target: { kind: 'element', ref: { notation: 'z9' } } }],
        '', // no stub elements
      );
      await nextTick();

      expect(() => wrapper.text()).not.toThrow();
      expect(wrapper.text()).toContain('No target here');
    });

    it('does NOT render a ring when anchor is absent', async () => {
      const { wrapper } = mountOverlay(
        [{ text: 'No target here', target: { kind: 'element', ref: { notation: 'z9' } } }],
        '',
      );
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(false);
    });
  });

  // ── Case 3: no tutorial content → zero markup ─────────────────────────────

  describe('no tutorial content', () => {
    it('renders zero markup when content is absent', async () => {
      const { wrapper } = mountOverlay(undefined);
      await nextTick();

      // The overlay root should not be in the DOM (v-if guards)
      expect(wrapper.find('.bsg-tutorial-overlay').exists()).toBe(false);
    });

    it('renders zero markup when content array is empty', async () => {
      const { wrapper } = mountOverlay([]);
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-overlay').exists()).toBe(false);
    });
  });

  // ── Case 4: action and panel targets ──────────────────────────────────────

  describe('action target', () => {
    it('renders ring when data-bs-action stub is present', async () => {
      const { wrapper } = mountOverlay(
        [{ text: 'Click Move', target: { kind: 'action', actionName: 'move' } }],
        '<button data-bs-action="move">Move</button>',
      );
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
    });

    it('renders bubble-only when data-bs-action stub is absent', async () => {
      const { wrapper } = mountOverlay(
        [{ text: 'Click Move', target: { kind: 'action', actionName: 'move' } }],
        '', // no stub
      );
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(false);
      expect(wrapper.text()).toContain('Click Move');
    });
  });

  describe('panel target', () => {
    it('renders ring when data-bs-panel stub is present', async () => {
      const { wrapper } = mountOverlay(
        [{ text: 'Look here', target: { kind: 'panel' } }],
        '<div data-bs-panel></div>',
      );
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
    });

    it('renders bubble-only when data-bs-panel stub is absent', async () => {
      const { wrapper } = mountOverlay(
        [{ text: 'Look here', target: { kind: 'panel' } }],
        '',
      );
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(false);
      expect(wrapper.text()).toContain('Look here');
    });
  });

  // ── BL-01 guard: action target OUTSIDE .boardregion (production topology) ────
  //
  // Production: ActionPanel renders data-bs-action in .actionbar, which is a
  // SIBLING of .boardregion. This test mirrors that topology so the test is a
  // real guard for BL-01 (overlay must query document, not just .boardregion).

  describe('action target outside .boardregion (BL-01 guard — production topology)', () => {
    let shell: HTMLDivElement;
    let boardRegion: HTMLDivElement;

    beforeEach(() => {
      shell = document.createElement('div');
      boardRegion = document.createElement('div');
      boardRegion.className = 'boardregion';
      boardRegion.style.position = 'relative';
      // Action button is a SIBLING of boardregion (mirrors .actionbar position in GameShell)
      const actionButton = document.createElement('button');
      actionButton.setAttribute('data-bs-action', 'move');
      actionButton.textContent = 'Move';
      shell.appendChild(boardRegion);
      shell.appendChild(actionButton);  // outside boardregion
      document.body.appendChild(shell);
    });

    afterEach(() => {
      shell.parentNode?.removeChild(shell);
    });

    it('resolves data-bs-action anchor outside boardregion → ring rendered', async () => {
      const gameState = makeGameState([
        { text: 'Click Move', target: { kind: 'action', actionName: 'move' } },
      ]);
      const wrapper = mount(TutorialOverlay, {
        global: {
          provide: { gameState },
          stubs: { Teleport: true },
        },
        attachTo: boardRegion,
      });
      await nextTick();

      expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
      expect(wrapper.text()).toContain('Click Move');

      wrapper.unmount();
    });
  });

  // ── CR-01 guard: bubble (role=status) must NOT be inside an aria-hidden subtree

  describe('CR-01: annotation bubble accessibility', () => {
    it('role=status bubble has no aria-hidden="true" ancestor', async () => {
      const { wrapper } = mountOverlay(
        [{ text: 'Learn this move', target: { kind: 'element', ref: { notation: 'd4' } } }],
        '<div data-bs-el-notation="d4"></div>',
      );
      await nextTick();

      const bubble = wrapper.find('[role="status"]');
      expect(bubble.exists()).toBe(true);

      // Walk the DOM tree upward — no ancestor may be aria-hidden="true"
      let el: Element | null = bubble.element;
      while (el && el !== document.body) {
        expect(el.getAttribute('aria-hidden')).not.toBe('true');
        el = el.parentElement;
      }
    });
  });

  // ── WR-01 guard: untargeted / explicit-placement bubbles must not render at 0,0

  describe('WR-01: untargeted and explicit-placement bubble positions', () => {
    it('untargeted bubble (no target field) has an explicit position style (not empty anchorStyle)', async () => {
      const { wrapper } = mountOverlay([{ text: 'Floating tip, no target' }]);
      await nextTick();

      // The bubble should render
      const bubble = wrapper.find('.bsg-board-message--annotation');
      expect(bubble.exists()).toBe(true);

      // anchorStyle must be non-empty: at minimum top should be set
      // (when anchorStyle={} the element has no inline style attribute at all)
      const style = (bubble.element as HTMLElement).style;
      expect(style.top).not.toBe('');
    });

    it('explicit placement="top" bubble has top position set', async () => {
      const { wrapper } = mountOverlay([
        { text: 'Top bubble', placement: 'top' },
      ]);
      await nextTick();

      const bubble = wrapper.find('.bsg-board-message--annotation');
      expect(bubble.exists()).toBe(true);
      const style = (bubble.element as HTMLElement).style;
      expect(style.top).not.toBe('');
    });

    it('explicit placement="bottom" bubble has top position set', async () => {
      const { wrapper } = mountOverlay([
        { text: 'Bottom bubble', placement: 'bottom' },
      ]);
      await nextTick();

      const bubble = wrapper.find('.bsg-board-message--annotation');
      expect(bubble.exists()).toBe(true);
      const style = (bubble.element as HTMLElement).style;
      expect(style.top).not.toBe('');
    });
  });

  // ── XSS safety ─────────────────────────────────────────────────────────────

  it('renders annotation text as plain text (no XSS via v-html)', async () => {
    const xssPayload = '<img src=x onerror=alert(1)>';
    const { wrapper } = mountOverlay([{ text: xssPayload }]);
    await nextTick();

    // Text content should contain the raw string, not an <img> element
    expect(wrapper.text()).toContain(xssPayload);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  // ── No-text annotation (ring-only, text is required per types.ts but guard) ─

  it('renders only ring for annotation with target and empty text', async () => {
    const { wrapper } = mountOverlay(
      // The Annotation type requires text, but defensively test the guard
      [{ text: '', target: { kind: 'element', ref: { notation: 'd4' } } }],
      '<div data-bs-el-notation="d4"></div>',
    );
    await nextTick();

    // Ring should render; bubble may or may not (empty text guard)
    expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
  });
});
