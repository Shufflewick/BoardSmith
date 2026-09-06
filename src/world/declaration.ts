/**
 * Issue #122: A DECLARATION THAT CAN READ WHAT IT ALREADY ASKED FOR.
 *
 * ## The hole this closes
 *
 * Two declarations decide what a resident world hydrates, and both were
 * answered before anything was loaded: a command's `partitions(args, seat)` and
 * the bundle's `world.view(seat)`. Neither could read world state, which is
 * correct for lazy hydration and stated at length in `world-runner.ts`.
 *
 * It has one consequence, and it only shows up in a world whose PLAYER
 * LOCATION IS ITSELF STATE -- every MUD, every overworld map, every game with a
 * party that walks around:
 *
 *   A player's room is stored IN the world. To know which partition a player's
 *   look is about, you must first read a partition. There was nowhere to do
 *   that.
 *
 * The only way to write such a game was to name EVERY room in `view` and in
 * every command's `partitions`, and let the handler search them for the player.
 * At three rooms that is tolerable; at three hundred it is exactly the O(world)
 * read the whole resident mode exists to delete, and no arrangement of
 * arguments fixes it -- #121's acting seat lets a declaration name a partition
 * that is a FUNCTION of the seat, and a wanderer's room is not.
 *
 * ## Two shapes were possible. This is the one that was chosen, and why.
 *
 * THE ONE NOT TAKEN was a PER-SEAT INDEX the platform reads: a small
 * always-resident partition mapping seat to partition name, against which
 * `partitions` and `view` would be answered. Three things are wrong with it,
 * and the third is fatal:
 *
 *   IT IS A SCHEMA THE PLATFORM IMPOSES. "One seat, one partition name" is a
 *     data model, and it is the wrong one for a party that occupies a region, a
 *     player who is in a room AND a guild hall, or a game whose declaration
 *     depends on anything but location. The platform would grow the schema
 *     every time a game did not fit it.
 *   IT IS ITSELF O(PLAYERS). An always-resident seat index for a 500-player
 *     world is a 500-entry structure adopted on every wake and rewritten on
 *     every move -- the exact per-player cost this mode deletes, reintroduced
 *     as the mechanism for deleting a different one.
 *   IT PUTS THE PLATFORM INSIDE THE GAME'S DATA. Something would have to READ
 *     game-authored element JSON to answer a declaration. The parent has no
 *     engine, so either it parses a game's bytes or the child does it against a
 *     platform-defined convention. Both are the trust boundary `world-runner.ts`
 *     drew, crossed for a convenience.
 *
 * TWO-PHASE DECLARATION -- this file -- asks the declaration AGAIN with the
 * first round resident, so a game says "load `wanderers`" and then, reading it,
 * "and now load `room:cellar`". It imposes no schema: the game reads its own
 * state with its own engine, through the same `GameElement` API its handlers
 * use. It loads only what the game names. And it SUBSUMES the index shape --
 * a game that wants a seat index writes one as an ordinary partition and names
 * it in round one, which is precisely the fixture this file's tests use.
 *
 * ## What it costs, honestly
 *
 * ONE EXTRA CHILD ROUND TRIP PER LEVEL OF THE CHAIN, AND ONLY WHILE HYDRATING.
 * A declaration whose first round asks for nothing is NOT asked again: nothing
 * became resident, so nothing could have changed its answer. That is the steady
 * state -- every partition already loaded -- and it costs exactly what it cost
 * before. A cold world pays one additional round trip per level, once per
 * partition per Durable Object lifetime, which is the same shape as the read it
 * is paying for.
 *
 * No new concurrency: the world lock is already held across the whole command,
 * and both loops below run inside it.
 */
import type { StoredPartition } from "./contract.js";
import { worldRefusal } from "./refusals.js";

/**
 * HOW MANY TIMES A DECLARATION MAY BE ASKED BEFORE IT HAS TO HAVE SETTLED.
 *
 * Every round makes at least one partition resident -- the child subtracts what
 * it already holds, so a round that named only resident partitions asks for
 * nothing and the loop ends. A declaration that names a NEW partition every
 * round would therefore walk the world one partition at a time, which is the
 * O(world) read this whole mechanism exists to prevent, arrived at by a
 * different road.
 *
 * Four, because three is the deepest chain a declaration has a reason to have
 * -- an index, the partition it names, and one thing that partition names in
 * turn -- and the fourth round is the one that comes back empty and proves it.
 * A game that needs more is describing a traversal rather than a declaration,
 * and the refusal says so.
 */
const WORLD_DECLARATION_ROUNDS = 4;

