/**
 * A game's end and its winners are declared once, on `Game` (#503), and every
 * reader takes them from there: the host's snapshot, and the bot's search.
 *
 * The fixture declares its result only by overriding `isFinished()` and
 * `getWinners()`. The bot once read `settings.winners`, which only `finish()`
 * and the flow's own `getWinners` wrote, so it scored this game as a draw on
 * every line while players were shown seat 1 winning. The benchmark's half of
 * the rule is in `bot-trainer/benchmark.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { createSnapshot } from '../engine/utils/snapshot.js';
import { winnersOf } from '../session/snapshot-session-host.js';
import { declaredResultBot, newDeclaredResultGame } from './declared-result.test-helper.js';

describe('a result declared only by Game overrides', () => {
  it('reaches the host: the snapshot names the game-declared winner', () => {
    const game = newDeclaredResultGame();
    game.continueFlow('pick', { option: 'win' }, 1);

    expect(game.getFlowState()!.complete).toBe(true);
    const snapshot = createSnapshot(game, 'declared-result');
    expect(winnersOf({ snapshot })).toEqual([1]);
  });

  it('reaches the bot: the winning move is valued as a certain win and the others as certain losses', async () => {
    const { stats } = await declaredResultBot(newDeclaredResultGame(), 'declared').playWithStats();

    expect(stats.length).toBe(4);
    for (const s of stats) {
      expect({ option: s.move.args.option, value: s.value })
        .toEqual({ option: s.move.args.option, value: s.move.args.option === 'win' ? 1 : 0 });
    }
  });

  it('reaches the bot: it picks the winning move for every seed', async () => {
    const seeds = Array.from({ length: 10 }, (_, i) => `declared-${i}`);
    const picks: string[] = [];
    for (const seed of seeds) {
      const move = await declaredResultBot(newDeclaredResultGame(), seed).play();
      picks.push(String(move!.args.option));
    }
    expect(picks).toEqual(seeds.map(() => 'win'));
  });
});
