/**
 * auto-ui-helpers — Internal rendering helpers for the auto-UI system.
 *
 * These are pure functions: no Vue reactivity, no DOM access.
 * Shared by all per-element renderers (CardRenderer, PieceRenderer, etc.).
 */
import type { InjectionKey } from 'vue';
import type { ElementRef } from '../../composables/useBoardInteraction.js';
import { parseImageInfo, type ImageInfo } from '../../utils/image.js';

// ---------------------------------------------------------------------------
// GameElement: the element shape every auto-UI module reads (dependency-free)
// ---------------------------------------------------------------------------
export interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

/** The grid cell an element stands on, provided by ElementRenderer for a piece to drag on its behalf (#943). */
export const STANDS_ON_KEY: InjectionKey<() => ElementRef | undefined> = Symbol('bs:standsOn');

// ---------------------------------------------------------------------------
// PieceVisual — discriminated union returned by resolvePieceVisual
// ---------------------------------------------------------------------------
export type PieceVisual =
  | { kind: 'image'; src: string }
  | { kind: 'sprite'; image: Extract<ImageInfo, { type: 'sprite' }> }
  | { kind: 'token'; color: string; label: string };

// ---------------------------------------------------------------------------
// GridResult — discriminated union returned by resolveGridSize
// ---------------------------------------------------------------------------
export type GridResult =
  | { ok: true; rows: number; cols: number; position: (cell: GameElement) => { row: number; col: number } }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// resolvePieceVisual
//
// Reads element.attributes.$images and returns a render-ready discriminated
// union. A sprite is drawn with getSpriteStyle, filling the piece's CSS box (#1020).
// ---------------------------------------------------------------------------
export function resolvePieceVisual(element: GameElement): PieceVisual {
  const attrs = element.attributes ?? {};
  const images = attrs.$images;

  // Bare string: treat as face image URL (D-04: bare string is valid $images)
  if (typeof images === 'string') {
    return { kind: 'image', src: images };
  }

  // Object: .face is a URL or a sprite descriptor (card convention reused for pieces per D-04)
  if (images !== null && typeof images === 'object') {
    const face = parseImageInfo((images as Record<string, unknown>).face);
    if (face?.type === 'url') return { kind: 'image', src: face.src };
    if (face?.type === 'sprite') return { kind: 'sprite', image: face };
  }

  // No image — return colored token (D-05)
  // Player color comes from the engine-serialized player attribute shape:
  //   { __playerRef, seat, color?, name? }  (game-element.ts:773–776)
  const player = attrs.player as { color?: string } | undefined;
  return {
    kind: 'token',
    color: player?.color ?? '#888888', // neutral per UI-SPEC; #888888 matches hex-piece-circle neutral
    label: element.name ?? element.className,
  };
}

// ---------------------------------------------------------------------------
// resolveGridSize
//
// Returns the grid dimensions and each cell's 0-based position, read from the
// coordinate attributes the Grid declares ($rowCoord/$colCoord) and offset by
// their minimum, or an actionable error. Never guesses coordinate names and
// never uses tree order: boards built column by column or with gaps are common.
// ---------------------------------------------------------------------------
export function resolveGridSize(element: GameElement): GridResult {
  const rowCoord = element.attributes?.$rowCoord as string | undefined;
  const colCoord = element.attributes?.$colCoord as string | undefined;
  if (!rowCoord || !colCoord) {
    return { ok: false, error: `${cantRender(element)} — declare $rowCoord/$colCoord on the Grid element` };
  }
  const error = cellCoordinateError(element, rowCoord, colCoord);
  if (error) return { ok: false, error };
  const children = element.children ?? [];
  const coord = (cell: GameElement, name: string) => cell.attributes![name] as number;
  const [minRow, rows] = span(children.map((c) => coord(c, rowCoord)));
  const [minCol, cols] = span(children.map((c) => coord(c, colCoord)));
  return {
    ok: true,
    rows,
    cols,
    position: (cell) => ({ row: coord(cell, rowCoord) - minRow, col: coord(cell, colCoord) - minCol }),
  };
}

const cantRender = (grid: GameElement) => `Grid "${grid.name ?? grid.id}" can't render`;

/** Why a grid's cells cannot be placed, or undefined when every cell has both declared coordinates. */
function cellCoordinateError(element: GameElement, rowCoord: string, colCoord: string): string | undefined {
  for (const child of element.children ?? []) {
    const missing = [rowCoord, colCoord].find((name) => typeof child.attributes?.[name] !== 'number');
    if (missing) {
      return `${cantRender(element)}: cell "${child.name ?? child.id}" has no numeric "${missing}"; give every cell numeric ${rowCoord} and ${colCoord} values`;
    }
  }
  return undefined;
}

/** [minimum, count from minimum to maximum inclusive] of some coordinates; [0, 0] for none. */
function span(values: number[]): [number, number] {
  if (values.length === 0) return [0, 0];
  const min = values.reduce((a, b) => Math.min(a, b));
  const max = values.reduce((a, b) => Math.max(a, b));
  return [min, max - min + 1];
}
