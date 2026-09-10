/**
 * WHERE A GAME SAYS ITS START BUTTON SITS (#228).
 *
 * `.group()` and `.order()` are the whole authoring surface for the Action
 * Panel's hierarchy. They are DECLARATION ONLY: the same tests below prove the
 * action is still offered, still disabled for the same reason, and still
 * refused by the server for the same reason, because grouping arranges buttons
 * and decides nothing about the rules.
 *
 * A path is a list of LABELS, and a label is the group's identity as well as
 * its text. That is deliberate: there is no id to register, so there is no
 * dangling reference to make, and two actions in one group cannot disagree
 * about what it is called.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action } from '../index.js';
import { buildActionMetadata } from '../element/action-metadata.js';

class PlacementGame extends Game<PlacementGame, Player> {
  ore = 0;
  dumped = 0;
}

function makeGame(): { game: PlacementGame; player: Player } {
  const game = new PlacementGame({ playerCount: 2 });
  game.registerActions(
    Action.create<PlacementGame>('construct').prompt('Construct building').order(10).execute(() => {}),
    Action.create<PlacementGame>('dumpOre')
      .prompt('Dump ore')
      .group('Dump')
      .order(20)
      .disabled((ctx) => (ctx.game.ore < 1 ? 'You have no ore to dump.' : false))
      .execute((_args, ctx) => {
        ctx.game.dumped += 1;
      }),
    Action.create<PlacementGame>('renamePlanet')
      .prompt('Rename planet')
      .group('More', 'Empire settings')
      .execute(() => {}),
    Action.create<PlacementGame>('skipMission').prompt('Skip mission').execute(() => {}),
  );
  return { game, player: game.getPlayer(1)! };
}

describe('.group() and .order() on the action definition', () => {
  it('records a single-level group as a one-segment path', () => {
    const definition = Action.create<PlacementGame>('dumpOre').group('Dump').execute(() => {});
    expect(definition.group).toEqual(['Dump']);
  });

  it('records a nested group as the path its segments spell', () => {
    const definition = Action.create<PlacementGame>('renamePlanet')
      .group('More', 'Empire settings')
      .execute(() => {});
    expect(definition.group).toEqual(['More', 'Empire settings']);
  });

  it('records a declared order', () => {
    const definition = Action.create<PlacementGame>('construct').order(10).execute(() => {});
    expect(definition.order).toBe(10);
  });

  it('leaves both absent when nothing is declared', () => {
    const definition = Action.create<PlacementGame>('plain').execute(() => {});
    expect(definition.group).toBeUndefined();
    expect(definition.order).toBeUndefined();
  });

  it('refuses a group with no segments, because a path to nowhere is not a placement', () => {
    expect(() => Action.create<PlacementGame>('x').group()).toThrow(/at least one label/);
  });

  it('refuses a blank label, because an unlabelled group cannot be navigated or announced', () => {
    expect(() => Action.create<PlacementGame>('x').group('More', '   ')).toThrow(/blank/);
  });

  it('refuses an order that is not a finite number, because it would sort unpredictably', () => {
    expect(() => Action.create<PlacementGame>('x').order(Number.NaN)).toThrow(/finite number/);
    expect(() => Action.create<PlacementGame>('x').order(Number.POSITIVE_INFINITY)).toThrow(/finite number/);
  });
});

describe('placement reaches ActionMetadata', () => {
  it('emits the group path and the order for a placed action', () => {
    const { game, player } = makeGame();
    const metadata = buildActionMetadata(game, player, ['dumpOre', 'renamePlanet', 'construct']);
    expect(metadata['dumpOre']?.group).toEqual(['Dump']);
    expect(metadata['dumpOre']?.order).toBe(20);
    expect(metadata['renamePlanet']?.group).toEqual(['More', 'Empire settings']);
    expect(metadata['construct']?.order).toBe(10);
    expect(metadata['construct']?.group).toBeUndefined();
  });

  it('omits both keys for an unplaced action, so a game that declares nothing sends nothing', () => {
    const { game, player } = makeGame();
    const metadata = buildActionMetadata(game, player, ['skipMission']);
    expect('group' in metadata['skipMission']!).toBe(false);
    expect('order' in metadata['skipMission']!).toBe(false);
  });
});

describe('grouping changes nothing about the rules', () => {
  it('leaves a grouped action available exactly as it was', () => {
    const { game } = makeGame();
    const offered = game.getAvailableActions(game.getPlayer(1)!).map((a) => a.name);
    expect(offered).toContain('dumpOre');
    expect(offered).toContain('renamePlanet');
  });

  it("leaves a grouped action's disabled reason and the server's refusal intact", () => {
    const { game } = makeGame();
    expect(game.getDisabledActions(1)['dumpOre']).toBe('You have no ore to dump.');
    const refused = game.performAction('dumpOre', game.getPlayer(1)!, {});
    expect(refused.success).toBe(false);
    expect(refused.error).toContain('You have no ore to dump.');
    expect(game.dumped).toBe(0);
  });

  it('leaves a grouped action executable once its own rule allows it', () => {
    const { game } = makeGame();
    game.ore = 5;
    const done = game.performAction('dumpOre', game.getPlayer(1)!, {});
    expect(done.success).toBe(true);
    expect(game.dumped).toBe(1);
  });
});
