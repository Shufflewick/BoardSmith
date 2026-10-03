/**
 * #447: an element id must not tell a seat how many elements were created
 * where it could not see them.
 *
 * Ids came from one shared counter, so every element a seat could see carried
 * the count of everything created before it, hidden or not. Seat 1 buys two
 * items into a zone hidden from seat 2; seat 2 then buys one, and its own new
 * element's id is two higher than it would have been -- seat 2 has counted
 * seat 1's secret purchases off its own element.
 *
 * Ids are now an opaque, keyed permutation of the creation counter: unique,
 * stable and deterministic for the game, but carrying no order or count to
 * anyone without the game's id key -- a 64-bit secret minted per game, never
 * derived from the seed (a host's seed may be guessable). These tests pin both halves: the leak is
 * gone, and replay, restore and undo still mint the same ids.
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
  flowBoundaryKey,
  type BoundaryKeyState,
  type GameOptions,
} from '../index.js';
import { GameSession, executeOp, type GameDefinitionLike } from '../../session/index.js';
import { GameRunner } from '../../runtime/index.js';

class Item extends Piece<ShopGame> {}
class Zone extends Space<ShopGame> {}

class ShopGame extends Game<ShopGame, Player> {
  vault!: Zone;
  shelf!: Zone;
  /** Seat 1 shops first, then seat 2 for the rest of the game. */
  shopped = false;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Item, Zone]);
    // Seat 1's purchases, true-hidden from seat 2: no placeholders, no count.
    this.vault = this.create(Zone, 'vault');
    this.vault.contentsHidden();
    this.vault.addZoneVisibleTo(1);
    this.shelf = this.create(Zone, 'shelf');

    this.registerAction(
      Action.create('buySecretly')
        .chooseFrom('count', { choices: [0, 1, 2, 3, 4, 5] })
        .execute((args, ctx) => {
          const game = ctx.game as ShopGame;
          for (let i = 0; i < (args.count as number); i += 1) game.vault.create(Item, 'secret');
          game.shopped = true;
          return { success: true };
        }),
    );
    this.registerAction(
      Action.create('buy').execute((_args, ctx) => {
        const game = ctx.game as ShopGame;
        game.shelf.create(Item, `bought-by-${ctx.player.seat}`, { player: ctx.player });
        return { success: true };
      }),
    );
    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['buySecretly', 'buy'],
          player: (ctx) => ctx.game.getPlayer(ctx.game.shopped ? 2 : 1)!,
          repeatUntil: () => false,
        }),
      }),
    );
  }
}

/** The shop as a platform host runs it, op by op. */
const shopDefinition = { gameClass: ShopGame, gameType: 'shop', minPlayers: 2, maxPlayers: 2 } satisfies GameDefinitionLike;

/** Seat 1 buys `secret` items in secret, then seat 2 buys one; seat 2's view of its own item's id. */
async function idSeat2Sees(secret: number): Promise<number> {
  // One seed and one id key for every run, so the hidden purchases are the
  // only difference between them.
  const session = GameSession.create({
    gameType: 'shop',
    GameClass: ShopGame,
    playerCount: 2,
    playerNames: ['Ann', 'Bo'],
    seed: 'shop',
    elementIdKey: '0123456789abcdef',
  });
  const first = await session.performAction('buySecretly', 1, { count: secret });
  expect(first.success, first.error).toBe(true);
  const second = await session.performAction('buy', 2, {});
  expect(second.success, second.error).toBe(true);

  const view = session.getState(2).state!.view as { children?: Array<{ name?: string; children?: Array<{ id: number; name?: string }> }> };
  const shelf = view.children!.find((child) => child.name === 'shelf')!;
  return shelf.children!.find((child) => child.name === 'bought-by-2')!.id;
}

