<script setup lang="ts">
/**
 * GridBoardRenderer — CSS-grid board renderer for $layout='grid' elements.
 *
 * Delegates all grid sizing to resolveGridSize(). Never falls back to 8×8.
 * When coordinates are missing/undeclared, renders the locked error panel.
 * Provides gridCoords to child cells so they can position via grid-row/grid-column.
 *
 * A11Y-01: uses useSelectableGrid() for roving-tabindex grid navigation.
 * The board-grid container is role="grid"; each cell is role="gridcell".
 * Arrow/Home/End move focus; Enter/Space activates the focused cell.
 * Passive selectElement branch preserved: non-selectable named cells call
 * boardInteraction.selectElement() on activation (same as click).
 */

import { computed, provide, watchEffect, ref, inject, nextTick, type ComputedRef } from 'vue';
import { resolveGridSize } from '../auto-ui-helpers.js';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
import { useSelectableGrid } from '../../../composables/useSelectable.js';
import ElementRenderer from './ElementRenderer.vue';
import { resolvePresentation } from '../presentation.js';
import type { PresentationOverlay } from '../presentation.js';

// ---------------------------------------------------------------------------
// Local GameElement interface — do NOT import from engine (module is dependency-free)
// Mirrors auto-ui-helpers.ts lines 12-19.
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

const props = defineProps<{
  element: GameElement;
  depth: number;
}>();

// Board interaction for cell states
const boardInteraction = tryUseBoardInteraction();

// Delegate all grid sizing to the Phase 92 helper — DO NOT re-implement
const gridResult = computed(() => resolveGridSize(props.element));

// One-shot console.error when grid cannot resolve
const _lastGridError = ref<string | null>(null);
watchEffect(() => {
  const result = gridResult.value;
  if (!result.ok && result.error !== _lastGridError.value) {
    console.error(`[BoardSmith] ${result.error}`);
    _lastGridError.value = result.error;
  }
});

// Provide coordinate names to child cells (inherited from parent grid provide pattern)
// Children use these to set grid-row / grid-column from their own coordinate attributes
const rowCoord = props.element.attributes?.$rowCoord as string | undefined;
const colCoord = props.element.attributes?.$colCoord as string | undefined;
if (rowCoord && colCoord) {
  provide('gridCoords', { rowCoord, colCoord });
}

// Dynamic grid-template-columns from resolveGridSize — no hardcoded fallback
const gridStyle = computed(() => {
  if (!gridResult.value.ok) return {};
  return { 'grid-template-columns': `repeat(${gridResult.value.cols}, 1fr)` };
});

// Natural sizing: expose --cols and --rows as CSS custom properties on the board wrapper.
// The grid renders at its natural size (--cell: var(--bsg-cell)); the board area scrolls
// when larger than the viewport rather than shrinking cells to fit.
const boardSizeStyle = computed(() => {
  if (!gridResult.value.ok) return {};
  return {
    '--cols': gridResult.value.cols,
    '--rows': gridResult.value.rows,
  };
});

// Column labels from game designer or auto-generated indices
const columnLabels = computed(() => {
  if (!gridResult.value.ok) return [];
  const declared = props.element.attributes?.$columnLabels as string[] | undefined;
  return declared ?? Array.from({ length: gridResult.value.cols }, (_, i) => String(i));
});

// Row labels from game designer or auto-generated indices
const rowLabels = computed(() => {
  if (!gridResult.value.ok) return [];
  const declared = props.element.attributes?.$rowLabels as string[] | undefined;
  return declared ?? Array.from({ length: gridResult.value.rows }, (_, i) => String(i));
});

// Presentation overlay injection (D-04)
// GridBoardRenderer is a container — overlay affects the board header label.
// Individual cells are rendered via ElementRenderer → their renderer handles their own overlay.
const overlay = inject<ComputedRef<PresentationOverlay | undefined>>('presentation');
const presentationEntry = computed(() =>
  resolvePresentation(props.element, overlay?.value)
);

// Display label for board header — overlay label wins, then engine fallback
const displayLabel = computed(
  () => presentationEntry.value?.label ?? props.element.name ?? props.element.className
);

// All children passed to ElementRenderer for rendering
const children = computed(() => props.element.children ?? []);

// Element identity helper — passes notation from attributes (Pitfall 6: notation is not a top-level
// field on GameElement in renderer context; it lives in attributes for notation-keyed elements
// like Checkers squares). Routing all interaction calls through this helper ensures matchesRef
// can match by notation when a boardRef specifies { notation: 'e5' }.
function cellIdentity(cell: GameElement) {
  return {
    id: cell.id,
    name: cell.name,
    notation: cell.attributes?.notation as string | undefined,
  };
}

// Per-cell board interaction states — all six required states (UI-SPEC Interaction Affordance Contract)
function isCellHighlighted(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted(cellIdentity(cell));
}

function isCellSelected(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected(cellIdentity(cell));
}

function isCellActionSelectable(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  if (isCellSelected(cell)) return false;
  return boardInteraction.isSelectableElement(cellIdentity(cell));
}

