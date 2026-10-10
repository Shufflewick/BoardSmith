import { describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Action,
  FlowEngine,
  FlowHaltedError,
  sequence,
  execute,
  actionStep,
  simultaneousActionStep,
} from '../index.js';

/**
 * Which actions a seat is offered is decided in one place (#501).
 *
 * The flow engine asks "which of this step's actions can this seat take right
 * now" at five sites: a sequential step's entry, a sequential step re-opened for
 * a seat holding a follow-up, a simultaneous step's entry,
 * `refreshAwaitingActions`, and the re-evaluation of a seat that has just acted
 * in a simultaneous step. They used to be five copies that drifted: the
 * after-acting copy silently dropped an unregistered name and never consulted
 * `skipPlayer`. These tests hold every site to the same answer.
 */

type Name = 'a' | 'b' | 'c' | 'finish';
const NAMES: Name[] = ['a', 'b', 'c'];

class Seat extends Player<SeatGame, Seat> {
  /** The names this seat's `actions` callback declares. */
  declared: string[] = ['a', 'b', 'c'];
  /** The names whose condition currently passes for this seat. */
  allowed: Name[] = ['a', 'b', 'c', 'finish'];
  skip = false;
  done = false;
}

class SeatGame extends Game<SeatGame, Seat> {
  static PlayerClass = Seat;
  advanced = false;
}

/** A deterministic PRNG so a failing seed can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function subset<T>(random: () => number, items: readonly T[]): T[] {
  return items.filter(() => random() < 0.6);
}

/** Give `seat` a fresh random declared list, conditions, skip and done. */
function reshuffle(seat: Seat, random: () => number): void {
  seat.declared = subset(random, NAMES);
  seat.allowed = [...subset(random, NAMES), 'finish'];
  seat.skip = random() < 0.15;
  seat.done = random() < 0.15;
}

/**
 * Register a, b and c, each available while the seat allows it. Taking one
 * reshuffles ONLY the acting seat's state, so the one seat the engine
 * re-evaluates after an action is the only seat whose answer can have moved:
 * any difference between that re-evaluation and a refresh is drift between
 * the two sites, not a stale list (#28).
 */
function registerActions(game: SeatGame, random: () => number): void {
  for (const name of NAMES) {
    game.registerAction(
      Action.create(name)
        .condition({ [`seat allows ${name}`]: (ctx) => (ctx.player as Seat).allowed.includes(name) })
        .execute((_args, ctx) => {
          reshuffle(ctx.player as Seat, random);
          if (random() < 0.2) return { success: true, followUp: { action: 'finish', args: {} } };
          return { success: true };
        }),
    );
  }
  game.registerAction(
    Action.create('finish')
      .condition({ 'seat allows finish': (ctx) => (ctx.player as Seat).allowed.includes('finish') })
      .execute(() => ({ success: true })),
  );
}

function simultaneousEngine(game: SeatGame): FlowEngine<SeatGame> {
  return new FlowEngine(
    game,
    {
      root: sequence(
        simultaneousActionStep({
          name: 'plan',
          actions: (_ctx, player) => player.declared,
          skipPlayer: (_ctx, player) => player.skip,
          playerDone: (_ctx, player) => player.done,
        }),
        execute(() => {
          game.advanced = true;
        }),
      ),
    },
  );
}

/** The awaiting set in a comparable shape, independent of push order. */
function awaiting(engine: FlowEngine<SeatGame>) {
  return [...(engine.getState().awaitingPlayers ?? [])]
    .map((p) => ({ seat: p.playerIndex, actions: [...p.availableActions].sort(), completed: p.completed }))
    .sort((x, y) => x.seat - y.seat);
}

/**
 * Have a random seat that is still to act take a random action it is offered
 * (its follow-up included). False when no seat can act.
 */
function takeRandomMove(engine: FlowEngine<SeatGame>, random: () => number): boolean {
  const open = (engine.getState().awaitingPlayers ?? []).filter((p) => !p.completed);
  if (open.length === 0) return false;
  const actor = pick(random, open);
  const held = engine.getState().followUps?.find((f) => f.seat === actor.playerIndex);
  const choices = held ? [...actor.availableActions, held.action] : actor.availableActions;
  if (choices.length === 0) return false;
  engine.resume(pick(random, choices), {}, actor.playerIndex);
  return true;
}

