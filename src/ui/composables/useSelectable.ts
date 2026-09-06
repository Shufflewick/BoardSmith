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
import { computed, watch, type ComputedRef } from 'vue';
import { ref } from 'vue';
import { anchorAttrs, candidateAttrs } from './useBoardInteraction.js';
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
 * @param elementType         Optional label identifying the caller's element kind (e.g.
 *   `'card'`, `'piece'`, `'die'`), forwarded to `anchorAttrs()`'s missing-anchor
 *   dev-warning dedup key so distinct renderers each warn once instead of
 *   collapsing into one shared `'unknown'` bucket.
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
  elementType?: string,
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
    ...anchorAttrs(identity(), elementType),
    ...candidateAttrs(boardInteraction?.candidateLabel(identity()) ?? null),
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
 * @param elementType     Optional label identifying the caller's grid-cell kind (e.g.
 *   `'grid-cell'`, `'hex-cell'`), forwarded to `anchorAttrs()`'s missing-anchor
 *   dev-warning dedup key so distinct grid renderers each warn once instead of
 *   collapsing into one shared `'unknown'` bucket.
 * @param isCandidate     Optional predicate: is this cell a valid target for the
 *   choice currently being made? Supplying it makes the roving cursor
 *   candidate-aware (#172) — see `focusFirstCandidate` below. Omit it and the
 *   grid behaves exactly as it did: a plain spatial cursor over every cell.
 *
 * @returns { currentIdx, focusCell, handleGridKeydown, cellAttrs, candidateIndices, focusFirstCandidate }
 *   - currentIdx          — reactive index of the cell that owns tabindex="0"
 *   - focusCell(i)        — move cursor to cell i (clamped to valid range)
 *   - handleGridKeydown   — bind to @keydown on the grid container element
 *   - candidateIndices    — indices of the cells that are valid targets right now
 *   - focusFirstCandidate — put the cursor on the first of them; returns whether it could
 */
export function useSelectableGrid<T>(
  cells: ComputedRef<T[]>,
  cols: ComputedRef<number>,
  getIdentity: (cell: T) => ElementRef,
  boardInteraction: BoardInteraction | null | undefined,
  elementType?: string,
  isCandidate?: (cell: T) => boolean,
) {
  const currentIdx = ref(0);

  /**
   * Indices of the cells the current choice will actually accept.
   *
   * #172: when the panel yields to the board for a large choice, the board is
   * the ONLY path into it. A cursor parked on cell 0 of a 121-cell board leaves
   * a keyboard player arrowing blind through squares that cannot be chosen, so
   * the cursor has to know which cells are real.
   */
  const candidateIndices = computed<number[]>(() => {
    if (!isCandidate) return [];
    const out: number[] = [];
    cells.value.forEach((cell, i) => {
      if (isCandidate(cell)) out.push(i);
    });
    return out;
  });

  /**
   * Move the cursor to the first cell the current choice accepts. Returns false
   * (and leaves the cursor alone) when there is nothing to move to, so a caller
   * can fall back rather than silently doing nothing.
   */
  function focusFirstCandidate(): boolean {
    const first = candidateIndices.value[0];
    if (first === undefined) return false;
    currentIdx.value = first;
    return true;
  }

  // When a pick starts, candidates appear. Land the cursor on one — unless it
  // already sits on a candidate, in which case moving it would fight the player.
  // Immediate, because a board can be mounted with a pick already in progress
  // (a followUp, a reconnect, a time-travel jump), and that cursor is just as
  // stranded as one that never moved.
  watch(candidateIndices, (indices) => {
    if (indices.length === 0) return;
    if (indices.includes(currentIdx.value)) return;
    currentIdx.value = indices[0];
  }, { immediate: true });

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
   * Handle arrow-key navigation (Arrow/Home/End) for the grid's roving tabindex.
   * Bind to @keydown on the `role="grid"` container element.
   *
   * NOTE: Enter/Space activation is intentionally NOT handled here. Both grid
   * renderer consumers (GridBoardRenderer, HexBoardRenderer) intercept Enter/Space
   * before delegating to this function, applying their own passive-select and
   * triggerElementSelect logic. Adding an Enter/Space branch here would be dead
   * code that could interfere with future renderer-specific activation paths.
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
    else {
      handled = false;
    }

    if (handled) e.preventDefault();
  }

  /**
   * Return the anchor and candidate attributes for a single grid cell.
   * Delegates entirely to anchorAttrs and candidateAttrs — the single sources
   * of those attribute names.
   * Bind via `v-bind="cellAttrs(cell)"` on each cell root element.
   */
  function cellAttrs(cell: T): Record<string, string> {
    const identity = getIdentity(cell);
    return {
      ...anchorAttrs(identity, elementType),
      ...candidateAttrs(boardInteraction?.candidateLabel(identity) ?? null),
    };
  }

  return { currentIdx, focusCell, handleGridKeydown, cellAttrs, candidateIndices, focusFirstCandidate };
}
