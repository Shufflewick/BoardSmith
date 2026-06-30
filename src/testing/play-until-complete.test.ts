/**
 * TEST-02: playUntilComplete + GameStuckError
 *
 * Verifies that:
 * (1) playUntilComplete(testGame) drives a sequential 2-player game to completion.
 * (2) strategy:'first' is deterministic — two runs from identical state produce the same result.
 * (3) An injectable rng produces a reproducible run.
 * (4) GameStuckError is thrown when a game dead-ends (active seat but no enumerable legal moves).
 * (5) GameStuckError is thrown when maxMoves is exceeded without completion.
 * (6) Simultaneous turns (awaitingPlayers) are handled without hanging.
 *
 * Cross-layer boundary: testing → engine (enumerateLegalMoves + flowState)
 */

import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { TestGame } from './test-game.js';
import { playUntilComplete, GameStuckError } from './simulate-action.js';

// ---------------------------------------------------------------------------
// Fixture 1: PickGame — simple sequential game (adapted from random-simulation.test.ts)
// Players alternate picking a value [1,2,3]; game ends when total >= 6.
// ---------------------------------------------------------------------------

class PickGame extends Game<PickGame, Player> {
  total = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<PickGame>('pick')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          (ctx.game as PickGame).total += args.value as number;
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx: FlowContext) => (ctx.game as PickGame).total < 6,
          maxIterations: 100,
          do: eachPlayer({
            do: actionStep({ actions: ['pick'] }),
          }),
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture 2: StuckGame — game that cannot be enumerated
// The 'name' action requires a text input; enumerateLegalMoves returns []
// because text selections cannot be enumerated, but the action IS available
// (text inputs are always marked as available by isActionAvailable).
// ---------------------------------------------------------------------------

