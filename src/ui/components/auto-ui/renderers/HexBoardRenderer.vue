<script setup lang="ts">
/**
 * HexBoardRenderer — SVG hex board renderer for $layout='hex-grid' elements.
 *
 * All layout math uses the standalone closed-form functions from useHexGrid:
 *   hexToPixel — converts q/r coordinates to pixel position
 *   getHexPolygonPoints — generates SVG polygon points string
 *
 * No hand-rolled trig: never re-implement the closed-form functions here.
 *
 * A11Y-01: uses useSelectableGrid() for roving-tabindex keyboard navigation.
 * Each hex <g> cell gets role="gridcell" + tabindex + aria-label.
 * The SVG root gets role="grid" + aria-label + aria-rowcount/colcount + @keydown.
 *
 * MANUAL VERIFICATION REQUIRED (research Open Q3):
 * tabindex="0" on SVG <g> is spec-valid in modern browsers but Safari/VoiceOver
 * SVG focus has historically been unreliable. Run a manual VoiceOver/Safari pass
 * before marking A11Y-01 complete for HexBoardRenderer. If VO cannot land focus
 * on hex cells, escalate to transparent overlay <button> elements positioned over
 * each hex cell using position:absolute within a position:relative container.
 */

import { computed, inject, nextTick, type ComputedRef } from 'vue';
import { hexToPixel, getHexPolygonPoints } from '../../../composables/useHexGrid.js';
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
  hexPieceSize?: number;
}>();

// Board interaction for polygon states
const boardInteraction = tryUseBoardInteraction();

// ── Hex grid configuration from element attributes ──────────────────────────
const hexSize = computed(() => (props.element.attributes?.$hexSize as number) ?? 50);
const orientation = computed(
  () => (props.element.attributes?.$hexOrientation as 'flat' | 'pointy') ?? 'pointy'
);

// Coordinate attribute names declared on the board element
const qCoordName = computed(
  () => (props.element.attributes?.$qCoord as string | undefined) ?? 'q'
);
const rCoordName = computed(
  () => (props.element.attributes?.$rCoord as string | undefined) ?? 'r'
);

// ── Closed-form functions (no hand-rolled trig) ──────────────────────────────

/**
 * Get pixel position for a hex cell using the standalone hexToPixel function.
 * Reads q/r from the cell's own coordinate attributes, using coord names from parent.
 */
function getCellPosition(cell: GameElement): { x: number; y: number } {
  const attrs = cell.attributes ?? {};
  const q = (attrs[qCoordName.value] as number) ?? 0;
  const r = (attrs[rCoordName.value] as number) ?? 0;
  return hexToPixel(q, r, hexSize.value, orientation.value);
}

/** SVG polygon points string from standalone getHexPolygonPoints function */
const hexPoints = computed(() =>
  getHexPolygonPoints(hexSize.value, orientation.value)
);

// ── SVG viewBox bounds using hexToPixel ────
// Uses hexToPixel (not hand-rolled math) for consistency.
const svgBounds = computed(() => {
  const cells = props.element.children ?? [];
  if (!cells.length) return { minX: 0, minY: 0, width: 400, height: 400 };

  const size = hexSize.value;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const cell of cells) {
    const pos = getCellPosition(cell);
    minX = Math.min(minX, pos.x - size);
    maxX = Math.max(maxX, pos.x + size);
    minY = Math.min(minY, pos.y - size);
    maxY = Math.max(maxY, pos.y + size);
  }

  const padding = size;
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
});

const viewBox = computed(
  () =>
    `${svgBounds.value.minX} ${svgBounds.value.minY} ${svgBounds.value.width} ${svgBounds.value.height}`
);

// ── Piece color — seat token source (from --bsg-seat-1..6 in theme.ts) ────────
function getPieceColor(piece: GameElement, _pieceIndex: number): string {
  const player = piece.attributes?.player as { seat?: number; color?: string } | undefined;
  if (player?.color) return player.color;
  // Seats are 1-indexed (src/session/types.ts). Subtract 1 before modulo so
  // seat 1 → token 1, seat 6 → token 6 (without the -1 you get a cyclic shift).
  if (player?.seat !== undefined) return `var(--bsg-seat-${((player.seat - 1) % 6) + 1})`;
  return 'var(--bsg-ink-3)';
}

/**
 * Non-color owner glyph for accessibility (A11Y WCAG 1.4.1 Use of Color).
 * Renders the seat number inside the piece token so seat identity is conveyed
 * without relying on color alone.
 */
