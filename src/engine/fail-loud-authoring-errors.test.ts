/**
 * Authoring errors fail loud instead of degrading (#46, #49, #50, #51).
 *
 * Each of these used to be a console line and a plausible-looking fallback:
 * the game kept running, the author saw a mislabelled button or a missing one,
 * and the single diagnostic scrolled out of the console. All of them are
 * structural mistakes in game code that nothing downstream can recover from,
 * so they throw with a message naming what to fix.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  defineFlow,
  actionStep,
  simultaneousActionStep,
  type GameOptions,
} from './index.js';
import { GameRunner } from '../runtime/runner.js';

class Token extends Piece<AnyGame, Player> {}
class Tray extends Space<AnyGame, Player> {}
type AnyGame = Game<any, Player>;

/** A minimal game whose constructor body the test supplies. */
function makeGame(build: (game: Game<any, Player>) => void) {
  return class Built extends Game<Built, Player> {
    constructor(options: GameOptions) {
      super(options);
      this.registerElements([Token, Tray]);
      build(this as unknown as Game<any, Player>);
    }
  };
}

/** Drive the game the way a real host does, so the flow actually runs. */
function start(GameClass: new (o: GameOptions) => Game<any, Player>) {
  const runner = new GameRunner({
    GameClass: GameClass as never,
    gameType: 'fail-loud',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 's' },
  });
  runner.start();
  return runner.game;
}

describe('create() rejects a reserved property (#49)', () => {
  it('throws rather than clobbering the element id the whole snapshot system keys on', () => {
    const G = makeGame((game) => {
      game.create(Tray, 'tray', { id: 5 } as never);
    });
    expect(() => new G({ playerCount: 2, seed: 's' })).toThrow(/reserved/i);
    expect(() => new G({ playerCount: 2, seed: 's' })).toThrow(/\bid\b/);
  });

  it('names the class and element so the author knows which create() call to fix', () => {
    const G = makeGame((game) => {
      game.create(Tray, 'supply-tray', { _ctx: {} } as never);
    });
    expect(() => new G({ playerCount: 2, seed: 's' })).toThrow(/supply-tray/);
    expect(() => new G({ playerCount: 2, seed: 's' })).toThrow(/_ctx/);
  });

  it('still accepts ordinary attributes', () => {
    const G = makeGame((game) => {
      const tray = game.create(Tray, 'tray');
      tray.createMany(2, Token, 'token', { color: 'red' } as never);
    });
    expect(() => new G({ playerCount: 2, seed: 's' })).not.toThrow();
  });
});

describe('a flow step naming an action that does not exist (#51)', () => {
  it('throws from actionStep rather than filtering the name out forever', () => {
    const G = makeGame((game) => {
      game.registerAction(Action.create('real').prompt('Real').execute(() => {}));
      game.setFlow(defineFlow({ root: actionStep({ name: 'turn', actions: ['real', 'tpyo'] }) }));
    });
    expect(() => start(G)).toThrow(/tpyo/);
    expect(() => start(G)).toThrow(/turn/);
  });

  it('throws from simultaneousActionStep too', () => {
    const G = makeGame((game) => {
      game.registerAction(Action.create('real').prompt('Real').execute(() => {}));
      game.setFlow(
        defineFlow({ root: simultaneousActionStep({ name: 'bid', actions: ['real', 'tpyo'] }) })
      );
    });
    expect(() => start(G)).toThrow(/tpyo/);
    expect(() => start(G)).toThrow(/bid/);
  });

  it('says how to register the missing action', () => {
    const G = makeGame((game) => {
      game.registerAction(Action.create('real').prompt('Real').execute(() => {}));
      game.setFlow(defineFlow({ root: actionStep({ actions: ['tpyo'] }) }));
    });
    expect(() => start(G)).toThrow(/registerActions/);
  });

  it('throws at evaluation for a function-valued action list, the static walk\'s blind spot', () => {
    // `actions` as a function cannot be enumerated at startFlow() time, so the
    // static reachability check skips it. That used to leave the runtime path
    // free to warn once and filter the name out forever.
    const G = makeGame((game) => {
      game.registerAction(Action.create('real').prompt('Real').execute(() => {}));
      game.setFlow(
        defineFlow({ root: actionStep({ name: 'dynamic-turn', actions: () => ['real', 'tpyo'] }) })
      );
    });
    expect(() => start(G)).toThrow(/tpyo/);
    expect(() => start(G)).toThrow(/dynamic-turn/);
    expect(() => start(G)).toThrow(/registerActions/);
  });

  it('does not throw when every named action is registered', () => {
    const G = makeGame((game) => {
      game.registerAction(Action.create('real').prompt('Real').execute(() => {}));
      game.setFlow(defineFlow({ root: actionStep({ actions: ['real'] }) }));
    });
    expect(() => start(G)).not.toThrow();
  });
});

describe('an action condition that crashes (#46)', () => {
  it('throws naming the action and the condition, instead of reading as "unavailable"', () => {
    const G = makeGame((game) => {
      game.registerAction(
        Action.create('fragile')
          .prompt('Fragile')
          .condition({
            'deck is stocked': () => (undefined as unknown as { length: number }).length > 0,
          })
          .execute(() => {})
      );
      game.setFlow(defineFlow({ root: actionStep({ actions: ['fragile'] }) }));
    });
    expect(() => start(G)).toThrow(/fragile/);
    expect(() => start(G)).toThrow(/deck is stocked/);
  });

  it('leaves a condition that legitimately returns false alone', () => {
    const G = makeGame((game) => {
      game.registerAction(
        Action.create('gated')
          .prompt('Gated')
          .condition({ 'never ready': () => false })
          .execute(() => {})
      );
      game.registerAction(Action.create('open').prompt('Open').execute(() => {}));
      game.setFlow(defineFlow({ root: actionStep({ actions: ['gated', 'open'] }) }));
    });
    const game = start(G);
    const names = game.getAvailableActions(game.getPlayer(1)!).map((a) => a.name);
    expect(names).toContain('open');
    expect(names).not.toContain('gated');
  });
});
