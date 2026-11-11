/**
 * Minimal fixture that mirrors a "collect equipment" flow.
 *
 * Faithfulness that matters for the parity diagnosis:
 *  - `collect` runs through the selection-step / pending-action path
 *    (PickHandler.processSelectionStep -> executePendingAction), NOT performAction.
 *  - `collect.execute` MUTATES element placement (moves a Piece between Spaces via
 *    `putInto`) — the exact shape suspected not to survive the snapshot round-trip.
 *  - The followUp args carry PLAIN NUMERIC element ids (structured-cloneable),
 */

import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  actionStep,
  loop,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

/** Equipment-like piece that lives in a room stash and can be collected. */
class Equipment extends Piece<CollectGame> {}

/** The stash space inside a room that holds uncollected equipment. */
class Stash extends Space<CollectGame> {}

/** A per-duelist "held" space that collected equipment moves into. */
class Held extends Space<CollectGame> {}

/** A room-like container that owns the stash. */
class Room extends Space<CollectGame> {
  stash!: Stash;
}

class CollectGame extends Game<CollectGame, Player> {
  room!: Room;
  held!: Held;

  constructor(options: GameOptions) {
    super(options);

    // Room with a stash of several equipment pieces.
    this.room = this.create(Room, 'room');
    this.room.stash = this.room.create(Stash, 'stash');
    this.room.stash.create(Equipment, 'Sword');
    this.room.stash.create(Equipment, 'Shield');
    this.room.stash.create(Equipment, 'Bow');

    // Per-duelist held space.
    this.held = this.create(Held, 'held');

    // `explore`: a normal action (available at game start). Its execute returns a
    // followUp into `collect`, passing PLAIN NUMERIC element ids so the followUp
    // args are structured-cloneable .
    this.registerAction(
      Action.create('explore').execute(() => ({
        success: true,
        followUp: {
          action: 'collect',
          args: { duelistId: this.held.id, roomId: this.room.id },
        },
      })),
    );

    // `collect`: GATED so it is NOT offered as an availableAction. It runs as a
    // pending/selection action with ONE optional element selection. Its execute
    // MOVES the chosen piece from the stash into the held space, then chains a
    // followUp back into `collect` while the stash still has items, or completes
    // ("done collecting") when the player skips (no item).
    this.registerAction(
      Action.create('collect')
        .followUpArgs<{ duelistId: number; roomId: number }>()
        .condition({ 'has room arg': (ctx) => ctx.args.roomId != null })
        .chooseElement('item', {
          optional: true,
          elementClass: Equipment,
          // Scope to pieces currently in this game's stash. Closure (not ctx.args)
          // so getPickChoices works even when called with empty args.
          filter: (el) => el.parent === this.room.stash,
        })
        .execute((_args, ctx) => {
          const item = ctx.args.item as Equipment | undefined;
          // Skipped (optional selection not provided) -> done collecting.
          if (!item) {
            return { success: true };
          }

          // Resolve the followUp args (numeric ids -> GameElements) and MOVE the
          // piece — the mutation under test for snapshot persistence. Non-selection
          // followUp args are plain numbers (ENG-05: resolveArgs no longer coerces
          // bare numbers), so resolve explicitly via getElementById.
          const held = ctx.game.getElementById(ctx.args.duelistId) as Held;
          const room = ctx.game.getElementById(ctx.args.roomId) as Room;
          item.putInto(held);

          // More items left -> chain back into collect with plain ids again.
          if (room.stash.all(Equipment).length > 0) {
            return {
              success: true,
              followUp: {
                action: 'collect',
                args: { duelistId: held.id, roomId: room.id },
              },
            };
          }

          return { success: true };
        }),
    );

    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({
          actions: ['explore'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          // One seat, one action per loop iteration: every iteration is a
          // new turn, so undo does not reach behind the current one.
          turnScope: 'restart',
        }),
      }),
    });
  }
}

export { CollectGame, Equipment, Stash, Held, Room };

export const collectFixtureDefinition: GameDefinitionLike = {
  gameClass: CollectGame,
  gameType: 'collect',
  minPlayers: 1,
  maxPlayers: 4,
};
