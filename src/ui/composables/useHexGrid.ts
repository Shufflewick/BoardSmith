/**
 * useHexGrid - Utilities for hexagonal grid-based game boards
 *
 * Provides helpers for working with hex-based games like Hex, Settlers of Catan,
 * Hive, and other games using hexagonal tiles.
 *
 * Supports both coordinate systems:
 * - Axial coordinates (q, r) - most common for hex grids
 * - Cube coordinates (x, y, z) where x + y + z = 0
 *
 * And both orientations:
 * - Pointy-top (flat sides on left/right)
 * - Flat-top (flat sides on top/bottom)
 *
 * ## Usage
 *
 * ```typescript
 * import { useHexGrid } from '@boardsmith/ui';
 *
 * const props = defineProps<{ gameView: GameElement; playerSeat: number }>();
 *
 * const {
 *   board,
 *   cells,
 *   hexSize,
 *   getHexPosition,
 *   getHexPoints,
 *   hexGridBounds,
 *   getCellAt,
 * } = useHexGrid({
 *   gameView: () => props.gameView,
 *   boardClassName: 'Board',
 *   cellClassName: 'Cell',
 *   qAttr: 'q',
 *   rAttr: 'r',
 * });
 *
 * // Get pixel position for a hex cell
 * const pos = getHexPosition(2, 3);
 *
 * // Get SVG polygon points for rendering
 * const points = getHexPoints(); // or getHexPoints(0.85) for inner hex
 * ```
 */

import { computed, type ComputedRef } from 'vue';
import { findElement } from './useGameViewHelpers.js';
import type { GameElement, BaseElementAttributes } from '../types.js';

// Re-export GameElement for backwards compatibility
export type { GameElement };

export type HexOrientation = 'pointy' | 'flat';

export interface HexGridOptions {
  /** Function that returns the current game view */
  gameView: () => GameElement | null | undefined;
  /** Class name of the board element (default: 'Board') */
  boardClassName?: string;
  /** Class name of cell elements (default: 'Cell') */
  cellClassName?: string;
  /** Attribute name for q coordinate (default: 'q') */
  qAttr?: string;
  /** Attribute name for r coordinate (default: 'r') */
  rAttr?: string;
  /** Default hex size in pixels (default: 50, can be overridden by board attributes) */
  defaultHexSize?: number;
  /** Default orientation (default: 'pointy', can be overridden by board attributes) */
  defaultOrientation?: HexOrientation;
}

export interface HexPosition {
  x: number;
  y: number;
}

export interface HexBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface HexGridReturn<TCell = GameElement> {
  /** The board element */
  board: ComputedRef<GameElement | null | undefined>;
  /** All cell elements */
  cells: ComputedRef<TCell[]>;
  /** Current hex size (from board attributes or default) */
  hexSize: ComputedRef<number>;
  /** Current orientation (from board attributes or default) */
  orientation: ComputedRef<HexOrientation>;
  /** Map of cells keyed by "q,r" */
  cellMap: ComputedRef<Map<string, TCell>>;
  /** Get the key for a q/r position */
  getKey: (q: number, r: number) => string;
  /** Get cell at q/r coordinates */
  getCellAt: (q: number, r: number) => TCell | undefined;
  /** Get first child of a specific class at q/r */
  getChildAt: (q: number, r: number, className: string) => GameElement | undefined;
  /** Get all children of a specific class at q/r */
  getChildrenAt: (q: number, r: number, className: string) => GameElement[];
  /** Convert axial coordinates to pixel position */
  getHexPosition: (q: number, r: number) => HexPosition;
  /** Generate SVG polygon points for a hex (scale 1.0 = full size) */
  getHexPoints: (scale?: number) => string;
  /** Calculate SVG viewBox bounds for all cells */
  hexGridBounds: ComputedRef<HexBounds>;
  /** Convert axial to cube coordinates */
  axialToCube: (q: number, r: number) => { x: number; y: number; z: number };
  /** Convert cube to axial coordinates */
  cubeToAxial: (x: number, y: number, z: number) => { q: number; r: number };
  /** Get hex distance between two cells (in hex steps) */
  hexDistance: (q1: number, r1: number, q2: number, r2: number) => number;
  /** Get neighboring hex coordinates */
  getNeighbors: (q: number, r: number) => Array<{ q: number; r: number }>;
  /** Iterate over all cells */
  iterateCells: () => IterableIterator<[string, TCell]>;
  /** Find all cells matching a predicate */
  findCells: (predicate: (cell: TCell, q: number, r: number) => boolean) => TCell[];
}

