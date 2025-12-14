// ../../engine/dist/element/element-collection.js
var ElementCollection = class _ElementCollection extends Array {
  /**
   * Override slice to return ElementCollection
   */
  slice(...args) {
    return super.slice(...args);
  }
  /**
   * Override filter to return ElementCollection
   */
  filter(predicate) {
    return super.filter(predicate);
  }
  all(classNameOrFinder, ...finders) {
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, {}, ...finders);
    }
    if (classNameOrFinder !== void 0) {
      finders = [classNameOrFinder, ...finders];
    }
    return this._finder(void 0, {}, ...finders);
  }
  first(classNameOrFinder, ...finders) {
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, { limit: 1 }, ...finders)[0];
    }
    if (classNameOrFinder !== void 0) {
      finders = [classNameOrFinder, ...finders];
    }
    return this._finder(void 0, { limit: 1 }, ...finders)[0];
  }
  firstN(n, classNameOrFinder, ...finders) {
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, { limit: n }, ...finders);
    }
    if (classNameOrFinder !== void 0) {
      finders = [classNameOrFinder, ...finders];
    }
    return this._finder(void 0, { limit: n }, ...finders);
  }
  last(classNameOrFinder, ...finders) {
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, { limit: 1, order: "desc" }, ...finders)[0];
    }
    if (classNameOrFinder !== void 0) {
      finders = [classNameOrFinder, ...finders];
    }
    return this._finder(void 0, { limit: 1, order: "desc" }, ...finders)[0];
  }
  lastN(n, classNameOrFinder, ...finders) {
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, { limit: n, order: "desc" }, ...finders);
    }
    if (classNameOrFinder !== void 0) {
      finders = [classNameOrFinder, ...finders];
    }
    return this._finder(void 0, { limit: n, order: "desc" }, ...finders);
  }
  has(classNameOrFinder, ...finders) {
    return this.first(classNameOrFinder, ...finders) !== void 0;
  }
  /**
   * Sort elements by a property or function
   */
  sortBy(key, direction = "asc") {
    const sorted = new _ElementCollection(...this);
    sorted.sort((a, b) => {
      const aVal = typeof key === "function" ? key(a) : a[key];
      const bVal = typeof key === "function" ? key(b) : b[key];
      if (aVal < bVal)
        return direction === "asc" ? -1 : 1;
      if (aVal > bVal)
        return direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }
  /**
   * Get the sum of a numeric property
   */
  sum(key) {
    return this.reduce((acc, el) => {
      const val = typeof key === "function" ? key(el) : el[key];
      return acc + (typeof val === "number" ? val : 0);
    }, 0);
  }
  /**
   * Get the minimum value of a property
   */
  min(key) {
    if (this.length === 0)
      return void 0;
    return this.reduce((min, el) => {
      const minVal = typeof key === "function" ? key(min) : min[key];
      const elVal = typeof key === "function" ? key(el) : el[key];
      return elVal < minVal ? el : min;
    });
  }
  /**
   * Get the maximum value of a property
   */
  max(key) {
    if (this.length === 0)
      return void 0;
    return this.reduce((max, el) => {
      const maxVal = typeof key === "function" ? key(max) : max[key];
      const elVal = typeof key === "function" ? key(el) : el[key];
      return elVal > maxVal ? el : max;
    });
  }
  /**
   * Shuffle the collection in place using the provided random function
   */
  shuffle(random = Math.random) {
    for (let i = this.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this[i], this[j]] = [this[j], this[i]];
    }
    return this;
  }
  /**
   * Get unique values of a property
   */
  unique(key) {
    const seen = /* @__PURE__ */ new Set();
    for (const el of this) {
      seen.add(el[key]);
    }
    return Array.from(seen);
  }
  /**
   * Internal finder implementation
   */
  _finder(className, options, ...finders) {
    const result = new _ElementCollection();
    if (options.limit !== void 0 && options.limit <= 0)
      return result;
    const predicates = finders.map((finder) => this.finderToPredicate(finder));
    const process = (elements, order) => {
      const items = order === "desc" ? [...elements].reverse() : elements;
      for (const el of items) {
        if (options.limit !== void 0 && result.length >= options.limit)
          break;
        const matchesClass = !className || el instanceof className;
        const matchesPredicates = predicates.every((pred) => pred(el));
        if (matchesClass && matchesPredicates) {
          if (order === "desc") {
            result.unshift(el);
          } else {
            result.push(el);
          }
        }
        if (!options.noRecursive && el._t.children.length > 0) {
          const childCollection = new _ElementCollection(...el._t.children);
          const remaining = options.limit !== void 0 ? options.limit - result.length : void 0;
          const childResults = childCollection._finder(className, {
            ...options,
            limit: remaining
          }, ...finders);
          result.push(...childResults);
        }
      }
    };
    process(this, options.order ?? "asc");
    return result;
  }
  /**
   * Convert an ElementFinder to a predicate function
   */
  finderToPredicate(finder) {
    if (typeof finder === "string") {
      return (el) => el.name === finder;
    }
    if (typeof finder === "function") {
      return finder;
    }
    return (el) => {
      for (const [key, value] of Object.entries(finder)) {
        if (key === "empty") {
          if (value !== el.isEmpty())
            return false;
        } else if (key === "mine") {
          if (value !== el.isMine())
            return false;
        } else {
          if (el[key] !== value)
            return false;
        }
      }
      return true;
    };
  }
  /**
   * Check if a value is an ElementClass
   */
  isElementClass(value) {
    return typeof value === "function" && "isGameElement" in value && value.isGameElement === true;
  }
};

// ../../engine/dist/command/visibility.js
function canPlayerSee(visibility, playerPosition, ownerPosition) {
  if (visibility.exceptPlayers?.includes(playerPosition)) {
    return false;
  }
  if (visibility.addPlayers?.includes(playerPosition)) {
    return true;
  }
  switch (visibility.mode) {
    case "all":
      return true;
    case "owner":
      return ownerPosition !== void 0 && playerPosition === ownerPosition;
    case "hidden":
    case "count-only":
    case "unordered":
      return false;
    default:
      return true;
  }
}
var DEFAULT_VISIBILITY = {
  mode: "all",
  explicit: false
};
function visibilityFromMode(mode) {
  return {
    mode,
    explicit: true
  };
}
function resolveVisibility(childVisibility, parentVisibility) {
  if (childVisibility?.explicit) {
    return childVisibility;
  }
  if (parentVisibility) {
    return {
      ...parentVisibility,
      explicit: false
      // Mark as inherited
    };
  }
  return DEFAULT_VISIBILITY;
}

// ../../engine/dist/element/game-element.js
var GameElement = class _GameElement {
  /** Element name for identification and queries */
  name;
  /** Player who owns this element (affects "mine" queries and visibility) */
  player;
  /** Row position in grid layout */
  row;
  /** Column position in grid layout */
  column;
  /**
   * Image for single-sided elements (boards, mats, tokens).
   * For multi-sided elements (cards, dice), use $images instead.
   * System property - $ prefix indicates this is for the rendering system.
   */
  $image;
  /**
   * Images for multi-sided elements, keyed by side name.
   * Common keys: 'face', 'back' for cards; 'side1'-'side6' for dice.
   * System property - $ prefix indicates this is for the rendering system.
   */
  $images;
  /** Reference to the root game */
  game;
  /** Shared context for all elements in the tree */
  _ctx;
  /** Internal tree structure */
  _t;
  /** Visibility state for this element */
  _visibility;
  /** Static flag to identify GameElement classes */
  static isGameElement = true;
  /** Attributes that should not be serialized */
  static unserializableAttributes = ["_ctx", "_t", "game", "_visibility"];
  /** Attributes visible to all players (undefined = all visible) */
  static visibleAttributes;
  constructor(ctx) {
    this._ctx = ctx;
    if (this._ctx.sequence === void 0) {
      this._ctx.sequence = 0;
    }
    if (!this._ctx.classRegistry) {
      this._ctx.classRegistry = /* @__PURE__ */ new Map();
    }
    const id = this._ctx.sequence++;
    this._t = {
      children: [],
      id,
      order: "normal"
    };
  }
  /**
   * String representation of the element
   */
  toString() {
    return this.name ?? this.constructor.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  }
  // ============================================
  // Tree Structure
  // ============================================
  /**
   * Get the parent element
   */
  get parent() {
    return this._t.parent;
  }
  /**
   * Get all direct children
   */
  get children() {
    return new ElementCollection(...this._t.children);
  }
  /**
   * Check if this element has no children
   */
  isEmpty() {
    return this._t.children.length === 0;
  }
  /**
   * Check if this element belongs to the current player context
   */
  isMine() {
    if (!this._ctx.player)
      return false;
    return this.player === this._ctx.player;
  }
  /**
   * Get the branch path from root to this element (e.g., "0/2/1")
   */
  branch() {
    const path = [];
    let current = this;
    while (current?._t.parent) {
      const parent = current._t.parent;
      const index = parent._t.children.indexOf(current);
      path.unshift(index);
      current = parent;
    }
    return path.join("/");
  }
  /**
   * Find an element by its branch path
   */
  atBranch(branch) {
    if (!branch)
      return this;
    const indices = branch.split("/").map(Number);
    let current = this;
    for (const index of indices) {
      const child = current._t.children[index];
      if (!child)
        return void 0;
      current = child;
    }
    return current;
  }
  /**
   * Find an element by its immutable ID
   */
  atId(id) {
    if (this._t.id === id)
      return this;
    for (const child of this._t.children) {
      const found = child.atId(id);
      if (found)
        return found;
    }
    return void 0;
  }
  // ============================================
  // Element Creation
  // ============================================
  /**
   * Create a single child element
   */
  create(elementClass, name, attributes) {
    return this.createInternal(elementClass, name, attributes);
  }
  /**
   * Internal creation method called by command executor
   */
  createInternal(elementClass, name, attributes) {
    const element = new elementClass(this._ctx);
    element.name = name;
    element.game = this.game;
    if (attributes) {
      Object.assign(element, attributes);
    }
    this.addChild(element);
    const className = elementClass.name;
    if (!this._ctx.classRegistry.has(className)) {
      this._ctx.classRegistry.set(className, elementClass);
    }
    return element;
  }
  /**
   * Create multiple child elements
   */
  createMany(count, elementClass, name, attributes) {
    const elements = new ElementCollection();
    for (let i = 0; i < count; i++) {
      const attrs = typeof attributes === "function" ? attributes(i) : attributes;
      elements.push(this.create(elementClass, name, attrs));
    }
    return elements;
  }
  /**
   * Add a child element to this element
   */
  addChild(element) {
    element._t.parent = this;
    if (this._t.order === "stacking") {
      this._t.children.unshift(element);
    } else {
      this._t.children.push(element);
    }
  }
  /**
   * Remove a child element from this element
   */
  removeChild(element) {
    const index = this._t.children.indexOf(element);
    if (index !== -1) {
      this._t.children.splice(index, 1);
      element._t.parent = void 0;
    }
  }
  /**
   * Set the ordering mode for children
   */
  setOrder(order) {
    this._t.order = order;
  }
  all(classNameOrFinder, ...finders) {
    const collection = new ElementCollection(...this._t.children);
    return collection.all(classNameOrFinder, ...finders);
  }
  first(classNameOrFinder, ...finders) {
    const collection = new ElementCollection(...this._t.children);
    return collection.first(classNameOrFinder, ...finders);
  }
  firstN(n, classNameOrFinder, ...finders) {
    const collection = new ElementCollection(...this._t.children);
    return collection.firstN(n, classNameOrFinder, ...finders);
  }
  last(classNameOrFinder, ...finders) {
    const collection = new ElementCollection(...this._t.children);
    return collection.last(classNameOrFinder, ...finders);
  }
  lastN(n, classNameOrFinder, ...finders) {
    const collection = new ElementCollection(...this._t.children);
    return collection.lastN(n, classNameOrFinder, ...finders);
  }
  has(classNameOrFinder, ...finders) {
    const collection = new ElementCollection(...this._t.children);
    return collection.has(classNameOrFinder, ...finders);
  }
  count(classNameOrFinder, ...finders) {
    return this.all(classNameOrFinder, ...finders).length;
  }
  // ============================================
  // Visibility
  // ============================================
  /**
   * Get effective visibility (own or inherited from parent zone)
   */
  getEffectiveVisibility() {
    if (this._visibility?.explicit) {
      return this._visibility;
    }
    return resolveVisibility(this._visibility, this.getParentZoneVisibility());
  }
  /**
   * Get the zone visibility from the nearest parent Space
   */
  getParentZoneVisibility() {
    const parent = this._t.parent;
    if (!parent)
      return void 0;
    if ("getZoneVisibility" in parent && typeof parent.getZoneVisibility === "function") {
      const zoneVis = parent.getZoneVisibility();
      if (zoneVis)
        return zoneVis;
    }
    return parent.getParentZoneVisibility?.();
  }
  /**
   * Check if this element is visible to a player
   */
  isVisibleTo(player) {
    const position = typeof player === "number" ? player : player.position;
    const visibility = this.getEffectiveVisibility();
    const ownerPosition = this.getEffectiveOwner()?.position;
    return canPlayerSee(visibility, position, ownerPosition);
  }
  /**
   * Get the effective owner for visibility purposes
   * (this element's player, or inherited from parent)
   */
  getEffectiveOwner() {
    if (this.player)
      return this.player;
    return this._t.parent?.getEffectiveOwner();
  }
  /**
   * Check if this element is visible in the current context
   */
  isVisible() {
    if (!this._ctx.player)
      return true;
    return this.isVisibleTo(this._ctx.player);
  }
  /**
   * Internal method to set visibility (called by command executor)
   */
  setVisibilityInternal(visibility) {
    this._visibility = visibility;
  }
  /**
   * Internal method to add players to visibility list
   */
  addVisibleToInternal(players) {
    if (!this._visibility) {
      this._visibility = { ...DEFAULT_VISIBILITY, explicit: true };
    }
    this._visibility.addPlayers = Array.from(/* @__PURE__ */ new Set([...this._visibility.addPlayers ?? [], ...players]));
  }
  // ============================================
  // Serialization
  // ============================================
  /**
   * Serialize this element and its descendants to JSON
   */
  toJSON() {
    const className = this.constructor.name;
    const unserializable = new Set(this.constructor.unserializableAttributes);
    const attributes = {};
    for (const key of Object.keys(this)) {
      if (!unserializable.has(key) && !key.startsWith("_")) {
        const value = this[key];
        if (value !== void 0) {
          attributes[key] = this.serializeValue(value);
        }
      }
    }
    const json = {
      className,
      id: this._t.id,
      attributes
    };
    if (this.name) {
      json.name = this.name;
    }
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
  serializeValue(value) {
    if (value instanceof _GameElement) {
      return { __elementRef: value.branch() };
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v));
    }
    if (value && typeof value === "object") {
      const result = {};
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
  static fromJSON(json, ctx, classRegistry) {
    const ElementClass = classRegistry.get(json.className);
    if (!ElementClass) {
      throw new Error(`Unknown element class: ${json.className}`);
    }
    const element = new ElementClass(ctx);
    element._t.id = json.id;
    if (json.name) {
      element.name = json.name;
    }
    if (json.visibility) {
      element._visibility = json.visibility;
    }
    for (const [key, value] of Object.entries(json.attributes)) {
      element[key] = value;
    }
    if (json.children) {
      for (const childJson of json.children) {
        const child = _GameElement.fromJSON(childJson, ctx, classRegistry);
        child._t.parent = element;
        element._t.children.push(child);
      }
    }
    return element;
  }
  // ============================================
  // ID Access
  // ============================================
  /**
   * Get the immutable ID
   */
  get id() {
    return this._t.id;
  }
};

// ../../engine/dist/element/space.js
var Space = class extends GameElement {
  // ============================================
  // Layout Properties (for AutoUI rendering)
  // ============================================
  /**
   * Layout direction for children
   * @default 'horizontal'
   */
  $direction;
  /**
   * Gap between children (CSS value like '8px' or '0.5rem')
   */
  $gap;
  /**
   * Overlap ratio for stacked elements (0-1)
   * 0 = no overlap, 0.5 = 50% overlap, 0.9 = 90% overlap (deck-like)
   */
  $overlap;
  /**
   * Whether to fan children (like a hand of cards)
   * When true, children are rotated around a central point
   */
  $fan;
  /**
   * Fan angle in degrees for the entire spread
   * @default 30
   */
  $fanAngle;
  /**
   * Alignment of children within the space
   * @default 'center'
   */
  $align;
  // ============================================
  // Internal State
  // ============================================
  /** Event handlers for enter/exit events */
  _eventHandlers = { enter: [], exit: [] };
  /** Visibility mode for contents (not the space itself) */
  _zoneVisibility;
  static unserializableAttributes = [
    ...GameElement.unserializableAttributes,
    "_eventHandlers",
    "_zoneVisibility"
  ];
  constructor(ctx) {
    super(ctx);
  }
  // ============================================
  // Zone Visibility Configuration
  // ============================================
  /**
   * Set the visibility mode for this zone's contents (not the zone itself)
   * Children will inherit this unless they explicitly override
   */
  setZoneVisibility(mode) {
    this._zoneVisibility = visibilityFromMode(mode);
  }
  /**
   * Get the zone visibility (for children to inherit)
   */
  getZoneVisibility() {
    return this._zoneVisibility;
  }
  /**
   * Make contents visible to all players (default)
   */
  contentsVisible() {
    this.setZoneVisibility("all");
  }
  /**
   * Make contents visible only to the owner of this space
   */
  contentsVisibleToOwner() {
    this.setZoneVisibility("owner");
  }
  /**
   * Make contents hidden from all players
   */
  contentsHidden() {
    this.setZoneVisibility("hidden");
  }
  /**
   * Make contents show only count (e.g., opponent's hand size)
   */
  contentsCountOnly() {
    this.setZoneVisibility("count-only");
  }
  /**
   * Add specific players who can see contents (beyond zone default)
   */
  addZoneVisibleTo(...players) {
    const positions = players.map((p) => typeof p === "number" ? p : p.position);
    if (!this._zoneVisibility) {
      this._zoneVisibility = { mode: "all", explicit: true };
    }
    this._zoneVisibility.addPlayers = Array.from(/* @__PURE__ */ new Set([...this._zoneVisibility.addPlayers ?? [], ...positions]));
  }
  /**
   * Set players who cannot see contents (with 'all' mode)
   */
  hideContentsFrom(...players) {
    if (!this._zoneVisibility) {
      this._zoneVisibility = { mode: "all", explicit: true };
    }
    const positions = players.map((p) => typeof p === "number" ? p : p.position);
    this._zoneVisibility.exceptPlayers = Array.from(/* @__PURE__ */ new Set([...this._zoneVisibility.exceptPlayers ?? [], ...positions]));
  }
  // ============================================
  // Event Handlers
  // ============================================
  /**
   * Register a callback for when elements enter this space
   */
  onEnter(callback, elementClass) {
    this._eventHandlers.enter.push({ callback, elementClass });
  }
  /**
   * Register a callback for when elements exit this space
   */
  onExit(callback, elementClass) {
    this._eventHandlers.exit.push({ callback, elementClass });
  }
  /**
   * Trigger an event for an element
   */
  triggerEvent(type, element) {
    for (const handler of this._eventHandlers[type]) {
      if (!handler.elementClass || element instanceof handler.elementClass) {
        handler.callback(element);
      }
    }
  }
  // ============================================
  // Element Creation (override to trigger events)
  // ============================================
  create(elementClass, name, attributes) {
    const element = super.create(elementClass, name, attributes);
    this.triggerEvent("enter", element);
    return element;
  }
  // ============================================
  // Shuffle
  // ============================================
  /**
   * Shuffle the direct children of this space
   */
  shuffle() {
    this.shuffleInternal();
  }
  /**
   * Internal shuffle method called by command executor
   */
  shuffleInternal() {
    const random = this._ctx.random ?? Math.random;
    for (let i = this._t.children.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this._t.children[i], this._t.children[j]] = [
        this._t.children[j],
        this._t.children[i]
      ];
    }
  }
  // ============================================
  // Type guard
  // ============================================
  /**
   * Check if this element is a Space
   */
  isSpace() {
    return true;
  }
};

