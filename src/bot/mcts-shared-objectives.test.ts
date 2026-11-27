/**
 * A cooperative game sets `sharedObjectives` (#1838): a playout cut off before
 * the end then scores every seat with the bot's objective score, so a teammate
 * is expected to help the party, not to work against it.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  loop,
  sequence,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotConfig, BotStrategy } from './types.js';

const SEEDS = Array.from({ length: 10 }, (_, i) => `shared-${i}`);

/**
 * Seat 1 opens with `alone` (the party's progress is 0.5) or `hand` (progress
 * 0, and seat 2 then chooses `help`, progress 1, or `hinder`, progress 0).
 * Play goes on with passes far past any playout, so no playout ends the game.
 */
class PartyGame extends Game<PartyGame, Player> {
  progress = 0;
  handed = false;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<PartyGame>('open')
        .chooseFrom('option', { choices: ['alone', 'hand'] })
        .execute((args) => {
          this.handed = args.option === 'hand';
          this.progress = this.handed ? 0 : 0.5;
          return { success: true };
        }),
      Action.create<PartyGame>('reply')
        .chooseFrom('option', { choices: ['help', 'hinder'] })
        .execute((args) => {
          this.progress = args.option === 'help' ? 1 : 0;
          return { success: true };
        }),
      Action.create<PartyGame>('pass')
        .chooseFrom('option', { choices: ['a', 'b'] })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: sequence(
        actionStep({ actions: ['open'], player: (ctx) => ctx.game.getPlayer(1)! }),
        actionStep({
          actions: ['reply'],
          player: (ctx) => ctx.game.getPlayer(2)!,
          skipIf: (ctx) => !(ctx.game as PartyGame).handed,
        }),
        loop({ maxIterations: 100, do: eachPlayer({ do: actionStep({ actions: ['pass'], turnScope: 'restart' }) }) }),
      ),
    });
  }
}

const partyProgress: BotStrategy['objectives'] = () => ({
  progress: { weight: 1, checker: (game) => (game as PartyGame).progress },
});

async function openings(strategy: BotStrategy, config: Partial<BotConfig>): Promise<string[]> {
  const out: string[] = [];
  for (const seed of SEEDS) {
    const game = new PartyGame({ playerCount: 2, seed });
    game.startFlow();
    const bot = new MCTSBot(game, PartyGame, 'party', 1, { async: false, timeout: Infinity, playoutDepth: 2, seed, ...config }, strategy);
    out.push(String((await bot.play())!.args.option));
  }
  return out;
}

const CONFIGS: Array<[string, Partial<BotConfig>]> = [
  ['one search', {}],
  ['parallel searches', { parallel: 2 }],
];

describe.each(CONFIGS)('a cut-off playout in a cooperative game, %s', (_name, config) => {
  it('expects a teammate to help the party when every seat shares the objectives', async () => {
    const shared = await openings({ objectives: partyProgress, sharedObjectives: true }, config);
    expect(shared).toEqual(SEEDS.map(() => 'hand'));
  });

  it('expects any other seat to work against the bot by default', async () => {
    const opposed = await openings({ objectives: partyProgress }, config);
    expect(opposed).toEqual(SEEDS.map(() => 'alone'));
  });
});
