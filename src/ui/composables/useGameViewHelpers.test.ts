/**
 * The game-view helper family: how a custom UI walks the serialized element
 * tree it is handed and gets back the numeric ids every action call needs.
 * These are the most-used functions in `boardsmith/ui`, and a wrong answer
 * here surfaces as an action submitted against the wrong element.
 */
import { describe, it, expect } from 'vitest';
import {
  findElementById,
  findElement,
  findElements,
  findChildByAttribute,
  findElementByAttribute,
  findAllByAttribute,
  getElementId,
  findPlayerHand,
  findPlayerElement,
  getPlayerAttribute,
  findAllHands,
  getElementCount,
  getCards,
  getFirstCard,
  getCardData,
  getElementOwner,
  isOwnedByPlayer,
  isMyElement,
  isOpponentElement,
  useGameViewHelpers,
} from './useGameViewHelpers.js';
import type { GameElement } from '../types.js';

const element = (
  id: number,
  className: string,
  attributes: Record<string, unknown> = {},
  children: GameElement[] = [],
  name = className.toLowerCase(),
): GameElement => ({ id, className, name, attributes, children } as unknown as GameElement);

const owner = (seat: number) => ({ __playerRef: seat, seat });

const card = (id: number, rank: string, suit: string, seat?: number) =>
  element(id, 'Card', { rank, suit, ...(seat === undefined ? {} : { player: owner(seat) }) });

/**
 * game
 *  ├─ hand (seat 1) ─ AH, KS
 *  ├─ hand (seat 2) ─ 2C
 *  ├─ deck (hidden, childCount 40)
 *  ├─ player element seat 1 (score 7)
 *  └─ board ─ square(a1) ─ pawn
 */
const HAND_ONE = element(10, 'Hand', { $type: 'hand', player: owner(1) }, [
  card(11, 'A', 'H', 1),
  card(12, 'K', 'S', 1),
]);
const HAND_TWO = element(20, 'Hand', { $type: 'hand', player: owner(2) }, [card(21, '2', 'C', 2)]);
const DECK = { ...element(30, 'Deck', { $type: 'deck' }), childCount: 40 } as GameElement;
const PLAYER_ONE = element(40, 'Player', { $type: 'player', seat: 1, score: 7 });
const PAWN = element(52, 'Pawn', { player: owner(1) });
const SQUARE = element(51, 'Square', { notation: 'a1' }, [PAWN]);
const BOARD = element(50, 'Board', {}, [SQUARE]);

const GAME: GameElement = element(1, 'Game', {}, [HAND_ONE, HAND_TWO, DECK, PLAYER_ONE, BOARD], 'game');

describe('findElementById', () => {
  it('finds the root itself', () => {
    expect(findElementById(GAME, 1)).toBe(GAME);
  });

  it('finds a direct child', () => {
    expect(findElementById(GAME, 30)).toBe(DECK);
  });

  it('finds a deeply nested element', () => {
    expect(findElementById(GAME, 52)).toBe(PAWN);
  });

  it('returns undefined for an id that is not in the tree', () => {
    expect(findElementById(GAME, 9999)).toBeUndefined();
  });

  it('returns undefined for a missing tree', () => {
    expect(findElementById(null, 1)).toBeUndefined();
    expect(findElementById(undefined, 1)).toBeUndefined();
  });
});

describe('findElement', () => {
  it('finds by className', () => {
    expect(findElement(GAME, { className: 'Board' })).toBe(BOARD);
  });

  it('finds by name', () => {
    expect(findElement(GAME, { name: 'board' })).toBe(BOARD);
  });

  it('finds by $type', () => {
    expect(findElement(GAME, { type: 'deck' })).toBe(DECK);
  });

  it('returns the first match in depth-first order', () => {
    expect(findElement(GAME, { className: 'Hand' })).toBe(HAND_ONE);
  });

  it('matches the root itself', () => {
    expect(findElement(GAME, { className: 'Game' })).toBe(GAME);
  });

  it('returns undefined when nothing matches', () => {
    expect(findElement(GAME, { className: 'Nonexistent' })).toBeUndefined();
  });

  it('returns undefined for a missing tree', () => {
    expect(findElement(null, { className: 'Board' })).toBeUndefined();
  });

  it('matches on any one of the supplied criteria', () => {
    expect(findElement(GAME, { type: 'nope', className: 'Board' })).toBe(BOARD);
  });

  it('returns undefined when no criteria are given', () => {
    expect(findElement(GAME, {})).toBeUndefined();
  });
});

