/**
 * Small games shaped like the catalogue's, for the choice cache's tests (#631).
 *
 * Each one changes what is legal in a different way the engine must notice:
 *
 * - {@link DuelGame} is chess's shape: every candidate's `filter` and the
 *   destination `choices` run one whole-position computation
 *   (`legalMoves`), which counts its own runs. Captures move and remove
 *   pieces; `pass` and a flow `execute` change legality by attribute writes
 *   alone; `stun` changes it in `onSelect`, and offers the pawns of every
 *   seat but the one whose turn the flow says it is.
 * - {@link CardsGame} is go-fish's shape: a shuffled deck (random draws), a
 *   `choices` callback that reads an earlier pick, a deep attribute write
 *   (`asked.push`) in `execute`, and a repeating pick whose `onEach` moves
 *   cards.
 * - {@link RememberingDuelGame} is {@link DuelGame} with its whole-position
 *   computation remembered per game state through `oncePerState` (#673).
 */
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  loop,
  eachPlayer,
  actionStep,
  execute,
  sequence,
  type GameOptions,
} from '../index.js';

export class Square extends Space<DuelGame> {
  index!: number;
}

export class Pawn extends Piece<DuelGame> {
  stunned = false;
}

/** A pawn move, as `legalMoves` lists it and the `destination` pick offers it. */
export interface PawnMove {
  pieceId: number;
  from: number;
  to: number;
}

