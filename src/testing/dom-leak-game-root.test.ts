// @vitest-environment jsdom
/**
 * `assertNoHiddenInfoLeak` on secrets the Game root holds itself (#908).
 *
 * The unredacted side of the diff was `game.all(GameElement)`, which leaves the
 * root out, so a Game attribute withheld from a seat never became a marker and
 * a board painting it passed. The root's engine bookkeeping that the seat view
 * drops on purpose (another seat's `tutorialProgress`, the host-only `persist`
 * channel) must not become markers in its place.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { TestGame } from './test-game.js';
import { assertNoHiddenInfoLeak, preloadSeatRenderer } from './dom-leak.js';

// #354: load the renderer's module graph while the file is collected.
await preloadSeatRenderer();

class SecretWordGame extends Game<SecretWordGame, Player> {
  static override visibleAttributes = ['publicThing'];
  publicThing = 'OPENVALUE';
  secretWord = 'PINEAPPLEXYZ';
  persist = { winnerNote: 'PERSISTPUBLICXYZ' };
  persistPrivate = { sealedNote: 'PERSISTSEALEDXYZ' };

  constructor(options: GameOptions) {
    super(options);
    this.tutorialProgress.set(1, { stepId: 'step-one', status: 'running' });
    this.tutorialProgress.set(2, { stepId: 'TUTORIALSTEPXYZ', status: 'completed' });
    this.registerAction(Action.create<SecretWordGame>('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'] }) });
  }
}

const boardRendering = (word: string) =>
  defineComponent({ name: 'WordBoard', setup: () => () => h('div', { class: 'board', 'data-word': word }) });

const makeGame = () => TestGame.create(SecretWordGame, { playerCount: 2, seed: 'game-root-leak' });

describe('assertNoHiddenInfoLeak — secrets on the Game root (#908)', () => {
  it('catches a Game attribute withheld from the seat and rendered anyway', async () => {
    const tg = makeGame();
    expect(JSON.stringify(tg.getPlayerView(1).state)).not.toContain('PINEAPPLEXYZ');

    await expect(
      assertNoHiddenInfoLeak(tg, 1, { component: boardRendering('PINEAPPLEXYZ') }),
    ).rejects.toThrow(/PINEAPPLEXYZ.*secretWord/);
  });

  it('does not mark the root bookkeeping the seat view drops on purpose', async () => {
    const tg = makeGame();
    for (const value of ['TUTORIALSTEPXYZ', 'completed', 'PERSISTPUBLICXYZ', 'PERSISTSEALEDXYZ']) {
      expect(JSON.stringify(tg.getPlayerView(1).state)).not.toContain(value);
      await expect(
        assertNoHiddenInfoLeak(tg, 1, { component: boardRendering(value) }),
      ).resolves.toBeUndefined();
    }
  });
});
