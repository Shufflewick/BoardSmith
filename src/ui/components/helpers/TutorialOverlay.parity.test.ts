// @vitest-environment jsdom
/**
 * TutorialOverlay dual-path parity proof — criterion #3.
 *
 * Proves that the SAME step.content renders identically in BOTH UI paths:
 *
 *   • AutoUI renderer path: MinimalAutoUIRenderer uses useSelectable, which
 *     internally calls anchorAttrs — the EXACT shared path used by all 8
 *     built-in renderers (CardRenderer, PieceRenderer, HandRenderer, etc.).
 *
 *   • Custom-UI path: MinimalCustomUIRenderer uses anchorAttrs directly —
 *     the documented path for hand-rolled custom boards.
 *
 * Both paths route target resolution through the shared anchor layer.
 * TutorialOverlay never queries any renderer-specific attribute — parity is
 * structural (UI-SPEC §5).
 *
 * Non-vacuity machine-check: this file contains NO literal element-anchor
 * attribute strings (e.g. the prefix "data-bs-" + "el-" + key). All element
 * anchors flow exclusively from useSelectable or anchorAttrs (single source
 * in useBoardInteraction.ts). Enforce with:
 *   grep -c "data-bs-" + "el" TutorialOverlay.parity.test.ts   → must be 0
 * (Note: the grep pattern is split here so this comment itself is not a hit.)
 *
 * Structural parity machine-check: no annotation opt-in method is referenced.
 * Enforce with the grep documented in SUMMARY.md (name not repeated here).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, computed, h, nextTick, ref } from 'vue';
import TutorialOverlay from './TutorialOverlay.vue';
import {
  createBoardInteraction,
  provideBoardInteraction,
  anchorAttrs,
  tryUseBoardInteraction,
} from '../../composables/useBoardInteraction.js';
import { useSelectable } from '../../composables/useSelectable.js';
import type { ElementRef } from '../../composables/useBoardInteraction.js';
import type { Annotation } from '../../../engine/tutorial/types.js';

// ── jsdom stubs ───────────────────────────────────────────────────────────────

vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);

vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGameState(content: Annotation[]) {
  return ref({ state: { tutorial: { stepId: 'step1', content } } });
}

// ── MinimalAutoUIRenderer ─────────────────────────────────────────────────────
//
// Represents the SHARED SELECTABLE LAYER exercised by all 8 AutoUI built-in
// renderers. Calls useSelectable (which internally calls anchorAttrs) — the
// exact same path that CardRenderer, PieceRenderer, HandRenderer, GridBoard-
// Renderer, etc. all follow for element anchor emission.
//
// NO annotation-specific method is implemented here. The overlay resolves the
// target via the anchor that flows from useSelectable → anchorAttrs alone.
// No literal anchor attribute name appears in this file (non-vacuity contract).
const MinimalAutoUIRenderer = defineComponent({
  name: 'MinimalAutoUIRenderer',
  setup() {
    const boardInteraction = tryUseBoardInteraction();
    const identity = (): ElementRef => ({ notation: 'd4' });
    const isSelectable = computed(() => false);
    const isDisabled = computed(() => false);
    // useSelectable spreads anchorAttrs(identity()) into attrs internally —
    // the single source for all element anchor attribute names. No literal
    // anchor attribute key appears in this test file.
    const { attrs } = useSelectable(
      identity,
      boardInteraction ?? null,
      isSelectable,
      isDisabled,
    );
    return () => h('div', attrs.value);
  },
});

// ── MinimalCustomUIRenderer ───────────────────────────────────────────────────
//
// Represents a CUSTOM UI that uses anchorAttrs directly — the documented path
// for hand-rolled custom boards that want tutorial annotations for free.
// No useSelectable, no annotation-specific method. The element anchor flows
// from anchorAttrs: the same single source as the AutoUI path. No literal
// anchor attribute name appears in this file (non-vacuity contract).
const MinimalCustomUIRenderer = defineComponent({
  name: 'MinimalCustomUIRenderer',
  setup() {
    const identity: ElementRef = { notation: 'd4' };
    // anchorAttrs is the single source for element anchor attribute names.
    // Spreading the returned object onto the element root gives annotations
    // for free — no annotation-specific method required.
    const elementAnchorAttrs = anchorAttrs(identity);
    return () => h('div', elementAnchorAttrs);
  },
});

// ── Fixture builders ──────────────────────────────────────────────────────────

/**
 * Mount the AutoUI fixture — production-realistic topology (WR-02 fix):
 *
 *   [shell wrapper]
 *     [boardregion]                        ← .stage > .boardregion in GameShell
 *       MinimalAutoUIRenderer (useSelectable → shared anchor)
 *       TutorialOverlay
 *     <button data-bs-action="move">       ← .actionbar sibling OUTSIDE boardregion
 *
 * The action button is a SIBLING of .boardregion, mirroring the real ActionPanel
 * in .actionbar. This makes the "action target resolves" assertion a genuine
 * guard for BL-01: it fails when TutorialOverlay queries only inside .boardregion
 * and passes when it queries the whole document.
 */
