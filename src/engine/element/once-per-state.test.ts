/**
 * `game.oncePerState(key, workOut)`: a fact the game works out from its
 * state, worked out once per game state however many callers ask (#673).
 *
 * It is kept for one state version (#631, `state-version.ts`) and follows the
 * choice cache's rules for when nothing is reused: development mode, world
 * mode, while game code that may change the game runs, and an answer that read
 * the flow's state or changed the game itself.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Game, Player, Piece, Space, Action, actionStep, loop, enumerateLegalMoves, type GameOptions } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import { createSnapshot } from '../utils/snapshot.js';
import { PlayerFacingError } from '../errors.js';
import { Pawn, RememberingDuelGame } from '../action/choice-cache-fixtures.test-helper.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from './world-element-id-key.test-helper.js';

const devMode = vi.hoisted(() => ({ override: null as boolean | null }));
vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return { ...actual, isDevMode: () => devMode.override ?? actual.isDevMode() };
});

/** Runs of every game's `workOut`, counted outside the games so nothing about them is serialized. */
let runs = 0;

beforeEach(() => {
  runs = 0;
  devMode.override = false;
});

afterEach(() => {
  devMode.override = null;
});

class Token extends Piece<TallyGame> {}

/** A game with one remembered fact, `tally()`, read from the tree and an attribute. */
class TallyGame extends Game<TallyGame, Player> {
  level = 0;
  /** What `tally()` answered inside `peek`'s execute: before, then after its own write. */
  seenInExecute: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Space, Token]);
    const room = this.create(Space, 'room');
    room.create(Token, 'token');
    this.create(Space, 'yard');
    this.registerAction(
      Action.create<TallyGame>('raise').execute((_args, ctx) => {
        ctx.game.level++;
        return { success: true };
      }),
    );
    this.registerAction(
      Action.create<TallyGame>('peek').execute((_args, ctx) => {
        const game = ctx.game;
        const before = game.tally();
        game.level++;
        game.seenInExecute = [before, game.tally()];
        return { success: true };
      }),
    );
    this.registerAction(
      Action.create<TallyGame>('fumble').execute((_args, ctx) => {
        ctx.game.level += 50;
        throw new PlayerFacingError('Fumbled.');
      }),
    );
    this.setFlow({ root: loop({ while: () => true, maxIterations: 50, do: actionStep({ actions: ['raise', 'peek', 'fumble'] }) }) });
  }

  /** The level, then how many tokens are in the room, as one number. */
  tally(): number {
    return this.oncePerState('tally', () => {
      runs++;
      return this.level * 100 + this.first(Space, 'room')!.all(Token).length;
    });
  }
}

function start(): GameRunner<TallyGame> {
  const runner = new GameRunner<TallyGame>({ GameClass: TallyGame, gameType: 'bs673', gameOptions: { playerCount: 1, seed: 'bs673' } });
  runner.start();
  return runner;
}

describe('a fact is worked out once per game state (#673)', () => {
  it('answers every later caller in the same state from the first run', () => {
    const game = start().game;
    const facts = () => game.oncePerState('facts', () => ({ run: ++runs }));
    const first = facts();
    expect(facts()).toBe(first);
    expect(game.tally()).toBe(1);
    expect(game.tally()).toBe(1);
    expect(runs).toBe(2);
  });

  it('works out each key on its own', () => {
    const game = start().game;
    expect(game.oncePerState('a', () => 'a')).toBe('a');
    expect(game.oncePerState('b', () => 'b')).toBe('b');
    expect(game.oncePerState('a', () => 'not a')).toBe('a');
  });

  it('works out a chess-shaped pick\'s whole-position fact once per seat per state', () => {
    const runner = new GameRunner<RememberingDuelGame>({ GameClass: RememberingDuelGame, gameType: 'bs673', gameOptions: { playerCount: 2, seed: 'bs673' } });
    runner.start();
    const game = runner.game;
    // The piece filter runs once per pawn and the destinations once more, for
    // each seat's offer, but all of them share one run per seat.
    const before = game.legalMovesRuns;
    expect(runner.performAction('pass', 1, {}).success).toBe(true);
    expect(game.legalMovesRuns).toBe(before + 2);

    const asked = game.legalMovesRuns;
    const [move] = enumerateLegalMoves(game, 2).filter((m) => m.action === 'move');
    for (const pawn of game.all(Pawn)) game.legalMoves(pawn.player);
    expect(game.legalMovesRuns).toBe(asked);
    expect(runner.performAction(move.action, 2, move.args).success).toBe(true);
    expect(game.legalMovesRuns).toBe(asked + 2);
  });
});

