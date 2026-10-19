/**
 * No stale choice is ever offered (#631): across seeded random games, every
 * answer production reuses equals the answer worked out afresh.
 *
 * Each game is played in production, where answers are reused. Before every
 * move, every seat's moves and every pick's choices are asked for twice, once
 * as production answers them and once in development mode, which works every
 * answer out again; the two must be equal. Half the moves are made in one
 * submission and half pick by pick, the two ways a seat moves.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, enumerateLegalMoves, dueSeats, type GameOptions } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import { PendingActionManager } from '../../session/pending-action-manager.js';
import { SeededRandom } from '../../utils/random.js';
import { isElement } from '../element/game-element.js';
import { CardsGame, DuelGame, RememberingDuelGame } from './choice-cache-fixtures.test-helper.js';

const devMode = vi.hoisted(() => ({ override: null as boolean | null }));
vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return { ...actual, isDevMode: () => devMode.override ?? actual.isDevMode() };
});

afterEach(() => {
  devMode.override = null;
});

/** A value with every element replaced by its name, so two answers compare by content. */
function plain(value: unknown): unknown {
  if (isElement(value)) return `<${value.name}>`;
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

/** Everything a seat is offered: its moves, and each pick's choices after each move's earlier picks. */
function offers(game: Game): unknown {
  const executor = game.getActionExecutor();
  return game.players.map((player) => {
    const moves = enumerateLegalMoves(game, player.seat);
    const choices = moves.flatMap(({ action, args }) => {
      const selections = game.getAction(action)!.selections;
      return selections.map((selection, at) => {
        const earlier = Object.fromEntries(selections.slice(0, at).map((s) => [s.name, args[s.name]]));
        return [action, selection.name, plain(executor.getChoices(selection, player, earlier, action))];
      });
    });
    return { seat: player.seat, moves: plain(moves), choices };
  });
}

async function makeMove(runner: GameRunner<Game>, playerCount: number, seat: number, move: { action: string; args: Record<string, unknown> }, stepwise: boolean): Promise<void> {
  if (!stepwise) {
    const result = runner.performAction(move.action, seat, move.args);
    expect(result.error).toBeUndefined();
    return;
  }
  const picks = new PendingActionManager(runner, playerCount);
  picks.startPendingAction(move.action, seat);
  const action = runner.game.getAction(move.action)!;
  for (const selection of action.selections) {
    const value = move.args[selection.name];
    const values = Array.isArray(value) && 'repeat' in selection && selection.repeat ? value : [value];
    for (const pick of values) expect((await picks.processSelectionStep(seat, selection.name, pick)).error).toBeUndefined();
  }
}

async function playChecked(GameClass: new (options: GameOptions) => Game, playerCount: number, seed: string): Promise<number> {
  devMode.override = false;
  const runner = new GameRunner<Game>({ GameClass, gameType: 'bs631', gameOptions: { playerCount, seed } });
  runner.start();
  const random = new SeededRandom(`${seed}-moves`);
  let plies = 0;
  for (; plies < 80; plies++) {
    const flowState = runner.getFlowState();
    if (!flowState || flowState.complete) break;
    const reused = offers(runner.game);
    devMode.override = true;
    const fresh = offers(runner.game);
    devMode.override = false;
    expect(reused).toEqual(fresh);

    const seat = dueSeats(flowState)[0];
    const moves = enumerateLegalMoves(runner.game, seat);
    if (moves.length === 0) break;
    await makeMove(runner, playerCount, seat, random.pick(moves), random.next() < 0.5);
  }
  return plies;
}

describe('a reused answer always equals a fresh one (#631)', () => {
  const seeds = Array.from({ length: 12 }, (_, at) => `bs631-${at}`);

  it.each(seeds)('in a duel of pawns, seed %s', async (seed) => {
    expect(await playChecked(DuelGame, 2, seed)).toBeGreaterThan(10);
  });

  it.each(seeds)('in a duel of pawns whose legal moves are remembered per state (#673), seed %s', async (seed) => {
    expect(await playChecked(RememberingDuelGame, 2, seed)).toBeGreaterThan(10);
  });

  it.each(seeds)('in a game of cards, seed %s', async (seed) => {
    expect(await playChecked(CardsGame, 3, seed)).toBeGreaterThan(10);
  });
});
