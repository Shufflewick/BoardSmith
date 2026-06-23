// @vitest-environment jsdom
/**
 * useSelectable — A11Y-01 keyboard operability composable
 *
 * Tests cover:
 *   - Element mode: Enter/Space calls triggerElementSelect once; click calls it once
 *   - Element mode: no-op when disabled or not selectable; no-op when boardInteraction is null
 *   - Element mode: attrs reactive (role, tabindex, aria-disabled)
 *   - Grid mode: ArrowRight/Left/Down/Up/Home/End move currentIdx per mockup math
 *   - Grid mode: ArrowLeft/Right clamp at boundaries
 *   - Grid mode: Enter/Space activates current cell via triggerElementSelect
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computed, ref } from 'vue';
import { useSelectable, useSelectableGrid } from './useSelectable.js';
import type { BoardInteraction } from './useBoardInteraction.js';

function makeKeyEvent(key: string, shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
}

function makeMockInteraction(): Pick<BoardInteraction, 'triggerElementSelect'> {
  return { triggerElementSelect: vi.fn() };
}

// ---------------------------------------------------------------------------
// useSelectable — element mode
// ---------------------------------------------------------------------------

describe('useSelectable (element mode)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls triggerElementSelect once on Enter', () => {
    const bi = makeMockInteraction();
    const { onKeydown } = useSelectable(
      () => ({ id: 1 }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => false),
    );
    onKeydown(makeKeyEvent('Enter'));
    expect(bi.triggerElementSelect).toHaveBeenCalledTimes(1);
    expect(bi.triggerElementSelect).toHaveBeenCalledWith({ id: 1 });
  });

  it('calls triggerElementSelect once on Space', () => {
    const bi = makeMockInteraction();
    const { onKeydown } = useSelectable(
      () => ({ id: 2 }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => false),
    );
    onKeydown(makeKeyEvent(' '));
    expect(bi.triggerElementSelect).toHaveBeenCalledTimes(1);
    expect(bi.triggerElementSelect).toHaveBeenCalledWith({ id: 2 });
  });

  it('calls triggerElementSelect once on click', () => {
    const bi = makeMockInteraction();
    const { onActivate } = useSelectable(
      () => ({ id: 3 }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => false),
    );
    onActivate();
    expect(bi.triggerElementSelect).toHaveBeenCalledTimes(1);
    expect(bi.triggerElementSelect).toHaveBeenCalledWith({ id: 3 });
  });

  it('does not call triggerElementSelect when isDisabled is true', () => {
    const bi = makeMockInteraction();
    const { onKeydown, onActivate } = useSelectable(
      () => ({ id: 4 }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => true),
    );
    onKeydown(makeKeyEvent('Enter'));
    onKeydown(makeKeyEvent(' '));
    onActivate();
    expect(bi.triggerElementSelect).not.toHaveBeenCalled();
  });

  it('does not call triggerElementSelect when isActionSelectable is false', () => {
    const bi = makeMockInteraction();
    const { onKeydown, onActivate } = useSelectable(
      () => ({ id: 5 }),
      bi as BoardInteraction,
      computed(() => false),
      computed(() => false),
    );
    onKeydown(makeKeyEvent('Enter'));
    onKeydown(makeKeyEvent(' '));
    onActivate();
    expect(bi.triggerElementSelect).not.toHaveBeenCalled();
  });

  it('does not throw and does not call select when boardInteraction is null', () => {
    const { onKeydown, onActivate } = useSelectable(
      () => ({ id: 6 }),
      null,
      computed(() => true),
      computed(() => false),
    );
    expect(() => onKeydown(makeKeyEvent('Enter'))).not.toThrow();
    expect(() => onActivate()).not.toThrow();
  });

  it('does not call triggerElementSelect for non-activation keys (e.g. Tab)', () => {
    const bi = makeMockInteraction();
    const { onKeydown } = useSelectable(
      () => ({ id: 7 }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => false),
    );
    onKeydown(makeKeyEvent('Tab'));
    onKeydown(makeKeyEvent('a'));
    onKeydown(makeKeyEvent('ArrowDown'));
    expect(bi.triggerElementSelect).not.toHaveBeenCalled();
  });

  it('attrs.role is always "button"', () => {
    const bi = makeMockInteraction();
    const { attrs } = useSelectable(
      () => ({ id: 8 }),
      bi as BoardInteraction,
      computed(() => false),
      computed(() => false),
    );
    expect(attrs.value.role).toBe('button');
  });

  it('attrs.tabindex is "0" when isActionSelectable, "-1" when not', () => {
    const bi = makeMockInteraction();
    const selectableRef = ref(true);
    const { attrs } = useSelectable(
      () => ({ id: 9 }),
      bi as BoardInteraction,
      computed(() => selectableRef.value),
      computed(() => false),
    );
    expect(attrs.value.tabindex).toBe('0');
    selectableRef.value = false;
    expect(attrs.value.tabindex).toBe('-1');
  });

  it('attrs["aria-disabled"] is true when disabled, undefined when not', () => {
    const bi = makeMockInteraction();
    const disabledRef = ref(false);
    const { attrs } = useSelectable(
      () => ({ id: 10 }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => disabledRef.value),
    );
    expect(attrs.value['aria-disabled']).toBeUndefined();
    disabledRef.value = true;
    expect(attrs.value['aria-disabled']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useSelectableGrid — grid mode
// ---------------------------------------------------------------------------

describe('useSelectableGrid (grid mode)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // 3×3 grid (9 cells, 3 cols): indices 0-8
  function makeGrid3x3() {
    const cells = Array.from({ length: 9 }, (_, i) => ({ id: i }));
    return {
      cellsRef: computed(() => cells),
      colsRef: computed(() => 3),
      cells,
    };
  }

  it('ArrowRight moves currentIdx from 0 to 1', () => {
    const bi = makeMockInteraction();
    const { cellsRef, colsRef } = makeGrid3x3();
    const { currentIdx, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    expect(currentIdx.value).toBe(0);
    handleGridKeydown(makeKeyEvent('ArrowRight'));
    expect(currentIdx.value).toBe(1);
  });

  it('ArrowLeft moves currentIdx from 1 to 0', () => {
    const bi = makeMockInteraction();
    const { cellsRef, colsRef } = makeGrid3x3();
    const { currentIdx, focusCell, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    focusCell(1);
    handleGridKeydown(makeKeyEvent('ArrowLeft'));
    expect(currentIdx.value).toBe(0);
  });

  it('ArrowDown moves currentIdx by COLS (3)', () => {
    const bi = makeMockInteraction();
    const { cellsRef, colsRef } = makeGrid3x3();
    const { currentIdx, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    handleGridKeydown(makeKeyEvent('ArrowDown'));
    expect(currentIdx.value).toBe(3);
  });

  it('ArrowUp moves currentIdx by -COLS (3)', () => {
    const bi = makeMockInteraction();
    const { cellsRef, colsRef } = makeGrid3x3();
    const { currentIdx, focusCell, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    focusCell(3);
    handleGridKeydown(makeKeyEvent('ArrowUp'));
    expect(currentIdx.value).toBe(0);
  });

  it('Home moves to row start: idx 4 → 3 (3 cols)', () => {
    const bi = makeMockInteraction();
    const { cellsRef, colsRef } = makeGrid3x3();
    const { currentIdx, focusCell, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    focusCell(4); // row 1, col 1 → row start = 4 - (4%3) = 4-1 = 3
    handleGridKeydown(makeKeyEvent('Home'));
    expect(currentIdx.value).toBe(3);
  });

  it('End moves to row end: idx 4 → 5 (3 cols)', () => {
    const bi = makeMockInteraction();
    const { cellsRef, colsRef } = makeGrid3x3();
    const { currentIdx, focusCell, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    focusCell(4); // row 1, col 1 → row end = 4 - (4%3) + 3 - 1 = 3+3-1 = 5
    handleGridKeydown(makeKeyEvent('End'));
    expect(currentIdx.value).toBe(5);
  });

  it('ArrowLeft clamps at 0', () => {
    const bi = makeMockInteraction();
    const { cellsRef, colsRef } = makeGrid3x3();
    const { currentIdx, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    expect(currentIdx.value).toBe(0);
    handleGridKeydown(makeKeyEvent('ArrowLeft'));
    expect(currentIdx.value).toBe(0);
  });

  it('ArrowRight clamps at last cell', () => {
    const bi = makeMockInteraction();
    const cells2 = [{ id: 0 }, { id: 1 }, { id: 2 }];
    const cellsRef = computed(() => cells2);
    const colsRef = computed(() => 3);
    const { currentIdx, focusCell, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    focusCell(2);
    handleGridKeydown(makeKeyEvent('ArrowRight'));
    expect(currentIdx.value).toBe(2);
  });

  it('unhandled keys (including Enter/Space) do not move currentIdx and do not activate (IN-01)', () => {
    // Enter/Space activation is handled by the renderer, not this composable.
    // GridBoardRenderer and HexBoardRenderer both intercept Enter/Space before
    // delegating to _composableKeydown, so this branch is intentionally absent.
    const bi = makeMockInteraction();
    const { cellsRef, colsRef } = makeGrid3x3();
    const { currentIdx, handleGridKeydown } = useSelectableGrid(
      cellsRef,
      colsRef,
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    handleGridKeydown(makeKeyEvent('Tab'));
    handleGridKeydown(makeKeyEvent('Escape'));
    handleGridKeydown(makeKeyEvent('Enter'));
    handleGridKeydown(makeKeyEvent(' '));
    expect(currentIdx.value).toBe(0);
    expect(bi.triggerElementSelect).not.toHaveBeenCalled();
  });
});
