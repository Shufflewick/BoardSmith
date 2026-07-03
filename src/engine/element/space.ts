import { GameElement } from './game-element.js';
import type { ElementClass, ElementAttributes, ElementContext, ElementJSON } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';
import type { VisibilityMode, VisibilityState } from '../command/visibility.js';
import { copyVisibilityState, visibilityFromMode } from '../command/visibility.js';

/**
 * Event handler for element enter/exit events
 */
export type ElementEventHandler<T extends GameElement> = {
  callback: (element: T) => void;
  elementClass?: ElementClass;
};

/**
 * Layout direction for Space children
 */
export type LayoutDirection = 'horizontal' | 'vertical';

/**
 * Alignment options for Space children
 */
export type LayoutAlignment = 'start' | 'center' | 'end' | 'stretch';

/**
 * Container element for game components. Spaces represent fixed locations
 * on the board where pieces can be placed.
 *
 * Use Space (or subclasses like Deck, Hand) for:
 * - Board regions (play areas, scoring zones)
 * - Card containers (decks, discard piles, hands)
 * - Any fixed location that holds other elements
 *
 * **Key features:**
 * - Zone visibility: Control who sees contents via `contentsHidden()`, `contentsVisibleToOwner()`
 * - Events: React to elements entering/exiting via `onEnter()`, `onExit()`
 * - Shuffle: Randomize children order via `shuffle()`
 * - Layout: Configure visual arrangement via `$direction`, `$overlap`, `$fan`
 *
 * @example
 * ```typescript
 * // Create a deck with hidden contents
 * const deck = game.create(Deck, 'draw-pile');
 * deck.contentsHidden();
 * deck.shuffle();
 *
 * // Create a player's hand visible only to owner
 * const hand = game.create(Hand, 'hand', { player });
 * hand.contentsVisibleToOwner();
 *
 * // React to cards entering a discard pile
 * discardPile.onEnter((card: Card) => {
 *   game.message('{{player}} discarded {{card}}', { player, card });
 * }, Card);
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
 */
export class Space<G extends Game = any, P extends Player = any> extends GameElement<G, P> {
  // ============================================
  // Layout Properties (for AutoUI rendering)
  // ============================================

  /**
   * Layout direction for children
   * @default 'horizontal'
   */
  $direction?: LayoutDirection;

  /**
   * Gap between children (CSS value like '8px' or '0.5rem')
   */
  $gap?: string;

  /**
   * Overlap ratio for stacked elements (0-1)
   * 0 = no overlap, 0.5 = 50% overlap, 0.9 = 90% overlap (deck-like)
   */
  $overlap?: number;

  /**
   * Whether to fan children (like a hand of cards)
   * When true, children are rotated around a central point
   */
  $fan?: boolean;

  /**
   * Fan angle in degrees for the entire spread
   * @default 30
   */
  $fanAngle?: number;

  /**
   * Alignment of children within the space
   * @default 'center'
   */
  $align?: LayoutAlignment;

  // ============================================
  // Internal State
  // ============================================

  /** Event handlers for enter/exit events */
  private _eventHandlers: {
    enter: ElementEventHandler<GameElement>[];
    exit: ElementEventHandler<GameElement>[];
  } = { enter: [], exit: [] };

  /** Visibility mode for contents (not the space itself) */
  private _zoneVisibility?: VisibilityState;

