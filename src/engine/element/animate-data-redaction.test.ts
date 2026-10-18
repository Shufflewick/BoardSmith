/**
 * Elements in `animate()`/`animateTo()` data reach each seat as references,
 * never as the element itself (#752).
 *
 * The buffer used to ship `data` as given, so an element in it was written by
 * its own `toJSON()` (name, attributes, real id) into every seat's payload:
 * one natural line, `animate('drew', { card })`, defeated a hidden hand. A
 * reference to an element the seat cannot see names the outermost container
 * that conceals it, so it gives away no place inside it either. The same rule
 * holds for every reference a seat receives, in attributes, settings and
 * message data, in table and world views alike (#1043).
 */
import { describe, it, expect } from 'vitest';
import { Game, Card, Deck, Hand, Piece, Space, Player, type ElementJSON, type GameOptions, type GameElement } from '../index.js';

import { WITHHELD_PILE_BRANCH } from './game-element.js';

class Marker extends Piece<DrawGame> {
  target?: GameElement;
}

/** Derives, for each seat, a reference to the last card in seat 1's hand. */
class Lens extends Piece<DrawGame> {
  static seatAttributes = { focus: (lens: Lens) => lens.game.hand.last(Card) };
}

class DrawGame extends Game<DrawGame, Player> {
  hand!: Hand;
  deck!: Deck;
  vault!: Space;
  discard!: Space;
  constructor(options: GameOptions) {
    super(options);
    this.hand = this.create(Hand, 'hand-p1');
    this.hand.player = this.getPlayer(1)!;
    this.hand.contentsVisibleToOwner();
    this.hand.create(Card, 'Two of Clubs');
    this.hand.create(Card, 'Ace of Spades');
    this.deck = this.create(Deck, 'deck');
    for (let i = 0; i < 6; i++) this.deck.create(Card, `deck-${i}`);
    this.vault = this.create(Space, 'vault');
    this.vault.contentsHidden();
    this.vault.create(Card, 'vault-0');
    this.vault.create(Space, 'casket').create(Card, 'Crown');
    this.vault.create(Card, 'vault-2');
    this.discard = this.create(Space, 'discard');
    this.discard.create(Card, 'Seven of Hearts');
    this.discard.create(Marker, 'marker');
  }
}

const makeGame = (worldMode = false) =>
  new DrawGame({
    playerCount: 2,
    seed: 'bs752',
    ...(worldMode ? { worldMode, elementIdKey: '000000000000000000001043' } : { elementIdKey: '0000000000000752' }),
  });

type SeatEvent = { type: string; data: Record<string, unknown> };

function seatView(game: DrawGame, seat: number | null) {
  return game.toJSONForPlayer(seat) as ElementJSON & { animationEvents?: SeatEvent[] };
}

/** The data of the one event in a seat's payload. */
const seatData = (game: DrawGame, seat: number | null) => seatView(game, seat).animationEvents![0].data;

/** The node a `{ __elementRef }` names in a seat's own view, walked by branch. */
function atBranchInView(view: ElementJSON, ref: unknown): ElementJSON | undefined {
  const branch = (ref as { __elementRef: string }).__elementRef;
  let node: ElementJSON | undefined = view;
  for (const index of branch.split('/').map(Number)) node = node?.children?.[index];
  return node;
}

