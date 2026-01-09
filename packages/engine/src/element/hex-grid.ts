import { Space } from './space.js';
import type { Game } from './game.js';
import type { Player } from '../player/player.js';
import type { ElementLayout } from './grid.js';

/**
 * Hex orientation options
 */
export type HexOrientation = 'flat' | 'pointy';

/**
 * Hex coordinate systems
 * - offset: Uses col/row with offset for even/odd rows
 * - axial: Uses q/r coordinates (efficient for most operations)
 * - cube: Uses x/y/z coordinates where x + y + z = 0
 */
export type HexCoordSystem = 'offset' | 'axial' | 'cube';

/**
 * Hexagonal grid board container.
 *
 * HexGrid contains HexCell children arranged in a honeycomb pattern.
 * Use for Catan-style games, wargames, or any hex-based board.
 *
 * **Key features:**
 * - Flat-top or pointy-top orientation
 * - Axial or cube coordinate systems
 * - Automatic hex layout rendering
 *
 * @example
 * ```typescript
 * // Define a Catan-style board
 * class CatanBoard extends HexGrid {
 *   $hexOrientation = 'pointy';
 *   $coordSystem = 'axial';
 *   $qCoord = 'q';
 *   $rCoord = 'r';
 * }
 *
 * class Tile extends HexCell {
 *   q!: number;
 *   r!: number;
 *   terrain!: 'forest' | 'mountain' | 'plains' | 'water';
 *   number?: number; // Dice roll number
 * }
 *
 * // Create hex tiles
 * const board = game.create(CatanBoard, 'board');
 * for (const tileData of TILE_DATA) {
 *   board.create(Tile, tileData.name, {
 *     q: tileData.q,
 *     r: tileData.r,
 *     terrain: tileData.terrain
 *   });
 * }
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
 */
export class HexGrid<G extends Game = any, P extends Player = any> extends Space<G, P> {
  /**
   * System-defined layout type
   * AutoUI uses this to determine how to render this container
   * $ prefix indicates this is a system property
   */
  readonly $layout: ElementLayout = 'hex-grid';

  /**
   * Hex orientation: flat-top or pointy-top
   * - flat: Flat edge at top and bottom (like a ⬡ rotated)
   * - pointy: Point at top and bottom (like a ⬡)
   * @default 'pointy'
   */
  $hexOrientation: HexOrientation = 'pointy';

  /**
   * Coordinate system used for hex cells
   * @default 'axial'
   */
  $coordSystem: HexCoordSystem = 'axial';

  /**
   * Name of the Q coordinate attribute on HexCell children (axial/cube)
   * @default 'q'
   */
  $qCoord?: string;

  /**
   * Name of the R coordinate attribute on HexCell children (axial/cube)
   * @default 'r'
   */
  $rCoord?: string;

  /**
   * Name of the S coordinate attribute on HexCell children (cube only)
   * For cube coordinates, s = -q - r
   */
  $sCoord?: string;

  /**
   * Size of hexes in pixels (width for flat, height for pointy)
   * @default 50
   */
  $hexSize?: number;

  static override unserializableAttributes = [
    ...Space.unserializableAttributes,
  ];
}

/**
 * Single cell within a hexagonal grid.
 *
 * HexCell represents one hexagonal position in a HexGrid. Extend this class
 * to add coordinate attributes (q/r for axial, q/r/s for cube) and any
 * game-specific properties.
 *
 * @example
 * ```typescript
 * // Catan-style tile with terrain
 * class Tile extends HexCell {
 *   q!: number;
 *   r!: number;
 *   terrain!: 'forest' | 'mountain' | 'plains' | 'water';
 *   resource?: 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';
 *   diceNumber?: number;
 * }
 *
 * // Wargame hex with terrain features
 * class MapHex extends HexCell {
 *   q!: number;
 *   r!: number;
 *   elevation!: number;
 *   cover!: 'none' | 'light' | 'heavy';
 * }
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
 */
export class HexCell<G extends Game = any, P extends Player = any> extends Space<G, P> {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type!: 'hex-cell';

  constructor(ctx: Partial<import('./types.js').ElementContext>) {
    super(ctx);
    this.$type = 'hex-cell';
  }

  static override unserializableAttributes = [
    ...Space.unserializableAttributes,
  ];
}
