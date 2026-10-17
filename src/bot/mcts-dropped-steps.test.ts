/**
 * A search that throws most of its steps away says so (#669).
 *
 * A step is thrown away when a move the search made changed the game and then
 * failed, which is what happens when a game's flow reads a card the bot's seat
 * cannot see and the game declares no `determinize` sampler. Cribbage cuts its
 * starter that way after the simultaneous discard, and every step of its search
 * was thrown away without a word. In development mode the search now warns,
 * once per search, when at least half of its steps were thrown away.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Game,
  Player,
  Space,
  Piece,
  Action,
  sequence,
  execute,
  loop,
  eachPlayer,
  actionStep,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotStrategy } from './types.js';

class Card extends Piece<CutGame> {
  rank!: number;
}

class Hand extends Space<CutGame> {}

/**
 * Each seat discards one card from a hand only it can see, at the same time,
 * and then the flow cuts a starter from a deck whose cards nobody can see,
 * reading its rank.
 */
class CutGame extends Game<CutGame, Player> {
  deck!: Space<CutGame>;
  crib!: Space<CutGame>;
  starterRank?: number;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand]);

    this.deck = this.create(Space<CutGame>, 'deck');
    this.deck.contentsCountOnly();
    for (let rank = 1; rank <= 8; rank++) this.deck.create(Card, `card-${rank}`, { rank });

    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      for (let i = 0; i < 3; i++) this.deck.first(Card)!.putInto(hand);
    }

    this.crib = this.create(Space<CutGame>, 'crib');
    this.crib.contentsHidden();

    this.registerAction(
      Action.create<CutGame>('discard')
        .chooseElements('card', {
          prompt: 'Put a card in the crib',
          elements: (ctx) => [...(ctx.game as CutGame).handOf(ctx.player.seat).all(Card)],
          multiSelect: { min: 1, max: 1 },
        })
        .execute((args, ctx) => {
          for (const card of args.card as Card[]) card.putInto((ctx.game as CutGame).crib);
          return { success: true };
        }),
    );

    this.setFlow({
      root: sequence(
        simultaneousActionStep({
          actions: ['discard'],
          playerDone: (ctx, player) => (ctx.game as CutGame).handOf(player.seat).count(Card) <= 2,
        }),
        execute((ctx) => {
          const game = ctx.game as CutGame;
          game.starterRank = game.deck.first(Card)!.rank;
        }),
      ),
    });
  }

  override isFinished(): boolean {
    return super.isFinished() || this.starterRank !== undefined;
  }

  handOf(seat: number): Hand {
    return this.first(Hand, `hand-${seat}`)!;
  }
}

/** Supposes a rank for every card the seat cannot see. */
const supposeRanks: BotStrategy = {
  determinize: (sandbox) => {
    for (const card of sandbox.all(Card)) {
      if (card.isAttributeRedacted('rank')) card.rank = 1;
    }
  },
};

const ITERATIONS = 40;

function newRunner() {
  const runner = new GameRunner({
    GameClass: CutGame,
    gameType: 'cut',
    gameOptions: { playerCount: 2, seed: 'cut-seed', elementIdKey: '0669066906690669' },
  });
  runner.start();
  return runner;
}

async function searchFor(runner: ReturnType<typeof newRunner>, strategy?: BotStrategy, parallel = 1) {
  const bot = new MCTSBot(
    runner.game, CutGame, 'cut', 1, runner.actionHistory,
    { iterations: ITERATIONS, playoutDepth: 4, async: false, timeout: Infinity, seed: 'cut-bot', parallel },
    strategy,
  );
  return bot.play();
}

/** The warnings the search gave about thrown-away steps. */
function droppedStepWarnings(warn: ReturnType<typeof vi.spyOn>): string[] {
  return warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('thrown away'));
}

/** Whether `isDevMode()` answers as a production build does, for one test. */
const mode = vi.hoisted(() => ({ production: false }));

vi.mock('../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dev.js')>();
  return { ...actual, isDevMode: () => !mode.production && actual.isDevMode() };
});

function inProductionMode() {
  mode.production = true;
}

afterEach(() => {
  vi.restoreAllMocks();
  mode.production = false;
});