  static override unserializableAttributes = [
    ...GameElement.unserializableAttributes,
    '_eventHandlers',
    // '_zoneVisibility' intentionally NOT listed here (SEC-01/F1/F7): the
    // `_`-prefix already excludes it from the generic attribute-loop in
    // GameElement.toJSON/loadSerializedState, so listing it here was a no-op
    // for serialization — it only ever gated the (nonexistent) generic
    // restore path. The explicit `toJSON`/`_restoreZoneVisibility` round-trip
    // below is the actual serialize/restore mechanism, mirroring how
    // `_visibility` is handled on GameElement.
  ];

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
  }

  // ============================================
  // Serialization (SEC-01/F1/F7)
  // ============================================

  /**
   * Serialize this Space, including zone visibility for its contents.
   * Mirrors GameElement's `_visibility?.explicit` special case exactly:
   * only explicitly-set zone visibility is emitted (the class default set in
   * a constructor, e.g. Deck's `contentsHidden()`, is naturally re-applied
   * when a restored instance re-runs its own constructor via
   * `GameElement.fromJSON`'s `new ElementClass(ctx)` — but any divergence
   * from that default, or a runtime change via `contentsHidden()` etc, MUST
   * round-trip explicitly since the class default cannot reproduce it).
   */
  override toJSON(): ElementJSON {
    const json = super.toJSON();
    if (this._zoneVisibility?.explicit) {
      // Emit a COPY — `addZoneVisibleTo`/`hideContentsFrom` mutate
      // `_zoneVisibility` in place, and a snapshot/checkpoint sharing the
      // live object would be retroactively corrupted by later mutations (CR-02).
      json.zoneVisibility = copyVisibilityState(this._zoneVisibility);
    }
    return json;
  }

  /**
   * Internal restore hook for `GameElement.fromJSON` (SEC-01/F1/F7). Not
   * part of the public API — `_zoneVisibility` stays private; this is the
   * scoped cross-class accessor (mirrors the codebase's `_t` convention for
   * framework-internal, cross-class state) that lets the base class restore
   * it without widening Space's public surface.
   */
  _restoreZoneVisibility(state: VisibilityState): void {
    // Adopt a COPY so the restored Space never shares mutable state with the
    // snapshot it was restored from (CR-02) — a retained checkpoint may be
    // restored again, so in-place mutations must never reach it.
    this._zoneVisibility = copyVisibilityState(state);
  }

  // ============================================
  // Zone Visibility Configuration
  // ============================================

  /**
   * Set the visibility mode for this zone's contents (not the zone itself)
   * Children will inherit this unless they explicitly override
   */
  setZoneVisibility(mode: VisibilityMode): void {
    this._zoneVisibility = visibilityFromMode(mode);
  }

  /**
   * Get the zone visibility (for children to inherit)
   */
  getZoneVisibility(): VisibilityState | undefined {
    return this._zoneVisibility;
  }

  /**
   * Make contents visible to all players (default)
   */
  contentsVisible(): void {
    this.setZoneVisibility('all');
  }

  /**
   * Make contents visible only to the owner of this space
   */
  contentsVisibleToOwner(): void {
    this.setZoneVisibility('owner');
  }

  /**
   * Make contents hidden from all players
   */
  contentsHidden(): void {
    this.setZoneVisibility('hidden');
  }

  /**
   * Make contents show only count (e.g., opponent's hand size)
   */
  contentsCountOnly(): void {
    this.setZoneVisibility('count-only');
  }

  /**
   * Add specific players who can see contents (beyond zone default)
   */
  addZoneVisibleTo(...players: (P | number)[]): void {
    const positions = players.map((p) => (typeof p === 'number' ? p : p.seat));
    if (!this._zoneVisibility) {
      this._zoneVisibility = { mode: 'all', explicit: true };
    }
    this._zoneVisibility.addPlayers = Array.from(
      new Set([...(this._zoneVisibility.addPlayers ?? []), ...positions])
    );
  }

  /**
   * Set players who cannot see contents (with 'all' mode)
   */
  hideContentsFrom(...players: (P | number)[]): void {
    if (!this._zoneVisibility) {
      this._zoneVisibility = { mode: 'all', explicit: true };
    }
    const positions = players.map((p) => (typeof p === 'number' ? p : p.seat));
    this._zoneVisibility.exceptPlayers = Array.from(
      new Set([...(this._zoneVisibility.exceptPlayers ?? []), ...positions])
    );
  }

  // ============================================
  // Event Handlers
  // ============================================

  /**
   * Register a callback for when elements enter this space
   *
   * **Snapshot-restore constraint (WR-03, phase 131):** handler closures are
   * captured from the constructor-built tree and re-attached to the rebuilt
   * tree on every snapshot restore (undo, rewind, cold restore). The closure
   * itself survives, but any ELEMENT it captured lexically still points at
   * the discarded pre-restore tree. Reach elements via game attributes or
   * queries, never via captured locals:
   *
   * ```typescript
   * // WRONG — `scorePile` is a stale reference after any restore; the card
   * // silently vanishes into the discarded tree:
   * const scorePile = this.create(Space, 'score');
   * this.discard.onEnter((card) => card.putInto(scorePile));
   *
   * // RIGHT — re-resolved through the live game on every call:
   * this.scorePile = this.create(Space, 'score');
   * this.discard.onEnter((card) => card.putInto((card.game as MyGame).scorePile));
   * ```
   *
   * In dev mode, `putInto()` warns when its destination is detached from the
   * live tree (the signature of this mistake).
   */
  onEnter<T extends GameElement>(
    callback: (element: T) => void,
    elementClass?: ElementClass<T>
  ): void {
    this._eventHandlers.enter.push({ callback: callback as (element: GameElement) => void, elementClass });
  }

  /**
   * Register a callback for when elements exit this space
   *
   * **Snapshot-restore constraint:** same as {@link onEnter} — never capture
   * elements lexically in the handler closure; reach them via game
   * attributes or `element.game` queries.
   */
  onExit<T extends GameElement>(
    callback: (element: T) => void,
    elementClass?: ElementClass<T>
  ): void {
    this._eventHandlers.exit.push({ callback: callback as (element: GameElement) => void, elementClass });
  }

  /**
   * Trigger an event for an element
   */
  triggerEvent(type: 'enter' | 'exit', element: GameElement): void {
    for (const handler of this._eventHandlers[type]) {
      if (!handler.elementClass || element instanceof handler.elementClass) {
        handler.callback(element);
      }
    }
  }

  // ============================================
  // Event Handler Restore (RST-01/F10)
  // ============================================

  /**
   * Internal accessor returning this Space's registered `onEnter`/`onExit`
   * handlers (RST-01/F10). Not part of the public API — `_eventHandlers`
   * stays private; this is the scoped cross-class accessor (mirrors
   * `_restoreZoneVisibility` and the codebase's `_t` convention) that lets
   * `Game.loadSerializedState` capture live handler closures from the
   * constructor-built tree BEFORE it is discarded on restore. Handlers are
   * live closures and cannot be serialized, so they must be captured from
   * the live tree and re-attached to the rebuilt tree by stable identity.
   */
  _captureEventHandlers(): {
    enter: ElementEventHandler<GameElement>[];
    exit: ElementEventHandler<GameElement>[];
  } {
    return this._eventHandlers;
  }

  /**
   * Internal accessor for re-attaching previously captured `onEnter`/`onExit`
   * handlers to a freshly-restored Space instance (RST-01/F10). See
   * `_captureEventHandlers` for context. Not part of the public API.
   */
  _restoreEventHandlers(handlers: {
    enter: ElementEventHandler<GameElement>[];
    exit: ElementEventHandler<GameElement>[];
  }): void {
    this._eventHandlers = handlers;
  }

  // ============================================
  // Element Creation (override to trigger events)
  // ============================================

  override create<T extends GameElement>(
    elementClass: ElementClass<T>,
    name: string,
    attributes?: ElementAttributes<T>
  ): T {
    const element = super.create(elementClass, name, attributes);

    // Trigger enter event
    this.triggerEvent('enter', element);

    return element;
  }

  // ============================================
  // Shuffle
  // ============================================

  /**
   * Randomly reorder the children of this space.
   *
   * Uses the game's seeded random number generator for deterministic shuffling
   * (same seed = same shuffle order). Typically used on decks during setup.
   *
   * @example
   * ```typescript
   * // Shuffle the deck during game setup
   * deck.shuffle();
   *
   * // Create and shuffle a deck
   * for (const cardData of CARDS) {
   *   deck.create(Card, cardData.name, cardData);
   * }
   * deck.shuffle();
   * ```
   */
  shuffle(): void {
    this.shuffleInternal();
  }

  /**
   * Internal shuffle method called by command executor
   */
  shuffleInternal(): void {
    const random = this._ctx.random;
    if (!random) {
      throw new Error(
        'Space.shuffleInternal(): no seeded random number generator is reachable. ' +
        'This Space is not attached to a Game (or its context is missing `random`), so ' +
        'there is no seeded rng to shuffle deterministically. Fix: construct this element ' +
        'via a Game so it inherits the seeded rng from `Game._ctx.random`, or ensure the ' +
        'element tree is connected to a Game before calling shuffle().'
      );
    }

    // Fisher-Yates shuffle
    for (let i = this._t.children.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this._t.children[i], this._t.children[j]] = [
        this._t.children[j],
        this._t.children[i],
      ];
    }
  }

  // ============================================
  // Type guard
  // ============================================

  /**
   * Check if this element is a Space
   */
  isSpace(): boolean {
    return true;
  }
}
