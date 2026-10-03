/**
 * DOES A STORED PARTITION BELONG TO THE KEY THIS WORLD WAS BUILT WITH? (#482)
 *
 * Every partition a world stores hangs from the game root, and the root's id
 * is the keyed cipher of counter value 0. So a stored `parentId` that is not
 * this world's root id is proof that the bytes were minted under another key:
 * the host handed back the wrong world's key, minted a fresh one on a wake, or
 * is serving bytes written before world ids were keyed. Nothing the game did
 * can cause it, so it is the platform's refusal, raised before anything is
 * adopted.
 */
import { worldRefusal } from "./refusals.js";

export function assertMintedUnderThisKey(
  partition: string | undefined,
  parentId: number,
  rootId: number,
): void {
  if (parentId === rootId) return;
  throw worldRefusal(
    "element-id-key-mismatch",
    `Stored partition${partition === undefined ? "" : ` "${partition}"`} was not written under ` +
      `the element id key this world was built with: it hangs from element ${parentId}, and ` +
      `under this key the world's root is element ${rootId}. Pass the key that was stored with ` +
      `this world when it was created. A world stored before world element ids were keyed ` +
      `(#482) cannot be read by this engine at all.`,
  );
}