describe('a search that throws away its steps', () => {
  it('warns once with how many steps were thrown away, the hidden read and what to do', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await searchFor(newRunner());

    const warnings = droppedStepWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`${ITERATIONS} of ${ITERATIONS} search steps were thrown away`);
    expect(warnings[0]).toContain('"rank" on Card');
    expect(warnings[0]).toContain('is not known here');
    expect(warnings[0]).toContain('determinize');
    expect(warnings[0]).toContain('docs/bot-system.md');
    // The bot's own discard grew children here, so it did not fall back to a random move.
    expect(warnings[0]).not.toContain('at random');
  });

  it('says the move was chosen at random when no move at the root could be played through', async () => {
    const runner = newRunner();
    // Seat 2 has discarded, so every discard of the bot's closes the step and cuts the starter.
    const seat2Card = runner.game.handOf(2).first(Card)!;
    expect(runner.performAction('discard', 2, { card: [seat2Card.id] }).success).toBe(true);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const move = await searchFor(runner);

    expect(move).not.toBeNull();
    const warnings = droppedStepWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`${ITERATIONS} of ${ITERATIONS} search steps were thrown away`);
    expect(warnings[0]).toContain('No move at the root could be played through, so the bot chose its move at random');
  });

  it('warns once for a bot that splits its move into sub-searches, with their steps added up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await searchFor(newRunner(), undefined, 2);

    const warnings = droppedStepWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`${ITERATIONS} of ${ITERATIONS} search steps were thrown away`);
  });

  it('chooses the same move whether or not it warns', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inDevelopment = await searchFor(newRunner());
    inProductionMode();
    const inProduction = await searchFor(newRunner());
    expect(inProduction).toEqual(inDevelopment);
  });

  it('does not warn in production', async () => {
    inProductionMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await searchFor(newRunner());
    expect(droppedStepWarnings(warn)).toEqual([]);
  });

  it('does not warn when the game declares a sampler for the hidden cards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await searchFor(newRunner(), supposeRanks);
    expect(droppedStepWarnings(warn)).toEqual([]);
  });
});

/** Seat 1 picks `a` or `b`; the game refuses `refused` cleanly, changing nothing. */
function refusingGame(refused: string[]) {
  return class RefusingGame extends Game<RefusingGame, Player> {
    constructor(options: GameOptions) {
      super(options);
      this.registerAction(
        Action.create<RefusingGame>('draw')
          .chooseFrom('bucket', { prompt: 'Draw from', choices: ['a', 'b'] })
          .execute((args) => (refused.includes(args.bucket as string)
            ? { success: false, error: 'The well is dry.' }
            : { success: true })),
      );
      this.setFlow({
        root: loop({ maxIterations: 100, do: eachPlayer({ do: actionStep({ actions: ['draw'] }) }) }),
      });
    }
  };
}

async function searchRefusing(refused: string[], parallel = 1) {
  const GameClass = refusingGame(refused);
  const game = new GameClass({ playerCount: 2, seed: 'refusing' });
  game.startFlow();
  const bot = new MCTSBot(
    game, GameClass, 'refusing', 1, [],
    { iterations: ITERATIONS, playoutDepth: 4, async: false, timeout: Infinity, seed: 'refusing-bot', parallel },
  );
  return bot.play();
}

/** The warnings the search gave about choosing its move at random. */
function randomChoiceWarnings(warn: ReturnType<typeof vi.spyOn>): string[] {
  return warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('at random'));
}

describe('a search whose every move at the root was refused (#874)', () => {
  it('warns once that the bot chose at random, with the refusal and what to check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await searchRefusing(['a', 'b']);

    const warnings = randomChoiceWarnings(warn);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('refused every move');
    expect(warnings[0]).toContain('chose its move at random');
    expect(warnings[0]).toContain('The well is dry.');
    expect(warnings[0]).toContain('success: false');
  });

  it('warns once for a bot that splits its move into sub-searches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await searchRefusing(['a', 'b'], 2);
    expect(randomChoiceWarnings(warn)).toHaveLength(1);
  });

  it('does not warn when some move at the root could be played', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await searchRefusing(['a']);
    expect(randomChoiceWarnings(warn)).toEqual([]);
  });

  it('does not warn in production', async () => {
    inProductionMode();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await searchRefusing(['a', 'b']);
    expect(randomChoiceWarnings(warn)).toEqual([]);
  });
});
