/**
 * How an element's id is made from the game's creation counter (#447).
 *
 * Every element takes the next value of one counter (`_ctx.sequence`). When
 * that value WAS the id, every id a seat could see carried the count of every
 * element created before it, the ones hidden from that seat included: seat 1
 * buys two items into a zone hidden from seat 2, seat 2 then buys one, and its
 * own new element's id is two higher than it would have been. No visibility
 * setting could stop it, because the id rides on the elements the seat IS
 * allowed to see, and a game's own code puts ids in animation data, messages
 * and flow variables where no view-time rewrite could find them all.
 *
 * So a table game's id is the counter run through a block cipher keyed from
 * its seed. A block cipher is a permutation of its block, so every counter
 * value still gets its own id, and the same seed always mints the same ids --
 * replay, restore, undo and bot search are untouched. Without the key the ids
 * are unordered and carry no count. The key is exactly as secret as the seed,
 * which already has to be: anyone holding the seed can predict every shuffle.
 *
 * The cipher is Speck32/64 (Beaulieu et al., 2013): a 32-bit block, so ids
 * stay small whole numbers every client already handles, and a 64-bit key.
 * The 32-bit block is also the ceiling on how many elements one game can ever
 * create, and minting past it is refused rather than wrapped.
 */

/** How many distinct element ids a game can mint: the cipher's 32-bit block. */
export const ELEMENT_ID_SPACE = 2 ** 32;

/** Turns the creation counter into the id the element is known by. */
export interface ElementIds {
  /** The id for creation-counter value `cursor`. Never the same for two cursors. */
  mint(cursor: number): number;
}

/** Speck32/64: 16-bit words, 22 rounds, rotations of 7 and 2. */
const ROUNDS = 22;
const WORD_MASK = 0xffff;

const rotateRight = (word: number, by: number): number => ((word >>> by) | (word << (16 - by))) & WORD_MASK;
const rotateLeft = (word: number, by: number): number => ((word << by) | (word >>> (16 - by))) & WORD_MASK;

/**
 * Expand a Speck32/64 key, given as its four 16-bit words `[k0, l0, l1, l2]`
 * (the paper writes the same key as `l2 l1 l0 k0`), into the 22 round keys.
 */
export function speck32RoundKeys(key: readonly [number, number, number, number]): Uint16Array {
  const roundKeys = new Uint16Array(ROUNDS);
  const l = [key[1], key[2], key[3]];
  roundKeys[0] = key[0];
  for (let i = 0; i < ROUNDS - 1; i += 1) {
    const next = ((roundKeys[i] + rotateRight(l[i], 7)) & WORD_MASK) ^ i;
    l.push(next);
    roundKeys[i + 1] = rotateLeft(roundKeys[i], 2) ^ next;
  }
  return roundKeys;
}

/** Encrypt one 32-bit block (high word `x`, low word `y`), as an unsigned integer. */
export function speck32Encrypt(roundKeys: Uint16Array, block: number): number {
  let x = (block >>> 16) & WORD_MASK;
  let y = block & WORD_MASK;
  for (let i = 0; i < ROUNDS; i += 1) {
    x = ((rotateRight(x, 7) + y) & WORD_MASK) ^ roundKeys[i];
    y = rotateLeft(y, 2) ^ x;
  }
  return ((x << 16) | y) >>> 0;
}

/**
 * One 32-bit hash of `text` under `salt` (murmur3's mixing). Two of them, with
 * different salts, make the 64-bit key.
 */
function hash32(text: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    let k = Math.imul(text.charCodeAt(i), 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    h ^= Math.imul(k, 0x1b873593);
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= text.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Kept apart from every other use of the seed, the RNG included. */
const KEY_DOMAIN = 'boardsmith/element-ids\u0000';

function refuseCursor(cursor: number): never {
  if (Number.isInteger(cursor) && cursor >= ELEMENT_ID_SPACE) {
    throw new Error(
      `This game has created ${ELEMENT_ID_SPACE.toLocaleString('en-US')} elements, which is every ` +
        `element id this game can mint, so it cannot create another. A game that creates and ` +
        `removes elements in a loop should move or reuse existing elements instead.`,
    );
  }
  throw new Error(
    `The element id counter stands at ${String(cursor)}, which is not a whole number from 0: the ` +
      `game's saved state is damaged. Restore it from a snapshot written by this engine.`,
  );
}

/**
 * A table game's ids: Speck32/64 over the creation counter, keyed from the
 * whole seed string (not from the RNG's 32-bit fold of it).
 */
export function opaqueElementIds(seed: string): ElementIds {
  const keyed = KEY_DOMAIN + seed;
  const high = hash32(keyed, 0x9e3779b9);
  const low = hash32(keyed, 0x85ebca77);
  const roundKeys = speck32RoundKeys([low & WORD_MASK, low >>> 16, high & WORD_MASK, high >>> 16]);
  return {
    mint(cursor) {
      if (!(Number.isInteger(cursor) && cursor >= 0 && cursor < ELEMENT_ID_SPACE)) refuseCursor(cursor);
      return speck32Encrypt(roundKeys, cursor);
    },
  };
}

/**
 * A WORLD's ids: the counter itself.
 *
 * A world's ids are durable -- stored partitions hold them across every wake,
 * and a host derives the next counter value from the highest id it has stored
 * (`worldIdAllocationOf`). Keying them from the seed would break both, because
 * a world host is free to change the seed on every wake (ShufflewickPub mints
 * a fresh one per wake so the RNG cannot be predicted). Opaque world ids need
 * a durable key the host keeps beside its allocation stamp, which is a
 * platform storage decision; until then a world's ids still count creations
 * (#482).
 */
export const sequentialElementIds: ElementIds = {
  mint(cursor) {
    return cursor;
  },
};
