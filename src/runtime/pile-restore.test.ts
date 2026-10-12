/**
 * A restore leaves the pile empty, whether it is done in place or into a
 * fresh game (#650).
 *
 * The pile (`game.pile`) is not in a snapshot. An in-place restore used to
 * rebuild only the tree, so a card removed after the state was taken came back
 * into the tree while its old copy stayed in the pile under the same id;
 * removing it again put that id in the pile twice, and any query over the pile
 * then threw TREE CORRUPTION. A fresh restore kept only what the constructor
 * had removed. Restores are state-authoritative, so every restore now empties
 * the pile.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from './runner.js';

class Card extends Piece<PileGame, Player> {}
class Zone extends Space<PileGame, Player> {}

class PileGame extends Game<PileGame, Player> {
  deck!: Zone;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Card, Zone]);
    this.deck = this.create(Zone, 'deck');
    this.deck.createMany(4, Card, 'card');
    // Setup that removes a card, as a game trimming its deck for the player
    // count would: the constructed game starts with one card in the pile.
    this.deck.first(Card)!.remove();

    this.registerActions(
      Action.create('discard')
        .prompt('Discard a card')
        .execute((_args, ctx) => {
          (ctx.game as PileGame).deck.first(Card)!.remove();
        }),
      // Removes a card, then throws: the runner rolls the game back in place.
      Action.create('discardThenFail')
        .prompt('Discard, then fail')
        .execute((_args, ctx) => {
          (ctx.game as PileGame).deck.first(Card)!.remove();
          throw new Error('rules bug after the discard');
        }),
    );

    this.setFlow({
      root: loop({
        maxIterations: 20,
        do: eachPlayer({ do: actionStep({ actions: ['discard', 'discardThenFail'] }) }),
      }),
    });
  }
}

const options = { playerCount: 2, playerNames: ['A', 'B'], seed: 'pile', elementIdKey: '0000000000000650' };

function startedRunner(): GameRunner<PileGame> {
  // Full history: the restore below reaches checkpoint 0 after the turn has passed on.
  const runner = new GameRunner({ GameClass: PileGame, gameType: 'pile', gameOptions: options, checkpoints: { history: 'full' } });
  runner.start();
  return runner;
}

describe('Game.loadSerializedState and the pile (#650)', () => {
  it('does not leave a removed card in the pile once the restore puts it back in the tree', () => {
    const game = new PileGame(options);
    const state = game.toJSON();
    const cardId = game.deck.first(Card)!.id;
    game.deck.first(Card)!.remove();

    game.loadSerializedState(state);
    game.deck.first(Card)!.remove();

    const piled = game.pile.all(Card);
    expect(piled.map((card) => card.id)).toEqual([cardId]);
    expect(game.getElementById(cardId)).toBe(game.pile.first(Card));
  });

  it('gives the same pile as a fresh restore of the same state', () => {
    const game = new PileGame(options);
    game.deck.first(Card)!.remove();
    const state = game.toJSON();

    const fresh = Game.restoreGame(state, PileGame, game._ctx.classRegistry, options.elementIdKey);
    game.loadSerializedState(state);

    expect(game.pile.all(Card)).toHaveLength(0);
    expect(fresh.pile.all(Card)).toHaveLength(0);
  });
});

describe('GameRunner restores and the pile (#650)', () => {
  it('empties the pile when a failed action is rolled back in place', () => {
    const runner = startedRunner();
    expect(runner.performAction('discardThenFail', 1, {}).success).toBe(false);

    expect(runner.game.pile.all(Card)).toHaveLength(0);
    expect(runner.game.deck.all(Card)).toHaveLength(3);
  });

  it('gives the same pile on an undo through fromCheckpoint as an in-place restore of that checkpoint', () => {
    const runner = startedRunner();
    expect(runner.performAction('discard', 1, {}).success).toBe(true);
    const snapshot = runner.getSnapshot();

    const undone = GameRunner.fromCheckpoint(snapshot, 0, PileGame)!;
    runner.game.loadSerializedState(snapshot.actionCheckpoints!.entries[0]!.state);

    expect(undone.game.pile.all(Card)).toHaveLength(0);
    expect(runner.game.pile.all(Card)).toHaveLength(0);
    expect(undone.game.deck.all(Card)).toHaveLength(3);
  });
});
