/**
 * #448: `static visibleAttributes` names the GAME's own attributes only.
 *
 * The whitelist used to run over every attribute an element sends, the
 * engine's own included, so a game that wanted to withhold one field of its
 * Player had to list `name`, `$type`, `seat`, `color`, `colorLabel` and
 * `status` by hand -- and an engine field added later was withheld from other
 * seats in every such game without anyone deciding it should be.
 *
 * The engine's fields are now the engine's, as the game root's already were
 * (#148): a visible element always carries them, a game's whitelist cannot
 * withhold them, and naming one in the list is refused so the list says only
 * what it does.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../index.js';
import { GameSession } from '../../session/index.js';

class PlanPlayer extends Player<PlanGame, PlanPlayer> {
  static override visibleAttributes = ['score'];
  score = 0;
  secretPlan = '';
}

class PlanGame extends Game<PlanGame, PlanPlayer> {
  static override PlayerClass = PlanPlayer;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('noop').execute(() => ({ success: true })));
    this.setFlow(
      defineFlow({
        root: actionStep({ actions: ['noop'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false }),
      }),
    );
  }
}

/** A board that is not a Player, and whose game happens to name a field `seat`. */
class SeatBoard extends Space<PlanGame> {
  static override visibleAttributes = ['label'];
  label = 'board';
  seat = 2;
}

function playerNode(view: ReturnType<Game['toJSONForPlayer']>, id: number) {
  const node = view.children?.find((child) => child.id === id);
  if (!node) throw new Error(`no node ${id} in the view`);
  return node;
}

describe('visibleAttributes covers game fields only (#448)', () => {
  it("another seat's view of a whitelisted Player keeps every engine field", () => {
    const game = new PlanGame({ playerCount: 2, playerNames: ['Ann', 'Bo'], seed: 'plan' });
    const ann = game.getPlayer(1)!;
    ann.secretPlan = 'buy the lighthouse';
    ann.score = 4;

    const attrs = playerNode(game.toJSONForPlayer(2), ann.id).attributes;

    expect(attrs.name).toBe('Ann');
    expect(attrs.$type).toBe('player');
    expect(attrs.seat).toBe(1);
    expect(attrs.color).toBe(ann.color);
    expect(attrs.colorLabel).toBe(ann.colorLabel);
    expect(attrs.status).toBe('active');
    expect(attrs.score).toBe(4);
    expect(attrs.secretPlan).toBeUndefined();
  });

  it("the session's player list gives another seat the opponent's name and colour", () => {
    const session = GameSession.create({
      gameType: 'plan',
      GameClass: PlanGame,
      playerCount: 2,
      playerNames: ['Ann', 'Bo'],
      seed: 'plan',
    });
    const ann = session.getState(2).state!.players.find((p) => p.seat === 1)!;

    expect(ann.name).toBe('Ann');
    expect(ann.color).toBe(session.runner.game.getPlayer(1)!.color);
    expect((ann as Record<string, unknown>).secretPlan).toBeUndefined();
  });

  it('a restored per-seat copy knows the engine fields and still refuses the withheld one', () => {
    const game = new PlanGame({ playerCount: 2, playerNames: ['Ann', 'Bo'], seed: 'plan' });
    game.getPlayer(1)!.secretPlan = 'buy the lighthouse';

    const sandbox = new PlanGame({ playerCount: 2, playerNames: ['Ann', 'Bo'], seed: 'plan' });
    sandbox.loadSerializedState(game.toJSONForPlayer(2));
    const ann = sandbox.getPlayer(1)!;

    expect(ann.isAttributeRedacted('color')).toBe(false);
    expect(ann.isAttributeRedacted('status')).toBe(false);
    expect(ann.color).toBe(game.getPlayer(1)!.color);
    expect(ann.isAttributeRedacted('secretPlan')).toBe(true);
  });

  it('a Player engine field name is a game field on an element that is not a Player', () => {
    const game = new PlanGame({ playerCount: 2, seed: 'plan' });
    const board = game.create(SeatBoard, 'board');
    board.player = game.getPlayer(1)!;

    const attrs = game.toJSONForPlayer(2).children!.find((child) => child.name === 'board')!.attributes;

    expect(attrs.label).toBe('board');
    expect(attrs.seat).toBeUndefined();
  });

  it('refuses a whitelist that names an engine field, naming the class and the field', () => {
    class ListsEngineField extends Piece<PlanGame> {
      static override visibleAttributes = ['player', 'rank'];
      rank = 3;
    }
    const game = new PlanGame({ playerCount: 2, seed: 'plan' });
    game.create(ListsEngineField, 'p');

    expect(() => game.toJSONForPlayer(2)).toThrow(/ListsEngineField\.visibleAttributes names "player"/);
  });

  it('refuses a Player whitelist that names a Player engine field', () => {
    class ListsSeat extends Player<SeatGame, ListsSeat> {
      static override visibleAttributes = ['seat', 'score'];
      score = 0;
    }
    class SeatGame extends Game<SeatGame, ListsSeat> {
      static override PlayerClass = ListsSeat;
    }
    const game = new SeatGame({ playerCount: 2, seed: 'plan' });

    expect(() => game.toJSONForPlayer(2)).toThrow(/ListsSeat\.visibleAttributes names "seat"/);
  });

  it('refuses a game-root whitelist that names an engine root field', () => {
    class RootGame extends Game<RootGame, Player> {
      static override visibleAttributes = ['round', 'phase'];
      round = 1;
    }
    const game = new RootGame({ playerCount: 2, seed: 'plan' });

    expect(() => game.toJSONForPlayer(2)).toThrow(/RootGame\.visibleAttributes names "phase"/);
  });

  it('every attribute a bare Player sends is an engine field, so a new one cannot be withheld by accident', () => {
    class BareGame extends Game<BareGame, Player> {}
    const game = new BareGame({ playerCount: 2, seed: 'plan' });
    const player = game.getPlayer(1)!;
    player.color = '#123456';
    player.colorLabel = 'Teal';

    class Whitelisted extends Player<BareGame, Whitelisted> {
      static override visibleAttributes: string[] = [];
    }
    class WhitelistGame extends Game<WhitelistGame, Whitelisted> {
      static override PlayerClass = Whitelisted;
    }
    const whitelisted = new WhitelistGame({ playerCount: 2, seed: 'plan' });
    const first = whitelisted.getPlayer(1)!;
    first.color = '#123456';
    first.colorLabel = 'Teal';

    const sent = Object.keys(player.toJSON().attributes).sort();
    const seenByOthers = Object.keys(playerNode(whitelisted.toJSONForPlayer(2), first.id).attributes).sort();

    expect(seenByOthers).toEqual(sent);
  });
});
