// @vitest-environment jsdom
/**
 * Flying a card to a player's stat in the panel: finding the target the game's
 * `#player-stats` slot marked up, and building the fly configs for it. The
 * missing-target path matters most — a custom UI that forgot the data
 * attributes must be told so, not silently animate nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getPlayerStatElement,
  flyToPlayerStat,
  usePlayerStatAnimation,
  type CardForAnimation,
} from './usePlayerStatAnimation.js';
import type { FlyConfig } from './useFlyingElements.js';

const rect = (left = 0, top = 0): DOMRect => ({
  left, top, right: left + 10, bottom: top + 10, width: 10, height: 10, x: left, y: top,
  toJSON: () => ({}),
} as DOMRect);

function statTarget(seat: number, stat: string): HTMLElement {
  const element = document.createElement('span');
  element.setAttribute('data-player-stat', stat);
  element.setAttribute('data-player-seat', String(seat));
  document.body.appendChild(element);
  return element;
}

const card = (overrides: Partial<CardForAnimation> = {}): CardForAnimation => ({
  rect: rect(), rank: 'A', suit: 'H', ...overrides,
});

let flown: Array<{ configs: FlyConfig[]; stagger?: number }>;
const flyMultiple = (configs: FlyConfig[], stagger?: number) => {
  flown.push({ configs, stagger });
  return Promise.resolve();
};

beforeEach(() => {
  flown = [];
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('getPlayerStatElement', () => {
  it('finds the element a game marked up for that seat and stat', () => {
    const target = statTarget(1, 'books');
    expect(getPlayerStatElement(1, 'books')).toBe(target);
  });

  it('distinguishes seats', () => {
    statTarget(1, 'score');
    const second = statTarget(2, 'score');
    expect(getPlayerStatElement(2, 'score')).toBe(second);
  });

  it('distinguishes stats', () => {
    statTarget(1, 'score');
    const books = statTarget(1, 'books');
    expect(getPlayerStatElement(1, 'books')).toBe(books);
  });

  it('returns null when the stat was never marked up', () => {
    statTarget(1, 'score');
    expect(getPlayerStatElement(1, 'books')).toBeNull();
    expect(getPlayerStatElement(9, 'score')).toBeNull();
  });

  it('returns null on an empty document', () => {
    expect(getPlayerStatElement(1, 'score')).toBeNull();
  });
});

describe('flyToPlayerStat', () => {
  it('starts the animation and reports success', () => {
    statTarget(1, 'books');
    expect(flyToPlayerStat(flyMultiple, { cards: [card()], playerSeat: 1, statName: 'books' }))
      .toBe(true);
    expect(flown).toHaveLength(1);
  });

  it('builds one fly config per card', () => {
    statTarget(1, 'books');
    flyToPlayerStat(flyMultiple, {
      cards: [card(), card(), card()], playerSeat: 1, statName: 'books',
    });
    expect(flown[0].configs).toHaveLength(3);
  });

  it('gives each card a distinct animation id', () => {
    statTarget(1, 'books');
    flyToPlayerStat(flyMultiple, { cards: [card(), card()], playerSeat: 1, statName: 'books' });
    const ids = flown[0].configs.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('flies from where the card is now', () => {
    statTarget(1, 'books');
    const start = rect(42, 24);
    flyToPlayerStat(flyMultiple, { cards: [card({ rect: start })], playerSeat: 1, statName: 'books' });
    expect(flown[0].configs[0].startRect).toBe(start);
  });

  it('resolves the destination lazily, so a moving panel still lands right', () => {
    const target = statTarget(1, 'books');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect(300, 200));
    flyToPlayerStat(flyMultiple, { cards: [card()], playerSeat: 1, statName: 'books' });
    const endRect = flown[0].configs[0].endRect as () => DOMRect;
    expect(endRect).toBeTypeOf('function');
    expect(endRect().left).toBe(300);
  });

  it('carries the card face data through to the flying element', () => {
    statTarget(1, 'books');
    flyToPlayerStat(flyMultiple, {
      cards: [card({ rank: 'K', suit: 'S', faceUp: false, faceImage: '/k.png' })],
      playerSeat: 1,
      statName: 'books',
    });
    expect(flown[0].configs[0].elementData).toMatchObject({
      rank: 'K', suit: 'S', faceUp: false, faceImage: '/k.png',
    });
  });

  it('defaults rank/suit to empty and the card to face up', () => {
    statTarget(1, 'books');
    flyToPlayerStat(flyMultiple, {
      cards: [{ rect: rect() }], playerSeat: 1, statName: 'books',
    });
    expect(flown[0].configs[0].elementData).toMatchObject({ rank: '', suit: '', faceUp: true });
  });

  it('passes custom properties through, so a piece keeps its owner', () => {
    statTarget(1, 'captures');
    flyToPlayerStat(flyMultiple, {
      cards: [card({ playerSeat: 2, isKing: true })],
      playerSeat: 1,
      statName: 'captures',
    });
    expect(flown[0].configs[0].elementData).toMatchObject({ playerSeat: 2, isKing: true });
  });

  it('never leaks the source rect into the element data', () => {
    statTarget(1, 'books');
    flyToPlayerStat(flyMultiple, { cards: [card()], playerSeat: 1, statName: 'books' });
    expect(flown[0].configs[0].elementData).not.toHaveProperty('rect');
  });

  it('uses a 500ms flight, 50ms stagger and 70x100 card by default', () => {
    statTarget(1, 'books');
    flyToPlayerStat(flyMultiple, { cards: [card()], playerSeat: 1, statName: 'books' });
    expect(flown[0].configs[0]).toMatchObject({
      duration: 500, flip: false, elementSize: { width: 70, height: 100 },
    });
    expect(flown[0].stagger).toBe(50);
  });

  it('honours custom duration, stagger, size and flip', () => {
    statTarget(1, 'books');
    flyToPlayerStat(flyMultiple, {
      cards: [card()],
      playerSeat: 1,
      statName: 'books',
      duration: 200,
      stagger: 10,
      cardSize: { width: 30, height: 40 },
      flip: true,
    });
    expect(flown[0].configs[0]).toMatchObject({
      duration: 200, flip: true, elementSize: { width: 30, height: 40 },
    });
    expect(flown[0].stagger).toBe(10);
  });

  it('does nothing and reports false when there are no cards', () => {
    statTarget(1, 'books');
    expect(flyToPlayerStat(flyMultiple, { cards: [], playerSeat: 1, statName: 'books' }))
      .toBe(false);
    expect(flown).toHaveLength(0);
  });

  it('reports false and explains the missing markup when the target is absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(flyToPlayerStat(flyMultiple, { cards: [card()], playerSeat: 1, statName: 'books' }))
      .toBe(false);
    expect(flown).toHaveLength(0);
    expect(warn.mock.calls[0][0]).toContain('data-player-stat="books"');
    expect(warn.mock.calls[0][0]).toContain('data-player-seat="1"');
  });

  it('stays quiet about a missing target when asked to', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(flyToPlayerStat(flyMultiple, {
      cards: [card()], playerSeat: 1, statName: 'books', warnIfMissing: false,
    })).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn for an empty card list — there was nothing to fly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    flyToPlayerStat(flyMultiple, { cards: [], playerSeat: 1, statName: 'books' });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('usePlayerStatAnimation', () => {
  it('exposes the module functions themselves', () => {
    const animation = usePlayerStatAnimation();
    expect(animation.getPlayerStatElement).toBe(getPlayerStatElement);
    expect(animation.flyToPlayerStat).toBe(flyToPlayerStat);
  });

  it('exposes exactly those two helpers', () => {
    expect(Object.keys(usePlayerStatAnimation()).sort())
      .toEqual(['flyToPlayerStat', 'getPlayerStatElement']);
  });

  it('is callable outside a component setup', () => {
    expect(() => usePlayerStatAnimation()).not.toThrow();
  });
});