describe('every change to the game is seen by the next caller', () => {
  it('an attribute written by an action', () => {
    const runner = start();
    expect(runner.game.tally()).toBe(1);
    expect(runner.performAction('raise', 1, {}).success).toBe(true);
    expect(runner.game.tally()).toBe(101);
  });

  it('an element moved by code outside the game', () => {
    const game = start().game;
    expect(game.tally()).toBe(1);
    game.first(Token)!.putInto(game.first(Space, 'yard')!);
    expect(game.tally()).toBe(0);
  });

  it('a draw from the game\'s random source', () => {
    const game = start().game;
    game.tally();
    game.random();
    game.tally();
    expect(runs).toBe(2);
  });

  it('a restore of a snapshot into the same game', () => {
    const runner = start();
    const game = runner.game;
    const opening = createSnapshot(game, 'bs673');
    expect(runner.performAction('raise', 1, {}).success).toBe(true);
    expect(game.tally()).toBe(101);
    game.loadSerializedState(opening.state);
    game.setRandomState(opening.randomState);
    game.restoreFlowState(opening.flowState!);
    expect(game.tally()).toBe(1);
  });

  it('an action that threw part way, rolled back to the state before it', () => {
    const runner = start();
    const game = runner.game;
    expect(game.tally()).toBe(1);
    expect(runner.performAction('fumble', 1, {}).success).toBe(false);
    expect(game.level).toBe(0);
    expect(game.tally()).toBe(1);
    expect(runs).toBe(2);
  });
});

describe('when nothing is reused', () => {
  it('development mode works the fact out every time', () => {
    devMode.override = true;
    const game = start().game;
    game.tally();
    game.level = 3;
    expect(game.tally()).toBe(301);
    expect(runs).toBe(2);
  });

  it('game code that may change the game works it out every time, and sees its own writes', () => {
    const runner = start();
    expect(runner.game.tally()).toBe(1);
    expect(runner.performAction('peek', 1, {}).success).toBe(true);
    expect(runner.game.seenInExecute).toEqual([1, 101]);
  });

  it('a fact that read the flow\'s state is not kept', () => {
    const game = start().game;
    const step = () => game.oncePerState('step', () => (runs++, game.getFlowState()?.currentPlayer));
    step();
    step();
    expect(runs).toBe(2);
  });

  it('a fact whose own work changed the game is not kept', () => {
    const game = start().game;
    const roll = () => game.oncePerState('roll', () => (runs++, game.random()));
    roll();
    roll();
    expect(runs).toBe(2);
  });

  it('world mode works the fact out every time', () => {
    const game = new TallyGame({ playerCount: 1, seed: 'bs673', worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
    game.tally();
    game.tally();
    expect(runs).toBe(2);
  });
});

describe('what is remembered stays with one game and out of its state', () => {
  it('two games never share a remembered fact', () => {
    const one = start().game;
    const two = start().game;
    two.first(Token)!.putInto(two.first(Space, 'yard')!);
    expect(one.tally()).toBe(1);
    expect(two.tally()).toBe(0);
    expect(runs).toBe(2);
  });

  it('nothing remembered is serialized', () => {
    const game = start().game;
    const before = JSON.stringify(createSnapshot(game, 'bs673'));
    game.tally();
    game.oncePerState('facts', () => ({ big: 'x'.repeat(100) }));
    expect(JSON.stringify(createSnapshot(game, 'bs673'))).toBe(before);
  });
});
