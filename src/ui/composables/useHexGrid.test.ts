/**
 * Hex-grid geometry and lookup for custom UIs (Hex, Catan-likes). The pixel
 * maths decides where every tile lands on the SVG board, so an off-by-one in
 * the axial→pixel conversion is a visibly broken board.
 */
import { describe, it, expect } from 'vitest';
import {
  useHexGrid,
  hexToPixel,
  getHexPolygonPoints,
  calculateHexDistance,
} from './useHexGrid.js';
import type { GameElement } from '../types.js';

const cell = (q: number, r: number, children: GameElement[] = []): GameElement => ({
  id: q * 100 + r,
  className: 'Cell',
  name: `${q},${r}`,
  attributes: { q, r },
  children,
} as GameElement);

const piece = (className: string, id: number): GameElement =>
  ({ id, className, name: className, attributes: {}, children: [] } as GameElement);

const gameView = (cells: GameElement[], boardAttrs: Record<string, unknown> = {}): GameElement =>
  ({
    id: 1,
    className: 'Game',
    name: 'game',
    attributes: {},
    children: [{
      id: 2,
      className: 'Board',
      name: 'board',
      attributes: boardAttrs,
      children: cells,
    }],
  } as GameElement);

const grid = (view: GameElement | null, options = {}) =>
  useHexGrid({ gameView: () => view, ...options });

