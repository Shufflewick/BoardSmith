/**
 * Two positions at the same point in the flow but with different boards must
 * be valued by their own boards (#315).
 *
 * The bot once cached leaf evaluations under a key built from the flow
 * position alone. Every leaf reached at the same flow point shared one entry,
 * so after three evaluations each of them was handed the same average, whatever
 * the board said. In the score race every root move leads to the same flow
 * point, so the cache flattened the one move that scores to the value of the
 * five that do not.
 */
import { describe, it, expect } from 'vitest';
import { newScoreRace, scoreRaceBot } from './score-race.test-helper.js';

describe('leaf evaluation in the score race', () => {
  it('values the scoring move above every move that does not score, with default settings', async () => {
    for (const seed of ['eval-1', 'eval-2', 'eval-3', 'eval-4', 'eval-5']) {
      const { stats } = await scoreRaceBot(newScoreRace(), seed).playWithStats();

      const good = stats.find((s) => s.move.args.option === 'good')!;
      const others = stats.filter((s) => s.move.args.option !== 'good');
      expect(good, `seed ${seed}: the search never tried 'good'`).toBeDefined();
      for (const other of others) {
        expect(good.value, `seed ${seed}: 'good' vs '${other.move.args.option}'`).toBeGreaterThan(other.value + 0.3);
      }
    }
  });

  it('values the scoring move above the rest in a short search with no playout', async () => {
    // The shape #315 was reported against: every leaf is the position a tree
    // move reaches, so the only thing that can separate the moves is the board.
    const { stats } = await scoreRaceBot(newScoreRace(), 'shallow', { iterations: 60, playoutDepth: 0 }).playWithStats();

    const good = stats.find((s) => s.move.args.option === 'good')!;
    for (const other of stats.filter((s) => s.move.args.option !== 'good')) {
      expect(good.value, `'good' vs '${other.move.args.option}'`).toBeGreaterThan(other.value + 0.3);
    }
  });
});
