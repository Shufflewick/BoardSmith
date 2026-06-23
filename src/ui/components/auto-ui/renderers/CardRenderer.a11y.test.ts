// @vitest-environment jsdom
/**
 * Renderer a11y tests — A11Y-01 keyboard + A11Y-04 semantic state
 *
 * Covers CardRenderer, PieceRenderer, DeckRenderer.
 * Each renderer case asserts:
 *   - selectable root has role="button" and tabindex="0"
 *   - keydown Enter fires exactly one boardInteraction.triggerElementSelect call
 *
 * Mount strategy: a minimal wrapper component calls provideBoardInteraction()
 * during setup so the renderer's tryUseBoardInteraction() inject resolves to
 * a spy-backed mock — no symbol key export needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import {
  provideBoardInteraction,
  type BoardInteraction,
} from '../../../composables/useBoardInteraction.js';
import CardRenderer from './CardRenderer.vue';
import PieceRenderer from './PieceRenderer.vue';
import DeckRenderer from './DeckRenderer.vue';

// ---------------------------------------------------------------------------
// Minimal mock — only the surface used by the three renderers
// ---------------------------------------------------------------------------

function makeSelectableMock(): {
  mock: BoardInteraction;
  triggerSpy: ReturnType<typeof vi.fn>;
} {
  const triggerSpy = vi.fn();
  const mock = {
    // --- state ---
    hoveredChoice: null,
    selectedElement: null,
    validElements: [],
    onElementSelect: null,
    onChoiceSelect: null,
    draggedElement: null,
    dropTargets: [],
    isDragging: false,
    draggableSelectedElement: null,
    lastDroppedElementId: null,
    hoveredDropTarget: null,
    currentAction: null,
    currentPickIndex: 0,
    currentPickName: null,
    // --- query methods ---
    isSelectableElement: (): boolean => true,
    isDisabledElement: (): string | false => false,
    isSelected: (): boolean => false,
    isHighlighted: (): boolean => false,
    isDraggedElement: (): boolean => false,
    isDropTarget: (): boolean => false,
    isDraggableSelectedElement: (): boolean => false,
    isValidTarget: (): boolean => false,
    isHoveredDropTarget: (): boolean => false,
    // --- mutation spies ---
    triggerElementSelect: triggerSpy,
    selectElement: vi.fn(),
    startDrag: vi.fn(),
    endDrag: vi.fn(),
    triggerDrop: vi.fn(),
    setValidElements: vi.fn(),
    setHoveredChoice: vi.fn(),
    clear: vi.fn(),
    setDropTargets: vi.fn(),
    setDraggableSelectedElement: vi.fn(),
    setHoveredDropTarget: vi.fn(),
    setCurrentAction: vi.fn(),
    setCurrentPick: vi.fn(),
    setChoiceSelectCallback: vi.fn(),
    triggerChoiceSelect: vi.fn(),
    consumeLastDroppedElementId: vi.fn(),
  } as unknown as BoardInteraction;
  return { mock, triggerSpy };
}

/**
 * Mount a renderer inside a wrapper component that provides boardInteraction.
 * The wrapper render fn passes all given props to the component.
 */
function mountWithInteraction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: any,
  props: Record<string, unknown>,
  bi: BoardInteraction,
) {
  const Wrapper = defineComponent({
    setup() {
      provideBoardInteraction(bi);
    },
    render() {
      return h(component, props);
    },
  });
  return mount(Wrapper);
}

// ---------------------------------------------------------------------------
// Shared element factories
// ---------------------------------------------------------------------------

function makeCardElement(id = 1) {
  return { id, className: 'Card', name: 'ace-of-spades', attributes: {} };
}

function makePieceElement(id = 2) {
  return { id, className: 'Piece', name: 'white-knight', attributes: {} };
}

function makeDeckElement(id = 3) {
  return {
    id,
    className: 'Deck',
    name: 'draw-pile',
    attributes: {},
    children: [],
    childCount: 0,
  };
}

// ---------------------------------------------------------------------------
// CardRenderer a11y
// ---------------------------------------------------------------------------

