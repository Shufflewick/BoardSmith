/**
 * View-tree derivations for the debug panel's Elements and Decks tabs (#41).
 *
 * The Elements and Decks tabs are three near-identical recursive walks over the
 * same player view tree, plus the search predicates that filter what they found.
 * All of it was inline in `DebugPanel.vue` as `computed`s closing over
 * `displayedState`, so none of it could be exercised without mounting the panel
 * and standing up a host bridge.
 *
 * These take a view node and return plain data, so a test hands them an object
 * literal.
 *
 * @module
 */

/** One element found in the view tree, with its children stripped off. */
export interface GroupedElement {
  id: number;
  className: string;
  name?: string;
  notation?: string;
  attributes: Record<string, unknown>;
  /** The element's own fields, without `children` — what the detail pane shows. */
  fullObject: Record<string, unknown>;
}

/** A card inside a discovered deck. */
export interface DeckCard {
  id: number;
  name?: string;
  notation?: string;
  className: string;
  fullObject: Record<string, unknown>;
}

/** A deck found in the view tree, with the cards it holds. */
export interface DeckInfo {
  id: number;
  name: string;
  className: string;
  cards: DeckCard[];
  fullObject: Record<string, unknown>;
}

/**
 * Anything that can hold cards — a deck, a hand, a discard pile. Transfer
 * targets come from here rather than from `DeckInfo`, so a card can be moved
 * somewhere that is not itself a deck.
 */
export interface CardContainerInfo {
  id: number;
  name: string;
  className: string;
  cardCount: number;
}

type Node = Record<string, unknown>;

function asNode(value: unknown): Node | null {
  return value && typeof value === 'object' ? (value as Node) : null;
}

function childrenOf(obj: Node): unknown[] {
  return Array.isArray(obj.children) ? obj.children : [];
}

/** Does this child look like a card — that is, does it have an element id? */
function isCardLike(child: unknown): boolean {
  const obj = asNode(child);
  return obj !== null && typeof obj.id === 'number';
}

/** Walk a view tree depth-first, visiting every node that is an object. */
function walk(root: unknown, visit: (obj: Node) => void): void {
  const obj = asNode(root);
  if (!obj) return;
  visit(obj);
  for (const child of childrenOf(obj)) walk(child, visit);
}

/** Every element in the tree, bucketed by class name. */
export function groupElementsByClass(view: unknown): Record<string, GroupedElement[]> {
  const groups: Record<string, GroupedElement[]> = {};

  walk(view, (obj) => {
    if (typeof obj.id !== 'number') return;
    const className = (obj.className as string) || 'Unknown';
    const { children: _children, ...objectWithoutChildren } = obj;
    (groups[className] ??= []).push({
      id: obj.id,
      className,
      name: obj.name as string | undefined,
      notation: obj.notation as string | undefined,
      attributes: (obj.attributes as Record<string, unknown>) || {},
      fullObject: objectWithoutChildren,
    });
  });

  return groups;
}

/**
 * Every deck in the tree, with its cards. A node counts as a deck when the game
 * marked it `$type: 'deck'` or when its class name says so.
 */
export function discoverDecks(view: unknown): DeckInfo[] {
  const decks: DeckInfo[] = [];

  walk(view, (obj) => {
    const isDeck = obj.$type === 'deck'
      || (typeof obj.className === 'string' && obj.className.toLowerCase().includes('deck'));
    if (!isDeck || typeof obj.id !== 'number') return;

    const cards: DeckCard[] = [];
    for (const child of childrenOf(obj)) {
      const cardObj = asNode(child);
      if (!cardObj || typeof cardObj.id !== 'number') continue;
      const { children: _cardChildren, ...cardWithoutChildren } = cardObj;
      cards.push({
        id: cardObj.id,
        name: cardObj.name as string | undefined,
        notation: cardObj.notation as string | undefined,
        className: (cardObj.className as string) || 'Unknown',
        fullObject: cardWithoutChildren,
      });
    }

    const { children: _children, ...deckWithoutChildren } = obj;
    decks.push({
      id: obj.id,
      name: (obj.name as string) || `Deck #${obj.id}`,
      className: (obj.className as string) || 'Deck',
      cards,
      fullObject: deckWithoutChildren,
    });
  });

  return decks;
}

