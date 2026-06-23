/**
 * useSelectable — A11Y-01 keyboard operability composable
 *
 * Single source of truth for click+keydown wiring across all board renderers.
 * Two exported modes share the same triggerElementSelect wrapping:
 *
 *   useSelectable()      — element mode (cards, dice, pieces, decks, spaces)
 *   useSelectableGrid()  — grid mode with roving tabindex (GridBoardRenderer, HexBoardRenderer)
 *
 * Design constraint: this composable is a THIN keyboard+ARIA wrapper only.
 * All selection business logic (disabled checks, drop-target activation,
 * callback dispatch) lives inside triggerElementSelect() on BoardInteraction.
 * Do NOT duplicate any of that logic here.
 *
 * Custom-UI parity: accept `boardInteraction: BoardInteraction | null | undefined`
 * so the composable degrades gracefully when used outside a <GameShell>
 * (caller uses tryUseBoardInteraction() which returns undefined outside provider).
 */
import { computed, type ComputedRef } from 'vue';
import { ref } from 'vue';
import type { BoardInteraction, ElementRef } from './useBoardInteraction.js';

// ---------------------------------------------------------------------------
// useSelectable — element mode
// ---------------------------------------------------------------------------

/**
 * Wire click + keydown (Enter/Space) to triggerElementSelect for a single element.
 *
 * @param identity    Function returning the element's identity ref (id/name/notation)
 * @param boardInteraction  BoardInteraction from tryUseBoardInteraction() — may be null/undefined
 * @param isActionSelectable  Computed: true when this element is a valid pick target
 * @param isDisabled          Computed: true when this element is disabled for selection
 *
 * @returns { onActivate, onKeydown, attrs }
 *   - onActivate  — bind to @click on the element root (handles mouse activation)
 *   - onKeydown   — bind to @keydown on the element root (handles Enter / Space only)
 *   - attrs       — computed object; spread onto the element root with v-bind
 */
export function useSelectable(
  identity: () => ElementRef,
  boardInteraction: BoardInteraction | null | undefined,
  isActionSelectable: ComputedRef<boolean>,
  isDisabled: ComputedRef<boolean>,
) {
  function handleActivate() {
    if (!boardInteraction || !isActionSelectable.value) return;
    if (isDisabled.value) return;
    boardInteraction.triggerElementSelect(identity());
  }

  const attrs = computed(() => ({
    role: 'button' as const,
    tabindex: isActionSelectable.value ? '0' : '-1',
    'aria-disabled': isDisabled.value || undefined,
  }));

  return {
    onActivate: (_e?: MouseEvent) => handleActivate(),
    onKeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleActivate();
      }
    },
    attrs,
  };
}

// ---------------------------------------------------------------------------
// useSelectableGrid — grid mode (roving tabindex)
// ---------------------------------------------------------------------------

/**
 * Manage roving-tabindex keyboard navigation for a 2D grid of board cells.
 * Mirrors the canonical implementation in planning/mockups/boardsmith-chrome.html:569-618.
 *
 * The grid container should receive:
 *   role="grid"  aria-label="Game board, N by M"
 *
 * Each cell should receive:
 *   role="gridcell"  :tabindex="currentIdx === cellIndex ? '0' : '-1'"
 *
 * @param cells           ComputedRef of all grid cells (flat row-major array)
 * @param cols            ComputedRef of the column count
 * @param getIdentity     Maps a cell to its ElementRef (id/name/notation)
 * @param boardInteraction  BoardInteraction from tryUseBoardInteraction() — may be null/undefined
 *
 * @returns { currentIdx, focusCell, handleGridKeydown }
 *   - currentIdx        — reactive index of the cell that owns tabindex="0"
 *   - focusCell(i)      — move cursor to cell i (clamped to valid range)
 *   - handleGridKeydown — bind to @keydown on the grid container element
 */
export function useSelectableGrid<T>(
  cells: ComputedRef<T[]>,
  cols: ComputedRef<number>,
  getIdentity: (cell: T) => ElementRef,
  boardInteraction: BoardInteraction | null | undefined,
) {
  const currentIdx = ref(0);

  /**
   * Move the roving-tabindex cursor to cell i, clamped to [0, cells.length - 1].
   * In the real DOM, callers set tabindex="-1" on the old cell and tabindex="0"
   * + .focus() on the new cell; that DOM wiring belongs in the renderer since
   * it requires template refs. This composable tracks the authoritative index;
   * the renderer derives :tabindex from `currentIdx === myIdx`.
   */
  function focusCell(i: number) {
    const len = cells.value.length;
    if (len === 0) return;
    currentIdx.value = Math.max(0, Math.min(len - 1, i));
  }

  /**
   * Handle arrow-key + Home/End navigation and Enter/Space activation.
   * Bind to @keydown on the `role="grid"` container element.
   */
  function handleGridKeydown(e: KeyboardEvent) {
    const k = e.key;
    const COLS = cols.value;
    let handled = true;

    // Navigation — follows mockup lines 601-606 exactly
    if (k === 'ArrowRight') focusCell(currentIdx.value + 1);
    else if (k === 'ArrowLeft') focusCell(currentIdx.value - 1);
    else if (k === 'ArrowDown') focusCell(currentIdx.value + COLS);
    else if (k === 'ArrowUp') focusCell(currentIdx.value - COLS);
    else if (k === 'Home') focusCell(currentIdx.value - (currentIdx.value % COLS));
    else if (k === 'End') focusCell(currentIdx.value - (currentIdx.value % COLS) + COLS - 1);
    // Activation — follows mockup lines 607-615
    else if (k === 'Enter' || k === ' ') {
      const cell = cells.value[currentIdx.value];
      if (cell !== undefined) {
        boardInteraction?.triggerElementSelect(getIdentity(cell));
      }
    } else {
      handled = false;
    }

    if (handled) e.preventDefault();
  }

  return { currentIdx, focusCell, handleGridKeydown };
}