describe('hexToPixel', () => {
  it('puts the origin hex at the origin', () => {
    expect(hexToPixel(0, 0, 50)).toEqual({ x: 0, y: 0 });
    expect(hexToPixel(0, 0, 50, 'flat')).toEqual({ x: 0, y: 0 });
  });

  it('spaces pointy-top columns by sqrt(3) * size', () => {
    expect(hexToPixel(1, 0, 50).x).toBeCloseTo(50 * Math.sqrt(3), 10);
    expect(hexToPixel(1, 0, 50).y).toBe(0);
  });

  it('offsets each pointy-top row by half a column and 3/2 rows', () => {
    const pos = hexToPixel(0, 1, 50);
    expect(pos.x).toBeCloseTo(50 * Math.sqrt(3) / 2, 10);
    expect(pos.y).toBeCloseTo(75, 10);
  });

  it('spaces flat-top columns by 3/2 * size and shears the rows', () => {
    const pos = hexToPixel(1, 0, 50, 'flat');
    expect(pos.x).toBeCloseTo(75, 10);
    expect(pos.y).toBeCloseTo(50 * Math.sqrt(3) / 2, 10);
  });

  it('scales linearly with hex size', () => {
    const small = hexToPixel(2, 3, 10);
    const large = hexToPixel(2, 3, 20);
    expect(large.x).toBeCloseTo(small.x * 2, 10);
    expect(large.y).toBeCloseTo(small.y * 2, 10);
  });

  it('mirrors negative coordinates', () => {
    const positive = hexToPixel(2, 3, 50);
    const negative = hexToPixel(-2, -3, 50);
    expect(negative.x).toBeCloseTo(-positive.x, 10);
    expect(negative.y).toBeCloseTo(-positive.y, 10);
  });

  it('gives neighbouring hexes a constant centre-to-centre distance', () => {
    const distances = [
      [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
    ].map(([q, r]) => {
      const pos = hexToPixel(q, r, 50);
      return Math.hypot(pos.x, pos.y);
    });
    for (const distance of distances) {
      expect(distance).toBeCloseTo(distances[0], 6);
    }
  });

  it('defaults to pointy orientation', () => {
    expect(hexToPixel(1, 1, 50)).toEqual(hexToPixel(1, 1, 50, 'pointy'));
  });
});

describe('getHexPolygonPoints', () => {
  const parse = (points: string) =>
    points.split(' ').map((pair) => pair.split(',').map(Number) as [number, number]);

  it('produces six vertices', () => {
    expect(parse(getHexPolygonPoints(50))).toHaveLength(6);
  });

  it('puts every vertex on the circle of the given radius', () => {
    for (const [x, y] of parse(getHexPolygonPoints(50))) {
      expect(Math.hypot(x, y)).toBeCloseTo(50, 6);
    }
  });

  it('scales the radius by the scale factor', () => {
    for (const [x, y] of parse(getHexPolygonPoints(50, 'pointy', 0.85))) {
      expect(Math.hypot(x, y)).toBeCloseTo(42.5, 6);
    }
  });

  it('starts a pointy-top hex at -30°, so a vertex points up', () => {
    const [first] = parse(getHexPolygonPoints(50, 'pointy'));
    expect(first[0]).toBeCloseTo(50 * Math.cos(-Math.PI / 6), 6);
    expect(first[1]).toBeCloseTo(50 * Math.sin(-Math.PI / 6), 6);
  });

  it('starts a flat-top hex at 0°, so a flat edge faces up', () => {
    const [first] = parse(getHexPolygonPoints(50, 'flat'));
    expect(first[0]).toBeCloseTo(50, 6);
    expect(first[1]).toBeCloseTo(0, 6);
  });

  it('spaces the vertices 60° apart', () => {
    const points = parse(getHexPolygonPoints(50));
    for (let i = 1; i < 6; i++) {
      const previous = Math.atan2(points[i - 1][1], points[i - 1][0]);
      const current = Math.atan2(points[i][1], points[i][0]);
      const delta = ((current - previous) * 180 / Math.PI + 360) % 360;
      expect(delta).toBeCloseTo(60, 6);
    }
  });

  it('collapses to the origin at scale 0', () => {
    for (const [x, y] of parse(getHexPolygonPoints(50, 'pointy', 0))) {
      expect(Math.hypot(x, y)).toBeCloseTo(0, 10);
    }
  });

  it('emits a string an SVG polygon can consume directly', () => {
    expect(getHexPolygonPoints(50)).toMatch(/^(-?[\d.e-]+,-?[\d.e-]+ ){5}-?[\d.e-]+,-?[\d.e-]+$/);
  });
});

describe('calculateHexDistance', () => {
  it('is zero from a hex to itself', () => {
    expect(calculateHexDistance(2, 3, 2, 3)).toBe(0);
  });

  it('is one to each of the six neighbours', () => {
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
      expect(calculateHexDistance(0, 0, dq, dr)).toBe(1);
    }
  });

  it('counts hex steps, not Euclidean distance', () => {
    expect(calculateHexDistance(0, 0, 2, -1)).toBe(2);
    expect(calculateHexDistance(0, 0, 3, 0)).toBe(3);
  });

  it('is symmetric', () => {
    expect(calculateHexDistance(1, 2, -3, 4)).toBe(calculateHexDistance(-3, 4, 1, 2));
  });

  it('obeys the triangle inequality on a sample of hexes', () => {
    const points: Array<[number, number]> = [[0, 0], [2, -1], [-3, 4], [1, 1]];
    for (const a of points) {
      for (const b of points) {
        for (const c of points) {
          expect(calculateHexDistance(a[0], a[1], c[0], c[1]))
            .toBeLessThanOrEqual(
              calculateHexDistance(a[0], a[1], b[0], b[1])
              + calculateHexDistance(b[0], b[1], c[0], c[1])
            );
        }
      }
    }
  });

  it('always returns a non-negative integer', () => {
    for (const [q, r] of [[5, -5], [-4, 2], [0, 7]]) {
      const distance = calculateHexDistance(0, 0, q, r);
      expect(Number.isInteger(distance)).toBe(true);
      expect(distance).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('useHexGrid', () => {
  const cells = [cell(0, 0), cell(1, 0), cell(0, 1)];

  it('finds the board in the game view', () => {
    expect(grid(gameView(cells)).board.value?.className).toBe('Board');
  });

  it('reports no board for an absent game view', () => {
    expect(grid(null).board.value).toBeNull();
  });

  it('collects the cells under the board', () => {
    expect(grid(gameView(cells)).cells.value).toHaveLength(3);
  });

  it('ignores board children that are not cells', () => {
    const withDecoration = gameView([...cells, piece('Marker', 99)]);
    expect(grid(withDecoration).cells.value).toHaveLength(3);
  });

  it('honours custom board and cell class names', () => {
    const view = {
      id: 1, className: 'Game', name: 'g', attributes: {},
      children: [{
        id: 2, className: 'HexBoard', name: 'b', attributes: {},
        children: [{ id: 3, className: 'Tile', name: 't', attributes: { q: 0, r: 0 }, children: [] }],
      }],
    } as unknown as GameElement;
    const hex = grid(view, { boardClassName: 'HexBoard', cellClassName: 'Tile' });
    expect(hex.cells.value).toHaveLength(1);
  });

  it('falls back to the default hex size and orientation', () => {
    const hex = grid(gameView(cells));
    expect(hex.hexSize.value).toBe(50);
    expect(hex.orientation.value).toBe('pointy');
  });

  it('reads hex size and orientation off the board when present', () => {
    const hex = grid(gameView(cells, { $hexSize: 20, $hexOrientation: 'flat' }));
    expect(hex.hexSize.value).toBe(20);
    expect(hex.orientation.value).toBe('flat');
  });

  it('honours caller-supplied defaults', () => {
    const hex = grid(gameView(cells), { defaultHexSize: 12, defaultOrientation: 'flat' });
    expect(hex.hexSize.value).toBe(12);
    expect(hex.orientation.value).toBe('flat');
  });

  it('keys cells by their axial coordinates', () => {
    const hex = grid(gameView(cells));
    expect(hex.getKey(1, 2)).toBe('1,2');
    expect(hex.getCellAt(1, 0)?.name).toBe('1,0');
  });

  it('returns nothing for a coordinate with no cell', () => {
    expect(grid(gameView(cells)).getCellAt(9, 9)).toBeUndefined();
  });

  it('skips cells that carry no coordinates', () => {
    const nameless = { id: 7, className: 'Cell', name: 'nowhere', attributes: {}, children: [] } as GameElement;
    expect(grid(gameView([...cells, nameless])).cellMap.value.size).toBe(3);
  });

  it('finds a child of a given class at a coordinate', () => {
    const view = gameView([cell(0, 0, [piece('Stone', 11)]), cell(1, 0)]);
    expect(grid(view).getChildAt(0, 0, 'Stone')?.id).toBe(11);
    expect(grid(view).getChildAt(1, 0, 'Stone')).toBeUndefined();
  });

  it('finds every child of a given class at a coordinate', () => {
    const view = gameView([cell(0, 0, [piece('Stone', 11), piece('Stone', 12), piece('Flag', 13)])]);
    expect(grid(view).getChildrenAt(0, 0, 'Stone').map((c) => c.id)).toEqual([11, 12]);
  });

  it('returns an empty child list for an empty coordinate', () => {
    expect(grid(gameView(cells)).getChildrenAt(5, 5, 'Stone')).toEqual([]);
  });

  it('positions hexes using the board hex size', () => {
    const hex = grid(gameView(cells, { $hexSize: 10 }));
    expect(hex.getHexPosition(1, 0)).toEqual(hexToPixel(1, 0, 10, 'pointy'));
  });

  it('positions hexes using the board orientation', () => {
    const hex = grid(gameView(cells, { $hexOrientation: 'flat' }));
    expect(hex.getHexPosition(1, 0)).toEqual(hexToPixel(1, 0, 50, 'flat'));
  });

  it('draws hex outlines matching the standalone helper', () => {
    const hex = grid(gameView(cells, { $hexSize: 20, $hexOrientation: 'flat' }));
    expect(hex.getHexPoints()).toBe(getHexPolygonPoints(20, 'flat'));
    expect(hex.getHexPoints(0.9)).toBe(getHexPolygonPoints(20, 'flat', 0.9));
  });

  it('falls back to a fixed viewBox when there are no cells', () => {
    expect(grid(gameView([])).hexGridBounds.value)
      .toEqual({ minX: 0, minY: 0, width: 400, height: 400 });
  });

  it('bounds the viewBox around every cell, with padding', () => {
    const bounds = grid(gameView(cells)).hexGridBounds.value;
    for (const [q, r] of [[0, 0], [1, 0], [0, 1]]) {
      const pos = hexToPixel(q, r, 50);
      expect(pos.x).toBeGreaterThan(bounds.minX);
      expect(pos.x).toBeLessThan(bounds.minX + bounds.width);
      expect(pos.y).toBeGreaterThan(bounds.minY);
      expect(pos.y).toBeLessThan(bounds.minY + bounds.height);
    }
  });

  it('converts axial to cube coordinates that sum to zero', () => {
    const cube = grid(gameView(cells)).axialToCube(2, -3);
    expect(cube).toEqual({ x: 2, y: 1, z: -3 });
    expect(cube.x + cube.y + cube.z).toBe(0);
  });

  it('round-trips axial through cube coordinates', () => {
    const hex = grid(gameView(cells));
    const cube = hex.axialToCube(4, -2);
    expect(hex.cubeToAxial(cube.x, cube.y, cube.z)).toEqual({ q: 4, r: -2 });
  });

  it('measures hex distance the same way as the standalone helper', () => {
    const hex = grid(gameView(cells));
    expect(hex.hexDistance(0, 0, 2, -1)).toBe(calculateHexDistance(0, 0, 2, -1));
  });

  it('lists six distinct neighbours, each one step away', () => {
    const hex = grid(gameView(cells));
    const neighbours = hex.getNeighbors(2, 3);
    expect(neighbours).toHaveLength(6);
    expect(new Set(neighbours.map((n) => `${n.q},${n.r}`)).size).toBe(6);
    for (const neighbour of neighbours) {
      expect(hex.hexDistance(2, 3, neighbour.q, neighbour.r)).toBe(1);
    }
  });

  it('iterates every mapped cell with its key', () => {
    const entries = [...grid(gameView(cells)).iterateCells()];
    expect(entries.map(([key]) => key).sort()).toEqual(['0,0', '0,1', '1,0']);
  });

  it('finds cells matching a coordinate predicate', () => {
    const hex = grid(gameView(cells));
    expect(hex.findCells((_c, q) => q === 0)).toHaveLength(2);
    expect(hex.findCells(() => false)).toEqual([]);
  });

  it('hands the parsed coordinates to the predicate', () => {
    const seen: Array<[number, number]> = [];
    grid(gameView(cells)).findCells((_c, q, r) => { seen.push([q, r]); return false; });
    expect(seen.sort()).toEqual([[0, 0], [0, 1], [1, 0]]);
  });

  it('reports empty results for a missing game view rather than throwing', () => {
    const hex = grid(null);
    expect(hex.cells.value).toEqual([]);
    expect(hex.cellMap.value.size).toBe(0);
    expect(hex.getCellAt(0, 0)).toBeUndefined();
    expect(hex.hexGridBounds.value.width).toBe(400);
  });
});