function isCellDropTarget(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isDropTarget(cellIdentity(cell));
}

function isCellDisabled(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement(cellIdentity(cell)) !== false;
}

// ── A11Y-01: useSelectableGrid — roving tabindex for 2D grid navigation ────
//
// colsRef drives Arrow Up/Down row-skipping math in the composable.
// Mirrors planning/mockups/boardsmith-chrome.html:569-618 exactly.
const colsRef = computed(() => (gridResult.value.ok ? gridResult.value.cols : 0));
const rowsRef = computed(() => (gridResult.value.ok ? gridResult.value.rows : 0));

const { currentIdx, focusCell, handleGridKeydown: _composableKeydown, cellAttrs } = useSelectableGrid(
  children,
  colsRef,
  cellIdentity,
  boardInteraction,
);

// DOM refs for each cell — needed to call .focus() after arrow-key navigation
// (composable tracks authoritative index; DOM wiring belongs here per useSelectable.ts)
const cellRefs: (HTMLElement | null)[] = [];
function setCellRef(el: Element | null, idx: number) {
  cellRefs[idx] = el instanceof HTMLElement ? el : null;
}

// Cell activation: handles selectable AND passive selectElement branches.
// Called from both click and keyboard (Enter/Space) for consistent behavior.
// Passive branch: non-selectable named cells call selectElement() so the board
// can track which cell is focused for highlighting/annotation purposes.
function handleCellActivate(cell: GameElement) {
  if (!boardInteraction) return;
  if (isCellDisabled(cell)) return;
  if (boardInteraction.isSelectableElement(cellIdentity(cell))) {
    boardInteraction.triggerElementSelect(cellIdentity(cell));
  } else if (cell.name) {
    boardInteraction.selectElement(cellIdentity(cell));
  }
}

// Grid keydown handler: intercepts Enter/Space to apply the passive branch,
// delegates all navigation keys (Arrow/Home/End) to the composable.
// After navigation, moves DOM focus to the new current cell so keyboard
// users see a visible focus ring without a second Tab press.
function handleGridKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    const cell = children.value[currentIdx.value];
    if (cell) handleCellActivate(cell);
    e.preventDefault();
    return;
  }
  _composableKeydown(e);
  // Move DOM focus to match the new currentIdx (composable updates state synchronously;
  // DOM attribute update is deferred to the next microtask via nextTick)
  void nextTick(() => {
    cellRefs[currentIdx.value]?.focus();
  });
}

// Per-cell aria-label: coordinate notation + state, mirroring mockup:574-581
function cellAriaLabel(cell: GameElement, idx: number): string {
  const cols = colsRef.value;
  const rows = rowsRef.value;
  const c = idx % cols;
  const r = Math.floor(idx / cols);
  // Use the cell's own name (notation) if available; fall back to computed coord
  const coord = cell.name ?? (String.fromCharCode(97 + c) + (rows - r));
  let state: string;
  if (isCellDisabled(cell)) state = 'unavailable';
  else if (isCellSelected(cell)) state = 'selected';
  else if (isCellDropTarget(cell)) state = 'drop target';
  else if (isCellActionSelectable(cell)) state = 'selectable';
  else state = 'empty';
  return `${coord}, ${state}`;
}

function handleDragOver(event: DragEvent, cell: GameElement) {
  if (!boardInteraction?.isDragging) return;
  if (!isCellDropTarget(cell)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
}

function handleDrop(event: DragEvent, cell: GameElement) {
  if (!boardInteraction?.isDragging) return;
  event.preventDefault();
  boardInteraction.triggerDrop(cellIdentity(cell));
}
</script>

<template>
  <!-- Error path: grid coords undeclared/unresolvable — render error verbatim from helper -->
  <div v-if="!gridResult.ok" class="grid-error-panel">
    <span class="grid-error-panel__text">{{ gridResult.error }}</span>
  </div>

  <!-- Happy path: board renders when gridResult resolves successfully -->
  <div v-else class="board-container">
    <div class="board-header">{{ displayLabel }}</div>
    <div class="board-with-labels" :style="boardSizeStyle">
      <!-- Column labels (from game designer or numeric indices) -->
      <div class="board-column-labels">
        <span class="board-label corner"></span>
        <span
          v-for="(label, index) in columnLabels"
          :key="index"
          class="board-label"
        >{{ label }}</span>
      </div>
      <div class="board-row-wrapper">
        <!-- Row labels (from game designer or numeric indices) -->
        <div class="board-row-labels">
          <span
            v-for="(label, index) in rowLabels"
            :key="index"
            class="board-label"
          >{{ label }}</span>
        </div>
        <!--
          CSS grid — template-columns set dynamically from resolveGridSize result.
          A11Y-01: role="grid" + aria-label + @keydown wires the roving-tabindex
          composable. The grid is a single tab stop; Arrow/Home/End move between cells.
        -->
        <div
          class="board-grid"
          :style="gridStyle"
          role="grid"
          :aria-label="`Game board, ${colsRef} by ${rowsRef}`"
          @keydown="handleGridKeydown"
        >
          <div
            v-for="(cell, idx) in children"
            :key="cell.id"
            :ref="(el) => setCellRef(el as Element | null, idx)"
            v-bind="cellAttrs(cell)"
            class="grid-cell"
            role="gridcell"
            :tabindex="idx === currentIdx ? '0' : '-1'"
            :aria-label="cellAriaLabel(cell, idx)"
            :aria-selected="isCellSelected(cell) || undefined"
            :aria-disabled="isCellDisabled(cell) || undefined"
            :class="{
              'has-children': (cell.children?.length ?? 0) > 0,
              'is-clickable': (cell.children?.length ?? 0) > 0,
              'action-selectable': isCellActionSelectable(cell),
              'is-board-highlighted': isCellHighlighted(cell),
              'is-board-selected': isCellSelected(cell),
              'is-drop-target': isCellDropTarget(cell),
              'is-disabled': isCellDisabled(cell),
            }"
            :title="cell.name ?? undefined"
            @focus="focusCell(idx)"
            @click.stop="handleCellActivate(cell)"
            @dragover="handleDragOver($event, cell)"
            @drop="handleDrop($event, cell)"
          >
            <!-- Coordinate notation label (shown on hover) -->
            <span v-if="cell.name" class="cell-notation">{{ cell.name }}</span>
            <!-- Children dispatched through registry -->
            <ElementRenderer
              v-for="child in (cell.children ?? [])"
              :key="child.id"
              :element="child"
              :depth="depth + 2"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Board container ── */
