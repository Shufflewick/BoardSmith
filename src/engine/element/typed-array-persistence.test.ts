import { describe, it, expect } from 'vitest';
import { Game, Player, captureDevState, restoreDevState } from '../index.js';
import type { GameOptions, ElementClass } from '../index.js';

/**
 * Typed-array persistence across a snapshot round-trip.
 *
 * A typed array is the natural reach for bulk data in game state (a terrain map,
 * a fog-of-war mask, a visited-sector bitmap) — exactly what an author does after
 * reading the state-size guidance. Before this was handled, a `Uint8Array` was
 * not `Array.isArray`, not a `Map` and not a `Set`, so it fell into the plain
 * object branch of `serializeValue` and corrupted twice, silently:
 *
 *   1. size — `Object.entries(new Uint8Array([1,2,3]))` is `[['0',1],…]`, so it
 *      serialized as `{"0":1,"1":0,…}`: 6-8 JSON bytes per byte of data,
 *      multiplied again by the checkpoint window and by every per-seat view.
 *   2. type — it restored as a plain object, so `.subarray` / `.set` / iteration
 *      broke far from the serialization boundary that caused it.
 *
 * These tests prove typed arrays now round-trip as their exact concrete type,
 * with a compact base64 payload, and that the shapes we deliberately do NOT
 * support fail loudly instead of silently flattening to `{}`.
 */
async function simulateHMR<G extends Game>(original: G, GameClass: new (o: GameOptions) => G): Promise<G> {
  const devState = captureDevState(original);
  const classRegistry = new Map<string, ElementClass>();
  for (const [name, cls] of original._ctx.classRegistry) classRegistry.set(name, cls);
  const restored = restoreDevState(devState, GameClass, {
    gameOptions: { playerCount: original.players.length, playerNames: original.players.map(p => p.name) },
    classRegistry,
  });
  await Promise.resolve();
  return restored;
}