describe('a hidden creation cannot be counted through element ids (#447)', () => {
  it("seat 2's own new element does not carry the number of seat 1's secret purchases", async () => {
    const baseline = await idSeat2Sees(0);
    for (const secret of [1, 2, 3, 4, 5]) {
      expect(await idSeat2Sees(secret) - baseline).not.toBe(secret);
    }
  });

  it('the vault really is hidden from seat 2, so the id was the only channel', async () => {
    const session = GameSession.create({ gameType: 'shop', GameClass: ShopGame, playerCount: 2, playerNames: ['Ann', 'Bo'], seed: 'shop' });
    await session.performAction('buySecretly', 1, { count: 2 });
    const view = session.getState(2).state!.view as { children?: Array<{ name?: string; children?: unknown; childCount?: unknown }> };
    const vault = view.children!.find((child) => child.name === 'vault')!;
    expect('children' in vault).toBe(false);
    expect('childCount' in vault).toBe(false);
  });

  it('ids carry no creation order', () => {
    const game = new ShopGame({ playerCount: 2, seed: 'order' });
    const ids = game.shelf.createMany(64, Item, 'item').map((item) => item.id);
    const ascending = [...ids].sort((a, b) => a - b);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toEqual(ascending);
    expect(ids.slice(1).some((id, i) => id - ids[i] !== 1)).toBe(true);
  });

  it('ids are whole, non-negative and safe, so every client keeps treating them as numbers', () => {
    const game = new ShopGame({ playerCount: 2, seed: 'range' });
    for (const item of game.shelf.createMany(256, Item, 'item')) {
      expect(Number.isSafeInteger(item.id)).toBe(true);
      expect(item.id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('opaque ids keep replay, restore and undo exact (#447)', () => {
  it('the same id key mints the same ids, and another key mints others', () => {
    const idsFor = (elementIdKey: string) =>
      new ShopGame({ playerCount: 2, seed: 'replay', elementIdKey }).shelf.createMany(8, Item, 'item').map((item) => item.id);

    expect(idsFor('00000000000000aa')).toEqual(idsFor('00000000000000aa'));
    expect(idsFor('00000000000000aa')).not.toEqual(idsFor('00000000000000bb'));
  });

  it('a runner restored from a snapshot mints the id the live runner mints', () => {
    const live = new GameRunner({ GameClass: ShopGame, gameType: 'shop', gameOptions: { playerCount: 2, seed: 'restore' } });
    live.start();
    expect(live.performAction('buySecretly', 1, { count: 3 }).success).toBe(true);

    const restored = GameRunner.fromSnapshot(live.getSnapshot(), ShopGame);

    expect(live.performAction('buy', 2, {}).success).toBe(true);
    expect(restored.performAction('buy', 2, {}).success).toBe(true);
    const bought = (runner: GameRunner<ShopGame>) => runner.game.shelf.first(Item, 'bought-by-2')!.id;
    expect(bought(restored)).toBe(bought(live));
  });

  it('an undone creation, made again, gets the id it had', async () => {
    const session = GameSession.create({ gameType: 'shop', GameClass: ShopGame, playerCount: 2, playerNames: ['Ann', 'Bo'], seed: 'undo', debugEnabled: true });
    await session.performAction('buySecretly', 1, { count: 1 });
    await session.performAction('buy', 2, {});
    const before = session.runner.game.shelf.first(Item)!.id;

    const rewound = await session.rewindToAction(1);
    expect(rewound.success, rewound.error).toBe(true);
    expect(session.runner.game.shelf.first(Item)).toBeUndefined();

    await session.performAction('buy', 2, {});
    expect(session.runner.game.shelf.first(Item)!.id).toBe(before);
  });

  it('refuses to load a tree whose ids were minted under another key', () => {
    const source = new ShopGame({ playerCount: 2, seed: 'same' });
    const other = new ShopGame({ playerCount: 2, seed: 'same' });

    expect(() => other.loadSerializedState(source.toJSON())).toThrow(/minted under a different element id key/);
  });
});

describe('the id key does not rest on the seed (#447 review)', () => {
  // A host's seed may be short and guessable (a 32-bit number is searchable
  // in minutes), and the root's id is in every seat's view. If the key came
  // from the seed, guessing the seed would decode every id.
  it('two games from the same seed mint unrelated ids', () => {
    const a = new ShopGame({ playerCount: 2, seed: '1234' });
    const b = new ShopGame({ playerCount: 2, seed: '1234' });

    expect(a.id).not.toBe(b.id);
    expect(a.shelf.id).not.toBe(b.shelf.id);
  });

  it('mints a 64-bit key and records it with the constructor options every restore uses', () => {
    const runner = new GameRunner({ GameClass: ShopGame, gameType: 'shop', gameOptions: { playerCount: 2, seed: 'k' } });
    runner.start();
    const key = runner.game.getConstructorOptions().elementIdKey;

    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(runner.getSnapshot().gameOptions?.elementIdKey).toBe(key);
  });

  it('never sends the key to a seat', async () => {
    const session = GameSession.create({ gameType: 'shop', GameClass: ShopGame, playerCount: 2, playerNames: ['Ann', 'Bo'], seed: 'k' });
    await session.performAction('buySecretly', 1, { count: 1 });
    const key = session.runner.game.getConstructorOptions().elementIdKey as string;

    for (const seat of [1, 2]) {
      expect(JSON.stringify(session.getState(seat))).not.toContain(key);
    }
  });

  it('the stateless executor sends the key only in the snapshot the host keeps, never in a seat or spectator view', async () => {
    const started = await executeOp(shopDefinition, { playerCount: 2, seed: 'k' }, null, null, { type: 'start' });
    expect(started.success, started.error).toBe(true);
    const key = (started.snapshot as { gameOptions?: { elementIdKey?: string } }).gameOptions?.elementIdKey as string;
    expect(key).toMatch(/^[0-9a-f]{16}$/);

    const bought = await executeOp(shopDefinition, { playerCount: 2, seed: 'k' }, started.snapshot, null, {
      type: 'action',
      actionName: 'buySecretly',
      player: 1,
      args: { count: 1 },
      boundaryKey: flowBoundaryKey(started.flowState as BoundaryKeyState),
    });
    expect(bought.success, bought.error).toBe(true);

    for (const result of [started, bought]) {
      expect(JSON.stringify(result.playerViews)).not.toContain(key);
      expect(JSON.stringify(result.spectatorView)).not.toContain(key);
      expect(JSON.stringify(result.flowState)).not.toContain(key);
    }
  });

  it('a start op refuses a key supplied from outside: a new game mints its own', async () => {
    const result = await executeOp(shopDefinition, { playerCount: 2, seed: 'k', elementIdKey: '0123456789abcdef' }, null, null, { type: 'start' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/elementIdKey/);
    expect(result.category).toBe('protocol');
  });

  it('refuses a key that is not 16 hex digits', () => {
    expect(() => new ShopGame({ playerCount: 2, elementIdKey: '1234' })).toThrow(/elementIdKey/);
    expect(() => new ShopGame({ playerCount: 2, elementIdKey: 'zzzzzzzzzzzzzzzz' })).toThrow(/elementIdKey/);
  });
});
