import { describe, it, expect } from 'vitest';
import {
  groupElementsByClass,
  discoverDecks,
  discoverCardContainers,
  getElementDisplayName,
  getCardDisplayName,
  cardMatchesSearch,
  filterElementGroups,
  filterDecks,
  decksExpandedBySearch,
  type DeckCard,
} from './debug-view-tree.js';

const VIEW = {
  id: 1,
  className: 'Board',
  children: [
    {
      id: 2,
      className: 'MainDeck',
      name: 'Draw',
      $type: 'deck',
      children: [
        { id: 10, className: 'Card', name: 'Ace', notation: 'AS' },
        { id: 11, className: 'Card', name: 'King' },
      ],
    },
    {
      id: 3,
      className: 'Hand',
      name: 'My Hand',
      children: [{ id: 12, className: 'Card', name: 'Queen' }],
    },
    { id: 4, className: 'Piece', notation: 'a1', attributes: { color: 'red' } },
  ],
};

function card(over: Partial<DeckCard> = {}): DeckCard {
  return { id: 10, name: 'Ace', notation: 'AS', className: 'Card', fullObject: {}, ...over };
}

describe('groupElementsByClass', () => {
  it('buckets every element with a numeric id by class name', () => {
    const groups = groupElementsByClass(VIEW);
    expect(Object.keys(groups).sort()).toEqual(['Board', 'Card', 'Hand', 'MainDeck', 'Piece']);
    expect(groups.Card.map(e => e.id)).toEqual([10, 11, 12]);
  });

  it('strips children off the detail object so the detail pane is not the whole tree', () => {
    const groups = groupElementsByClass(VIEW);
    expect(groups.MainDeck[0].fullObject.children).toBeUndefined();
    expect(groups.MainDeck[0].fullObject.name).toBe('Draw');
  });

  it('calls an element with no class name Unknown and gives it empty attributes', () => {
    const groups = groupElementsByClass({ id: 7 });
    expect(groups.Unknown[0].className).toBe('Unknown');
    expect(groups.Unknown[0].attributes).toEqual({});
  });

  it('skips nodes with no id but still walks through them', () => {
    const groups = groupElementsByClass({ className: 'Wrapper', children: [{ id: 5, className: 'Piece' }] });
    expect(Object.keys(groups)).toEqual(['Piece']);
  });

  it('is empty for a missing or non-object view', () => {
    expect(groupElementsByClass(undefined)).toEqual({});
    expect(groupElementsByClass('nope')).toEqual({});
  });
});

describe('discoverDecks', () => {
  it('finds a deck by its $type marker', () => {
    expect(discoverDecks(VIEW).map(d => d.id)).toEqual([2]);
  });

  it('finds a deck by a Deck-ish class name, whatever its case', () => {
    const decks = discoverDecks({ id: 9, className: 'discardDECK', children: [] });
    expect(decks).toHaveLength(1);
  });

  it('collects the deck cards, without their own children', () => {
    const [deck] = discoverDecks(VIEW);
    expect(deck.cards.map(c => c.id)).toEqual([10, 11]);
    expect(deck.cards[0].fullObject.children).toBeUndefined();
  });

  it('names an unnamed deck after its id', () => {
    const [deck] = discoverDecks({ id: 9, $type: 'deck' });
    expect(deck.name).toBe('Deck #9');
    expect(deck.className).toBe('Deck');
    expect(deck.cards).toEqual([]);
  });

  it('ignores non-object and id-less children when collecting cards', () => {
    const [deck] = discoverDecks({ id: 9, $type: 'deck', children: [null, 'x', { className: 'Ghost' }] });
    expect(deck.cards).toEqual([]);
  });

  it('finds decks nested inside other elements', () => {
    const decks = discoverDecks({ id: 1, children: [{ id: 2, children: [{ id: 3, $type: 'deck' }] }] });
    expect(decks.map(d => d.id)).toEqual([3]);
  });
});

