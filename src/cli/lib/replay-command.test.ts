import { describe, it, expect } from 'vitest';
import { simulateReplayCommand } from './replay-command.js';

describe('simulateReplayCommand (#322)', () => {
  it("names the game's own seed, its seat count and every game option", () => {
    expect(
      simulateReplayCommand({ seed: 'run-3-4', playerCount: 3 }, { deadEnd: 7, hard: true, mode: 'short' }),
    ).toBe(
      'boardsmith simulate --replay run-3-4 --players 3 ' +
        '--game-option deadEnd=7 --game-option hard=true --game-option mode=short',
    );
  });

  it('quotes an argument a shell would otherwise split or expand', () => {
    expect(simulateReplayCommand({ seed: "it's me-2-0", playerCount: 2 }, { name: 'a b' })).toBe(
      `boardsmith simulate --replay 'it'\\''s me-2-0' --players 2 --game-option 'name=a b'`,
    );
  });

  it('refuses a game option no --game-option flag can express', () => {
    expect(() => simulateReplayCommand({ seed: 's', playerCount: 2 }, { deck: ['a'] })).toThrow(
      /game option "deck".*string, number or true\/false/,
    );
  });
});