function getPieceGlyph(piece: GameElement): string {
  const player = piece.attributes?.player as { seat?: number } | undefined;
  if (player?.seat !== undefined) return String(player.seat);
  return '';
}

// Effective hex piece circle radius: 35% of hexSize (from UI-SPEC)
const pieceRadius = computed(() => hexSize.value * 0.35);

// ── Element identity helper — passes notation from attributes (Pitfall 6) ──────
// Hex coordinates (q, r) are element attributes, not a top-level `notation` field. However,
// a game author may declare a string `notation` attribute on hex cells for ref matching;
// passing it ensures matchesRef works for notation-keyed board refs.
function cellIdentity(cell: GameElement) {
  return {
    id: cell.id,
    name: cell.name,
    notation: cell.attributes?.notation as string | undefined,
  };
}

// ── Board interaction helpers for hex cells (all six required states) ────────
function isCellActionSelectable(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  if (boardInteraction.isSelected(cellIdentity(cell))) return false;
  return boardInteraction.isSelectableElement(cellIdentity(cell));
}

function isCellHighlighted(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isHighlighted(cellIdentity(cell));
}

function isCellBoardSelected(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isSelected(cellIdentity(cell));
}

function isCellDropTarget(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isDropTarget(cellIdentity(cell));
}

function isCellDisabled(cell: GameElement): boolean {
  if (!boardInteraction) return false;
  return boardInteraction.isDisabledElement(cellIdentity(cell)) !== false;
}

// A `drop` only fires on an element whose `dragover` called preventDefault().
// Without this handler the browser silently rejects every drop on a hex cell —
// mirrors GridBoardRenderer.handleDragOver for Custom-UI/Action-Panel parity.
function handleHexDragOver(event: DragEvent, cell: GameElement) {
  if (!boardInteraction?.isDragging) return;
  if (!isCellDropTarget(cell)) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = 'move';
}

function handleHexDrop(event: DragEvent, cell: GameElement) {
  if (!boardInteraction?.isDragging) return;
  event.preventDefault();
  boardInteraction.triggerDrop(cellIdentity(cell));
}

// Presentation overlay injection (D-04)
// HexBoardRenderer is a container — overlay affects the board header label.
// Hex cell pieces are rendered via ElementRenderer → their renderer handles their own overlay.
const overlay = inject<ComputedRef<PresentationOverlay | undefined>>('presentation');
const presentationEntry = computed(() =>
  resolvePresentation(props.element, overlay?.value)
);

// Display label for the board header — overlay label wins, then engine fallback
const displayLabel = computed(
  () => presentationEntry.value?.label ?? props.element.name ?? props.element.className
);

// ── A11Y-01: useSelectableGrid — roving tabindex for hex grid navigation ────
//
// hexCells: flat array of all hex cells (children of the board element)
// hexCols: width of the hex grid in cells (q-range + 1) for ArrowUp/Down row math
// The SVG root receives @keydown; each <g> receives :tabindex from currentIdx.
//
// NOTE (research Open Q3): tabindex on SVG <g> is spec-valid but Safari/VoiceOver
// may not reliably focus <g> elements. Ships with tabindex-on-g first.
// If manual VoiceOver/Safari testing fails, escalate to overlay <button> approach.
const hexCells = computed(() => props.element.children ?? []);

// Compute grid width as the q-coordinate range + 1 for roving-tabindex row math
// and for aria-colcount on the role="grid" SVG root (WR-02).
const hexCols = computed(() => {
  const cells = hexCells.value;
  if (!cells.length) return 1;
  let maxQ = -Infinity;
  let minQ = Infinity;
  for (const cell of cells) {
    const q = (cell.attributes?.[qCoordName.value] as number) ?? 0;
    maxQ = Math.max(maxQ, q);
    minQ = Math.min(minQ, q);
  }
  return maxQ - minQ + 1;
});

// Compute grid height as the r-coordinate range + 1 for aria-rowcount (WR-02).
const hexRows = computed(() => {
  const cells = hexCells.value;
  if (!cells.length) return 1;
  let maxR = -Infinity;
  let minR = Infinity;
  for (const cell of cells) {
    const r = (cell.attributes?.[rCoordName.value] as number) ?? 0;
    maxR = Math.max(maxR, r);
    minR = Math.min(minR, r);
  }
  return maxR - minR + 1;
});

const { currentIdx, focusCell, handleGridKeydown: _composableKeydown } = useSelectableGrid(
  hexCells,
  hexCols,
  cellIdentity,
  boardInteraction,
);