describe('findElements', () => {
  it('collects every match in the tree', () => {
    expect(findElements(GAME, { className: 'Hand' })).toHaveLength(2);
  });

  it('collects nested matches, not just direct children', () => {
    expect(findElements(GAME, { className: 'Card' }).map((c) => c.id)).toEqual([11, 12, 21]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(findElements(GAME, { className: 'Nonexistent' })).toEqual([]);
  });

  it('returns an empty array for a missing tree', () => {
    expect(findElements(null, { className: 'Hand' })).toEqual([]);
  });

  it('collects by $type', () => {
    expect(findElements(GAME, { type: 'hand' }).map((h) => h.id)).toEqual([10, 20]);
  });

  it('counts a matching element once even if several criteria fit it', () => {
    expect(findElements(GAME, { type: 'hand', className: 'Hand' })).toHaveLength(2);
  });
});

describe('findChildByAttribute', () => {
  it('finds a direct child by attribute value', () => {
    expect(findChildByAttribute(HAND_ONE, 'rank', 'K')?.id).toBe(12);
  });

  it('does not search below the direct children', () => {
    expect(findChildByAttribute(GAME, 'rank', 'K')).toBeUndefined();
  });

  it('returns the first of several matches', () => {
    expect(findChildByAttribute(HAND_ONE, 'player', HAND_ONE.children![0].attributes!.player)?.id)
      .toBe(11);
  });

  it('returns undefined when no child matches', () => {
    expect(findChildByAttribute(HAND_ONE, 'rank', 'Q')).toBeUndefined();
  });

  it('returns undefined for a missing or childless parent', () => {
    expect(findChildByAttribute(null, 'rank', 'K')).toBeUndefined();
    expect(findChildByAttribute(DECK, 'rank', 'K')).toBeUndefined();
  });
});

describe('findElementByAttribute', () => {
  it('finds a nested element by attribute value', () => {
    expect(findElementByAttribute(GAME, 'notation', 'a1')?.id).toBe(51);
  });

  it('matches the root itself', () => {
    expect(findElementByAttribute(PLAYER_ONE, 'seat', 1)).toBe(PLAYER_ONE);
  });

  it('returns undefined when nothing matches', () => {
    expect(findElementByAttribute(GAME, 'notation', 'z9')).toBeUndefined();
  });

  it('returns undefined for a missing tree', () => {
    expect(findElementByAttribute(null, 'notation', 'a1')).toBeUndefined();
  });

  it('compares by identity, so an equal-looking object does not match', () => {
    expect(findElementByAttribute(GAME, 'player', { __playerRef: 1, seat: 1 })).toBeUndefined();
  });
});

describe('findAllByAttribute', () => {
  it('collects every element with the attribute value', () => {
    expect(findAllByAttribute(GAME, 'rank', 'A').map((c) => c.id)).toEqual([11]);
  });

  it('searches the whole tree, including the root', () => {
    expect(findAllByAttribute(GAME, '$type', 'hand').map((h) => h.id)).toEqual([10, 20]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(findAllByAttribute(GAME, 'rank', 'Q')).toEqual([]);
  });

  it('returns an empty array for a missing tree', () => {
    expect(findAllByAttribute(null, 'rank', 'A')).toEqual([]);
  });
});

describe('getElementId', () => {
  it('returns the numeric id an action call needs', () => {
    expect(getElementId(PAWN)).toBe(52);
  });

  it('returns undefined for a missing element rather than throwing', () => {
    expect(getElementId(null)).toBeUndefined();
    expect(getElementId(undefined)).toBeUndefined();
  });
});

describe('findPlayerHand', () => {
  it('finds the hand belonging to a seat', () => {
    expect(findPlayerHand(GAME, 1)).toBe(HAND_ONE);
    expect(findPlayerHand(GAME, 2)).toBe(HAND_TWO);
  });

  it('returns undefined for a seat with no hand', () => {
    expect(findPlayerHand(GAME, 3)).toBeUndefined();
  });

  it('looks only at direct children of the view', () => {
    const nested = element(1, 'Game', {}, [element(2, 'Table', {}, [HAND_ONE])]);
    expect(findPlayerHand(nested, 1)).toBeUndefined();
  });

  it('returns undefined for a missing view', () => {
    expect(findPlayerHand(null, 1)).toBeUndefined();
  });
});

describe('findAllHands', () => {
  it('collects every hand in the view', () => {
    expect(findAllHands(GAME).map((h) => h.id)).toEqual([10, 20]);
  });

  it('ignores non-hand children', () => {
    expect(findAllHands(GAME).every((h) => h.attributes!.$type === 'hand')).toBe(true);
  });

  it('returns an empty array for a missing view', () => {
    expect(findAllHands(null)).toEqual([]);
  });
});

describe('findPlayerElement', () => {
  it('finds the player element for a seat', () => {
    expect(findPlayerElement(GAME, 1)).toBe(PLAYER_ONE);
  });

  it('searches the whole tree, not just direct children', () => {
    const nested = element(1, 'Game', {}, [element(2, 'Table', {}, [PLAYER_ONE])]);
    expect(findPlayerElement(nested, 1)).toBe(PLAYER_ONE);
  });

  it('returns undefined for a seat with no player element', () => {
    expect(findPlayerElement(GAME, 9)).toBeUndefined();
  });

  it('returns undefined for a missing view', () => {
    expect(findPlayerElement(null, 1)).toBeUndefined();
  });

  it('does not confuse a hand owned by a seat with the player element', () => {
    expect(findPlayerElement(GAME, 2)).toBeUndefined();
  });
});

describe('getPlayerAttribute', () => {
  it('reads a custom attribute off the player element', () => {
    expect(getPlayerAttribute(GAME, 1, 'score', 0)).toBe(7);
  });

  it('falls back to the default when the attribute is absent', () => {
    expect(getPlayerAttribute(GAME, 1, 'diceWager', 1)).toBe(1);
  });

  it('falls back to the default when the player element is absent', () => {
    expect(getPlayerAttribute(GAME, 9, 'score', -1)).toBe(-1);
  });

  it('falls back to the default for a missing view', () => {
    expect(getPlayerAttribute(null, 1, 'score', 0)).toBe(0);
  });

  it('returns a falsy stored value rather than the default', () => {
    const view = element(1, 'Game', {}, [
      element(2, 'Player', { $type: 'player', seat: 1, score: 0, ready: false }),
    ]);
    expect(getPlayerAttribute(view, 1, 'score', 99)).toBe(0);
    expect(getPlayerAttribute(view, 1, 'ready', true)).toBe(false);
  });
});

describe('getElementCount', () => {
  it('counts visible children', () => {
    expect(getElementCount(HAND_ONE)).toBe(2);
  });

  it('falls back to childCount for a zone whose contents are hidden', () => {
    expect(getElementCount(DECK)).toBe(40);
  });

  it('is 0 for an empty element with no childCount', () => {
    expect(getElementCount(element(9, 'Empty'))).toBe(0);
  });

  it('is 0 for a missing element', () => {
    expect(getElementCount(null)).toBe(0);
    expect(getElementCount(undefined)).toBe(0);
  });

  it('prefers the visible children when both are present', () => {
    const partly = { ...HAND_ONE, childCount: 99 } as GameElement;
    expect(getElementCount(partly)).toBe(2);
  });
});

describe('getCards / getFirstCard / getCardData', () => {
  it('returns the children that carry a rank', () => {
    expect(getCards(HAND_ONE).map((c) => c.id)).toEqual([11, 12]);
  });

  it('ignores children with no rank', () => {
    const mixed = element(9, 'Hand', {}, [card(1, 'A', 'H'), element(2, 'Token')]);
    expect(getCards(mixed).map((c) => c.id)).toEqual([1]);
  });

  it('returns an empty array for a missing or childless element', () => {
    expect(getCards(null)).toEqual([]);
    expect(getCards(DECK)).toEqual([]);
  });

  it('returns the first card', () => {
    expect(getFirstCard(HAND_ONE)?.id).toBe(11);
  });

  it('returns undefined for a hand with no cards', () => {
    expect(getFirstCard(DECK)).toBeUndefined();
    expect(getFirstCard(null)).toBeUndefined();
  });

  it('extracts rank and suit from a card', () => {
    expect(getCardData(HAND_ONE.children![0])).toEqual({ rank: 'A', suit: 'H' });
  });

  it('defaults a missing suit to an empty string', () => {
    expect(getCardData(element(9, 'Card', { rank: 'A' }))).toEqual({ rank: 'A', suit: '' });
  });

  it('returns undefined for an element that is not a card', () => {
    expect(getCardData(DECK)).toBeUndefined();
    expect(getCardData(null)).toBeUndefined();
  });
});

describe('ownership helpers', () => {
  it('reports the owning seat', () => {
    expect(getElementOwner(HAND_ONE)).toBe(1);
    expect(getElementOwner(HAND_TWO)).toBe(2);
  });

  it('reports no owner for an unowned element', () => {
    expect(getElementOwner(BOARD)).toBeUndefined();
    expect(getElementOwner(null)).toBeUndefined();
  });

  it('isOwnedByPlayer matches only the owning seat', () => {
    expect(isOwnedByPlayer(HAND_ONE, 1)).toBe(true);
    expect(isOwnedByPlayer(HAND_ONE, 2)).toBe(false);
  });

  it('isOwnedByPlayer is false for an unowned element', () => {
    expect(isOwnedByPlayer(BOARD, 1)).toBe(false);
  });

  it('isMyElement agrees with isOwnedByPlayer', () => {
    for (const seat of [1, 2, 3]) {
      expect(isMyElement(HAND_ONE, seat)).toBe(isOwnedByPlayer(HAND_ONE, seat));
    }
  });

  it('isOpponentElement is true only for another seat owner', () => {
    expect(isOpponentElement(HAND_TWO, 1)).toBe(true);
    expect(isOpponentElement(HAND_ONE, 1)).toBe(false);
  });

  it('isOpponentElement is false for an unowned element', () => {
    // An unowned board is nobody's, and calling it an opponent's would hide it
    // from a UI that dims opponent-owned pieces.
    expect(isOpponentElement(BOARD, 1)).toBe(false);
    expect(isOpponentElement(null, 1)).toBe(false);
  });

  it('mine and opponent are mutually exclusive for every element', () => {
    for (const target of [HAND_ONE, HAND_TWO, BOARD, PAWN]) {
      expect(isMyElement(target, 1) && isOpponentElement(target, 1)).toBe(false);
    }
  });
});

describe('useGameViewHelpers', () => {
  it('exposes the module functions themselves', () => {
    const helpers = useGameViewHelpers();
    expect(helpers.findElementById).toBe(findElementById);
    expect(helpers.getElementId).toBe(getElementId);
    expect(helpers.isOpponentElement).toBe(isOpponentElement);
  });

  it('exposes the whole documented helper set', () => {
    expect(Object.keys(useGameViewHelpers()).sort()).toEqual([
      'findAllByAttribute', 'findAllHands', 'findChildByAttribute', 'findElement',
      'findElementByAttribute', 'findElementById', 'findElements', 'findPlayerElement',
      'findPlayerHand', 'getCardData', 'getCards', 'getElementCount', 'getElementId',
      'getElementOwner', 'getFirstCard', 'getPlayerAttribute', 'isMyElement',
      'isOpponentElement', 'isOwnedByPlayer',
    ]);
  });

  it('is callable outside a component setup', () => {
    expect(() => useGameViewHelpers()).not.toThrow();
  });

  it('works destructured', () => {
    const { findElementById: byId } = useGameViewHelpers();
    expect(byId(GAME, 52)).toBe(PAWN);
  });
});

describe('the helpers as a whole', () => {
  it('never mutate the view they read', () => {
    const before = JSON.stringify(GAME);
    findElementById(GAME, 52);
    findElements(GAME, { className: 'Card' });
    findAllByAttribute(GAME, 'rank', 'A');
    getCards(HAND_ONE);
    getPlayerAttribute(GAME, 1, 'score', 0);
    expect(JSON.stringify(GAME)).toBe(before);
  });

  it('all tolerate a null element', () => {
    expect(() => {
      findElementById(null, 1);
      findElement(null, { className: 'x' });
      findElements(null, { className: 'x' });
      findChildByAttribute(null, 'a', 1);
      findElementByAttribute(null, 'a', 1);
      findAllByAttribute(null, 'a', 1);
      getElementId(null);
      findPlayerHand(null, 1);
      findPlayerElement(null, 1);
      getPlayerAttribute(null, 1, 'a', 0);
      findAllHands(null);
      getElementCount(null);
      getCards(null);
      getFirstCard(null);
      getCardData(null);
      getElementOwner(null);
      isOwnedByPlayer(null, 1);
      isMyElement(null, 1);
      isOpponentElement(null, 1);
    }).not.toThrow();
  });

  it('tolerate an element with no attributes object at all', () => {
    const bare = { id: 5, className: 'Bare', name: 'bare' } as unknown as GameElement;
    expect(getElementOwner(bare)).toBeUndefined();
    expect(getCardData(bare)).toBeUndefined();
    expect(findElement(bare, { type: 'anything' })).toBeUndefined();
    expect(getElementCount(bare)).toBe(0);
  });
});
