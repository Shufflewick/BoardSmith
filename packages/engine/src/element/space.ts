import { GameElement } from './game-element.js';
import type { ElementClass, ElementAttributes, ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';
import type { VisibilityMode, VisibilityState } from '../command/visibility.js';
import { visibilityFromMode } from '../command/visibility.js';

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
 * Spaces are static areas of the game board. They act as containers for Pieces
 * and other elements. Spaces are created during setup and their structure
 * doesn't change during play (though their contents do).
 *
 * Zone-based visibility: Space defines default visibility for its contents.
 * The Space itself is always visible - only the contents get the visibility rules.
 * Children inherit the zone visibility unless they explicitly override it.
 *
 * Layout properties: Spaces can define how their children are arranged using
 * $ prefixed properties that AutoUI reads for rendering.
 *
 * Examples: a deck, a player's hand, a discard pile, a board region
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
    '_zoneVisibility',
  ];

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
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
    const positions = players.map((p) => (typeof p === 'number' ? p : p.position));
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
    const positions = players.map((p) => (typeof p === 'number' ? p : p.position));
    this._zoneVisibility.exceptPlayers = Array.from(
      new Set([...(this._zoneVisibility.exceptPlayers ?? []), ...positions])
    );
  }

  // ============================================
  // Event Handlers
  // ============================================

  /**
   * Register a callback for when elements enter this space
   */
  onEnter<T extends GameElement>(
    callback: (element: T) => void,
    elementClass?: ElementClass<T>
  ): void {
    this._eventHandlers.enter.push({ callback: callback as (element: GameElement) => void, elementClass });
  }

  /**
   * Register a callback for when elements exit this space
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
   * Shuffle the direct children of this space
   */
  shuffle(): void {
    this.shuffleInternal();
  }

  /**
   * Internal shuffle method called by command executor
   */
  shuffleInternal(): void {
    const random = this._ctx.random ?? Math.random;

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