class StuckGame extends Game<StuckGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<StuckGame>('name')
        .enterText('playerName')
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: eachPlayer({
          do: actionStep({ actions: ['name'] }),
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture 3: SimGame — game with a simultaneous action step
// Both players must call 'ready'; when both have acted, the game ends.
// Tests that playUntilComplete handles awaitingPlayers (not just currentPlayer).
// ---------------------------------------------------------------------------

class SimPlayer extends Player<SimGame, SimPlayer> {
  isReady = false;
}

class SimGame extends Game<SimGame, SimPlayer> {
  static PlayerClass = SimPlayer;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<SimGame>('ready').execute((_args, ctx) => {
        (ctx.player as SimPlayer).isReady = true;
        return { success: true };
      }),
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({
          actions: ['ready'],
          playerDone: (_ctx, p) => (p as SimPlayer).isReady,
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('playUntilComplete — TEST-02', () => {
  // (1) Sequential game completion
  describe('sequential game completion', () => {
    it('drives a 2-player sequential game to completion (cross-layer: testing → engine)', () => {
      const testGame = TestGame.create(PickGame, { playerCount: 2, seed: 'seq-test' });

      playUntilComplete(testGame);

      expect(testGame.isComplete()).toBe(true);
      // PickGame ends when total >= 6
      expect((testGame.game as PickGame).total).toBeGreaterThanOrEqual(6);
    });

    it('works regardless of initial seed', () => {
      const seeds = ['alpha', 'beta', 'gamma'];
      for (const seed of seeds) {
        const testGame = TestGame.create(PickGame, { playerCount: 2, seed });
        playUntilComplete(testGame);
        expect(testGame.isComplete()).toBe(true);
      }
    });
  });

  // (2) strategy:'first' determinism
  describe("strategy: 'first' determinism", () => {
    it('produces the same result on two runs from an identical start state', () => {
      const seed = 'determinism-test';

      const gameA = TestGame.create(PickGame, { playerCount: 2, seed });
      playUntilComplete(gameA, { strategy: 'first' });

      const gameB = TestGame.create(PickGame, { playerCount: 2, seed });
      playUntilComplete(gameB, { strategy: 'first' });

      expect(gameA.isComplete()).toBe(true);
      expect(gameB.isComplete()).toBe(true);
      // Both runs always pick value=1 (first choice), so they end with the same total
      expect((gameA.game as PickGame).total).toBe((gameB.game as PickGame).total);
    });
  });

  // (3) Injectable rng — reproducible run
  describe('injectable rng', () => {
    it('accepts a custom rng and produces a reproducible result', () => {
      // A rng that always returns 0 always picks moves[0] — equivalent to strategy:'first'
      const deterministicRng = () => 0;

      const gameA = TestGame.create(PickGame, { playerCount: 2, seed: 'rng-test' });
      playUntilComplete(gameA, { rng: deterministicRng });

      const gameB = TestGame.create(PickGame, { playerCount: 2, seed: 'rng-test' });
      playUntilComplete(gameB, { rng: deterministicRng });

      expect(gameA.isComplete()).toBe(true);
      expect(gameB.isComplete()).toBe(true);
      expect((gameA.game as PickGame).total).toBe((gameB.game as PickGame).total);
    });

    it('using rng:()=>0 produces the same final state as strategy:first', () => {
      const seed = 'first-vs-rng';

      const gameFirst = TestGame.create(PickGame, { playerCount: 2, seed });
      playUntilComplete(gameFirst, { strategy: 'first' });

      const gameRng = TestGame.create(PickGame, { playerCount: 2, seed });
      playUntilComplete(gameRng, { rng: () => 0 });

      // Both always pick moves[0] → same total
      expect((gameFirst.game as PickGame).total).toBe((gameRng.game as PickGame).total);
    });
  });

  // (4) GameStuckError on dead-end (no enumerable legal moves)
  describe('GameStuckError — dead-end (no enumerable legal moves)', () => {
    it('throws GameStuckError when the game has no enumerable legal moves', () => {
      // StuckGame requires text input — enumerateLegalMoves returns [] for text selections
      const testGame = TestGame.create(StuckGame, { playerCount: 2, seed: 'stuck-test' });

      expect(() => playUntilComplete(testGame)).toThrow(GameStuckError);
    });

    it('GameStuckError.name is "GameStuckError"', () => {
      const testGame = TestGame.create(StuckGame, { playerCount: 2, seed: 'stuck-name' });

      let caught: unknown;
      try {
        playUntilComplete(testGame);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(GameStuckError);
      expect((caught as GameStuckError).name).toBe('GameStuckError');
    });

    it('GameStuckError carries iteration, availableActions, and flowState', () => {
      const testGame = TestGame.create(StuckGame, { playerCount: 2, seed: 'stuck-fields' });

      let caught: GameStuckError | undefined;
      try {
        playUntilComplete(testGame);
      } catch (e) {
        if (e instanceof GameStuckError) caught = e;
      }

      expect(caught).toBeDefined();
      expect(typeof caught!.iteration).toBe('number');
      expect(Array.isArray(caught!.availableActions)).toBe(true);
      // flowState may be defined or undefined depending on where the game got stuck
      // but the field should exist on the instance
      expect('flowState' in caught!).toBe(true);
    });

    it('GameStuckError.message is actionable (mentions seat or iteration)', () => {
      const testGame = TestGame.create(StuckGame, { playerCount: 2, seed: 'stuck-msg' });

      let caught: GameStuckError | undefined;
      try {
        playUntilComplete(testGame);
      } catch (e) {
        if (e instanceof GameStuckError) caught = e;
      }

      expect(caught).toBeDefined();
      // Message must be actionable — contains either seat or iteration info
      expect(caught!.message.length).toBeGreaterThan(0);
      const msg = caught!.message.toLowerCase();
      expect(msg.includes('seat') || msg.includes('iteration') || msg.includes('move')).toBe(true);
    });
  });

  // (5) GameStuckError when maxMoves exceeded
  describe('GameStuckError — maxMoves exceeded', () => {
    it('throws GameStuckError (not hanging) when maxMoves is exceeded', () => {
      // PickGame needs at least 2 moves (total 1+1=2, then 1+1=4, then 1+1=6).
      // Setting maxMoves=1 guarantees it cannot complete.
      const testGame = TestGame.create(PickGame, { playerCount: 2, seed: 'maxmoves-test' });

      expect(() => playUntilComplete(testGame, { maxMoves: 1 })).toThrow(GameStuckError);
    });

    it('GameStuckError from maxMoves carries the capped iteration count', () => {
      const maxMoves = 2;
      const testGame = TestGame.create(PickGame, { playerCount: 2, seed: 'maxmoves-iter' });

      let caught: GameStuckError | undefined;
      try {
        playUntilComplete(testGame, { maxMoves });
      } catch (e) {
        if (e instanceof GameStuckError) caught = e;
      }

      expect(caught).toBeDefined();
      // iteration should be at or near maxMoves (the loop ran out)
      expect(caught!.iteration).toBeGreaterThanOrEqual(maxMoves);
    });

    it('does NOT hang — resolves quickly even with a large maxMoves on a stuck game', () => {
      // Vitest has a default timeout; if playUntilComplete hangs this test fails automatically.
      const testGame = TestGame.create(StuckGame, { playerCount: 2, seed: 'no-hang' });
      expect(() => playUntilComplete(testGame, { maxMoves: 100 })).toThrow(GameStuckError);
    });
  });

  // (6) Simultaneous turns (awaitingPlayers — the highest-risk behavior)
  describe('simultaneous turns (awaitingPlayers) — highest-risk behavior', () => {
    it('drives a simultaneous-action game to completion without hanging', () => {
      // SimGame uses simultaneousActionStep — flowState has awaitingPlayers, NOT currentPlayer.
      // A naive implementation that only handles currentPlayer would infinite-loop here.
      const testGame = TestGame.create(SimGame, { playerCount: 2, seed: 'sim-test' });

      playUntilComplete(testGame);

      expect(testGame.isComplete()).toBe(true);
    });

    it('all players acted (both SimPlayers are ready after completion)', () => {
      const testGame = TestGame.create(SimGame, { playerCount: 2, seed: 'sim-ready' });

      playUntilComplete(testGame);

      const players = testGame.getPlayers() as SimPlayer[];
      for (const p of players) {
        expect(p.isReady).toBe(true);
      }
    });

    it('handles 3-player simultaneous step', () => {
      const testGame = TestGame.create(SimGame, { playerCount: 3, seed: 'sim-3p' });

      playUntilComplete(testGame);

      expect(testGame.isComplete()).toBe(true);
    });
  });
});

describe('GameStuckError — class contract', () => {
  it('is an instance of Error', () => {
    const err = new GameStuckError('test', 5, ['move'], undefined);
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of GameStuckError', () => {
    const err = new GameStuckError('test', 5, ['move'], undefined);
    expect(err).toBeInstanceOf(GameStuckError);
  });

  it('has name GameStuckError', () => {
    const err = new GameStuckError('test', 5, ['move'], undefined);
    expect(err.name).toBe('GameStuckError');
  });

  it('exposes iteration', () => {
    const err = new GameStuckError('test', 42, [], undefined);
    expect(err.iteration).toBe(42);
  });

  it('exposes availableActions', () => {
    const err = new GameStuckError('test', 0, ['move', 'pass'], undefined);
    expect(err.availableActions).toEqual(['move', 'pass']);
  });

  it('exposes flowState (undefined when none)', () => {
    const err = new GameStuckError('test', 0, [], undefined);
    expect(err.flowState).toBeUndefined();
  });

  it('message is the provided message string', () => {
    const err = new GameStuckError('actionable message here', 0, [], undefined);
    expect(err.message).toBe('actionable message here');
  });
});
