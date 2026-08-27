/**
 * A move a bot can offer but cannot resolve (#31).
 *
 * MCTS builds its sandbox from the bot's OWN seat's redacted view — right, a
 * bot must search what it can know — but a move's `execute()` often needs the
 * very state redaction removed. With no way to say so, a game had two options
 * and both were bad: let `execute()` throw an ordinary error, which logs a
 * stack PER ROLLOUT (198 MB in 15 seconds on the reporting game) while the
 * search silently collapses to whatever moves happen not to touch hidden
 * state; or fabricate the missing state, which is the engine's own documented
 * anti-pattern applied one layer too late.
 *
 * `NotSimulableError` is neither: the move is dropped from the search, nothing
 * is logged, and no value is invented.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  NotSimulableError,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type FlowContext,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { createBot } from './index.js';

class Token extends Piece<FogGame, Player> {}
class Zone extends Space<FogGame, Player> {}

/**
 * The world is a function of one root scalar the seat cannot see. `travel`
 * enumerates fine — the seat's own view carries its options — but resolving one
 * needs the map.
 */
class FogGame extends Game<FogGame, Player> {
  mapSeed: number | undefined = 7;
  zone!: Zone;
  travelled = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Token, Zone]);
    this.zone = this.create(Zone, 'zone');
    this.zone.createMany(3, Token, 'token');

    this.registerActions(
      Action.create<FogGame>('travel')
        .prompt('Travel')
        .chooseFrom('direction', { choices: ['north', 'south'] })
        .execute((_a, ctx) => {
          const game = ctx.game as FogGame;
          if (game.mapSeed === undefined) {
            throw new NotSimulableError(
              'travel resolves against the map, which this seat cannot see',
            );
          }
          game.travelled++;
        }),
      Action.create<FogGame>('rest').prompt('Rest').execute(() => {}),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx) => (ctx.get<number>('round') ?? 1) <= 10,
          maxIterations: 30,
          do: eachPlayer({ do: actionStep({ actions: ['travel', 'rest'] }) }),
        }),
        setup: (ctx) => ctx.set('round', 1),
      })
    );
  }
}

function runner(mapSeed: number | undefined) {
  const r = new GameRunner({
    GameClass: FogGame,
    gameType: 'fog',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'fog' },
  });
  r.start();
  r.game.mapSeed = mapSeed;
  return r;
}

afterEach(() => vi.restoreAllMocks());

describe('the failure result', () => {
  it('is marked notSimulable, distinct from an ordinary crash', () => {
    const r = runner(undefined);
    const result = r.performAction('travel', 1, { direction: 'north' });
    expect(result.success).toBe(false);
    expect(r.game.travelled).toBe(0);
  });

  it('logs nothing — this is an expected answer, not a crash', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runner(undefined).performAction('travel', 1, { direction: 'north' });
    const crashLogs = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => /execution failed/.test(m));
    expect(crashLogs).toEqual([]);
  });

  it('DOES log an ordinary throw, which is still a crash', () => {
    class BrokenGame extends FogGame {
      constructor(o: GameOptions) {
        super(o);
        this.registerAction(
          Action.create('boom').prompt('Boom').execute(() => {
            throw new Error('a real bug');
          }),
        );
      }
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = new BrokenGame({ playerCount: 2, seed: 'fog' });
    g.getActionExecutor().executeAction(g.getAction('boom')!, g.getPlayer(1)!, {});
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/execution failed/);
  });

  it('carries the game\'s own message, which says what is missing', () => {
    const result = runner(undefined).performAction('travel', 1, { direction: 'north' });
    expect(result.error).toContain('map');
  });
});

describe('a bot searching that sandbox', () => {
  it('still returns a move, falling back to what it can resolve', async () => {
    const r = runner(undefined);
    const bot = createBot(r.game, FogGame, 'fog', 1, r.actionHistory, 'easy');
    const move = await bot.play();
    expect(move).not.toBeNull();
  });

  it('does not fill the console with a stack per rollout', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = runner(undefined);
    const bot = createBot(r.game, FogGame, 'fog', 1, r.actionHistory, 'easy');
    await bot.play();
    const crashLogs = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => /execution failed/.test(m));
    expect(crashLogs).toEqual([]);
  });

  it('resolves travel normally when the state IS there', async () => {
    const r = runner(7);
    const bot = createBot(r.game, FogGame, 'fog', 1, r.actionHistory, 'easy');
    const move = await bot.play();
    expect(move).not.toBeNull();
    const result = r.performAction(move!.action, 1, move!.args);
    expect(result.success).toBe(true);
  });
});