describe('animate() data is redacted per seat (#752)', () => {
  const drawn = (game: DrawGame) => game.hand.first(Card, 'Ace of Spades')!;

  it.each([
    ['seat 2', 2],
    ['the spectator', null],
  ])('gives %s only the hand, not the name, real id or place of a card in seat 1\'s hidden hand', (_label, seat) => {
    const game = makeGame();
    game.animate('drew', { card: drawn(game) });

    expect(JSON.stringify(seatView(game, seat))).not.toContain('Ace of Spades');
    expect(seatData(game, seat).card).toEqual({ __elementRef: game.hand.branch() });
  });

  it('gives no seat the place of a card in a count-only deck shuffled after animate()', () => {
    const game = makeGame();
    const card = game.discard.first(Card)!;
    game.animate('returned', { card });
    card.putInto(game.deck);
    game.deck.shuffle();

    for (const seat of [1, 2, null]) expect(seatData(game, seat).card).toEqual({ __elementRef: game.deck.branch() });
  });

  it('gives no child index into a contentsHidden() zone, however deep the element sits', () => {
    const game = makeGame();
    game.animate('stolen', { first: game.vault.first(Card, 'vault-2')!, crown: game.vault.first(Card, 'Crown')! });

    expect(seatData(game, 2)).toEqual({
      first: { __elementRef: game.vault.branch() },
      crown: { __elementRef: game.vault.branch() },
    });
  });

  it('keeps the place of an element the seat can see', () => {
    const game = makeGame();
    const card = game.discard.first(Card)!;
    game.animate('flipped', { card });
    expect(seatData(game, 2).card).toEqual({ __elementRef: card.branch() });
  });

  it('gives the owner a reference to the real card in its own view', () => {
    const game = makeGame();
    game.animate('drew', { card: drawn(game) });

    const target = atBranchInView(seatView(game, 1), seatData(game, 1).card)!;
    expect(target.name).toBe('Ace of Spades');
    expect(target.id).toBe(drawn(game).id);
  });

  it('redacts animateTo() data the same way', () => {
    const game = makeGame();
    game.animateTo([1, 2], 'peek', { cards: [drawn(game)] });
    expect(JSON.stringify(seatView(game, 2))).not.toContain('Ace of Spades');
  });

  it('refers to a player by seat, without its attributes', () => {
    const game = makeGame();
    game.animate('score', { player: game.getPlayer(1)! });
    expect(seatData(game, 2).player).toEqual({ __playerRef: 1, seat: 1, color: game.getPlayer(1)!.color, name: 'Player 1' });
  });

  it('refers to the element where it is when the view is built, not where it was at animate()', () => {
    const game = makeGame();
    const card = drawn(game);
    game.animate('drew', { card });
    card.putInto(game.hand, { position: 'first' });

    const target = atBranchInView(seatView(game, 1), seatData(game, 1).card)!;
    expect(target.id).toBe(card.id);
  });

  it('refuses data it cannot save at animate(), naming the event', () => {
    const game = makeGame();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => game.animate('drew', { loop })).toThrow(/animation event "drew".*circular reference.*'data\.loop\.self'/);
    expect(game.pendingAnimationEvents).toEqual([]);
  });

  it('restores the reference to the live element', () => {
    const game = makeGame();
    game.animate('drew', { card: drawn(game) });

    const restored = makeGame();
    restored.loadSerializedState(game.toJSON());
    expect(restored.pendingAnimationEvents[0].data.card).toBe(drawn(restored));
  });
});

