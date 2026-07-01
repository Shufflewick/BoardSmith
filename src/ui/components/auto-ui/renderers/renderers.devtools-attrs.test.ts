// @vitest-environment jsdom
/**
 * DEV-01 parity test — data-bs-el-id + data-element-id emitted by all four AutoUI renderers.
 *
 * Proves that PieceRenderer, SpaceRenderer, DieRenderer, and CardRenderer all emit
 * `data-bs-el-id` (via v-bind="selectableAttrs" → useSelectable.attrs → anchorAttrs)
 * and `data-element-id` (FLIP alias) on their mounted root elements.
 *
 * This test does NOT add inline data-bs-el-* literals to any renderer file —
 * that would break the single-source guard at anchorAttrs.test.ts:174.
 *
 * Mount strategy: a minimal wrapper component calls provideBoardInteraction() in
 * setup so each renderer's tryUseBoardInteraction() inject resolves to a spy-backed
 * mock (same pattern as CardRenderer.a11y.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import {
  provideBoardInteraction,
  type BoardInteraction,
} from '../../../composables/useBoardInteraction.js';
import PieceRenderer from './PieceRenderer.vue';
import SpaceRenderer from './SpaceRenderer.vue';
import DieRenderer from './DieRenderer.vue';
import CardRenderer from './CardRenderer.vue';

// ---------------------------------------------------------------------------
// Minimal mock — mirrors the shape used in CardRenderer.a11y.test.ts.
// All query methods return defaults so renderers render in a non-selected,
// non-disabled, selectable state.
// ---------------------------------------------------------------------------

function makeSelectableMock(): BoardInteraction {
  return {
    // state fields
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
    // query methods
    isSelectableElement: (): boolean => true,
    isDisabledElement: (): string | false => false,
    isSelected: (): boolean => false,
    isHighlighted: (): boolean => false,
    isDraggedElement: (): boolean => false,
    isDropTarget: (): boolean => false,
    isDraggableSelectedElement: (): boolean => false,
    isValidTarget: (): boolean => false,
    isHoveredDropTarget: (): boolean => false,
    // mutation stubs (no-op)
    triggerElementSelect: () => {},
    selectElement: () => {},
    startDrag: () => {},
    endDrag: () => {},
    triggerDrop: () => {},
    setValidElements: () => {},
    setHoveredChoice: () => {},
    clear: () => {},
    setDropTargets: () => {},
    setDraggableSelectedElement: () => {},
    setHoveredDropTarget: () => {},
    setCurrentAction: () => {},
    setCurrentPick: () => {},
    setChoiceSelectCallback: () => {},
    triggerChoiceSelect: () => {},
    consumeLastDroppedElementId: () => {},
  } as unknown as BoardInteraction;
}

/**
 * Mount a renderer inside a wrapper that provides boardInteraction.
 * Mirrors mountWithInteraction from CardRenderer.a11y.test.ts.
 */
function mountWithInteraction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: any,
  props: Record<string, unknown>,
  bi: BoardInteraction,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mountOptions: Record<string, any> = {},
) {
  const Wrapper = defineComponent({
    setup() {
      provideBoardInteraction(bi);
    },
    render() {
      return h(component, props);
    },
  });
  return mount(Wrapper, mountOptions);
}

// ---------------------------------------------------------------------------
// Shared element id used across all renderer cases
// ---------------------------------------------------------------------------

const ELEMENT_ID = 42;

// ---------------------------------------------------------------------------
// PieceRenderer
// ---------------------------------------------------------------------------

