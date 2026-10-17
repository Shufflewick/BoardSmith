// @vitest-environment jsdom
/**
 * `assertNoHiddenInfoLeak` on elements in `game.pile` (#1063).
 *
 * The pile sits outside the element tree, so `game.all(GameElement)` never
 * reached it and a removed card never became a marker, while the seat view
 * hides the pile from every seat (#655). A board painting a piled card passed.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { Game, Player, Card, Action, actionStep, type GameOptions } from '../engine/index.js';
import { TestGame } from './test-game.js';
import { assertNoHiddenInfoLeak, preloadSeatRenderer } from './dom-leak.js';

// #354: load the renderer's module graph while the file is collected.
await preloadSeatRenderer();

class PileGame extends Game<PileGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.create(Card, 'BURIEDCARDXYZ').remove();
    this.registerAction(Action.create<PileGame>('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'] }) });
  }
}

const board = defineComponent({
  name: 'PileBoard',
  setup: () => () => h('div', { class: 'board', 'data-card': 'BURIEDCARDXYZ' }),
});

describe('assertNoHiddenInfoLeak — elements in the pile (#1063)', () => {
  it('catches a piled card the seat cannot see, rendered anyway', async () => {
    const tg = TestGame.create(PileGame, { playerCount: 2, seed: 'pile-leak' });
    expect(tg.game.pile.all(Card).map((c) => c.name)).toEqual(['BURIEDCARDXYZ']);
    expect(JSON.stringify(tg.getPlayerView(1).state)).not.toContain('BURIEDCARDXYZ');

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board })).rejects.toThrow(/BURIEDCARDXYZ/);
  });
});
