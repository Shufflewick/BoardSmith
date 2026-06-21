import { describe, it, expect } from 'vitest';
import { resolvePieceVisual, resolveGridSize } from './auto-ui-helpers.js';
import type { PieceVisual, GridResult } from './auto-ui-helpers.js';

// ---------------------------------------------------------------------------
// Minimal GameElement interface for test factories (mirrors auto-ui-helpers.ts)
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
// Factory helpers
// ---------------------------------------------------------------------------
function buildPiece(attributes: Record<string, unknown> = {}): GameElement {
  return { id: 1, className: 'Piece', name: 'pawn', attributes, children: [] };
}

function buildBoard(
  attributes: Record<string, unknown>,
  children: GameElement[] = [],
): GameElement {
  return { id: 2, className: 'Board', name: 'board', attributes, children };
}

function buildCell(
  row: number,
  col: number,
  rowAttr = 'row',
  colAttr = 'col',
): GameElement {
  return {
    id: Math.floor(Math.random() * 100000),
    className: 'Cell',
    attributes: { [rowAttr]: row, [colAttr]: col },
    children: [],
  };
}

// ---------------------------------------------------------------------------
// resolvePieceVisual
// ---------------------------------------------------------------------------
describe('resolvePieceVisual', () => {
  it('returns kind:image for a bare-string $images URL', () => {
    const piece = buildPiece({ $images: 'http://x/p.png' });
    const result = resolvePieceVisual(piece);
    expect(result.kind).toBe('image');
    expect((result as { kind: 'image'; src: string }).src).toBe('http://x/p.png');
  });

  it('returns kind:image when $images is an object with a string .face', () => {
    const piece = buildPiece({ $images: { face: 'http://x/p.png' } });
    const result = resolvePieceVisual(piece);
    expect(result.kind).toBe('image');
    expect((result as { kind: 'image'; src: string }).src).toBe('http://x/p.png');
  });

  it('returns kind:sprite when $images.face is a sprite object — uses its own width/height, NOT 238/333', () => {
    const piece = buildPiece({
      $images: { face: { sprite: 's.png', x: 40, y: 80, width: 40, height: 40 } },
    });
    const result = resolvePieceVisual(piece);
    expect(result.kind).toBe('sprite');
    const s = result as { kind: 'sprite'; sprite: string; x: number; y: number; width: number; height: number };
    expect(s.sprite).toBe('s.png');
    expect(s.x).toBe(40);
    expect(s.y).toBe(80);
    expect(s.width).toBe(40);
    expect(s.height).toBe(40);
  });

  it('returns kind:token with player.color when no $images is present', () => {
    const piece = buildPiece({ player: { __playerRef: 1, seat: 0, color: '#ff0000', name: 'Alice' } });
    const result = resolvePieceVisual(piece);
    expect(result.kind).toBe('token');
    const t = result as { kind: 'token'; color: string; label: string };
    expect(t.color).toBe('#ff0000');
    expect(t.label).toBe('pawn'); // element.name
  });

  it('returns kind:token with #888888 when no $images and no owner', () => {
    const piece = buildPiece({}); // no $images, no player
    const result = resolvePieceVisual(piece);
    expect(result.kind).toBe('token');
    const t = result as { kind: 'token'; color: string; label: string };
    expect(t.color).toBe('#888888');
    // label falls back to element.name ('pawn') since name is defined
    expect(t.label).toBe('pawn');
  });

  it('uses className as label when element.name is absent', () => {
    const piece: GameElement = { id: 9, className: 'Knight', attributes: {}, children: [] };
    const result = resolvePieceVisual(piece);
    expect(result.kind).toBe('token');
    expect((result as { kind: 'token'; label: string }).label).toBe('Knight');
  });
});

// ---------------------------------------------------------------------------
// resolveGridSize
// ---------------------------------------------------------------------------
describe('resolveGridSize', () => {
  it('returns {ok:true, rows, cols} from explicit $rowCoord/$colCoord', () => {
    const board = buildBoard(
      { $rowCoord: 'row', $colCoord: 'col' },
      [
        buildCell(0, 0),
        buildCell(2, 3),
      ],
    );
    const result = resolveGridSize(board);
    expect(result.ok).toBe(true);
    const g = result as { ok: true; rows: number; cols: number };
    expect(g.rows).toBe(3); // max row=2, so 2+1
    expect(g.cols).toBe(4); // max col=3, so 3+1
  });

  it('returns {ok:true, rows:0, cols:0} for an explicitly-declared but empty grid', () => {
    const board = buildBoard({ $rowCoord: 'row', $colCoord: 'col' }, []);
    const result = resolveGridSize(board);
    expect(result.ok).toBe(true);
    const g = result as { ok: true; rows: number; cols: number };
    expect(g.rows).toBe(0);
    expect(g.cols).toBe(0);
  });

  it('returns {ok:true, rows, cols} from inferred numeric child coordinates when no explicit coords', () => {
    // Children have numeric attributes: 'r' and 'c' (first two non-underscore numerics)
    const children = [
      buildCell(0, 0, 'r', 'c'),
      buildCell(1, 2, 'r', 'c'),
      buildCell(3, 1, 'r', 'c'),
    ];
    const board = buildBoard({}, children); // no $rowCoord/$colCoord
    const result = resolveGridSize(board);
    expect(result.ok).toBe(true);
    const g = result as { ok: true; rows: number; cols: number };
    expect(g.rows).toBe(4); // max r=3, so 3+1
    expect(g.cols).toBe(3); // max c=2, so 2+1
  });

  it('returns {ok:false, error} when children are present but no resolvable coord system', () => {
    // Children have only string attributes — no numeric coords to infer from
    const children: GameElement[] = [
      { id: 10, className: 'Cell', attributes: { name: 'x' }, children: [] },
      { id: 11, className: 'Cell', attributes: { name: 'y' }, children: [] },
    ];
    const board = buildBoard({}, children); // no $rowCoord/$colCoord, no numeric child attrs
    const result = resolveGridSize(board);
    expect(result.ok).toBe(false);
    const err = result as { ok: false; error: string };
    // Must name the element and contain the exact prop hint
    expect(err.error).toContain('board'); // element.name
    expect(err.error).toContain('$rowCoord/$colCoord');
  });

  it('error string matches exact D-03 literal including em-dash', () => {
    const children: GameElement[] = [
      { id: 20, className: 'Cell', attributes: { name: 'x' }, children: [] },
    ];
    const board = buildBoard({}, children);
    const result = resolveGridSize(board);
    expect(result.ok).toBe(false);
    const { error } = result as { ok: false; error: string };
    expect(error).toBe(
      `Grid "board" can't render — declare $rowCoord/$colCoord on the Grid element`,
    );
  });
});
