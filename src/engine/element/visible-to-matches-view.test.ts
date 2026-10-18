/**
 * `isVisibleTo(seat)` says exactly what the seat's view carries (#1062): an
 * element below something hidden from the seat is never sent, so it is not
 * visible to that seat, whatever its own visibility says.
 */
import { describe, it, expect, vi } from 'vitest';
import { outermostConcealer } from './concealed-refs.js';
import { Game, Piece, Player, Space, type ElementJSON, GameElement, type GameOptions } from '../index.js';
import { isHiddenPlaceholder } from './hidden-placeholder.js';

class Card extends Piece<TestGame> {}
class Box extends Space<TestGame> {}
class TestGame extends Game<TestGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Box]);
  }
}

const SEATS = [1, 2, null] as const;

/** Whether `seat`'s view (null: spectator) carries `element` under its real id, unhidden. */
function revealedIn(game: TestGame, seat: number | null, element: GameElement): boolean {
  const find = (node: ElementJSON): ElementJSON | undefined =>
    node.id === element.id ? node : node.children?.map(find).find((n) => n !== undefined);
  const node = find(game.toJSONForPlayer(seat));
  return node !== undefined && !isHiddenPlaceholder(node) && node.name === element.name;
}

type Own = 'none' | 'hideFromAll' | 'showToAll';
type Zone = 'none' | 'contentsHidden' | 'contentsCountOnly';

function applyOwn(element: GameElement, own: Own): void {
  if (own !== 'none') element[own]();
}

describe('isVisibleTo matches the seat view (#1062)', () => {
  it('a child of a hideFromAll() card is not visible to a seat that is never sent it', () => {
    const game = new TestGame({ playerCount: 2 });
    const table = game.create(Space, 'table');
    const covered = table.create(Card, 'covered');
    covered.hideFromAll();
    const under = covered.create(Card, 'under');

    expect(revealedIn(game, 1, under)).toBe(false);
    expect(under.isVisibleTo(1)).toBe(false);
  });

  it('a showToAll() card in a contentsHidden() zone is visible, as the seat is sent it (#758)', () => {
    const game = new TestGame({ playerCount: 2 });
    const vault = game.create(Space, 'vault');
    vault.contentsHidden();
    const shown = vault.create(Card, 'shown');
    shown.showToAll();

    expect(revealedIn(game, 1, shown)).toBe(true);
    expect(shown.isVisibleTo(1)).toBe(true);
  });

  const owns: Own[] = ['none', 'hideFromAll', 'showToAll'];
  const levels = owns.flatMap((own) => (['none', 'contentsHidden', 'contentsCountOnly'] as Zone[]).map((zone) => ({ own, zone })));
  const cases = levels.flatMap((outer) =>
    levels.flatMap((middle) => levels.flatMap((inner) => owns.map((leaf) => ({ boxes: [outer, middle, inner], leaf })))),
  );

  /** Three nested boxes holding a card, each given its own and zone visibility. */
  function build({ boxes, leaf }: (typeof cases)[number]): { game: TestGame; elements: GameElement[] } {
    const game = new TestGame({ playerCount: 2 });
    const elements: GameElement[] = [];
    let parent: Game | Box = game;
    for (const [i, level] of boxes.entries()) {
      const box: Box = parent.create(Box, `box${i}`);
      applyOwn(box, level.own);
      if (level.zone !== 'none') box[level.zone]();
      elements.push(box);
      parent = box;
    }
    const card = parent.create(Card, 'card');
    applyOwn(card, leaf);
    return { game, elements: [...elements, card] };
  }

  it('agrees for every seat across hideFromAll, contentsHidden, contentsCountOnly and showToAll, three spaces deep', () => {
    for (const c of cases) {
      const { game, elements } = build(c);
      for (const element of elements) {
        for (const seat of SEATS) {
          expect(element.isVisibleTo(seat ?? -1), `${element.name} seat ${seat} ${JSON.stringify(c)}`).toBe(
            revealedIn(game, seat, element),
          );
        }
      }
    }
  });
});

describe("a seat view checks each element's own visibility once (#1123)", () => {
  /** Ten nested boxes holding a card. */
  function deepTree(): { game: TestGame; card: Card } {
    const game = new TestGame({ playerCount: 2 });
    let parent: Game | Box = game;
    for (let depth = 0; depth < 10; depth++) parent = parent.create(Box, `box${depth}`);
    return { game, card: parent.create(Card, 'card') };
  }

  it("building one seat's view of a deep tree reads each element's visibility a fixed number of times, whatever its depth", () => {
    const { game } = deepTree();
    const rule = vi.spyOn(GameElement.prototype, 'getEffectiveVisibility');
    try {
      game.toJSONForPlayer(1);
      // The game, its two players, the ten boxes and the card: twice each, once
      // for the view's own read and once for the visibility rule.
      expect(new Set(rule.mock.contexts).size).toBe(14);
      expect(rule).toHaveBeenCalledTimes(28);
    } finally {
      rule.mockRestore();
    }
  });

  it("finding what conceals a deep element reads each ancestor's visibility once", () => {
    const { card } = deepTree();
    const rule = vi.spyOn(GameElement.prototype, 'getEffectiveVisibility');
    try {
      expect(outermostConcealer(card, 1)).toBeUndefined();
      // The game root and the ten boxes, once each.
      expect(rule).toHaveBeenCalledTimes(11);
    } finally {
      rule.mockRestore();
    }
  });
});
