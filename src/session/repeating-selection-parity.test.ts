/**
 * A repeating selection means one thing on every path that submits a move
 * (#325).
 *
 * `chooseFrom(..., { repeat: { until, onEach } })` used to mean two things. Picked
 * one value at a time (the action panel), every pick ran `onEach` and `execute`
 * was handed the picks as an array. Submitted whole (an `action` op, a bot's
 * move, the simulator), `onEach` never ran and `execute` was handed a scalar, so
 * a bot played a different game from a human.
 *
 * Every test here drives the REAL engine through the host's ops, the way the
 * platform does, and compares what each path left behind: the calls `onEach`
 * received, the argument `execute` received, and the pieces `onEach` moved.
 */
import { describe, it, expect } from 'vitest';
import { executeOp, type OpResult } from './stateless-ops.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import {
  RepeatingCollectGame,
  Token,
  repeatingCollectDefinition as collectDef,
} from './testing/fixtures/repeating-collect-fixture.js';
import { GameRunner } from '../runtime/runner.js';
import type { GameStateSnapshot } from '../engine/index.js';
import { createTestGame } from '../testing/test-game.js';
import { simulateRandomGames } from '../testing/random-simulation.js';
import { playUntilComplete } from '../testing/simulate-action.js';

const options = { playerCount: 1, seed: 'bs325' };

function makeHost(botSeats: Array<{ seat: number; level?: string }> = []) {
  return new SnapshotSessionHost({
    playerCount: options.playerCount,
    botSeats,
    executeOp: (snap, pend, op) => executeOp(collectDef, options, snap, pend, op),
    record: () => {}, push: () => {},
  });
}

/** What a collect left behind: onEach's calls, execute's argument, and the pieces. */
function gameOutcome(game: RepeatingCollectGame) {
  return {
    eachCalls: [...game.eachCalls],
    collected: game.collected,
    hand: game.hand.all(Token).map((t) => t.name),
    stash: game.stash.all(Token).map((t) => t.name),
  };
}

/** The same, read from the host's durable snapshot. */
function outcome(host: SnapshotSessionHost) {
  return gameOutcome(GameRunner.fromSnapshot(host.snapshot as GameStateSnapshot, RepeatingCollectGame).game);
}

const untouched = { eachCalls: [], collected: null, hand: [], stash: ['p1', 'p2', 'p3'] };

/** A whole submission is refused with `reason`, and the game is as it was. */
async function expectRefusedAndRolledBack(token: unknown, reason: RegExp) {
  const host = makeHost();
  await host.start();
  const result = await submitWhole(host, token);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(reason);
  expect(outcome(host)).toEqual(untouched);
  return result;
}

const pickedThenStopped = {
  eachCalls: ['p2', 'p1', 'stop'],
  collected: ['p2', 'p1', 'stop'],
  hand: ['p2', 'p1'],
  stash: ['p3'],
};

function step(host: SnapshotSessionHost, value: string): Promise<OpResult> {
  return host.handleOp(1, {
    type: 'selectionStep',
    player: 1,
    selectionName: 'token',
    value,
    actionName: 'collect',
    boundaryKey: boundaryKeyOfHost(host),
  });
}

function submitWhole(host: SnapshotSessionHost, token: unknown): Promise<OpResult> {
  return host.handleOp(1, {
    type: 'action',
    player: 1,
    actionName: 'collect',
    args: { token },
    boundaryKey: boundaryKeyOfHost(host),
  });
}

describe('a repeating selection is one protocol on every path (#325)', () => {
  it('step by step: each pick runs onEach, and execute receives the picks as an array', async () => {
    const host = makeHost();
    await host.start();
    for (const value of ['p2', 'p1', 'stop']) {
      expect((await step(host, value)).success).toBe(true);
    }
    expect(outcome(host)).toEqual(pickedThenStopped);
  });

  it('submitted whole as an action op: the same onEach calls and the same execute argument', async () => {
    const host = makeHost();
    await host.start();
    const result = await submitWhole(host, ['p2', 'p1', 'stop']);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(outcome(host)).toEqual(pickedThenStopped);
  });

  it('a whole submission is recorded in history exactly as the step-by-step one is', async () => {
    const stepped = makeHost();
    await stepped.start();
    for (const value of ['p2', 'p1', 'stop']) await step(stepped, value);

    const whole = makeHost();
    await whole.start();
    await submitWhole(whole, ['p2', 'p1', 'stop']);

    const history = (h: SnapshotSessionHost) => (h.snapshot as GameStateSnapshot).actionHistory;
    expect(history(whole)).toEqual(history(stepped));
  });

  it('a bot plays the repeat protocol: every pick runs onEach, and execute receives an array ending at the terminator', async () => {
    const host = makeHost();
    await host.start();
    const result = await host.handleOp(1, { type: 'botTurn', seats: [{ seat: 1, level: 'easy' }] });
    expect(result.error).toBeUndefined();
    expect(result.botMoved).toBe(true);

    const after = outcome(host);
    expect(Array.isArray(after.collected)).toBe(true);
    const picks = after.collected as string[];
    expect(picks.at(-1)).toBe('stop');
    // onEach saw exactly the picks execute was handed, and moved what it picked.
    expect(after.eachCalls).toEqual(picks);
    expect(after.hand).toEqual(picks.slice(0, -1));
  });

  it('a scalar submitted for a repeating selection is refused with the array form named, and nothing runs', async () => {
    const result = await expectRefusedAndRolledBack('p1', /"token" repeats/);
    expect(result.error).toMatch(/array/);
  });

  it('picks that never reach the terminator are refused, and the picks onEach already ran are rolled back', async () => {
    await expectRefusedAndRolledBack(['p1', 'p2'], /did not end/);
  });

  it('picks after the one that ended the repeat are refused, and rolled back', async () => {
    await expectRefusedAndRolledBack(['p1', 'stop', 'p2'], /after the pick that ended it/);
  });

  it('a pick that onEach has already made unavailable is refused, and rolled back', async () => {
    // p1 is in the hand after the first pick, so the second 'p1' is not offered.
    await expectRefusedAndRolledBack(['p1', 'p1', 'stop'], /Invalid choice/);
  });
});

describe('the in-process paths run the same protocol (#325)', () => {
  it('TestGame.doAction with the picks as an array matches the step-by-step outcome', () => {
    const testGame = createTestGame(RepeatingCollectGame, { playerCount: 1, seed: 'bs325' });
    testGame.doAction(1, 'collect', { token: ['p2', 'p1', 'stop'] });
    expect(gameOutcome(testGame.game)).toEqual(pickedThenStopped);
  });

  it('playUntilComplete (which plays enumerateLegalMoves) plays whole repeats that onEach ran for', () => {
    const testGame = createTestGame(RepeatingCollectGame, { playerCount: 1, seed: 'bs325' });
    playUntilComplete(testGame, { maxMoves: 20 });
    const game = testGame.game;
    const picked = game.eachCalls.filter((c) => c !== 'stop');
    expect(game.hand.all(Token).map((t) => t.name)).toEqual(picked);
    expect(Array.isArray(game.collected)).toBe(true);
    expect((game.collected as string[]).at(-1)).toBe('stop');
  });

  it('the random simulator plays repeating selections without a rejected move', async () => {
    const results = await simulateRandomGames(RepeatingCollectGame, {
      count: 5,
      playerCounts: [1],
      seed: 'bs325',
    });
    expect(results.games.map((g) => g.error)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(results.completed).toBe(5);
  });
});