function buildAutoUIWrapper(content: Annotation[]) {
  const gameState = makeGameState(content);
  const fixture = document.createElement('div');
  fixture.setAttribute('data-parity-fixture', 'autoui');
  document.body.appendChild(fixture);

  const WrapperComponent = defineComponent({
    name: 'AutoUIFixture',
    setup() {
      // Provide boardInteraction so MinimalAutoUIRenderer (and any real renderer
      // inside the fixture) can inject it via tryUseBoardInteraction.
      const boardInteraction = createBoardInteraction();
      provideBoardInteraction(boardInteraction);
      // Shell wrapper mirrors GameShell structure: boardregion + actionbar sibling.
      // Action anchor sits OUTSIDE boardregion (same topology as production).
      return () =>
        h('div', { class: 'shell-wrapper' }, [
          h('div', { class: 'boardregion', style: 'position:relative' }, [
            h(MinimalAutoUIRenderer),
            h(TutorialOverlay),
          ]),
          // Action anchor: outside boardregion — mirrors ActionPanel in .actionbar.
          // TutorialOverlay must query the whole document to resolve this.
          h('button', { 'data-bs-action': 'move' }, 'Move'),
        ]);
    },
  });

  const wrapper = mount(WrapperComponent, {
    global: {
      provide: { gameState },
      // Stub Teleport so overlay renders inline — keeps wrapper.find() assertions
      // working in jsdom without teleported-DOM access.
      stubs: { Teleport: true },
    },
    attachTo: fixture,
  });

  return { wrapper, fixture };
}

/**
 * Mount the Custom-UI fixture — production-realistic topology (WR-02 fix):
 *
 *   [shell wrapper]
 *     [boardregion]                        ← .stage > .boardregion in GameShell
 *       MinimalCustomUIRenderer (anchorAttrs directly → shared anchor)
 *       TutorialOverlay
 *     <button data-bs-action="move">       ← .actionbar sibling OUTSIDE boardregion
 *
 * No boardInteraction provided — custom UIs that use anchorAttrs directly do not
 * need boardInteraction to receive tutorial annotations ("for free" guarantee).
 * The action button is a sibling of .boardregion, mirroring production.
 */