describe('discoverCardContainers', () => {
  it('finds every element holding card-like children, decks included', () => {
    const byId = Object.fromEntries(discoverCardContainers(VIEW).map(c => [c.id, c.cardCount]));
    expect(byId).toEqual({ 1: 3, 2: 2, 3: 1 });
  });

  it('ignores an element whose children carry no ids', () => {
    expect(discoverCardContainers({ id: 1, children: [{ className: 'Ghost' }] })).toEqual([]);
  });

  it('ignores an element with no children at all', () => {
    expect(discoverCardContainers({ id: 1, children: [] })).toEqual([]);
  });

  it('names a container after its name, then its class, then its id', () => {
    const kid = { id: 2 };
    expect(discoverCardContainers({ id: 1, name: 'Hand', className: 'H', children: [kid] })[0].name).toBe('Hand');
    expect(discoverCardContainers({ id: 1, className: 'H', children: [kid] })[0].name).toBe('H');
    expect(discoverCardContainers({ id: 1, children: [kid] })[0].name).toBe('Container #1');
  });
});

describe('display names', () => {
  it('prefers notation, then name, then id', () => {
    expect(getElementDisplayName({ id: 4, notation: 'a1', name: 'x' })).toBe('a1');
    expect(getElementDisplayName({ id: 4, name: 'x' })).toBe('x');
    expect(getElementDisplayName({ id: 4 })).toBe('#4');
    expect(getCardDisplayName({ id: 10, notation: 'AS', name: 'Ace' })).toBe('AS');
    expect(getCardDisplayName({ id: 11, name: 'King' })).toBe('King');
    expect(getCardDisplayName({ id: 12 })).toBe('#12');
  });
});

describe('cardMatchesSearch', () => {
  it('matches name, notation, class name and id, case-insensitively', () => {
    expect(cardMatchesSearch(card(), 'ace')).toBe(true);
    expect(cardMatchesSearch(card(), 'AS')).toBe(true);
    expect(cardMatchesSearch(card(), 'card')).toBe(true);
    expect(cardMatchesSearch(card(), '10')).toBe(true);
    expect(cardMatchesSearch(card(), 'zzz')).toBe(false);
  });

  it('matches NOTHING on an empty query, because it only ever answers "pull this deck open"', () => {
    expect(cardMatchesSearch(card(), '')).toBe(false);
  });

  it('copes with a card that has neither name nor notation', () => {
    expect(cardMatchesSearch(card({ name: undefined, notation: undefined }), 'ace')).toBe(false);
  });
});

describe('filterElementGroups', () => {
  const groups = groupElementsByClass(VIEW);

  it('returns everything untouched on an empty query', () => {
    expect(filterElementGroups(groups, '')).toBe(groups);
  });

  it('keeps a whole group when the class name matches', () => {
    expect(Object.keys(filterElementGroups(groups, 'card'))).toEqual(['Card']);
  });

  it('keeps only the matching members when an element matches', () => {
    const filtered = filterElementGroups(groups, 'a1');
    expect(Object.keys(filtered)).toEqual(['Piece']);
    expect(filtered.Piece.map(e => e.id)).toEqual([4]);
  });

  it('matches an element by id', () => {
    expect(Object.keys(filterElementGroups(groups, '12'))).toEqual(['Card']);
  });

  it('drops groups where nothing matched', () => {
    expect(filterElementGroups(groups, 'nothing-here')).toEqual({});
  });
});

describe('filterDecks and decksExpandedBySearch', () => {
  const decks = discoverDecks(VIEW);

  it('returns every deck on an empty query and expands none of them', () => {
    expect(filterDecks(decks, '')).toBe(decks);
    expect(decksExpandedBySearch(decks, '')).toEqual(new Set());
  });

  it('keeps a deck matched by its own name, and does not pull it open', () => {
    expect(filterDecks(decks, 'Draw').map(d => d.id)).toEqual([2]);
    expect(decksExpandedBySearch(decks, 'Draw')).toEqual(new Set());
  });

  it('keeps a deck matched only by a card, and pulls it open so the match is visible', () => {
    expect(filterDecks(decks, 'Ace').map(d => d.id)).toEqual([2]);
    expect(decksExpandedBySearch(decks, 'Ace')).toEqual(new Set([2]));
  });

  it('drops decks that match neither themselves nor any card', () => {
    expect(filterDecks(decks, 'nothing-here')).toEqual([]);
  });
});