// ../../engine/dist/element/piece.js
var Piece = class extends GameElement {
  constructor(ctx) {
    super(ctx);
  }
  // ============================================
  // Movement
  // ============================================
  /**
   * Move this piece into another element (Space or Piece)
   */
  putInto(destination, options) {
    this.moveToInternal(destination, options?.position);
  }
  /**
   * Internal move method called by command executor
   */
  moveToInternal(destination, position) {
    const oldParent = this._t.parent;
    if (oldParent) {
      const index = oldParent._t.children.indexOf(this);
      if (index !== -1) {
        oldParent._t.children.splice(index, 1);
      }
      if (oldParent instanceof Space) {
        oldParent.triggerEvent("exit", this);
      }
    }
    this._t.parent = destination;
    const pos = position ?? (destination._t.order === "stacking" ? "first" : "last");
    if (pos === "first") {
      destination._t.children.unshift(this);
    } else {
      destination._t.children.push(this);
    }
    if (destination instanceof Space) {
      destination.triggerEvent("enter", this);
    }
  }
  /**
   * Remove this piece from play (moves to game.pile)
   */
  remove() {
    if (this.game.pile) {
      this.putInto(this.game.pile);
    }
  }
  // ============================================
  // Visibility Control (explicit overrides of zone default)
  // ============================================
  /**
   * Explicitly set this piece's visibility (overrides zone default)
   */
  setVisibility(mode) {
    this._visibility = visibilityFromMode(mode);
  }
  /**
   * Make this piece visible to all (overrides zone default)
   */
  showToAll() {
    this.setVisibility("all");
  }
  /**
   * Make this piece visible only to owner (overrides zone default)
   */
  showToOwner() {
    this.setVisibility("owner");
  }
  /**
   * Hide this piece from all (overrides zone default)
   */
  hideFromAll() {
    this.setVisibility("hidden");
  }
  /**
   * Add specific players who can see this piece (beyond inherited visibility)
   */
  addVisibleTo(...players) {
    const positions = players.map((p) => typeof p === "number" ? p : p.position);
    this.addVisibleToInternal(positions);
  }
  /**
   * Show this piece only to a specific player (hide from all others)
   */
  showOnlyTo(player) {
    const position = typeof player === "number" ? player : player.position;
    this._visibility = {
      mode: "hidden",
      addPlayers: [position],
      explicit: true
    };
  }
  /**
   * Hide this piece from specific players (visible to all others)
   */
  hideFrom(...players) {
    const positions = players.map((p) => typeof p === "number" ? p : p.position);
    this._visibility = {
      mode: "all",
      exceptPlayers: positions,
      explicit: true
    };
  }
  /**
   * Clear explicit visibility, reverting to inherited zone visibility
   */
  clearVisibility() {
    this._visibility = void 0;
  }
  // ============================================
  // Piece Restrictions
  // ============================================
  /**
   * Override create to prevent creating Spaces inside Pieces
   */
  create(elementClass, name, attributes) {
    if (elementClass === Space || Object.prototype.isPrototypeOf.call(Space, elementClass)) {
      throw new Error(`Cannot create Space "${name}" inside Piece "${this.name}"`);
    }
    return super.create(elementClass, name, attributes);
  }
  // ============================================
  // Type guard
  // ============================================
  /**
   * Check if this element is a Piece
   */
  isPiece() {
    return true;
  }
};

// ../../engine/dist/element/die.js
var Die = class extends Piece {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type;
  /**
   * Number of sides on the die (4, 6, 8, 10, 12, or 20)
   */
  sides;
  /**
   * Current face value (1 to sides, or 0 if not yet rolled)
   */
  value = 0;
  /**
   * Die color for rendering (CSS color string)
   */
  color = "#ffffff";
  /**
   * Optional custom labels for each face.
   * If provided, must have exactly `sides` entries.
   * Used for custom dice like Fudge dice or dice with symbols.
   */
  faceLabels;
  /**
   * Whether the die is currently rolling (for animation).
   * This is set true briefly during roll() for UI detection.
   */
  rolling = false;
  /**
   * Roll counter - increments each time the die is rolled.
   * UI can watch this to trigger animations on actual rolls.
   */
  rollCount = 0;
  constructor(ctx) {
    super(ctx);
    this.$type = "die";
  }
  /**
   * Roll the die using the game's seeded random number generator.
   * Returns the new value.
   *
   * Increments rollCount to signal the UI to animate.
   */
  roll() {
    this.rollCount++;
    this.value = Math.floor(this.game.random() * this.sides) + 1;
    return this.value;
  }
  /**
   * Clear the rolling state after animation completes.
   * @deprecated Use rollCount instead of rolling flag
   */
  stopRolling() {
    this.rolling = false;
  }
  /**
   * Set the die to a specific value.
   * Useful for abilities like "flip to opposite" or manual setting.
   * @param n - The value to set (1 to sides)
   */
  setValue(n) {
    if (n < 1 || n > this.sides) {
      throw new Error(`Invalid die value ${n} for d${this.sides}`);
    }
    this.value = n;
  }
  /**
   * Get the opposite face value.
   * For standard dice, opposite faces sum to sides + 1.
   * d4 is special - has no true opposite, returns a different value.
   */
  getOpposite() {
    if (this.sides === 4) {
      const others = [1, 2, 3, 4].filter((n) => n !== this.value);
      return others[Math.floor(this.game.random() * others.length)];
    }
    return this.sides + 1 - this.value;
  }
  /**
   * Flip the die to show the opposite face.
   * For d4, sets to a random different value.
   */
  flip() {
    this.value = this.getOpposite();
  }
  /**
   * Get the display label for the current face.
   * Returns custom label if faceLabels is set, otherwise the numeric value.
   */
  getLabel() {
    if (this.faceLabels && this.faceLabels.length === this.sides) {
      return this.faceLabels[this.value - 1];
    }
    return String(this.value);
  }
  /**
   * Check if this die has a specific number of sides
   */
  isD4() {
    return this.sides === 4;
  }
  isD6() {
    return this.sides === 6;
  }
  isD8() {
    return this.sides === 8;
  }
  isD10() {
    return this.sides === 10;
  }
  isD12() {
    return this.sides === 12;
  }
  isD20() {
    return this.sides === 20;
  }
};

// ../../engine/dist/element/dice-pool.js
var DicePool = class extends Space {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type;
  constructor(ctx) {
    super(ctx);
    this.$type = "dice-pool";
    this.$direction = "horizontal";
    this.$gap = "12px";
    this.$align = "center";
  }
  /**
   * Get all dice in the pool
   */
  getDice() {
    return this.all(Die);
  }
  /**
   * Get dice of a specific type (number of sides)
   */
  getDiceByType(sides) {
    return this.getDice().filter((d) => d.sides === sides);
  }
  /**
   * Roll all dice in the pool
   * @returns Array of [die, value] tuples
   */
  rollAll() {
    const results = [];
    for (const die of this.getDice()) {
      const value = die.roll();
      results.push([die, value]);
    }
    return results;
  }
  /**
   * Roll specific dice by their names
   * @param names - Names of dice to roll
   * @returns Array of [die, value] tuples
   */
  rollByName(...names) {
    const results = [];
    for (const name of names) {
      const die = this.first(Die, { name });
      if (die) {
        const value = die.roll();
        results.push([die, value]);
      }
    }
    return results;
  }
  /**
   * Roll dice of a specific type
   * @param sides - Number of sides (4, 6, 8, 10, 12, 20)
   * @returns Array of [die, value] tuples
   */
  rollByType(sides) {
    const results = [];
    for (const die of this.getDiceByType(sides)) {
      const value = die.roll();
      results.push([die, value]);
    }
    return results;
  }
  /**
   * Get the sum of all dice values
   */
  getTotal() {
    return this.getDice().reduce((sum, die) => sum + die.value, 0);
  }
  /**
   * Get all current dice values
   */
  getValues() {
    return this.getDice().map((d) => d.value);
  }
  /**
   * Check if any die shows a specific value
   */
  hasValue(value) {
    return this.getDice().some((d) => d.value === value);
  }
  /**
   * Count how many dice show a specific value
   */
  countValue(value) {
    return this.getDice().filter((d) => d.value === value).length;
  }
  /**
   * Create a standard set of polyhedral dice (d4, d6, d8, d10, d12, d20)
   * @param colors - Optional colors for each die type
   */
  createPolySet(colors) {
    const defaultColors = {
      4: "#4CAF50",
      // Green
      6: "#9C27B0",
      // Purple
      8: "#2196F3",
      // Blue
      10: "#FF9800",
      // Orange
      12: "#E91E63",
      // Pink
      20: "#F44336"
      // Red
    };
    const dieTypes = [4, 6, 8, 10, 12, 20];
    for (const sides of dieTypes) {
      this.create(Die, `d${sides}`, {
        sides,
        color: colors?.[sides] ?? defaultColors[sides]
      });
    }
  }
  /**
   * Create a standard RPG dice set (d4, d6, d8, 2xd10, d12, d20)
   * Used in Polyhedral Potions and similar games
   * @param colors - Optional colors for each die
   */
  createRPGSet(colors) {
    const defaultColors = {
      4: "#4CAF50",
      // Green
      6: "#9C27B0",
      // Purple
      8: "#2196F3",
      // Blue
      10: "#FF9800",
      // Orange
      12: "#E91E63",
      // Pink
      20: "#F44336"
      // Red
    };
    this.create(Die, "d4", { sides: 4, color: colors?.[4] ?? defaultColors[4] });
    this.create(Die, "d6", { sides: 6, color: colors?.[6] ?? defaultColors[6] });
    this.create(Die, "d8", { sides: 8, color: colors?.[8] ?? defaultColors[8] });
    this.create(Die, "d10", { sides: 10, color: colors?.[10] ?? defaultColors[10] });
    this.create(Die, "d10-percent", { sides: 10, color: colors?.[10] ?? defaultColors[10] });
    this.create(Die, "d12", { sides: 12, color: colors?.[12] ?? defaultColors[12] });
    this.create(Die, "d20", { sides: 20, color: colors?.[20] ?? defaultColors[20] });
  }
};

