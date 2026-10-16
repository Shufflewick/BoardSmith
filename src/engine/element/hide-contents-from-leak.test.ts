/**
 * #750: a seat named in a zone's `hideContentsFrom` must not see what is in it.
 *
 * A zone in mode 'all' with `exceptPlayers` used to fall through to normal
 * child serialization, so the denied seat got every child's real id in the
 * zone's true order: a shuffled deck's order, read straight off the view.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space, Piece, type GameOptions } from '../index.js';
import { placeholderIdsFor } from './seat-placeholders.js';

class Card extends Piece<DeckGame> {}
class Zone extends Space<DeckGame> {}

class DeckGame extends Game<DeckGame, Player> {
  table!: Zone;
  deck!: Zone;
  constructor(options: GameOptions) {
    super(options);
    this.table = this.create(Zone, 'table');
    this.deck = this.create(Zone, 'deck');
    for (const name of ['A', 'B', 'C', 'D', 'E']) this.table.create(Card, name);
  }
}

type Node = { id: number; name?: string; children?: Node[] };

function zoneIn(game: DeckGame, seat: number, zone: string): Node {
  const view = game.toJSONForPlayer(seat) as Node;
  return view.children!.find((c) => c.name === zone)!;
}

/** Five cards seat 2 has seen, moved into a deck hidden from seat 2 and shuffled. */
function shuffledDeck(): { game: DeckGame; realIds: number[] } {
  const game = new DeckGame({ playerCount: 2, seed: 'bs750' });
  game.deck.hideContentsFrom(2);
  for (const card of game.table.all(Card)) card.putInto(game.deck);
  game.deck.shuffle();
  return { game, realIds: game.deck.all(Card).map((c) => c.id) };
}

describe('hideContentsFrom conceals the zone from the denied seat (#750)', () => {
  it("gives the denied seat no real id, name or order of a shuffled deck's cards", () => {
    const { game, realIds } = shuffledDeck();
    const children = zoneIn(game, 2, 'deck').children ?? [];
    const allReal = new Set(game.all(Card).map((c) => c.id));
    expect(children.some((c) => allReal.has(c.id)), 'no real card id reaches seat 2').toBe(false);
    expect(children.some((c) => c.name !== undefined), 'no card name reaches seat 2').toBe(false);
    // The seat that may look still sees the true order.
    expect((zoneIn(game, 1, 'deck').children ?? []).map((c) => c.id)).toEqual(realIds);
  });

  it("offers the denied seat's hidden cards by the placeholder ids its board shows (#715)", () => {
    const { game, realIds } = shuffledDeck();
    const placeholders = placeholderIdsFor(game, 2);
    const boardIds = (zoneIn(game, 2, 'deck').children ?? []).map((c) => c.id);
    expect(realIds.map((id) => placeholders.get(id))).toEqual(boardIds);
  });

  it('conceals an owner zone from its own owner when the owner is denied', () => {
    const game = new DeckGame({ playerCount: 2, seed: 'bs750' });
    game.table.player = game.getPlayer(2)!;
    game.table.contentsVisibleToOwner();
    game.table.hideContentsFrom(2);
    const allReal = new Set(game.all(Card).map((c) => c.id));
    const children = zoneIn(game, 2, 'table').children ?? [];
    expect(children.some((c) => allReal.has(c.id))).toBe(false);
  });
});
