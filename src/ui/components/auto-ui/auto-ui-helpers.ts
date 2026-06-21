/**
 * auto-ui-helpers — Internal rendering helpers for the auto-UI system.
 *
 * These are pure functions: no Vue reactivity, no DOM access.
 * Shared by all per-element renderers (CardRenderer, PieceRenderer, etc.).
 */

// ---------------------------------------------------------------------------
// Minimal GameElement interface (mirrors ElementRenderer local definition)
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

// ---------------------------------------------------------------------------
// PieceVisual — discriminated union returned by resolvePieceVisual
// ---------------------------------------------------------------------------
export type PieceVisual =
  | { kind: 'image'; src: string }
  | { kind: 'sprite'; sprite: string; x: number; y: number; width: number; height: number }
  | { kind: 'token'; color: string; label: string };

// ---------------------------------------------------------------------------
// GridResult — discriminated union returned by resolveGridSize
// ---------------------------------------------------------------------------
export type GridResult =
  | { ok: true; rows: number; cols: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// resolvePieceVisual
//
// Reads element.attributes.$images and returns a render-ready discriminated
// union. Piece sprites use their own width/height — do NOT fall back to
// card-native constants (which are only correct for cards, not pieces).
// ---------------------------------------------------------------------------
export function resolvePieceVisual(element: GameElement): PieceVisual {
  const attrs = element.attributes ?? {};
  const images = attrs.$images;

  // Bare string: treat as face image URL (D-04: bare string is valid $images)
  if (typeof images === 'string') {
    return { kind: 'image', src: images };
  }

  // Object: look for .face key (card convention reused for pieces per D-04)
  if (images !== null && typeof images === 'object') {
    const imagesObj = images as Record<string, unknown>;
    const face = imagesObj['face'];

    // .face is a plain URL string
    if (typeof face === 'string') {
      return { kind: 'image', src: face };
    }

    // .face is a sprite-sheet descriptor object
    if (face !== null && typeof face === 'object') {
      const s = face as {
        sprite?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      };
      if (
        s.sprite &&
        typeof s.x === 'number' &&
        typeof s.y === 'number' &&
        typeof s.width === 'number' &&
        typeof s.height === 'number'
      ) {
        // Use the sprite object's own width/height — not card-native dimensions (Pitfall 5)
        return {
          kind: 'sprite',
          sprite: s.sprite,
          x: s.x,
          y: s.y,
          width: s.width,
          height: s.height,
        };
      }
    }
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
// Returns the grid dimensions needed to render a board element, or an
// actionable error when coordinates cannot be resolved.
//
// Resolution order (D-02):
//   1. Explicit $rowCoord/$colCoord — checked BEFORE children-length guard
//      so an empty-but-declared grid returns {ok:true, rows:0, cols:0} (Pitfall 6)
//   2. Inferred: first two numeric, non-underscore-prefixed attributes on first child
//   3. Neither available → {ok:false, error} (D-03): no exceptions emitted
//
// Grid size resolution for grid board elements.
// ---------------------------------------------------------------------------
export function resolveGridSize(element: GameElement): GridResult {
  const attrs = element.attributes ?? {};
  const children = element.children ?? [];

  const rowCoord = attrs.$rowCoord as string | undefined;
  const colCoord = attrs.$colCoord as string | undefined;

  // Path 1: explicit $rowCoord/$colCoord — checked FIRST, before children-length guard
  // This ensures an empty but properly configured grid returns {ok:true, rows:0, cols:0}
  if (rowCoord && colCoord) {
    if (children.length === 0) {
      return { ok: true, rows: 0, cols: 0 };
    }
    let maxRow = 0;
    let maxCol = 0;
    for (const child of children) {
      const ca = child.attributes ?? {};
      const rowVal = ca[rowCoord];
      const colVal = ca[colCoord];
      if (typeof rowVal === 'number') maxRow = Math.max(maxRow, rowVal);
      if (typeof colVal === 'number') maxCol = Math.max(maxCol, colVal);
    }
    return { ok: true, rows: maxRow + 1, cols: maxCol + 1 };
  }

  // Path 2: infer from first child's first two numeric, non-underscore-prefixed attributes
  if (children.length > 0) {
    const firstChild = children[0];
    const numericAttrs = Object.entries(firstChild.attributes ?? {})
      .filter(([k, v]) => typeof v === 'number' && !k.startsWith('_'))
      .map(([k]) => k)
      .slice(0, 2);

    if (numericAttrs.length >= 2) {
      const [first, second] = numericAttrs;
      let maxFirst = 0;
      let maxSecond = 0;
      for (const child of children) {
        const ca = child.attributes ?? {};
        const firstVal = ca[first];
        const secondVal = ca[second];
        if (typeof firstVal === 'number') maxFirst = Math.max(maxFirst, firstVal);
        if (typeof secondVal === 'number') maxSecond = Math.max(maxSecond, secondVal);
      }
      return { ok: true, rows: maxFirst + 1, cols: maxSecond + 1 };
    }
  }

  // Path 3: neither coordinate path resolved — loud error (D-02, D-03)
  // Error string names the element and the props to add; no file paths or stack traces
  return {
    ok: false,
    error: `Grid "${element.name ?? element.id}" can't render — declare $rowCoord/$colCoord on the Grid element`,
  };
}