export class DuelGame extends Game<DuelGame, Player> {
  squares: Square[] = [];
  /** How far a pawn steps: 1, or 2 once a `pass` or the round's end flips it. */
  stride = 1;
  round = 0;
  /** Runs of the whole-position computation, for the tests to count. */
  legalMovesRuns = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Square, Pawn]);
    for (let index = 0; index < 8; index++) this.squares.push(this.create(Square, `s${index}`, { index }));
    for (const [seat, squares] of [[1, [0, 1]], [2, [6, 7]]] as const) {
      for (const at of squares) {
        this.squares[at].create(Pawn, `p${seat}-${at}`, { player: this.getPlayer(seat)! });
      }
    }

    this.registerAction(
      Action.create<DuelGame>('move')
        .chooseElement('piece', {
          elementClass: Pawn,
          filter: (pawn, ctx) => ctx.game.legalMoves(ctx.player).some((m) => m.pieceId === pawn.id),
        })
        .chooseFrom('destination', {
          choices: (ctx) => ctx.game.legalMoves(ctx.player),
          display: (move) => `s${move.to}`,
          filterBy: { key: 'pieceId', selectionName: 'piece' },
        })
        .execute((args, ctx) => {
          const game = ctx.game;
          const move = args.destination as PawnMove;
          const target = game.squares[move.to];
          for (const enemy of target.all(Pawn)) enemy.remove();
          (args.piece as Pawn).putInto(target);
          return { success: true };
        }),
    );
    this.registerAction(
      Action.create<DuelGame>('pass').execute((_args, ctx) => {
        ctx.game.stride = ctx.game.stride === 1 ? 2 : 1;
        return { success: true };
      }),
    );
    this.registerAction(
      Action.create<DuelGame>('stun')
        .chooseElement('target', {
          elementClass: Pawn,
          filter: (pawn, ctx) => pawn.player.seat !== ctx.game.getFlowState()?.currentPlayer && !pawn.stunned,
          onSelect: (pawn) => {
            (pawn as Pawn).stunned = true;
          },
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow({
      root: loop({
        while: (ctx) => (ctx.game as DuelGame).round < 40,
        maxIterations: 40,
        do: sequence(
          eachPlayer({ do: actionStep({ actions: ['move', 'pass', 'stun'] }) }),
          execute((ctx) => {
            const game = ctx.game as DuelGame;
            game.round++;
            if (game.round % 3 === 0) {
              for (const pawn of game.all(Pawn)) pawn.stunned = false;
              game.stride = 1;
            }
          }),
        ),
      }),
    });
  }

  /** Every pawn move `player` can make: the whole-position computation. */
  legalMoves(player: Player): PawnMove[] {
    this.legalMovesRuns++;
    const direction = player.seat === 1 ? 1 : -1;
    const moves: PawnMove[] = [];
    for (const pawn of this.all(Pawn)) {
      if (pawn.player !== player || pawn.stunned) continue;
      const from = (pawn._t.parent as Square).index;
      const to = from + direction * this.stride;
      if (to < 0 || to > 7) continue;
      const blocker = this.squares[to].first(Pawn);
      if (blocker && blocker.player === player) continue;
      moves.push({ pieceId: pawn.id, from, to });
    }
    return moves;
  }
}

/** {@link DuelGame} with each seat's legal moves worked out once per game state (#673). */
export class RememberingDuelGame extends DuelGame {
  override legalMoves(player: Player): PawnMove[] {
    return this.oncePerState(`legalMoves:${player.seat}`, () => super.legalMoves(player));
  }
}

export class Card extends Piece<CardsGame> {
  rank!: string;
}

export class Hand extends Space<CardsGame> {}
export class Pile extends Space<CardsGame> {}

export class CardsGame extends Game<CardsGame, Player> {
  deck!: Pile;
  discards!: Pile;
  /** Every ask so far, as `asker:target:rank`, written in place by `execute`. */
  asked: string[] = [];
  round = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Hand, Pile]);
    this.deck = this.create(Pile, 'deck');
    this.discards = this.create(Pile, 'discards');
    for (const rank of ['A', 'B', 'C', 'D']) {
      for (let copy = 0; copy < 3; copy++) this.deck.create(Card, `${rank}${copy}`, { rank });
    }
    for (const player of this.players) this.create(Hand, `hand-${player.seat}`, { player });

    this.registerAction(
      Action.create<CardsGame>('ask')
        .chooseFrom('target', {
          choices: (ctx) =>
            ctx.game.players.filter((p) => p !== ctx.player && ctx.game.handOf(p).all(Card).length > 0).map((p) => p.seat),
        })
        .chooseFrom('rank', {
          // Reads the earlier pick: a rank already asked of this target is not offered again.
          choices: (ctx) => {
            const ranks = [...new Set(ctx.game.handOf(ctx.player).all(Card).map((c) => c.rank))];
            return ranks.filter((rank) => !ctx.game.asked.includes(`${ctx.player.seat}:${ctx.args.target}:${rank}`));
          },
        })
        .execute((args, ctx) => {
          const game = ctx.game;
          const target = game.getPlayer(args.target as number)!;
          game.asked.push(`${ctx.player.seat}:${target.seat}:${args.rank}`);
          const matches = game.handOf(target).all(Card).filter((c) => c.rank === args.rank);
          if (matches.length > 0) for (const card of matches) card.putInto(game.handOf(ctx.player));
          else game.deck.first(Card)?.putInto(game.handOf(ctx.player));
          return { success: true };
        }),
    );
    this.registerAction(
      Action.create<CardsGame>('draw').execute((_args, ctx) => {
        ctx.game.deck.first(Card)?.putInto(ctx.game.handOf(ctx.player));
        return { success: true };
      }),
    );
    this.registerAction(
      Action.create<CardsGame>('discard')
        .condition({ 'two cards in hand': (ctx) => ctx.game.handOf(ctx.player).all(Card).length >= 2 })
        .chooseElement('cards', {
          elementClass: Card,
          from: (ctx) => ctx.game.handOf(ctx.player),
          repeat: {
            until: (ctx) => ctx.game.discards.all(Card).length % 2 === 0,
            onEach: (ctx, card) => {
              card.putInto(ctx.game.discards);
            },
          },
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow({
      root: sequence(
        execute((ctx) => {
          const game = ctx.game as CardsGame;
          game.deck.shuffle();
          for (const player of game.players) {
            for (let dealt = 0; dealt < 3; dealt++) game.deck.first(Card)?.putInto(game.handOf(player));
          }
        }),
        loop({
          while: (ctx) => (ctx.game as CardsGame).round < 12,
          maxIterations: 12,
          do: sequence(
            eachPlayer({ do: actionStep({ actions: ['ask', 'draw', 'discard'] }) }),
            execute((ctx) => {
              (ctx.game as CardsGame).round++;
            }),
          ),
        }),
      ),
    });
  }

  handOf(player: Player): Hand {
    return this.first(Hand, { player })!;
  }
}
