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
        return typeof choiceSel.choices === "function" ? choiceSel.choices(context) : choiceSel.choices;
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
   * Check if an action is available for a player
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
    for (const selection of action.selections) {
      if (selection.optional)
        continue;
      if (selection.type === "text" || selection.type === "number") {
        continue;
      }
      const choices = this.getChoices(selection, player, {});
      if (choices.length === 0) {
        return false;
      }
    }
    return true;
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
      if (!config.repeatUntil || config.repeatUntil(this.createContext())) {
        currentFrame.completed = true;
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
    return {
      position: this.getPosition(),
      complete: this.complete,
      awaitingInput: this.awaitingInput,
      currentPlayer: this.currentPlayer?.position,
      availableActions: this.awaitingInput ? this.availableActions : void 0,
      prompt: this.prompt,
      awaitingPlayers: this.awaitingPlayers.length > 0 ? this.awaitingPlayers : void 0
    };
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
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
    if (this.lastActionResult && config.repeatUntil?.(context)) {
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
    if (available.length === 0) {
      frame.completed = true;
      return { continue: true, awaitingInput: false };
    }
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
   */
  toJSONForPlayer(player) {
    const position = typeof player === "number" ? player : player.position;
    const filterElement = (json, element) => {
      const visibility = element.getEffectiveVisibility();
      if (visibility.mode === "count-only" && !element.isVisibleTo(position)) {
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
      if (!element.isVisibleTo(position)) {
        return {
          className: json.className,
          id: json.id,
          attributes: { __hidden: true }
        };
      }
      const zoneVisibility = element.getZoneVisibility?.();
      if (zoneVisibility) {
        if (zoneVisibility.mode === "hidden") {
          return {
            ...json,
            children: void 0,
            childCount: element._t.children.length
          };
        } else if (zoneVisibility.mode === "count-only") {
          return {
            ...json,
            children: void 0,
            childCount: element._t.children.length
          };
        } else if (zoneVisibility.mode === "owner" && element.player?.position !== position) {
          return {
            ...json,
            children: void 0,
            childCount: element._t.children.length
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
    return filterElement(fullJson, this) ?? fullJson;
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
      timeout: config.timeout
    }
  };
}
function execute(fn) {
  return {
    type: "execute",
    config: { fn }
  };
}
function setVar(name, value) {
  return execute((ctx) => {
    const resolvedValue = typeof value === "function" ? value(ctx) : value;
    ctx.set(name, resolvedValue);
  });
}

// rules/src/elements.ts
var CheckerPiece = class extends Piece {
  /** Whether this piece has been crowned as a king */
  isKing = false;
  /**
   * Get the direction this piece can move (1 = down the board, -1 = up)
   * Regular pieces move toward opponent's side, kings move both ways
   */
  get forwardDirection() {
    return this.player?.position === 0 ? 1 : -1;
  }
  /**
   * Crown this piece as a king
   */
  crown() {
    this.isKing = true;
  }
};
var Square = class extends GridCell {
  /** Column position (0-7, 0 is left) */
  col;
  /** Whether this is a dark (playable) square */
  isDark;
  /**
   * Get the piece on this square, if any
   */
  getPiece() {
    return this.first(CheckerPiece);
  }
  /**
   * Check if this square is empty
   */
  isEmpty() {
    return this.count(CheckerPiece) === 0;
  }
  /**
   * Check if this square has an opponent's piece
   */
  hasOpponentPiece(player) {
    const piece = this.getPiece();
    return piece !== void 0 && piece.player !== player;
  }
  /**
   * Check if this square has a friendly piece
   */
  hasFriendlyPiece(player) {
    const piece = this.getPiece();
    return piece !== void 0 && piece.player === player;
  }
  /**
   * Get algebraic notation for this square (a1-h8 style)
   */
  get notation() {
    const col = String.fromCharCode(97 + this.col);
    const row = 8 - this.row;
    return `${col}${row}`;
  }
};
var Board = class extends Grid {
  // Set grid labels for AutoUI (chess-style notation)
  $rowLabels = ["8", "7", "6", "5", "4", "3", "2", "1"];
  $columnLabels = ["a", "b", "c", "d", "e", "f", "g", "h"];
  // Tell AutoUI which attributes represent coordinates
  $rowCoord = "row";
  $colCoord = "col";
  /**
   * Get a square by row and column
   */
  getSquare(row, col) {
    return this.first(Square, { row, col });
  }
  /**
   * Get a square by algebraic notation (e.g., "a1")
   */
  getSquareByNotation(notation) {
    const col = notation.charCodeAt(0) - 97;
    const row = 8 - parseInt(notation[1]);
    return this.getSquare(row, col);
  }
  /**
   * Get all dark (playable) squares
   */
  getDarkSquares() {
    return [...this.all(Square, { isDark: true })];
  }
};
var CheckersPlayer = class extends Player {
  /** Number of pieces captured by this player */
  capturedCount = 0;
};

// rules/src/actions.ts
function createEndTurnAction(game) {
  return Action.create("endTurn").prompt("End Turn").condition((ctx) => {
    const player = ctx.player;
    if (game.continuingPlayer === player && game.continuingPiece) {
      return false;
    }
    return game.hasMovedThisTurn === true;
  }).execute((args, ctx) => {
    const player = ctx.player;
    game.hasMovedThisTurn = false;
    return {
      success: true,
      data: { turnEnded: true },
      message: `${player.name} ended their turn.`
    };
  });
}
function createMoveAction(game) {
  function getMovesForPlayer(player) {
    if (game.continuingPiece && game.continuingPlayer === player) {
      return game.getValidMovesForPiece(game.continuingPiece);
    }
    return game.getValidMoves(player);
  }
  function getPiecesWithMoves(player) {
    if (game.continuingPiece && game.continuingPlayer === player) {
      return [game.continuingPiece];
    }
    const moves = game.getValidMoves(player);
    const pieceIds = new Set(moves.map((m) => m.piece.id));
    return [...pieceIds].map((id) => game.getElementById(id)).filter(Boolean);
  }
  return Action.create("move").prompt("Move").chooseElement("piece", {
    prompt: "Select a piece to move",
    elementClass: CheckerPiece,
    filter: (element, ctx) => {
      const piece = element;
      const player = ctx.player;
      if (piece.player !== player) return false;
      if (game.continuingPiece && game.continuingPlayer === player) {
        return piece === game.continuingPiece;
      }
      const moves = game.getValidMoves(player);
      return moves.some((m) => m.piece.id === piece.id);
    },
    display: (piece, ctx) => {
      const square = game.getPieceSquare(piece);
      return square?.notation || String(piece.id);
    },
    boardRef: (piece, ctx) => {
      const square = game.getPieceSquare(piece);
      return {
        id: piece.id,
        notation: square?.notation
      };
    },
    skipIfOnlyOne: true
  }).chooseFrom("destination", {
    prompt: "Select destination",
    choices: (ctx) => {
      const player = ctx.player;
      const moves = getMovesForPlayer(player);
      return moves.map((m) => ({
        pieceId: m.piece.id,
        fromNotation: m.from.notation,
        toNotation: m.to.notation,
        isCapture: m.captures.length > 0,
        becomesKing: m.becomesKing
      }));
    },
    display: (choice) => {
      let text = choice.toNotation;
      if (choice.isCapture) text += " (capture)";
      if (choice.becomesKing) text += " \u2192 King";
      return text;
    },
    boardRefs: (choice) => {
      const toSquare = game.board.getSquareByNotation(choice.toNotation);
      return {
        sourceRef: {
          id: choice.pieceId,
          notation: choice.fromNotation
        },
        targetRef: {
          id: toSquare?.id,
          notation: choice.toNotation
        }
      };
    },
    // Filter destinations based on selected piece
    filterBy: {
      key: "pieceId",
      selectionName: "piece"
    }
  }).condition((ctx) => {
    const player = ctx.player;
    if (game.continuingPlayer && game.continuingPlayer !== player) {
      return false;
    }
    if (game.hasMovedThisTurn && !game.continuingPiece) {
      return false;
    }
    if (game.continuingPiece) {
      return game.getValidMovesForPiece(game.continuingPiece).length > 0;
    }
    return game.getValidMoves(player).length > 0;
  }).execute((args, ctx) => {
    const player = ctx.player;
    const piece = args.piece;
    const destination = args.destination;
    const moves = getMovesForPlayer(player);
    const move = moves.find(
      (m) => m.piece.id === piece.id && m.to.notation === destination.toNotation
    );
    if (!move) {
      return {
        success: false,
        error: "Invalid move"
      };
    }
    const pieceType = move.piece.isKing ? "King" : "Piece";
    const isCapture = move.captures.length > 0;
    game.message(`${player.name}: ${pieceType} ${move.from.notation} -> ${move.to.notation}`);
    game.executeMove(move);
    if (isCapture && !move.becomesKing) {
      const additionalCaptures = game.getCaptureMoves(move.piece);
      if (additionalCaptures.length > 0) {
        game.continuingPlayer = player;
        game.continuingPiece = move.piece;
        game.message(`${player.name} must continue capturing!`);
        return {
          success: true,
          data: {
            captured: true,
            mustContinue: true,
            from: move.from.notation,
            to: move.to.notation,
            crowned: false
          },
          message: `Captured! Must continue jumping.`
        };
      }
    }
    game.continuingPlayer = null;
    game.continuingPiece = null;
    game.hasMovedThisTurn = true;
    return {
      success: true,
      data: {
        captured: isCapture,
        mustContinue: false,
        canEndTurn: true,
        // Signal that player can now end their turn
        from: move.from.notation,
        to: move.to.notation,
        crowned: move.becomesKing
      },
      message: move.becomesKing ? `Moved and crowned!` : isCapture ? `Captured!` : `Moved ${move.from.notation} to ${move.to.notation}`
    };
  });
}

// rules/src/flow.ts
function createCheckersFlow(game) {
  const playerTurn = sequence(
    // Reset turn state at start of each turn
    setVar("turnComplete", false),
    execute(() => {
      game.hasMovedThisTurn = false;
    }),
    // The turn loop - keeps going for multi-jump captures OR until endTurn
    loop({
      name: "move-loop",
      while: (ctx) => {
        if (ctx.get("turnComplete")) return false;
        if (game.isFinished()) return false;
        const player = ctx.player;
        if (!player) return false;
        if (game.continuingPlayer && game.continuingPlayer !== player) {
          return false;
        }
        if (game.hasMovedThisTurn && !game.continuingPiece) {
          return true;
        }
        if (game.continuingPiece) {
          return game.getValidMovesForPiece(game.continuingPiece).length > 0;
        }
        return game.getValidMoves(player).length > 0;
      },
      maxIterations: 20,
      // Safety limit for multi-jumps
      do: sequence(
        // Player makes a move or ends turn
        actionStep({
          name: "move-step",
          actions: ["move", "endTurn"],
          // Both actions available
          skipIf: (ctx) => {
            return game.isFinished();
          }
        }),
        // Check if turn should continue (multi-jump), end, or await confirmation
        execute((ctx) => {
          if (ctx.lastActionResult?.data?.turnEnded) {
            ctx.set("turnComplete", true);
            return;
          }
          const mustContinue = ctx.lastActionResult?.data?.mustContinue;
          if (mustContinue) {
            return;
          }
        })
      )
    })
  );
  return {
    root: loop({
      name: "game-loop",
      while: (ctx) => {
        return !game.isFinished();
      },
      maxIterations: 500,
      // Safety limit for long games
      do: eachPlayer({
        name: "player-turns",
        filter: (player, ctx) => {
          if (game.continuingPlayer && game.continuingPlayer !== player) {
            return false;
          }
          return game.canCurrentPlayerMove(player);
        },
        do: playerTurn
      })
    }),
    isComplete: (ctx) => {
      return game.isFinished();
    },
    getWinners: (ctx) => {
      return game.getWinners();
    }
  };
}

// rules/src/game.ts
var CheckersGame = class extends Game {
  /** The game board */
  board;
  /** Track which player must continue capturing (for multi-jump turns) */
  continuingPlayer = null;
  continuingPiece = null;
  /** Track if the current player has made a move this turn (for undo/endTurn) */
  hasMovedThisTurn = false;
  constructor(options) {
    super(options);
    this._ctx.classRegistry.set("Board", Board);
    this._ctx.classRegistry.set("Square", Square);
    this._ctx.classRegistry.set("CheckerPiece", CheckerPiece);
    this.board = this.create(Board, "board");
    this.board.contentsVisible();
    this.createSquares();
    this.placePieces();
    this.registerAction(createMoveAction(this));
    this.registerAction(createEndTurnAction(this));
    this.setFlow(createCheckersFlow(this));
  }
  /**
   * Override to create CheckersPlayer instances
   */
  createPlayer(position, name) {
    return new CheckersPlayer(position, name);
  }
  /**
   * Create all 64 squares on the board
   */
  createSquares() {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const isDark = (row + col) % 2 === 1;
        const colLetter = String.fromCharCode(97 + col);
        const rowNumber = 8 - row;
        const notation = `${colLetter}${rowNumber}`;
        const square = this.board.create(Square, notation, { row, col, isDark });
        square.contentsVisible();
      }
    }
  }
  /**
   * Place initial pieces on the board
   * Player 0 (dark pieces) on rows 0-2
   * Player 1 (light pieces) on rows 5-7
   */
  placePieces() {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = this.board.getSquare(row, col);
        if (!square || !square.isDark) continue;
        if (row < 3) {
          const piece = square.create(CheckerPiece, `p0-${row}-${col}`);
          piece.player = this.players[0];
        } else if (row > 4) {
          const piece = square.create(CheckerPiece, `p1-${row}-${col}`);
          piece.player = this.players[1];
        }
      }
    }
  }
  /**
   * Get all pieces belonging to a player
   */
  getPlayerPieces(player) {
    const pieces = [];
    for (const square of this.board.getDarkSquares()) {
      const piece = square.getPiece();
      if (piece && piece.player === player) {
        pieces.push(piece);
      }
    }
    return pieces;
  }
  /**
   * Get the square a piece is on
   */
  getPieceSquare(piece) {
    return piece.parent;
  }
  /**
   * Check if a move is a valid simple move (non-capture)
   */
  isValidSimpleMove(piece, to) {
    const from = this.getPieceSquare(piece);
    if (!from || !to.isEmpty()) return false;
    const rowDiff = to.row - from.row;
    const colDiff = Math.abs(to.col - from.col);
    if (colDiff !== 1 || Math.abs(rowDiff) !== 1) return false;
    if (!piece.isKing) {
      if (piece.forwardDirection === 1 && rowDiff !== 1) return false;
      if (piece.forwardDirection === -1 && rowDiff !== -1) return false;
    }
    return true;
  }
  /**
   * Get all valid capture moves for a piece
   * Returns array of { to: Square, captured: Square }
   */
  getCaptureMoves(piece) {
    const from = this.getPieceSquare(piece);
    if (!from) return [];
    const player = piece.player;
    if (!player) return [];
    const captures = [];
    const directions = piece.isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : piece.forwardDirection === 1 ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];
    for (const [dRow, dCol] of directions) {
      const midRow = from.row + dRow;
      const midCol = from.col + dCol;
      const endRow = from.row + 2 * dRow;
      const endCol = from.col + 2 * dCol;
      if (endRow < 0 || endRow > 7 || endCol < 0 || endCol > 7) continue;
      const midSquare = this.board.getSquare(midRow, midCol);
      const endSquare = this.board.getSquare(endRow, endCol);
      if (!midSquare || !endSquare) continue;
      if (!midSquare.hasOpponentPiece(player)) continue;
      if (!endSquare.isEmpty()) continue;
      captures.push({ to: endSquare, captured: midSquare });
    }
    return captures;
  }
  /**
   * Check if a player has any capture moves available
   */
  playerHasCaptures(player) {
    for (const piece of this.getPlayerPieces(player)) {
      if (this.getCaptureMoves(piece).length > 0) {
        return true;
      }
    }
    return false;
  }
  /**
   * Check if a player has ANY valid move (early exit optimization)
   * Much faster than getValidMoves().length > 0 for checking game state
   */
  hasAnyValidMove(player) {
    const pieces = this.getPlayerPieces(player);
    if (pieces.length === 0) return false;
    for (const piece of pieces) {
      if (this.getCaptureMoves(piece).length > 0) {
        return true;
      }
    }
    for (const piece of pieces) {
      const from = this.getPieceSquare(piece);
      if (!from) continue;
      for (const dRow of piece.isKing ? [-1, 1] : [piece.forwardDirection]) {
        for (const dCol of [-1, 1]) {
          const toRow = from.row + dRow;
          const toCol = from.col + dCol;
          if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) continue;
          const to = this.board.getSquare(toRow, toCol);
          if (to && to.isEmpty()) {
            return true;
          }
        }
      }
    }
    return false;
  }
  /**
   * Check if a specific piece has capture moves available
   */
  pieceHasCaptures(piece) {
    return this.getCaptureMoves(piece).length > 0;
  }
  /**
   * Get all valid moves for a player
   * If captures are available, only capture moves are returned (mandatory capture rule)
   */
  getValidMoves(player) {
    const moves = [];
    const pieces = this.getPlayerPieces(player);
    let hasCaptures = false;
    for (const piece of pieces) {
      const captureMoves = this.getCaptureMoves(piece);
      if (captureMoves.length > 0) {
        hasCaptures = true;
        const from = this.getPieceSquare(piece);
        for (const { to, captured } of captureMoves) {
          const becomesKing = !piece.isKing && this.isKingRow(to.row, player);
          moves.push({
            piece,
            from,
            to,
            captures: [captured],
            becomesKing
          });
        }
      }
    }
    if (hasCaptures) return moves;
    for (const piece of pieces) {
      const from = this.getPieceSquare(piece);
      if (!from) continue;
      for (const dRow of piece.isKing ? [-1, 1] : [piece.forwardDirection]) {
        for (const dCol of [-1, 1]) {
          const toRow = from.row + dRow;
          const toCol = from.col + dCol;
          if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) continue;
          const to = this.board.getSquare(toRow, toCol);
          if (!to || !to.isEmpty()) continue;
          const becomesKing = !piece.isKing && this.isKingRow(to.row, player);
          moves.push({
            piece,
            from,
            to,
            captures: [],
            becomesKing
          });
        }
      }
    }
    return moves;
  }
  /**
   * Get valid moves for a specific piece (for multi-jump continuation)
   */
  getValidMovesForPiece(piece) {
    const player = piece.player;
    if (!player) return [];
    const moves = [];
    const captureMoves = this.getCaptureMoves(piece);
    if (captureMoves.length > 0) {
      const from = this.getPieceSquare(piece);
      for (const { to, captured } of captureMoves) {
        const becomesKing = !piece.isKing && this.isKingRow(to.row, player);
        moves.push({
          piece,
          from,
          to,
          captures: [captured],
          becomesKing
        });
      }
    }
    return moves;
  }
  /**
   * Check if a row is the king row for a player
   */
  isKingRow(row, player) {
    return player.position === 0 ? row === 7 : row === 0;
  }
  /**
   * Execute a move
   */
  executeMove(move) {
    const { piece, from, to, captures, becomesKing } = move;
    for (const capturedSquare of captures) {
      const capturedPiece = capturedSquare.getPiece();
      if (capturedPiece) {
        capturedPiece.remove();
        if (piece.player) {
          piece.player.capturedCount++;
        }
        this.message(`${piece.player?.name} captured a piece!`);
      }
    }
    piece.putInto(to);
    if (becomesKing) {
      piece.crown();
      this.message(`${piece.player?.name}'s piece was crowned!`);
    }
  }
  /**
   * Check if the game is over
   * Optimized to use hasAnyValidMove() for early exit
   */
  isFinished() {
    for (const player of this.players) {
      if (!this.hasAnyValidMove(player)) return true;
    }
    return false;
  }
  /**
   * Get the winner(s)
   * Optimized to use hasAnyValidMove() instead of getValidMoves()
   */
  getWinners() {
    if (!this.isFinished()) return [];
    for (const player of this.players) {
      if (!this.hasAnyValidMove(player)) {
        const opponent = this.players.find((p) => p !== player);
        return opponent ? [opponent] : [];
      }
    }
    return [];
  }
  /**
   * Check if current player can make any move
   * Optimized to use hasAnyValidMove() for early exit
   */
  canCurrentPlayerMove(player) {
    return this.hasAnyValidMove(player);
  }
};