/**
 * THE FIXPOINT IS A VIEW'S, AND ONLY A VIEW'S, SINCE #169.
 *
 * A VIEW has no other shape. "What is this seat looking at?" is answered by the
 * world's own state -- the room the player is standing in -- so it genuinely
 * has to be asked, loaded, and asked again until it stops changing its mind.
 * The ceiling above and the `declaration-unsettled` refusal are the safety on a
 * loop that cannot be bounded any other way, and they stay. Neither is exported
 * any more: the number is this loop's own business, and nothing outside decides
 * when a view has settled.
 *
 * A WRITE was a different question wearing the same clothes, and #169 undressed
 * it. A world's verbs are Actions, and an action is a SEQUENCE, so its
 * declaration is an ORDERED WALK -- round one, then each selection's own round,
 * then the execute round -- whose length is the action's own selection count.
 * `walkDeclaration` below drives it, and it needs no ceiling: what bounds it is
 * the action's source rather than a number somebody chose.
 */

/**
 * Ask a declaration until it settles, loading what each round names.
 *
 * Written once and driven for both halves of the protocol: `world-session.ts`
 * runs it over the child's `declare` operation for a command and over
 * `view-declare` for a view. Two copies of a loop whose termination rule is
 * the whole safety argument is how the two would come to disagree about when a
 * world stops loading.
 *
 * `declare` is handed the previous round's partitions and answers what is STILL
 * missing; `read` must either produce a partition or throw its own refusal
 * naming it, because the two callers word that refusal differently -- a command
 * names the command, a view names the bundle's `world.view`.
 */
export async function settleDeclaration(
  declare: (supplied: Record<string, StoredPartition>) => Promise<readonly string[]>,
  read: (name: string) => Promise<StoredPartition>,
  subject: string,
): Promise<void> {
  // NULL PROTOTYPE, at both assignments below: a partition name is the
  // bundle's, and `supplied["__proto__"] = partition` on a plain object swaps
  // this record's prototype rather than storing an entry (#190). The child
  // would then never receive the partition, keep asking for it, and the player
  // would be told after four rounds that the declaration named something new
  // every round -- which is false, and nothing an author can act on.
  let supplied: Record<string, StoredPartition> = Object.create(null) as Record<
    string,
    StoredPartition
  >;
  for (let round = 1; ; round++) {
    const needs = await declare(supplied);
    if (needs.length === 0) return;
    if (round === WORLD_DECLARATION_ROUNDS) {
      throw worldRefusal(
        "declaration-unsettled",
        `${subject} did not settle: after ${WORLD_DECLARATION_ROUNDS} rounds of declaring it was ` +
          `still asking for partitions it had not seen (${needs.join(", ")}). A declaration is ` +
          `asked again once what it named is resident, so it can say "load the index" and then ` +
          `"load the room the index names" -- but each round must bring it closer to an answer. ` +
          `One that names something new every round is walking the world rather than declaring ` +
          `what it needs.`,
      );
    }
    supplied = Object.create(null) as Record<string, StoredPartition>;
    for (const name of needs) supplied[name] = await read(name);
  }
}

/**
 * Drive a WRITE's declaration to the end of its walk, loading what each round
 * names (#169).
 *
 * The counterpart to `settleDeclaration`, and the difference between them is
 * the whole of what Actions changed. This one has NO CEILING and no
 * `declaration-unsettled` refusal, and that is not an omission: a world action
 * answers the NEXT UNMET ROUND of a walk with one round per selection step, so
 * every round this loop is given names a partition that was not resident, and
 * every round it supplies makes those resident. The loop can therefore run at
 * most as many times as the action has steps, which is a number in the game's
 * own source rather than a budget a host has to pick.
 *
 * Two of them and not one, deliberately. A single loop covering both would have
 * to carry the view's ceiling, which for an action would refuse a perfectly
 * ordinary five-selection verb on its fifth honest round -- a limit read off
 * the wrong question.
 */
export async function walkDeclaration(
  declare: (supplied: Record<string, StoredPartition>) => Promise<readonly string[]>,
  read: (name: string) => Promise<StoredPartition>,
): Promise<void> {
  // NULL PROTOTYPE, for the reason `settleDeclaration` gives: a partition name
  // is the bundle's, and `supplied["__proto__"] = partition` on a plain object
  // swaps this record's prototype rather than storing an entry (#190).
  let supplied: Record<string, StoredPartition> = Object.create(null) as Record<
    string,
    StoredPartition
  >;
  for (;;) {
    const needs = await declare(supplied);
    if (needs.length === 0) return;
    supplied = Object.create(null) as Record<string, StoredPartition>;
    for (const name of needs) supplied[name] = await read(name);
  }
}