// DOM refs for each hex <g> cell — needed to call .focus() after arrow navigation
const hexCellRefs: (SVGGElement | null)[] = [];
function setHexCellRef(el: Element | null, idx: number) {
  hexCellRefs[idx] = el instanceof SVGGElement ? el : null;
}

// Hex cell activation: selectable AND passive selectElement branches.
// Called from both click and keyboard (Enter/Space) for consistent behavior.
function handleHexActivate(cell: GameElement) {
  if (!boardInteraction) return;
  if (isCellDisabled(cell)) return;
  if (boardInteraction.isSelectableElement(cellIdentity(cell))) {
    boardInteraction.triggerElementSelect(cellIdentity(cell));
  } else if (cell.name) {
    boardInteraction.selectElement(cellIdentity(cell));
  }
}

// SVG keydown handler: intercepts Enter/Space for activation,
// delegates Arrow/Home/End navigation to the composable.
function handleSvgKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    const cell = hexCells.value[currentIdx.value];
    if (cell) handleHexActivate(cell);
    e.preventDefault();
    return;
  }
  _composableKeydown(e);
  void nextTick(() => {
    hexCellRefs[currentIdx.value]?.focus();
  });
}

// Per-cell aria-label: coord + occupant names + state
function hexCellAriaLabel(cell: GameElement): string {
  const coord = cell.name
    ?? `(${cell.attributes?.[qCoordName.value] ?? '?'},${cell.attributes?.[rCoordName.value] ?? '?'})`;
  let state: string;
  if (isCellDisabled(cell)) state = 'unavailable';
  else if (isCellBoardSelected(cell)) state = 'selected';
  else if (isCellDropTarget(cell)) state = 'drop target';
  else if (isCellActionSelectable(cell)) state = 'selectable';
  else state = 'empty';
  const pieces = cell.children ?? [];
  const occupant = pieces.length > 0
    ? `, ${pieces.map(p => p.name ?? 'piece').join(', ')}`
    : '';
  return `${coord}${occupant}, ${state}`;
}
</script>

