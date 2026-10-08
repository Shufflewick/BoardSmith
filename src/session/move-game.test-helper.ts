/**
 * A one-pawn, three-room game for tests of what happens to a client's open
 * pick when the game tree under it changes (undo, rewind, a new game).
 *
 * Seat 1 moves the pawn to any room it is not standing in, forever. That answer
 * set is exactly what an undo or a new game invalidates. Set `tired` to make
 * `move` disabled with a reason.
 */
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../engine/index.js';

class Pawn extends Piece<MoveGame> {}
class Room extends Space<MoveGame> {}

export class MoveGame extends Game<MoveGame, Player> {
  rooms: Room[] = [];

  /** When true, `move` stays offered but is disabled with a reason. */
  tired = false;

  constructor(options: GameOptions) {
    super(options);

    this.rooms = ['bridge', 'engine', 'hold'].map((n) => this.create(Room, n));
    this.rooms[0].create(Pawn, 'pawn');

    this.registerAction(
      Action.create('move')
        .chooseElement('destination', {
          elements: (ctx) => {
            const game = ctx.game as MoveGame;
            const pawn = game.first(Pawn)!;
            return game.rooms.filter((r) => r !== pawn.parent);
          },
        })
        .disabled((ctx) => ((ctx.game as MoveGame).tired ? 'The crew is resting' : false))
        .execute((args, ctx) => {
          const game = ctx.game as MoveGame;
          game.first(Pawn)!.putInto(args.destination as Room);
          return { success: true };
        })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['move'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 20,
        }),
      })
    );
  }

  pawnRoom(): string {
    return this.first(Pawn)!.parent!.name!;
  }

  /** The element ids of the named rooms, sorted ascending. */
  roomIds(...names: string[]): number[] {
    return names.map((n) => this.rooms.find((r) => r.name === n)!.id).sort((a, b) => a - b);
  }
}
