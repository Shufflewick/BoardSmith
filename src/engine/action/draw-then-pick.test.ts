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

class Hero extends Piece<HireGame> {}
class Pile extends Space<HireGame> {}

/** The "Full Example: Draw, Then Pick" of docs/actions-and-flow.md. */
class HireGame extends Game<HireGame, Player> {
  heroDeck = this.create(Deck<HireGame>, 'heroDeck');
  heroOffer = this.create(Pile, 'heroOffer');
  team = this.create(Pile, 'team');

  constructor(options: GameOptions) {
    super(options);
    this.heroDeck.createMany(10, Hero, 'hero');
    this.registerAction(
      Action.create<HireGame>('hireFirstHero')
        .chooseElement('hero', { elementClass: Hero, from: (ctx) => ctx.game.heroOffer })
        .execute((args, ctx) => {
          args.hero.putInto(ctx.game.team);
          for (const hero of ctx.game.heroOffer.all(Hero)) hero.putInto(ctx.game.heroDeck, { position: 'last' });
        }),
    );
    this.setFlow({
      root: sequence(
        execute((ctx) => ctx.game.heroDeck.drawTo(ctx.game.heroOffer, 3), { irreversible: true }),
        actionStep({ actions: ['hireFirstHero'] }),
      ),
    });
  }
}

describe('draw in an earlier step, then pick (#674)', () => {
  it('offers the three drawn cards on every question, hires the one picked and returns the others', () => {
    const runner = start(HireGame);
    const game = runner.game;
    const offered = game.heroOffer.all(Hero);
    expect(offered).toHaveLength(3);
    expect(game.heroDeck.all(Hero)).toHaveLength(7);

    const pick = game.getAction('hireFirstHero')!.selections[0];
    const ask = () => game.getActionExecutor().getChoices(pick, game.getPlayer(1)!, {}, 'hireFirstHero').map((c) => (c.value as Hero).id);
    expect(ask()).toEqual(offered.map((m) => m.id));
    expect(ask()).toEqual(offered.map((m) => m.id));
    expect(enumerateLegalMoves(game, 1)).toHaveLength(3);
    expect(game.heroDeck.all(Hero)).toHaveLength(7);

    expect(runner.performAction('hireFirstHero', 1, { hero: offered[1].id }).success).toBe(true);
    expect(game.team.all(Hero).map((m) => m.id)).toEqual([offered[1].id]);
    expect(game.heroOffer.all(Hero)).toHaveLength(0);
    expect(game.heroDeck.all(Hero)).toHaveLength(9);
  });
});

class Room extends Space<LootGame> {}
class Equipment extends Piece<LootGame> {}
class Stash extends Space<LootGame> {}

/** The `actionTempState()` example of docs/actions-and-flow.md. */
class LootGame extends Game<LootGame, Player> {
  stash = this.create(Stash, 'stash');

  constructor(options: GameOptions) {
    super(options);
    for (const name of ['north', 'south']) {
      this.create(Room, name).createMany(2, Equipment, `${name}-gear`);
    }
    this.registerAction(
      Action.create<LootGame>('explore')
        .chooseElement('room', { elementClass: Room })
        .execute((args, ctx) => {
          actionTempState(ctx, 'explore').set('roomId', args.room.id);
        }),
    );
    this.registerAction(
      Action.create<LootGame>('collectLoot')
        .chooseElement('loot', {
          elements: (ctx) => {
            const roomId = actionTempState(ctx, 'explore').get<number>('roomId');
            if (roomId === undefined) return [];
            return ctx.game.getElementById(roomId)!.all(Equipment);
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
  it('offers the loot of the room the first action explored, then clears', () => {
    const runner = start(LootGame);
    const game = runner.game;
    const south = game.first(Room, 'south')!;
    expect(runner.performAction('explore', 1, { room: south.id }).success).toBe(true);

    const loot = game.getAction('collectLoot')!.selections[0];
    const offered = game.getActionExecutor().getChoices(loot, game.getPlayer(1)!, {}, 'collectLoot').map((c) => (c.value as Equipment).id);
    expect(offered).toEqual(south.all(Equipment).map((e) => e.id));

    expect(runner.performAction('collectLoot', 1, { loot: offered[0] }).success).toBe(true);
    expect(game.stash.all(Equipment).map((e) => e.id)).toEqual([offered[0]]);
    expect(actionTempState(game, game.getPlayer(1)!, 'explore').get('roomId')).toBeUndefined();
  });
});
