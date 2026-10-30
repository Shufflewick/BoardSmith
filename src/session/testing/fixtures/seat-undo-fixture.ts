/**
 * A simultaneous SECRET deployment whose step undoes per seat (#1526): every
 * seat places packs only it may see, and each seat's undo takes back its own
 * last action, one at a time, whatever the other seat did meanwhile.
 *
 *  - `placePack` changes only the seat's own Player: `packs`, which
 *    `static visibleAttributes` withholds from every other seat. It writes a
 *    log line and plays an animation only that seat may see.
 *  - `stashToken` creates an element inside the seat's own Player.
 *  - `done` is public (`isDone` is visible) and ends the seat's part, and it is
 *    undoable, so an undo after it puts the seat back in the step.
 *  - Each of the rest changes something outside the seat's own Player, so it
 *    cannot be taken back on its own: `draftPack` takes from the shared
 *    `supply`, `rollPack` draws a random number, `announcePack` writes a public
 *    log line, `raidPack` takes a pack from the other seat's `Player`.
 *    `burnPack` is `.notUndoable()`.
 *  - `pickPack` takes a pick whose `onSelect` takes from the shared `supply`
 *    before the action runs. `pairPack` takes two picks, so a seat can be
 *    left halfway through it.
 */

import {
  Game,
  Player,
  Piece,
  Action,
  sequence,
  simultaneousActionStep,
  actionStep,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class SeatUndoToken extends Piece<SeatUndoGame, SeatUndoPlayer> {}

class SeatUndoPlayer extends Player<SeatUndoGame, SeatUndoPlayer> {
  static override visibleAttributes = ['isDone'];
  packs = 0;
  isDone = false;
}

class SeatUndoGame extends Game<SeatUndoGame, SeatUndoPlayer> {
  static override PlayerClass = SeatUndoPlayer;
  supply = 10;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([SeatUndoToken]);

    const notDone = { 'has not declared done': (ctx: { player: Player }) => !(ctx.player as SeatUndoPlayer).isDone };
    const placing = (name: string) => Action.create(name).condition(notDone);
    const seatOf = (ctx: { player: Player }) => ctx.player as SeatUndoPlayer;

    this.registerAction(
      placing('placePack').execute((_args, ctx) => {
        const player = seatOf(ctx);
        player.packs += 1;
        this.messageTo(player, 'You placed a pack');
        this.animateTo(player, 'packPlaced', { packs: player.packs });
        return { success: true };
      }),
    );
    this.registerAction(
      placing('stashToken').execute((_args, ctx) => {
        seatOf(ctx).create(SeatUndoToken, 'token');
        return { success: true };
      }),
    );
    this.registerAction(
      placing('draftPack').execute((_args, ctx) => {
        seatOf(ctx).packs += 1;
        this.supply -= 1;
        return { success: true };
      }),
    );
    this.registerAction(
      placing('rollPack').execute((_args, ctx) => {
        seatOf(ctx).packs += Math.floor(this.random() * 3) + 1;
        return { success: true };
      }),
    );
    this.registerAction(
      placing('announcePack').execute((_args, ctx) => {
        seatOf(ctx).packs += 1;
        this.message('{{player}} placed a pack', { player: ctx.player });
        return { success: true };
      }),
    );
    this.registerAction(
      placing('raidPack').execute((_args, ctx) => {
        seatOf(ctx).packs += 1;
        this.players.find((p) => p !== ctx.player)!.packs -= 1;
        return { success: true };
      }),
    );
    this.registerAction(
      placing('burnPack')
        .notUndoable()
        .execute((_args, ctx) => {
          seatOf(ctx).packs += 1;
          return { success: true };
        }),
    );
    this.registerAction(
      placing('pickPack')
        .chooseFrom('size', {
          choices: () => ['small', 'large'],
          onSelect: () => {
            this.supply -= 1;
          },
        })
        .execute((_args, ctx) => {
          seatOf(ctx).packs += 1;
          return { success: true };
        }),
    );
    this.registerAction(
      placing('pairPack')
        .chooseFrom('first', { choices: () => ['small', 'large'] })
        .chooseFrom('second', { choices: () => ['small', 'large'] })
        .execute((_args, ctx) => {
          seatOf(ctx).packs += 2;
          return { success: true };
        }),
    );
    // Two picks each, so a seat can be left partway through: `stakePack`'s first takes from the shared supply
    // and puts it back on cancel, `reservePack`'s first adds to the picking seat's packs and tells it so.
    const secondPick = { choices: () => ['left', 'right'] };
    this.registerActions(
      placing('stakePack')
        .chooseFrom('size', { choices: () => ['small', 'large'], onSelect: () => { this.supply -= 1; }, onCancel: () => { this.supply += 1; } })
        .chooseFrom('side', secondPick)
        .execute((_args, ctx) => {
          seatOf(ctx).packs += 1;
          return { success: true };
        }),
      placing('reservePack')
        .chooseFrom('seat', {
          choices: (ctx) => [ctx.player.seat],
          onSelect: (seat) => {
            const player = this.getPlayer(seat)!;
            player.packs += 1;
            this.messageTo(player, 'You reserved a pack');
          },
        })
        .chooseFrom('side', secondPick)
        .execute(() => ({ success: true })),
    );
    this.registerActions(
      placing('done').execute((_args, ctx) => {
        seatOf(ctx).isDone = true;
        return { success: true };
      }),
      Action.create('battle').execute(() => ({ success: true })),
    );

    const deploy = simultaneousActionStep<SeatUndoGame>({
      name: 'deploy',
      actions: ['placePack', 'stashToken', 'draftPack', 'rollPack', 'announcePack', 'raidPack', 'burnPack', 'pickPack', 'pairPack', 'stakePack', 'reservePack', 'done'],
      playerDone: (_ctx, p) => p.isDone,
      seatUndo: true,
    });
    const battle = actionStep<SeatUndoGame>({ name: 'battle', actions: ['battle'], player: (ctx) => ctx.game.getPlayer(1)! });
    this.setFlow({ root: sequence(deploy, battle) });
  }
}

export { SeatUndoGame, SeatUndoPlayer };

export const seatUndoDefinition: GameDefinitionLike = {
  gameClass: SeatUndoGame,
  gameType: 'seat-undo',
  minPlayers: 2,
  maxPlayers: 2,
};
