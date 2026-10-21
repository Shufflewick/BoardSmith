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
  enumerateLegalMoves,
  RedactedAttributeError,
  type FlowState,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/index.js';
import { MCTSBot } from '../../bot/index.js';
import { TEST_WORLD_ELEMENT_ID_KEY } from './world-element-id-key.test-helper.js';

type PageData = { kind: string; items: number[] };

function deepFreeze<T>(value: T): T {
  for (const inner of Object.values(value as object)) {
    if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  }
  return Object.freeze(value);
}

/** What each hook saw of the game around it (#1352). */
const hookSaw: Array<{ random: string; flow: FlowState | undefined }> = [];

class Page extends Space<PageGame> {
  data: PageData | null = null;
  /** Another element, so the hook can show it sees the tree decoded. */
  next?: Page;
  /** What `next.data` held when this element's hook ran; `_`-prefixed so it is not saved. */
  _seenNextData?: unknown;

  protected override afterRestore(): void {
    if (this.data) deepFreeze(this.data);
    this._seenNextData = this.next?.data;
    hookSaw.push({ random: this.game.getRandomState(), flow: this.game.getFlowState() });
  }
}

let fragileHookFails = true;
class FragilePage extends Page {
  protected override afterRestore(): void {
    if (fragileHookFails) throw new Error('hook failed');
  }
}