describe('CardRenderer — a11y (A11Y-01, A11Y-04)', () => {
  let triggerSpy: ReturnType<typeof vi.fn>;
  let bi: BoardInteraction;

  beforeEach(() => {
    const m = makeSelectableMock();
    bi = m.mock;
    triggerSpy = m.triggerSpy;
  });

  it('selectable card has role="button"', () => {
    const wrapper = mountWithInteraction(
      CardRenderer,
      { element: makeCardElement(), depth: 0 },
      bi,
    );
    expect(wrapper.find('.card-container').attributes('role')).toBe('button');
  });

  it('selectable card has tabindex="0"', () => {
    const wrapper = mountWithInteraction(
      CardRenderer,
      { element: makeCardElement(), depth: 0 },
      bi,
    );
    expect(wrapper.find('.card-container').attributes('tabindex')).toBe('0');
  });

  it('keydown Enter fires triggerElementSelect exactly once', async () => {
    const wrapper = mountWithInteraction(
      CardRenderer,
      { element: makeCardElement(), depth: 0 },
      bi,
    );
    await wrapper.find('.card-container').trigger('keydown', { key: 'Enter' });
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('keydown Space fires triggerElementSelect exactly once', async () => {
    const wrapper = mountWithInteraction(
      CardRenderer,
      { element: makeCardElement(), depth: 0 },
      bi,
    );
    await wrapper.find('.card-container').trigger('keydown', { key: ' ' });
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// PieceRenderer a11y — parametrized behavioral case (Task 2)
// ---------------------------------------------------------------------------

describe('PieceRenderer — a11y (A11Y-01, A11Y-04)', () => {
  let triggerSpy: ReturnType<typeof vi.fn>;
  let bi: BoardInteraction;

  beforeEach(() => {
    const m = makeSelectableMock();
    bi = m.mock;
    triggerSpy = m.triggerSpy;
  });

  it('selectable piece has role="button"', () => {
    const wrapper = mountWithInteraction(
      PieceRenderer,
      { element: makePieceElement(), depth: 0 },
      bi,
    );
    expect(wrapper.find('.piece').attributes('role')).toBe('button');
  });

  it('selectable piece has tabindex="0"', () => {
    const wrapper = mountWithInteraction(
      PieceRenderer,
      { element: makePieceElement(), depth: 0 },
      bi,
    );
    expect(wrapper.find('.piece').attributes('tabindex')).toBe('0');
  });

  it('keydown Enter fires triggerElementSelect exactly once', async () => {
    const wrapper = mountWithInteraction(
      PieceRenderer,
      { element: makePieceElement(), depth: 0 },
      bi,
    );
    await wrapper.find('.piece').trigger('keydown', { key: 'Enter' });
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// DeckRenderer a11y — parametrized behavioral case (Task 3)
// ---------------------------------------------------------------------------

describe('DeckRenderer — a11y (A11Y-01, A11Y-04)', () => {
  let triggerSpy: ReturnType<typeof vi.fn>;
  let bi: BoardInteraction;

  beforeEach(() => {
    const m = makeSelectableMock();
    bi = m.mock;
    triggerSpy = m.triggerSpy;
  });

  it('selectable deck has role="button"', () => {
    const wrapper = mountWithInteraction(
      DeckRenderer,
      { element: makeDeckElement(), depth: 0 },
      bi,
    );
    expect(wrapper.find('.deck-container').attributes('role')).toBe('button');
  });

  it('selectable deck has tabindex="0"', () => {
    const wrapper = mountWithInteraction(
      DeckRenderer,
      { element: makeDeckElement(), depth: 0 },
      bi,
    );
    expect(wrapper.find('.deck-container').attributes('tabindex')).toBe('0');
  });

  it('keydown Enter fires triggerElementSelect exactly once', async () => {
    const wrapper = mountWithInteraction(
      DeckRenderer,
      { element: makeDeckElement(), depth: 0 },
      bi,
    );
    await wrapper.find('.deck-container').trigger('keydown', { key: 'Enter' });
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });
});
