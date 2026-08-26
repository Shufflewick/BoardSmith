import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, defineFlow, loop, actionStep, createSnapshot, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

// ============================================================================
// F-01 (v4.8 CRITICAL, bot-02): MCTS must roll back element-tree mutations
// between iterations. `Piece.putInto` -> `moveToInternal` splices the tree
// directly and records NO command, so the incremental `undoCommands` rollback
// is a no-op for any real game that moves elements. The search game therefore
// accumulates permanent mutations across iterations and evaluates fictional
// states.
//
// A draw game: `draw` moves the chosen card from `deck` into `handA`. Multiple
// cards -> multiple moves -> MCTS actually expands (no single-move short
// circuit). After one EXPAND + BACKPROPAGATE the searchGame must be restored to
// the ROOT position (handA empty, deck full).
// ============================================================================

class DrawGame extends Game<DrawGame, Player> {
  deck!: Space<DrawGame>;
  handA!: Space<DrawGame>;

  constructor(options: GameOptions) {
    super(options);
    this.deck = this.create(Space<DrawGame>, 'deck');
    this.handA = this.create(Space<DrawGame>, 'handA');
    for (let i = 0; i < 3; i++) {
      this.deck.create(Piece<DrawGame>, `card${i}`);
    }

    this.registerAction(
      Action.create<DrawGame>('draw')
        .chooseFrom('card', {
          prompt: 'Draw a card',
          choices: (ctx: any) => (ctx.game as DrawGame).deck.all(Piece),
        })
        .execute((args, ctx) => {
          const card = args.card as Piece<DrawGame>;
          card.putInto((ctx.game as DrawGame).handA);
          return { success: true };
        }),
    );

    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 20,
        do: actionStep({ actions: ['draw'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    }));
  }
}

function createDrawGame(): DrawGame {
  const game = new DrawGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'draw' });
  game.startFlow();
  return game;
}

describe('MCTS element-tree rollback (F-01)', () => {
  it('rolls searchGame back to root after EXPAND + BACKPROPAGATE (element move undone)', () => {
    const game = createDrawGame();
    expect(game.deck.all(Piece).length).toBe(3);
    expect(game.handA.all(Piece).length).toBe(0);

    const bot = new MCTSBot(game, DrawGame, 'draw', 1, [], {
      iterations: 1,
      playoutDepth: 0,
      async: false,
    });

    // Reproduce runSearch's setup up to the iteration body.
    const b = bot as any;
    b.rootSnapshot = b.captureSnapshot();
    b.searchGame = b.restoreGame(b.rootSnapshot);
    b.rootCommandCount = b.searchGame.commandHistory.length;

    const flowState = b.searchGame.getFlowState();
    const moves = b.enumerateAllMoves(b.searchGame, flowState);
    expect(moves.length).toBe(3); // three cards to draw -> real expansion

    const root = b.createNode(flowState, null, null, moves, 0);

    // One iteration: descend (root is leaf), expand one draw, backprop.
    const { leaf } = b.selectWithPath(root);
    const child = b.expandIncremental(leaf);

    // After EXPAND the move must have actually mutated the search tree.
    expect((b.searchGame as DrawGame).handA.all(Piece).length).toBe(1);

    b.backpropagateWithUndo(child, 0.5, [], []);

    // After BACKPROPAGATE the searchGame MUST be back at ROOT state:
    // the drawn card is returned to the deck. Pre-fix this failed because
    // `putInto` records no command, so `undoCommands` never rolled it back.
    const restored = b.searchGame as DrawGame;
    expect(restored.handA.all(Piece).length).toBe(0);
    expect(restored.deck.all(Piece).length).toBe(3);
  });

  it('full search over a draw game returns legal moves without corrupting state', async () => {
    const game = createDrawGame();
    const bot = new MCTSBot(game, DrawGame, 'draw', 1, [], {
      iterations: 40,
      playoutDepth: 4,
      async: false,
    });

    const move = await bot.play();
    expect(move.action).toBe('draw');
    // Live game untouched by the search.
    expect(game.deck.all(Piece).length).toBe(3);
    expect(game.handA.all(Piece).length).toBe(0);
  });
});