<template>
  <div class="hex-board-container">
    <div class="hex-board-header">{{ displayLabel }}</div>
    <!--
      SVG root: role="grid" (required ancestor for role="gridcell" cells, WR-02)
      + aria-rowcount/aria-colcount from the hex coordinate ranges
      + @keydown for roving-tabindex keyboard navigation (A11Y-01).

      MANUAL VERIFICATION REQUIRED (research Open Q3):
      tabindex="0" on SVG <g> is spec-valid; ships here first. Run a manual
      VoiceOver/Safari pass. If VO cannot land focus on hex <g> cells, escalate
      to transparent overlay <button> elements (position:absolute) over each hex.
    -->
    <svg
      class="hex-board-svg"
      :key="`hex-svg-${element.id}`"
      :viewBox="viewBox"
      :width="svgBounds.width"
      :height="svgBounds.height"
      preserveAspectRatio="xMidYMid meet"
      role="grid"
      :aria-label="displayLabel"
      :aria-rowcount="hexRows"
      :aria-colcount="hexCols"
      @keydown="handleSvgKeydown"
    >
      <!--
        One group per hex cell: polygon + piece tokens + coordinate label.
        role="gridcell" + roving tabindex (A11Y-01).
        MANUAL VERIFICATION: tabindex on SVG <g> — test with VoiceOver/Safari (Open Q3).
      -->
      <g
        v-for="(cell, idx) in hexCells"
        :key="cell.id"
        :ref="(el) => setHexCellRef(el as Element | null, idx)"
        class="hex-cell-group"
        role="gridcell"
        :tabindex="idx === currentIdx ? '0' : '-1'"
        :aria-label="hexCellAriaLabel(cell)"
        :aria-selected="isCellBoardSelected(cell) || undefined"
        :aria-disabled="isCellDisabled(cell) || undefined"
        :transform="`translate(${getCellPosition(cell).x}, ${getCellPosition(cell).y})`"
        @focus="focusCell(idx)"
        @click="handleHexActivate(cell)"
        @dragover="handleHexDragOver($event, cell)"
        @drop="handleHexDrop($event, cell)"
      >
        <!-- Hex polygon with board-interaction state classes (all six required states) -->
        <polygon
          :points="hexPoints"
          class="hex-polygon"
          :class="{
            'has-children': (cell.children?.length ?? 0) > 0,
            'action-selectable': isCellActionSelectable(cell),
            'is-board-highlighted': isCellHighlighted(cell),
            'is-board-selected': isCellBoardSelected(cell),
            'is-drop-target': isCellDropTarget(cell),
            'is-disabled': isCellDisabled(cell),
          }"
        />

        <!--
          Piece tokens: color circle + non-color seat glyph (text) + title.
          The glyph conveys seat ownership without relying on color alone
          (WCAG 1.4.1 Use of Color). aria-hidden on the group because the
          cell's own aria-label includes occupant names.
        -->
        <g
          v-for="(piece, pieceIndex) in (cell.children ?? [])"
          :key="piece.id"
          class="hex-piece-group"
          aria-hidden="true"
        >
          <circle
            :r="pieceRadius"
            class="hex-piece-circle"
            :style="{ fill: getPieceColor(piece, pieceIndex) }"
          />
          <!-- Non-color seat glyph: seat number rendered inside the token -->
          <text
            class="hex-piece-glyph"
            text-anchor="middle"
            dominant-baseline="middle"
          >{{ getPieceGlyph(piece) }}</text>
          <title>{{ piece.name }}</title>
        </g>

        <!-- Coordinate label: cell.name as SVG text, pointer-events none -->
        <text
          v-if="cell.name"
          class="hex-label"
          text-anchor="middle"
          dominant-baseline="middle"
          :y="hexSize * 0.7"
        >{{ cell.name }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
/* ── Container ── */
.hex-board-container {
  background: var(--bsg-surface);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  min-height: 0;
  max-width: 100%;
}

.hex-board-header {
  font-weight: bold;
  color: var(--bsg-ink);
  margin-bottom: 12px;
  flex: none;
}

/* ── SVG: scales to container, never exceeds it in either dimension ── */
.hex-board-svg {
  max-width: 100%;
  max-height: 100%;
  height: auto;
  width: auto;
}

.hex-cell-group {
  cursor: pointer;
}

/* ── Hex polygon states (UI-SPEC §HexBoardRenderer) ── */
.hex-polygon {
  fill: var(--bsg-cell);
  stroke: var(--bsg-cell-line);
  stroke-width: 1.5;
  transition: all 0.15s ease;
}

.hex-polygon:hover {
  fill: var(--bsg-selectable);
  stroke: var(--bsg-accent);
}

.hex-polygon.has-children {
  fill: var(--bsg-surface-2);
}

/* Dashed stroke signals selectable — SVG stroke is the outline equivalent for polygons */
.hex-polygon.action-selectable {
  fill: var(--bsg-selectable);
  stroke: var(--bsg-accent);
  stroke-width: 2;
  stroke-dasharray: 4 2;
}

.hex-polygon.action-selectable:hover {
  fill: var(--bsg-droptarget-hover);
}

.hex-polygon.is-board-highlighted {
  fill: var(--bsg-selectable);
  stroke: var(--bsg-accent);
  stroke-width: 2;
}

.hex-polygon.is-board-selected {
  fill: var(--bsg-selected);
  stroke: var(--bsg-accent);
  stroke-width: 2.5;
}

/* Dotted stroke signals drop target — matches accent-2 per Slate pattern */
.hex-polygon.is-drop-target {
  fill: var(--bsg-droptarget);
  stroke: var(--bsg-accent-2);
  stroke-width: 2;
  stroke-dasharray: 3 2;
}

/* Disabled state — stroke-dasharray pattern for SVG (A11Y-09: non-color cue).
   SVG polygons cannot use CSS background-image; use a dashed stroke to signal disabled
   without relying on opacity alone. aria-disabled is already set on the parent <g>. */
.hex-polygon.is-disabled {
  opacity: 0.4;
  stroke: var(--bsg-ink-3);
  stroke-width: 2;
  stroke-dasharray: 4 3;
  cursor: not-allowed;
}

.hex-polygon.is-disabled:hover {
  fill: var(--bsg-cell);
  stroke: var(--bsg-ink-3);
}

/* ── Hex piece groups ── */
.hex-piece-group {
  pointer-events: none;
}

/* ── Hex piece circles ── */
.hex-piece-circle {
  fill: var(--bsg-ink-3);
  stroke: rgba(0, 0, 0, 0.3);
  stroke-width: 2;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  transition: transform 0.15s ease;
}

.hex-piece-group:hover .hex-piece-circle {
  transform: scale(1.05);
}

/* ── Non-color seat glyph (A11Y WCAG 1.4.1 Use of Color) ── */
.hex-piece-glyph {
  font-size: 11px;
  fill: var(--bsg-surface);
  pointer-events: none;
  font-weight: bold;
}

/* ── Hex coordinate labels ── */
.hex-label {
  font-size: 12px;
  fill: var(--bsg-ink-3);
  pointer-events: none;
}
</style>
