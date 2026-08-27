import { describe, it, expect } from 'vitest';
import { Game, Space, Player, Action, FlowEngine, eachPlayer, simultaneousActionStep, execute, defineFlow } from '../index.js';

/**
 * WHO GETS A TURN IS THE ROSTER, and the roster is `game.players`.
 *
 * `eachPlayer` and `simultaneousActionStep` used to build their turn order from
 * `game.all(Player)` -- an `instanceof` search over every DESCENDANT of the game
 * tree. `game.players` is the structural answer (`$type === 'player'`, direct
 * children only) that #52 and #149 left every other seat query using, and the two
 * disagree in both directions:
 *
 *  - `all(Player)` COUNTS a Player-derived element that is not a seat: a token
 *    class extending `Player`, a per-seat marker, anything a game parks in the
 *    tree. That element is not on the roster, has no seat of its own to act
 *    from, and was being handed a turn.
 *  - `all(Player)` MISSES every seat when a bundler produces a second copy of the
 *    `Player` class, because `instanceof` fails across the copies. That is the
 *    reason the structural test exists at all.
 *
 * This pins the first direction, which is the one a test can construct.
 *
 * What each case proves, stated honestly:
 *  - The SIMULTANEOUS case is a live break. On the old query the step opened a
 *    slot for the ghost and published `playerIndex: undefined` to every client
 *    ("expected [ 1, 2, undefined ]"), so a seat that does not exist was in the
 *    awaiting set and the step could never see it complete.
 *  - The `eachPlayer` case passes either way: the ghost reached the eligible-seat
 *    list as `undefined` and was then dropped downstream by `getPlayer`, so the
 *    old query wasted an iteration without changing what a player saw. It is here
 *    as a guard on the same query, not as a reproduction.
 */

class Ghost extends Player {}

class RosterGame extends Game<RosterGame, Player> {}

describe('turn order comes from the roster, not from an instanceof search', () => {
  it('gives eachPlayer one iteration per seat, ignoring off-roster Player elements (guard)', () => {
    const game = new RosterGame({ playerCount: 2 });
    const board = game.create(Space, 'board');
    board.create(Ghost, 'ghost');

    // The premise: the tree really does hold a third Player-derived element.
    expect(game.players).toHaveLength(2);
    expect([...game.all(Player)]).toHaveLength(3);

    const acted: number[] = [];
    const engine = new FlowEngine(
      game,
      defineFlow<RosterGame>({
        root: eachPlayer({
          do: execute((ctx) => {
            acted.push(ctx.player!.seat);
          }),
        }),
      })
    );
    engine.start();

    expect(acted).toEqual([1, 2]);
  });

  it('opens a simultaneous step to the seats only', () => {
    const game = new RosterGame({ playerCount: 2 });
    const board = game.create(Space, 'board');
    board.create(Ghost, 'ghost');

    // A no-op action every seat can take, so the step actually opens.
    game.registerActions(Action.create<RosterGame>('wait').execute(() => {}));

    const engine = new FlowEngine(
      game,
      defineFlow<RosterGame>({
        root: simultaneousActionStep({ actions: ['wait'] }),
      })
    );
    const state = engine.start();

    expect(state.awaitingPlayers?.map((p) => p.playerIndex)).toEqual([1, 2]);
  });
});
