/**
 * Minimal fixture that faithfully mirrors MERC's "collect equipment" flow.
 *
 * Faithfulness that matters for the parity diagnosis:
 *  - `collect` runs through the selection-step / pending-action path
 *    (PickHandler.processSelectionStep -> executePendingAction), NOT performAction.
 *  - `collect.execute` MUTATES element placement (moves a Piece between Spaces via
 *    `putInto`) — the exact shape suspected not to survive the snapshot round-trip.
 *  - The followUp args carry PLAIN NUMERIC element ids (structured-cloneable),
 *    mirroring the fixed MERC.
 */

import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  loop,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

/** Equipment-like piece that lives in a sector stash and can be collected. */
class Equipment extends Piece<CollectGame> {}

/** The stash space inside a sector that holds uncollected equipment. */
class Stash extends Space<CollectGame> {}

/** A per-combatant "held" space that collected equipment moves into. */
class Held extends Space<CollectGame> {}

/** A sector-like container that owns the stash. */
class Sector extends Space<CollectGame> {
  stash!: Stash;
}

class CollectGame extends Game<CollectGame, Player> {
  sector!: Sector;
  held!: Held;

  constructor(options: GameOptions) {
    super(options);

    // Sector with a stash of several equipment pieces.
    this.sector = this.create(Sector, 'sector');
    this.sector.stash = this.sector.create(Stash, 'stash');
    this.sector.stash.create(Equipment, 'Sword');
    this.sector.stash.create(Equipment, 'Shield');
    this.sector.stash.create(Equipment, 'Bow');

    // Per-combatant held space.
    this.held = this.create(Held, 'held');

    // `explore`: a normal action (available at game start). Its execute returns a
    // followUp into `collect`, passing PLAIN NUMERIC element ids so the followUp
    // args are structured-cloneable (mirrors the fixed MERC).
    this.registerAction(
      Action.create('explore').execute(() => ({
        success: true,
        followUp: {
          action: 'collect',
          args: { combatantId: this.held.id, sectorId: this.sector.id },
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
        .condition({ 'has sector arg': (ctx) => ctx.args?.sectorId != null })
        .chooseElement<Equipment>('item', {
          optional: true,
          elementClass: Equipment,
          // Scope to pieces currently in this game's stash. Closure (not ctx.args)
          // so getPickChoices works even when called with empty args.
          filter: (el) => el.parent === this.sector.stash,
        })
        .execute((_args, ctx) => {
          const item = ctx.args.item as Equipment | undefined;
          // Skipped (optional selection not provided) -> done collecting.
          if (!item) {
            return { success: true };
          }

          // Resolve the followUp args (numeric ids -> GameElements) and MOVE the
          // piece — the mutation under test for snapshot persistence.
          const held = ctx.args.combatantId as Held;
          const sector = ctx.args.sectorId as Sector;
          item.putInto(held);

          // More items left -> chain back into collect with plain ids again.
          if (sector.stash.all(Equipment).length > 0) {
            return {
              success: true,
              followUp: {
                action: 'collect',
                args: { combatantId: held.id, sectorId: sector.id },
              },
            };
          }

          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: actionStep({
            actions: ['explore'],
            player: (ctx) => ctx.game.getPlayer(1)!,
          }),
        }),
      }),
    );
  }
}

export { CollectGame, Equipment, Stash, Held, Sector };

export const collectFixtureDefinition: GameDefinitionLike = {
  gameClass: CollectGame as new (...args: unknown[]) => unknown,
  gameType: 'collect',
  minPlayers: 1,
  maxPlayers: 4,
};