// Neighbor offsets for axial coordinates
const POINTY_NEIGHBORS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const FLAT_NEIGHBORS = POINTY_NEIGHBORS; // Same offsets work for both orientations

/**
 * Create hex grid utilities for a hexagonal game board.
 */
export function useHexGrid<TCell = GameElement>(
  options: HexGridOptions
): HexGridReturn<TCell> {
  const {
    gameView,
    boardClassName = 'Board',
    cellClassName = 'Cell',
    qAttr = 'q',
    rAttr = 'r',
    defaultHexSize = 50,
    defaultOrientation = 'pointy',
  } = options;

  // Find the board element
  const board = computed(() => {
    const view = gameView();
    if (!view) return null;
    return findElement(view, { className: boardClassName });
  });

  /** Helper to get typed attributes */
  function getAttrs(element: GameElement): BaseElementAttributes & Record<string, unknown> {
    return (element.attributes ?? {}) as BaseElementAttributes & Record<string, unknown>;
  }

  // Get hex properties from board attributes
  const hexSize = computed(() => {
    if (!board.value) return defaultHexSize;
    const attrs = getAttrs(board.value);
    return attrs.$hexSize ?? defaultHexSize;
  });

  const orientation = computed<HexOrientation>(() => {
    if (!board.value) return defaultOrientation;
    const attrs = getAttrs(board.value);
    return attrs.$hexOrientation ?? defaultOrientation;
  });

  // Get all cells
  const cells = computed<TCell[]>(() => {
    if (!board.value?.children) return [];
    return board.value.children.filter(
      (c) => c.className === cellClassName
    ) as unknown as TCell[];
  });

  // Build a map of cells keyed by "q,r"
  const cellMap = computed<Map<string, TCell>>(() => {
    const map = new Map<string, TCell>();
    for (const cell of cells.value) {
      const attrs = getAttrs(cell as unknown as GameElement);
      const q = attrs[qAttr as keyof typeof attrs];
      const r = attrs[rAttr as keyof typeof attrs];
      if (q !== undefined && r !== undefined) {
        map.set(`${q},${r}`, cell);
      }
    }
    return map;
  });

  function getKey(q: number, r: number): string {
    return `${q},${r}`;
  }

  function getCellAt(q: number, r: number): TCell | undefined {
    return cellMap.value.get(getKey(q, r));
  }

  function getChildAt(q: number, r: number, className: string): GameElement | undefined {
    const cell = getCellAt(q, r) as GameElement | undefined;
    if (!cell?.children) return undefined;
    return cell.children.find((c) => c.className === className);
  }

  function getChildrenAt(q: number, r: number, className: string): GameElement[] {
    const cell = getCellAt(q, r) as GameElement | undefined;
    if (!cell?.children) return [];
    return cell.children.filter((c) => c.className === className);
  }

  /**
   * Convert axial coordinates (q, r) to pixel position.
   * Uses the current hexSize and orientation from board attributes.
   */
  function getHexPosition(q: number, r: number): HexPosition {
    const size = hexSize.value;
    const orient = orientation.value;

    if (orient === 'pointy') {
      return {
        x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
        y: size * ((3 / 2) * r),
      };
    } else {
      // flat-top
      return {
        x: size * ((3 / 2) * q),
        y: size * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r),
      };
    }
  }

  /**
   * Generate SVG polygon points for a hexagon.
   * @param scale - Scale factor (1.0 = full size, 0.85 = inner hex for borders)
   */
  function getHexPoints(scale: number = 1): string {
    const size = hexSize.value * scale;
    const orient = orientation.value;
    const points: string[] = [];

    for (let i = 0; i < 6; i++) {
      const angleDeg = orient === 'pointy' ? 60 * i - 30 : 60 * i;
      const angleRad = (Math.PI / 180) * angleDeg;
      const x = size * Math.cos(angleRad);
      const y = size * Math.sin(angleRad);
      points.push(`${x},${y}`);
    }

    return points.join(' ');
  }

  /**
   * Calculate SVG viewBox bounds that contain all cells.
   */
  const hexGridBounds = computed<HexBounds>(() => {
    const cellList = cells.value;
    if (!cellList.length) {
      return { minX: 0, minY: 0, width: 400, height: 400 };
    }

    const size = hexSize.value;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const cell of cellList) {
      const attrs = getAttrs(cell as unknown as GameElement);
      const q = (attrs[qAttr as keyof typeof attrs] as number | undefined) ?? 0;
      const r = (attrs[rAttr as keyof typeof attrs] as number | undefined) ?? 0;
      const pos = getHexPosition(q, r);

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

  /**
   * Convert axial coordinates to cube coordinates.
   */
  function axialToCube(q: number, r: number): { x: number; y: number; z: number } {
    const x = q;
    const z = r;
    const y = -x - z;
    return { x, y, z };
  }

  /**
   * Convert cube coordinates to axial coordinates.
   */
  function cubeToAxial(x: number, _y: number, z: number): { q: number; r: number } {
    return { q: x, r: z };
  }

  /**
   * Calculate hex distance between two cells (number of hex steps).
   */
  function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
    const a = axialToCube(q1, r1);
    const b = axialToCube(q2, r2);
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
  }

  /**
   * Get the six neighboring hex coordinates.
   */
  function getNeighbors(q: number, r: number): Array<{ q: number; r: number }> {
    const neighbors = orientation.value === 'pointy' ? POINTY_NEIGHBORS : FLAT_NEIGHBORS;
    return neighbors.map((offset) => ({
      q: q + offset.q,
      r: r + offset.r,
    }));
  }

  function* iterateCells(): IterableIterator<[string, TCell]> {
    yield* cellMap.value.entries();
  }

  function findCells(predicate: (cell: TCell, q: number, r: number) => boolean): TCell[] {
    const results: TCell[] = [];
    for (const [key, cell] of cellMap.value) {
      const [qStr, rStr] = key.split(',');
      const q = parseInt(qStr, 10);
      const r = parseInt(rStr, 10);
      if (predicate(cell, q, r)) {
        results.push(cell);
      }
    }
    return results;
  }

  return {
    board,
    cells,
    hexSize,
    orientation,
    cellMap,
    getKey,
    getCellAt,
    getChildAt,
    getChildrenAt,
    getHexPosition,
    getHexPoints,
    hexGridBounds,
    axialToCube,
    cubeToAxial,
    hexDistance,
    getNeighbors,
    iterateCells,
    findCells,
  };
}

