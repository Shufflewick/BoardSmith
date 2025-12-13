import { ElementCollection } from './element-collection.js';
import type {
  ElementClass,
  ElementContext,
  ElementTree,
  ElementJSON,
  ElementFinder,
  ElementAttributes,
  ImageRef,
} from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';
import type { VisibilityState } from '../command/visibility.js';
import { DEFAULT_VISIBILITY, canPlayerSee, resolveVisibility } from '../command/visibility.js';

/**
 * Base class for all game elements. Elements form a tree structure representing
 * the game state. Do not instantiate directly - use Space or Piece as base classes.
 */
export class GameElement<G extends Game = any, P extends Player = any> {
  /** Element name for identification and queries */
  name?: string;

  /** Player who owns this element (affects "mine" queries and visibility) */
  player?: P;

  /** Row position in grid layout */
  row?: number;

  /** Column position in grid layout */
  column?: number;

  /**
   * Image for single-sided elements (boards, mats, tokens).
   * For multi-sided elements (cards, dice), use $images instead.
   * System property - $ prefix indicates this is for the rendering system.
   */
  $image?: ImageRef;

  /**
   * Images for multi-sided elements, keyed by side name.
   * Common keys: 'face', 'back' for cards; 'side1'-'side6' for dice.
   * System property - $ prefix indicates this is for the rendering system.
   */
  $images?: Record<string, ImageRef>;

  /** Reference to the root game */
  game!: G;

  /** Shared context for all elements in the tree */
  _ctx!: ElementContext;

  /** Internal tree structure */
  _t: ElementTree<GameElement>;

  /** Visibility state for this element */
  _visibility?: VisibilityState;

  /** Static flag to identify GameElement classes */
  static isGameElement = true;

  /** Attributes that should not be serialized */
  static unserializableAttributes = ['_ctx', '_t', 'game', '_visibility'];

  /** Attributes visible to all players (undefined = all visible) */
  static visibleAttributes: string[] | undefined;

  constructor(ctx: Partial<ElementContext>) {
    this._ctx = ctx as ElementContext;

    // Initialize sequence if this is the root
    if (this._ctx.sequence === undefined) {
      this._ctx.sequence = 0;
    }

    // Initialize class registry as Map
    if (!this._ctx.classRegistry) {
      this._ctx.classRegistry = new Map();
    }

    // Create tree structure with unique ID
    const id = this._ctx.sequence++;
    this._t = {
      children: [],
      id,
      order: 'normal',
    };
  }

  /**
   * String representation of the element
   */
  toString(): string {
    return this.name ?? this.constructor.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  }

  // ============================================
  // Tree Structure
  // ============================================

  /**
   * Get the parent element
   */
  get parent(): GameElement | undefined {
    return this._t.parent;
  }

  /**
   * Get all direct children
   */
  get children(): ElementCollection<GameElement> {
    return new ElementCollection(...this._t.children);
  }

  /**
   * Check if this element has no children
   */
  isEmpty(): boolean {
    return this._t.children.length === 0;
  }

  /**
   * Check if this element belongs to the current player context
   */
  isMine(): boolean {
    if (!this._ctx.player) return false;
    return this.player === this._ctx.player;
  }

  /**
   * Get the branch path from root to this element (e.g., "0/2/1")
   */
  branch(): string {
    const path: number[] = [];
    let current: GameElement | undefined = this as GameElement;

    while (current?._t.parent) {
      const parent: GameElement = current._t.parent;
      const index = parent._t.children.indexOf(current);
      path.unshift(index);
      current = parent;
    }

    return path.join('/');
  }

  /**
   * Find an element by its branch path
   */
  atBranch(branch: string): GameElement | undefined {
    if (!branch) return this;

    const indices = branch.split('/').map(Number);
    let current: GameElement = this;

    for (const index of indices) {
      const child = current._t.children[index];
      if (!child) return undefined;
      current = child;
    }

    return current;
  }

  /**
   * Find an element by its immutable ID
   */
  atId(id: number): GameElement | undefined {
    if (this._t.id === id) return this;

    for (const child of this._t.children) {
      const found = child.atId(id);
      if (found) return found;
    }

    return undefined;
  }


  // ============================================
  // Element Creation
  // ============================================

  /**
   * Create a single child element
   */
  create<T extends GameElement>(
    elementClass: ElementClass<T>,
    name: string,
    attributes?: ElementAttributes<T>
  ): T {
    return this.createInternal(elementClass, name, attributes);
  }

