/**
 * The PRIVATE channel's strip, as a pure function.
 *
 * `persistPrivate` is a reserved game-root attribute a bundle sets to commit
 * something the spectator view must never carry. Somebody has to LIFT it off
 * every outgoing view before that view is broadcast, and re-emit it as a
 * top-level field for the host to stage at game over.
 *
 * ## There are deliberately TWO callers of this rule, and only one of them is
 * ## this function
 *
 * In PRODUCTION the strip lives in ShufflewickPub's executor runner
 * (`executor/src/persist-private.ts`) and MUST STAY THERE. That is not a
 * preference: `executor/scripts/bundle-runner.ts` bundles one runner source
 * against EVERY archived engine revision, so a strip in the runner covers
 * every revision the next time the runner is built -- while a strip that
 * existed only in the engine would exist only from the revision that added it
 * onwards, and engine pinning routes an already-published game to the revision
 * it was published against for the life of that version. Every game pinned to
 * an older engine would set the reserved attribute and have it broadcast
 * verbatim, with no error and no warning. A leak that only affects games
 * published before some date is worse than no channel at all.
 *
 * `boardsmith dev` has no such problem: it always runs the working-copy
 * engine, there is no archive and nothing is pinned. So the dev host strips
 * HERE, and the two implementations are held to identical outcomes by
 * ShufflewickPub's `scripts/persistence-conformance.test.mjs`, which runs the
 * same cases through both. That conformance run is the anti-drift mechanism
 * for this one rule; everything else in this directory has a single
 * implementation and needs none.
 *
 * ## Opacity is untouched
 *
 * Nothing here parses inside a SNAPSHOT. The navigation is the exact one
 * `persistence.ts:readPersistAttribute` performs, on a VIEW:
 * `view.state.view.attributes`. The snapshot keeps the attribute -- that is
 * how the game's own state survives the round trip, and it is why the value is
 * re-emitted on every subsequent op.
 */

import { PERSIST_PRIVATE_KEY } from './persistence.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One view with the reserved attribute removed, plus whatever was removed.
 *  `view` is the ORIGINAL object when there was nothing to remove -- no copy is
 *  made for the overwhelmingly common case of a game that never sets it. */
interface StripResult {
  view: unknown;
  value: unknown;
}

/**
 * Remove the reserved attribute from one view, non-destructively.
 *
 * Every level is shallow-copied rather than mutated. The views the engine
 * hands back are freshly built per op, but they are not this module's to own:
 * a `delete` here would be a mutation of the engine's return value, and the
 * one thing worse than a leaked secret is a secret deleted out of the game's
 * live state because two objects turned out to share a sub-tree.
 */
function stripReserved(view: unknown): StripResult {
  if (!isPlainObject(view)) return { view, value: undefined };
  const state = view.state;
  if (!isPlainObject(state)) return { view, value: undefined };
  const node = state.view;
  if (!isPlainObject(node)) return { view, value: undefined };
  const attributes = node.attributes;
  if (!isPlainObject(attributes)) return { view, value: undefined };
  if (!(PERSIST_PRIVATE_KEY in attributes)) return { view, value: undefined };

  const { [PERSIST_PRIVATE_KEY]: value, ...rest } = attributes;
  return {
    view: { ...view, state: { ...state, view: { ...node, attributes: rest } } },
    value,
  };
}

/** The subset of a successful op result this module reads and rewrites. */
export interface PrivateChannelCarrier {
  spectatorView?: unknown;
  playerViews?: unknown[];
  persistPrivate?: unknown;
}

/**
 * Structural equality over the JSON-serializable values `toJSONForPlayer`
 * emits. Written out rather than `JSON.stringify` comparison because two views
 * built by different code paths may order one object's keys differently while
 * carrying the same value -- and a false "divergent" here refuses an op that
 * lost nothing.
 */
function jsonValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => jsonValueEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => key in b && jsonValueEqual(a[key], b[key]))
    );
  }
  return false;
}

/**
 * Lift the private commit off every outgoing view and re-emit it as a
 * top-level field.
 *
 * Called on EVERY successful op, unconditionally -- not only at game over and
 * not only for games that opted into persistence. The attribute name is
 * reserved platform-wide, and a strip that depended on a manifest flag would
 * leak for exactly the game that got the flag wrong.
 *
 * ## ONE value per op, refused loudly when the views disagree
 *
 * The channel is single-valued: whatever is lifted here becomes the whole of
 * this op's private commit. A game whose `playerView` filtering projects the
 * attribute DIFFERENTLY per seat has therefore written something no single
 * commit can carry -- committing any one projection silently discards every
 * other seat's, and the loss is undetectable until those players wake to
 * nothing next session. So every view that carries the attribute must carry
 * the SAME value; a defined-but-different pair is refused with the message
 * below. The production host refuses this identically (ShufflewickPub's
 * `executor/src/persist-private.ts`); a dev host that picked one value would
 * hide in development exactly the bug production surfaces. A view the game
 * HID the attribute from entirely is fine: committing the value the remaining
 * views agree on discards nothing.
 *
 * Returns the result UNCHANGED when the attribute is absent everywhere.
 */
export function takePrivateCommit<T extends PrivateChannelCarrier>(result: T): T {
  const spectator = stripReserved(result.spectatorView);
  const players = result.playerViews?.map(stripReserved) ?? [];

  const carried = [
    { label: 'the spectator view', value: spectator.value },
    ...players.map((p, i) => ({ label: `player ${i + 1}'s view`, value: p.value })),
  ].filter((source) => source.value !== undefined);
  if (carried.length === 0) return result;

  const first = carried[0]!;
  const divergent = carried.find((source) => !jsonValueEqual(source.value, first.value));
  if (divergent) {
    throw new Error(
      `The reserved '${PERSIST_PRIVATE_KEY}' attribute is not identical across this op's ` +
        `outgoing views: ${first.label} and ${divergent.label} carry different values. The ` +
        `private channel commits ONE value per op, so committing either would silently ` +
        `discard the other seat's data. Emit the same '${PERSIST_PRIVATE_KEY}' value in ` +
        `every view (exempt it from your playerView filtering — the platform strips it ` +
        `off every view before anything is broadcast, so per-view differences protect ` +
        `nothing); per-player secrecy belongs in the commit's own entries, sealed with a ` +
        `'player:<userId>/' key.`,
    );
  }

  return {
    ...result,
    ...(result.spectatorView !== undefined ? { spectatorView: spectator.view } : {}),
    ...(result.playerViews ? { playerViews: players.map((p) => p.view) } : {}),
    persistPrivate: first.value,
  };
}
