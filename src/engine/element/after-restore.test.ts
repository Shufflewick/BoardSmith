/**
 * #1349: `afterRestore` runs on every element a restore rebuilds, once the
 * whole restored tree is decoded, so a game can re-apply a guard the stored
 * bytes cannot carry -- `Object.freeze` on a page it never edits in place.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Space,
  Action,
  actionStep,
  RedactedAttributeError,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/index.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from './world-element-id-key.test-helper.js';

type PageData = { kind: string; items: number[] };

function deepFreeze<T>(value: T): T {
  for (const inner of Object.values(value as object)) {
    if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  }
  return Object.freeze(value);
}

class Page extends Space<PageGame> {
  data: PageData | null = null;
  /** Another element, so the hook can show it sees the tree decoded. */
  next?: Page;
  /** What `next.data` held when this element's hook ran; `_`-prefixed so it is not saved. */
  _seenNextData?: unknown;

  protected override afterRestore(): void {
    if (this.data) deepFreeze(this.data);
    this._seenNextData = this.next?.data;
  }
}

class PageGame extends Game<PageGame, Player> {
  first!: Page;
  second!: Page;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Page]);
    this.first = this.create(Page, 'first');
    this.second = this.create(Page, 'second');
    this.first.data = deepFreeze({ kind: 'a', items: [1, 2] });
    this.second.data = deepFreeze({ kind: 'b', items: [3] });
    // `first` precedes `second` in the tree, so its hook runs first.
    this.first.next = this.second;

    this.registerAction(
      Action.create('write').execute((_args, ctx) => {
        (ctx.game as PageGame).first.data = deepFreeze({ kind: 'c', items: [4] });
        return { success: true };
      }),
    );
    this.setFlow({
      root: actionStep({ actions: ['write'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 10 }),
    });
  }
}

function roundTripJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function startedRunner(): GameRunner<PageGame> {
  const runner = new GameRunner<PageGame>({
    GameClass: PageGame,
    gameType: 'after-restore-test',
    gameOptions: { playerCount: 2, seed: 'after-restore' },
  });
  runner.start();
  return runner;
}

describe('afterRestore (#1349)', () => {
  it('runs on a cold restore, so a stored page comes back frozen', () => {
    const restored = GameRunner.fromSnapshot<PageGame>(roundTripJson(startedRunner().getSnapshot()), PageGame);
    const page = restored.game.first;

    expect(page.data).toEqual({ kind: 'a', items: [1, 2] });
    expect(Object.isFrozen(page.data)).toBe(true);
    expect(() => page.data!.items.push(3)).toThrow(TypeError);
  });

  it('runs once the whole tree is decoded, so a referenced element already holds its value', () => {
    const restored = GameRunner.fromSnapshot<PageGame>(roundTripJson(startedRunner().getSnapshot()), PageGame);

    expect(restored.game.first._seenNextData).toEqual({ kind: 'b', items: [3] });
  });

  it('runs on undo, so the checkpoint restored is frozen too', () => {
    const runner = startedRunner();
    expect(runner.performAction('write', 1, {}).success).toBe(true);

    const undone = GameRunner.fromCheckpoint<PageGame>(roundTripJson(runner.getSnapshot()), 0, PageGame)!;

    expect(undone.game.first.data).toEqual({ kind: 'a', items: [1, 2] });
    expect(Object.isFrozen(undone.game.first.data!.items)).toBe(true);
  });

  it('runs on a world partition adopted from storage', () => {
    const game = new PageGame({ playerCount: 2, seed: 'world', worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
    const room = game.create(Space, 'room');
    room.create(Page, 'stored').data = { kind: 'w', items: [5] };
    game.definePartition(room.id);
    const stored = roundTripJson(room.toJSON());
    game.evictSubtree(room.id);

    const page = game.adoptSubtree(stored).first(Page)!;

    expect(page.data).toEqual({ kind: 'w', items: [5] });
    expect(Object.isFrozen(page.data!.items)).toBe(true);
  });

  it('runs in a per-seat copy, where a withheld attribute must be asked about first', () => {
    class SecretPage extends Space<SecretGame> {
      static override visibleAttributes = ['name'];
      data: PageData | null = null;
      protected override afterRestore(): void {
        if (!this.isAttributeRedacted('data') && this.data) deepFreeze(this.data);
      }
    }
    class CarelessPage extends SecretPage {
      protected override afterRestore(): void {
        if (this.data) deepFreeze(this.data);
      }
    }
    class SecretGame extends Game<SecretGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerElements([SecretPage, CarelessPage]);
      }
    }
    const options = { playerCount: 2, elementIdKey: '0123456789abcdef' };
    const game = new SecretGame(options);
    game.create(SecretPage, 'guarded').data = { kind: 's', items: [] };
    const careful = new SecretGame(options);
    careful.loadSerializedState(game.toJSONForPlayer(1));
    expect(careful.first(SecretPage)!.isAttributeRedacted('data')).toBe(true);

    game.create(CarelessPage, 'careless').data = { kind: 's', items: [] };
    expect(() => new SecretGame(options).loadSerializedState(game.toJSONForPlayer(1))).toThrow(RedactedAttributeError);
  });
});