// ../../engine/dist/element/grid.js
var Grid = class extends Space {
  /**
   * System-defined layout type
   * AutoUI uses this to determine how to render this container
   * $ prefix indicates this is a system property
   */
  $layout = "grid";
  /**
   * Labels for rows (optional - game designer provides these)
   * Example: ['8', '7', '6', '5', '4', '3', '2', '1'] for chess
   * If not provided, AutoUI will use numeric indices
   */
  $rowLabels;
  /**
   * Labels for columns (optional - game designer provides these)
   * Example: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] for chess
   * If not provided, AutoUI will use numeric indices
   */
  $columnLabels;
  /**
   * Name of the attribute on GridCell children that represents the row coordinate
   * Example: 'row', 'rank', 'y'
   * AutoUI uses this to position grid cells correctly
   */
  $rowCoord;
  /**
   * Name of the attribute on GridCell children that represents the column coordinate
   * Example: 'col', 'column', 'file', 'x'
   * AutoUI uses this to position grid cells correctly
   */
  $colCoord;
  static unserializableAttributes = [
    ...Space.unserializableAttributes
  ];
};
var GridCell = class extends Space {
  /**
   * System-defined layout type
   * Indicates this is a positioned cell within a grid
   * $ prefix indicates this is a system property
   */
  $layout = "list";
  // GridCell itself is just a container
  static unserializableAttributes = [
    ...Space.unserializableAttributes
  ];
};

// ../../engine/dist/element/hex-grid.js
var HexGrid = class extends Space {
  /**
   * System-defined layout type
   * AutoUI uses this to determine how to render this container
   * $ prefix indicates this is a system property
   */
  $layout = "hex-grid";
  /**
   * Hex orientation: flat-top or pointy-top
   * - flat: Flat edge at top and bottom (like a ⬡ rotated)
   * - pointy: Point at top and bottom (like a ⬡)
   * @default 'pointy'
   */
  $hexOrientation = "pointy";
  /**
   * Coordinate system used for hex cells
   * @default 'axial'
   */
  $coordSystem = "axial";
  /**
   * Name of the Q coordinate attribute on HexCell children (axial/cube)
   * @default 'q'
   */
  $qCoord;
  /**
   * Name of the R coordinate attribute on HexCell children (axial/cube)
   * @default 'r'
   */
  $rCoord;
  /**
   * Name of the S coordinate attribute on HexCell children (cube only)
   * For cube coordinates, s = -q - r
   */
  $sCoord;
  /**
   * Size of hexes in pixels (width for flat, height for pointy)
   * @default 50
   */
  $hexSize;
  static unserializableAttributes = [
    ...Space.unserializableAttributes
  ];
};
var HexCell = class extends Space {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type;
  constructor(ctx) {
    super(ctx);
    this.$type = "hex-cell";
  }
  static unserializableAttributes = [
    ...Space.unserializableAttributes
  ];
};

// ../../engine/dist/player/player.js
var Player = class {
  /** Immutable seat position (0-indexed) */
  position;
  /** Player display name */
  name;
  /** Player color (hex code) */
  color;
  /** Player avatar URL */
  avatar;
  /** Reference to the game */
  game;
  /** Whether this player is currently taking their turn */
  _isCurrent = false;
  /** Attributes hidden from other players */
  static hiddenAttributes = [];
  constructor(position, name) {
    this.position = position;
    this.name = name;
  }
  /**
   * Check if this player is the current player
   */
  isCurrent() {
    return this._isCurrent;
  }
  /**
   * Set whether this player is current (called by game flow)
   */
  setCurrent(isCurrent) {
    this._isCurrent = isCurrent;
  }
  /**
   * Find all elements owned by this player
   */
  allMy(className, ...finders) {
    return this.game.all(className, { player: this }, ...finders);
  }
  /**
   * Find the first element owned by this player
   */
  my(className, ...finders) {
    return this.game.first(className, { player: this }, ...finders);
  }
  /**
   * Check if this player has any matching elements
   */
  has(className, ...finders) {
    return this.my(className, ...finders) !== void 0;
  }
  /**
   * Get string representation
   */
  toString() {
    return this.name;
  }
  /**
   * Serialize player to JSON
   */
  toJSON() {
    return {
      position: this.position,
      name: this.name,
      color: this.color,
      avatar: this.avatar
    };
  }
};
var PlayerCollection = class _PlayerCollection extends Array {
  /** Index of the current player */
  _currentIndex = 0;
  /**
   * Get the current player
   */
  get current() {
    return this[this._currentIndex];
  }
  /**
   * Set the current player
   */
  setCurrent(player) {
    const index = typeof player === "number" ? player : player.position;
    if (this[this._currentIndex]) {
      this[this._currentIndex].setCurrent(false);
    }
    this._currentIndex = index;
    if (this[this._currentIndex]) {
      this[this._currentIndex].setCurrent(true);
    }
  }
  /**
   * Get the next player in turn order
   */
  next(from) {
    const currentPos = from?.position ?? this._currentIndex;
    const nextPos = (currentPos + 1) % this.length;
    return this[nextPos];
  }
  /**
   * Get the previous player in turn order
   */
  previous(from) {
    const currentPos = from?.position ?? this._currentIndex;
    const prevPos = (currentPos - 1 + this.length) % this.length;
    return this[prevPos];
  }
  /**
   * Get all other players (excluding the given player or current player)
   */
  others(excluding) {
    const excludePos = excluding?.position ?? this._currentIndex;
    const result = new _PlayerCollection();
    for (const player of this) {
      if (player.position !== excludePos) {
        result.push(player);
      }
    }
    return result;
  }
  /**
   * Get the other player (for 2-player games)
   */
  other(from) {
    if (this.length !== 2) {
      throw new Error("other() can only be used in 2-player games");
    }
    const fromPos = from?.position ?? this._currentIndex;
    return this.find((p) => p.position !== fromPos);
  }
  /**
   * Find a player by position
   */
  byPosition(position) {
    return this.find((p) => p.position === position);
  }
  /**
   * Get players in turn order starting from a given player
   */
  inOrderFrom(startPlayer) {
    const result = new _PlayerCollection();
    const startIndex = startPlayer.position;
    for (let i = 0; i < this.length; i++) {
      const index = (startIndex + i) % this.length;
      result.push(this[index]);
    }
    return result;
  }
  /**
   * Serialize to JSON
   */
  toJSON() {
    return this.map((p) => {
      if (typeof p.toJSON === "function") {
        return p.toJSON();
      }
      return {
        position: p.position,
        name: p.name,
        color: p.color,
        avatar: p.avatar
      };
    });
  }
};

