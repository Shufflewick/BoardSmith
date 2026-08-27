import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, Card, Space, type GameOptions, type ElementJSON } from '../index.js';
import { RedactedAttributeError } from '../errors.js';

// #147: a HIDDEN ELEMENT must not restore with its class-field defaults.
//
// #19 closed the attribute case (`static visibleAttributes`): an attribute a
// seat was not told restores as an accessor that throws. The ELEMENT case was
// left open. `toJSONForPlayer` replaces an element the seat cannot see with a
// placeholder carrying `__hidden: true` and nothing but safe layout keys — no
// rank, no suit, no name. `GameElement.fromJSON` then constructs a fresh
// instance and assigns only the keys the JSON carries, so every withheld
// attribute came back as whatever the class field was initialized to. In real
// go-fish that reads as `rank undefined, suit undefined, redactedAttributes []`:
// ordinary known keys, indistinguishable from a card whose rank nobody set.
//
// The distinction has to survive AT THE ATTRIBUTE LEVEL, not by exempting the
// element: a placeholder still carries facts the seat genuinely holds (its
// `$type`, its `__hidden` state, its position in a visible parent), and those
// must stay known and unforgeable.

class PlayingCard extends Card<TestGame> {
  static override visibleAttributes = ['rank'];
  rank!: string;
  suit!: string;
  /** A real value in the authoritative game: `0` is a legal wager. */
  wager = 0;
}

class Hand extends Space<TestGame> {}
class Table extends Space<TestGame> {}

class TestGame extends Game<TestGame, Player> {
  hands: Hand[] = [];
  table!: Table;
  faceDown!: PlayingCard;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([PlayingCard, Hand, Table]);

    for (const player of this.players) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      const card = hand.create(PlayingCard, `card-${player.seat}`, {
        rank: `R${player.seat}`,
        suit: 'H',
        wager: player.seat * 3,
      });
      card.faceUp = false;
      this.hands.push(hand);
    }

    // A single, individually hidden element in an otherwise visible parent —
    // the other placeholder path (`showOnlyTo`), which keeps its real id.
    this.table = this.create(Table, 'table');
    this.faceDown = this.table.create(PlayingCard, 'faceDown', {
      rank: 'K',
      suit: 'S',
      wager: 7,
    });
    this.faceDown.showOnlyTo(2);
  }
}

/** Restore a fresh game from seat `seat`'s redacted view of `game`. */
function restoreForSeat(game: TestGame, seat: number | null): TestGame {
  const restored = new TestGame({ playerCount: 2 });
  restored.loadSerializedState(game.toJSONForPlayer(seat) as ReturnType<Game['toJSON']>);
  return restored;
}

/** The one card inside seat `seat`'s hand, as restored. */
function handCard(game: TestGame, seat: number): PlayingCard {
  const hand = game.first(Hand, `hand-${seat}`)!;
  return hand.first(PlayingCard)!;
}

function findById(json: ElementJSON, id: number): ElementJSON | undefined {
  if (json.id === id) return json;
  for (const child of json.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

describe('#147: a hidden element restores as unknown, not as its class defaults', () => {
  let game: TestGame;

  beforeEach(() => {
    game = new TestGame({ playerCount: 2 });
  });

  it('withholds every attribute of an opponent-owned zone child', () => {
    const opponentCard = handCard(restoreForSeat(game, 1), 2);

    expect(opponentCard.isAttributeRedacted('rank')).toBe(true);
    expect(opponentCard.isAttributeRedacted('suit')).toBe(true);
    expect(opponentCard.isAttributeRedacted('wager')).toBe(true);
    expect(() => opponentCard.rank).toThrow(RedactedAttributeError);
    expect(() => opponentCard.suit).toThrow(RedactedAttributeError);
    expect(() => opponentCard.wager).toThrow(RedactedAttributeError);
  });

  it('withholds every attribute of an individually hidden element', () => {
    const restored = restoreForSeat(game, 1);
    const hidden = restored.first(Table, 'table')!.first(PlayingCard)!;

    expect([...hidden.redactedAttributes].sort()).toEqual(['faceUp', 'rank', 'suit', 'wager']);
    expect(() => hidden.rank).toThrow(RedactedAttributeError);
  });

  it('says the element was hidden, not that a whitelist withheld the attribute', () => {
    let message = '';
    try {
      void handCard(restoreForSeat(game, 1), 2).rank;
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('rank');
    expect(message).toContain('PlayingCard');
    expect(message).toContain('hidden');
    expect(message).toContain('isAttributeRedacted');
  });

  it('keeps what the placeholder genuinely carries known and unredacted', () => {
    const opponentCard = handCard(restoreForSeat(game, 1), 2);

    // `__hidden` rode on the wire, so this copy really does know it — and it is
    // what tells a sampler the element is a placeholder in the first place.
    expect((opponentCard as unknown as Record<string, unknown>).__hidden).toBe(true);
    expect(opponentCard.isAttributeRedacted('__hidden')).toBe(false);
    // Structure is never withheld: taking the tree apart withholds no secret.
    expect(opponentCard.parent?.name).toBe('hand-2');
    expect(opponentCard.isAttributeRedacted('name')).toBe(false);
  });

  it('does not touch the owner\'s own cards, nor a fully visible view', () => {
    const own = handCard(restoreForSeat(game, 1), 1);
    expect(own.rank).toBe('R1');
    expect(own.wager).toBe(3);
    expect(own.redactedAttributes).toEqual([]);

    // The authoritative game itself is never redacted.
    expect(handCard(game, 2).rank).toBe('R2');
    expect(handCard(game, 2).isAttributeRedacted('rank')).toBe(false);
  });

  it('withholds from a spectator too', () => {
    const spectatorCard = handCard(restoreForSeat(game, null), 1);
    expect(() => spectatorCard.rank).toThrow(RedactedAttributeError);
  });

  it('survives re-serialization of the already-redacted clone', () => {
    const once = restoreForSeat(game, 1);
    const twice = new TestGame({ playerCount: 2 });
    twice.loadSerializedState(once.toJSON());

    const card = handCard(twice, 2);
    expect(card.isAttributeRedacted('rank')).toBe(true);
    expect(() => card.rank).toThrow(RedactedAttributeError);
  });

  it('never puts a withheld value on the wire when the clone re-serializes', () => {
    const once = restoreForSeat(game, 1);
    const card = handCard(once, 2);
    const json = findById(once.toJSON(), card.id)!;

    expect(json.attributes.rank).toBeUndefined();
    expect(json.attributes.wager).toBeUndefined();
    expect(json.attributes.__hidden).toBe(true);
  });

  it('lets a determinization sampler supply a value, which then reads back', () => {
    const restored = restoreForSeat(game, 1);
    const card = handCard(restored, 2);

    card.rank = 'Q';
    expect(card.rank).toBe('Q');
    expect(card.isAttributeRedacted('rank')).toBe(false);
    expect(card.redactedAttributes).not.toContain('rank');
    // A supplied value is an ordinary attribute again: it serializes.
    expect(findById(restored.toJSON(), card.id)!.attributes.rank).toBe('Q');
  });
});
