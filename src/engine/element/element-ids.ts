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
 *
 * A WORLD'S IDS ARE KEYED TOO, BY A KEY ITS HOST KEEPS (#482). A world's ids
 * are durable: stored partitions hold them across every wake, and a world
 * keeps no constructor options between wakes, so a key the engine minted per
 * construction would change on every wake and orphan every stored id. The key
 * is therefore the HOST's: minted once, when the world is created
 * (`mintWorldElementIdKey`), stored with the world, and handed back on every
 * wake (`WorldRunnerOptions.elementIdKey`). The engine never mints one for a
 * world, and never sends one to a seat.
 *
 * A world's cipher is Speck48/96: a 48-bit block and a 96-bit key. The wider
 * block is a budget decision. A world lives for seasons and its clock creates
 * elements whether or not anybody is watching, so 2^32 lifetime creations is
 * a ceiling a busy world can reach (a hundred creations a second does it in
 * under a year and a half), and reaching it ends the world for good: no id
 * could ever be minted again. 2^48 is ninety thousand years at that rate, and
 * every 48-bit id is still a safe integer, so ids stay plain numbers. A world
 * also needs its ids read BACK to counter values (`WorldElementIds.cursorOf`):
 * the host's allocation stamp and the construction floor are counter values,
 * and adoption checks stored ids against both.
 */

import { secureRandomHex } from '../../utils/secure-random.js';

/** How many distinct element ids a table game can mint: Speck32's 32-bit block. */
export const ELEMENT_ID_SPACE = 2 ** 32;

/** How many distinct element ids a world can mint: Speck48's 48-bit block (#482). */
export const WORLD_ELEMENT_ID_SPACE = 2 ** 48;

/** Turns the creation counter into the id the element is known by. */
export interface ElementIds {
  /** The id for creation-counter value `cursor`. Never the same for two cursors. */
  mint(cursor: number): number;
}

/**
 * A world's ids, which can also be read back to the counter (#482).
 *
 * A world's allocation stamp and its construction floor are counter values,
 * and a world adopts ids that were minted by an earlier process, so it has to
 * ask which counter value a stored id came from.
 */
export interface WorldElementIds extends ElementIds {
  /** The counter value `id` was minted from. The inverse of `mint`. */
  cursorOf(id: number): number;
}

/** One member of the Speck family: its word size, round count and rotations. */
export interface SpeckShape {
  readonly wordBits: number;
  readonly rounds: number;
  readonly alpha: number;
  readonly beta: number;
}

/** Speck32/64: 16-bit words, 22 rounds, rotations of 7 and 2. */
export const SPECK_32_64: SpeckShape = { wordBits: 16, rounds: 22, alpha: 7, beta: 2 };

/** Speck48/96: 24-bit words, 23 rounds, rotations of 8 and 3. */
export const SPECK_48_96: SpeckShape = { wordBits: 24, rounds: 23, alpha: 8, beta: 3 };

/** A keyed Speck permutation of one block size. */
export interface SpeckCipher {
  encrypt(block: number): number;
  decrypt(block: number): number;
}

/**
 * Speck with `shape`, keyed by its four key words `[k0, l0, l1, l2]` (the
 * paper writes the same key as `l2 l1 l0 k0`).
 *
 * Words are at most 24 bits, so every shift and rotation below stays inside
 * the 32 bits JavaScript's bit operators work in, and a block (two words) is
 * at most 48 bits, which is joined and split with arithmetic rather than bit
 * operators.
 */
export function speck(shape: SpeckShape, key: readonly [number, number, number, number]): SpeckCipher {
  const { wordBits, rounds, alpha, beta } = shape;
  const wordSpace = 2 ** wordBits;
  const mask = wordSpace - 1;
  const rotateRight = (word: number, by: number): number =>
    ((word >>> by) | (word << (wordBits - by))) & mask;
  const rotateLeft = (word: number, by: number): number =>
    ((word << by) | (word >>> (wordBits - by))) & mask;

  const roundKeys: number[] = [key[0]];
  const l = [key[1], key[2], key[3]];
  for (let i = 0; i < rounds - 1; i += 1) {
    const next = ((roundKeys[i]! + rotateRight(l[i]!, alpha)) & mask) ^ i;
    l.push(next);
    roundKeys.push(rotateLeft(roundKeys[i]!, beta) ^ next);
  }

  return {
    encrypt(block) {
      let x = Math.floor(block / wordSpace);
      let y = block % wordSpace;
      for (let i = 0; i < rounds; i += 1) {
        x = ((rotateRight(x, alpha) + y) & mask) ^ roundKeys[i]!;
        y = rotateLeft(y, beta) ^ x;
      }
      return x * wordSpace + y;
    },
    decrypt(block) {
      let x = Math.floor(block / wordSpace);
      let y = block % wordSpace;
      for (let i = rounds - 1; i >= 0; i -= 1) {
        y = rotateRight(y ^ x, beta);
        x = rotateLeft(((x ^ roundKeys[i]!) - y) & mask, alpha);
      }
      return x * wordSpace + y;
    },
  };
}

/** A table game's element id key: 64 bits as 16 lowercase hex digits. */
const ELEMENT_ID_KEY_PATTERN = /^[0-9a-f]{16}$/;

