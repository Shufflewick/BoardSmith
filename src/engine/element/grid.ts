import { Space } from './space.js';
import type { Game } from './game.js';
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
