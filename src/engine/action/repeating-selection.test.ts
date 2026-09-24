/**
 * The engine's half of #325: a repeating selection has one owner.
 *
 * `processRepeatingStep` is the repeat protocol (validate a pick, run `onEach`,
 * test `until`). A whole submission of an action with a repeating selection
 * runs that protocol pick by pick, and move enumeration asks it for the
 * sequences it offers, so no caller holds a second opinion about what a repeat
 * means.
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
  enumerateLegalMoves,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/runner.js';
import {
  RepeatingCollectGame,
  Token,
} from '../../session/testing/fixtures/repeating-collect-fixture.js';

class Gem extends Piece<GemGame> {}
class Heap extends Space<GemGame> {}
class Pouch extends Space<GemGame> {}

/**
 * A repeating ELEMENT selection: pick gems one at a time, each moved into the
 * pouch by `onEach`, until the pouch holds two.
 */
class GemGame extends Game<GemGame, Player> {
  heap!: Heap;
  pouch!: Pouch;
  /** The `gems` argument the last completed `take` was handed, as names. */
  taken: string[] | null = null;
  eachCalls: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.heap = this.create(Heap, 'heap');
    this.pouch = this.create(Pouch, 'pouch');
    for (const name of ['ruby', 'jade', 'opal']) this.heap.create(Gem, name);

    this.registerAction(
      Action.create('take')
        .chooseElement<'gems', Gem>('gems', {
          elementClass: Gem,
          from: (ctx) => (ctx.game as GemGame).heap,
          repeat: {
            until: (ctx) => (ctx.game as GemGame).pouch.all(Gem).length >= 2,
            onEach: (ctx, gem) => {
              const game = ctx.game as GemGame;
              game.eachCalls.push(gem.name!);
              gem.putInto(game.pouch);
            },
          },
        })
        .execute((args, ctx) => {
          // A repeating selection's argument is its picks. The builder types
          // it as one element, so the array is asserted here.
          const gems = args.gems as unknown as Gem[];
          (ctx.game as GemGame).taken = gems.map((g) => g.name!);
          return { success: true };
        }),
    );

    this.setFlow(
      defineFlow({
        root: actionStep({ actions: ['take'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    );
  }
}

function gemRunner() {
  const runner = new GameRunner({ GameClass: GemGame, gameType: 'gems', gameOptions: { playerCount: 1, seed: 'bs325' } });
  runner.start();
  return runner;
}

function gemOutcome(game: GemGame) {
  return {
    eachCalls: [...game.eachCalls],
    taken: game.taken,
    pouch: game.pouch.all(Gem).map((g) => g.name),
  };
}

describe('a repeating element selection (#325)', () => {
  const expected = { eachCalls: ['opal', 'ruby'], taken: ['opal', 'ruby'], pouch: ['opal', 'ruby'] };

  it('step by step: execute receives the picked ELEMENTS, not their ids', () => {
    const runner = gemRunner();
    const id = (name: string) => runner.game.heap.first(Gem, name)!.id;
    runner.startPendingAction('take', 1);
    expect(runner.processSelectionStep(1, 'gems', id('opal')).success).toBe(true);
    const done = runner.processSelectionStep(1, 'gems', id('ruby'));
    expect(done.error).toBeUndefined();
    expect(done.actionComplete).toBe(true);
    expect(gemOutcome(runner.game)).toEqual(expected);
  });

  it('submitted whole as element ids: the same outcome', () => {
    const runner = gemRunner();
    const id = (name: string) => runner.game.heap.first(Gem, name)!.id;
    const result = runner.performAction('take', 1, { gems: [id('opal'), id('ruby')] });
    expect(result.error).toBeUndefined();
    expect(gemOutcome(runner.game)).toEqual(expected);
  });

  it('submitted whole as element objects: the same outcome', () => {
    const runner = gemRunner();
    const gem = (name: string) => runner.game.heap.first(Gem, name)!;
    const result = runner.performAction('take', 1, { gems: [gem('opal'), gem('ruby')] });
    expect(result.error).toBeUndefined();
    expect(gemOutcome(runner.game)).toEqual(expected);
  });

  it('enumerates only sequences the protocol ends, as live element objects', () => {
    const runner = gemRunner();
    const moves = enumerateLegalMoves(runner.game, 1);
    const names = moves.map((m) => (m.args.gems as Gem[]).map((g) => g.name).join(','));
    expect(names.sort()).toEqual(
      ['jade,opal', 'jade,ruby', 'opal,jade', 'opal,ruby', 'ruby,jade', 'ruby,opal'],
    );
    for (const move of moves) {
      for (const gem of move.args.gems as Gem[]) {
        expect(runner.game.getElementById(gem.id)).toBe(gem);
      }
    }
    // Enumeration ran onEach somewhere else, never on the game it was asked about.
    expect(gemOutcome(runner.game)).toEqual({ eachCalls: [], taken: null, pouch: [] });
  });
});

describe('enumerating a repeating choice (#325)', () => {
  it('offers every sequence that ends at the terminator, and leaves the game untouched', () => {
    const runner = new GameRunner({
      GameClass: RepeatingCollectGame,
      gameType: 'collect',
      gameOptions: { playerCount: 1, seed: 'bs325' },
    });
    runner.start();
    const moves = enumerateLegalMoves(runner.game, 1);
    const sequences = moves.map((m) => (m.args.token as string[]).join(','));

    // Every ordering of every subset of the three tokens, then 'stop'.
    expect(sequences).toHaveLength(16);
    expect(sequences).toContain('stop');
    expect(sequences).toContain('p3,stop');
    expect(sequences).toContain('p2,p1,stop');
    expect(sequences).toContain('p3,p1,p2,stop');
    expect(sequences.every((s) => s.endsWith('stop'))).toBe(true);

    const game = runner.game;
    expect(game.eachCalls).toEqual([]);
    expect(game.stash.all(Token).map((t) => t.name)).toEqual(['p1', 'p2', 'p3']);
  });

  it('every enumerated sequence is accepted by a whole submission', () => {
    const probe = new GameRunner({
      GameClass: RepeatingCollectGame,
      gameType: 'collect',
      gameOptions: { playerCount: 1, seed: 'bs325' },
    });
    probe.start();
    for (const move of enumerateLegalMoves(probe.game, 1)) {
      const runner = new GameRunner({
        GameClass: RepeatingCollectGame,
        gameType: 'collect',
        gameOptions: { playerCount: 1, seed: 'bs325' },
      });
      runner.start();
      const result = runner.performAction(move.action, 1, move.args);
      expect(result.error).toBeUndefined();
      expect(runner.game.eachCalls).toEqual(move.args.token);
    }
  });
});
