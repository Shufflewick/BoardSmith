/**
 * LIFTING A WORLD WRITTEN BEFORE THE CONSTRUCTION-ID FLOOR (#223).
 *
 * #218 parted the id space: a world's construction spends the counter below
 * `WORLD_PARTITION_ID_FLOOR` and everything it STORES is minted above, so a
 * seat count can change without the wider construction minting ids the stored
 * partitions already hold.
 *
 * That fixes every world written since. It does nothing for a world written
 * BEFORE it, whose roots start at 14 because that is where the old counter
 * happened to be -- and those are exactly the worlds that have a season in
 * them worth keeping. Widening one still failed on the first adoption, with
 * "element id 14 is already resident", before any migration hook could run:
 * `migratePartition` adopts old bytes and only then calls the transform, so
 * there was no supported moment at which an author could have re-keyed
 * anything.
 *
 * ## One offset for the whole world, and why that is the shape
 *
 * A world's references are ids (`{ __elementId }` -- a world serializes a
 * reference by id precisely because a branch path resolves to the wrong
 * element once a partition is absent). Ids therefore mean something ACROSS
 * partitions, so re-keying one partition and not another would break every
 * reference between them.
 *
 * A single additive offset applied to every partition and every queued event
 * preserves the whole relation: two ids that were equal stay equal, two that
 * differed differ by the same amount, and nothing has to know which reference
 * pointed where. The offset is chosen to put the world's LOWEST id exactly on
 * the floor, so the shift is the smallest one that ends the collision.
 *
 * ## What is rewritten, and what is deliberately not
 *
 * The walk is STRUCTURAL, never "every number called `id`". An element JSON
 * node is `{ className, id, attributes, children? }` -- so the node's own `id`
 * is rewritten, `children` are walked, and inside `attributes` the ONLY thing
 * touched is a tagged `{ __elementId }` reference. A game's own `id` field on
 * its own data is untouched, and so is a player's gold.
 *
 * `{ __playerRef }` is untouched too, and that one matters here of all places:
 * it is a 1-INDEXED SEAT rather than an element id, so seat 3 is still seat 3
 * in a world that just grew to five hundred seats.
 */
import { WORLD_PARTITION_ID_FLOOR } from "../engine/index.js";

/** An element JSON node, as much of it as this file has any business knowing. */
interface RekeyableNode {
  className: string;
  id: number;
  attributes?: Record<string, unknown>;
  children?: RekeyableNode[];
  [key: string]: unknown;
}

/** True for the one shape whose `id` is an element id. */
function isElementNode(value: unknown): value is RekeyableNode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  return typeof node.className === "string" && typeof node.id === "number";
}

/**
 * The lowest element id anywhere in this partition's stored bytes.
 *
 * Read across the WHOLE world before anything is shifted: the offset has to be
 * one number, and it is chosen from the world's minimum rather than each
 * partition's.
 */
export function lowestElementId(json: unknown): number {
  if (!isElementNode(json)) return Number.POSITIVE_INFINITY;
  let lowest = json.id;
  for (const child of json.children ?? []) {
    lowest = Math.min(lowest, lowestElementId(child));
  }
  return lowest;
}

/**
 * How far a world whose lowest id is `lowest` must move to clear the floor, or
 * 0 for a world that is already above it.
 *
 * Zero is the answer for every world written since #218, which is what makes
 * this a no-op on the ordinary start rather than a pass over the store.
 */
export function rekeyOffsetFor(lowest: number): number {
  if (!Number.isFinite(lowest) || lowest >= WORLD_PARTITION_ID_FLOOR) return 0;
  return WORLD_PARTITION_ID_FLOOR - lowest;
}

/** One partition's stored bytes, with every element id and every reference
 *  moved by `offset`. Returns a new value; the input is not touched. */
export function rekeyPartition(json: unknown, offset: number): unknown {
  if (offset === 0 || !isElementNode(json)) return json;
  return rekeyNode(json, offset);
}

function rekeyNode(node: RekeyableNode, offset: number): RekeyableNode {
  const moved: RekeyableNode = { ...node, id: node.id + offset };
  if (node.attributes !== undefined) {
    moved.attributes = rekeyReferences(node.attributes, offset) as Record<string, unknown>;
  }
  if (node.children !== undefined) {
    moved.children = node.children.map((child) =>
      isElementNode(child) ? rekeyNode(child, offset) : child,
    );
  }
  return moved;
}

/**
 * Every `{ __elementId }` inside a value, moved. Everything else is copied
 * through untouched -- including `{ __playerRef }`, which is a seat.
 *
 * Exported because a QUEUED EVENT's frozen arguments can hold one too: an
 * event scheduled with "finish building THAT" carries the reference, and a
 * shift that moved the elements and not the argument would wake the world up
 * pointing at nothing.
 */
export function rekeyReferences(value: unknown, offset: number): unknown {
  if (offset === 0) return value;
  if (Array.isArray(value)) return value.map((item) => rekeyReferences(item, offset));
  if (typeof value !== "object" || value === null) return value;

  const record = value as Record<string, unknown>;
  if (typeof record.__elementId === "number") {
    return { ...record, __elementId: record.__elementId + offset };
  }
  const moved: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    moved[key] = rekeyReferences(entry, offset);
  }
  return moved;
}