/** Every element in the tree that holds card-like children. */
export function discoverCardContainers(view: unknown): CardContainerInfo[] {
  const containers: CardContainerInfo[] = [];
  const seenIds = new Set<number>();

  walk(view, (obj) => {
    if (typeof obj.id !== 'number' || seenIds.has(obj.id)) return;
    const children = childrenOf(obj);
    if (children.length === 0 || !children.some(isCardLike)) return;

    seenIds.add(obj.id);
    containers.push({
      id: obj.id,
      name: (obj.name as string) || (obj.className as string) || `Container #${obj.id}`,
      className: (obj.className as string) || 'Unknown',
      cardCount: children.filter(isCardLike).length,
    });
  });

  return containers;
}

/** Notation, then name, then id — the first thing the element actually has. */
export function getElementDisplayName(element: Pick<GroupedElement, 'id' | 'name' | 'notation'>): string {
  return element.notation || element.name || `#${element.id}`;
}

/** Same rule as `getElementDisplayName`, for a card inside a deck. */
export function getCardDisplayName(card: Pick<DeckCard, 'id' | 'name' | 'notation'>): string {
  return card.notation || card.name || `#${card.id}`;
}

/**
 * Does a card match the Decks search box? Unlike the State tab's search, an
 * empty query matches NOTHING here: this predicate only ever answers "should
 * this deck be pulled open because of what is inside it".
 */
export function cardMatchesSearch(card: DeckCard, query: string): boolean {
  if (!query) return false;
  const lowerQuery = query.toLowerCase();
  return !!(
    card.name?.toLowerCase().includes(lowerQuery)
    || card.notation?.toLowerCase().includes(lowerQuery)
    || card.className.toLowerCase().includes(lowerQuery)
    || String(card.id).includes(lowerQuery)
  );
}

/** Element groups whose class, name, notation or id matches the query. */
export function filterElementGroups(
  groups: Record<string, GroupedElement[]>,
  query: string,
): Record<string, GroupedElement[]> {
  if (!query) return groups;

  const lowerQuery = query.toLowerCase();
  const filtered: Record<string, GroupedElement[]> = {};

  for (const [className, elements] of Object.entries(groups)) {
    const matching = elements.filter(el =>
      className.toLowerCase().includes(lowerQuery)
      || el.name?.toLowerCase().includes(lowerQuery)
      || el.notation?.toLowerCase().includes(lowerQuery)
      || String(el.id).includes(lowerQuery)
    );
    if (matching.length > 0) filtered[className] = matching;
  }

  return filtered;
}

/** Decks that match themselves, or that hold a card which matches. */
export function filterDecks(decks: DeckInfo[], query: string): DeckInfo[] {
  if (!query) return decks;

  const lowerQuery = query.toLowerCase();
  return decks.filter(deck =>
    deck.name.toLowerCase().includes(lowerQuery)
    || deck.className.toLowerCase().includes(lowerQuery)
    || String(deck.id).includes(lowerQuery)
    || deck.cards.some(card => cardMatchesSearch(card, query))
  );
}

/**
 * Decks the search should pull open on its own, because the match that kept
 * them in the list is on a card the reader cannot see while they are shut.
 */
export function decksExpandedBySearch(decks: DeckInfo[], query: string): Set<number> {
  const expanded = new Set<number>();
  if (!query) return expanded;
  for (const deck of decks) {
    if (deck.cards.some(card => cardMatchesSearch(card, query))) expanded.add(deck.id);
  }
  return expanded;
}
