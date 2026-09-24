/**
 * With nothing proven, the search chooses by evaluation (#316).
 *
 * Proof-number search blends a rank into child selection. The rank once came
 * from each child's position in a sorted list, so children with equal proof
 * numbers still got different ranks, and the first child in the list took a
 * bonus as large as the whole value range on every selection. In a game that
 * does not end inside the search nothing is ever proven, and the bot picked
 * the first move rather than the best one.
 */
import { describe, it, expect } from 'vitest';
import { newScoreRace, scoreRaceBot } from './score-race.test-helper.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => `rank-${i}`);

// The transposition table has its own bug (#315), which hides this one.
const config = { useTranspositionTable: false };

describe('move choice in a game that does not end inside the search', () => {
  it('picks the scoring move for every seed', async () => {
    const picks: string[] = [];
    for (const seed of SEEDS) {
      const move = await scoreRaceBot(newScoreRace(), seed, config).play();
      picks.push(String(move!.args.option));
    }
    expect(picks).toEqual(SEEDS.map(() => 'good'));
  });

  it('spends most of its visits on the scoring move', async () => {
    const { stats } = await scoreRaceBot(newScoreRace(), 'visits', config).playWithStats();
    const total = stats.reduce((sum, s) => sum + s.visits, 0);
    const good = stats.find((s) => s.move.args.option === 'good')!;
    expect(good.visits / total).toBeGreaterThan(0.5);
  });
});