.board-container {
  background: var(--bsg-surface);
  border-radius: 12px;
  padding: 16px;
}

.board-header {
  font-weight: bold;
  margin-bottom: 12px;
  color: var(--bsg-ink);
}

.board-with-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Natural sizing: --cell driven by the --bsg-cell token ──
   --cols and --rows are set as CSS custom properties via :style binding from gridResult
   (used for grid-template-columns). The board renders at its natural cell size; the
   board area scrolls when larger than the viewport rather than fitting to the container. */
.board-with-labels {
  --cell: var(--bsg-cell);
}

/* ── Row/column labels ── */
.board-column-labels {
  display: flex;
  gap: 2px;
}

.board-label {
  width: var(--cell);
  height: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--bsg-ink-3);
  font-weight: bold;
  text-transform: uppercase;
}

.board-label.corner {
  width: calc(var(--cell) * 0.4);
}

.board-row-wrapper {
  display: flex;
  gap: 4px;
}

.board-row-labels {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.board-row-labels .board-label {
  width: calc(var(--cell) * 0.4);
  height: var(--cell);
}

/* ── Grid — template-columns injected inline from resolveGridSize ── */
.board-grid {
  display: grid;
  gap: 2px;
  /* grid-template-columns set dynamically via :style binding */
}

/* ── Grid cell ── */
.grid-cell {
  width: var(--cell);
  height: var(--cell);
  background: var(--bsg-cell);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.15s ease;
}

.grid-cell.is-clickable {
  cursor: pointer;
}

.grid-cell.is-clickable:hover {
  background: var(--bsg-selectable);
}

/* Cell states */
.grid-cell.action-selectable {
  outline: 2px dashed var(--bsg-accent);
  outline-offset: -2px;
  background: var(--bsg-selectable);
}

.grid-cell.is-board-highlighted {
  background: var(--bsg-selectable);
}

.grid-cell.is-board-selected {
  outline: 2px solid var(--bsg-accent);
  outline-offset: -2px;
  background: var(--bsg-selected);
  box-shadow: var(--bsg-ring);
  transform: scale(1.04);
}

/* CALM, NOT A DISCO — static glow ring for drop target; no infinite attract pulse */
.grid-cell.is-drop-target {
  background: var(--bsg-droptarget);
  outline: 2px dotted var(--bsg-accent-2);
  outline-offset: -2px;
  box-shadow: var(--bsg-ring);
}

.grid-cell.is-drop-target:hover {
  background: var(--bsg-droptarget-hover);
}

/* ── Coordinate notation corner label ── */
.cell-notation {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 10px;
  color: var(--bsg-ink-3);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.grid-cell:hover .cell-notation {
  opacity: 1;
}

/* ── Disabled state — hatch pattern (A11Y-09: non-color cue, not opacity alone) ── */
.grid-cell.is-disabled {
  background-image: repeating-linear-gradient(45deg, var(--bsg-cell), var(--bsg-cell) 5px, transparent 5px, transparent 10px);
  opacity: 0.6;
  cursor: not-allowed;
}

.grid-cell.is-disabled:hover {
  background: var(--bsg-cell);
}

/* ── Error panel ── */
.grid-error-panel {
  background: color-mix(in srgb, var(--bsg-danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--bsg-danger) 40%, transparent);
  border-radius: 8px;
  padding: 16px;
}

.grid-error-panel__text {
  color: var(--bsg-danger);
  font-size: 14px;
  font-weight: 700;
}
</style>
