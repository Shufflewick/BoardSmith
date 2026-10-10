/**
 * Shared types for boardsmith/ui
 *
 * This file contains the canonical type definitions used throughout the UI package.
 * All other type definitions should import from here to ensure consistency.
 */

import type { GamePhase } from '../engine/element/game.js';

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
 *     { id: 17, className: 'Equipment', name: 'Laser Rifle', attributes: { damage: 3 } }
 *   ]
 * }
 * ```
 *
 * @example Finding element IDs for action calls
 * ```typescript
 * import { findElement } from 'boardsmith/ui';
 *
 * // When you have the element's own name but need its ID.
 * // `name` matches the element's top-level name, never a value in `attributes`.
 * const equipment = findElement(merc, { name: 'Laser Rifle' });
 * await actionController.execute('drop', { equipment: equipment.id });  // Pass ID
 * ```
 */
export interface GameViewElement<TAttributes extends BaseElementAttributes = BaseElementAttributes> {
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
   * Use `findElement()` / `findElements()` to search children
   * when you need to find an element by id, type, name or className.
   */
  children?: GameViewElement<TAttributes>[];
  /** Count of children (used when contents are hidden from player) */
  childCount?: number;
}

/**
 * The root of a seat's view: the game element itself.
 *
 * `Game.toJSONForPlayer()` writes three fields on the root that no other
 * element carries, and both shells hand a board this root as `gameView`:
 *
 * - `phase`: `'setup'`, `'started'` or `'finished'`.
 * - `isFinished`: whether the game has ended.
 * - `settings`: the game's `settings` bag, redacted for this seat. Values the
 *   game stores there (including `persistentMap` fields) are read from here.
 *
 * @example
 * ```typescript
 * const props = defineProps<TableBoardProps>();
 * const over = computed(() => props.gameView?.isFinished ?? false);
 * const drawn = computed(() => props.gameView?.settings.drawnIds as number[] | undefined);
 * ```
 */
export interface GameRootView<TAttributes extends BaseElementAttributes = BaseElementAttributes>
  extends GameViewElement<TAttributes> {
  /** Where the game is in its life: `'setup'`, `'started'` or `'finished'`. */
  phase: GamePhase;
  /** Whether the game has ended. */
  isFinished: boolean;
  /** The game's settings bag as this seat may see it. */
  settings: Record<string, unknown>;
}

/**
 * Options for matching/finding elements. An element matches only when it
 * satisfies every criterion given; with no criteria nothing matches.
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

// THE PICK SHAPE IS NOT DECLARED HERE, AND NO LONGER ANYWHERE NEAR HERE (#251).
//
// This module used to declare its own `Pick` and `ActionMetadata`, a fourth copy
// of the shape beside types/protocol.ts, session/types.ts and
// useActionControllerTypes.ts -- and it had already drifted: its pick `type`
// union offered a `player` kind the engine never emits and lacked `elements`,
// `multiSelect`, `validElements` and every pick field added since #228. A game
// type-checking a board against it could not describe the picks it was actually
// being sent.
//
// The shape is owned by `../types/protocol.js`, and the UI's enriched view of it
// (`ValidElement` carrying its `gameView` element, and the pick/action types
// bound to that) lives in `composables/useActionControllerTypes.js`, which is
// where the rest of the UI already imports it from. It is not re-exported
// through here: this module declares `GameViewElement`, so that module imports from
// this one, and a re-export in this direction would make the two type modules
// import each other.

/**
 * Player information, as GameShell passes it to a game's board slot.
 *
 * `seat`, not `position`: this mirrors the wire shape
 * (`PlayerState.players`, client/types.ts) and what GameShell itself reads
 * (`players.value.find(p => p.seat === ...)`). The field was declared as
 * `position` here for a long time and nothing caught it, because the ambient
 * `*.vue` shim meant no game template was ever type-checked against it.
 */
export interface BoardPlayer {
  seat: number;
  name: string;
}
