import { describe, it, expect } from 'vitest';
import { simulateReplayCommand } from './replay-command.js';

describe('simulateReplayCommand (#322)', () => {
  it("names the game's own seed, its seat count and every game option", () => {
    expect(
      simulateReplayCommand({ seed: 'run-3-4', playerCount: 3 }, { deadEnd: 7, hard: true, mode: 'short' }, []),
    ).toBe(
      'boardsmith simulate --replay run-3-4 --players 3 ' +
        '--game-option deadEnd=7 --game-option hard=true --game-option mode=short',
    );
  });

  it('carries the policy flags the game was played with (#556)', () => {
    expect(simulateReplayCommand({ seed: 'run-2-0', playerCount: 2 }, {}, ['greedy', '2=mcts:easy'])).toBe(
      'boardsmith simulate --replay run-2-0 --players 2 --policy greedy --policy 2=mcts:easy',
    );
  });

  it('carries the data files its --compare variant swapped, as one-value --compare flags (#556)', () => {
    expect(simulateReplayCommand({ seed: 'run-2-0', playerCount: 2 }, {}, [], { 'src/rules/data/loot.csv': 'data/loot-85.csv' })).toBe(
      'boardsmith simulate --replay run-2-0 --players 2 --compare src/rules/data/loot.csv=data/loot-85.csv',
    );
  });

  it('quotes an argument a shell would otherwise split or expand', () => {
    expect(simulateReplayCommand({ seed: "it's me-2-0", playerCount: 2 }, { name: 'a b' }, [])).toBe(
      `boardsmith simulate --replay 'it'\\''s me-2-0' --players 2 --game-option 'name=a b'`,
    );
  });

  it('refuses a game option no --game-option flag can express', () => {
    expect(() => simulateReplayCommand({ seed: 's', playerCount: 2 }, { deck: ['a'] }, [])).toThrow(
      /game option "deck".*string, number or true\/false/,
    );
  });
});
