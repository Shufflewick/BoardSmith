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
 * the game state.
 *
 * **Do not extend directly** - use {@link Space} for containers (boards, hands, decks)
 * or {@link Piece} for movable items (tokens, cards, dice).
 *
 * GameElement provides:
 * - **Tree structure**: Parent/child relationships via `parent`, `children`
 * - **Queries**: Find descendants via `all()`, `first()`, `last()`, `has()`
 * - **Creation**: Create children via `create()`, `createMany()`
 * - **Movement**: Move between containers via `putInto()`, `remove()`
 * - **Visibility**: Control who sees what via visibility system
 *
 * @example
 * ```typescript
 * // Querying elements
 * const allCards = game.all(Card);
 * const redCards = game.all(Card, { color: 'red' });
 * const topCard = deck.first(Card);
 *
 * // Finding with functions
 * const playableCards = hand.all(Card, c => c.cost <= player.mana);
 *
 * // Creating elements
 * const card = deck.create(Card, 'Fireball', { damage: 5 });
 *
 * // Moving elements
 * card.putInto(hand);
 * card.remove(); // Goes to game.pile
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
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
   * Create a child element within this container.
   *
   * The new element becomes a child of this element in the tree structure.
   * Use this to build your game's element hierarchy during setup.
   *
   * @param elementClass - The element class to instantiate (e.g., `Card`, `Piece`)
   * @param name - Name for the element (used in queries and display)
   * @param attributes - Optional initial attribute values
   * @returns The created element
   *
   * @example
   * ```typescript
   * // Create a simple element
   * const piece = board.create(Piece, 'pawn');
   *
   * // Create with attributes
   * const card = deck.create(Card, 'Fireball', {
   *   damage: 5,
   *   cost: 3,
   *   $image: 'cards/fireball.png'
   * });
   *
   * // Create player-owned element
   * const hand = game.create(Hand, 'hand', { player: currentPlayer });
   * ```
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
    // Validate element class
    if (!elementClass) {
      throw new Error(
        `Cannot create element: elementClass is ${elementClass}.\n` +
        `Parent: ${this.constructor.name} "${this.name}"\n` +
        `Hint: Make sure you imported the element class correctly.`
      );
    }

    if (typeof elementClass !== 'function') {
      throw new Error(
        `Cannot create element: expected a class constructor, got ${typeof elementClass}.\n` +
        `Parent: ${this.constructor.name} "${this.name}"\n` +
        `Value: ${JSON.stringify(elementClass)}`
      );
    }

    let element: T;
    try {
      element = new elementClass(this._ctx);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to instantiate ${elementClass.name}:\n` +
        `  Error: ${errMsg}\n` +
        `  Parent: ${this.constructor.name} "${this.name}"\n` +
        `  Hint: Check that ${elementClass.name} constructor accepts a context parameter.`
      );
    }

    element.name = name;
    element.game = this.game;

    // Apply attributes with validation
    if (attributes) {
      try {
        for (const [key, value] of Object.entries(attributes)) {
          if (key === 'id' || key === '_t' || key === '_ctx') {
            console.warn(
              `Warning: Setting reserved property "${key}" on ${elementClass.name} "${name}" - ` +
              `this may cause unexpected behavior.`
            );
          }
          (element as any)[key] = value;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to set attributes on ${elementClass.name} "${name}":\n` +
          `  Error: ${errMsg}\n` +
          `  Attributes: ${JSON.stringify(attributes)}`
        );
      }
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
   * Find all matching descendant elements.
   *
   * Searches this element's entire subtree (children, grandchildren, etc.)
   * for elements matching the given class and/or filter conditions.
   *
   * @param className - Element class to filter by (e.g., `Card`, `Piece`)
   * @param finders - Additional filters: attribute objects or predicate functions
   * @returns ElementCollection of matching elements
   *
   * @example
   * ```typescript
   * // Find all Cards anywhere in the game
   * const allCards = game.all(Card);
   *
   * // Find Cards with specific attributes
   * const redCards = game.all(Card, { color: 'red' });
   *
   * // Find Cards matching a condition
   * const playableCards = hand.all(Card, c => c.cost <= player.mana);
   *
   * // Combine class and condition
   * const cheapRedCards = game.all(Card, { color: 'red' }, c => c.cost < 3);
   * ```
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
   * Find the first matching descendant element.
   *
   * Returns the first element found in depth-first order that matches
   * the given class and/or filter conditions.
   *
   * @param className - Element class to filter by
   * @param finders - Additional filters
   * @returns First matching element, or `undefined` if none found
   *
   * @example
   * ```typescript
   * // Get top card from deck (first child)
   * const topCard = deck.first(Card);
   *
   * // Find first unoccupied space
   * const emptySpace = board.first(Space, s => s.isEmpty());
   *
   * // Find player's first piece
   * const myPiece = game.first(Piece, { player: currentPlayer });
   * ```
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
   * Find the first N matching descendant elements.
   *
   * @param n - Maximum number of elements to return
   * @param className - Element class to filter by
   * @param finders - Additional filters
   * @returns ElementCollection with up to N matching elements
   *
   * @example
   * ```typescript
   * // Draw 3 cards from deck
   * const drawnCards = deck.firstN(3, Card);
   *
   * // Get first 5 pieces in play area
   * const pieces = playArea.firstN(5, Piece);
   * ```
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
   * Find the last matching descendant element.
   *
   * Returns the last element found that matches the given conditions.
   * Useful for "bottom of deck" or most recently added elements.
   *
   * @param className - Element class to filter by
   * @param finders - Additional filters
   * @returns Last matching element, or `undefined` if none found
   *
   * @example
   * ```typescript
   * // Get bottom card from deck
   * const bottomCard = deck.last(Card);
   *
   * // Get most recently played card
   * const lastPlayed = discardPile.last(Card);
   * ```
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
   * Find the last N matching descendant elements.
   *
   * @param n - Maximum number of elements to return
   * @param className - Element class to filter by
   * @param finders - Additional filters
   * @returns ElementCollection with up to N matching elements
   *
   * @example
   * ```typescript
   * // Get bottom 3 cards from deck
   * const bottomCards = deck.lastN(3, Card);
   * ```
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
   * Check if any matching descendant elements exist.
   *
   * More efficient than `all().length > 0` because it stops at first match.
   *
   * @param className - Element class to filter by
   * @param finders - Additional filters
   * @returns `true` if at least one matching element exists
   *
   * @example
   * ```typescript
   * // Check if player has any cards
   * if (hand.has(Card)) { ... }
   *
   * // Check if player can afford any card
   * if (shop.has(Card, c => c.cost <= player.gold)) { ... }
   *
   * // Check for specific card type
   * if (hand.has(Card, { type: 'attack' })) { ... }
   * ```
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
   * Count matching descendant elements.
   *
   * @param className - Element class to filter by
   * @param finders - Additional filters
   * @returns Number of matching elements
   *
   * @example
   * ```typescript
   * // Count cards in hand
   * const handSize = hand.count(Card);
   *
   * // Count damage tokens on a unit
   * const damage = unit.count(DamageToken);
   * ```
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
   * Serialize a value for JSON.
   * @param visited - Set of already-visited objects to detect circular references
   * @param depth - Current recursion depth (safety limit)
   */
  protected serializeValue(value: unknown, visited: Set<object> = new Set(), depth = 0): unknown {
    // Safety limit to prevent stack overflow from deep/circular structures
    if (depth > 100) {
      console.warn('[BoardSmith] Serialization depth exceeded 100, truncating. This may indicate circular references.');
      return undefined;
    }

    // Handle primitives and null/undefined first
    if (value === null || value === undefined || typeof value !== 'object') {
      return value;
    }

    // GameElement references get special handling (no cycle risk - they become refs)
    if (value instanceof GameElement) {
      // Check if this is a Player (has position property unique to Player)
      // Use duck typing to avoid circular import (Player extends GameElement)
      if ('position' in value && typeof (value as Player).position === 'number') {
        const player = value as Player;
        // Include useful properties for UI while maintaining deserializability via __playerRef
        return {
          __playerRef: player.position,
          position: player.position,
          color: player.color,
          name: player.name,
        };
      }
      // Serialize regular element references as branch paths
      return { __elementRef: value.branch() };
    }

    // Detect circular references for all objects (including arrays)
    if (visited.has(value)) {
      return undefined;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v, visited, depth + 1));
    }

    // Plain object
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = this.serializeValue(v, visited, depth + 1);
    }
    return result;
  }

  /**
   * Resolve element references in this element's attributes after deserialization.
   * Called after the entire element tree is restored to convert
   * { __elementRef: "path" } objects back to actual element references.
   */
  resolveElementReferences(game: Game): void {
    const unserializable = new Set(
      (this.constructor as typeof GameElement).unserializableAttributes
    );

    // Resolve references in own attributes
    for (const key of Object.keys(this)) {
      if (!unserializable.has(key) && !key.startsWith('_')) {
        const value = (this as Record<string, unknown>)[key];
        if (value !== undefined) {
          (this as Record<string, unknown>)[key] = this.deserializeValue(value, game);
        }
      }
    }

    // Recursively resolve references in children
    for (const child of this._t.children) {
      child.resolveElementReferences(game);
    }
  }

  /**
   * Deserialize a value that may contain element references
   * @param depth - Current recursion depth (safety limit)
   * @param path - Property path for debugging
   */
  protected deserializeValue(value: unknown, game: Game, depth = 0, path = ''): unknown {
    // Safety limit to prevent stack overflow
    if (depth > 100) {
      console.warn(`[BoardSmith] Deserialization depth exceeded at: ${path || 'root'}`);
      return undefined;
    }

    if (value === null || value === undefined) {
      return value;
    }

    // Handle element reference by branch path
    if (typeof value === 'object' && value !== null && '__elementRef' in value) {
      const ref = value as { __elementRef: string };
      return game.atBranch(ref.__elementRef);
    }

    // Handle element reference by ID
    if (typeof value === 'object' && value !== null && '__elementId' in value) {
      const ref = value as { __elementId: number };
      return game.getElementById(ref.__elementId);
    }

    // Handle player reference (stored as 1-indexed position)
    if (typeof value === 'object' && value !== null && '__playerRef' in value) {
      const ref = value as { __playerRef: number };
      return game.getPlayer(ref.__playerRef);
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item, i) => this.deserializeValue(item, game, depth + 1, `${path}[${i}]`));
    }

    // Handle plain objects (but not element references)
    if (typeof value === 'object' && value !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.deserializeValue(v, game, depth + 1, path ? `${path}.${k}` : k);
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
      const registeredClasses = Array.from(classRegistry.keys()).join(', ');
      throw new Error(
        `Unknown element class: "${json.className}"\n\n` +
        `This error occurs when deserializing game state (e.g., after restart, undo, or AI move).\n\n` +
        `Registered classes: ${registeredClasses || '(none)'}\n\n` +
        `To fix this, register the class in your Game constructor:\n` +
        `  this.registerElements([${json.className}, ...]);\n\n` +
        `Or check that "${json.className}" is spelled correctly and imported.`
      );
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
  // ID Access and Comparison
  // ============================================

  /**
   * Get the immutable ID
   */
  get id(): number {
    return this._t.id;
  }

  /**
   * Compare this element to another by ID.
   * Use this instead of === or .includes() which fail due to object reference issues.
   *
   * @example
   * // WRONG: card1 === card2 (fails - different object instances)
   * // CORRECT: card1.equals(card2)
   */
  equals(other: GameElement | null | undefined): boolean {
    if (!other) return false;
    return this._t.id === other._t.id;
  }

  /**
   * Check if this element's ID matches a given ID
   */
  hasId(id: number): boolean {
    return this._t.id === id;
  }
}