// ../../engine/dist/command/executor.js
function executeCommand(game, command) {
  try {
    switch (command.type) {
      case "CREATE":
        return executeCreate(game, command);
      case "CREATE_MANY":
        return executeCreateMany(game, command);
      case "MOVE":
        return executeMove(game, command);
      case "REMOVE":
        return executeRemove(game, command);
      case "SHUFFLE":
        return executeShuffle(game, command);
      case "SET_ATTRIBUTE":
        return executeSetAttribute(game, command);
      case "SET_VISIBILITY":
        return executeSetVisibility(game, command);
      case "ADD_VISIBLE_TO":
        return executeAddVisibleTo(game, command);
      case "SET_CURRENT_PLAYER":
        return executeSetCurrentPlayer(game, command);
      case "MESSAGE":
        return executeMessage(game, command);
      case "START_GAME":
        return executeStartGame(game, command);
      case "END_GAME":
        return executeEndGame(game, command);
      case "SET_ORDER":
        return executeSetOrder(game, command);
      default:
        return { success: false, error: `Unknown command type: ${command.type}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
function executeCreate(game, command) {
  const parent = game.getElementById(command.parentId);
  if (!parent) {
    return { success: false, error: `Parent element not found: ${command.parentId}` };
  }
  const ElementClass = game.getElementClass(command.className);
  if (!ElementClass) {
    return { success: false, error: `Unknown element class: ${command.className}` };
  }
  const element = parent.createInternal(ElementClass, command.name, command.attributes);
  return { success: true, createdIds: [element.id] };
}
function executeCreateMany(game, command) {
  const parent = game.getElementById(command.parentId);
  if (!parent) {
    return { success: false, error: `Parent element not found: ${command.parentId}` };
  }
  const ElementClass = game.getElementClass(command.className);
  if (!ElementClass) {
    return { success: false, error: `Unknown element class: ${command.className}` };
  }
  const createdIds = [];
  for (let i = 0; i < command.count; i++) {
    const attrs = command.attributesList?.[i] ?? {};
    const element = parent.createInternal(ElementClass, command.name, attrs);
    createdIds.push(element.id);
  }
  return { success: true, createdIds };
}
function executeMove(game, command) {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }
  const destination = game.getElementById(command.destinationId);
  if (!destination) {
    return { success: false, error: `Destination not found: ${command.destinationId}` };
  }
  element.moveToInternal(destination, command.position);
  return { success: true };
}
function executeRemove(game, command) {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }
  element.moveToInternal(game.pile);
  return { success: true };
}
function executeShuffle(game, command) {
  const space = game.getElementById(command.spaceId);
  if (!space) {
    return { success: false, error: `Space not found: ${command.spaceId}` };
  }
  space.shuffleInternal();
  return { success: true };
}
function executeSetAttribute(game, command) {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }
  element[command.attribute] = command.value;
  return { success: true };
}
function executeSetVisibility(game, command) {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }
  let visibility;
  if (typeof command.visibility === "string") {
    visibility = visibilityFromMode(command.visibility);
  } else {
    visibility = {
      mode: command.visibility.mode,
      addPlayers: command.visibility.addPlayers,
      exceptPlayers: command.visibility.exceptPlayers,
      explicit: true
    };
  }
  element.setVisibilityInternal(visibility);
  return { success: true };
}
function executeAddVisibleTo(game, command) {
  const element = game.getElementById(command.elementId);
  if (!element) {
    return { success: false, error: `Element not found: ${command.elementId}` };
  }
  element.addVisibleToInternal(command.players);
  return { success: true };
}
function executeSetCurrentPlayer(game, command) {
  game.players.setCurrent(command.playerPosition);
  return { success: true };
}
function executeMessage(game, command) {
  game.addMessageInternal(command.text, command.data);
  return { success: true };
}
function executeStartGame(game, command) {
  if (game.phase !== "setup") {
    return { success: false, error: "Game has already started" };
  }
  game.phase = "started";
  return { success: true };
}
function executeEndGame(game, command) {
  game.phase = "finished";
  if (command.winners) {
    game.settings.winners = command.winners;
  }
  return { success: true };
}
function executeSetOrder(game, command) {
  const space = game.getElementById(command.spaceId);
  if (!space) {
    return { success: false, error: `Space not found: ${command.spaceId}` };
  }
  space._t.order = command.order;
  return { success: true };
}

// ../../engine/dist/action/action.js
var Action = class _Action {
  definition;
  constructor(name) {
    this.definition = {
      name,
      selections: [],
      execute: () => {
      }
    };
  }
  /**
   * Create a new action builder
   */
  static create(name) {
    return new _Action(name);
  }
  /**
   * Set the user-facing prompt for this action
   */
  prompt(prompt) {
    this.definition.prompt = prompt;
    return this;
  }
  /**
   * Add a condition for when this action is available
   */
  condition(fn) {
    this.definition.condition = fn;
    return this;
  }
  /**
   * Mark this action as non-undoable.
   * Use for actions that reveal hidden info, involve randomness, or shouldn't be undone.
   * When executed, undo is disabled for the rest of the turn.
   */
  notUndoable() {
    this.definition.undoable = false;
    return this;
  }
  /**
   * Add a choice selection
   */
  chooseFrom(name, options) {
    const selection = {
      type: "choice",
      name,
      prompt: options.prompt,
      choices: options.choices,
      display: options.display,
      skipIfOnlyOne: options.skipIfOnlyOne,
      optional: options.optional,
      validate: options.validate,
      boardRefs: options.boardRefs,
      filterBy: options.filterBy
    };
    this.definition.selections.push(selection);
    return this;
  }
  /**
   * Add a player selection
   */
  choosePlayer(name, options = {}) {
    const selection = {
      type: "player",
      name,
      prompt: options.prompt,
      filter: options.filter,
      skipIfOnlyOne: options.skipIfOnlyOne,
      optional: options.optional,
      validate: options.validate,
      boardRefs: options.boardRefs
    };
    this.definition.selections.push(selection);
    return this;
  }
  /**
   * Add an element selection (choose from board)
   */
  chooseElement(name, options = {}) {
    const selection = {
      type: "element",
      name,
      prompt: options.prompt,
      elementClass: options.elementClass,
      from: options.from,
      filter: options.filter,
      skipIfOnlyOne: options.skipIfOnlyOne,
      optional: options.optional,
      validate: options.validate,
      display: options.display,
      boardRef: options.boardRef
    };
    this.definition.selections.push(selection);
    return this;
  }
  /**
   * Add a text input selection
   */
  enterText(name, options = {}) {
    const selection = {
      type: "text",
      name,
      prompt: options.prompt,
      pattern: options.pattern,
      minLength: options.minLength,
      maxLength: options.maxLength,
      optional: options.optional,
      validate: options.validate
    };
    this.definition.selections.push(selection);
    return this;
  }
  /**
   * Add a number input selection
   */
  enterNumber(name, options = {}) {
    const selection = {
      type: "number",
      name,
      prompt: options.prompt,
      min: options.min,
      max: options.max,
      integer: options.integer,
      optional: options.optional,
      validate: options.validate
    };
    this.definition.selections.push(selection);
    return this;
  }
  /**
   * Set the execution handler for this action
   */
  execute(fn) {
    this.definition.execute = fn;
    return this.definition;
  }
  /**
   * Get the built definition (without execute, for inspection)
   */
  build() {
    return this.definition;
  }
};
var ActionExecutor = class {
  game;
  constructor(game) {
    this.game = game;
  }
  /**
   * Resolve serialized args (player indices, element IDs) to actual objects.
   * This is needed because network-serialized args use indices/IDs instead of objects.
   */
  resolveArgs(action, args) {
    const resolved = { ...args };
    for (const selection of action.selections) {
      const value = args[selection.name];
      if (value === void 0)
        continue;
      switch (selection.type) {
        case "player": {
          if (typeof value === "number") {
            const player = this.game.players[value];
            if (player) {
              resolved[selection.name] = player;
            }
          }
          break;
        }
        case "element": {
          if (typeof value === "number") {
            const element = this.game.getElementById(value);
            if (element) {
              resolved[selection.name] = element;
            }
          }
          break;
        }
      }
    }
    return resolved;
  }
  /**
   * Get available choices for a selection given current args
   */
  getChoices(selection, player, args) {
    const context = {
      game: this.game,
      player,
      args
    };
    switch (selection.type) {
      case "choice": {
        const choiceSel = selection;
        let choices = typeof choiceSel.choices === "function" ? choiceSel.choices(context) : [...choiceSel.choices];
        if (choiceSel.filterBy) {
          const { key, selectionName } = choiceSel.filterBy;
          const previousValue = args[selectionName];
          if (previousValue !== void 0) {
            let filterValue;
            if (typeof previousValue === "object" && previousValue !== null) {
              const prevObj = previousValue;
              filterValue = prevObj[key] !== void 0 ? prevObj[key] : prevObj["id"];
            } else {
              filterValue = previousValue;
            }
            choices = choices.filter((choice) => {
              if (typeof choice === "object" && choice !== null) {
                return choice[key] === filterValue;
              }
              return choice === filterValue;
            });
          }
        }
        return choices;
      }
      case "player": {
        const playerSel = selection;
        let players = [...this.game.players];
        if (playerSel.filter) {
          players = players.filter((p) => playerSel.filter(p, context));
        }
        return players;
      }
      case "element": {
        const elementSel = selection;
        const from = typeof elementSel.from === "function" ? elementSel.from(context) : elementSel.from ?? this.game;
        let elements;
        if (elementSel.elementClass) {
          elements = [...from.all(elementSel.elementClass)];
        } else {
          elements = [...from.all()];
        }
        if (elementSel.filter) {
          elements = elements.filter((e) => elementSel.filter(e, context));
        }
        return elements;
      }
      case "text":
      case "number":
        return [];
      default:
        return [];
    }
  }
  /**
   * Check if a selection should be skipped (only one valid choice)
   */
  shouldSkip(selection, player, args) {
    if (!selection.skipIfOnlyOne) {
      return { skip: false };
    }
    const choices = this.getChoices(selection, player, args);
    if (choices.length === 1) {
      return { skip: true, value: choices[0] };
    }
    return { skip: false };
  }
  /**
   * Check if two values are equal (handles objects by comparing JSON)
   */
  valuesEqual(a, b) {
    if (a === b)
      return true;
    if (typeof a !== typeof b)
      return false;
    if (typeof a === "object" && a !== null && b !== null) {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }
  /**
   * Check if a value exists in a choices array (handles object comparison)
   */
  choicesContain(choices, value) {
    return choices.some((choice) => this.valuesEqual(choice, value));
  }
  /**
   * Validate a single selection value
   */
  validateSelection(selection, value, player, args) {
    const errors = [];
    const context = {
      game: this.game,
      player,
      args
    };
    if (selection.type === "choice" || selection.type === "player" || selection.type === "element") {
      const choices = this.getChoices(selection, player, args);
      if (!this.choicesContain(choices, value)) {
        errors.push(`Invalid selection for ${selection.name}`);
      }
    }
    switch (selection.type) {
      case "text": {
        const textSel = selection;
        const str = value;
        if (typeof str !== "string") {
          errors.push(`${selection.name} must be a string`);
        } else {
          if (textSel.minLength !== void 0 && str.length < textSel.minLength) {
            errors.push(`${selection.name} must be at least ${textSel.minLength} characters`);
          }
          if (textSel.maxLength !== void 0 && str.length > textSel.maxLength) {
            errors.push(`${selection.name} must be at most ${textSel.maxLength} characters`);
          }
          if (textSel.pattern && !textSel.pattern.test(str)) {
            errors.push(`${selection.name} does not match required pattern`);
          }
        }
        break;
      }
      case "number": {
        const numSel = selection;
        const num = value;
        if (typeof num !== "number" || isNaN(num)) {
          errors.push(`${selection.name} must be a number`);
        } else {
          if (numSel.min !== void 0 && num < numSel.min) {
            errors.push(`${selection.name} must be at least ${numSel.min}`);
          }
          if (numSel.max !== void 0 && num > numSel.max) {
            errors.push(`${selection.name} must be at most ${numSel.max}`);
          }
          if (numSel.integer && !Number.isInteger(num)) {
            errors.push(`${selection.name} must be an integer`);
          }
        }
        break;
      }
    }
    if (selection.validate && errors.length === 0) {
      const result = selection.validate(value, args, context);
      if (result !== true) {
        errors.push(typeof result === "string" ? result : `Invalid ${selection.name}`);
      }
    }
    return {
      valid: errors.length === 0,
      errors
    };
  }
  /**
   * Validate all arguments for an action
   */
  validateAction(action, player, args) {
    const allErrors = [];
    const context = {
      game: this.game,
      player,
      args
    };
    if (action.condition && !action.condition(context)) {
      return {
        valid: false,
        errors: ["Action is not available"]
      };
    }
    for (const selection of action.selections) {
      const value = args[selection.name];
      if (value === void 0) {
        if (!selection.optional) {
          allErrors.push(`Missing required selection: ${selection.name}`);
        }
        continue;
      }
      const result = this.validateSelection(selection, value, player, args);
      allErrors.push(...result.errors);
    }
    return {
      valid: allErrors.length === 0,
      errors: allErrors
    };
  }
  /**
   * Execute an action with the given arguments
   */
  executeAction(action, player, args) {
    const resolvedArgs = this.resolveArgs(action, args);
    const validation = this.validateAction(action, player, resolvedArgs);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join("; ")
      };
    }
    const context = {
      game: this.game,
      player,
      args: resolvedArgs
    };
    try {
      const result = action.execute(resolvedArgs, context);
      return result ?? { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  /**
   * Check if an action is available for a player.
   * For actions with dependent selections (filterBy), this checks if at least
   * one valid path through all selections exists.
   */
  isActionAvailable(action, player) {
    const context = {
      game: this.game,
      player,
      args: {}
    };
    if (action.condition && !action.condition(context)) {
      return false;
    }
    return this.hasValidSelectionPath(action.selections, player, {}, 0);
  }
  /**
   * Extract the value used for matching from a choice (for filterBy)
   */
  getChoiceFilterValue(choice, key) {
    if (typeof choice === "object" && choice !== null) {
      return choice[key];
    }
    return choice;
  }
  /**
   * Check if any selection after the given index depends on a selection by name
   */
  hasDependentSelection(selections, afterIndex, selectionName) {
    for (let i = afterIndex; i < selections.length; i++) {
      const sel = selections[i];
      if (sel.type === "choice") {
        const choiceSel = sel;
        if (choiceSel.filterBy?.selectionName === selectionName) {
          return true;
        }
      }
    }
    return false;
  }
  /**
   * Recursively check if there's a valid path through all selections.
   * For dependent selections, we need to verify at least one choice
   * leads to valid subsequent selections.
   *
   * OPTIMIZATION: We only do full path validation for choice selections
   * with static choices and filterBy. For element/player selections,
   * or choice selections with dynamic choices functions, the cost of
   * repeatedly computing choices is too high.
   */
  hasValidSelectionPath(selections, player, args, index) {
    if (index >= selections.length) {
      return true;
    }
    const selection = selections[index];
    if (selection.optional) {
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }
    if (selection.type === "text" || selection.type === "number") {
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }
    if (selection.type === "element" || selection.type === "player") {
      const choices2 = this.getChoices(selection, player, args);
      if (choices2.length === 0) {
        return false;
      }
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }
    if (selection.type === "choice") {
      const choiceSel = selection;
      if (typeof choiceSel.choices === "function") {
        const choices2 = this.getChoices(selection, player, args);
        if (choices2.length === 0) {
          return false;
        }
        return this.hasValidSelectionPath(selections, player, args, index + 1);
      }
    }
    const choices = this.getChoices(selection, player, args);
    if (choices.length === 0) {
      return false;
    }
    const hasDependent = this.hasDependentSelection(selections, index + 1, selection.name);
    if (!hasDependent) {
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }
    for (const choice of choices) {
      const newArgs = { ...args, [selection.name]: choice };
      if (this.hasValidSelectionPath(selections, player, newArgs, index + 1)) {
        return true;
      }
    }
    return false;
  }
};

// ../../engine/dist/flow/engine.js
var DEFAULT_MAX_ITERATIONS = 1e4;
function createContext(game, player, variables = {}) {
  return {
    game,
    player,
    variables,
    set: (name, value) => {
      variables[name] = value;
    },
    get: (name) => {
      return variables[name];
    }
  };
}
var FlowEngine = class {
  game;
  definition;
  stack = [];
  variables = {};
  currentPlayer;
  awaitingInput = false;
  availableActions = [];
  prompt;
  complete = false;
  lastActionResult;
  /** For simultaneous action steps - tracks which players can act */
  awaitingPlayers = [];
  /** Current named phase (for UI display) */
  currentPhase;
  /** Move count for current action step with move limits */
  moveCount = 0;
  /** Current action step config (for move limit tracking) */
  currentActionConfig;
  constructor(game, definition) {
    this.game = game;
    this.definition = definition;
  }
  /**
   * Start the flow from the beginning
   */
  start() {
    const context = this.createContext();
    if (this.definition.setup) {
      this.definition.setup(context);
    }
    this.stack = [{ node: this.definition.root, index: 0, completed: false }];
    this.variables = { ...context.variables };
    this.currentPlayer = this.game.players.current;
    this.awaitingInput = false;
    this.complete = false;
    return this.run();
  }
  /**
   * Resume flow after player action
   * @param actionName The action to perform
   * @param args The action arguments
   * @param playerIndex Optional player index for simultaneous actions (if not provided, uses current player)
   */
  resume(actionName, args, playerIndex) {
    if (!this.awaitingInput) {
      throw new Error("Flow is not awaiting input");
    }
    const currentFrame = this.stack[this.stack.length - 1];
    if (currentFrame?.node.type === "simultaneous-action-step") {
      return this.resumeSimultaneousAction(actionName, args, playerIndex, currentFrame);
    }
    const result = this.game.performAction(actionName, this.currentPlayer, args);
    this.lastActionResult = result;
    if (!result.success) {
      return this.getState();
    }
    this.awaitingInput = false;
    if (currentFrame?.node.type === "action-step") {
      const config = currentFrame.node.config;
      const currentMoveCount = currentFrame.data?.moveCount ?? 0;
      const newMoveCount = currentMoveCount + 1;
      currentFrame.data = { ...currentFrame.data, moveCount: newMoveCount };
      if (config.maxMoves && newMoveCount >= config.maxMoves) {
        currentFrame.completed = true;
        this.currentActionConfig = void 0;
        this.moveCount = 0;
      } else if (config.repeatUntil) {
        const minMovesMet = !config.minMoves || newMoveCount >= config.minMoves;
        if (config.repeatUntil(this.createContext()) && minMovesMet) {
          currentFrame.completed = true;
          this.currentActionConfig = void 0;
          this.moveCount = 0;
        }
      } else if (!config.minMoves && !config.maxMoves) {
        currentFrame.completed = true;
        this.currentActionConfig = void 0;
        this.moveCount = 0;
      }
    }
    return this.run();
  }
  /**
   * Resume a simultaneous action step after a player's action
   */
  resumeSimultaneousAction(actionName, args, playerIndex, frame) {
    const config = frame.node.config;
    let actingPlayerIndex = playerIndex;
    if (actingPlayerIndex === void 0) {
      const firstAwaiting = this.awaitingPlayers.find((p) => !p.completed && p.availableActions.length > 0);
      if (firstAwaiting) {
        actingPlayerIndex = firstAwaiting.playerIndex;
      }
    }
    if (actingPlayerIndex === void 0) {
      throw new Error("No player specified and no awaiting players found");
    }
    const playerState = this.awaitingPlayers.find((p) => p.playerIndex === actingPlayerIndex);
    if (!playerState) {
      throw new Error(`Player ${actingPlayerIndex} is not awaiting action`);
    }
    if (playerState.completed) {
      throw new Error(`Player ${actingPlayerIndex} has already completed their action`);
    }
    if (!playerState.availableActions.includes(actionName)) {
      throw new Error(`Action ${actionName} is not available for player ${actingPlayerIndex}`);
    }
    const player = this.game.players[actingPlayerIndex];
    const result = this.game.performAction(actionName, player, args);
    this.lastActionResult = result;
    if (!result.success) {
      return this.getState();
    }
    const context = this.createContext();
    if (config.playerDone) {
      playerState.completed = config.playerDone(context, player);
    }
    if (!playerState.completed) {
      const actions = typeof config.actions === "function" ? config.actions(context, player) : config.actions;
      playerState.availableActions = actions.filter((actionName2) => {
        const action = this.game.getAction(actionName2);
        if (!action)
          return false;
        return this.game.getAvailableActions(player).some((a) => a.name === actionName2);
      });
      if (playerState.availableActions.length === 0) {
        playerState.completed = true;
      }
    }
    const allDone = config.allDone ? config.allDone(context) : this.awaitingPlayers.every((p) => p.completed);
    if (allDone) {
      this.awaitingInput = false;
      this.awaitingPlayers = [];
      frame.completed = true;
      return this.run();
    }
    return this.getState();
  }
  /**
   * Get the current flow state
   */
  getState() {
    const state = {
      position: this.getPosition(),
      complete: this.complete,
      awaitingInput: this.awaitingInput,
      currentPlayer: this.currentPlayer?.position,
      availableActions: this.awaitingInput ? this.availableActions : void 0,
      prompt: this.prompt,
      awaitingPlayers: this.awaitingPlayers.length > 0 ? this.awaitingPlayers : void 0,
      currentPhase: this.currentPhase
    };
    if (this.currentActionConfig && (this.currentActionConfig.minMoves || this.currentActionConfig.maxMoves)) {
      state.moveCount = this.moveCount;
      if (this.currentActionConfig.maxMoves) {
        state.movesRemaining = this.currentActionConfig.maxMoves - this.moveCount;
      }
      if (this.currentActionConfig.minMoves) {
        state.movesRequired = Math.max(0, this.currentActionConfig.minMoves - this.moveCount);
      }
    }
    return state;
  }
  /**
   * Restore flow from a serialized position
   */
  restore(position) {
    this.variables = { ...position.variables };
    this.stack = [];
    let currentNode = this.definition.root;
    for (let i = 0; i < position.path.length; i++) {
      const index = position.path[i];
      const iterationKey = `__iter_${i}`;
      const iteration = position.iterations[iterationKey] ?? 0;
      this.stack.push({
        node: currentNode,
        index,
        completed: false,
        data: { iteration }
      });
      currentNode = this.getChildNode(currentNode, index);
    }
    if (position.playerIndex !== void 0) {
      this.currentPlayer = this.game.players[position.playerIndex];
    }
  }
  /**
   * Check if the game is complete
   */
  isComplete() {
    return this.complete;
  }
  /**
   * Get the winners (if game is complete)
   */
  getWinners() {
    if (!this.complete)
      return [];
    if (this.definition.getWinners) {
      return this.definition.getWinners(this.createContext());
    }
    return [];
  }
  // ============================================
  // Private Methods
  // ============================================
  createContext() {
    const context = createContext(this.game, this.currentPlayer, this.variables);
    context.lastActionResult = this.lastActionResult;
    return context;
  }
  getPosition() {
    const path = [];
    const iterations = {};
    for (let i = 0; i < this.stack.length; i++) {
      const frame = this.stack[i];
      path.push(frame.index);
      if (frame.data?.iteration !== void 0) {
        iterations[`__iter_${i}`] = frame.data.iteration;
      }
    }
    return {
      path,
      iterations,
      playerIndex: this.currentPlayer?.position,
      variables: { ...this.variables }
    };
  }
  getChildNode(node, index) {
    switch (node.type) {
      case "sequence":
        return node.config.steps[index];
      case "loop":
      case "each-player":
      case "for-each":
      case "phase":
        return node.config.do;
      case "if":
        return index === 0 ? node.config.then : node.config.else ?? node.config.then;
      case "switch": {
        const cases = Object.values(node.config.cases);
        return cases[index] ?? node.config.default ?? cases[0];
      }
      default:
        return node;
    }
  }
  /**
   * Main execution loop - runs until awaiting input or complete
   */
  run() {
    let iterations = 0;
    while (this.stack.length > 0 && !this.awaitingInput && !this.complete) {
      iterations++;
      if (iterations > DEFAULT_MAX_ITERATIONS) {
        throw new Error("Flow exceeded maximum iterations - possible infinite loop");
      }
      const frame = this.stack[this.stack.length - 1];
      if (frame.completed) {
        this.stack.pop();
        continue;
      }
      const result = this.executeNode(frame);
      if (result.awaitingInput) {
        this.awaitingInput = true;
        break;
      }
      if (frame.completed) {
        this.stack.pop();
      }
      if (this.definition.isComplete?.(this.createContext())) {
        this.complete = true;
        break;
      }
    }
    if (this.stack.length === 0 || this.definition.isComplete?.(this.createContext())) {
      this.complete = true;
    }
    return this.getState();
  }
  /**
   * Execute a single flow node
   */
  executeNode(frame) {
    const context = this.createContext();
    switch (frame.node.type) {
      case "sequence":
        return this.executeSequence(frame, frame.node.config, context);
      case "loop":
        return this.executeLoop(frame, frame.node.config, context);
      case "each-player":
        return this.executeEachPlayer(frame, frame.node.config, context);
      case "for-each":
        return this.executeForEach(frame, frame.node.config, context);
      case "action-step":
        return this.executeActionStep(frame, frame.node.config, context);
      case "simultaneous-action-step":
        return this.executeSimultaneousActionStep(frame, frame.node.config, context);
      case "switch":
        return this.executeSwitch(frame, frame.node.config, context);
      case "if":
        return this.executeIf(frame, frame.node.config, context);
      case "execute":
        return this.executeExecute(frame, frame.node.config, context);
      case "phase":
        return this.executePhase(frame, frame.node.config, context);
      default:
        frame.completed = true;
        return { continue: true, awaitingInput: false };
    }
  }
  executeSequence(frame, config, context) {
    if (frame.index >= config.steps.length) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    const nextStep = config.steps[frame.index];
    this.stack.push({ node: nextStep, index: 0, completed: false });
    frame.index++;
    return { continue: true, awaitingInput: false };
  }
  executeLoop(frame, config, context) {
    const iteration = frame.data?.iteration ?? 0;
    const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    if (iteration >= maxIterations) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    if (config.while && !config.while(context)) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, iteration: iteration + 1 };
    frame.index++;
    return { continue: true, awaitingInput: false };
  }
  executeEachPlayer(frame, config, context) {
    let players = [...this.game.players];
    if (config.filter) {
      players = players.filter((p) => config.filter(p, context));
    }
    if (config.direction === "backward") {
      players.reverse();
    }
    if (frame.data?.playerIndex === void 0) {
      let startIndex = 0;
      if (config.startingPlayer) {
        const startPlayer = config.startingPlayer(context);
        startIndex = players.findIndex((p) => p === startPlayer);
        if (startIndex === -1)
          startIndex = 0;
      }
      frame.data = { ...frame.data, playerIndex: startIndex, players };
    }
    const playerIndex = frame.data.playerIndex;
    const playerList = frame.data.players ?? players;
    if (playerIndex >= playerList.length) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    this.currentPlayer = playerList[playerIndex];
    this.variables[config.name ?? "currentPlayer"] = this.currentPlayer;
    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, playerIndex: playerIndex + 1 };
    frame.index++;
    return { continue: true, awaitingInput: false };
  }
  executeForEach(frame, config, context) {
    const items = typeof config.collection === "function" ? config.collection(context) : config.collection;
    const itemIndex = frame.data?.itemIndex ?? 0;
    if (itemIndex >= items.length) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    this.variables[config.as] = items[itemIndex];
    this.stack.push({ node: config.do, index: 0, completed: false });
    frame.data = { ...frame.data, itemIndex: itemIndex + 1 };
    frame.index++;
    return { continue: true, awaitingInput: false };
  }
  executeActionStep(frame, config, context) {
    if (config.skipIf?.(context)) {
      this.currentActionConfig = void 0;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    if (frame.data?.moveCount === void 0) {
      frame.data = { ...frame.data, moveCount: 0 };
    }
    const moveCount = frame.data.moveCount;
    if (config.maxMoves && moveCount >= config.maxMoves) {
      this.currentActionConfig = void 0;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    const minMovesMet = !config.minMoves || moveCount >= config.minMoves;
    if (this.lastActionResult && config.repeatUntil?.(context) && minMovesMet) {
      this.currentActionConfig = void 0;
      this.moveCount = 0;
      frame.completed = true;
      this.lastActionResult = void 0;
      return { continue: true, awaitingInput: false };
    }
    const player = config.player ? config.player(context) : context.player;
    if (!player) {
      throw new Error("ActionStep requires a player");
    }
    const actions = typeof config.actions === "function" ? config.actions(context) : config.actions;
    const available = actions.filter((actionName) => {
      const action = this.game.getAction(actionName);
      if (!action)
        return false;
      return this.game.getAvailableActions(player).some((a) => a.name === actionName);
    });
    if (available.length === 0 && minMovesMet) {
      this.currentActionConfig = void 0;
      this.moveCount = 0;
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    if (available.length === 0 && !minMovesMet) {
      throw new Error(`ActionStep requires ${config.minMoves} moves but only ${moveCount} were possible`);
    }
    this.currentActionConfig = config;
    this.moveCount = moveCount;
    this.currentPlayer = player;
    this.availableActions = available;
    this.prompt = typeof config.prompt === "function" ? config.prompt(context) : config.prompt;
    return {
      continue: false,
      awaitingInput: true,
      availableActions: available,
      currentPlayer: player
    };
  }
  executeSimultaneousActionStep(frame, config, context) {
    const players = config.players ? config.players(context) : [...this.game.players];
    this.awaitingPlayers = [];
    for (const player of players) {
      if (config.skipPlayer?.(context, player)) {
        continue;
      }
      if (config.playerDone?.(context, player)) {
        continue;
      }
      const actions = typeof config.actions === "function" ? config.actions(context, player) : config.actions;
      const available = actions.filter((actionName) => {
        const action = this.game.getAction(actionName);
        if (!action)
          return false;
        return this.game.getAvailableActions(player).some((a) => a.name === actionName);
      });
      if (available.length > 0) {
        this.awaitingPlayers.push({
          playerIndex: player.position,
          availableActions: available,
          completed: false
        });
      }
    }
    if (this.awaitingPlayers.length === 0) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    if (config.allDone?.(context)) {
      this.awaitingPlayers = [];
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    this.prompt = typeof config.prompt === "function" ? config.prompt(context) : config.prompt;
    return {
      continue: false,
      awaitingInput: true
    };
  }
  executeSwitch(frame, config, context) {
    if (frame.data?.branchPushed) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    const value = config.on(context);
    const stringValue = String(value);
    const branch = config.cases[stringValue] ?? config.default;
    if (!branch) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    this.stack.push({ node: branch, index: 0, completed: false });
    frame.data = { branchPushed: true };
    return { continue: true, awaitingInput: false };
  }
  executeIf(frame, config, context) {
    if (frame.data?.branchPushed) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    const condition = config.condition(context);
    if (condition) {
      this.stack.push({ node: config.then, index: 0, completed: false });
      frame.data = { branchPushed: true };
    } else if (config.else) {
      this.stack.push({ node: config.else, index: 0, completed: false });
      frame.data = { branchPushed: true };
    } else {
      frame.completed = true;
    }
    return { continue: true, awaitingInput: false };
  }
  executeExecute(frame, config, context) {
    config.fn(context);
    this.variables = { ...context.variables };
    frame.completed = true;
    return { continue: true, awaitingInput: false };
  }
  executePhase(frame, config, context) {
    if (!frame.data?.entered) {
      const previousPhase = this.currentPhase;
      this.currentPhase = config.name;
      if (this.definition.onEnterPhase) {
        this.definition.onEnterPhase(config.name, context);
      }
      this.stack.push({ node: config.do, index: 0, completed: false });
      frame.data = { entered: true, previousPhase };
      return { continue: true, awaitingInput: false };
    }
    if (this.definition.onExitPhase) {
      this.definition.onExitPhase(config.name, context);
    }
    this.currentPhase = frame.data.previousPhase;
    frame.completed = true;
    return { continue: true, awaitingInput: false };
  }
};

// ../../engine/dist/element/game.js
function createSeededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h |= 0;
    h = h + 1831565813 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var Game = class extends Space {
  /**
   * Optional function to transform state for each player's view.
   * Override in subclass for custom attribute-level filtering.
   */
  static playerView;
  /** Container for removed elements */
  pile;
  /** All players in the game */
  players = new PlayerCollection();
  /** Current game phase */
  phase = "setup";
  /** Seeded random number generator */
  random;
  /** Message log */
  messages = [];
  /** Game settings */
  settings = {};
  /** Command history for event sourcing */
  commandHistory = [];
  /** Registered actions */
  _actions = /* @__PURE__ */ new Map();
  /** Action executor for validation and execution */
  _actionExecutor;
  /** Flow definition for this game */
  _flowDefinition;
  /** Flow engine instance */
  _flowEngine;
  static unserializableAttributes = [
    ...Space.unserializableAttributes,
    "pile",
    "players",
    "random",
    "commandHistory",
    "_actions",
    "_actionExecutor",
    "_flowDefinition",
    "_flowEngine"
  ];
  constructor(options) {
    const seed = options.seed ?? Math.random().toString(36).substring(2);
    const random = createSeededRandom(seed);
    const ctx = {
      sequence: 0,
      classRegistry: /* @__PURE__ */ new Map(),
      random
    };
    super(ctx);
    this.random = random;
    this.game = this;
    this._ctx.game = this;
    this._ctx.classRegistry.set("Space", Space);
    this._ctx.classRegistry.set("GameElement", GameElement);
    this.pile = this.createElement(Space, "__pile__");
    this.pile._t.parent = void 0;
    for (let i = 0; i < options.playerCount; i++) {
      const name = options.playerNames?.[i] ?? `Player ${i + 1}`;
      const player = this.createPlayer(i, name);
      player.game = this;
      this.players.push(player);
    }
    if (this.players.length > 0) {
      this.players.setCurrent(0);
    }
    this._actionExecutor = new ActionExecutor(this);
  }
  /**
   * Factory method to create players - override to use custom Player class
   */
  createPlayer(position, name) {
    return new Player(position, name);
  }
  /**
   * Register element classes for serialization/deserialization.
   * Call this in your game constructor before creating elements.
   *
   * @example
   * ```typescript
   * constructor(options: MyGameOptions) {
   *   super(options);
   *   this.registerElements([Card, Hand, Deck, DiscardPile]);
   *   // ... create elements
   * }
   * ```
   */
  registerElements(classes) {
    for (const cls of classes) {
      const className = cls.name;
      if (!this._ctx.classRegistry.has(className)) {
        this._ctx.classRegistry.set(className, cls);
      }
    }
  }
  /**
   * Create an element without adding it to the tree (internal use)
   */
  createElement(elementClass, name) {
    const element = new elementClass(this._ctx);
    element.name = name;
    element.game = this;
    const className = elementClass.name;
    if (!this._ctx.classRegistry.has(className)) {
      this._ctx.classRegistry.set(className, elementClass);
    }
    return element;
  }
  // ============================================
  // Element Lookup
  // ============================================
  /**
   * Find an element by its ID anywhere in the game tree
   */
  getElementById(id) {
    const found = this.atId(id);
    if (found)
      return found;
    return this.pile.atId(id);
  }
  /**
   * Get an element class by name (for command execution)
   */
  getElementClass(className) {
    return this._ctx.classRegistry.get(className);
  }
  // ============================================
  // Command Execution
  // ============================================
  /**
   * Execute a command and record it in history
   */
  execute(command) {
    const result = executeCommand(this, command);
    if (result.success) {
      this.commandHistory.push(command);
    }
    return result;
  }
  /**
   * Replay commands to rebuild state
   */
  replayCommands(commands) {
    for (const command of commands) {
      const result = executeCommand(this, command);
      if (!result.success) {
        throw new Error(`Failed to replay command: ${result.error}`);
      }
      this.commandHistory.push(command);
    }
  }
  // ============================================
  // Action System
  // ============================================
  /**
   * Register an action definition
   */
  registerAction(action) {
    this._actions.set(action.name, action);
  }
  /**
   * Register multiple actions
   */
  registerActions(...actions) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }
  /**
   * Get an action definition by name
   */
  getAction(name) {
    return this._actions.get(name);
  }
  /**
   * Get all registered action names
   */
  getActionNames() {
    return [...this._actions.keys()];
  }
  /**
   * Get available actions for a player
   */
  getAvailableActions(player) {
    const available = [];
    for (const action of this._actions.values()) {
      if (this._actionExecutor.isActionAvailable(action, player)) {
        available.push(action);
      }
    }
    return available;
  }
  /**
   * Get the action executor (for advanced usage like building action metadata)
   */
  getActionExecutor() {
    return this._actionExecutor;
  }
  /**
   * Get the choices for a selection (for UI)
   */
  getSelectionChoices(actionName, selectionName, player, args = {}) {
    const action = this._actions.get(actionName);
    if (!action)
      return [];
    const selection = action.selections.find((s) => s.name === selectionName);
    if (!selection)
      return [];
    return this._actionExecutor.getChoices(selection, player, args);
  }
  /**
   * Perform an action with the given arguments
   */
  performAction(actionName, player, args) {
    const action = this._actions.get(actionName);
    if (!action) {
      return { success: false, error: `Unknown action: ${actionName}` };
    }
    return this._actionExecutor.executeAction(action, player, args);
  }
  /**
   * Perform an action from serialized form (for network play)
   */
  performSerializedAction(serialized) {
    const player = this.players[serialized.player];
    if (!player) {
      return { success: false, error: `Invalid player: ${serialized.player}` };
    }
    return this.performAction(serialized.name, player, serialized.args);
  }
  // ============================================
  // Flow System
  // ============================================
  /**
   * Set the flow definition for this game
   */
  setFlow(definition) {
    this._flowDefinition = definition;
  }
  /**
   * Get the flow definition
   */
  getFlow() {
    return this._flowDefinition;
  }
  /**
   * Start the game flow
   */
  startFlow() {
    if (!this._flowDefinition) {
      throw new Error("No flow definition set");
    }
    this._flowEngine = new FlowEngine(this, this._flowDefinition);
    const state = this._flowEngine.start();
    if (this.phase === "setup") {
      this.phase = "started";
    }
    if (state.complete) {
      this.phase = "finished";
    }
    return state;
  }
  /**
   * Resume flow after player action
   * @param actionName Action name to perform
   * @param args Action arguments
   * @param playerIndex Optional player index for simultaneous actions
   */
  continueFlow(actionName, args, playerIndex) {
    if (!this._flowEngine) {
      throw new Error("Flow not started");
    }
    const state = this._flowEngine.resume(actionName, args, playerIndex);
    if (state.complete) {
      this.phase = "finished";
      const winners = this._flowEngine.getWinners();
      if (winners.length > 0) {
        this.settings.winners = winners.map((p) => p.position);
      }
    }
    return state;
  }
  /**
   * Get current flow state
   */
  getFlowState() {
    return this._flowEngine?.getState();
  }
  /**
   * Restore flow from serialized position
   */
  restoreFlow(position) {
    if (!this._flowDefinition) {
      throw new Error("No flow definition set");
    }
    this._flowEngine = new FlowEngine(this, this._flowDefinition);
    this._flowEngine.restore(position);
  }
  /**
   * Check if flow is awaiting player input
   */
  isAwaitingInput() {
    return this._flowEngine?.getState().awaitingInput ?? false;
  }
  /**
   * Get current player from flow (if awaiting input)
   */
  getCurrentFlowPlayer() {
    const state = this._flowEngine?.getState();
    if (state?.currentPlayer !== void 0) {
      return this.players[state.currentPlayer];
    }
    return void 0;
  }
  /**
   * Get available actions from flow (if awaiting input)
   */
  getFlowAvailableActions() {
    return this._flowEngine?.getState().availableActions ?? [];
  }
  /**
   * Get awaiting players for simultaneous actions
   * Returns undefined if not in a simultaneous action step
   */
  getAwaitingPlayers() {
    const state = this._flowEngine?.getState();
    return state?.awaitingPlayers;
  }
  /**
   * Check if a player can act (either as current player or in simultaneous action)
   */
  canPlayerAct(playerIndex) {
    const state = this._flowEngine?.getState();
    if (!state?.awaitingInput)
      return false;
    if (state.awaitingPlayers && state.awaitingPlayers.length > 0) {
      const playerState = state.awaitingPlayers.find((p) => p.playerIndex === playerIndex);
      return playerState ? !playerState.completed && playerState.availableActions.length > 0 : false;
    }
    return state.currentPlayer === playerIndex;
  }
  // ============================================
  // Game Lifecycle
  // ============================================
  /**
   * Start the game (called after setup)
   */
  start() {
    if (this.phase !== "setup") {
      throw new Error("Game has already started");
    }
    this.phase = "started";
  }
  /**
   * End the game
   */
  finish(winners) {
    this.phase = "finished";
    if (winners) {
      this.settings.winners = winners.map((p) => p.position);
    }
  }
  /**
   * Check if the game is finished
   */
  isFinished() {
    return this.phase === "finished";
  }
  /**
   * Get the winners (if game is finished)
   */
  getWinners() {
    const positions = this.settings.winners;
    if (!positions)
      return [];
    return positions.map((pos) => this.players[pos]);
  }
  // ============================================
  // Player Context
  // ============================================
  /**
   * Set the current player context for "mine" queries
   */
  setPlayerContext(player) {
    if (player === void 0) {
      this._ctx.player = void 0;
    } else if (typeof player === "number") {
      this._ctx.player = this.players[player];
    } else {
      this._ctx.player = player;
    }
  }
  /**
   * Get the current player context
   */
  getPlayerContext() {
    return this._ctx.player;
  }
  // ============================================
  // Messaging
  // ============================================
  /**
   * Add a message to the game log
   */
  message(text, data) {
    this.addMessageInternal(text, data);
  }
  /**
   * Internal method to add a message (called by command executor)
   */
  addMessageInternal(text, data) {
    this.messages.push({ text, data });
  }
  /**
   * Get formatted messages (with template substitution)
   */
  getFormattedMessages() {
    return this.messages.map(({ text, data }) => {
      if (!data)
        return text;
      let processed = text;
      for (const [key, value] of Object.entries(data)) {
        const replacement = value instanceof GameElement ? value.toString() : value instanceof Player ? value.name : String(value);
        processed = processed.replace(new RegExp(`{{${key}}}`, "g"), replacement);
      }
      return processed;
    });
  }
  // ============================================
  // Serialization
  // ============================================
  /**
   * Serialize the complete game state
   */
  toJSON() {
    return {
      ...super.toJSON(),
      players: this.players.toJSON(),
      phase: this.phase,
      messages: this.messages,
      settings: this.settings
    };
  }
  /**
   * Get the game state from the perspective of a specific player
   * (hides elements that player shouldn't see based on zone visibility)
   * @param player - Player, player position, or null for spectator view
   */
  toJSONForPlayer(player) {
    const position = player === null ? null : typeof player === "number" ? player : player.position;
    const visibilityPosition = position ?? -1;
    const filterElement = (json, element) => {
      const visibility = element.getEffectiveVisibility();
      if (visibility.mode === "count-only" && !element.isVisibleTo(visibilityPosition)) {
        const systemAttrs = {};
        for (const [key, value] of Object.entries(json.attributes ?? {})) {
          if (key.startsWith("$")) {
            systemAttrs[key] = value;
          }
        }
        return {
          className: json.className,
          id: json.id,
          name: json.name,
          attributes: systemAttrs,
          childCount: element._t.children.length
        };
      }
      if (!element.isVisibleTo(visibilityPosition)) {
        return {
          className: json.className,
          id: json.id,
          attributes: { __hidden: true }
        };
      }
      const zoneVisibility = element.getZoneVisibility?.();
      if (zoneVisibility) {
        if (zoneVisibility.mode === "hidden") {
          const hiddenChildren = [];
          if (json.children) {
            for (const childJson of json.children) {
              const systemAttrs = { __hidden: true };
              for (const [key, value] of Object.entries(childJson.attributes ?? {})) {
                if (key.startsWith("$")) {
                  systemAttrs[key] = value;
                }
              }
              hiddenChildren.push({
                className: childJson.className,
                id: childJson.id,
                attributes: systemAttrs
              });
            }
          }
          return {
            ...json,
            children: hiddenChildren.length > 0 ? hiddenChildren : void 0,
            childCount: element._t.children.length
          };
        } else if (zoneVisibility.mode === "count-only") {
          return {
            ...json,
            children: void 0,
            childCount: element._t.children.length
          };
        } else if (zoneVisibility.mode === "owner" && element.player?.position !== visibilityPosition) {
          const hiddenChildren = [];
          if (json.children) {
            for (const childJson of json.children) {
              const systemAttrs = { __hidden: true };
              for (const [key, value] of Object.entries(childJson.attributes ?? {})) {
                if (key.startsWith("$")) {
                  systemAttrs[key] = value;
                }
              }
              hiddenChildren.push({
                className: childJson.className,
                id: childJson.id,
                attributes: systemAttrs
              });
            }
          }
          return {
            ...json,
            children: hiddenChildren.length > 0 ? hiddenChildren : void 0
          };
        }
      }
      const filteredChildren = [];
      if (json.children) {
        for (let i = 0; i < json.children.length; i++) {
          const childJson = json.children[i];
          const childElement = element._t.children[i];
          const filtered = filterElement(childJson, childElement);
          if (filtered) {
            filteredChildren.push(filtered);
          }
        }
      }
      return {
        ...json,
        children: filteredChildren.length > 0 ? filteredChildren : void 0
      };
    };
    const fullJson = this.toJSON();
    let filteredState = filterElement(fullJson, this) ?? fullJson;
    const GameClass = this.constructor;
    if (GameClass.playerView) {
      filteredState = GameClass.playerView(filteredState, position, this);
    }
    return filteredState;
  }
  /**
   * Create a game from serialized JSON
   */
  static restoreGame(json, GameClass, classRegistry) {
    const game = new GameClass({
      playerCount: json.players.length,
      playerNames: json.players.map((p) => p.name)
    });
    for (const [name, cls] of classRegistry) {
      game._ctx.classRegistry.set(name, cls);
    }
    game.phase = json.phase;
    game.messages = json.messages;
    game.settings = json.settings;
    game._t.children = [];
    if (json.children) {
      for (const childJson of json.children) {
        const child = GameElement.fromJSON(childJson, game._ctx, game._ctx.classRegistry);
        child._t.parent = game;
        child.game = game;
        game._t.children.push(child);
      }
    }
    return game;
  }
};

// ../../engine/dist/flow/builders.js
function sequence(...steps) {
  return {
    type: "sequence",
    config: { steps }
  };
}
function loop(config) {
  return {
    type: "loop",
    config: {
      name: config.name,
      while: config.while,
      maxIterations: config.maxIterations,
      do: config.do
    }
  };
}
function eachPlayer(config) {
  return {
    type: "each-player",
    config: {
      name: config.name,
      filter: config.filter,
      direction: config.direction,
      startingPlayer: config.startingPlayer,
      do: config.do
    }
  };
}
function actionStep(config) {
  return {
    type: "action-step",
    config: {
      name: config.name,
      player: config.player,
      actions: config.actions,
      prompt: config.prompt,
      repeatUntil: config.repeatUntil,
      skipIf: config.skipIf,
      timeout: config.timeout,
      minMoves: config.minMoves,
      maxMoves: config.maxMoves
    }
  };
}
function execute(fn) {
  return {
    type: "execute",
    config: { fn }
  };
}

// rules/src/elements.ts
var IngredientDie = class extends Die {
  /** Whether this die has been drafted this round */
  drafted = false;
  /** Whether this is a D10/D% that can be 0 or 10 */
  get canBeZeroOrTen() {
    return this.sides === 10 && this.value === 10;
  }
};
var IngredientShelf = class extends DicePool {
};
var DraftArea = class extends Space {
};
var INGREDIENT_TRACK_CONFIG = {
  d4: { boxes: 5, abilities: [{ position: 3, type: "subtract" }], starAtEnd: true },
  d6: { boxes: 5, abilities: [{ position: 2, type: "flip" }, { position: 4, type: "flip" }], starAtEnd: true },
  d8: { boxes: 5, abilities: [{ position: 0, type: "reroll-2" }, { position: 1, type: "reroll-2" }, { position: 2, type: "reroll-2" }, { position: 3, type: "reroll-2" }], starAtEnd: true },
  d10: { boxes: 6, abilities: [{ position: 2, type: "draft-again" }, { position: 4, type: "draft-again" }], starAtEnd: true },
  d12: { boxes: 6, abilities: [{ position: 3, type: "refresh" }], starAtEnd: true },
  d20: { boxes: 5, abilities: [{ position: 0, type: "adjust" }, { position: 1, type: "adjust" }, { position: 2, type: "adjust" }], starAtEnd: true }
};
var DISTILLATION_POINTS = [
  [0, -10, -5, -2],
  // Column 1 (5 rows with completion bonuses 15, 25)
  [0, -5, -2, 10],
  // Column 2 (4 rows with completion bonus 15)
  [0, -2, 5, 10],
  // Column 3 (4 rows with completion bonus 15)
  [0, 2, 5, 10]
  // Column 4 (4 rows - connects to poison track)
];
var DISTILLATION_COMPLETION_BONUS = [25, 15, 15, 10];
var DISTILLATION_ROWS = [5, 4, 4, 4];
var FULMINATE_POINTS = [0, 1, 3, 6, 11, 16, 23, 30, 40, 50];
var FULMINATE_COMPLETION_BONUS = 65;
var POTION_ROWS = [
  { potions: [1, 2, 3], stars: 1 },
  { potions: [4, 5, 6, 7], stars: 1 },
  { potions: [8, 9, 10, 11], stars: 1 },
  { potions: [12, 13, 14, 15], stars: 1 },
  { potions: [16, 17, 18, 19], stars: 1 },
  { potions: [20, 21, 22, 23], stars: 1 },
  { potions: [24, 25, 26], stars: 1 },
  { potions: [27, 28], stars: 1 },
  { potions: [29, 30], stars: 2 },
  { potions: [31, 32], stars: 2 }
];
var POISON_SKULLS_FOR_STAR = 6;
var PolyPotionsPlayer = class extends Player {
  /**
   * Ingredient tracks - one for each die type
   * Tracks how many times each ingredient has been drafted
   */
  ingredientTracks = {};
  /**
   * Potions crafted (1-32, marked true when crafted)
   */
  potionsCrafted = new Array(32).fill(false);
  /**
   * Number of poison skulls (crafted when potion already made or out of range)
   */
  poisonSkulls = 0;
  /**
   * Whether the poison star has been earned
   */
  poisonStarEarned = false;
  /**
   * Distillation track - 4 columns, values must decrease
   * Each entry is { value, points }
   */
  distillations = [[], [], [], []];
  /**
   * Fulminate track - 1 column, values must increase
   */
  fulminates = [];
  /**
   * Abilities earned (from drafting specific dice)
   */
  abilities = [];
  /**
   * Stars earned (10 points each, from completing rows)
   */
  stars = 0;
  /**
   * Stars from ingredient tracks
   */
  ingredientStars = 0;
  /**
   * Stars from potion rows
   */
  potionStars = 0;
  /**
   * Whether this player crafted a poison this turn (allows duplicate values)
   */
  craftedPoisonThisTurn = false;
  constructor(position, name) {
    super(position, name);
    for (const [dieType, config] of Object.entries(INGREDIENT_TRACK_CONFIG)) {
      this.ingredientTracks[dieType] = [];
      for (let i = 0; i < config.boxes; i++) {
        const box = { marked: false };
        const abilityConfig = config.abilities.find((a) => a.position === i);
        if (abilityConfig) {
          box.ability = abilityConfig.type;
        }
        if (i === config.boxes - 1 && config.starAtEnd) {
          box.star = true;
        }
        this.ingredientTracks[dieType].push(box);
      }
    }
    this.abilities.push({ type: "reroll-2", used: false });
  }
  /**
   * Current score calculation based on PDF rules
   */
  get score() {
    let total = 0;
    for (let col = 0; col < 4; col++) {
      for (const entry of this.distillations[col]) {
        total += entry.points;
      }
      if (this.distillations[col].length >= DISTILLATION_ROWS[col]) {
        total += DISTILLATION_COMPLETION_BONUS[col];
      }
    }
    if (this.fulminates.length > 0) {
      const position = this.fulminates.length - 1;
      total += FULMINATE_POINTS[Math.min(position, FULMINATE_POINTS.length - 1)];
    }
    if (this.fulminates.length >= FULMINATE_POINTS.length) {
      total += FULMINATE_COMPLETION_BONUS;
    }
    total += this.poisonSkulls * 2;
    total += this.stars * 10;
    return total;
  }
  /**
   * Mark an ingredient as used and check for ability unlocks
   */
  useIngredient(dieType) {
    const key = dieType.toLowerCase();
    const track = this.ingredientTracks[key];
    if (!track) return null;
    const boxIndex = track.findIndex((b) => !b.marked);
    if (boxIndex === -1) return null;
    const box = track[boxIndex];
    box.marked = true;
    if (box.star) {
      this.ingredientStars++;
      this.stars++;
    }
    if (box.ability) {
      this.abilities.push({ type: box.ability, used: false });
      return box.ability;
    }
    return null;
  }
  /**
   * Get how many boxes are marked in an ingredient track
   */
  getIngredientCount(dieType) {
    const key = dieType.toLowerCase();
    const track = this.ingredientTracks[key];
    if (!track) return 0;
    return track.filter((b) => b.marked).length;
  }
  /**
   * Check if ingredient track is complete
   */
  isIngredientComplete(dieType) {
    const key = dieType.toLowerCase();
    const track = this.ingredientTracks[key];
    if (!track) return false;
    return track.every((b) => b.marked);
  }
  /**
   * Check if a potion value can be crafted
   */
  canCraftPotion(value) {
    if (value < 1 || value > 32) return false;
    return !this.potionsCrafted[value - 1];
  }
  /**
   * Mark a potion as crafted and check for row completion stars
   */
  craftPotion(value) {
    if (value < 1 || value > 32) return 0;
    this.potionsCrafted[value - 1] = true;
    let starsEarned = 0;
    for (const row of POTION_ROWS) {
      const isComplete = row.potions.every((p) => this.potionsCrafted[p - 1]);
      if (isComplete) {
        const rowStars = row.stars;
        const alreadyCounted = this.countPotionRowStarsFor(row);
        if (alreadyCounted < rowStars) {
          starsEarned = rowStars - alreadyCounted;
          this.potionStars += starsEarned;
          this.stars += starsEarned;
        }
      }
    }
    return starsEarned;
  }
  /**
   * Helper to count stars already awarded for a potion row
   */
  countPotionRowStarsFor(row) {
    let totalPotionStars = 0;
    for (const r of POTION_ROWS) {
      if (r === row) break;
      if (r.potions.every((p) => this.potionsCrafted[p - 1])) {
        totalPotionStars += r.stars;
      }
    }
    return this.potionStars - totalPotionStars > 0 ? row.stars : 0;
  }
  /**
   * Add a poison skull and check for star
   */
  addPoisonSkull() {
    this.poisonSkulls++;
    this.craftedPoisonThisTurn = true;
    if (this.poisonSkulls >= POISON_SKULLS_FOR_STAR && !this.poisonStarEarned) {
      this.poisonStarEarned = true;
      this.stars++;
      return true;
    }
    return false;
  }
  /**
   * Check if a value can be added to a distillation column
   * (must be less than previous value, or column must be empty)
   * Poison allows equal values!
   */
  canAddToDistillation(columnIndex, value, isPoison = false) {
    if (columnIndex < 0 || columnIndex >= 4) return false;
    const col = this.distillations[columnIndex];
    if (col.length >= DISTILLATION_ROWS[columnIndex]) return false;
    if (col.length === 0) return true;
    const lastValue = col[col.length - 1].value;
    if (isPoison) {
      return value <= lastValue;
    }
    return value < lastValue;
  }
  /**
   * Add a value to distillation track
   */
  addDistillation(columnIndex, value) {
    const row = this.distillations[columnIndex].length;
    const points = DISTILLATION_POINTS[columnIndex]?.[row] ?? 0;
    this.distillations[columnIndex].push({ value, points });
    return points;
  }
  /**
   * Check if a value can be added to fulminate track
   * (must be greater than previous value, or track must be empty)
   * Poison allows equal values!
   */
  canAddToFulminate(value, isPoison = false) {
    if (this.fulminates.length >= FULMINATE_POINTS.length) return false;
    if (this.fulminates.length === 0) return true;
    const lastValue = this.fulminates[this.fulminates.length - 1].value;
    if (isPoison) {
      return value >= lastValue;
    }
    return value > lastValue;
  }
  /**
   * Add a value to fulminate track
   */
  addFulminate(value) {
    const position = this.fulminates.length;
    const points = FULMINATE_POINTS[Math.min(position, FULMINATE_POINTS.length - 1)];
    this.fulminates.push({ value, points });
    return points;
  }
  /**
   * Check if player has an unused ability of a given type
   */
  hasAbility(type) {
    return this.abilities.some((a) => a.type === type && !a.used);
  }
  /**
   * Count unused abilities of a given type
   */
  countAbility(type) {
    return this.abilities.filter((a) => a.type === type && !a.used).length;
  }
  /**
   * Use an ability (marks it as used)
   */
  useAbility(type) {
    const ability = this.abilities.find((a) => a.type === type && !a.used);
    if (ability) {
      ability.used = true;
      return true;
    }
    return false;
  }
  /**
   * Reset turn state
   */
  resetTurnState() {
    this.craftedPoisonThisTurn = false;
  }
  /**
   * Serialize player to JSON for the game view
   * Override to include all custom properties
   */
  toJSON() {
    return {
      // Base player properties
      position: this.position,
      name: this.name,
      color: this.color,
      avatar: this.avatar,
      // Custom game properties
      score: this.score,
      stars: this.stars,
      ingredientStars: this.ingredientStars,
      potionStars: this.potionStars,
      abilities: this.abilities,
      ingredientTracks: this.ingredientTracks,
      potionsCrafted: this.potionsCrafted,
      poisonSkulls: this.poisonSkulls,
      poisonStarEarned: this.poisonStarEarned,
      distillations: this.distillations,
      fulminates: this.fulminates
    };
  }
};

// rules/src/actions.ts
function createDraftAction(game) {
  return Action.create("draft").prompt("Draft a die from the ingredient shelf").chooseFrom("die", {
    prompt: "Choose a die to draft",
    choices: () => {
      const available = game.getAvailableDice();
      const choices = [];
      for (const die of available) {
        if (!die.name) continue;
        if (die.sides === 10 && die.value === 10) {
          choices.push(`${die.name}:0`);
          choices.push(`${die.name}:10`);
        } else {
          choices.push(die.name);
        }
      }
      return choices;
    },
    display: (choice) => {
      const parts = choice.split(":");
      const dieName = parts[0];
      const overrideValue = parts[1] ? parseInt(parts[1], 10) : null;
      const die = game.shelf.getDice().find((d) => d.name === dieName);
      if (!die) return choice;
      const displayValue = overrideValue !== null ? overrideValue : die.value;
      return `${dieName} (${displayValue})`;
    },
    boardRefs: (choice) => {
      const dieName = choice.split(":")[0];
      const die = game.shelf.getDice().find((d) => d.name === dieName);
      return die ? { targetRef: { id: die.id } } : {};
    }
  }).execute((args, ctx) => {
    const player = ctx.player;
    const choice = args.die;
    const parts = choice.split(":");
    const dieName = parts[0];
    const overrideValue = parts[1] ? parseInt(parts[1], 10) : void 0;
    const die = game.shelf.getDice().find((d) => d.name === dieName);
    if (die) {
      const effectiveValue = overrideValue ?? die.value;
      const unlockedAbility = game.draftDie(player, die, effectiveValue);
      return {
        success: true,
        data: { unlockedAbility },
        message: `${player.name} drafted ${die.name} showing ${effectiveValue}`
      };
    }
    return {
      success: false,
      error: `Die ${dieName} not found`
    };
  });
}
function createCraftAction(game) {
  return Action.create("craft").prompt("Craft a potion from your drafted dice").chooseFrom("operation", {
    prompt: "Choose how to combine your dice",
    choices: (ctx) => {
      const player = ctx.player;
      const choices = ["add"];
      if (player.hasAbility("subtract")) {
        choices.push("subtract");
      }
      return choices;
    },
    display: (op) => {
      if (game.draftedValues.length < 2) return op;
      const [val1, val2] = game.draftedValues;
      if (op === "add") {
        return `Add: ${val1} + ${val2} = ${val1 + val2}`;
      } else {
        return `Subtract: |${val1} - ${val2}| = ${Math.abs(val1 - val2)} (uses ability)`;
      }
    }
  }).chooseFrom("adjustment", {
    prompt: "Apply adjustment?",
    choices: (ctx) => {
      const player = ctx.player;
      if (!player.hasAbility("adjust")) {
        return ["none"];
      }
      return ["none", "+1", "+2", "-1", "-2"];
    },
    display: (adj) => {
      if (adj === "none") return "No adjustment";
      return `${adj} to final value (uses ability)`;
    },
    skipIfOnlyOne: true
    // Auto-select if only 'none' is available
  }).execute((args, ctx) => {
    const player = ctx.player;
    const operation = args.operation;
    const adjustmentStr = args.adjustment || "none";
    const useSubtract = operation === "subtract";
    if (useSubtract) {
      player.useAbility("subtract");
    }
    let adjustment = 0;
    if (adjustmentStr !== "none") {
      adjustment = parseInt(adjustmentStr, 10);
      player.useAbility("adjust");
    }
    const result = game.craftPotion(player, useSubtract, adjustment);
    return {
      success: true,
      data: result,
      message: `${player.name} crafted ${result.isPoison ? "poison" : "potion"} with value ${result.value}`
    };
  });
}
function createRecordAction(game) {
  return Action.create("record").prompt("Record your potion value to a track").chooseFrom("track", {
    prompt: "Where to record your value?",
    choices: (ctx) => {
      const player = ctx.player;
      const value = game.craftedValue;
      const isPoison = game.craftedPoison;
      const choices = [];
      for (let i = 0; i < 4; i++) {
        if (player.canAddToDistillation(i, value, isPoison)) {
          choices.push(`distill-${i}`);
        }
      }
      if (player.canAddToFulminate(value, isPoison)) {
        choices.push("fulminate");
      }
      if (choices.length === 0) {
        for (let i = 0; i < 4; i++) {
          if (player.distillations[i].length < DISTILLATION_ROWS[i]) {
            choices.push(`distill-${i}`);
          }
        }
        if (player.fulminates.length < FULMINATE_POINTS.length) {
          choices.push("fulminate");
        }
      }
      return choices;
    },
    display: (choice) => {
      const player = game.players[game.currentPlayerIndex];
      if (choice.startsWith("distill-")) {
        const col = parseInt(choice.split("-")[1], 10);
        const row = player.distillations[col].length;
        const points = DISTILLATION_POINTS[col]?.[row] ?? 0;
        const sign = points >= 0 ? "+" : "";
        return `Distillation ${col + 1} (${sign}${points} pts)`;
      } else if (choice === "fulminate") {
        const position = player.fulminates.length;
        const points = FULMINATE_POINTS[Math.min(position, FULMINATE_POINTS.length - 1)];
        return `Fulminate (+${points} pts)`;
      }
      return choice;
    }
  }).execute((args, ctx) => {
    const player = ctx.player;
    const choice = args.track;
    let points = 0;
    if (choice.startsWith("distill-")) {
      const columnIndex = parseInt(choice.split("-")[1], 10);
      points = game.recordValue(player, "distillation", columnIndex);
    } else if (choice === "fulminate") {
      points = game.recordValue(player, "fulminate");
    }
    game.clearTurnState(player);
    return {
      success: true,
      data: { points },
      message: `${player.name} recorded to ${choice}`
    };
  });
}
function createUseRerollAction(game) {
  const isRerollableDie = (die, currentGame) => {
    const shelfDice = currentGame.shelf.getDice();
    const draftedDice = currentGame.draftedDice;
    return shelfDice.includes(die) || draftedDice.includes(die);
  };
  return Action.create("useReroll").prompt("Use Reroll ability to reroll up to 2 dice").chooseElement("die1", {
    prompt: "Select first die to reroll",
    elementClass: IngredientDie,
    from: game,
    filter: (die, ctx) => {
      const currentGame = ctx.game;
      return isRerollableDie(die, currentGame);
    },
    display: (die) => `${die.name} (currently ${die.value})`,
    boardRef: (die) => ({ id: die.id, name: die.name })
  }).chooseElement("die2", {
    prompt: "Select second die to reroll (optional)",
    elementClass: IngredientDie,
    from: game,
    filter: (die, ctx) => {
      const currentGame = ctx.game;
      if (ctx.args.die1 === die.id) return false;
      return isRerollableDie(die, currentGame);
    },
    display: (die) => `${die.name} (currently ${die.value})`,
    boardRef: (die) => ({ id: die.id, name: die.name }),
    optional: true
  }).execute((args, ctx) => {
    const currentGame = ctx.game;
    const player = ctx.player;
    const die1Id = typeof args.die1 === "object" ? args.die1.id : args.die1;
    const die2Id = args.die2 !== void 0 ? typeof args.die2 === "object" ? args.die2.id : args.die2 : void 0;
    if (!player.hasAbility("reroll-2")) {
      return { success: false, error: "No reroll ability available" };
    }
    const diceToReroll = [];
    const allDice = currentGame.all(IngredientDie);
    const die1 = allDice.find((d) => d.id === die1Id);
    if (die1) diceToReroll.push(die1);
    if (die2Id !== void 0) {
      const die2 = allDice.find((d) => d.id === die2Id);
      if (die2 && die2 !== die1) diceToReroll.push(die2);
    }
    if (diceToReroll.length === 0) {
      return { success: false, error: "No valid dice selected" };
    }
    player.useAbility("reroll-2");
    const oldValues = diceToReroll.map((d) => d.value);
    currentGame.rerollDice(diceToReroll);
    const newValues = diceToReroll.map((d) => d.value);
    for (let i = 0; i < currentGame.draftedDice.length; i++) {
      const draftedDie = currentGame.draftedDice[i];
      if (diceToReroll.includes(draftedDie)) {
        currentGame.draftedValues[i] = draftedDie.value;
      }
    }
    return {
      success: true,
      data: { oldValues, newValues },
      message: `${player.name} rerolled ${diceToReroll.map((d) => d.name).join(", ")}`
    };
  });
}
function createUseFlipAction(game) {
  const isFlippableDie = (die, currentGame) => {
    const shelfDice = currentGame.shelf.getDice();
    const draftedDice = currentGame.draftedDice;
    return shelfDice.includes(die) || draftedDice.includes(die);
  };
  return Action.create("useFlip").prompt("Use Flip ability to flip a die to its opposite side").chooseElement("die", {
    prompt: "Select a die to flip",
    elementClass: IngredientDie,
    from: game,
    filter: (die, ctx) => {
      const currentGame = ctx.game;
      return isFlippableDie(die, currentGame);
    },
    display: (die) => {
      const opposite = die.sides === 4 ? "any" : die.sides + 1 - die.value;
      return `${die.name} (${die.value} \u2192 ${opposite})`;
    },
    boardRef: (die) => ({ id: die.id, name: die.name })
  }).chooseFrom("newValue", {
    prompt: "Choose the new value (1-4 only applies to D4)",
    choices: () => ["opposite", "1", "2", "3", "4"],
    display: (val) => {
      if (val === "opposite") return "Flip to opposite side";
      return `Set to ${val} (D4 only)`;
    }
  }).execute((args, ctx) => {
    const currentGame = ctx.game;
    const player = ctx.player;
    const dieId = typeof args.die === "object" ? args.die.id : args.die;
    const newValueStr = args.newValue;
    if (!player.hasAbility("flip")) {
      return { success: false, error: "No flip ability available" };
    }
    const die = currentGame.all(IngredientDie).find((d) => d.id === dieId);
    if (!die) {
      return { success: false, error: "Die not found" };
    }
    player.useAbility("flip");
    const oldValue = die.value;
    if (die.sides === 4 && newValueStr !== "opposite") {
      currentGame.flipDie(die, parseInt(newValueStr, 10));
    } else {
      currentGame.flipDie(die);
    }
    const draftedIndex = currentGame.draftedDice.indexOf(die);
    if (draftedIndex >= 0) {
      currentGame.draftedValues[draftedIndex] = die.value;
    }
    return {
      success: true,
      data: { oldValue, newValue: die.value },
      message: `${player.name} flipped ${die.name} from ${oldValue} to ${die.value}`
    };
  });
}
function createUseRefreshAction(game) {
  return Action.create("useRefresh").prompt("Use Refresh ability to reroll all shelf dice").chooseFrom("keepDrafted", {
    prompt: "Keep your drafted die?",
    choices: (ctx) => {
      const currentGame = ctx.game;
      if (currentGame.draftedDice.length === 0) {
        return ["no_drafted"];
      }
      return ["keep", "include"];
    },
    display: (choice) => {
      if (choice === "no_drafted") return "Refresh all shelf dice";
      if (choice === "keep") return "Keep drafted die, refresh shelf";
      return "Include drafted die in refresh";
    },
    skipIfOnlyOne: true
  }).execute((args, ctx) => {
    const currentGame = ctx.game;
    const player = ctx.player;
    const keepChoice = args.keepDrafted;
    if (!player.hasAbility("refresh")) {
      return { success: false, error: "No refresh ability available" };
    }
    player.useAbility("refresh");
    if (keepChoice === "include" && currentGame.draftedDice.length > 0) {
      const die = currentGame.draftedDice[0];
      die.drafted = false;
      die.putInto(currentGame.shelf);
      currentGame.draftedDice = [];
      currentGame.draftedValues = [];
      currentGame.refreshShelf();
    } else if (keepChoice === "keep" && currentGame.draftedDice.length > 0) {
      currentGame.refreshShelf(currentGame.draftedDice[0]);
    } else {
      currentGame.refreshShelf();
    }
    return {
      success: true,
      message: `${player.name} refreshed the ingredient shelf`
    };
  });
}

// rules/src/flow.ts
function createPolyPotionsFlow() {
  const getAvailableAbilityActions = (ctx) => {
    const player = ctx.player;
    const actions = [];
    if (player.hasAbility("reroll-2")) actions.push("useReroll");
    if (player.hasAbility("flip")) actions.push("useFlip");
    if (player.hasAbility("refresh")) actions.push("useRefresh");
    return actions;
  };
  const playerTurn = sequence(
    // Draft first die (with ability options)
    actionStep({
      name: "draft-1",
      actions: (ctx) => ["draft", ...getAvailableAbilityActions(ctx)],
      prompt: "Draft your first die (or use an ability)"
    }),
    // Check if only one die left - auto-draft and reroll for next pick
    execute((ctx) => {
      const game = ctx.game;
      const available = game.getAvailableDice();
      const playerCount = game.players.length;
      if (available.length === 1 && game.draftedDice.length === 1) {
        if (playerCount === 3) {
          game.message("Rule of Three: Only 1 die available, skipping second draft");
        } else {
          const player = ctx.player;
          game.draftDie(player, available[0]);
          const diceToReroll = [];
          for (const die of game.shelf.getDice()) {
            const ingredientDie = die;
            if (!game.draftedDice.includes(ingredientDie)) {
              ingredientDie.drafted = false;
              diceToReroll.push(ingredientDie);
            }
          }
          game.rerollDice(diceToReroll);
          game.message("Only 1 die left - drafted automatically and rerolled shelf");
        }
      }
    }),
    // Draft second die (skip if auto-drafted or Rule of Three)
    actionStep({
      name: "draft-2",
      actions: (ctx) => ["draft", ...getAvailableAbilityActions(ctx)],
      prompt: "Draft your second die (or use an ability)",
      skipIf: (ctx) => {
        const game = ctx.game;
        if (game.draftedDice.length >= 2) return true;
        if (game.players.length === 3 && game.getAvailableDice().length === 0) return true;
        return false;
      }
    }),
    // Handle Rule of Three - skip craft/record if only 1 die drafted
    execute((ctx) => {
      const game = ctx.game;
      if (game.draftedDice.length === 1 && game.players.length === 3) {
        game.rollAllDice();
        game.draftedDice = [];
        game.draftedValues = [];
        game.message("Rule of Three active - next player rolls fresh dice");
      }
    }),
    // Craft the potion (skip if Rule of Three with only 1 die)
    actionStep({
      name: "craft",
      actions: ["craft"],
      prompt: "Combine your dice to craft a potion",
      skipIf: (ctx) => {
        const game = ctx.game;
        return game.draftedValues.length < 2;
      }
    }),
    // Record to track (skip if Rule of Three with only 1 die)
    actionStep({
      name: "record",
      actions: ["record"],
      prompt: "Record your potion value",
      skipIf: (ctx) => {
        const game = ctx.game;
        return game.craftedValue === 0;
      }
    }),
    // Check for Draft Again ability - allow taking another turn
    execute((ctx) => {
      const game = ctx.game;
      const player = ctx.player;
      if (player.hasAbility("draft-again")) {
      }
    })
  );
  return {
    root: loop({
      name: "game-loop",
      while: (ctx) => {
        const game = ctx.game;
        return !game.isFinished();
      },
      maxIterations: 1e3,
      do: sequence(
        // Each player takes a turn
        eachPlayer({
          name: "player-turns",
          do: playerTurn
        }),
        // End of round - reset dice
        execute((ctx) => {
          const game = ctx.game;
          if (!game.isFinished()) {
            game.startNewRound();
          }
        })
      )
    }),
    isComplete: (ctx) => {
      const game = ctx.game;
      return game.isFinished();
    },
    getWinners: (ctx) => {
      const game = ctx.game;
      return game.getWinners();
    }
  };
}

// rules/src/game.ts
var DIE_CONFIG = [
  { name: "d4", sides: 4, color: "#4CAF50", dieType: "d4" },
  // Green
  { name: "d6", sides: 6, color: "#9C27B0", dieType: "d6" },
  // Purple
  { name: "d8", sides: 8, color: "#2196F3", dieType: "d8" },
  // Blue
  { name: "d10", sides: 10, color: "#FF9800", dieType: "d10" },
  // Orange
  { name: "d10%", sides: 10, color: "#FF5722", dieType: "d10" },
  // Deep Orange (percentile, counts as d10)
  { name: "d12", sides: 12, color: "#E91E63", dieType: "d12" },
  // Pink
  { name: "d20", sides: 20, color: "#F44336", dieType: "d20" }
  // Red
];
var PolyPotionsGame = class extends Game {
  /** The shared ingredient shelf with 7 dice */
  shelf;
  /** Current round number */
  round = 1;
  /** Dice drafted this turn (for tracking) */
  draftedDice = [];
  /** The effective values of drafted dice (may differ due to D10 0/10 choice or flip) */
  draftedValues = [];
  /** The crafted potion/poison value this turn */
  craftedValue = 0;
  /** Whether a poison was crafted this turn (vs potion) */
  craftedPoison = false;
  /** Current player index for display functions */
  currentPlayerIndex = 0;
  /** Whether game end has been triggered */
  gameEndTriggered = false;
  constructor(options) {
    super(options);
    this.registerElements([IngredientDie, IngredientShelf, DraftArea]);
    this.shelf = this.create(IngredientShelf, "ingredient-shelf");
    this.shelf.$direction = "horizontal";
    this.shelf.$gap = "16px";
    this.shelf.$align = "center";
    for (const config of DIE_CONFIG) {
      const die = this.shelf.create(IngredientDie, config.name, {
        sides: config.sides,
        color: config.color
      });
      die.dieType = config.dieType;
    }
    this.rollAllDice();
    for (const player of this.players) {
      const draftArea = this.create(DraftArea, `draft-${player.position}`);
      draftArea.player = player;
      draftArea.$direction = "horizontal";
      draftArea.$gap = "12px";
    }
    this.registerAction(createDraftAction(this));
    this.registerAction(createCraftAction(this));
    this.registerAction(createRecordAction(this));
    this.registerAction(createUseRerollAction(this));
    this.registerAction(createUseFlipAction(this));
    this.registerAction(createUseRefreshAction(this));
    this.setFlow(createPolyPotionsFlow());
  }
  /**
   * Override to create PolyPotionsPlayer instances
   */
  createPlayer(position, name) {
    return new PolyPotionsPlayer(position, name);
  }
  /**
   * Get a player's draft area
   */
  getPlayerDraftArea(player) {
    return this.first(DraftArea, `draft-${player.position}`);
  }
  /**
   * Get all undrafted dice on the shelf
   */
  getAvailableDice() {
    return this.shelf.getDice().filter((d) => !d.drafted);
  }
  /**
   * Get the die type for ingredient tracking (both d10 and d10% count as d10)
   */
  getDieType(die) {
    return die.dieType || `d${die.sides}`;
  }
  /**
   * Draft a die (move to player's draft area, mark as drafted)
   * Returns any ability unlocked by drafting this ingredient
   */
  draftDie(player, die, effectiveValue) {
    die.drafted = true;
    this.draftedDice.push(die);
    const draftArea = this.getPlayerDraftArea(player);
    if (draftArea) {
      die.putInto(draftArea);
    }
    const value = effectiveValue ?? die.value;
    this.draftedValues.push(value);
    const dieType = this.getDieType(die);
    const unlockedAbility = player.useIngredient(dieType);
    if (unlockedAbility) {
      this.message(`${player.name} drafted ${die.name} showing ${value} and unlocked ${unlockedAbility}!`);
    } else {
      this.message(`${player.name} drafted ${die.name} showing ${value}`);
    }
    return unlockedAbility;
  }
  /**
   * Craft a potion or poison from the drafted dice
   * Returns the crafted value
   */
  craftPotion(player, useSubtract = false, adjustment = 0) {
    if (this.draftedValues.length !== 2) {
      throw new Error("Must have exactly 2 drafted dice to craft");
    }
    const [val1, val2] = this.draftedValues;
    let value;
    if (useSubtract) {
      value = Math.abs(val1 - val2);
    } else {
      value = val1 + val2;
    }
    value += adjustment;
    value = Math.max(0, value);
    this.craftedValue = value;
    let isPoison = false;
    let starsEarned = 0;
    if (player.canCraftPotion(value)) {
      starsEarned = player.craftPotion(value);
      this.message(`${player.name} crafted potion #${value}!`);
      if (starsEarned > 0) {
        this.message(`${player.name} earned ${starsEarned} star(s) for completing a potion row!`);
      }
    } else {
      isPoison = true;
      const gotStar = player.addPoisonSkull();
      this.craftedPoison = true;
      if (gotStar) {
        starsEarned = 1;
        this.message(`${player.name} got a poison skull and earned a star for completing all poisons!`);
      } else {
        this.message(`${player.name} got a poison skull (potion #${value} already crafted or out of range)`);
      }
    }
    if (player.stars >= 3 && !this.gameEndTriggered) {
      this.gameEndTriggered = true;
      this.message(`${player.name} has 3 stars! Game will end after this round.`);
    }
    return { value, isPoison, starsEarned };
  }
  /**
   * Record the crafted value to distillation or fulminate track
   */
  recordValue(player, track, columnIndex) {
    const value = this.craftedValue;
    const isPoison = this.craftedPoison;
    let points = 0;
    if (track === "distillation" && columnIndex !== void 0) {
      points = player.addDistillation(columnIndex, value);
      this.message(`${player.name} added ${value} to distillation column ${columnIndex + 1} (+${points} points)`);
    } else if (track === "fulminate") {
      points = player.addFulminate(value);
      this.message(`${player.name} added ${value} to fulminate track (+${points} points)`);
    }
    return points;
  }
  /**
   * Get points for distillation based on column and row
   */
  getDistillationPoints(column, row) {
    return DISTILLATION_POINTS[column]?.[row] ?? 0;
  }
  /**
   * Get points for fulminate based on position
   */
  getFulminatePoints(position) {
    return FULMINATE_POINTS[Math.min(position, FULMINATE_POINTS.length - 1)];
  }
  /**
   * Reset for next round - reroll all dice, clear draft state
   */
  startNewRound() {
    for (const die of this.draftedDice) {
      die.drafted = false;
      die.putInto(this.shelf);
    }
    for (const player of this.players) {
      const draftArea = this.getPlayerDraftArea(player);
      if (draftArea) {
        for (const die of draftArea.all(IngredientDie)) {
          die.drafted = false;
          die.putInto(this.shelf);
        }
      }
    }
    this.rollAllDice();
    this.draftedDice = [];
    this.draftedValues = [];
    this.craftedValue = 0;
    this.craftedPoison = false;
    this.round++;
    this.message(`Round ${this.round} begins!`);
  }
  /**
   * Roll all dice on the shelf.
   * Each roll increments the die's rollCount which triggers UI animation.
   */
  rollAllDice() {
    for (const die of this.shelf.getDice()) {
      const ingredientDie = die;
      ingredientDie.drafted = false;
      ingredientDie.roll();
    }
  }
  /**
   * Clear player's turn state (after they complete their turn)
   */
  clearTurnState(player) {
    for (const die of this.draftedDice) {
      die.drafted = false;
      die.putInto(this.shelf);
    }
    this.draftedDice = [];
    this.draftedValues = [];
    this.craftedValue = 0;
    this.craftedPoison = false;
    player.resetTurnState();
  }
  /**
   * Reroll specific dice (for reroll-2 ability).
   * Each roll increments the die's rollCount which triggers UI animation.
   */
  rerollDice(dice) {
    for (const die of dice) {
      die.roll();
    }
    this.message(`Rerolled ${dice.length} dice`);
  }
  /**
   * Refresh the entire shelf (for refresh ability).
   * Each roll increments the die's rollCount which triggers UI animation.
   */
  refreshShelf(keepDie) {
    for (const die of this.shelf.getDice()) {
      if (die !== keepDie) {
        const ingredientDie = die;
        ingredientDie.drafted = false;
        ingredientDie.roll();
      }
    }
    this.message("Refreshed the ingredient shelf");
  }
  /**
   * Flip a die to its opposite side (for flip ability)
   * D4 can be set to any value (1-4)
   */
  flipDie(die, newValue) {
    if (die.sides === 4 && newValue !== void 0) {
      die.value = Math.max(1, Math.min(4, newValue));
    } else {
      die.value = die.sides + 1 - die.value;
    }
    this.message(`Flipped ${die.name} to ${die.value}`);
  }
  /**
   * Check if the game is complete (any player has 3 stars and round is complete)
   */
  isFinished() {
    return this.gameEndTriggered;
  }
  /**
   * Get the winners (player(s) with highest score)
   * Tiebreaker: most stars, then most unused abilities
   */
  getWinners() {
    if (!this.isFinished()) return [];
    let maxScore = -1;
    let winners = [];
    for (const player of this.players) {
      const p = player;
      if (p.score > maxScore) {
        maxScore = p.score;
        winners = [p];
      } else if (p.score === maxScore) {
        winners.push(p);
      }
    }
    if (winners.length > 1) {
      const maxStars = Math.max(...winners.map((p) => p.stars));
      winners = winners.filter((p) => p.stars === maxStars);
    }
    if (winners.length > 1) {
      const countUnused = (p) => p.abilities.filter((a) => !a.used).length;
      const maxUnused = Math.max(...winners.map(countUnused));
      winners = winners.filter((p) => countUnused(p) === maxUnused);
    }
    return winners;
  }
};

// rules/src/index.ts
var gameDefinition = {
  gameClass: PolyPotionsGame,
  gameType: "polyhedral-potions",
  displayName: "Polyhedral Potions",
  minPlayers: 1,
  maxPlayers: 5
};
export {
  DISTILLATION_COMPLETION_BONUS,
  DISTILLATION_POINTS,
  DISTILLATION_ROWS,
  DraftArea,
  FULMINATE_COMPLETION_BONUS,
  FULMINATE_POINTS,
  INGREDIENT_TRACK_CONFIG,
  IngredientDie,
  IngredientShelf,
  POISON_SKULLS_FOR_STAR,
  POTION_ROWS,
  PolyPotionsGame,
  PolyPotionsPlayer,
  createCraftAction,
  createDraftAction,
  createPolyPotionsFlow,
  createRecordAction,
  createUseFlipAction,
  createUseRefreshAction,
  createUseRerollAction,
  gameDefinition
};