describe('typed array persistence', () => {
  it('a Uint8Array survives as a real Uint8Array with its bytes intact', async () => {
    class TerrainGame extends Game<TerrainGame, Player> {
      terrain = new Uint8Array(0);
    }
    const game = await new TerrainGame({ playerCount: 2 }).ready();
    game.terrain = new Uint8Array([0, 1, 200, 255, 42]);

    const restored = await simulateHMR(game, TerrainGame);

    expect(restored.terrain).toBeInstanceOf(Uint8Array);
    expect([...restored.terrain]).toEqual([0, 1, 200, 255, 42]);
    // The exact regression: typed-array methods must still be callable.
    expect(() => restored.terrain.subarray(1, 3)).not.toThrow();
    expect([...restored.terrain.subarray(1, 3)]).toEqual([1, 200]);
  });

  it('does not inflate a packed byte array (the ~7x size regression)', async () => {
    class TerrainGame extends Game<TerrainGame, Player> {
      terrain = new Uint8Array(0);
    }
    const game = await new TerrainGame({ playerCount: 2 }).ready();
    game.terrain = new Uint8Array(4096).fill(7);

    const json = JSON.stringify(game.toJSON());

    // The old plain-object encoding produced {"0":7,"1":7,…} — ~28 KB for 4 KB
    // of data. base64 is 4 chars per 3 bytes, so ~5.5 KB total.
    expect(json).not.toMatch(/"0":7,"1":7,"2":7/);
    expect(json.length).toBeLessThan(4096 * 2);
  });

  it('round-trips every supported typed-array type, byte order included', async () => {
    class AllTypesGame extends Game<AllTypesGame, Player> {
      i8 = new Int8Array([-128, 0, 127]);
      u8 = new Uint8Array([0, 128, 255]);
      c8 = new Uint8ClampedArray([0, 128, 255]);
      i16 = new Int16Array([-32768, 0, 32767]);
      u16 = new Uint16Array([0, 1, 65535]);
      i32 = new Int32Array([-2147483648, 0, 2147483647]);
      u32 = new Uint32Array([0, 1, 4294967295]);
      f32 = new Float32Array([0.5, -1.25, 1e10]);
      f64 = new Float64Array([0.1, -1.5, Number.MAX_VALUE]);
      i64 = new BigInt64Array([-9007199254740993n, 0n, 9007199254740993n]);
      u64 = new BigUint64Array([0n, 1n, 18446744073709551615n]);
    }
    const game = await new AllTypesGame({ playerCount: 2 }).ready();
    const restored = await simulateHMR(game, AllTypesGame);

    expect(restored.i8).toBeInstanceOf(Int8Array);
    expect([...restored.i8]).toEqual([-128, 0, 127]);
    expect(restored.u8).toBeInstanceOf(Uint8Array);
    expect([...restored.u8]).toEqual([0, 128, 255]);
    expect(restored.c8).toBeInstanceOf(Uint8ClampedArray);
    expect([...restored.c8]).toEqual([0, 128, 255]);
    expect(restored.i16).toBeInstanceOf(Int16Array);
    expect([...restored.i16]).toEqual([-32768, 0, 32767]);
    expect(restored.u16).toBeInstanceOf(Uint16Array);
    expect([...restored.u16]).toEqual([0, 1, 65535]);
    expect(restored.i32).toBeInstanceOf(Int32Array);
    expect([...restored.i32]).toEqual([-2147483648, 0, 2147483647]);
    expect(restored.u32).toBeInstanceOf(Uint32Array);
    expect([...restored.u32]).toEqual([0, 1, 4294967295]);
    expect(restored.f32).toBeInstanceOf(Float32Array);
    expect([...restored.f32]).toEqual([...new Float32Array([0.5, -1.25, 1e10])]);
    expect(restored.f64).toBeInstanceOf(Float64Array);
    expect([...restored.f64]).toEqual([0.1, -1.5, Number.MAX_VALUE]);
    expect(restored.i64).toBeInstanceOf(BigInt64Array);
    expect([...restored.i64]).toEqual([...new BigInt64Array([-9007199254740993n, 0n, 9007199254740993n])]);
    expect(restored.u64).toBeInstanceOf(BigUint64Array);
    expect([...restored.u64]).toEqual([0n, 1n, 18446744073709551615n]);
  });

  it('encodes byte order explicitly, not host-dependently', async () => {
    class OrderGame extends Game<OrderGame, Player> {
      values = new Uint16Array([0x0102]);
    }
    const game = await new OrderGame({ playerCount: 2 }).ready();
    const json = game.toJSON() as unknown as { attributes: Record<string, { __typedArray: string; data: string }> };
    // 0x0102 little-endian is bytes [0x02, 0x01] -> base64 "AgE=".
    expect(json.attributes.values).toEqual({ __typedArray: 'Uint16Array', data: 'AgE=' });
  });

  it('round-trips an empty typed array', async () => {
    class EmptyGame extends Game<EmptyGame, Player> {
      empty = new Uint8Array(0);
    }
    const game = await new EmptyGame({ playerCount: 2 }).ready();
    const restored = await simulateHMR(game, EmptyGame);

    expect(restored.empty).toBeInstanceOf(Uint8Array);
    expect(restored.empty.length).toBe(0);
  });

  it('round-trips a typed array nested in an object, an array, a Map and a Set', async () => {
    class NestedGame extends Game<NestedGame, Player> {
      wrapper: { mask: Uint8Array } = { mask: new Uint8Array([1, 2]) };
      list: Uint8Array[] = [new Uint8Array([3, 4])];
      byId: Map<string, Uint8Array> = new Map([['a', new Uint8Array([5, 6])]]);
      masks: Set<Uint8Array> = new Set([new Uint8Array([7, 8])]);
    }
    const game = await new NestedGame({ playerCount: 2 }).ready();
    const restored = await simulateHMR(game, NestedGame);

    expect(restored.wrapper.mask).toBeInstanceOf(Uint8Array);
    expect([...restored.wrapper.mask]).toEqual([1, 2]);
    expect(restored.list[0]).toBeInstanceOf(Uint8Array);
    expect([...restored.list[0]]).toEqual([3, 4]);
    expect(restored.byId.get('a')).toBeInstanceOf(Uint8Array);
    expect([...restored.byId.get('a')!]).toEqual([5, 6]);
    const [onlyMask] = [...restored.masks];
    expect(onlyMask).toBeInstanceOf(Uint8Array);
    expect([...onlyMask]).toEqual([7, 8]);
  });

  it('serializes a view over a shared buffer as just its own window', async () => {
    class ViewGame extends Game<ViewGame, Player> {
      window = new Uint8Array(0);
    }
    const game = await new ViewGame({ playerCount: 2 }).ready();
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    game.window = backing.subarray(2, 4);

    const restored = await simulateHMR(game, ViewGame);

    expect(restored.window).toBeInstanceOf(Uint8Array);
    expect([...restored.window]).toEqual([3, 4]);
    expect(restored.window.length).toBe(2);
  });

  it('refuses a bare ArrayBuffer loudly instead of flattening it to {}', async () => {
    class BufferGame extends Game<BufferGame, Player> {
      buffer = new ArrayBuffer(8);
    }
    const game = await new BufferGame({ playerCount: 2 }).ready();

    expect(() => game.toJSON()).toThrow(/ArrayBuffer.*'buffer'/s);
    expect(() => game.toJSON()).toThrow(/Uint8Array/);
  });

  it('refuses a DataView loudly instead of flattening it to {}', async () => {
    class ViewGame extends Game<ViewGame, Player> {
      view = new DataView(new ArrayBuffer(8));
    }
    const game = await new ViewGame({ playerCount: 2 }).ready();

    expect(() => game.toJSON()).toThrow(/DataView.*'view'/s);
  });
});