describe('every element reference a seat receives is redacted the same way (#1043)', () => {
  /** Each payload kind: put a reference to `target` in it, and read it back from one seat's payload. */
  const payloads: [string, (game: DrawGame, target: GameElement, seat: number | null) => unknown][] = [
    ['an element attribute', (game, target, seat) => {
      game.discard.first(Marker)!.target = target;
      const discard = seatView(game, seat).children!.find((node) => node.name === 'discard')!;
      return discard.children!.find((node) => node.name === 'marker')!.attributes!.target;
    }],
    ['a setting', (game, target, seat) => {
      game.settings.spotlight = target;
      return (seatView(game, seat) as unknown as { settings: Record<string, unknown> }).settings.spotlight;
    }],
    ['message data', (game, target, seat) => {
      game.message('{{card}} moved', { card: target });
      return game.serializeMessageLog(seat)[0].data!.card;
    }],
    ['animation data', (game, target, seat) => {
      game.animate('moved', { card: target });
      return seatData(game, seat).card;
    }],
  ];

  /** A hidden element, the seat that cannot see it, and the outermost container concealing it. */
  const hidden: [string, (game: DrawGame) => GameElement, number | null, (game: DrawGame) => GameElement][] = [
    ['a card in a count-only deck', (game) => game.deck.last(Card)!, 1, (game) => game.deck],
    ['a card nested in a contentsHidden() zone', (game) => game.vault.first(Card, 'Crown')!, 2, (game) => game.vault],
    ["a card in seat 1's owner-only hand", (game) => game.hand.last(Card)!, 2, (game) => game.hand],
    ["a card in seat 1's owner-only hand, for the spectator", (game) => game.hand.last(Card)!, null, (game) => game.hand],
  ];

  const ref = (game: DrawGame, element: GameElement) =>
    game.worldMode ? { __elementId: element.id } : { __elementRef: element.branch() };

  for (const [view, worldMode] of [['table', false], ['world', true]] as const) {
    describe(`${view} view`, () => {
      for (const [payload, read] of payloads) {
        it.each(hidden)(`names only the concealer of %s in ${payload}`, (_label, pick, seat, concealer) => {
          const game = makeGame(worldMode);
          expect(read(game, pick(game), seat)).toEqual(ref(game, concealer(game)));
        });

        it(`keeps the real reference in ${payload} for a seat that can see the element`, () => {
          const game = makeGame(worldMode);
          const target = game.hand.last(Card)!;
          expect(read(game, target, 1)).toEqual(ref(game, target));
        });
      }
    });
  }

  for (const [view, worldMode] of [['table', false], ['world', true]] as const) {
    it(`gives each seat its own reference in one toJSONForPlayers batch (${view})`, () => {
      const game = makeGame(worldMode);
      const card = game.hand.last(Card)!;
      game.settings.spotlight = card;
      const [owner, other] = game.toJSONForPlayers([1, 2]) as unknown as { settings: Record<string, unknown> }[];
      expect(owner.settings.spotlight).toEqual(ref(game, card));
      expect(other.settings.spotlight).toEqual(ref(game, game.hand));
    });

    it(`gives no seat the place or id of a removed element (${view})`, () => {
      const game = makeGame(worldMode);
      const card = game.hand.last(Card)!;
      card.remove();
      game.settings.last = card;
      for (const seat of [1, 2, null]) {
        const settings = (seatView(game, seat) as unknown as { settings: Record<string, unknown> }).settings;
        expect(settings.last).toEqual({ __elementRef: WITHHELD_PILE_BRANCH });
      }
    });

    it(`redacts a reference a seatAttributes derivation returns (${view})`, () => {
      const game = makeGame(worldMode);
      game.discard.create(Lens, 'lens');
      const focus = (seat: number) => {
        const discard = seatView(game, seat).children!.find((node) => node.name === 'discard')!;
        return discard.children!.find((node) => node.name === 'lens')!.attributes!.focus;
      };
      expect(focus(1)).toEqual(ref(game, game.hand.last(Card)!));
      expect(focus(2)).toEqual(ref(game, game.hand));
    });
  }

  it.each([1, 2, null])('withholds a world reference to an element in a partition not loaded here, from seat %s (#1166)', (seat) => {
    const game = makeGame(true);
    const card = game.hand.last(Card)!;
    game.discard.first(Marker)!.target = card;
    const discardJson = JSON.parse(JSON.stringify(game.discard.toJSON())) as ElementJSON;
    game.evictSubtree(game.hand.id);
    game.evictSubtree(game.discard.id);
    game.adoptSubtree(game.id, discardJson);

    const view = seatView(game, seat);
    const discard = view.children!.find((node) => node.name === 'discard')!;
    expect(discard.children!.find((node) => node.name === 'marker')!.attributes!.target).toEqual({ __elementRef: WITHHELD_PILE_BRANCH });
    expect(JSON.stringify(view)).not.toContain(`"__elementId":${card.id}`);
  });

  it('marks no world partition reached while building views', () => {
    const game = makeGame(true);
    for (const zone of [game.discard, game.vault, game.hand]) game.definePartition(zone.id);
    game.discard.first(Marker)!.target = game.vault.first(Card, 'Crown')!;
    game.settings.spotlight = game.hand.last(Card)!;
    game.animate('moved', { card: game.vault.first(Card, 'vault-0')! });
    game.takeTouchedPartitions();

    game.toJSONForPlayer(2);
    game.toJSONForPlayers([1, 2, null]);
    expect([...game._ctx._reachedPartitions!.partitions]).toEqual([]);
  });
});

