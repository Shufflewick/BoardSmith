/**
 * The session-kind vocabulary, as a pure closed set.
 *
 * ShufflewickPub's `convex/sessionKind.ts` owns what a kind MEANS to the
 * platform -- which kinds produce a `plays` row, how a row with no kind is
 * read, and the write-side guard that stops a new writer minting a kindless
 * session. None of that can live here: it is expressed in Convex validators
 * and against a Convex schema, and the root ShufflewickPub unit does not
 * depend on this package.
 *
 * What CAN live here, and must, is the vocabulary itself and the two rules
 * that are pure functions of it. `boardsmith dev` has to be able to run a
 * session AS a kind -- that is the whole reason a resolver could not be run
 * once before first publish -- and a dev host with its own private spelling of
 * "resolution" is a second implementation of the discriminator that decides
 * whether a session is seated, whether it may commit orders, and whether it
 * counts as a play. `scripts/persistence-conformance.test.mjs` on the platform
 * side holds this set and the Convex one equal.
 */

/**
 * Every session kind, in the order the platform documents them.
 *
 * - `match` -- a bounded sitting with an outcome. The only kind that counts as
 *   a play. Campaign missions are `match`.
 * - `orderEntry` -- one player's fog-of-war order-submission fragment of a
 *   world round. A fragment of a logical play, not a play. SEATED, by exactly
 *   one player, and its commits are routed to that round's orders rather than
 *   to the store.
 * - `resolution` -- the seatless per-round resolver. Platform machinery with
 *   no human sitting at all; its single seat is host-held.
 */
export const SESSION_KINDS = ['match', 'orderEntry', 'resolution'] as const;

export type SessionKind = (typeof SESSION_KINDS)[number];

/** Whether `value` is a kind at all. Used by the dev CLI to refuse `--kind`
 *  garbage by naming the whole vocabulary instead of failing later and deeper. */
export function isSessionKind(value: unknown): value is SessionKind {
  return typeof value === 'string' && (SESSION_KINDS as readonly string[]).includes(value);
}

/**
 * The "absence means `match`" default, written once.
 *
 * Every session row written before the platform had a `kind` column was a
 * bounded sitting, so `undefined` must behave exactly as it did before the
 * field existed. A second `?? 'match'` spelled out at a call site is how two
 * readers of one column come to disagree.
 */
export function resolveSessionKind(kind: SessionKind | undefined): SessionKind {
  return kind ?? 'match';
}

/** THE single rule for "does ending this session mean a play happened?". */
export function countsAsPlay(kind: SessionKind | undefined): boolean {
  return resolveSessionKind(kind) === 'match';
}

/**
 * Whether a session of this kind seats humans.
 *
 * A `resolution` session is SEATLESS: its one seat is held by the platform, no
 * client may claim it, and the round runs to completion with nobody watching.
 * The dev host needs this as a value rather than as an `if` at each of its own
 * seat sites -- an emulator that let a developer sit down in a resolution is
 * an emulator that proves nothing about the thing it is emulating.
 */
export function seatsHumans(kind: SessionKind): boolean {
  return kind !== 'resolution';
}
