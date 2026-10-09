import { describe, it, expect } from 'vitest';
import {
  Game,
  GameElement,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  execute,
  sequence,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from './runner.js';

/**
 * Issue #496: `create()` used to register every class it made, so a class first
 * created during play worked live and only broke on the next restore ("Unknown
 * element class"). From `startFlow()` on, creating a class the constructor did
 * not register must fail at once, naming the fix.
 */
class Tray extends GameElement {}
class Token extends GameElement {}

// A game's own class named like the built-in Hand, which the engine pre-registers.
class OwnHand extends GameElement {}
Object.defineProperty(OwnHand, 'name', { value: 'Hand' });
const BuiltInNamed = OwnHand;

const MESSAGE = /Element class 'Token' is created after setup but was never registered\. Call this\.registerElements\(\[Token\]\) in your game's constructor\./;

type Setup = 'hand-subclass' | 'none' | 'register-token' | 'constructor-only' | 'opening-execute';

function makeGame(setup: Setup) {
  return class TokenGame extends Game<TokenGame, Player> {
    tray!: Tray;
    constructor(options: GameOptions) {
      super(options);
      this.registerElements(setup === 'register-token' ? [Tray, Token] : [Tray]);
      this.tray = this.create(Tray, 'tray');
      if (setup === 'constructor-only') this.tray.create(Token, 'built-in-constructor');

      this.registerActions(
        Action.create('spawn').execute((_args, ctx) => {
          (ctx.game as TokenGame).tray.create(setup === 'hand-subclass' ? BuiltInNamed : Token, 'tok');
          return { success: true };
        }),
      );
      const turn = eachPlayer({ do: actionStep({ actions: ['spawn'], turnScope: 'restart' }) });
      this.setFlow({
        root:
          setup === 'opening-execute'
            ? sequence<Game>(
                execute<Game>((ctx) => { (ctx.game as TokenGame).tray.create(Token, 'opening'); }),
                loop({ maxIterations: 5, do: turn }),
              )
            : loop({ maxIterations: 5, do: turn }),
      });
    }
  };
}

function runnerFor(GameClass: ReturnType<typeof makeGame>): GameRunner<InstanceType<typeof GameClass>> {
  return new GameRunner({
    GameClass,
    gameType: 'token-game',
    gameOptions: { playerCount: 1, playerNames: ['Solo'], seed: 'bs496' },
  });
}

describe('creating an unregistered element class after setup (#496)', () => {
  it('refuses an action that creates an unregistered class, naming the fix', () => {
    const runner = runnerFor(makeGame('none'));
    runner.start();
    const result = runner.performAction('spawn', 1, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(MESSAGE);
  });

  it('accepts the action and restores the checkpoint once the class is registered', () => {
    const Cls = makeGame('register-token');
    const runner = runnerFor(Cls);
    runner.start();
    expect(runner.performAction('spawn', 1, {}).success).toBe(true);
    const snapshot = JSON.parse(JSON.stringify(runner.getSnapshot()));
    const restored = GameRunner.fromCheckpoint(snapshot, runner.actionHistory.length, Cls);
    expect(restored).not.toBeNull();
    expect(restored!.game.tray.all(Token)).toHaveLength(1);
  });

  it('still restores a class created only in the constructor and never listed', () => {
    const Cls = makeGame('constructor-only');
    const runner = runnerFor(Cls);
    runner.start();
    expect(runner.game.tray.all(Token)).toHaveLength(1);
    const snapshot = JSON.parse(JSON.stringify(runner.getSnapshot()));
    // The constructor runs again on restore and re-registers Token.
    const restored = GameRunner.fromCheckpoint(snapshot, 0, Cls);
    expect(restored).not.toBeNull();
    expect(restored!.game.tray.all(Token)).toHaveLength(1);
  });

  it('refuses creation inside an opening execute node during startFlow()', () => {
    const runner = runnerFor(makeGame('opening-execute'));
    expect(() => runner.start()).toThrow(MESSAGE);
  });
});

describe('the rule holds for a restored game, a built-in name and a world (#496)', () => {
  it('refuses on a runner restored from a checkpoint, like a live one', () => {
    const Cls = makeGame('none');
    const runner = runnerFor(Cls);
    runner.start();
    const snapshot = JSON.parse(JSON.stringify(runner.getSnapshot()));
    const restored = GameRunner.fromCheckpoint(snapshot, 0, Cls);
    expect(restored).not.toBeNull();
    const result = restored!.performAction('spawn', 1, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(MESSAGE);
  });

  it('refuses an unregistered class named like a built-in', () => {
    const runner = runnerFor(makeGame('hand-subclass'));
    runner.start();
    const result = runner.performAction('spawn', 1, {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Element class 'Hand' is created after setup but was never registered/);
  });

  it('refuses in a world once construction ends, with no flow involved', () => {
    class WorldGame extends Game<WorldGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerElements([Tray]);
      }
    }
    const world = new WorldGame({
      playerCount: 2, seed: 'w', worldMode: true, elementIdKey: '0f1e2d3c4b5a69788796a5b4',
    });
    // Construction: a class created here registers itself.
    world.create(Tray, 'tray');
    world.reserveConstructionIdSpace();
    expect(() => world.create(Token, 'tok')).toThrow(MESSAGE);
  });
});
