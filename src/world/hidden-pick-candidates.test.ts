/**
 * A world offers a candidate the seat cannot see by the placeholder id its view
 * carries, under a neutral label, and a submitted placeholder names the real
 * element (#715) -- the same rule the session follows.
 */
import { describe, it, expect } from 'vitest';
import { Card, Game, Space, type GameOptions } from '../engine/index.js';
import type { ElementJSON } from '../engine/element/types.js';
import { createTestWorld } from '../testing/test-world.js';
import { worldAction, type WorldDefinition } from './index.js';

class Pouch extends Space<PouchWorld> {}
class Commons extends Space<PouchWorld> {}

class PouchWorld extends Game<PouchWorld> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Pouch, Commons, Card]);
  }
}

const filch = worldAction<PouchWorld>('filch').chooseElement('card', {
  needs: () => ['commons'],
  elements: ({ game }) => game.first(Pouch)!.all(Card),
}).execute(({ card }) => {
  card.putInto(card.game.first(Commons)!);
});

const grab = worldAction<PouchWorld>('grab').chooseFrom('card', {
  needs: () => ['commons'],
  choices: ({ game }) => game.first(Pouch)!.all(Card),
}).execute(({ card }) => {
  (card as Card).putInto((card as Card).game.first(Commons)!);
});

const world: WorldDefinition = {
  maxPlayers: 2,
  actions: [filch, grab],
  view: () => ['commons'],
  genesis: (game: Game) => {
    const commons = game.create(Commons, 'commons');
    const pouch = commons.create(Pouch, 'pouch');
    pouch.contentsCountOnly();
    pouch.create(Card, 'AS');
    pouch.create(Card, 'KH');
    return { commons };
  },
} as WorldDefinition;

function find(node: ElementJSON, name: string): ElementJSON | undefined {
  if (node.name === name) return node;
  for (const child of node.children ?? []) {
    const found = find(child, name);
    if (found) return found;
  }
  return undefined;
}

async function started() {
  return createTestWorld({ definition: { gameClass: PouchWorld, world } });
}

describe("a world's pick candidates the seat cannot see (#715)", () => {
  it('offers them by the placeholder ids the seat sees, and a placeholder takes the real card', async () => {
    const test = await started();
    const view = await test.getPlayerView(1);
    const shown = find(view.state as ElementJSON, 'pouch')!.children!.map((c) => c.id);
    expect(shown).toEqual([-1, -2]);

    const pick = await test.resolvePick(1, 'filch', 'card', {});
    expect(pick.validElements?.map((e) => [e.id, e.display])).toEqual([[-1, 'Card #1'], [-2, 'Card #2']]);

    await test.take(1, 'filch', { card: -2 });
    const after = await test.getPlayerView(1);
    const commons = find(after.state as ElementJSON, 'commons')!;
    expect(commons.children!.map((c) => c.name)).toContain('KH');
    await test.close();
  });

  it('offers a chooseFrom element the same way, and takes it by its placeholder', async () => {
    const test = await started();

    const pick = await test.resolvePick(1, 'grab', 'card', {});
    expect(JSON.parse(JSON.stringify(pick.choices))).toEqual([
      { value: { id: -1, className: 'Card' }, display: 'Card #1' },
      { value: { id: -2, className: 'Card' }, display: 'Card #2' },
    ]);

    await test.take(1, 'grab', { card: { id: -2, className: 'Card' } });
    const after = await test.getPlayerView(1);
    expect(find(after.state as ElementJSON, 'commons')!.children!.map((c) => c.name)).toContain('KH');
    await test.close();
  });
});
