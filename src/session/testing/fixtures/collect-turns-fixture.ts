/**
 * Two-player variant of the collect fixture, used to prove authoritative undo.
 *
 * The point of this fixture vs. `collect-fixture.ts`:
 *  - It has REAL turn boundaries (eachPlayer), so `computeUndoInfo` yields a
 *    `turnStartActionIndex > 0` — the case where replay-based undo loses
 *    PRIOR-turn pending mutations.
 *  - Each turn is `sequence(actionStep, actionStep)` (two actions), so a player
 *    can take an action and STILL be the current player — the only state in
 *    which undo is offered (undo requires currentPlayer === player and
 *    actionsThisTurn > 0).
 *  - `collect` runs through the selection-step / pending-action path and mutates
 *    the tree via `Piece.putInto` (recorded in NEITHER command nor action
 *    history) — the exact mutation that must survive an undo of a LATER turn.
 */

import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  sequence,
  actionStep,
  execute,
  loop,
  type GameOptions,
} from '../../../engine/index.js';
import type { GameDefinitionLike } from '../../stateless-ops.js';

class Equipment extends Piece<CollectTurnsGame> {}
class Stash extends Space<CollectTurnsGame> {}
class Held extends Space<CollectTurnsGame> {}

class CollectTurnsGame extends Game<CollectTurnsGame, Player> {
  stash!: Stash;
  /** Seat (1-indexed) whose turn it is. A plain number so it round-trips
   *  through the snapshot cleanly (unlike a live element flow variable). */
  activeSeat = 1;

  constructor(options: GameOptions) {
    super(options);

    this.stash = this.create(Stash, 'stash');
    this.stash.create(Equipment, 'Sword');
    this.stash.create(Equipment, 'Shield');
    this.stash.create(Equipment, 'Bow');
    this.stash.create(Equipment, 'Axe');

    // One held space per player, named held-<seat>.
    for (const player of this.players) {
      this.create(Held, `held-${player.seat}`);
    }

    // `explore`: normal action. Returns a followUp into `collect` carrying the
    // acting player's held id + the stash id as PLAIN NUMERIC ids (cloneable).
    this.registerAction(
      Action.create('explore').execute((_args, ctx) => {
        const game = ctx.game as CollectTurnsGame;
        const held = game.heldFor(ctx.player.seat);
        return {
          success: true,
          followUp: {
            action: 'collect',
            args: { combatantId: held.id, sectorId: game.stash.id },
          },
        };
      }),
    );

    // `collect`: GATED pending action with one optional element selection. Its
    // execute MOVES the chosen piece from the stash into the acting player's
    // held space — the mutation under test for undo persistence.
    this.registerAction(
      Action.create('collect')
        .condition({ 'has sector arg': (ctx) => ctx.args?.sectorId != null })
        .chooseElement<Equipment>('item', {
          optional: true,
          elementClass: Equipment,
          filter: (el) => el.parent === this.stash,
        })
        .execute((_args, ctx) => {
          const item = ctx.args.item as Equipment | undefined;
          if (!item) {
            return { success: true };
          }
          const held = ctx.args.combatantId as Held;
          item.putInto(held);
          return { success: true };
        }),
    );

    // `pass`: a normal, recorded no-op action.
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));

    // Each turn is TWO actions for the active seat: first an explore-or-pass,
    // then a pass; then control advances to the next seat. The intermediate
    // state (after the first action, before the second) is the only point where
    // the acting player is still current AND has acted — i.e. the only point
    // undo is offered. Turn rotation is driven by the `activeSeat` counter
    // (resolved by the actionStep `player`), NOT `eachPlayer` — the latter binds
    // the current Player as a LIVE element flow variable, which is not
    // structured-cloneable across the broadcast/postMessage boundary.
    const activePlayer = (ctx: { game: Game }) =>
      ctx.game.getPlayer((ctx.game as CollectTurnsGame).activeSeat)!;
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 1000,
          do: sequence(
            actionStep({ actions: ['explore', 'pass'], player: activePlayer }),
            actionStep({ actions: ['pass'], player: activePlayer }),
            execute((ctx) => {
              const game = ctx.game as CollectTurnsGame;
              game.activeSeat = game.activeSeat >= game.players.length ? 1 : game.activeSeat + 1;
            }),
          ),
        }),
      }),
    );
  }

  heldFor(seat: number): Held {
    const held = this.all(Held).find((h) => h.name === `held-${seat}`);
    if (!held) {
      throw new Error(`No held space for seat ${seat}`);
    }
    return held;
  }
}

export { CollectTurnsGame, Equipment, Stash, Held };

export const collectTurnsFixtureDefinition: GameDefinitionLike = {
  gameClass: CollectTurnsGame as new (...args: unknown[]) => unknown,
  gameType: 'collect-turns',
  minPlayers: 2,
  maxPlayers: 4,
};