  /**
   * Internal creation method called by command executor
   */
  createInternal<T extends GameElement>(
    elementClass: ElementClass<T>,
    name: string,
    attributes?: Record<string, unknown>
  ): T {
    const element = new elementClass(this._ctx);
    element.name = name;
    element.game = this.game;

    // Apply attributes
    if (attributes) {
      Object.assign(element, attributes);
    }

    // Add to tree
    this.addChild(element);

    // Register class for deserialization (using Map)
    const className = elementClass.name;
    if (!this._ctx.classRegistry.has(className)) {
      this._ctx.classRegistry.set(className, elementClass);
    }

    return element;
  }

  /**
   * Create multiple child elements
   */
  createMany<T extends GameElement>(
    count: number,
    elementClass: ElementClass<T>,
    name: string,
    attributes?: ElementAttributes<T> | ((index: number) => ElementAttributes<T>)
  ): ElementCollection<T> {
    const elements = new ElementCollection<T>();

    for (let i = 0; i < count; i++) {
      const attrs = typeof attributes === 'function' ? attributes(i) : attributes;
      elements.push(this.create(elementClass, name, attrs));
    }

    return elements;
  }

  /**
   * Add a child element to this element
   */
  protected addChild(element: GameElement): void {
    element._t.parent = this;

    if (this._t.order === 'stacking') {
      this._t.children.unshift(element);
    } else {
      this._t.children.push(element);
    }
  }

  /**
   * Remove a child element from this element
   */
  protected removeChild(element: GameElement): void {
    const index = this._t.children.indexOf(element);
    if (index !== -1) {
      this._t.children.splice(index, 1);
      element._t.parent = undefined;
    }
  }

  /**
   * Set the ordering mode for children
   */
  setOrder(order: 'normal' | 'stacking'): void {
    this._t.order = order;
  }

  // ============================================
  // Queries
  // ============================================

  /**
   * Find all matching descendant elements
   */
  all<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F>;
  all(...finders: ElementFinder<GameElement>[]): ElementCollection<GameElement>;
  all<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F> {
    const collection = new ElementCollection(...this._t.children);
    return collection.all(classNameOrFinder as ElementClass<F>, ...finders);
  }

  /**
   * Find the first matching descendant element
   */
  first<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined;
  first(...finders: ElementFinder<GameElement>[]): GameElement | undefined;
  first<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined {
    const collection = new ElementCollection(...this._t.children);
    return collection.first(classNameOrFinder as ElementClass<F>, ...finders);
  }

  /**
   * Find the first N matching descendant elements
   */
  firstN<F extends GameElement>(
    n: number,
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F>;
  firstN(n: number, ...finders: ElementFinder<GameElement>[]): ElementCollection<GameElement>;
  firstN<F extends GameElement>(
    n: number,
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F> {
    const collection = new ElementCollection(...this._t.children);
    return collection.firstN(n, classNameOrFinder as ElementClass<F>, ...finders);
  }

  /**
   * Find the last matching descendant element
   */
  last<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined;
  last(...finders: ElementFinder<GameElement>[]): GameElement | undefined;
  last<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined {
    const collection = new ElementCollection(...this._t.children);
    return collection.last(classNameOrFinder as ElementClass<F>, ...finders);
  }

  /**
   * Find the last N matching descendant elements
   */
  lastN<F extends GameElement>(
    n: number,
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F>;
  lastN(n: number, ...finders: ElementFinder<GameElement>[]): ElementCollection<GameElement>;
  lastN<F extends GameElement>(
    n: number,
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F> {
    const collection = new ElementCollection(...this._t.children);
    return collection.lastN(n, classNameOrFinder as ElementClass<F>, ...finders);
  }

  /**
   * Check if any matching descendant elements exist
   */
  has<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): boolean;
  has(...finders: ElementFinder<GameElement>[]): boolean;
  has<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): boolean {
    const collection = new ElementCollection(...this._t.children);
    return collection.has(classNameOrFinder as ElementClass<F>, ...finders);
  }

  /**
   * Count matching descendant elements
   */
  count<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): number;
  count(...finders: ElementFinder<GameElement>[]): number;
  count<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): number {
    return this.all(classNameOrFinder as ElementClass<F>, ...finders).length;
  }

  // ============================================
  // Visibility
  // ============================================

  /**
   * Get effective visibility (own or inherited from parent zone)
   */
  getEffectiveVisibility(): VisibilityState {
    // If this element has explicit visibility, use it
    if (this._visibility?.explicit) {
      return this._visibility;
    }
    // Otherwise inherit from parent's zone visibility
    return resolveVisibility(this._visibility, this.getParentZoneVisibility());
  }

