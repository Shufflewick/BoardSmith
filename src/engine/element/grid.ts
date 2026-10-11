import { Space } from './space.js';
import type { Game } from './game.js';
import type { GameElement } from './game-element.js';
import type { ElementClass, ElementFinder } from './types.js';
import { firstCell } from './cell-index.js';
import type { Player } from '../player/player.js';

/**
 * Layout types that AutoUI can render
 * These are system-defined and guaranteed by the engine
 */
export type ElementLayout =
  | 'grid'           // 2D grid layout (chess, checkers, tic-tac-toe)
  | 'hex-grid'       // Hexagonal grid (Catan, Civilization)
  | 'list'           // Linear sequence (default for most containers)
  | 'stack'          // Stacked elements (deck of cards)
  | 'hand'           // Fanned hand of cards
  | 'free-form';     // No specific layout (custom positioning)

/**
 * Rectangular grid board container.
 *
 * Grid contains GridCell children arranged in rows and columns.
 * Use for chess-like boards, tic-tac-toe, or any rectangular grid game.
 *
 * **Key features:**
 * - Automatic grid layout rendering
 * - Row/column labels for UI display
 * - Coordinate attributes on cells for positioning
 * - The cell at a coordinate, `board.first(Square, { rank, file })` with
 *   exactly the `$rowCoord`/`$colCoord` attributes, is a lookup, not a search
 *
 * **The rule for cells:** a cell's coordinates do not change while it is in
 * its grid, and cells are the grid's direct children. The grid finds a cell by
 * the coordinates it had when it entered. To give a cell new coordinates, take
 * it out (`cell.reparent(holdingSpace)`), change them, and put it back.
 * Development mode checks every lookup against a search of the grid and throws
 * when a cell was re-addressed in place.
 *
 * @example
 * ```typescript
 * // Define a chess board
 * class ChessBoard extends Grid {
 *   $rowLabels = ['8', '7', '6', '5', '4', '3', '2', '1'];
 *   $columnLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
 *   $rowCoord = 'rank';
 *   $colCoord = 'file';
 * }
 *
 * class Square extends GridCell {
 *   rank!: number; // 1-8
 *   file!: number; // 1-8
 * }
 *
 * // Create the board with cells
 * const board = game.create(ChessBoard, 'board');
 * for (let rank = 1; rank <= 8; rank++) {
 *   for (let file = 1; file <= 8; file++) {
 *     board.create(Square, `${file}${rank}`, { rank, file });
 *   }
 * }
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
 */
export class Grid<G extends Game = any, P extends Player = any> extends Space<G, P> {
  /**
   * System-defined layout type
   * AutoUI uses this to determine how to render this container
   * $ prefix indicates this is a system property
   */
  readonly $layout: ElementLayout = 'grid';

  /**
   * Labels for rows (optional - game designer provides these)
   * Example: ['8', '7', '6', '5', '4', '3', '2', '1'] for chess
   * If not provided, AutoUI will use numeric indices
   */
  $rowLabels?: string[];

  /**
   * Labels for columns (optional - game designer provides these)
   * Example: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] for chess
   * If not provided, AutoUI will use numeric indices
   */
  $columnLabels?: string[];

  /**
   * Name of the attribute on GridCell children that represents the row coordinate
   * Example: 'row', 'rank', 'y'
   * AutoUI uses this to position grid cells correctly
   */
  $rowCoord?: string;

  /**
   * Name of the attribute on GridCell children that represents the column coordinate
   * Example: 'col', 'column', 'file', 'x'
   * AutoUI uses this to position grid cells correctly
   */
  $colCoord?: string;


  /**
   * The first matching descendant, as {@link GameElement.first}. The cell at a
   * coordinate, `first(CellClass, { <$rowCoord>: r, <$colCoord>: c })` with exactly the
   * grid's two coordinate attributes, is looked up rather than searched for
   * (#632), which is why a cell's coordinates must not change while it is in
   * the grid (see the class docs).
   */
  override first<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined {
    return firstCell(this, GridCell, this.$rowCoord && this.$colCoord ? [this.$rowCoord, this.$colCoord] : undefined, classNameOrFinder, finders, () =>
      super.first(classNameOrFinder as ElementClass<F>, ...finders),
    );
  }

  static override unserializableAttributes = [
    ...Space.unserializableAttributes,
  ];
}

/**
 * Single cell within a rectangular Grid.
 *
 * GridCell represents one position in a grid board. Extend this class
 * to add coordinate attributes (row/col, rank/file, etc.) and any
 * game-specific properties.
 *
 * @example
 * ```typescript
 * // Simple grid cell
 * class Square extends GridCell {
 *   row!: number;
 *   col!: number;
 * }
 *
 * // Chess-style with custom coordinate names
 * class ChessSquare extends GridCell {
 *   rank!: number;  // 1-8
 *   file!: number;  // 1-8
 *   color!: 'light' | 'dark';
 * }
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
 */
export class GridCell<G extends Game = any, P extends Player = any> extends Space<G, P> {
  /**
   * System-defined layout type
   * Indicates this is a positioned cell within a grid
   * $ prefix indicates this is a system property
   */
  readonly $layout: ElementLayout = 'list'; // GridCell itself is just a container

  static override unserializableAttributes = [
    ...Space.unserializableAttributes,
  ];
}
