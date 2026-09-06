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
import { computed, nextTick, watch, type ComputedRef } from 'vue';
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
 * @param onActivate      What Enter/Space does to a cell. The composable calls it
 *   with the cell that actually received the key — see `handleGridKeydown` for why
 *   the renderer must not pick that cell itself (#190).
 * @param elementType     Optional label identifying the caller's grid-cell kind (e.g.
 *   `'grid-cell'`, `'hex-cell'`), forwarded to `anchorAttrs()`'s missing-anchor
 *   dev-warning dedup key so distinct grid renderers each warn once instead of
 *   collapsing into one shared `'unknown'` bucket.
 * @param isCandidate     Optional predicate: is this cell a valid target for the
 *   choice currently being made? Supplying it makes the roving cursor
 *   candidate-aware (#172) — see `focusFirstCandidate` below. Omit it and the
 *   grid behaves exactly as it did: a plain spatial cursor over every cell.
 *
 * @returns { currentIdx, focusCell, handleGridKeydown, handleGridFocusIn, registerCell,
 *            focusCursorCell, cellAttrs, candidateIndices, focusFirstCandidate }
 *   - currentIdx          — reactive index of the cell that owns tabindex="0"
 *   - focusCell(i)        — move cursor to cell i (clamped to valid range)
 *   - handleGridKeydown   — bind to @keydown on the grid container: navigation AND
 *                           Enter/Space activation, both aimed at the focused cell
 *   - handleGridFocusIn   — bind to @focusin on the grid container element
 *   - registerCell(el, i) — bind as each cell's :ref, so the composable can move focus
 *   - focusCursorCell     — put DOM focus on the cursor's cell
 *   - candidateIndices    — indices of the cells that are valid targets right now
 *   - focusFirstCandidate — put the cursor on the first of them; returns whether it could
 *
 * #190: the cursor and real focus are ONE thing, and this composable owns both.
 * They used to be two: the cell reported its own focus, the renderer held the DOM
 * refs and picked the cell to activate, and the candidate cursor below could move
 * with no focus event anywhere. When they drifted, Enter activated the cursor's
 * cell while the player was looking at another one — a move that succeeds and is
 * not the move they made.
 */
export function useSelectableGrid<T>(
  cells: ComputedRef<T[]>,
  cols: ComputedRef<number>,
  getIdentity: (cell: T) => ElementRef,
  boardInteraction: BoardInteraction | null | undefined,
  onActivate: (cell: T) => void,
  elementType?: string,
  isCandidate?: (cell: T) => boolean,
) {
  const currentIdx = ref(0);

  // The cell elements themselves, in cell order. Registered by the renderer as
  // each cell's :ref — DOM focus is not something the renderer can be trusted to
  // keep in step with the cursor by hand, so the composable holds both ends.
  const cellEls: (HTMLElement | SVGElement | null)[] = [];

  /** Bind as each cell's `:ref`. */
  function registerCell(el: Element | null, idx: number) {
    cellEls[idx] = el instanceof HTMLElement || el instanceof SVGElement ? el : null;
  }

  /**
   * Index of the cell containing `node`, or -1. Walks containment rather than
   * matching the cell itself, because focus can land on something a cell holds
   * (a card, a piece) and the cursor still belongs on the cell.
   */
  function cellIndexOf(node: Node | null): number {
    if (!node) return -1;
    for (let i = 0; i < cellEls.length; i++) {
      const el = cellEls[i];
      if (el && (el === node || el.contains(node))) return i;
    }
    return -1;
  }

  /** Does the grid hold the document's focus right now? False when rendered on a server. */
  function gridOwnsFocus(): boolean {
    if (typeof document === 'undefined') return false;
    return cellIndexOf(document.activeElement) !== -1;
  }

  /**
   * Bind to `@focusin` on the grid container: the cursor follows real focus.
   *
   * `focusin` bubbles and `focus` does not, which is why this lives on the
   * container rather than on each cell — one listener that cannot be missed,
   * and it catches focus landing inside a cell as well as on it.
   */
  function handleGridFocusIn(e: FocusEvent) {
    const idx = cellIndexOf(e.target as Node | null);
    if (idx !== -1) currentIdx.value = idx;
  }

  /** Put DOM focus on the cursor's cell, so the tab stop and the focus ring agree. */
  function focusCursorCell() {
    cellEls[currentIdx.value]?.focus();
  }

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
    // #190: never while the player is standing on the board. Candidates are
    // re-offered on every state update, so this fires constantly during a game;
    // moving the cursor out from under a focused cell is how Enter came to play
    // a cell nobody chose. A player who has focus decides where the cursor is.
    if (gridOwnsFocus()) return;
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
   * Move the cursor for one navigation key — follows mockup lines 601-606 exactly.
   * Returns false when the key is not one this grid navigates by, so the caller
   * can leave the event alone.
   */
  function moveCursorBy(key: string): boolean {
    const COLS = cols.value;
    const i = currentIdx.value;
    switch (key) {
      case 'ArrowRight': focusCell(i + 1); return true;
      case 'ArrowLeft': focusCell(i - 1); return true;
      case 'ArrowDown': focusCell(i + COLS); return true;
      case 'ArrowUp': focusCell(i - COLS); return true;
      case 'Home': focusCell(i - (i % COLS)); return true;
      case 'End': focusCell(i - (i % COLS) + COLS - 1); return true;
      default: return false;
    }
  }

  /**
   * Handle the grid's keyboard: Enter/Space activate, Arrow/Home/End navigate and
   * carry DOM focus with them. Bind to @keydown on the `role="grid"` container.
   *
   * #190: the cell this acts on comes from the EVENT, not from the cursor. A key
   * event is delivered to the focused element, so its target is the cell the player
   * is on — the one fact that is true even when no focus event ever arrived. And
   * one does not always arrive: measured in Chrome, `.focus()` on a cell in a
   * document that lacks system focus moves `document.activeElement` and fires
   * neither `focus` nor `focusin`. A handler that trusted the cursor instead played
   * a cell the player never chose, silently, because the move still succeeded.
   */
  function handleGridKeydown(e: KeyboardEvent) {
    const focusedIdx = cellIndexOf(e.target as Node | null);
    if (focusedIdx !== -1) currentIdx.value = focusedIdx;

    if (e.key === 'Enter' || e.key === ' ') {
      const cell = cells.value[currentIdx.value];
      if (cell) onActivate(cell);
      e.preventDefault();
      return;
    }

    if (!moveCursorBy(e.key)) return;
    e.preventDefault();
    // The cursor moved synchronously; the tab stop it implies is a render away.
    void nextTick(focusCursorCell);
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

  return {
    currentIdx,
    focusCell,
    handleGridKeydown,
    handleGridFocusIn,
    registerCell,
    focusCursorCell,
    cellAttrs,
    candidateIndices,
    focusFirstCandidate,
  };
}
