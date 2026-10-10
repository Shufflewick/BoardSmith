/**
 * A repeating pick's later passes are drawn by the same rule as its first
 * (#605).
 *
 * The first pass of a repeating element pick is answered by `getPickChoices`,
 * which labels the candidates with the selection's `display()` and reports a
 * `display()` that throws as a DISPLAY_ERROR warning. Every later pass comes
 * back from the selection step as `nextChoices`, and a refused pick returns
 * the choices still open. Both must carry the same labels, and a soft failure
 * on a later pass must be reported exactly as it is on the first.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { PickHandler } from './pick-handler.js';

class Gem extends Piece<GemGame> {}
class Heap extends Space<GemGame> {}
class Pouch extends Space<GemGame> {}

/** Pick gems one at a time into the pouch until it holds three. */
class GemGame extends Game<GemGame, Player> {
  heap!: Heap;
  pouch!: Pouch;

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
          display: (gem) => {
            if (gem.name === 'opal') throw new Error('opal has no label');
            return `Gem: ${gem.name}`;
          },
          repeat: {
            until: (ctx) => (ctx.game as GemGame).pouch.all(Gem).length >= 3,
            onEach: (ctx, gem) => gem.putInto((ctx.game as GemGame).pouch),
          },
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow({
      root: actionStep({ actions: ['take'], player: (ctx) => ctx.game.getPlayer(1)! }),
    });
  }
}

/** Name colours until 'stop'; boardRefs() cannot place 'blue'. */
class ColourGame extends Game<ColourGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('name')
        .chooseFrom('colours', {
          choices: ['red', 'blue', 'stop'],
          boardRefs: (colour) => {
            if (colour === 'blue') throw new Error('blue has no square');
            return { refs: [] };
          },
          repeatUntil: 'stop',
        })
        .execute(() => ({ success: true })),
    );
    this.setFlow({
      root: actionStep({ actions: ['name'], player: (ctx) => ctx.game.getPlayer(1)! }),
    });
  }
}

function gemHandler() {
  const runner = new GameRunner({ GameClass: GemGame, gameType: 'gems', gameOptions: { playerCount: 1, seed: 'bs605' } });
  runner.start();
  return { runner, handler: new PickHandler(runner, 1) };
}

function gemId(runner: GameRunner<GemGame>, name: string): number {
  return runner.game.heap.first(Gem, name)!.id;
}

describe('a repeating element pick, after its first pass (#605)', () => {
  it("labels a refused pick's open choices with the selection's display()", async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { runner, handler } = gemHandler();
      const step = await handler.processSelectionStep(1, 'gems', 999_999, 'take');

      expect(step.success).toBe(false);
      expect(step.nextChoices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: gemId(runner, 'ruby'), display: 'Gem: ruby' }),
          expect.objectContaining({ value: gemId(runner, 'jade'), display: 'Gem: jade' }),
        ]),
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('reports a display() that throws on a later pass the way the first pass does', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { runner, handler } = gemHandler();

      const first = handler.getPickChoices('take', 'gems', 1);
      if (!first.success) throw new Error(`first pass refused: ${first.error}`);
      expect(first.warnings?.map((w) => w.code)).toEqual(['DISPLAY_ERROR']);

      const step = await handler.processSelectionStep(1, 'gems', gemId(runner, 'ruby'), 'take');

      expect(step.success).toBe(true);
      expect(step.done).toBe(false);
      expect(step.nextChoices?.map((c) => c.display)).toEqual(
        first.validElements!.filter((e) => e.display !== 'Gem: ruby').map((e) => e.display),
      );
      expect(step.warnings).toEqual(first.warnings);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe('a repeating choice pick, after its first pass (#605)', () => {
  it('reports a boardRefs() that throws on a later pass the way the first pass does', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const runner = new GameRunner({ GameClass: ColourGame, gameType: 'colours', gameOptions: { playerCount: 1, seed: 'bs605' } });
      runner.start();
      const handler = new PickHandler(runner, 1);

      const first = handler.getPickChoices('name', 'colours', 1);
      if (!first.success) throw new Error(`first pass refused: ${first.error}`);
      expect(first.warnings?.map((w) => w.code)).toEqual(['BOARD_REFS_ERROR']);

      const step = await handler.processSelectionStep(1, 'colours', 'red', 'name');

      expect(step.success).toBe(true);
      expect(step.done).toBe(false);
      expect(step.warnings).toEqual(first.warnings);
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
