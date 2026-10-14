/**
 * `boardsmith evolve-bot-weights` plays the game as players get it (#701): with
 * every option the project's boardsmith.json declares, at its default, as every
 * host starts it. A game reads `options.x` without a fallback of its own, so a
 * benchmark that left the options out would play a game no host ever starts.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkBot, weightedBot } from './benchmark.js';
import { Game, Player, Action, eachPlayer, actionStep, type GameOptions } from '../engine/index.js';
import { tempTree } from '../testing/temp-tree.test-helper.js';

/** Refuses to start without the `rounds` option boardsmith.json declares. */
class RoundsGame extends Game<RoundsGame, Player> {
  constructor(options: GameOptions & { rounds?: number }) {
    super(options);
    if (options.rounds !== 2) throw new Error(`started with rounds ${String(options.rounds)}, not its default of 2`);
    this.registerAction(Action.create<RoundsGame>('move').execute(() => ({ success: true })));
    this.setFlow({ root: eachPlayer({ do: actionStep({ actions: ['move'] }) }) });
  }
}

const home = process.cwd();
afterEach(() => process.chdir(home));

describe('the bot benchmark starts the game with the options boardsmith.json declares (#701)', () => {
  it('plays every game with each option at its default', async () => {
    const dir = tempTree('bs-benchmark-options-');
    writeFileSync(
      join(dir, 'boardsmith.json'),
      JSON.stringify({ name: 'rounds', backend: 'table', gameOptions: [{ id: 'rounds', type: 'number', label: 'Rounds', default: 2 }] }),
    );
    process.chdir(dir);
    const result = await benchmarkBot(RoundsGame, 'rounds', undefined, [], { gameCount: 2, mctsIterations: 1, maxActions: 4, seed: 'r' });
    expect(result.failures).toEqual([]);
    expect(result.gamesPlayed).toBe(2);
    const objectives = () => ({});
    expect(() => weightedBot(RoundsGame, 'rounds', { objectives }, [{ id: 'none', weight: 1 }])).not.toThrow(/rounds/);
  });
});