/**
 * Standalone hex position calculation (for use without the full composable).
 */
export function hexToPixel(
  q: number,
  r: number,
  hexSize: number,
  orientation: HexOrientation = 'pointy'
): HexPosition {
  if (orientation === 'pointy') {
    return {
      x: hexSize * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
      y: hexSize * ((3 / 2) * r),
    };
  } else {
    return {
      x: hexSize * ((3 / 2) * q),
      y: hexSize * ((Math.sqrt(3) / 2) * q + Math.sqrt(3) * r),
    };
  }
}

/**
 * Standalone hex polygon points generation.
 */
export function getHexPolygonPoints(
  hexSize: number,
  orientation: HexOrientation = 'pointy',
  scale: number = 1
): string {
  const size = hexSize * scale;
  const points: string[] = [];

  for (let i = 0; i < 6; i++) {
    const angleDeg = orientation === 'pointy' ? 60 * i - 30 : 60 * i;
    const angleRad = (Math.PI / 180) * angleDeg;
    const x = size * Math.cos(angleRad);
    const y = size * Math.sin(angleRad);
    points.push(`${x},${y}`);
  }

  return points.join(' ');
}

/**
 * Calculate hex distance between two axial coordinates.
 */
export function calculateHexDistance(q1: number, r1: number, q2: number, r2: number): number {
  // Convert to cube coordinates and use cube distance
  const x1 = q1, z1 = r1, y1 = -x1 - z1;
  const x2 = q2, z2 = r2, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}