function buildCustomUIWrapper(content: Annotation[]) {
  const gameState = makeGameState(content);
  const fixture = document.createElement('div');
  fixture.setAttribute('data-parity-fixture', 'custom');
  document.body.appendChild(fixture);

  const WrapperComponent = defineComponent({
    name: 'CustomUIFixture',
    setup() {
      // No provideBoardInteraction — custom UIs that use anchorAttrs directly
      // do not need boardInteraction to receive tutorial annotations. This is the
      // "for free" guarantee: use the shared anchor layer, get annotations automatically.
      // Shell wrapper mirrors GameShell structure: boardregion + actionbar sibling.
      return () =>
        h('div', { class: 'shell-wrapper' }, [
          h('div', { class: 'boardregion', style: 'position:relative' }, [
            h(MinimalCustomUIRenderer),
            h(TutorialOverlay),
          ]),
          // Action anchor: outside boardregion — mirrors ActionPanel in .actionbar.
          h('button', { 'data-bs-action': 'move' }, 'Move'),
        ]);
    },
  });

  const wrapper = mount(WrapperComponent, {
    global: {
      provide: { gameState },
      // Stub Teleport so overlay renders inline — keeps wrapper.find() assertions
      // working in jsdom without teleported-DOM access.
      stubs: { Teleport: true },
    },
    attachTo: fixture,
  });

  return { wrapper, fixture };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanupFixtures() {
  document
    .querySelectorAll('[data-parity-fixture]')
    .forEach((el) => el.parentNode?.removeChild(el));
  // Also sweep any residual .boardregion elements from other test helpers.
  document
    .querySelectorAll('.boardregion')
    .forEach((el) => el.parentNode?.removeChild(el));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TutorialOverlay — dual-path parity (criterion #3)', () => {
  beforeEach(cleanupFixtures);
  afterEach(cleanupFixtures);

  // ── Task 1: AutoUI renderer path ────────────────────────────────────────────

  describe(
    'AutoUI renderer path — anchor from useSelectable (shared by all 8 built-in renderers)',
    () => {
      it(
        'element target: resolves anchor from useSelectable → ring rendered + bubble "Move here"',
        async () => {
          const { wrapper } = buildAutoUIWrapper([
            { text: 'Move here', target: { kind: 'element', ref: { notation: 'd4' } } },
          ]);
          await nextTick();

          // The element anchor was emitted by useSelectable (→ anchorAttrs internally).
          // TutorialOverlay resolved it and rendered the ring — no renderer-specific
          // annotation method was involved.
          expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
          expect(wrapper.text()).toContain('Move here');
        },
      );

      it(
        'action target: resolves data-bs-action anchor → ring rendered + bubble text',
        async () => {
          const { wrapper } = buildAutoUIWrapper([
            { text: 'Click Move', target: { kind: 'action', actionName: 'move' } },
          ]);
          await nextTick();

          expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
          expect(wrapper.text()).toContain('Click Move');
        },
      );
    },
  );

  // ── Task 2: Custom-UI path ──────────────────────────────────────────────────

  describe(
    'Custom-UI path — anchor from anchorAttrs directly (no annotation-specific method)',
    () => {
      it(
        'element target: resolves anchor from anchorAttrs → ring rendered + bubble "Move here"',
        async () => {
          const { wrapper } = buildCustomUIWrapper([
            { text: 'Move here', target: { kind: 'element', ref: { notation: 'd4' } } },
          ]);
          await nextTick();

          // MinimalCustomUIRenderer used anchorAttrs directly — the same single source
          // as the AutoUI path. No annotation-specific method on the custom UI.
          expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
          expect(wrapper.text()).toContain('Move here');
        },
      );

      it(
        'action target: resolves data-bs-action anchor → ring rendered + bubble text',
        async () => {
          const { wrapper } = buildCustomUIWrapper([
            { text: 'Click Move', target: { kind: 'action', actionName: 'move' } },
          ]);
          await nextTick();

          expect(wrapper.find('.bsg-tutorial-ring').exists()).toBe(true);
          expect(wrapper.text()).toContain('Click Move');
        },
      );
    },
  );

  // ── Task 3: Cross-path equality — criterion #3 load-bearing assertion ────────

  describe(
    'Cross-path equality — same step.content → identical result in both paths',
    () => {
      it(
        'element target: AutoUI bubble text === Custom-UI bubble text for the same step',
        async () => {
          const CONTENT: Annotation[] = [
            { text: 'Move here', target: { kind: 'element', ref: { notation: 'd4' } } },
          ];

          const { wrapper: autoUI } = buildAutoUIWrapper(CONTENT);
          await nextTick();
          const { wrapper: customUI } = buildCustomUIWrapper(CONTENT);
          await nextTick();

          // Both paths resolve the element anchor and render a ring
          expect(autoUI.find('.bsg-tutorial-ring').exists()).toBe(true);
          expect(customUI.find('.bsg-tutorial-ring').exists()).toBe(true);

          // Cross-path bubble equality: same step.content → same bubble text
          const autoUIBubbles = autoUI.findAll('[role="status"]').map((w) => w.text());
          const customUIBubbles = customUI.findAll('[role="status"]').map((w) => w.text());
          expect(autoUIBubbles).toEqual(customUIBubbles);
          expect(autoUIBubbles[0]).toContain('Move here');
        },
      );

      it(
        'action target: AutoUI bubble text === Custom-UI bubble text for the same step',
        async () => {
          const CONTENT: Annotation[] = [
            { text: 'Click Move', target: { kind: 'action', actionName: 'move' } },
          ];

          const { wrapper: autoUI } = buildAutoUIWrapper(CONTENT);
          await nextTick();
          const { wrapper: customUI } = buildCustomUIWrapper(CONTENT);
          await nextTick();

          expect(autoUI.find('.bsg-tutorial-ring').exists()).toBe(true);
          expect(customUI.find('.bsg-tutorial-ring').exists()).toBe(true);

          const autoUIBubbles = autoUI.findAll('[role="status"]').map((w) => w.text());
          const customUIBubbles = customUI.findAll('[role="status"]').map((w) => w.text());
          expect(autoUIBubbles).toEqual(customUIBubbles);
          expect(autoUIBubbles[0]).toContain('Click Move');
        },
      );

      it(
        'BOTH element AND action targets: AutoUI === Custom-UI (criterion #2 × criterion #3)',
        async () => {
          // THE LOAD-BEARING CRITERION-#3 ASSERTION:
          // The same multi-annotation step.content renders identically in BOTH UI paths —
          // element target (via useSelectable → anchorAttrs) AND action target (via
          // data-bs-action) — because routing goes through the shared anchor layer alone,
          // not through any per-UI annotation method. This closes criterion #2 × #3.
          const CONTENT: Annotation[] = [
            { text: 'Move here', target: { kind: 'element', ref: { notation: 'd4' } } },
            { text: 'Click Move', target: { kind: 'action', actionName: 'move' } },
          ];

          const { wrapper: autoUI } = buildAutoUIWrapper(CONTENT);
          await nextTick();
          const { wrapper: customUI } = buildCustomUIWrapper(CONTENT);
          await nextTick();

          // Both paths resolve BOTH targets (element ring + action ring)
          expect(autoUI.findAll('.bsg-tutorial-ring')).toHaveLength(2);
          expect(customUI.findAll('.bsg-tutorial-ring')).toHaveLength(2);

          // THE EXPLICIT CROSS-PATH EQUALITY:
          // AutoUI bubble text === Custom-UI bubble text for the same step.content.
          // If routing were per-UI (opt-in), these would diverge. They don't.
          const autoUIBubbles = autoUI.findAll('[role="status"]').map((w) => w.text());
          const customUIBubbles = customUI.findAll('[role="status"]').map((w) => w.text());
          expect(autoUIBubbles).toEqual(customUIBubbles);

          // Both annotations present in both paths (element AND action)
          expect(autoUIBubbles.join(' ')).toContain('Move here');
          expect(autoUIBubbles.join(' ')).toContain('Click Move');
        },
      );
    },
  );
});
