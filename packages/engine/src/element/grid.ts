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
 * A grid-based board container
 *
 * Grid is a Space that contains GridCell children arranged in a 2D rectangular grid.
 * Game designers should extend this class when creating grid-based boards.
 *
 * Example:
 * ```typescript
 * class CheckerBoard extends Grid {}
 * class ChessBoard extends Grid {}
 * class GoBoard extends Grid {}
 * ```
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
 * A single cell within a Grid
 *
 * GridCell is a Space that represents one position in a grid.
 * It must have numeric position coordinates (the attribute names are flexible).
 *
 * The game designer defines which attributes represent coordinates.
 *
 * Example:
 * ```typescript
 * class Square extends GridCell {
 *   row!: number;
 *   col!: number;
 * }
 *
 * class ChessSquare extends GridCell {
 *   rank!: number;  // 1-8
 *   file!: number;  // 1-8
 * }
 * ```
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