// rules/src/ai.ts
function getCheckersObjectives(game, playerIndex) {
  const checkersGame = game;
  const player = checkersGame.players[playerIndex];
  const opponent = checkersGame.players[1 - playerIndex];
  return {
    // Having more pieces is good
    "piece-advantage": {
      checker: () => {
        const myPieces = checkersGame.getPlayerPieces(player).length;
        const theirPieces = checkersGame.getPlayerPieces(opponent).length;
        return myPieces > theirPieces;
      },
      weight: 5
    },
    // Having more kings is very good
    "king-advantage": {
      checker: () => {
        const myKings = checkersGame.getPlayerPieces(player).filter((p) => p.isKing).length;
        const theirKings = checkersGame.getPlayerPieces(opponent).filter((p) => p.isKing).length;
        return myKings > theirKings;
      },
      weight: 8
    },
    // Control the center (squares in rows 3-4)
    "center-control": {
      checker: () => {
        const myPieces = checkersGame.getPlayerPieces(player);
        const centerPieces = myPieces.filter((p) => {
          const square = checkersGame.getPieceSquare(p);
          return square && square.row >= 3 && square.row <= 4;
        });
        return centerPieces.length >= 2;
      },
      weight: 3
    },
    // Advancing pieces toward king row is good
    "advancement": {
      checker: () => {
        const myPieces = checkersGame.getPlayerPieces(player).filter((p) => !p.isKing);
        if (myPieces.length === 0) return false;
        const kingRow = player.position === 0 ? 7 : 0;
        const avgDistance = myPieces.reduce((sum, p) => {
          const square = checkersGame.getPieceSquare(p);
          if (!square) return sum;
          return sum + Math.abs(square.row - kingRow);
        }, 0) / myPieces.length;
        return avgDistance < 3;
      },
      weight: 2
    },
    // Protect the back row (prevent opponent kings)
    "back-row-defense": {
      checker: () => {
        const backRow = player.position === 0 ? 0 : 7;
        const myPieces = checkersGame.getPlayerPieces(player);
        const backRowPieces = myPieces.filter((p) => {
          const square = checkersGame.getPieceSquare(p);
          return square && square.row === backRow;
        });
        return backRowPieces.length >= 1;
      },
      weight: 2
    },
    // Having capture opportunities is good
    "capture-available": {
      checker: () => checkersGame.playerHasCaptures(player),
      weight: 4
    },
    // Opponent having no moves is very good (near win)
    "opponent-blocked": {
      checker: () => checkersGame.getValidMoves(opponent).length === 0,
      weight: 20
    }
  };
}

// rules/src/index.ts
var gameDefinition = {
  gameClass: CheckersGame,
  gameType: "checkers",
  displayName: "Checkers",
  minPlayers: 2,
  maxPlayers: 2,
  ai: {
    objectives: getCheckersObjectives
  }
};
export {
  Board,
  CheckerPiece,
  CheckersGame,
  CheckersPlayer,
  Square,
  createCheckersFlow,
  createMoveAction,
  gameDefinition,
  getCheckersObjectives
};