class PageGame extends Game<PageGame, Player> {
  front!: Page;
  back!: Page;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Page, FragilePage]);
    this.front = this.create(Page, 'front');
    this.back = this.create(Page, 'back');
    this.front.data = deepFreeze({ kind: 'a', items: [1, 2] });
    this.back.data = deepFreeze({ kind: 'b', items: [3] });
    // `front` precedes `back` in the tree, so its hook runs first.
    this.front.next = this.back;

    this.registerAction(
      Action.create('write').execute((_args, ctx) => {
        ctx.game.random();
        (ctx.game as PageGame).front.data = deepFreeze({ kind: 'c', items: [4] });
        return { success: true };
      }),
    );
    this.registerAction(
      Action.create('drawThenFail').execute((_args, ctx) => {
        ctx.game.random();
        throw new Error('fails after a draw');
      }),
    );
    // A repeating pick is enumerated on a scratch copy of the game.
    this.registerAction(
      Action.create('stack')
        .chooseFrom('picks', { choices: ['x'], repeat: { until: () => true } })
        .execute(() => {}),
    );
    this.setFlow({
      root: actionStep({ actions: ['write', 'drawThenFail', 'stack'], player: (ctx) => ctx.game.getPlayer(1)!, repeatUntil: () => false, maxMoves: 10 }),
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
    const page = restored.game.front;

    expect(page.data).toEqual({ kind: 'a', items: [1, 2] });
    expect(Object.isFrozen(page.data)).toBe(true);
    expect(() => page.data!.items.push(3)).toThrow(TypeError);
  });

  it('runs once the whole tree is decoded, so a referenced element already holds its value', () => {
    const restored = GameRunner.fromSnapshot<PageGame>(roundTripJson(startedRunner().getSnapshot()), PageGame);

    expect(restored.game.front._seenNextData).toEqual({ kind: 'b', items: [3] });
  });

  it('runs on undo, so the checkpoint restored is frozen too', () => {
    const runner = startedRunner();
    expect(runner.performAction('write', 1, {}).success).toBe(true);

    const undone = GameRunner.fromCheckpoint<PageGame>(roundTripJson(runner.getSnapshot()), 0, PageGame)!;

    expect(undone.game.front.data).toEqual({ kind: 'a', items: [1, 2] });
    expect(Object.isFrozen(undone.game.front.data!.items)).toBe(true);
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

  it('leaves nothing adopted when a hook throws, so the adoption can be tried again', () => {
    const game = new PageGame({ playerCount: 2, seed: 'world', worldMode: true, elementIdKey: TEST_WORLD_ELEMENT_ID_KEY });
    const room = game.create(Space, 'room');
    room.create(FragilePage, 'stored');
    game.definePartition(room.id);
    const stored = roundTripJson(room.toJSON());
    game.evictSubtree(room.id);

    expect(() => game.adoptSubtree(stored)).toThrow('hook failed');
    expect(game.getElementById(room.id)).toBeUndefined();

    fragileHookFails = false;
    expect(game.adoptSubtree(stored).first(FragilePage)).toBeDefined();
  });

  it('runs once a cold restore has put back turn order and random state (#1352)', () => {
    const runner = startedRunner();
    expect(runner.performAction('write', 1, {}).success).toBe(true);
    hookSaw.length = 0;

    const restored = GameRunner.fromSnapshot<PageGame>(roundTripJson(runner.getSnapshot()), PageGame);

    expect(hookSaw.length).toBeGreaterThan(0);
    for (const saw of hookSaw) {
      expect(saw.random).toBe(restored.game.getRandomState());
      expect(saw.flow).toEqual(restored.game.getFlowState());
    }
  });

  it('runs once a failed action rolled back turn order and random state (#1352)', () => {
    const runner = startedRunner();
    hookSaw.length = 0;

    expect(runner.performAction('drawThenFail', 1, {}).success).toBe(false);

    expect(hookSaw.length).toBeGreaterThan(0);
    for (const saw of hookSaw) {
      expect(saw.random).toBe(runner.game.getRandomState());
      expect(saw.flow).toEqual(runner.game.getFlowState());
    }
  });

  it('runs on a scratch copy once its turn order and random state are back (#1352)', () => {
    const game = startedRunner().game;
    hookSaw.length = 0;

    expect(enumerateLegalMoves(game, 1)).toContainEqual({ action: 'stack', args: { picks: ['x'] } });

    expect(hookSaw.length).toBeGreaterThan(0);
    for (const saw of hookSaw) {
      expect(saw.random).toBe(game.getRandomState());
      expect(saw.flow).toEqual(game.getFlowState());
    }
  });

  it('runs on a bot search copy after its sampler filled in hidden values, so they are frozen there too (#1352)', async () => {
    class HiddenPage extends Space<HiddenGame> {
      static override visibleAttributes = ['name'];
      data: PageData | null = null;
      protected override afterRestore(): void {
        if (!this.isAttributeRedacted('data') && this.data) deepFreeze(this.data);
      }
    }
    const frozenWhenRead: boolean[] = [];
    class HiddenGame extends Game<HiddenGame, Player> {
      constructor(options: GameOptions) {
        super(options);
        this.registerElements([HiddenPage]);
        this.create(HiddenPage, 'page').data = deepFreeze({ kind: 'real', items: [] });
        this.registerAction(
          Action.create('read').execute((_args, ctx) => {
            frozenWhenRead.push(Object.isFrozen(ctx.game.first(HiddenPage)!.data));
            ctx.game.finish([]);
          }),
        );
        this.setFlow({ root: actionStep({ actions: ['read'], player: (ctx) => ctx.game.getPlayer(1)! }) });
      }
    }
    const game = new HiddenGame({ playerCount: 2, seed: 'hidden' });
    game.startFlow();
    const bot = new MCTSBot(
      game,
      HiddenGame,
      'hidden',
      1,
      { iterations: 4, playoutDepth: 1, seed: 'search', async: false, timeout: Infinity, usePNS: false },
      {
        determinize: (sandbox) => {
          const page = sandbox.first(HiddenPage)!;
          if (page.isAttributeRedacted('data')) page.data = { kind: 'sampled', items: [] };
        },
      },
    );

    await bot.play();

    expect(frozenWhenRead.length).toBeGreaterThan(0);
    expect(frozenWhenRead.every(Boolean)).toBe(true);
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
    careful._afterRestoreSubtree();
    expect(careful.first(SecretPage)!.isAttributeRedacted('data')).toBe(true);

    game.create(CarelessPage, 'careless').data = { kind: 's', items: [] };
    const careless = new SecretGame(options);
    careless.loadSerializedState(game.toJSONForPlayer(1));
    expect(() => careless._afterRestoreSubtree()).toThrow(RedactedAttributeError);
  });
});
