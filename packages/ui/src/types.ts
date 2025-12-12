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
  position: number;
  name: string;
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
 */
export interface GameElement<TAttributes extends BaseElementAttributes = BaseElementAttributes> {
  /** Unique identifier for this element instance */
  id: number;
  /** Optional display name */
  name?: string;
  /** The class name (type) of this element */
  className: string;
  /** Element-specific attributes */
  attributes?: TAttributes & Record<string, unknown>;
  /** Child elements (visible to this player) */
  children?: GameElement<TAttributes>[];
  /** Count of children (used when contents are hidden) */
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
 * Selection type for action parameters.
 */
export interface Selection {
  name: string;
  type: 'choice' | 'player' | 'element' | 'number' | 'text';
  prompt?: string;
  optional?: boolean;
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
  selections: Selection[];
}

/**
 * Player information.
 */
export interface Player {
  position: number;
  name: string;
}
