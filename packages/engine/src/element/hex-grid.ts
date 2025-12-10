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
 * A hexagonal grid container
 *
 * HexGrid is a Space that contains HexCell children arranged in a hexagonal pattern.
 * Supports both flat-top and pointy-top orientations.
 *
 * Example:
 * ```typescript
 * class CatanBoard extends HexGrid {}
 * class BattletechMap extends HexGrid {}
 * ```
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
 * A single cell within a HexGrid
 *
 * HexCell is a Space that represents one hexagonal position in a hex grid.
 * It must have coordinate attributes (q, r for axial; q, r, s for cube).
 *
 * Example:
 * ```typescript
 * class Tile extends HexCell {
 *   q!: number;
 *   r!: number;
 *   terrain!: 'forest' | 'mountain' | 'plains' | 'water';
 *   resource?: 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';
 * }
 * ```
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
