<script setup lang="ts">
/**
 * HexBoardRenderer — SVG hex board renderer for $layout='hex-grid' elements.
 *
 * All layout math uses the standalone closed-form functions from useHexGrid:
 *   hexToPixel — converts q/r coordinates to pixel position
 *   getHexPolygonPoints — generates SVG polygon points string
 *
 * No hand-rolled trig: never re-implement the closed-form functions here.
 */

import { computed, inject, type ComputedRef } from 'vue';
import { hexToPixel, getHexPolygonPoints } from '../../../composables/useHexGrid.js';
import { tryUseBoardInteraction } from '../../../composables/useBoardInteraction.js';
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

function handleHexClick(cell: GameElement) {
  if (!boardInteraction) return;
  if (isCellDisabled(cell)) return;
  if (boardInteraction.isSelectableElement(cellIdentity(cell))) {
    boardInteraction.triggerElementSelect(cellIdentity(cell));
  } else if (cell.name) {
    boardInteraction.selectElement(cellIdentity(cell));
  }
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
</script>

<template>
  <div class="hex-board-container">
    <div class="hex-board-header">{{ displayLabel }}</div>
    <svg
      class="hex-board-svg"
      :key="`hex-svg-${element.id}`"
      :viewBox="viewBox"
      :width="svgBounds.width"
      :height="svgBounds.height"
      preserveAspectRatio="xMidYMid meet"
    >
      <!-- One group per hex cell: polygon + piece circles + coordinate label -->
      <g
        v-for="cell in (element.children ?? [])"
        :key="cell.id"
        class="hex-cell-group"
        :transform="`translate(${getCellPosition(cell).x}, ${getCellPosition(cell).y})`"
        @click="handleHexClick(cell)"
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

        <!-- Piece circles (SVG, no foreignObject) — player color cycle per UI-SPEC -->
        <circle
          v-for="(piece, pieceIndex) in (cell.children ?? [])"
          :key="piece.id"
          :r="pieceRadius"
          class="hex-piece-circle"
          :style="{ fill: getPieceColor(piece, pieceIndex) }"
        >
          <title>{{ piece.name }}</title>
        </circle>

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

.hex-polygon.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.hex-polygon.is-disabled:hover {
  fill: var(--bsg-cell);
  stroke: var(--bsg-cell-line);
}

/* ── Hex piece circles ── */
.hex-piece-circle {
  fill: var(--bsg-ink-3);
  stroke: rgba(0, 0, 0, 0.3);
  stroke-width: 2;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  transition: transform 0.15s ease;
}

.hex-piece-circle:hover {
  transform: scale(1.05);
}

/* ── Hex coordinate labels ── */
.hex-label {
  font-size: 12px;
  fill: var(--bsg-ink-3);
  pointer-events: none;
}
</style>
