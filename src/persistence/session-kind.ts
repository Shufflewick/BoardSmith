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
 * that are pure functions of it: what a kind is called, and whether ending a
 * session of that kind means a play happened. Both are read on both sides of
 * the vendored boundary, and a second private spelling of either is how two
 * readers of one column come to disagree.
 * `scripts/persistence-conformance.test.mjs` on the platform side holds this
 * set and the Convex one equal.
 */

/**
 * Every session kind, in the order the platform documents them.
 *
 * - `match` -- a bounded sitting with an outcome. The only kind that counts as
 *   a play. Campaign missions are `match`.
 * - `world` -- a resident persistent world. Hundreds of players attach to one
 *   object over weeks or months; its evidence reaches the quality ladder when
 *   the world declares its own ending, never as a play.
 *
 * ## THE ROUND ERA'S TWO KINDS ARE GONE (ShufflewickPub #47)
 *
 * `orderEntry` (one player's fog-of-war order-submission fragment of a world
 * round) and `resolution` (the seatless per-round resolver) were declared here
 * until ShufflewickPub #47. The platform deleted them in its own #39, when a
 * resident world replaced the round architecture outright: a world applies a
 * player's command inside the object that owns the world and answers with that
 * player's own view, so there is no fragment to seat and no batch to run.
 *
 * They are not coming back, and the deletion took two behaviours with it:
 *
 *   - `seatsHumans`. It existed for exactly one seatless kind. Every kind the
 *     vocabulary still has seats humans, so a predicate that is now constantly
 *     true is a gate that reads like a decision and is not one.
 *   - the resolver's SEAL BYPASS in `store.ts`. See that file: it is deleted
 *     rather than inherited by `world`, and the reasoning is recorded there
 *     because that is where a future reader would go looking for it.
 */
export const SESSION_KINDS = ['match', 'world'] as const;

export type SessionKind = (typeof SESSION_KINDS)[number];

/**
 * Whether `value` is a kind at all.
 *
 * The gate a caller holding an untrusted string uses, so a name outside the
 * vocabulary is refused where it arrives instead of failing later and deeper.
 * The platform's `scripts/persistence-conformance.test.mjs` asks this function
 * and Convex's `sessionKindValidator` the same names and requires the same
 * answers, which is what keeps the two sides of the vendored boundary honest.
 */
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

/** THE single rule for "does ending this session mean a play happened?". An
 *  ALLOWLIST, which is why adding `world` needed no change to it: a kind that
 *  is not `match` is excluded with no code change. */
export function countsAsPlay(kind: SessionKind | undefined): boolean {
  return resolveSessionKind(kind) === 'match';
}
