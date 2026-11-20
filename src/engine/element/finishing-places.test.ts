/**
 * A finished game reports each seat's finishing place, ties allowed, so a
 * rating can use the whole finishing order and not only who won (#1724).
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import { createActionCheckpoint } from '../utils/snapshot.js';

class PlacesGame extends Game<PlacesGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<PlacesGame>('end').prompt('End').execute(() => {}),
    );
    this.setFlow({
      root: loop({ maxIterations: 5, while: () => !this.isFinished(), do: actionStep({ actions: ['end'] }) }),
    });
  }

  seats(...seats: number[]): Player[] {
    return seats.map((seat) => this.getPlayer(seat)!);
  }
}

function gameOf(playerCount: number, GameClass: typeof PlacesGame = PlacesGame): PlacesGame {
  const runner = new GameRunner({ GameClass, gameType: 'places', gameOptions: { playerCount, seed: 'p1724' } });
  runner.start();
  return runner.game;
}

function runnerOf(playerCount: number, GameClass: typeof PlacesGame = PlacesGame) {
  const runner = new GameRunner({ GameClass, gameType: 'places', gameOptions: { playerCount, seed: 'p1724' } });
  runner.start();
  return runner;
}

const seatsOf = (places: Player[][]) => places.map((group) => group.map((p) => p.seat));

describe('a finished game reports each seat\'s finishing place (#1724)', () => {
  it('reports the finishing order the game declares, winners first, with ties sharing a place', () => {
    const runner = runnerOf(4);
    const game = runner.game;
    game.finish({ places: [game.seats(2), game.seats(1, 3), game.seats(4)] });
    expect(seatsOf(game.getPlaces())).toEqual([[2], [1, 3], [4]]);
    expect(game.getWinners().map((p) => p.seat)).toEqual([2]);
    expect(runner.getSnapshot()).toMatchObject({ winners: [2], draw: false, places: [[2], [1, 3], [4]] });
  });

  it('seats sharing first place are all winners, as a team that wins together is', () => {
    const game = gameOf(4);
    game.finish({ places: [game.seats(1, 3), game.seats(2, 4)] });
    expect(game.getWinners().map((p) => p.seat)).toEqual([1, 3]);
    expect(seatsOf(game.getPlaces())).toEqual([[1, 3], [2, 4]]);
  });

  it('a game that names only winners has them share first, and everyone else the next place', () => {
    const runner = runnerOf(4);
    runner.game.finish(runner.game.seats(3));
    expect(runner.getSnapshot().places).toEqual([[3], [1, 2, 4]]);
  });

  it('a draw, or a game nobody won, has every seat share one place', () => {
    const draw = gameOf(3);
    draw.finish('draw');
    expect(seatsOf(draw.getPlaces())).toEqual([[1, 2, 3]]);
    const lost = gameOf(3);
    lost.finish();
    expect(seatsOf(lost.getPlaces())).toEqual([[1, 2, 3]]);
  });

  it('a game every seat won has one place', () => {
    const game = gameOf(2);
    game.finish(game.seats(1, 2));
    expect(seatsOf(game.getPlaces())).toEqual([[1, 2]]);
  });

  it('a game still running has no places', () => {
    const runner = runnerOf(2);
    expect(runner.game.getPlaces()).toEqual([]);
    expect(runner.getSnapshot().places).toEqual([]);
  });

  it('a game that overrides getWinners() has places that follow it', () => {
    class Leader extends PlacesGame {
      override getWinners(): Player[] {
        return this.isFinished() ? this.seats(2) : [];
      }
    }
    const game = gameOf(3, Leader);
    game.finish();
    expect(seatsOf(game.getPlaces())).toEqual([[2], [1, 3]]);
  });

  it('the last finish() decides the places', () => {
    const game = gameOf(3);
    game.finish({ places: [game.seats(3), game.seats(2), game.seats(1)] });
    game.finish(game.seats(1));
    expect(seatsOf(game.getPlaces())).toEqual([[1], [2, 3]]);
    game.finish('draw');
    expect(seatsOf(game.getPlaces())).toEqual([[1, 2, 3]]);
  });

  it('every action checkpoint carries the places', () => {
    const game = gameOf(3);
    game.finish({ places: [game.seats(1), game.seats(3), game.seats(2)] });
    expect(createActionCheckpoint(game).places).toEqual([[1], [3], [2]]);
  });

  it("leaves a game's own persistentMap('places') alone", () => {
    class Tracked extends PlacesGame {
      places = this.persistentMap<string, number>('places');
    }
    expect(() => gameOf(2, Tracked)).not.toThrow();
  });

  describe('refuses places that are not one place per seat', () => {
    it('a seat left out', () => {
      const game = gameOf(3);
      expect(() => game.finish({ places: [game.seats(1), game.seats(2)] })).toThrow(
        /finish\(\) was given places that leave out seat 3/,
      );
    });

    it('a seat placed twice', () => {
      const game = gameOf(3);
      expect(() => game.finish({ places: [game.seats(1, 2), game.seats(2, 3)] })).toThrow(
        /finish\(\) was given places that place seat 2 more than once/,
      );
    });

    it('an empty place', () => {
      const game = gameOf(2);
      expect(() => game.finish({ places: [game.seats(1), [], game.seats(2)] })).toThrow(
        /finish\(\) was given places with an empty place \(place 2\)/,
      );
    });
  });

  describe('refuses places that disagree with the winners', () => {
    it('a first place that is not exactly the winners', () => {
      class Disagree extends PlacesGame {
        override getWinners(): Player[] {
          return this.isFinished() ? this.seats(1, 2) : [];
        }
        override getPlaces(): Player[][] {
          return this.isFinished() ? [this.seats(1), this.seats(2, 3)] : [];
        }
      }
      const runner = runnerOf(3, Disagree);
      runner.game.finish();
      expect(() => runner.getSnapshot()).toThrow(
        /getWinners\(\) names seats 1, 2 as the winners, but getPlaces\(\) puts seat 1 in first place/,
      );
    });

    it('a game nobody won that ranks its seats', () => {
      class Ranked extends PlacesGame {
        override getPlaces(): Player[][] {
          return this.isFinished() ? [this.seats(2), this.seats(1)] : [];
        }
      }
      const runner = runnerOf(2, Ranked);
      runner.game.finish('draw');
      expect(() => runner.getSnapshot()).toThrow(
        /getWinners\(\) names no winner, so every seat shares one place, but getPlaces\(\) puts seat 2 in first place/,
      );
    });

    it('an overriding getPlaces() that leaves a seat out', () => {
      class Missing extends PlacesGame {
        override getPlaces(): Player[][] {
          return this.isFinished() ? [this.seats(1)] : [];
        }
      }
      const runner = runnerOf(2, Missing);
      runner.game.finish(runner.game.seats(1));
      expect(() => runner.getSnapshot()).toThrow(/getPlaces\(\) returned places that leave out seat 2/);
    });
  });
});