/** Play one seeded game, checking after entry and every move that a refresh changes nothing. */
function checkRefreshAgreesThroughout(seed: number): void {
  const random = rng(seed);
  const game = new SeatGame({ playerCount: 3, seed: `s${seed}` });
  registerActions(game, random);
  for (const seat of game.players) reshuffle(seat, random);
  const engine = simultaneousEngine(game);
  engine.start();

  for (let move = 0; move < 12 && !engine.getState().complete; move++) {
    const before = awaiting(engine);
    engine.refreshAwaitingActions();
    expect(awaiting(engine), `seed ${seed}, move ${move}: refresh disagreed`).toEqual(before);
    if (!takeRandomMove(engine, random)) return;
  }
}

describe('a simultaneous step decides a seat the same way at entry, on refresh and after it acts (#501)', () => {
  it('refreshAwaitingActions changes nothing right after entry or after any action, over 200 seeded games', () => {
    for (let seed = 1; seed <= 200; seed++) checkRefreshAgreesThroughout(seed);
  });

  it('refuses an unregistered name the action list returns only after the seat acts', () => {
    const game = new SeatGame({ playerCount: 2, seed: 's' });
    let acted = false;
    game.registerAction(Action.create('a').execute(() => {
      acted = true;
    }));
    game.registerAction(Action.create('b').execute(() => {}));
    const engine = new FlowEngine(
      game,
      {
        root: simultaneousActionStep({ name: 'bid', actions: () => (acted ? ['b', 'tpyo'] : ['a', 'b']) }),
      },
    );
    engine.start();

    let thrown: unknown;
    try {
      engine.resume('a', {}, 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FlowHaltedError);
    expect((thrown as Error).message).toMatch(/Flow step 'bid' references unknown action 'tpyo'/);
  });

  it('drops a seat that skipPlayer excludes once it has acted, and completes the step when it was the last', () => {
    const game = new SeatGame({ playerCount: 2, seed: 's' });
    game.registerAction(Action.create('a').execute((_args, ctx) => {
      (ctx.player as Seat).skip = true;
    }));
    const engine = simultaneousEngine(game);
    game.players.forEach((p) => {
      p.declared = ['a'];
    });
    engine.start();

    engine.resume('a', {}, 1);
    expect(awaiting(engine).map((p) => p.seat)).toEqual([2]);
    expect(game.advanced).toBe(false);

    const state = engine.resume('a', {}, 2);
    expect(state.complete).toBe(true);
    expect(game.advanced).toBe(true);
  });
});

describe('every site reads a seat\'s action list once, not once per declared name (#501)', () => {
  it('at simultaneous step entry, on refresh, and after a seat acts', () => {
    // Taking an action changes nothing, so the acting seat stays awaited and
    // is re-evaluated rather than finished.
    const game = new SeatGame({ playerCount: 2, seed: 's' });
    for (const name of NAMES) game.registerAction(Action.create(name).execute(() => {}));
    const calls = vi.spyOn(game, 'getAvailableActions');
    const engine = simultaneousEngine(game);

    engine.start();
    expect(calls).toHaveBeenCalledTimes(2);

    calls.mockClear();
    engine.refreshAwaitingActions();
    expect(calls).toHaveBeenCalledTimes(2);

    calls.mockClear();
    engine.resume('a', {}, 1);
    const actingSeatReads = calls.mock.calls.filter(([p]) => p === game.players[0]).length;
    expect(actingSeatReads).toBe(1);
  });

  it('at a sequential step\'s entry and when it re-opens for a seat holding a follow-up', () => {
    const game = new SeatGame({ playerCount: 2, seed: 's' });
    game.registerAction(
      Action.create('a').execute(() => ({ success: true, followUp: { action: 'finish', args: {} } })),
    );
    game.registerAction(Action.create('b').execute(() => {}));
    game.registerAction(Action.create('finish').execute(() => {}));
    const calls = vi.spyOn(game, 'getAvailableActions');
    const engine = new FlowEngine(
      game,
      { root: actionStep({ name: 'turn', actions: ['a', 'b', 'finish'], maxMoves: 1 }) },
    );

    const entry = engine.start();
    expect(calls).toHaveBeenCalledTimes(1);

    calls.mockClear();
    const held = engine.resume('a', {});
    // The step's one move is spent, but the held follow-up re-opens it, and the
    // seat is offered the same names its plain entry would offer it.
    expect(held.awaitingInput).toBe(true);
    expect(held.availableActions).toEqual(entry.availableActions);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
