/**
 * Elements in `animate()`/`animateTo()` data reach each seat as references,
 * never as the element itself (#752).
 *
 * The buffer used to ship `data` as given, so an element in it was written by
 * its own `toJSON()` (name, attributes, real id) into every seat's payload:
 * one natural line, `animate('drew', { card })`, defeated a hidden hand.
 */
import { describe, it, expect } from 'vitest';
import { Game, Card, Hand, Player, type ElementJSON, type GameOptions } from '../index.js';

class DrawGame extends Game<DrawGame, Player> {
  hand!: Hand;
  constructor(options: GameOptions) {
    super(options);
    this.hand = this.create(Hand, 'hand-p1');
    this.hand.player = this.getPlayer(1)!;
    this.hand.contentsVisibleToOwner();
    this.hand.create(Card, 'Two of Clubs');
    this.hand.create(Card, 'Ace of Spades');
  }
}

const makeGame = () => new DrawGame({ playerCount: 2, seed: 'bs752', elementIdKey: '0000000000000752' });

type SeatEvent = { type: string; data: Record<string, unknown> };

function seatView(game: DrawGame, seat: number | null) {
  return game.toJSONForPlayer(seat) as ElementJSON & { animationEvents?: SeatEvent[] };
}

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
  ])('does not give %s the name or real id of a card in seat 1\'s hidden hand', (_label, seat) => {
    const game = makeGame();
    game.animate('drew', { card: drawn(game) });

    const view = seatView(game, seat);
    const [event] = view.animationEvents!;
    expect(JSON.stringify(view)).not.toContain('Ace of Spades');
    expect(JSON.stringify(event.data)).not.toContain(String(drawn(game).id));
    // The reference names the placeholder this seat's board shows.
    const target = atBranchInView(view, event.data.card)!;
    expect(target.attributes.__hidden).toBe(true);
    expect(target.id).toBeLessThan(0);
  });

  it('gives the owner a reference to the real card in its own view', () => {
    const game = makeGame();
    game.animate('drew', { card: drawn(game) });

    const view = seatView(game, 1);
    const target = atBranchInView(view, view.animationEvents![0].data.card)!;
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
    const [event] = seatView(game, 2).animationEvents!;
    expect(event.data.player).toEqual({ __playerRef: 1, seat: 1, color: game.getPlayer(1)!.color, name: 'Player 1' });
  });

  it('refers to the element where it is when the view is built, not where it was at animate()', () => {
    const game = makeGame();
    const card = drawn(game);
    game.animate('drew', { card });
    card.putInto(game.hand, { position: 'first' });

    const target = atBranchInView(seatView(game, 1), seatView(game, 1).animationEvents![0].data.card)!;
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
