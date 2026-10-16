/**
 * The cell index of `Grid` and `HexGrid` (#632): the cell at a coordinate, by
 * lookup rather than by searching the grid.
 *
 * `grid.first(CellClass, { <row>: r, <column>: c })`, with exactly the grid's
 * two coordinate attributes (`$rowCoord`/`$colCoord`, or a hex grid's
 * `$qCoord`/`$rCoord`), is answered from a map of the grid's own cells by
 * their coordinates. Any other query searches the grid as before.
 *
 * THE RULE: a cell's coordinates do not change while it is in its grid. The
 * index is derived from the tree and dropped whenever the grid's children
 * change (see {@link childrenChanged}), but an attribute write has no
 * chokepoint to notice it by, so a cell re-addressed in place would be found
 * at its old coordinates. To move a cell, take it out of the grid, change its
 * coordinates, and put it back. Development mode checks every indexed answer
 * against a search of the grid and throws on a mismatch; production trusts
 * the rule.
 */
import { isDevMode } from '../../utils/dev.js';
import { reachPartition, type GameElement } from './game-element.js';
import { stateChanged } from './state-version.js';
import type { ElementClass, ElementFinder } from './types.js';

/** First coordinate, then second, to the grid's child cells at them, in the grid's order (layered cells share one). */
type CellMap = Map<unknown, Map<unknown, GameElement[]>>;

const cellMaps = new WeakMap<GameElement, CellMap>();

/**
 * `parent`'s children changed: drop its cell index, if it has one, and mark
 * the game changed (#631). Called wherever children are added, removed or
 * reordered.
 */
export function childrenChanged(parent: GameElement | undefined): void {
  if (!parent) return;
  cellMaps.delete(parent);
  stateChanged(parent._ctx);
}

/**
 * `grid.first(classNameOrFinder, ...finders)`, from the index when the query
 * is a cell class at the grid's two coordinates, and from `search` otherwise.
 *
 * @param cellClass - The grid's cell class (`GridCell` or `HexCell`); only its
 *   instances are indexed, and only a query for one of its subclasses uses it.
 * @param coordinates - The grid's two coordinate attribute names, or
 *   undefined when it has not declared them.
 * @param search - The grid's own `first`, which searches it.
 */
export function firstCell<F extends GameElement>(
  grid: GameElement,
  cellClass: ElementClass,
  coordinates: readonly [string, string] | undefined,
  classNameOrFinder: ElementClass<F> | ElementFinder<F> | undefined,
  finders: ElementFinder<F>[],
  search: () => F | undefined,
): F | undefined {
  const coordinate = coordinates && cellQuery(cellClass, coordinates, classNameOrFinder, finders);
  // While PIT-02 records the classes the game queries, the search records them.
  if (!coordinate || grid._ctx._pit02RecordingActive) return search();

  const className = classNameOrFinder as ElementClass<F>;
  const layers = cellsOf(grid, cellClass, coordinates).get(coordinate[0])?.get(coordinate[1]);
  // The first of the requested class in the grid's order, as a search finds it.
  const cell = layers?.find((layer): layer is F => layer instanceof className);
  if (isDevMode()) {
    const searched = search();
    if (searched !== cell) throw coordinatesChanged(grid, finders[0] as Record<string, unknown>, cell, searched);
  }
  return reachPartition(cell);
}

/** The two coordinate values a query asks for, when it is a cell class at exactly the grid's two coordinates. */
function cellQuery(
  cellClass: ElementClass,
  [first, second]: readonly [string, string],
  classNameOrFinder: unknown,
  finders: readonly unknown[],
): [unknown, unknown] | undefined {
  const finder = finders[0];
  if (!isCellClass(classNameOrFinder, cellClass) || finders.length !== 1) return undefined;
  if (typeof finder !== 'object' || finder === null) return undefined;
  const keys = Object.keys(finder);
  if (keys.length !== 2 || !keys.includes(first) || !keys.includes(second)) return undefined;
  const values = finder as Record<string, unknown>;
  return [values[first], values[second]];
}

function isCellClass(value: unknown, cellClass: ElementClass): boolean {
  return typeof value === 'function' && (value === cellClass || value.prototype instanceof cellClass);
}

function cellsOf(grid: GameElement, cellClass: ElementClass, [first, second]: readonly [string, string]): CellMap {
  let cells = cellMaps.get(grid);
  if (cells) return cells;
  cells = new Map();
  for (const child of grid._t.children) {
    if (!(child instanceof cellClass)) continue;
    const attributes = child as unknown as Record<string, unknown>;
    let row = cells.get(attributes[first]);
    if (!row) cells.set(attributes[first], (row = new Map()));
    const layers = row.get(attributes[second]);
    if (layers) layers.push(child);
    else row.set(attributes[second], [child]);
  }
  cellMaps.set(grid, cells);
  return cells;
}

function coordinatesChanged(
  grid: GameElement,
  asked: Record<string, unknown>,
  indexed: GameElement | undefined,
  searched: GameElement | undefined,
): Error {
  const name = (element: GameElement | undefined) =>
    element ? `"${element.name ?? element.constructor.name}"` : 'no cell';
  const coordinates = Object.entries(asked).map(([key, value]) => `${key}: ${String(value)}`).join(', ');
  return new Error(
    `Grid "${grid.name ?? grid.constructor.name}" looked up the cell at { ${coordinates} } and found ` +
      `${name(indexed)}, but searching the grid finds ${name(searched)}. A cell's coordinates ` +
      `changed while it was in the grid, and a grid finds its cells by the coordinates they had ` +
      `when they entered it.\n` +
      `  Fix: to give a cell new coordinates, take it out of the grid first (for example ` +
      `cell.reparent(holdingSpace)), change them, and put it back (cell.reparent(grid)).`,
  );
}
