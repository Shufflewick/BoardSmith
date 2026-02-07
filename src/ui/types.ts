/**
 * Shared types for @boardsmith/ui
 *
 * This file contains the canonical type definitions used throughout the UI package.
 * All other type definitions should import from here to ensure consistency.
 */

/**
 * Player reference commonly found in element attributes.
 */
export interface PlayerRef {
  __playerRef: number;
  seat: number;
  color?: string;
  name?: string;
}

/**
 * Common attributes that appear on game elements.
 * This interface can be extended for game-specific attributes.
 */
export interface BaseElementAttributes {
  /** Special type identifier (used by auto-ui for special handling) */
  $type?: string;
  /** Hex size for hex grid boards */
  $hexSize?: number;
  /** Hex orientation for hex grid boards */
  $hexOrientation?: 'pointy' | 'flat';
  /** Player owner of this element */
  player?: PlayerRef;
  /** Grid row coordinate */
  row?: number;
  /** Grid column coordinate */
  col?: number;
  /** Hex q coordinate (axial) */
  q?: number;
  /** Hex r coordinate (axial) */
  r?: number;
  /** Card rank (e.g., 'A', '2', 'K') */
  rank?: string;
  /** Card suit (e.g., 'hearts', 'spades') */
  suit?: string;
}

/**
 * Core game element type representing a node in the game view tree.
 *
 * This is the serialized representation of game state elements as sent
 * to the UI from the game engine.
 *
 * @example Structure
 * ```typescript
 * {
 *   id: 42,                    // Top-level! NOT in attributes
 *   className: 'Merc',
 *   name: 'Squad Leader',
 *   attributes: {
 *     health: 10,
 *     equipmentName: 'Laser Rifle'
 *   },
 *   children: [
 *     { id: 17, className: 'Equipment', attributes: { equipmentName: 'Laser Rifle' } }
 *   ]
 * }
 * ```
 *
 * @example Finding element IDs for action calls
 * ```typescript
 * import { findChildByAttribute } from '@boardsmith/ui';
 *
 * // When you have attribute data but need the element ID:
 * const equipment = findChildByAttribute(merc, 'equipmentName', 'Laser Rifle');
 * await actionController.execute('drop', { equipment: equipment.id });  // Pass ID
 * ```
 */
export interface GameElement<TAttributes extends BaseElementAttributes = BaseElementAttributes> {
  /**
   * Unique identifier for this element instance.
   *
   * **Important:** This is the value to pass to action execute/fill calls.
   * The ID is at the TOP LEVEL, not inside attributes.
   *
   * @example
   * ```typescript
   * // Correct
   * await execute('drop', { equipment: element.id });
   *
   * // Wrong - id is not in attributes!
   * await execute('drop', { equipment: element.attributes.id });  // undefined!
   * ```
   */
  id: number;
  /** Optional display name */
  name?: string;
  /** The class name (type) of this element */
  className: string;
  /**
   * Element-specific attributes.
   *
   * Contains game data like health, rank, suit, position, etc.
   * Does NOT contain the element ID - that's at the top level.
   */
  attributes?: TAttributes & Record<string, unknown>;
  /**
   * Child elements (visible to this player).
   *
   * Use helpers like `findChildByAttribute()` to search children
   * when you need to find an element by its attribute values.
   */
  children?: GameElement<TAttributes>[];
  /** Count of children (used when contents are hidden from player) */
  childCount?: number;
  /** Internal flag indicating element should be hidden */
  __hidden?: boolean;
}

/**
 * Options for matching/finding elements by various criteria.
 */
export interface ElementMatchOptions {
  /** Match by element ID */
  id?: number;
  /** Match by $type attribute (most reliable, handles bundler mangling) */
  type?: string;
  /** Match by element name */
  name?: string;
  /** Match by className (may be mangled by bundlers) */
  className?: string;
}

/**
 * Pick type for action parameters.
 * A "pick" is a choice the player must make to complete an action (per nomenclature.md).
 */
export interface Pick {
  name: string;
  type: 'choice' | 'player' | 'element' | 'number' | 'text';
  prompt?: string;
  /** If true, shows "Skip" button. If a string, shows that text instead. */
  optional?: boolean | string;
  choices?: Array<{ value: unknown; display: string }>;
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  elementClassName?: string;
}

/**
 * Metadata for an available action.
 */
export interface ActionMetadata {
  name: string;
  prompt?: string;
  selections: Pick[];
}

/**
 * Player information.
 */
export interface Player {
  position: number;
  name: string;
}
