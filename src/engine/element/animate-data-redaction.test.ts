/**
 * Elements in `animate()`/`animateTo()` data reach each seat as references,
 * never as the element itself (#752).
 *
 * The buffer used to ship `data` as given, so an element in it was written by
 * its own `toJSON()` (name, attributes, real id) into every seat's payload:
 * one natural line, `animate('drew', { card })`, defeated a hidden hand. A
 * reference to an element the seat cannot see names the outermost container
 * that conceals it, so it gives away no place inside it either.
 */
import { describe, it, expect } from 'vitest';
import { Game, Card, Deck, Hand, Space, Player, type ElementJSON, type GameOptions } from '../index.js';

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
  }
}

const makeGame = () => new DrawGame({ playerCount: 2, seed: 'bs752', elementIdKey: '0000000000000752' });

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
