/**
 * The patterns docs/actions-and-flow.md teaches for drawing cards and offering
 * them, and for carrying a value from one action to the next (#674).
 *
 * A pick's candidate callback (`choices`, `elements`) runs on every question
 * about the pick, so it must not draw: the draw belongs in a flow `execute`
 * step or an action's `execute`, into a space the later pick offers from.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Deck, Action, actionTempState, actionStep, execute, sequence, enumerateLegalMoves, type GameOptions } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';

function start<G extends Game>(GameClass: new (options: GameOptions) => G): GameRunner<G> {
  const runner = new GameRunner<G>({ GameClass, gameType: 'bs674', gameOptions: { playerCount: 1, seed: 'bs674' } });
  runner.start();
  return runner;
}

class Merc extends Piece<HireGame> {}
class Pile extends Space<HireGame> {}

/** The "Full Example: Draw, Then Pick" of docs/actions-and-flow.md. */
class HireGame extends Game<HireGame, Player> {
  mercDeck = this.create(Deck<HireGame>, 'mercDeck');
  mercOffer = this.create(Pile, 'mercOffer');
  team = this.create(Pile, 'team');

  constructor(options: GameOptions) {
    super(options);
    this.mercDeck.createMany(10, Merc, 'merc');
    this.registerAction(
      Action.create<HireGame>('hireFirstMerc')
        .chooseElement('merc', { elementClass: Merc, from: (ctx) => ctx.game.mercOffer })
        .execute((args, ctx) => {
          args.merc.putInto(ctx.game.team);
          for (const merc of ctx.game.mercOffer.all(Merc)) merc.putInto(ctx.game.mercDeck, { position: 'last' });
        }),
    );
    this.setFlow({
      root: sequence(
        execute((ctx) => ctx.game.mercDeck.drawTo(ctx.game.mercOffer, 3), { irreversible: true }),
        actionStep({ actions: ['hireFirstMerc'] }),
      ),
    });
  }
}

describe('draw in an earlier step, then pick (#674)', () => {
  it('offers the three drawn cards on every question, hires the one picked and returns the others', () => {
    const runner = start(HireGame);
    const game = runner.game;
    const offered = game.mercOffer.all(Merc);
    expect(offered).toHaveLength(3);
    expect(game.mercDeck.all(Merc)).toHaveLength(7);

    const pick = game.getAction('hireFirstMerc')!.selections[0];
    const ask = () => game.getActionExecutor().getChoices(pick, game.getPlayer(1)!, {}, 'hireFirstMerc').map((c) => (c.value as Merc).id);
    expect(ask()).toEqual(offered.map((m) => m.id));
    expect(ask()).toEqual(offered.map((m) => m.id));
    expect(enumerateLegalMoves(game, 1)).toHaveLength(3);
    expect(game.mercDeck.all(Merc)).toHaveLength(7);

    expect(runner.performAction('hireFirstMerc', 1, { merc: offered[1].id }).success).toBe(true);
    expect(game.team.all(Merc).map((m) => m.id)).toEqual([offered[1].id]);
    expect(game.mercOffer.all(Merc)).toHaveLength(0);
    expect(game.mercDeck.all(Merc)).toHaveLength(9);
  });
});

class Sector extends Space<LootGame> {}
class Equipment extends Piece<LootGame> {}
class Stash extends Space<LootGame> {}

/** The `actionTempState()` example of docs/actions-and-flow.md. */
class LootGame extends Game<LootGame, Player> {
  stash = this.create(Stash, 'stash');

  constructor(options: GameOptions) {
    super(options);
    for (const name of ['north', 'south']) {
      this.create(Sector, name).createMany(2, Equipment, `${name}-gear`);
    }
    this.registerAction(
      Action.create<LootGame>('explore')
        .chooseElement('sector', { elementClass: Sector })
        .execute((args, ctx) => {
          actionTempState(ctx, 'explore').set('sectorId', args.sector.id);
        }),
    );
    this.registerAction(
      Action.create<LootGame>('collectLoot')
        .chooseElement('loot', {
          elements: (ctx) => {
            const sectorId = actionTempState(ctx, 'explore').get<number>('sectorId');
            if (sectorId === undefined) return [];
            return ctx.game.getElementById(sectorId)!.all(Equipment);
          },
        })
        .execute((args, ctx) => {
          args.loot.putInto(ctx.game.stash);
          actionTempState(ctx, 'explore').clear();
        }),
    );
    this.setFlow({
      root: sequence(actionStep({ actions: ['explore'] }), actionStep({ actions: ['collectLoot'], turnScope: 'continue' })),
    });
  }
}

describe('actionTempState carries a value from one action to the next (#674)', () => {
  it('offers the loot of the sector the first action explored, then clears', () => {
    const runner = start(LootGame);
    const game = runner.game;
    const south = game.first(Sector, 'south')!;
    expect(runner.performAction('explore', 1, { sector: south.id }).success).toBe(true);

    const loot = game.getAction('collectLoot')!.selections[0];
    const offered = game.getActionExecutor().getChoices(loot, game.getPlayer(1)!, {}, 'collectLoot').map((c) => (c.value as Equipment).id);
    expect(offered).toEqual(south.all(Equipment).map((e) => e.id));

    expect(runner.performAction('collectLoot', 1, { loot: offered[0] }).success).toBe(true);
    expect(game.stash.all(Equipment).map((e) => e.id)).toEqual([offered[0]]);
    expect(actionTempState(game, game.getPlayer(1)!, 'explore').get('sectorId')).toBeUndefined();
  });
});