describe('PieceRenderer — DEV-01 devtools attrs', () => {
  const element = {
    id: ELEMENT_ID,
    className: 'Piece',
    name: 'white-knight',
    attributes: {},
  };

  it('root has data-bs-el-id matching String(element.id)', () => {
    const wrapper = mountWithInteraction(PieceRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.piece').element;
    expect(root.getAttribute('data-bs-el-id')).toBe(String(ELEMENT_ID));
  });

  it('root has data-element-id (FLIP alias present)', () => {
    const wrapper = mountWithInteraction(PieceRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.piece').element;
    expect(root.getAttribute('data-element-id')).not.toBeNull();
  });

  it('root has data-bs-el-name when element carries a name', () => {
    const wrapper = mountWithInteraction(PieceRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.piece').element;
    expect(root.getAttribute('data-bs-el-name')).toBe(element.name);
  });
});

// ---------------------------------------------------------------------------
// SpaceRenderer
// ---------------------------------------------------------------------------

describe('SpaceRenderer — DEV-01 devtools attrs', () => {
  const element = {
    id: ELEMENT_ID,
    className: 'Space',
    name: 'test-space',
    attributes: {},
    children: [],
    childCount: 0,
  };

  it('root has data-bs-el-id matching String(element.id)', () => {
    const wrapper = mountWithInteraction(SpaceRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.space-container').element;
    expect(root.getAttribute('data-bs-el-id')).toBe(String(ELEMENT_ID));
  });

  it('root has data-element-id (FLIP alias present)', () => {
    const wrapper = mountWithInteraction(SpaceRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.space-container').element;
    expect(root.getAttribute('data-element-id')).not.toBeNull();
  });

  it('root has data-bs-el-name when element carries a name', () => {
    const wrapper = mountWithInteraction(SpaceRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.space-container').element;
    expect(root.getAttribute('data-bs-el-name')).toBe(element.name);
  });
});

// ---------------------------------------------------------------------------
// DieRenderer
// ---------------------------------------------------------------------------
// Die3D is stubbed to avoid WebGL/canvas dependencies that fail in jsdom.
// The stub does not affect data attribute emission — those come from
// DieRenderer's own root element via v-bind="selectableAttrs".

const DIE_STUB_OPTIONS = {
  global: { stubs: { Die3D: { template: '<div class="stub-die3d"></div>' } } },
};

describe('DieRenderer — DEV-01 devtools attrs', () => {
  const element = {
    id: ELEMENT_ID,
    className: 'Die',
    name: 'test-die',
    attributes: { sides: 6, value: 3 },
  };

  it('root has data-bs-el-id matching String(element.id)', () => {
    const wrapper = mountWithInteraction(
      DieRenderer, { element, depth: 0 }, makeSelectableMock(), DIE_STUB_OPTIONS,
    );
    const root = wrapper.find('.die-container').element;
    expect(root.getAttribute('data-bs-el-id')).toBe(String(ELEMENT_ID));
  });

  it('root has data-element-id (FLIP alias present)', () => {
    const wrapper = mountWithInteraction(
      DieRenderer, { element, depth: 0 }, makeSelectableMock(), DIE_STUB_OPTIONS,
    );
    const root = wrapper.find('.die-container').element;
    expect(root.getAttribute('data-element-id')).not.toBeNull();
  });

  it('root has data-bs-el-name when element carries a name', () => {
    const wrapper = mountWithInteraction(
      DieRenderer, { element, depth: 0 }, makeSelectableMock(), DIE_STUB_OPTIONS,
    );
    const root = wrapper.find('.die-container').element;
    expect(root.getAttribute('data-bs-el-name')).toBe(element.name);
  });
});

// ---------------------------------------------------------------------------
// CardRenderer
// ---------------------------------------------------------------------------
// Note: CardRenderer computes elementNotation as:
//   (attributes.notation ?? element.name ?? null)
// When no attributes.notation is set, elementNotation === element.name, so
// anchorAttrs receives both name and notation set to element.name.

describe('CardRenderer — DEV-01 devtools attrs', () => {
  const element = {
    id: ELEMENT_ID,
    className: 'Card',
    name: 'ace-of-spades',
    attributes: {},
  };

  it('root has data-bs-el-id matching String(element.id)', () => {
    const wrapper = mountWithInteraction(CardRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.card-container').element;
    expect(root.getAttribute('data-bs-el-id')).toBe(String(ELEMENT_ID));
  });

  it('root has data-element-id (FLIP alias present)', () => {
    const wrapper = mountWithInteraction(CardRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.card-container').element;
    expect(root.getAttribute('data-element-id')).not.toBeNull();
  });

  it('root has data-bs-el-notation when element carries a name (falls back to name)', () => {
    const wrapper = mountWithInteraction(CardRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.card-container').element;
    // CardRenderer's elementNotation falls back to element.name when attributes.notation is absent
    expect(root.getAttribute('data-bs-el-notation')).toBe(element.name);
  });

  it('root has data-bs-el-name when element carries a name', () => {
    const wrapper = mountWithInteraction(CardRenderer, { element, depth: 0 }, makeSelectableMock());
    const root = wrapper.find('.card-container').element;
    expect(root.getAttribute('data-bs-el-name')).toBe(element.name);
  });
});