  /**
   * Get the zone visibility from the nearest parent Space
   */
  protected getParentZoneVisibility(): VisibilityState | undefined {
    // Import Space dynamically to avoid circular dependency
    const parent = this._t.parent;
    if (!parent) return undefined;

    // Check if parent is a Space with zone visibility
    if ('getZoneVisibility' in parent && typeof parent.getZoneVisibility === 'function') {
      const zoneVis = (parent as any).getZoneVisibility();
      if (zoneVis) return zoneVis;
    }

    // Otherwise continue up the tree
    return parent.getParentZoneVisibility?.();
  }

  /**
   * Check if this element is visible to a player
   */
  isVisibleTo(player: Player | number): boolean {
    const position = typeof player === 'number' ? player : player.position;
    const visibility = this.getEffectiveVisibility();
    // For owner-based visibility, check this element's owner first,
    // then walk up the tree to find an owner (for inherited visibility)
    const ownerPosition = this.getEffectiveOwner()?.position;
    return canPlayerSee(visibility, position, ownerPosition);
  }

  /**
   * Get the effective owner for visibility purposes
   * (this element's player, or inherited from parent)
   */
  getEffectiveOwner(): Player | undefined {
    if (this.player) return this.player;
    return this._t.parent?.getEffectiveOwner();
  }

  /**
   * Check if this element is visible in the current context
   */
  isVisible(): boolean {
    if (!this._ctx.player) return true;
    return this.isVisibleTo(this._ctx.player);
  }

  /**
   * Internal method to set visibility (called by command executor)
   */
  setVisibilityInternal(visibility: VisibilityState): void {
    this._visibility = visibility;
  }

  /**
   * Internal method to add players to visibility list
   */
  addVisibleToInternal(players: number[]): void {
    if (!this._visibility) {
      this._visibility = { ...DEFAULT_VISIBILITY, explicit: true };
    }
    this._visibility.addPlayers = Array.from(
      new Set([...(this._visibility.addPlayers ?? []), ...players])
    );
  }

  // ============================================
  // Serialization
  // ============================================

  /**
   * Serialize this element and its descendants to JSON
   */
  toJSON(): ElementJSON {
    const className = this.constructor.name;
    const unserializable = new Set(
      (this.constructor as typeof GameElement).unserializableAttributes
    );

    // Collect serializable attributes
    const attributes: Record<string, unknown> = {};
    for (const key of Object.keys(this)) {
      if (!unserializable.has(key) && !key.startsWith('_')) {
        const value = (this as Record<string, unknown>)[key];
        if (value !== undefined) {
          attributes[key] = this.serializeValue(value);
        }
      }
    }

    const json: ElementJSON = {
      className,
      id: this._t.id,
      attributes,
    };

    if (this.name) {
      json.name = this.name;
    }

    // Include visibility if explicitly set
    if (this._visibility?.explicit) {
      json.visibility = this._visibility;
    }

    if (this._t.children.length > 0) {
      json.children = this._t.children.map((child) => child.toJSON());
    }

    return json;
  }

  /**
   * Serialize a value for JSON
   */
  protected serializeValue(value: unknown): unknown {
    if (value instanceof GameElement) {
      // Serialize element references as branch paths
      return { __elementRef: value.branch() };
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v));
    }
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.serializeValue(v);
      }
      return result;
    }
    return value;
  }

  /**
   * Create an element tree from JSON
   */
  static fromJSON<T extends GameElement>(
    json: ElementJSON,
    ctx: ElementContext,
    classRegistry: Map<string, ElementClass>
  ): T {
    const ElementClass = classRegistry.get(json.className);
    if (!ElementClass) {
      throw new Error(`Unknown element class: ${json.className}`);
    }

    const element = new ElementClass(ctx);
    element._t.id = json.id;

    if (json.name) {
      element.name = json.name;
    }

    // Restore visibility if present
    if (json.visibility) {
      element._visibility = json.visibility;
    }

    // Apply attributes
    for (const [key, value] of Object.entries(json.attributes)) {
      (element as unknown as Record<string, unknown>)[key] = value;
    }

    // Recursively create children
    if (json.children) {
      for (const childJson of json.children) {
        const child = GameElement.fromJSON(childJson, ctx, classRegistry);
        child._t.parent = element;
        element._t.children.push(child);
      }
    }

    return element as T;
  }

  // ============================================
  // ID Access
  // ============================================

  /**
   * Get the immutable ID
   */
  get id(): number {
    return this._t.id;
  }
}
