import type { GameElement } from './game-element.js';
import type { Game } from './game.js';
import type { Player } from '../player/player.js';
import type { VisibilityState } from '../command/visibility.js';

/**
 * Reference to an image for rendering game elements.
 * Can be a simple path string or an object for sprite sheets.
 * Sprite sheets use CSS background-position and work with any image format (SVG, PNG, JPG, etc.)
 */
export type ImageRef =
  | string // Simple path: '/cards/AH.svg' or '/cards/AH.png'
  | {
      /** Path to sprite sheet file */
      sprite: string;
      /** X position in sprite sheet (pixels) */
      x: number;
      /** Y position in sprite sheet (pixels) */
      y: number;
      /** Width of the sprite (pixels) */
      width: number;
      /** Height of the sprite (pixels) */
      height: number;
    };

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
  /**
   * Internal (PIT-02): true while `startFlow()`'s first traversal is
   * recording element-class queries made through the `GameElement` finder
   * methods (all/first/firstN/last/lastN). Not part of the public API.
   */
  _pit02RecordingActive?: boolean;
  /**
   * Internal (PIT-02): element classes queried through the `GameElement`
   * finder methods while `_pit02RecordingActive` is true. Diffed against
   * `classRegistry` after the first traversal to catch classes queried but
   * never registered. Not part of the public API.
   */
  _pit02RecordedClasses?: Set<ElementClass>;
  /**
   * Internal: names of built-in framework element classes seeded into
   * `classRegistry` at construction (e.g. Die, Card, Hand). These are defaults
   * so polymorphic base-class queries resolve; a game that actually
   * registers/instantiates its OWN class of the same name overrides the default
   * (the seed name is removed from this set on override). Not public API.
   */
  _builtinSeededNames?: Set<string>;
  /**
   * Internal: true when the game was constructed with `GameOptions.worldMode`.
   * World mode
   * changes exactly one thing about the element tree's behaviour: an element
   * reference held in an attribute serializes as `{ __elementId }` rather than
   * as the positional `{ __elementRef: branch }`, because in a world the
   * partitions that are not resident are ABSENT from the tree and every branch
   * index after them has shifted. Set once, at construction, and never after:
   * a subclass constructor body builds the game's furniture, so a
   * post-construction switch would have missed exactly the elements most
   * likely to hold references. Not public API — read it through
   * `Game#worldMode`.
   */
  _worldMode?: boolean;
  /**
   * Internal: the elements the platform has declared partition roots
   * (`Game#definePartition`, which `Game#adoptSubtree` calls for every graft),
   * BY ID. A map rather than a set of ids because every pass over the roots
   * used to re-find each one with `getElementById`, a depth-first walk of the
   * whole resident world, which made a per-command O(resident) pass O(resident²)
   * (ShufflewickPub #316). Absent in snapshot mode, which is what keeps the
   * marking in `moveToInternal` free for every published board game. Not
   * public API.
   */
  _partitionRoots?: Map<number, GameElement>;
  /**
   * Set once a host has handed over a durable id allocation stamp (#377).
   *
   * What it turns on is the REFUSAL in `adoptSubtree`: a world whose allocation
   * is durable must never quietly raise its counter to meet adopted bytes,
   * because doing so is how a stale stamp goes unnoticed until a collision.
   */
  _worldIdAllocationDeclared?: boolean;
  /**
   * Internal: partition roots whose subtree has been physically re-parented
   * since the last `Game#takeTouchedPartitions()`, plus marks preserved for
   * partitions that were content-dirty at eviction time. This is part of the
   * platform's dirty set the platform cannot compute for itself, because it
   * never sees a move. Not public API — read it through
   * `Game#takeTouchedPartitions`.
   */
  _touchedPartitions?: Set<number>;
  /**
   * Internal: each resident partition root's serialized form, captured at
   * `definePartition`/`adoptSubtree` and re-captured by
   * `Game#takeTouchedPartitions()`, which compares the live serialization
   * against this to report ATTRIBUTE changes -- writes that never re-parent
   * anything and so never pass through `moveToInternal`. It is also the
   * pre-command copy `Game#partitionBaseline` hands the platform to roll a
   * refused command back to, so nothing has to serialize the resident set a
   * second time to get one. Not public API.
   */
  _partitionBaselines?: Map<number, string>;
  /**
   * Internal: the OPEN REACH WINDOW -- partition roots whose elements have
   * been handed out since the last `Game#takeTouchedPartitions()`, beside the
   * root table to attribute them against.
   *
   * This is what makes the dirty-set comparison cost the ROOM rather than the
   * resident world (ShufflewickPub #295): a partition no door handed out is a
   * partition this command had nothing to write through, so its serialized
   * form cannot have moved and comparing it would be work with a known answer.
   * Doors are `Game#reachPartition` (the platform's own, the root a command's
   * `partition(name)` answers with), every query and tree accessor an element
   * hands out, and the element references a compared partition holds.
   *
   * ITS PRESENCE IS THE SWITCH, and it carries `roots` rather than reading
   * `_partitionRoots` so that one read decides everything. Absent in snapshot
   * mode, which is what keeps every accessor free for a published board game;
   * absent again for the duration of `Game#readingOnly`, which is how the
   * platform says a call cannot write. Not public API.
   */
  _reachedPartitions?: {
    readonly roots: ReadonlyMap<number, GameElement>;
    readonly partitions: Set<number>;
  };
  /**
   * Internal: for each resident partition root, the OTHER partitions its live
   * element-reference attributes point into, harvested from the same
   * serialization the comparison already does.
   *
   * An element reference is the one way to reach another partition without
   * asking the engine for it -- `roomA.exit.visits += 1` goes through no door
   * at all -- so a partition that is a candidate makes everything it points at
   * a candidate too, transitively. A world that names its neighbours by
   * PARTITION NAME (which is what a declaration is for) has none of these and
   * pays for its room; a world whose partitions hold live references into each
   * other pays for the component it reached, which is what it built.
   * Not public API.
   */
  _partitionReferences?: Map<number, ReadonlySet<number>>;
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
  /**
   * Zone visibility mode for this element's CONTENTS (not the element
   * itself) — `Space._zoneVisibility`, set via `contentsHidden()` /
   * `contentsVisibleToOwner()` / `contentsCountOnly()` / `addZoneVisibleTo()`
   * / `hideContentsFrom()`. Mirrors `visibility` (SEC-01/F1/F7): only
   * `Space` (and subclasses) emit this field.
   */
  zoneVisibility?: VisibilityState;
  children?: ElementJSON[];
  /** For 'count-only' visibility mode, just show the count */
  childCount?: number;
  /**
   * This node was filtered by `static visibleAttributes` for a seat that does
   * not own it (#19), so every attribute absent from `attributes` was WITHHELD
   * rather than unset. A restore turns each of those into an attribute that
   * throws on read instead of quietly holding its class-field default.
   *
   * A flag, never a list: the withheld names would themselves disclose which
   * optional attributes the owner has set. The names are recoverable from the
   * class's own static whitelist at restore time.
   */
  redacted?: boolean;
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
