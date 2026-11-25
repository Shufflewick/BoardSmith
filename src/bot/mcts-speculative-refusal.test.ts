/**
 * A pick the engine refuses inside the bot's search is not a player's refused
 * pick, so it logs no "Invalid selection" warning (#1809). In a simultaneous
 * step a seat's own copy can draw differently from the search world once
 * another seat has drawn from a shared deck (#1570), so the world refuses some
 * of that seat's listed keeps. Each one used to warn as if a live player had
 * sent it, burying the refusals a player really made.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Player, Space, Piece, Action, simultaneousActionStep, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';
import { searchCopyForSeat } from './search-copy.js';

class Card extends Piece<DrawGame> {}

/** Each seat draws from either end of a shared two-card deck, then keeps a card from its own hand. */
class DrawGame extends Game<DrawGame, Player> {
  deck!: Space<DrawGame>;
  kept: number[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card]);
    this.deck = this.create(Space<DrawGame>, 'deck');
    this.deck.create(Card, 'ace');
    this.deck.create(Card, 'king');
    for (const player of this.all(Player)) this.create(Space<DrawGame>, `hand-${player.seat}`);

    this.registerActions(
      Action.create<DrawGame>('draw')
        .condition({ 'hand is empty': (ctx) => (ctx.game as DrawGame).handOf(ctx.player.seat).count(Card) === 0 })
        .chooseFrom('end', { choices: () => ['top', 'bottom'] })
        .execute((args, ctx) => {
          const game = ctx.game as DrawGame;
          const card = args.end === 'top' ? game.deck.first(Card)! : game.deck.last(Card)!;
          card.putInto(game.handOf(ctx.player.seat));
        }),
      Action.create<DrawGame>('keep')
        .chooseElement('card', { elements: (ctx) => [...(ctx.game as DrawGame).handOf(ctx.player.seat).all(Card)] })
        .execute((_args, ctx) => {
          (ctx.game as DrawGame).kept.push(ctx.player.seat);
        }),
    );
    this.setFlow({
      root: simultaneousActionStep<DrawGame>({
        actions: ['draw', 'keep'],
        playerDone: (ctx, player) => (ctx.game as DrawGame).kept.includes(player.seat),
      }),
    });
  }

  override isFinished(): boolean {
    return super.isFinished() || this.kept.length === this.players.length;
  }

  handOf(seat: number): Space<DrawGame> {
    return this.first(Space<DrawGame>, `hand-${seat}`)!;
  }
}

function newGame(): DrawGame {
  const game = new DrawGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'draw' });
  game.startFlow();
  return game;
}

const invalidSelectionWarnings = () =>
  vi.spyOn(console, 'warn').mockImplementation(() => {});

const warned = (spy: ReturnType<typeof invalidSelectionWarnings>) =>
  spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('Invalid selection'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a pick refused inside the bot search (#1809)', () => {
  it('logs no player warning while the search refuses keeps its seat copy listed', async () => {
    const game = newGame();
    const refusals: string[] = [];
    const original = Game.prototype.continueFlow;
    vi.spyOn(Game.prototype, 'continueFlow').mockImplementation(function (this: Game, ...args: Parameters<Game['continueFlow']>) {
      const state = original.apply(this, args);
      if (state.actionError && this !== game) refusals.push(state.actionError);
      return state;
    });
    const warn = invalidSelectionWarnings();

    const move = await new MCTSBot(game, DrawGame, 'draw', 1, { iterations: 200, playoutDepth: 6, seed: 'draw', timeout: Infinity }).play();

    expect(refusals.length).toBeGreaterThan(0);
    expect(warned(warn)).toEqual([]);
    expect(game.continueFlow(move.action, move.args, 1).actionError).toBeUndefined();
  });

  it('still warns when the live game refuses a pick', () => {
    const game = newGame();
    game.continueFlow('draw', { end: 'top' }, 1);
    const kingId = game.deck.first(Card)!.id;
    const warn = invalidSelectionWarnings();

    expect(game.continueFlow('keep', { card: kingId }, 1).actionError).toBeDefined();
    expect(warned(warn)).toHaveLength(1);
  });

  it('logs no player warning for a pick refused in a game\'s own search copy', () => {
    const copy = searchCopyForSeat(newGame(), 1, 'draw');
    copy.continueFlow('draw', { end: 'top' }, 1);
    const warn = invalidSelectionWarnings();

    expect(copy.continueFlow('keep', { card: copy.deck.first(Card)!.id }, 1).actionError).toBeDefined();
    expect(warned(warn)).toEqual([]);
  });
});