describe('message text names a hidden element by its outermost concealer (#1165)', () => {
  const textFor = (game: DrawGame, seat: number | null) => game.getFormattedMessageEntries(seat)[0].text;

  for (const [view, worldMode] of [['table', false], ['world', true]] as const) {
    describe(`${view} mode`, () => {
      it.each([
        ['a card in a count-only deck', (game: DrawGame) => game.deck.last(Card)!, 1, 'deck'],
        ['a card nested in a contentsHidden() zone', (game: DrawGame) => game.vault.first(Card, 'Crown')!, 2, 'vault'],
        ["a card in seat 1's owner-only hand", (game: DrawGame) => game.hand.last(Card)!, 2, 'hand-p1'],
        ["a card in seat 1's owner-only hand, for the spectator", (game: DrawGame) => game.hand.last(Card)!, null, 'hand-p1'],
      ])('reads the concealer for %s', (_label, pick, seat, concealer) => {
        const game = makeGame(worldMode);
        game.message('{{player}} drew {{card}}', { player: game.getPlayer(1)!, card: pick(game) });
        expect(textFor(game, seat)).toBe(`Player 1 drew ${concealer}`);
      });

      it('reads the card for a seat that can see it', () => {
        const game = makeGame(worldMode);
        game.message('{{player}} drew {{card}}', { player: game.getPlayer(1)!, card: game.hand.last(Card)! });
        expect(textFor(game, 1)).toBe('Player 1 drew Ace of Spades');
      });

      it('reads each element of a list the same way', () => {
        const game = makeGame(worldMode);
        game.message('played {{cards}}', { cards: [game.hand.last(Card)!, game.discard.first(Card)!] });
        expect(textFor(game, 2)).toBe('played hand-p1,Seven of Hearts');
        expect(textFor(game, 1)).toBe('played Ace of Spades,Seven of Hearts');
      });

      it('reads the container for an element hidden by its own visibility', () => {
        const game = makeGame(worldMode);
        const card = game.discard.first(Card)!;
        card.showOnlyTo(1);
        game.message('{{card}} placed face down', { card });
        expect(textFor(game, 1)).toBe('Seven of Hearts placed face down');
        expect(textFor(game, 2)).toBe('discard placed face down');
        card.hideFromAll();
        game.message('{{card}} placed face down', { card });
        expect(game.getFormattedMessageEntries(1)[1].text).toBe('discard placed face down');
      });

      it('reads the nearest visible container when the concealer hides its own name, and the game at the top', () => {
        const game = makeGame(worldMode);
        const envelope = game.create(Space, 'Envelope: Colonel Mustard');
        envelope.hideFromAll();
        game.message('The solution was sealed: {{card}}', { card: envelope.create(Card, 'Rope') });
        expect(textFor(game, 2)).toBe(`The solution was sealed: ${String(game)}`);
      });

      it('keeps the text it was written with after the element moves', () => {
        const game = makeGame(worldMode);
        const drawn = game.hand.last(Card)!;
        const played = game.discard.first(Card)!;
        game.message('{{player}} drew {{card}}', { player: game.getPlayer(1)!, card: drawn });
        game.message('{{card}} played', { card: played });
        drawn.putInto(game.discard);
        played.putInto(game.deck);
        game.deck.shuffle();
        expect(game.getFormattedMessageEntries(2).map((m) => m.text)).toEqual(['Player 1 drew hand-p1', 'Seven of Hearts played']);
      });

      it("keeps each seat's text through a save and restore, and gives a seat's saved log only its own text", () => {
        const game = makeGame(worldMode);
        game.message('{{player}} drew {{card}}', { player: game.getPlayer(1)!, card: game.hand.last(Card)! });
        const restored = makeGame(worldMode);
        restored.loadSerializedState(restored.toJSON(), { messageLog: JSON.parse(JSON.stringify(game.serializeMessageLog())) });
        expect(textFor(restored, 1)).toBe('Player 1 drew Ace of Spades');
        expect(textFor(restored, 2)).toBe('Player 1 drew hand-p1');
        expect(JSON.stringify(game.serializeMessageLog(2))).not.toContain('Ace of Spades');
      });
    });
  }

  it('keeps the text it was written with after the element is evicted with its partition (world)', () => {
    const game = makeGame(true);
    const casket = game.vault.first(Space, 'casket')!;
    game.definePartition(casket.id);
    game.message('{{player}} hid {{card}}', { player: game.getPlayer(1)!, card: casket.first(Card, 'Crown')! });
    game.evictSubtree(casket.id);
    expect(textFor(game, 2)).toBe('Player 1 hid vault');
  });
});

it('refuses, by name, a saved log line with no text for the seat (#1165)', () => {
  const game = makeGame();
  game.loadSerializedState(game.toJSON(), { messageLog: [{ text: '{{card}} drew' } as never] });
  expect(() => game.getFormattedMessageEntries(2)).toThrow(/"\{\{card\}\} drew" has no text for seat 2.*Start a new game/);
  expect(() => game.serializeMessageLog(2)).toThrow(/has no text for seat 2/);
});
