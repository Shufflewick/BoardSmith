import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  simultaneousActionStep,
  enumerateLegalMoves,
  RedactedAttributeError,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

// ============================================================================
// #19: MCTS enumerates OTHER seats' moves inside its own redacted clone.
//
// Under a simultaneous step the sandbox is awaiting every seat, so the bot
// enumerates its opponents' moves as a matter of course, not as an edge case.
// Their withheld attributes are genuinely unknown in there — and used to come
// back as class-field defaults, so the search either crashed on a rule the
// default violated (the lucky case) or scored a world that does not exist.
//
// This is the case the reporting port said no existing test in either codebase
// covered: enumeration for a NON-BOT seat inside a `forSeat` sandbox.
// ============================================================================

class Scout extends Player<TravelGame, Scout> {
  static override visibleAttributes = ['seat', 'name', 'status'];
  /** Withheld. `0` is a real, and in this game illegal, sector. */
  loc = 0;
  /** Withheld. `[]` is a real (empty) pack. */
  pack: string[] = [];
}

/**
 * The reporting game's shape: sector 0 is the impassible border ring, so a
 * character standing there is not a state the rules can answer questions
 * about — the invariant guard that made this defect visible at all.
 */
function stepsFrom(loc: number): number[] {
  if (loc <= 0) {
    throw new Error(`stepsFrom(${loc}): sector ${loc} is not a place any scout can legally stand.`);
  }
  return [loc - 1, loc + 1];
}

class TravelGame extends Game<TravelGame, Scout> {
  static override PlayerClass = Scout;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('travel')
        .condition({
          'scout has a position': (ctx) => (ctx.player as Scout).loc > 0,
        })
        .chooseFrom('to', {
          prompt: 'Where to?',
          choices: (ctx) => stepsFrom((ctx.player as Scout).loc),
        })
        .execute((args, ctx) => {
          (ctx.player as Scout).loc = args.to as number;
          return { success: true };
        })
    );

    this.registerAction(
      Action.create('trade')
        // No condition: the hidden read is in `choices` alone, which is the
        // hook the engine already documents as the redaction-aware one.
        .chooseFrom('item', {
          prompt: 'Trade what?',
          choices: (ctx) => (ctx.player as Scout).pack,
        })
        .execute(() => ({ success: true }))
    );

    this.registerAction(
      Action.create('camp')
        // Available to everyone, and refused for a scout who is already home —
        // a rule stated in `.validate()`, which reads a withheld attribute.
        .validate((_args, ctx) => ((ctx.player as Scout).loc === 1 ? 'You are already home.' : true))
        .execute(() => ({ success: true }))
    );

    this.registerAction(
      Action.create('pass')
        .execute(() => ({ success: true }))
    );

    this.setFlow(defineFlow({
      root: simultaneousActionStep({
        actions: ['travel', 'trade', 'camp', 'pass'],
        playerDone: () => false,
      }),
      isComplete: () => false,
      getWinners: () => [],
    }));
  }
}

function createTravelGame(seed: string): TravelGame {
  const game = new TravelGame({ playerCount: 2, playerNames: ['Bot', 'Rival'], seed });
  game.getPlayer(1)!.loc = 11;
  game.getPlayer(1)!.pack = ['rope'];
  game.getPlayer(2)!.loc = 22;
  game.getPlayer(2)!.pack = ['flint'];
  game.startFlow();
  return game;
}

/** The bot's own search sandbox: seat 1's redacted view, restored as a live game. */
function sandboxFor(game: TravelGame, seat: number): TravelGame {
  const bot = new MCTSBot(
    game,
    TravelGame,
    'travel',
    seat,
    [],
    { iterations: 20, playoutDepth: 0, seed: 'sandbox', async: false, usePNS: false },
    { objectives: () => ({ nothing: { weight: 1, checker: () => 0 } }) },
  );
  return (bot as any).restoreGame((bot as any).captureSnapshot()) as TravelGame;
}

describe('#19: enumerating another seat\'s moves inside a redacted search sandbox', () => {
  it('the sandbox knows it does not know where the rival stands', () => {
    const sandbox = sandboxFor(createTravelGame('s1'), 1);

    expect(sandbox.getPlayer(2)!.isAttributeRedacted('loc')).toBe(true);
    expect(() => sandbox.getPlayer(2)!.loc).toThrow(RedactedAttributeError);
    expect(sandbox.getPlayer(1)!.loc).toBe(11);
  });

  it('enumerates no move for an action whose gates cannot be answered without the withheld value', () => {
    const sandbox = sandboxFor(createTravelGame('s2'), 1);

    const moves = enumerateLegalMoves(sandbox, 2);

    expect(moves.map((m) => m.action)).toEqual(['pass']);
  });

  it('still enumerates the bot\'s own moves in full', () => {
    const sandbox = sandboxFor(createTravelGame('s3'), 1);

    const moves = enumerateLegalMoves(sandbox, 1);
    const byAction = new Set(moves.map((m) => m.action));

    expect(byAction).toEqual(new Set(['travel', 'trade', 'camp', 'pass']));
    expect(moves.filter((m) => m.action === 'travel').map((m) => m.args.to).sort()).toEqual([10, 12]);
  });

  it('enumerates every action once the rival\'s position becomes known in the sandbox', () => {
    // Redaction is the only reason the moves were missing, so supplying the
    // value brings them straight back — no redaction-aware game code involved.
    const sandbox = sandboxFor(createTravelGame('s4'), 1);
    sandbox.getPlayer(2)!.loc = 5;
    sandbox.getPlayer(2)!.pack = ['flint'];

    const byAction = new Set(enumerateLegalMoves(sandbox, 2).map((m) => m.action));

    expect(byAction).toEqual(new Set(['travel', 'trade', 'camp', 'pass']));
  });

  it('the bot\'s own enumeration reads the same gates enumerateLegalMoves does', () => {
    // The bot used to enumerate through a loop of its own, which read neither
    // `condition` nor `validate` — so it played moves the engine then refused
    // and the pump halted on the rejection. Both loops now share one gated
    // enumerator, so a move the bot can reach is a move performAction accepts.
    const game = createTravelGame('s6');
    game.getPlayer(1)!.loc = 1; // `camp` refuses a scout who is already home
    const bot = new MCTSBot(
      game,
      TravelGame,
      'travel',
      1,
      [],
      { iterations: 10, playoutDepth: 0, seed: 's6', async: false, usePNS: false },
      { objectives: () => ({ nothing: { weight: 1, checker: () => 0 } }) },
    );

    const moves = (bot as any).enumerateMovesInternal(game, game.getFlowState()!, true) as Array<{ action: string }>;

    expect(moves.map((m) => m.action)).not.toContain('camp');
    expect(moves.map((m) => m.action)).toContain('travel');
  });

  it('runs a full search over a simultaneous step without the game writing redaction-aware code', async () => {
    const game = createTravelGame('s5');
    const bot = new MCTSBot(
      game,
      TravelGame,
      'travel',
      1,
      [],
      { iterations: 30, playoutDepth: 2, seed: 's5', async: false, usePNS: false },
      { objectives: () => ({ home: { weight: 1, checker: (g) => ((g as TravelGame).getPlayer(1)!.loc > 10 ? 1 : 0) } }) },
    );

    const move = await bot.play();

    expect(move).not.toBeNull();
    expect(['travel', 'trade', 'camp', 'pass']).toContain(move!.action);
  });
});
