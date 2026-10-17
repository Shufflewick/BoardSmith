// @vitest-environment jsdom
/**
 * `assertNoHiddenInfoLeak` on the Game root's top-level fields (#1064).
 *
 * The gate read only an element's `name` and `attributes`, so what `toJSON()`
 * adds beside them on the root (`settings` and the rest) never became a marker.
 * A seat's view drops another seat's `actionTempState` values from `settings`
 * (#716), and a game's `static playerView` may drop more, yet a board painting
 * either passed.
 */
import { describe, it, expect } from 'vitest';
import { defineComponent, h } from 'vue';
import { Game, Player, Action, actionStep, actionTempState, type ElementJSON, type GameOptions } from '../engine/index.js';
import { TestGame } from './test-game.js';
import { assertNoHiddenInfoLeak, preloadSeatRenderer } from './dom-leak.js';

// #354: load the renderer's module graph while the file is collected.
await preloadSeatRenderer();

class SettingsGame extends Game<SettingsGame, Player> {
  static override playerView = (state: ElementJSON): ElementJSON => {
    const { dealerSeed: _seed, ...settings } = (state as ElementJSON & { settings: Record<string, unknown> }).settings;
    return { ...state, settings } as ElementJSON;
  };

  constructor(options: GameOptions) {
    super(options);
    this.settings.dealerSeed = 'DEALERSEEDXYZ';
    this.settings.tableName = 'OPENTABLEXYZ';
    actionTempState(this, this.getPlayer(1)!, 'scout').set('target', 'OWNTEMPXYZ');
    actionTempState(this, this.getPlayer(2)!, 'scout').set('target', 'OTHERTEMPXYZ');
    this.registerAction(Action.create<SettingsGame>('pass').execute(() => ({ success: true })));
    this.setFlow({ root: actionStep({ actions: ['pass'] }) });
  }
}

const board = (painted: string) =>
  defineComponent({ name: 'SettingsBoard', setup: () => () => h('div', { class: 'board', 'data-painted': painted }) });

const makeGame = () => TestGame.create(SettingsGame, { playerCount: 2, seed: 'root-fields-leak' });

describe('assertNoHiddenInfoLeak — the root\'s top-level fields (#1064)', () => {
  it('catches a settings value the game\'s playerView withholds, rendered anyway', async () => {
    const tg = makeGame();
    expect(JSON.stringify(tg.getPlayerView(1).state)).not.toContain('DEALERSEEDXYZ');

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board('DEALERSEEDXYZ') })).rejects.toThrow(
      /DEALERSEEDXYZ.*settings/,
    );
  });

  it('catches another seat\'s actionTempState value, rendered anyway', async () => {
    const tg = makeGame();
    expect(JSON.stringify(tg.getPlayerView(1).state)).not.toContain('OTHERTEMPXYZ');

    await expect(assertNoHiddenInfoLeak(tg, 1, { component: board('OTHERTEMPXYZ') })).rejects.toThrow(
      /OTHERTEMPXYZ.*settings/,
    );
  });

  it('accepts settings values the seat is sent: public ones and its own actionTempState', async () => {
    const tg = makeGame();
    for (const value of ['OPENTABLEXYZ', 'OWNTEMPXYZ']) {
      expect(JSON.stringify(tg.getPlayerView(1).state)).toContain(value);
      await expect(assertNoHiddenInfoLeak(tg, 1, { component: board(value) })).resolves.toBeUndefined();
    }
  });
});
