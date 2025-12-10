import type { GameElement } from './game-element.js';
import type { Game } from './game.js';
import type { Player } from '../player/player.js';
import type { VisibilityState } from '../command/visibility.js';

/**
 * Constructor type for GameElement subclasses
 */
export type ElementClass<T extends GameElement = GameElement> = {
  new (ctx: Partial<ElementContext>): T;
  isGameElement: boolean;
};

/**
 * Shared context for all elements in a game tree
 */
export type ElementContext = {
  /** Root game element */
  game: Game;
  /** ID sequence counter */
  sequence: number;
  /** Current player context (for "mine" queries) */
  player?: Player;
  /** Registry of element classes by name for deserialization and commands */
  classRegistry: Map<string, ElementClass>;
  /** Random number generator (seeded for replay) */
  random: () => number;
};

/**
 * Internal tree structure for elements
 */
export type ElementTree<T extends GameElement = GameElement> = {
  /** Child elements */
  children: T[];
  /** Parent element */
  parent?: GameElement;
  /** Unique immutable ID assigned at creation */
  id: number;
  /** Child ordering: 'normal' = append, 'stacking' = prepend (like card piles) */
  order: 'normal' | 'stacking';
};

/**
 * JSON representation of an element for serialization
 */
export type ElementJSON = {
  className: string;
  id: number;
  name?: string;
  attributes: Record<string, unknown>;
  visibility?: VisibilityState;
  children?: ElementJSON[];
  /** For 'count-only' visibility mode, just show the count */
  childCount?: number;
};

/**
 * Query finder types - can be:
 * - string: match by name
 * - function: predicate filter
 * - object: match by properties
 */
export type ElementFinder<T extends GameElement = GameElement> =
  | string
  | ((element: T) => boolean)
  | Partial<Record<string, unknown> & { mine?: boolean; empty?: boolean }>;

/**
 * Sorter for element collections
 */
export type Sorter<T> = keyof T | ((element: T) => number | string);

/**
 * Extract settable attributes from an element class (excluding methods and internal props)
 */
export type ElementAttributes<T extends GameElement> = Partial<
  Pick<
    T,
    {
      [K in keyof T]: K extends keyof GameElement
        ? never
        : T[K] extends (...args: unknown[]) => unknown
          ? never
          : K;
    }[keyof T]
  > & {
    name?: string;
    player?: Player;
    row?: number;
    column?: number;
  }
>;
