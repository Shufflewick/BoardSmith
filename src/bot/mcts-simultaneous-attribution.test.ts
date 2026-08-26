import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  simultaneousActionStep,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

// ============================================================================
// Co-decider seat attribution inside a simultaneous step (`createNode`).
//
// `createNode` used to derive node ownership from `flowState.currentPlayer`,
// but that field NEVER advances inside a `simultaneousActionStep` -- the engine
// tracks per-seat progress in `awaitingPlayers` instead. So every co-decider
// node was attributed to the BOT's own seat, and `selectChild` (`isBotTurn`)
// plus `backpropagateWithUndo` (`isOurPerspective`) then read the OPPONENT's
// simultaneous decision as the bot's own. The search became max-max optimistic:
// it assumed the opponent would pick whatever suited the bot, and never
// explored the refutation. The fix resolves the awaiting seat via
// `getCurrentPlayerFromFlowState`.
//
// Drives MCTSBot directly against an in-file Game subclass (per
// mcts-restore.test.ts / mcts-redaction.test.ts) -- never the excluded,
// checkers-dependent mcts-bot.test.ts.
// ============================================================================

// ----------------------------------------------------------------------------
// Fixture: a 3x3 simultaneous payoff matrix with one DOMINATED gamble.
//
//   bot 'safe'   -> draw (0.5) against every opponent pick
//   bot 'gamble' -> win vs opponent 'x'/'y', LOSE vs opponent 'z'
//   bot 'dud'    -> lose against every opponent pick
//
// Three bot moves so MCTSBot's 1-move short-circuit (`runSearch`) cannot bypass
// the tree search. Against an opponent modeled as an ADVERSARY, 'gamble' is
// refuted by 'z', so the sound pick is 'safe'. Against an opponent modeled as
// the bot's own cooperating self (the attribution bug), 'gamble' looks like a
// near-certain win and the bot takes it -- so the bot's chosen move is a direct
// behavioural read-out of which seat the co-decider node was attributed to.
// ----------------------------------------------------------------------------

class Mark extends Piece<PayoffMatrixGame> {
  pick!: string;
  owner!: number;
}

class PayoffMatrixGame extends Game<PayoffMatrixGame, Player> {
  board!: Space<PayoffMatrixGame>;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Mark]);
    this.board = this.create(Space<PayoffMatrixGame>, 'board');

    this.registerAction(
      Action.create('commit')
        .chooseFrom('pick', {
          prompt: 'Commit secretly',
          choices: (ctx) =>
            ctx.player.seat === 1 ? ['safe', 'gamble', 'dud'] : ['x', 'y', 'z'],
        })
        .execute((args, ctx) => {
          (ctx.game as PayoffMatrixGame).board.create(Mark, 'mark', {
            pick: args.pick as string,
            owner: ctx.player.seat,
          });
          return { success: true };
        })
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({
          actions: ['commit'],
          playerDone: (ctx, player) =>
            (ctx.game as PayoffMatrixGame).board.all(Mark).some((m) => m.owner === player.seat),
        }),
        isComplete: (ctx) => (ctx.game as PayoffMatrixGame).board.all(Mark).length >= 2,
        getWinners: (ctx) => {
          const game = ctx.game as PayoffMatrixGame;
          const bot = game.board.all(Mark).find((m) => m.owner === 1)?.pick;
          const opp = game.board.all(Mark).find((m) => m.owner === 2)?.pick;
          if (bot === 'gamble' && opp !== 'z') return [game.getPlayer(1)!];
          if (bot === 'safe') return []; // draw
          return [game.getPlayer(2)!]; // 'dud', or 'gamble' refuted by 'z'
        },
      })
    );
  }
}

/**
 * `timeout: Infinity` is required for determinism: the default 2000ms
 * wall-clock timeout overrides `iterations`, so a loaded machine would truncate
 * the search and pick a different move (mcts-bot.ts warns about exactly this).
 * Bounding by iterations alone makes seed + iteration count fully reproducible.
 */
function searchPayoffMatrix() {
  const game = new PayoffMatrixGame({
    playerCount: 2,
    playerNames: ['Bot', 'Opponent'],
    seed: 'payoff-matrix',
  });
  game.startFlow();

  const bot = new MCTSBot(game, PayoffMatrixGame, 'payoff-matrix', 1, [], {
    iterations: 600,
    playoutDepth: 4,
    seed: 'payoff-matrix',
    timeout: Infinity,
    async: false,
    useTranspositionTable: false,
  });

  // `runSearch` is the shared primitive behind play()/playWithStats(); it also
  // returns the root node, which is the only way to read the per-node seat
  // attribution this suite is about.
  return (bot as unknown as {
    runSearch(): Promise<{ move: { action: string; args: Record<string, unknown> }; root: any }>;
  }).runSearch();
}

describe('MCTSBot simultaneous co-decider seat attribution', () => {
  it('attributes a co-decider node to the AWAITING opponent seat, not the bot', async () => {
    const { root } = await searchPayoffMatrix();

    // Sanity: the tree search really ran (no 1-move short-circuit).
    expect(root.children.length).toBe(3);

    // Each root child is the state AFTER the bot (seat 1) committed, where the
    // still-awaiting co-decider is seat 2. `flowState.currentPlayer` is stuck at
    // 1 for the whole simultaneous step, so this is 1 for every child pre-fix.
    for (const child of root.children) {
      expect(child.currentPlayer).toBe(2);
    }
  });

  it('does not take a gamble the opponent can refute (opponent modeled as adversary)', async () => {
    const { move, root } = await searchPayoffMatrix();

    expect(root.children.length).toBe(3);

    // Pre-fix the co-decider was modeled as the bot's own cooperating self, so
    // 'gamble' evaluated to ~0.998 (the refutation 'z' was visited once in 600
    // iterations) and the bot took it. Post-fix seat 2 minimises for the bot,
    // 'z' is found immediately, and the search settles on the drawing 'safe'.
    expect(move.action).toBe('commit');
    expect(move.args.pick).not.toBe('gamble');
    expect(move.args.pick).toBe('safe');

    // The search effort must concentrate on the sound move, not the refuted one.
    const byPick = new Map<string, number>(
      root.children.map((c: any) => [c.parentMove.args.pick as string, c.visits as number])
    );
    expect(byPick.get('safe')!).toBeGreaterThan(byPick.get('gamble')!);
  });
});
