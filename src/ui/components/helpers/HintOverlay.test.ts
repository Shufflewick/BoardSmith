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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import HintOverlay from './HintOverlay.vue';
import type { Annotation } from '../../../engine/tutorial/types.js';
import { GAME_CONTEXT_KEYS } from '../../composables/useGameContext.js';

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
      provide: { [GAME_CONTEXT_KEYS.gameState as symbol]: gameState },
      // Stub Teleport so overlay content renders inline for wrapper.find() assertions.
      stubs: { Teleport: true },
    },
    attachTo: fixture,
  });

  return { wrapper, fixture, gameState };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HintOverlay', () => {
  afterEach(() => {
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
          provide: { [GAME_CONTEXT_KEYS.gameState as symbol]: gameState },
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
        global: { provide: { [GAME_CONTEXT_KEYS.gameState as symbol]: gameState }, stubs: { Teleport: true } },
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
        global: { provide: { [GAME_CONTEXT_KEYS.gameState as symbol]: gameState }, stubs: { Teleport: true } },
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

describe('HintOverlay unmount (#749)', () => {
  it('removes the scroll listener from the region it added it to, even when that region no longer matches', async () => {
    const { wrapper, fixture } = mountOverlay(
      { text: 'Suggested move', target: { kind: 'element', ref: { id: 7 } } },
      '<div data-bs-el-id="7"></div>',
    );
    await nextTick();
    await nextTick();
    const removeSpy = vi.spyOn(fixture, 'removeEventListener');
    // The region stops matching `.boardregion` before unmount, so a re-query cannot find it.
    fixture.classList.remove('boardregion');
    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    fixture.remove();
  });
});

describe('HintOverlay placement (#927)', () => {
  // The layer is fixed to the screen, so scrollbars leave it 15px smaller each way than jsdom's 1024x768 window (#1300).
  const LAYER_WIDTH = 1009;
  const LAYER_HEIGHT = 753;

  /** The layer's own size; every other element reports none, so only a read of the layer can pass. */
  const layerOnly = (size: number) =>
    function (this: Element) {
      return this.classList.contains('bsg-annotation-layer') ? size : 0;
    };

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(layerOnly(LAYER_WIDTH));
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(layerOnly(LAYER_HEIGHT));
  });

  afterEach(() => {
    document.querySelectorAll('[data-test-fixture]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  /** Board at viewport (0,100), 400x400: top 100, bottom 500, centre y 300. With `board: false`, no board region. */
  function mountOnBoard(annotation: Annotation, extraHtml = '', targetRect?: DOMRect, board = true) {
    const fixture = document.createElement('div');
    fixture.dataset.testFixture = '';
    if (board) fixture.className = 'boardregion';
    fixture.innerHTML = extraHtml;
    document.body.appendChild(fixture);
    vi.spyOn(fixture, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 400));
    if (targetRect) vi.spyOn(fixture.querySelector('[data-bs-el-id]')!, 'getBoundingClientRect').mockReturnValue(targetRect);
    return mount(HintOverlay, {
      global: { provide: { [GAME_CONTEXT_KEYS.gameState as symbol]: makeGameState(annotation) }, stubs: { Teleport: true } },
      attachTo: fixture,
    });
  }

  function bubbleStyle(wrapper: ReturnType<typeof mount>) {
    return (wrapper.find('.bsg-board-message--annotation').element as HTMLElement).style;
  }

  const SHIFTED = 'translateX(var(--bsg-bubble-shift))';
  // The caret undoes the bubble's own shift, so it still points at the target, kept clear of the rounded corner.
  const CARET = 'clamp(12px, calc(-1 * var(--bsg-bubble-shift)), calc(100% - 12px))';

  it('centres an untargeted bubble on the board for placement="center"', async () => {
    const wrapper = mountOnBoard({ text: 'Think about it', placement: 'center' });
    await nextTick();
    expect(bubbleStyle(wrapper).top).toBe('300px');
    expect(bubbleStyle(wrapper).transform).toBe('translate(-50%, -50%)');
    wrapper.unmount();
  });

  it('centres a bubble with no board on the layer, not on a window that counts the scrollbar (#1300)', async () => {
    const wrapper = mountOnBoard({ text: 'Think about it', placement: 'center' }, '', undefined, false);
    await nextTick();
    expect(bubbleStyle(wrapper).left).toBe(`${LAYER_WIDTH / 2}px`);
    wrapper.unmount();
  });

  it('puts a targeted bubble at the top of the board for placement="top"', async () => {
    const wrapper = mountOnBoard(
      { text: 'Suggested move', target: { kind: 'element', ref: { id: 7 } }, placement: 'top' },
      '<div data-bs-el-id="7"></div>',
    );
    await nextTick();
    expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
    expect(bubbleStyle(wrapper).top).toBe('108px');
    wrapper.unmount();
  });

  it('keeps the left edge of a bubble next to a target at the left edge on screen (#907)', async () => {
    // Centre x = 10: half a 300px bubble centred there would start at -140.
    const wrapper = mountOnBoard(
      { text: 'Suggested move', target: { kind: 'element', ref: { id: 907 } } },
      '<div data-bs-el-id="907"></div>',
      new DOMRect(0, 120, 20, 20),
    );
    await nextTick();
    expect(bubbleStyle(wrapper).left).toBe('10px');
    expect(bubbleStyle(wrapper).transform).toBe(SHIFTED);
    // Shift left by half the bubble's width, but never past 8px from the layer's left edge.
    expect(bubbleStyle(wrapper).getPropertyValue('--bsg-bubble-shift')).toBe('max(-2px, min(-50%, calc(991px - 100%)))');
    expect(bubbleStyle(wrapper).getPropertyValue('--caret-left')).toBe(CARET);
    wrapper.unmount();
  });

  it('keeps the right edge of a bubble next to a target 8px inside the layer, clear of the scrollbar (#1180, #1300)', async () => {
    // Centre x = 999 leaves 2px of the 1009px layer for the bubble's right half.
    const wrapper = mountOnBoard(
      { text: 'Suggested move', target: { kind: 'element', ref: { id: 1180 } } },
      '<div data-bs-el-id="1180"></div>',
      new DOMRect(989, 120, 20, 20),
    );
    await nextTick();
    expect(bubbleStyle(wrapper).left).toBe('999px');
    expect(bubbleStyle(wrapper).transform).toBe(SHIFTED);
    // Shift left by half the bubble's width, or more, so its right edge stays 8px in.
    expect(bubbleStyle(wrapper).getPropertyValue('--bsg-bubble-shift')).toBe('max(-991px, min(-50%, calc(2px - 100%)))');
    expect(bubbleStyle(wrapper).getPropertyValue('--caret-left')).toBe(CARET);
    wrapper.unmount();
  });

  it('puts a bubble above a target when below it would run under a horizontal scrollbar the window counts (#1300)', async () => {
    // Below would end at 650 + 20 + 8 + 80 = 758: inside the 768px window, past the 753px layer.
    const wrapper = mountOnBoard(
      { text: 'Suggested move', target: { kind: 'element', ref: { id: 1300 } } },
      '<div data-bs-el-id="1300"></div>',
      new DOMRect(100, 650, 20, 20),
    );
    await nextTick();
    expect(wrapper.find('.bsg-board-message__caret--bottom').exists()).toBe(true);
    // The bubble's own height lifts it, so its caret's tip ends at the target's top edge whatever the text's length (#1331).
    expect(bubbleStyle(wrapper).top).toBe('642px');
    expect(bubbleStyle(wrapper).transform).toBe('translate(var(--bsg-bubble-shift), max(-100%, -642px))');
    wrapper.unmount();
  });

  it('keeps an untargeted bubble without placement below the board', async () => {
    const wrapper = mountOnBoard({ text: 'Suggested: c5 to a3' });
    await nextTick();
    expect(bubbleStyle(wrapper).top).toBe('508px');
    wrapper.unmount();
  });
});
