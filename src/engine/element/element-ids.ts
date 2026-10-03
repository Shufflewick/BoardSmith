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
 * So a table game's id is the counter run through a block cipher. A block
 * cipher is a permutation of its block, so every counter value still gets its
 * own id, and the same key always mints the same ids -- restore, undo and bot
 * search are untouched. Without the key the ids are unordered and carry no
 * count.
 *
 * THE KEY IS ITS OWN SECRET, NOT THE SEED. The game root is always counter
 * value 0 and its id is in every seat's view, so anyone who can guess the key
 * can check a guess against it offline. A seed is chosen by the host and may
 * be short (a 32-bit number is searched in half an hour on one core), so a
 * key derived from it would only be as strong as the weakest host. The key is
 * 64 bits from the platform's cryptographic random source, minted when the
 * game is constructed and recorded with its constructor options
 * (`GameOptions.elementIdKey`), so every snapshot, restore, undo checkpoint
 * and bot search carries it without being told to. It must never reach a
 * client; nothing that is sent to a seat includes the constructor options.
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

/** An element id key: 64 bits as 16 lowercase hex digits. */
const ELEMENT_ID_KEY_PATTERN = /^[0-9a-f]{16}$/;

/**
 * A fresh element id key, from the platform's cryptographic random source.
 * There is no fallback: a key from a predictable source would decode every id.
 */
export function mintElementIdKey(): string {
  const source = globalThis.crypto;
  if (typeof source?.getRandomValues !== 'function') {
    throw new Error(
      'BoardSmith needs crypto.getRandomValues to mint a game\'s element id key, and this runtime ' +
        'has none. Run the engine on Node 19 or later, a browser, or a Workers runtime, or pass ' +
        'GameOptions.elementIdKey from a secure random source.',
    );
  }
  const bytes = source.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

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
 * A table game's ids: Speck32/64 over the creation counter, keyed by `key`
 * (16 hex digits, read as the cipher's four key words, high word first).
 */
export function opaqueElementIds(key: string): ElementIds {
  if (!ELEMENT_ID_KEY_PATTERN.test(key)) {
    throw new Error(
      `GameOptions.elementIdKey must be 16 hexadecimal digits (64 bits, lowercase); this game was ` +
        `given ${JSON.stringify(key)}. Leave it out to have the engine mint one, or pass the key a ` +
        `snapshot of this game recorded in its gameOptions.`,
    );
  }
  const word = (i: number) => parseInt(key.slice(i * 4, i * 4 + 4), 16);
  const roundKeys = speck32RoundKeys([word(3), word(2), word(1), word(0)]);
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
 * (`worldIdAllocationOf`). A world keeps no constructor options across wakes,
 * so a key minted per construction would change on every wake. Opaque world
 * ids need a durable key the host keeps beside its allocation stamp, which is
 * a platform storage decision; until then a world's ids still count creations
 * (#482).
 */
export const sequentialElementIds: ElementIds = {
  mint(cursor) {
    return cursor;
  },
};