/** A world's element id key: 96 bits as 24 lowercase hex digits (#482). */
const WORLD_ELEMENT_ID_KEY_PATTERN = /^[0-9a-f]{24}$/;

/**
 * A fresh element id key, from the platform's cryptographic random source.
 * There is no fallback: a key from a predictable source would decode every id.
 */
export function mintElementIdKey(): string {
  return secureRandomHex(
    8,
    "mint a game's element id key",
    'pass GameOptions.elementIdKey from a secure random source',
  );
}

/**
 * A fresh WORLD element id key, for a host to mint ONCE, when it creates a
 * world, and store with that world for as long as the world lives (#482).
 *
 * The engine never calls this for a world on its own: a key minted on a wake
 * instead of read back from storage would turn every stored id into a number
 * nothing can read. Keep it as secret as the world's stored partitions, and
 * never send it to a client: whoever holds it can read every id a seat sees
 * back into the count of elements created anywhere in the world.
 */
export function mintWorldElementIdKey(): string {
  return secureRandomHex(
    12,
    "mint a world's element id key",
    "mint the world's key on a runtime that has one and store it with the world",
  );
}

/** The four key words of a hex key, as `speck` takes them: `[k0, l0, l1, l2]`. */
function keyWords(key: string): [number, number, number, number] {
  const digits = key.length / 4;
  const word = (i: number) => parseInt(key.slice(i * digits, (i + 1) * digits), 16);
  return [word(3), word(2), word(1), word(0)];
}

/**
 * What is wrong with a key, WITHOUT the key. A refusal can end up in a log, and
 * a near miss -- the right digits in the wrong case -- is the host's real
 * secret with one slip in it.
 */
function keyShapeProblem(key: unknown, digits: number): string {
  if (typeof key !== 'string') return `it is a ${key === null ? 'null' : typeof key}, not a string`;
  if (key.length !== digits) return `it is ${key.length} characters long`;
  if (/[A-F]/.test(key) && /^[0-9a-fA-F]+$/.test(key)) return 'it has uppercase hex digits';
  return 'it has characters that are not hex digits';
}

function refuseCursor(cursor: number, space: number, what: 'game' | 'world'): never {
  if (Number.isInteger(cursor) && cursor >= space) {
    throw new Error(
      `This ${what} has created ${space.toLocaleString('en-US')} elements, which is every ` +
        `element id this ${what} can mint, so it cannot create another. A ${what} that creates and ` +
        `removes elements in a loop should move or reuse existing elements instead.`,
    );
  }
  throw new Error(
    `The element id counter stands at ${String(cursor)}, which is not a whole number from 0: the ` +
      `${what}'s saved state is damaged. Restore it from state written by this engine.`,
  );
}

/**
 * A table game's ids: Speck32/64 over the creation counter, keyed by `key`
 * (16 hex digits, read as the cipher's four key words, high word first).
 */
export function opaqueElementIds(key: string): ElementIds {
  if (!ELEMENT_ID_KEY_PATTERN.test(key)) {
    throw new Error(
      `GameOptions.elementIdKey must be 16 hexadecimal digits (64 bits, lowercase), and the key ` +
        `this game was given is not: ${keyShapeProblem(key, 16)}. Leave it out to have the engine ` +
        `mint one, or pass the key a snapshot of this game recorded in its gameOptions.`,
    );
  }
  const cipher = speck(SPECK_32_64, keyWords(key));
  return {
    mint(cursor) {
      if (!(Number.isInteger(cursor) && cursor >= 0 && cursor < ELEMENT_ID_SPACE)) {
        refuseCursor(cursor, ELEMENT_ID_SPACE, 'game');
      }
      return cipher.encrypt(cursor);
    },
  };
}

/**
 * A WORLD's ids (#482): Speck48/96 over the creation counter, keyed by the
 * world's durable key (24 hex digits, read as the cipher's four key words,
 * high word first). The same key always mints the same ids, so a world
 * rebuilt on every wake from its stored key and allocation stamp reads its
 * stored ids exactly as the process that minted them did.
 */
export function worldElementIds(key: string): WorldElementIds {
  if (!WORLD_ELEMENT_ID_KEY_PATTERN.test(key)) {
    throw new Error(
      `A world's element id key must be 24 hexadecimal digits (96 bits, lowercase), and the key ` +
        `this world was given is not: ${keyShapeProblem(key, 24)}. Mint one with ` +
        `\`mintWorldElementIdKey()\` when the world is created, store it with the world, and pass ` +
        `that same key on every wake.`,
    );
  }
  const cipher = speck(SPECK_48_96, keyWords(key));
  return {
    mint(cursor) {
      if (!(Number.isInteger(cursor) && cursor >= 0 && cursor < WORLD_ELEMENT_ID_SPACE)) {
        refuseCursor(cursor, WORLD_ELEMENT_ID_SPACE, 'world');
      }
      return cipher.encrypt(cursor);
    },
    cursorOf(id) {
      if (!(Number.isInteger(id) && id >= 0 && id < WORLD_ELEMENT_ID_SPACE)) {
        throw new Error(
          `${String(id)} is not an element id this world could have minted: a world's ids are ` +
            `whole numbers from 0 to 2^48 - 1. The stored bytes holding it are damaged.`,
        );
      }
      return cipher.decrypt(id);
    },
  };
}
