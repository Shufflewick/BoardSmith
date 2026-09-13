/**
 * Issue #37 item 1: THE SEAM BETWEEN THE PARENT AND THE ENGINE.
 *
 * "`BoardSmithWorldEngine` is implemented and tested but never instantiated by
 * the DO" reads like a missing `new`. It is not, and this file is why.
 *
 * ## The problem, stated once
 *
 * The engine holds a live `Game` -- untrusted game code -- so it must run in
 * the CHILD ISOLATE. Section 3 and `world-session.ts:childIsolate()` both state
 * that boundary as `env: {}`: no network, no bindings, the child is handed
 * nothing. But the engine reads partitions through `WorldPartitionStore.read`,
 * which is asynchronous because the only place partitions exist is the
 * PARENT's `ctx.storage`. A child with no bindings cannot reach it.
 *
 * So the engine can be constructed on neither side as things stood. In the
 * parent, the trust boundary is gone. In the child, `ensureResident` has
 * nothing to ask.
 *
 * ## The answer: DECLARE, then APPLY
 *
 * Two calls, and the child never reaches out:
 *
 *   1. `declare(command, player, supplied, now)` -- the parent hands over whatever
 *      the LAST round asked for, the child adopts it, and the child's engine
 *      then answers which partitions this command still needs. It runs NO GAME
 *      CODE beyond the bundle's own declaration, so a command refused later has
 *      still not touched the world; what it changes is what is LOADED, which is
 *      residency and not state. The acting player is named because the
 *      declaration may name that seat's own partition (#121), and only the
 *      engine's roster can turn one into the other.
 *   2. Repeat 1 until it asks for nothing (#122). A declaration is answered
 *      against what is resident, so a world whose player LOCATION is state can
 *      name its index, read it, and then name the room -- the one thing no
 *      arrangement of arguments could express. `world-declaration.ts` carries
 *      the reasoning and the ceiling; a first round that asks for nothing is
 *      not asked again, so the steady state costs exactly what it did before.
 *   3. `apply(...)` -- everything the command declared is already resident, so
 *      the command runs against a world the parent finished assembling.
 *
 * `env: {}` is untouched. The child is still handed nothing; it is TOLD things,
 * which is a different relationship and the one the boundary was drawn for.
 *
 * ## Why not the two alternatives
 *
 * PUSH-ON-MISS -- one call, and a miss comes back as a refusal naming what was
 * missing. It discovers the miss part-way through the command rather than
 * before it, so the command re-runs from the start; that is only safe because
 * a faulted command has committed nothing, which is a property no type
 * enforces. Exception-driven control flow for a case that is not exceptional.
 *
 * AN RPC STUB IN THE CHILD'S `env` -- one call, no round trips, and `env` stops
 * being `{}`. Narrowing it to one read-only capability is arguable, but it is a
 * change to a stated trust boundary and would make `childIsolate()`'s "the
 * child is handed nothing" false.
 *
 * ## What the extra round trips actually cost
 *
 * Once per partition per Durable Object lifetime, not once per command: the
 * engine keeps a partition resident after adopting it, so `declare` answers an
 * empty list for every later command that names it, and the parent reads
 * nothing. #122's SECOND round is bounded the same way and by the same fact --
 * a declaration whose first round asks for nothing is not asked again, because
 * nothing became resident and nothing could have changed its answer -- so a
 * warm world pays one `declare` and one `apply`, exactly as it did before, and
 * a cold one pays one more round trip per level of the chain it declares.
 * The Stage 0 measurement (#36) says the parent has the headroom -- the object
 * billed 12-18% of wall clock while holding 551 sockets, and a loaded child
 * isolate did not raise it.
 */
import type {
  DeclaredSeatActivityStamp,
  SeatActivityStamp,
  StoredPartition,
  WorldPartitionSource,
  WorldActionOffer,
  WorldCommand,
  WorldCommandResult,
  WorldEngine,
  WorldOfferStamp,
} from "./contract.js";
import type { Game, GameElement } from "../engine/index.js";
import type {
  WorldMigrationContext,
  WorldMigrationCreateContext,
  WorldMigrationFinalizeContext,
  WorldMigrationSurvey,
} from "./migration.js";
import type { ScheduleAllowance } from "./schedule-api.js";
import { WorldRefusal, worldRefusal } from "./refusals.js";

/** A scheduled event's timing, or `null` for a player's command. */
export type WorldTiming = { readonly due: number; readonly missedCount: number } | null;

/**
 * A WORLD'S DURABLE ID ALLOCATION, reported with the bytes it was minted for
 * (ShufflewickPub #377).
 *
 * Element ids outlive the process that minted them and only a fraction of the
 * partitions holding them is ever resident, so the counter cannot be rebuilt
 * from residency: a host that hydrated one room out of five would restart the
 * counter beneath the other four. Every operation that MINTS therefore reports
 * the next id the world may use, and a host writes that number in the same
 * transaction as the partitions -- so "stored a new root, lost the stamp" is
 * not a state that can exist.
 *
 * It comes back in as `WorldRunnerOptions.nextElementId` on the next wake.
 */
export interface WorldAllocation {
  /** The next element id this world may mint. Only ever goes up. */
  readonly nextElementId: number;
}

/** What genesis produces: the world's first partitions, and its first stamp. */
export interface WorldGenesis extends WorldAllocation {
  readonly partitions: Record<string, StoredPartition>;
}

/** One on-demand root, and the stamp that must be written beside it (#377). */
export interface WorldCreatedPartition extends WorldAllocation {
  readonly partition: StoredPartition;
}

/**
 * ONE CHECKPOINT'S BYTES, AND THE STAMP THAT PRODUCED THEM (#224).
 *
 * #377 named three roads that mint -- genesis, on-demand creation, migration --
 * and left out the one every game takes: `room.create(...)` inside an action
 * advances the same counter. A host that wrote a grown partition and kept its
 * older stamp handed the next fresh runner a number below ids the store already
 * held, and `adoptSubtree` refused the bytes that host had itself just written.
 *
 * So a checkpoint cannot answer bytes without its stamp. The two land in the
 * same transaction for the same reason genesis's do.
 */
/** The serialized bytes for exactly these names, as a null-prototype record. */
function bytesFor(names: readonly string[], written: Record<string, string>): Record<string, string> {
  const partitions: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const name of names) partitions[name] = written[name] as string;
  return partitions;
}

/** The roots a migration ADDED, as the host stores them: a parent and a parsed
 *  subtree, taken from the same serialization pass as everything else. */
function createdFrom(
  created: Record<string, { parentId: number }>,
  written: Record<string, string>,
): Record<string, StoredPartition> {
  const records: Record<string, StoredPartition> = Object.create(null) as Record<
    string,
    StoredPartition
  >;
  for (const [name, record] of Object.entries(created)) {
    records[name] = {
      parentId: record.parentId,
      json: JSON.parse(written[name] as string) as StoredPartition["json"],
    };
  }
  return records;
}

/** Paging a migration whose `finalize` needs the whole world, refused by name
 *  rather than run against a world that is half migrated (#402, #379). */
function pagingRefused(): WorldRefusal {
  return worldRefusal(
    "world-migration-unavailable",
    "This migration declares `finalize`, which is handed the WHOLE world once every root is " +
      "resident, so it cannot be run a page at a time. A host that must page has to send every " +
      "root in one call, or the migration has to stop deriving one root's value from another.",
  );
}

/**
 * THE DIGEST, MEASURED AND HELD TO A CEILING (ShufflewickPub #449).
 *
 * Measured AFTER the pass rather than estimated before it, because the only
 * honest size of a digest is the bytes the host is about to persist. Refused
 * past whichever ceiling is lower -- the author's `survey.maxBytes` or the
 * host's own -- and the refusal names the size, the bound and whose it was, so
 * nobody tunes the number that was not the one hit.
 */
function serializedDigest(
  digest: unknown,
  authorBound: number,
  hostBound: number | undefined,
): string {
  const json = JSON.stringify(digest);
  if (json === undefined) {
    throw worldRefusal(
      "world-migration-unavailable",
      "This world's migration answered a digest that does not survive JSON. A host persists the " +
        "digest between wakes and hands it back to the next call, so it has to be made of plain " +
        "values -- objects, arrays, numbers, strings, booleans and null. `undefined`, a " +
        "function, a Map, a Set and a class instance are not among them. The world was not " +
        "changed.",
    );
  }
  const size = new TextEncoder().encode(json).length;
  const hostIsLower = hostBound !== undefined && hostBound < authorBound;
  const bound = hostIsLower ? (hostBound as number) : authorBound;
  if (size > bound) {
    throw worldRefusal(
      "world-migration-unavailable",
      `This world's migration accumulated a digest of ${size} bytes, past the ${bound}-byte ` +
        `ceiling ${
          hostIsLower
            ? "THIS HOST puts on a migration digest. It is lower than this migration's own " +
              `\`survey.maxBytes\` of ${authorBound}, so raising that would change nothing`
            : "this migration declares in `survey.maxBytes`"
        }. A survey is a FOLD, not a collection: it exists so a world of any size can be ` +
        "migrated in bounded memory, and a digest that grows with the world is the unbounded " +
        "accumulator this design refuses to allow. Fold the roots into the fact you actually " +
        "need -- a total, a maximum, a count per kind -- rather than a record per root. Running " +
        "the migration again will not help: the same world folds to the same size. The world " +
        "was not changed.",
    );
  }
  return json;
}

/** A paged survey migration whose host did not say which pass this is (#449). */
function passMissing(): WorldRefusal {
  return worldRefusal(
    "world-migration-unavailable",
    "This migration declares `survey`, so a paged run of it is TWO PASSES and this call named " +
      "neither. Send every page with `pass: \"survey\"` first, carrying the digest forward, and " +
      "only once every root has been folded in send the pages again with `pass: \"transform\"` " +
      "and that digest. Transforming against a half-folded world is the ordering this design " +
      "exists to remove. The world was not changed.",
  );
}

/** A transform pass with no digest behind it (#449). */
function digestMissing(): WorldRefusal {
  return worldRefusal(
    "world-migration-unavailable",
    "This migration declares `survey`, and this `transform` pass was handed no digest. Every " +
      "root's new value is a function of the COMPLETED fold, so there is nothing to transform " +
      "against until the survey pass has seen every root. Run the survey pass over every page " +
      "and hand its answer back as `digest`. The world was not changed.",
  );
}

/** A `pass` named for a migration that has no two passes (#449). */
function passUnexpected(): WorldRefusal {
  return worldRefusal(
    "world-migration-unavailable",
    "This call names a migration `pass`, and this migration declares no `survey` -- so it has " +
      "only one pass and there is nothing for the name to select. Ask `migrationShape()` before " +
      "running a migration: only a `\"survey\"` shape is run in two passes. The world was not " +
      "changed.",
  );
}

/**
 * A SURVEY PASS THAT WROTE, CAUGHT BEFORE IT LEAVES (ShufflewickPub #449).
 *
 * The pass is built to write nothing, so this can only fail if THIS FILE stops
 * being true -- which is exactly why it is an assertion and not a filter.
 * Dropping the bytes silently would hand the host a correct-looking answer for
 * a world that had already been half migrated by a pass the host was told does
 * not write.
 */
function assertSurveyWroteNothing(answer: WorldMigrated): void {
  const wrote = [...Object.keys(answer.partitions), ...Object.keys(answer.created)];
  if (wrote.length === 0) return;
  throw worldRefusal(
    "world-migration-unavailable",
    `A survey pass produced bytes for ${wrote.sort().join(", ")}, and a survey pass writes ` +
      "nothing. This is a fault in the engine rather than in this world's migration: the pass " +
      "that folds the world into a digest is the one a host runs a page at a time, and it is " +
      "only safe to re-run because it cannot write. Report it with this world's bundle. The " +
      "world was not changed.",
  );
}

/**
 * THE ROOTS THIS VERSION ADDS, on the one call that adds them (#218, #402).
 *
 * A paged host says which call creates; a whole-world migration is always that
 * call. Their bytes are taken with everything else afterwards -- what this
 * establishes is the NAMES, their parents, and that none collides with a root
 * the world already holds.
 */
function createdRoots(
  engine: WorldEngine,
  hooks: WorldMigrationHooks,
  paged: boolean,
  ctx: WorldMigrateContext,
  hookCtx: WorldMigrationCreateContext,
): Record<string, StoredPartition> {
  if (paged && ctx.runCreate !== true) return {};
  return engine.createMigratedPartitions(
    (game) => hooks.create?.(game, hookCtx) ?? {},
    hookCtx.existing,
  );
}

/**
 * THE WHOLE WORLD, ONCE (ShufflewickPub #379), with nothing serialized yet.
 *
 * The unbounded road, untouched by #449: it needs every root resident, which is
 * why a host that must page is refused before it reaches here.
 */
function finalizeAcross(
  engine: WorldEngine,
  hooks: WorldMigrationHooks,
  names: readonly string[],
  ctx: WorldMigrateContext,
): void {
  const finalize = hooks.finalize;
  if (finalize === undefined) return;
  engine.migrateFinalize((game, partition) => {
    finalize(game, { partition, names, from: ctx.from, to: ctx.to });
  });
}

/**
 * FOLD THIS PAGE INTO THE DIGEST (ShufflewickPub #449).
 *
 * Read-only, one root at a time, continuing from whatever the host carried
 * back in -- so however many calls a world takes, the fold is the same fold.
 */
function foldPage(
  engine: WorldEngine,
  survey: WorldMigrationSurvey<unknown>,
  page: readonly string[],
  carried: string | undefined,
): unknown {
  let digest = carried === undefined ? survey.initial() : (JSON.parse(carried) as unknown);
  for (const name of page) {
    digest = engine.surveyPartition(name, (element) => survey.root(digest, element, name));
  }
  return digest;
}

/**
 * A SURVEY PASS, WHOLE: fold, measure, answer, write nothing (#449).
 *
 * The measurement is here rather than at the ceiling's own declaration because
 * these are the bytes the HOST is about to persist, and an estimate taken
 * anywhere else would be a different number.
 */
function surveyPass(
  engine: WorldEngine,
  survey: WorldMigrationSurvey<unknown>,
  page: readonly string[],
  ctx: WorldMigrateContext,
): WorldMigrated {
  const answer: WorldMigrated = {
    partitions: {},
    created: {},
    digest: serializedDigest(
      foldPage(engine, survey, page, ctx.digest),
      survey.maxBytes,
      ctx.maxDigestBytes,
    ),
    nextElementId: engine.nextElementId(),
  };
  assertSurveyWroteNothing(answer);
  return answer;
}

/**
 * THE COMPLETED DIGEST A TRANSFORM WRITES AGAINST (#449).
 *
 * A PAGED migration carries it in, because its fold finished on an earlier
 * call; an UNPAGED one was handed the whole world, so its fold is this call and
 * it meets the same ceiling before a single root is transformed.
 */
function completedDigest(
  engine: WorldEngine,
  survey: WorldMigrationSurvey<unknown>,
  page: readonly string[],
  ctx: WorldMigrateContext,
  paged: boolean,
): unknown {
  if (!paged) {
    const digest = foldPage(engine, survey, page, ctx.digest);
    serializedDigest(digest, survey.maxBytes, ctx.maxDigestBytes);
    return digest;
  }
  if (ctx.digest === undefined) throw digestMissing();
  return JSON.parse(ctx.digest) as unknown;
}

/**
 * WHETHER THIS CALL NAMED THE PASS IT IS (#449), decided before anything runs.
 *
 * Every one of these is a host driving a migration the wrong way, and each is
 * refused rather than guessed at: guessing means transforming against a world
 * the fold has not finished reading, which is the ordering this whole design
 * exists to remove.
 */
function assertPassNaming(
  hooks: WorldMigrationHooks,
  paged: boolean,
  ctx: WorldMigrateContext,
): void {
  if (paged && hooks.finalize !== undefined) throw pagingRefused();
  if (hooks.survey === undefined) {
    if (ctx.pass !== undefined) throw passUnexpected();
    return;
  }
  if (paged && ctx.pass === undefined) throw passMissing();
  if (ctx.pass === "survey" && ctx.runCreate === true) throw createOnSurvey();
}

/** A survey pass told to create this version's roots (#449). */
function createOnSurvey(): WorldRefusal {
  return worldRefusal(
    "world-migration-unavailable",
    "This call is a `survey` pass and also asked to create this version's new roots. A survey " +
      "pass writes nothing at all -- that is what makes it safe to run over a world a page at a " +
      "time -- and a root created before the fold finished would be built from a partial world. " +
      "Pass `runCreate: true` on exactly one `transform` page instead. The world was not changed.",
  );
}

/**
 * WHAT ONE `migrateAll` CALL IS (ShufflewickPub #402).
 *
 * `from`/`to` are the version gap, and are all a whole-world migration needs.
 *
 * A PAGE adds the other two. `allNames` is every root the WORLD holds, not the
 * page: `create` must know which names are taken, and a refusal has to be about
 * the world. `runCreate` says whether this is the call that adds the version's
 * new roots -- exactly one page may, or a migration that adds a root would add
 * it once per page.
 *
 * Paging is refused outright when the migration declares `finalize`, which is
 * handed the whole world once every root is resident (#379). That hook is the
 * reason a migration cannot always page, and the presence of it is the whole
 * declaration -- an author who does not derive one root's value from another
 * writes no `finalize`, and their migration pages without saying anything.
 */
export interface WorldMigrateContext {
  readonly from: number;
  readonly to: number;
  readonly allNames?: readonly string[];
  readonly runCreate?: boolean;
  /**
   * WHICH OF A BOUNDED MIGRATION'S TWO PASSES THIS CALL IS (#449).
   *
   * Required on every PAGED call of a migration that declares `survey`, and
   * meaningless on any other: `"survey"` folds the roots in this page into the
   * digest and writes nothing, `"transform"` transforms them against the
   * COMPLETED digest. A paged survey migration with no pass named is refused
   * rather than run, because transforming against a half-folded world is the
   * exact bug the fold exists to remove.
   *
   * An UNPAGED call needs none: the whole world is in front of it, so the fold
   * and the transform are one call.
   */
  readonly pass?: WorldMigratePass;
  /**
   * THE DIGEST SO FAR, AS THE HOST PERSISTED IT (#449).
   *
   * JSON, because it crosses a host's wakes and an isolate boundary and a
   * ceiling is stated in bytes. Absent on the FIRST survey page, where the
   * migration's own `survey.initial()` is the starting value; required on
   * every `"transform"` call, where it is the finished fold.
   */
  readonly digest?: string;
  /**
   * THE HOST'S OWN CEILING ON THE SERIALIZED DIGEST, IN BYTES (#449).
   *
   * The author states one in `survey.maxBytes` and the host may state a lower
   * one here; whichever is smaller is enforced, and the refusal says which of
   * the two it was so nobody tunes the wrong number.
   */
  readonly maxDigestBytes?: number;
}

/** Which pass of a bounded cross-root migration a call is (#449). */
export type WorldMigratePass = "survey" | "transform";

/**
 * WHAT SHAPE A MIGRATION IS, so a host knows how to run it (#449).
 *
 * This used to be `migrationNeedsEveryRoot(): boolean`, which could only tell
 * two of the three apart -- and the third is the one a large world needs:
 *
 *   "independent"  -- every root transforms from itself alone. Page it in any
 *                     order, one pass, nothing carried between calls.
 *   "survey"       -- pageable in TWO passes: fold every root into the digest,
 *                     then transform every root against the completed digest.
 *                     `maxDigestBytes` is the author's own stated ceiling, so a
 *                     host can pick the lower of it and its own up front.
 *   "whole-world"  -- `finalize`, which needs every root resident in ONE call.
 *                     A world bigger than the host's ceiling cannot run it, and
 *                     the host has to say so rather than discover it.
 */
export type WorldMigrationShape =
  | { readonly kind: "independent" }
  | { readonly kind: "survey"; readonly maxDigestBytes: number }
  | { readonly kind: "whole-world" };

export interface WorldSerialized extends WorldAllocation {
  readonly partitions: Record<string, string>;
}

/**
 * EVERYTHING ONE MIGRATION PRODUCED, for the host's single transaction (#379).
 *
 * `partitions` is every root the world already held, serialized after every
 * hook has run; `created` is the roots this version adds, with the parent each
 * hangs from; `nextElementId` is the allocation stamp those new roots were
 * minted from (#377). All three land together or none of them does.
 */
export interface WorldMigrated extends WorldAllocation {
  readonly partitions: Record<string, string>;
  readonly created: Record<string, StoredPartition>;
  /**
   * THE DIGEST THIS SURVEY PASS ACCUMULATED, as JSON (#449).
   *
   * Present only on a `"survey"` pass, which writes nothing: `partitions` and
   * `created` are both empty there, and this is the whole of its answer. The
   * host persists it and hands it back as `WorldMigrateContext.digest` on the
   * next page, and on every transform call.
   */
  readonly digest?: string;
}

/**
 * The bundle's own migration hooks, handed to the runner (#379).
 *
 * Supplied the way `buildGenesis` is, and for the same reason: the runner is
 * handed the ENGINE rather than the game, and only `createWorld` holds both the
 * game and the bundle's declaration.
 */
export interface WorldMigrationHooks {
  readonly partition?: (element: GameElement, ctx: WorldMigrationContext) => void;
  readonly create?: (game: Game, ctx: WorldMigrationCreateContext) => Record<string, GameElement>;
  readonly finalize?: (game: Game, ctx: WorldMigrationFinalizeContext) => void;
  readonly survey?: WorldMigrationSurvey<unknown>;
}

/**
 * ONE COMMAND, AS THE PARENT HANDS IT ACROSS THE BOUNDARY.
 *
 * An object rather than five positional arguments, because everything on it is
 * a fact the child cannot derive and the list grows with each one the platform
 * takes ownership of -- `arrivedAt` and `allowance` are the two most recent,
 * and a caller that transposed a pair of numbers would arm a timer at the wrong
 * instant with no type error anywhere.
 */
export interface WorldApplyRequest {
  readonly player: string | null;
  readonly command: WorldCommand;
  readonly timing: WorldTiming;
  /** The platform's stamped instant for this command (#57). A scheduled
   *  event's clock is its own `due` and comes from `timing` instead. */
  readonly arrivedAt: number;
  /** What the queue already holds for this command's OWNER and for this world,
   *  which is what `ctx.schedule()` refuses against (#56, #105). */
  readonly allowance: ScheduleAllowance;
  /** Which seats are connected as this command runs (#144). The parent's own
   *  derivation from its attached sockets, per seat and never stored -- see
   *  `WorldCommandStamp.presence` for the full promise. It rides BOTH roads:
   *  a player's command and a due event alike may ask who is here. */
  readonly presence: readonly number[];
  /**
   * THE WATERMARK FOR THE SEAT THIS DISPATCH IS ABOUT (ShufflewickPub #383).
   *
   * `presence`'s durable counterpart, and it rides both roads too -- but the
   * seat it names is different on each. On a player's road it is the acting
   * seat. On the clock's it is the OWNER of the event, which is not the seat
   * being charged for it: a due event's schedules are billed to the world,
   * while the deadline it is checking belongs to a person. Null when the
   * dispatch is about nobody.
   *
   * See `SeatActivity` for what a host may count as activity; the parent is
   * the only thing that may answer, because the child can see no store.
   */
  readonly activity: SeatActivityStamp | null;
  /**
   * EVERY CHAIR THIS DISPATCH'S WALK NAMED, ANSWERED (ShufflewickPub #423).
   *
   * What the walk collected, handed over whole. Empty for a seated action,
   * always: a seat's verb may not declare an activity round, so the only
   * honest thing to hand its handler is nothing to read.
   */
  readonly declaredActivity: readonly DeclaredSeatActivityStamp[];
}

/**
 * What `declare` answers.
 *
 * `needs` is what the parent must send, NOT everything the command names --
 * the child subtracts what it already holds, so the steady state is an empty
 * list and no storage read at all.
 */
export interface WorldDeclaration {
  readonly needs: readonly string[];
}

/**
 * What a DISPATCH's `declare` answers (ShufflewickPub #423).
 *
 * A shape of its own rather than a field added to `WorldDeclaration`, because
 * the read paths beside it -- a view's declaration, an offer's, a pick's --
 * cannot ask about a chair at all: each of them belongs to a seat, and a seat's
 * road has no activity round. Putting an always-empty list on three surfaces to
 * serve one is how a field comes to be read as meaning something on a road that
 * never sets it.
 */
export interface WorldDispatchDeclaration {
  /** Partitions the parent must send before asking again. `WorldDeclaration`'s
   *  `needs` under the name the two-list shape gives it. */
  readonly partitions: readonly string[];
  /** Chairs the parent must answer a point read for, at most one per round. */
  readonly seats: readonly number[];
}

/**
 * WHY ONE PLAYER GOT NO VIEW, IN THE FORM THE ENVELOPE ALREADY CARRIES (#310).
 *
 * The same two fields `world-runner-entry.ts` puts on a refused answer, and
 * deliberately so: the CODE is what crosses the boundary, an absent code is an
 * unclassified throw and therefore the game's, and the parent has one mapping
 * from code to `reason` rather than two that can drift.
 *
 * It exists because the read path answers an AUDIENCE. A view is one seat's, so
 * a failure computing one is one seat's too -- and until #310 it was thrown out
 * of the whole batch's work, which refused every other watcher in the window and
 * told each of them whatever the failing seat's error said about that player.
 */
export interface WorldViewRefusal {
  readonly code?: string;
  readonly message: string;
}

/**
 * What `declareViews` answers: the union the parent must load, and the players
 * whose declaration would not run.
 *
 * THE UNION IS STILL ONE CALL. A player whose `world.view` throws is recorded
 * and skipped rather than aborting the loop, so the declaration costs exactly
 * the round trip it always did -- splitting it per player is what would put
 * back the O(watchers) child calls #114 removed.
 */
export interface WorldViewNeeds extends WorldDeclaration {
  readonly refused: Readonly<Record<string, WorldViewRefusal>>;
}

/** What `viewsFor` answers: a view for each player it could project, and a
 *  refusal for each it could not. Both, because a batch is a set of separate
 *  answers that happen to share a round trip. */
export interface WorldViews {
  /**
   * EACH DISTINCT VIEW, ONCE (ShufflewickPub #408).
   *
   * This used to be `views: Record<player, unknown>`, which said the same
   * answer as many times as there were seats reading it -- 18.5 MB for a
   * 500-seat announcement in a public room, stringified here and parsed again
   * in the parent, for 500 copies of one body. Nothing about the viewer is in a
   * view any more, so the copies are copies; `of` says whose is whose, and the
   * parent encodes one frame per distinct body instead of one per watcher.
   */
  readonly bodies: readonly unknown[];
  /** Which body each answered player holds, as an index into `bodies`. */
  readonly of: Record<string, number>;
  readonly refused: Record<string, WorldViewRefusal>;
}

/** One player's failure, classified for the wire. `world-runner-entry.ts`'s
 *  catch writes the identical pair for a whole call, and the parent reads both
 *  the same way. */
function viewRefusalOf(error: unknown): WorldViewRefusal {
  return {
    ...(error instanceof WorldRefusal ? { code: error.code } : {}),
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The store the engine reads through INSIDE the child.
 *
 * It never reaches anywhere. The parent fills it immediately before the
 * command that needs it, so by the time `ensureResident` asks, the answer is
 * already in memory -- which is what lets an interface designed around an
 * asynchronous read work across a boundary that permits no I/O.
 *
 * Entries are dropped once adopted. The engine holds the live subtree from
 * then on, and keeping the bytes too would mean the child carried a second
 * copy of every resident partition for the lifetime of the world.
 */
export interface InlinedPartitionStore extends WorldPartitionSource {
  /** Accept what the parent sent for the command about to run. */
  provide(partitions: Readonly<Record<string, StoredPartition>>): void;
  /** Whether this store can already answer for `name`, which is what
   *  `declare` subtracts so the parent never re-sends a resident partition. */
  holds(name: string): boolean;
  /**
   * Forget that `name` was ever adopted (#43).
   *
   * EVICTION'S OTHER HALF, and it is not optional. `holds` is what `declare`
   * subtracts, so a store that still claimed an evicted partition would make
   * the parent send nothing for it -- and the engine, asked to adopt from a
   * store whose bytes were dropped at adoption time, has nothing to adopt. The
   * partition is then neither resident nor obtainable, which is a world that
   * has silently lost a room.
   */
  forget(name: string): void;
}

export function createInlinedPartitionStore(): InlinedPartitionStore {
  const pending = new Map<string, StoredPartition>();
  // Everything handed to the engine so far. The engine holds the live subtree
  // from then on, so the bytes are dropped -- keeping them would mean the
  // child carried a second copy of every resident partition for the lifetime
  // of the world.
  const adopted = new Set<string>();

  return {
    provide(partitions) {
      for (const [name, partition] of Object.entries(partitions)) {
        pending.set(name, partition);
      }
    },
    holds(name) {
      return adopted.has(name) || pending.has(name);
    },
    forget(name) {
      adopted.delete(name);
      pending.delete(name);
    },
    async read(name) {
      const partition = pending.get(name);
      if (!partition) return undefined;
      pending.delete(name);
      adopted.add(name);
      return partition;
    },
  };
}

/**
 * The child's half: an engine, its command table, and the two calls above.
 *
 * A factory over an object literal rather than a class, because there is no
 * state here beyond what is closed over and nothing to subclass -- and because
 * a `WorldRunnerHandle` is what every caller actually holds. The two names
 * below are the whole of the child's surface.
 *
 * Deliberately NOT a `WorldEngine`. It is the same operations with the
 * partitions made explicit, and collapsing the two would hide exactly the
 * thing this file exists to make visible: that a command's partitions are
 * decided before it runs and supplied from outside.
 */
/**
 * THE PARTITIONS THE ENGINE HOLDS AS LIVE SUBTREES (#217).
 *
 * The other half of "this child already has it", and the half `declare` used
 * to miss. The inlined store holds bytes the parent sent; the ENGINE holds the
 * tree, and a partition the bundle's `genesis` BUILT was never in the store at
 * all -- `registerResident` put it straight into the engine. So a store-only
 * subtraction reported every genesis partition as needed on the first command
 * that named it, in the very instance that had just created it: one wasted
 * storage read and transfer per room, and a second serialized copy pinned in
 * isolate memory until an eviction forgot it.
 */
function residentNames(engine: WorldEngine): Set<string> {
  return new Set(engine.residency().map((partition) => partition.name));
}

/**
 * Take what the parent sent, DROPPING what the engine already holds (#217).
 *
 * Bytes for a resident partition have nothing to be adopted into --
 * `ensureResident` returns early -- so keeping them would leave a second copy
 * of a live subtree sitting in the store's pending map for the life of the
 * world, which is exactly what `InlinedPartitionStore` says it does not do.
 */
async function adopt(
  engine: WorldEngine,
  store: InlinedPartitionStore,
  supplied: Readonly<Record<string, StoredPartition>>,
): Promise<void> {
  const resident = residentNames(engine);
  const fresh: Record<string, StoredPartition> = Object.create(null) as Record<
    string,
    StoredPartition
  >;
  for (const [name, partition] of Object.entries(supplied)) {
    if (!resident.has(name)) fresh[name] = partition;
  }
  store.provide(fresh);
  await engine.hydrate(Object.keys(fresh));
}

export function createWorldRunner(
  engine: WorldEngine,
  store: InlinedPartitionStore,
  buildGenesis: () => Record<string, StoredPartition> = () => ({}),
  /**
   * The bundle's `world.migration.create`, or a world that adds no roots (#218).
   *
   * Supplied the same way `buildGenesis` is, and for the same reason: the
   * runner is handed the ENGINE rather than the game, and only `createWorld`
   * holds both the game and the bundle's declaration.
   */
  migrationHooks: WorldMigrationHooks = {},
): WorldRunnerHandle {
  return {
    /**
     * Which partitions the parent must send for this command.
     *
     * Answered from the bundle's own declaration, WITHOUT running anything --
     * that is what `partitions(args, seat)` is for, and it is why the contract
     * requires it to be answerable with no world loaded. An unknown command,
     * and a player reaching for the clock's own (#120), are refused here rather
     * than after a storage read, so neither costs anything.
     *
     * THE ACTING PLAYER IS NAMED (#121), because the declaration is now allowed
     * to see the acting seat -- and the ENGINE is what turns a player into one,
     * since the roster is the engine's. This used to read the command table
     * directly, which is exactly why a command could not name "my own holding".
     */
    async declare(
      command: WorldCommand,
      player: string | null,
      supplied: Readonly<Record<string, StoredPartition>>,
      now: number,
      declared: readonly DeclaredSeatActivityStamp[],
    ): Promise<WorldDispatchDeclaration> {
      // WHAT THE LAST ROUND ASKED FOR, MADE RESIDENT (#122). Adopted rather
      // than merely held, because a declaration reads through the ENGINE's live
      // tree and bytes sitting in the store answer nothing.
      await adopt(engine, store, supplied);
      const resident = residentNames(engine);
      const needs = engine.commandNeeds(player, command, now, declared);
      return {
        partitions: needs.partitions.filter(
          (name) => !store.holds(name) && !resident.has(name),
        ),
        // NOT SUBTRACTED HERE, because there is nothing on this side to
        // subtract against (ShufflewickPub #423): a watermark never becomes
        // resident, so the engine's own ordered match against what the host has
        // already answered is the whole of the bookkeeping.
        seats: needs.seats,
      };
    },

    async genesis(): Promise<WorldGenesis> {
      const partitions = buildGenesis();
      // THE STAMP RIDES WITH THE BYTES (#377). Genesis minted every id this
      // world has, so the counter it leaves behind is the world's durable
      // allocation -- and a host that wrote the partitions without it would
      // have no way to mint safely on any later wake.
      return { partitions, nextElementId: engine.nextElementId() };
    },

    async serialize(dirty: readonly string[]): Promise<WorldSerialized> {
      // THE STAMP RIDES WITH THE BYTES (#224), exactly as it does for genesis:
      // the command that dirtied these roots may also have minted into them.
      const partitions = await engine.serializePartitions(dirty);
      return { partitions, nextElementId: engine.nextElementId() };
    },

    migrationShape(): WorldMigrationShape {
      if (migrationHooks.finalize !== undefined) return { kind: "whole-world" };
      if (migrationHooks.survey !== undefined) {
        return { kind: "survey", maxDigestBytes: migrationHooks.survey.maxBytes };
      }
      return { kind: "independent" };
    },

    async migrateAll(
      stored: Readonly<Record<string, StoredPartition>>,
      ctx: WorldMigrateContext,
    ): Promise<WorldMigrated> {
      // WHAT THE WORLD HOLDS vs WHAT THIS CALL WAS HANDED (ShufflewickPub
      // #402). They are the same thing for a whole-world migration and they
      // are not for a PAGE: a host migrating a world too large for one call
      // sends a slice of the bytes and the whole name list, because `create`
      // has to know every name that is taken and a refusal has to name the
      // world rather than the page.
      // WHICH PASS OF A BOUNDED MIGRATION THIS IS (ShufflewickPub #449). A
      // paged survey migration is TWO passes and the host says which; an
      // unpaged one is handed the whole world, so the fold and the transform
      // are this one call and there is no pass to name.
      const paged = ctx.allNames !== undefined;
      assertPassNaming(migrationHooks, paged, ctx);
      const survey = migrationHooks.survey;
      const existing = [...(ctx.allNames ?? Object.keys(stored))].sort();
      const page = Object.keys(stored).sort();

      // EVERY ROOT RESIDENT BEFORE ANY CALLBACK RUNS (ShufflewickPub #379).
      // The host used to hydrate, transform and serialize each root as it
      // reached it, so a hook could only ever see the one it was handed and
      // anything derived across roots was a bet on key order.
      await adopt(engine, store, stored);

      // (0) THE FOLD, WHICH RUNS BEFORE ANY ROOT IS WRITTEN (#449). A survey
      // pass folds this page in, answers the digest as bytes and writes
      // nothing, so the host can carry it to the next page and let this one go;
      // by the time anything transforms, the fold has seen every root and no
      // iteration order can change the answer.
      if (survey !== undefined && ctx.pass === "survey") {
        return surveyPass(engine, survey, page, ctx);
      }
      const digest =
        survey === undefined ? undefined : completedDigest(engine, survey, page, ctx, paged);

      // WHAT EVERY HOOK IS TOLD, BUILT RATHER THAN SPREAD. `ctx` carries the
      // host's paging bookkeeping and a SERIALIZED digest; a hook is told the
      // version gap and the digest as the author's own value, and nothing else.
      const hookCtx = { from: ctx.from, to: ctx.to, digest };

      // (1) PER ROOT, and only the ones this call was handed. `finalize` below
      // reads the results rather than the bytes.
      for (const name of page) {
        engine.migratePartition(name, (element) => {
          migrationHooks.partition?.(element, { name, ...hookCtx });
        });
      }

      // (2) THE ROOTS THIS VERSION ADDS (#218). Their bytes are re-taken in (4);
      // what this step establishes is the NAMES, their parents, and that none
      // of them collides with a root the world already holds.
      // RUN ONCE PER MIGRATION, NOT ONCE PER PAGE. A paged host says which call
      // is the one that creates; a whole-world migration is always that call.
      const created = createdRoots(engine, migrationHooks, paged, ctx, { ...hookCtx, existing });
      const names = [...existing, ...Object.keys(created)].sort();

      // (3) THE WHOLE WORLD, ONCE (#379). Old roots transformed, new roots
      // built, nothing serialized -- the one phase that can derive an existing
      // root's value from another root, in either direction.
      finalizeAcross(engine, migrationHooks, names, ctx);

      // (4) AND ONLY THEN, BYTES. Taken after every callback, so a finalize
      // that wrote to a root step (1) or (2) had already serialized is not a
      // write the transaction loses.
      const written = await engine.serializePartitions(
        paged ? [...page, ...Object.keys(created)] : names,
      );
      const partitions = bytesFor(page, written);
      const createdRecords = createdFrom(created, written);

      // (5) AND THE ENGINE STOPS CALLING THEM CHANGED (ShufflewickPub #407).
      // A migration is the one write that does not run through a dispatch, so
      // nothing takes the touch-marks it leaves: the engine went on believing
      // these roots differed from storage, `evictSubtree` kept a mark for each
      // one, and the world's next command found a mark it could not name and
      // refused -- for good. That is what made "migrate a page, then let go of
      // it" impossible, and letting go of the page is the whole saving paging
      // exists for. Said over exactly the names just serialized, and after
      // them, because these bytes go into the host's transaction as one.
      engine.migrateBaseline(Object.keys(written));

      return {
        partitions,
        created: createdRecords,
        nextElementId: engine.nextElementId(),
      };
    },

    /**
     * ONE PICK, RE-ASKED (ShufflewickPub #378), on the same declare-then-read
     * split every other read path has: the parent supplies what the LAST round
     * asked for, and this answers what is still missing.
     */
    async declarePick(
      player: string,
      action: string,
      selection: string,
      args: Readonly<Record<string, unknown>>,
      now: number,
      supplied: Readonly<Record<string, StoredPartition>>,
    ): Promise<WorldDeclaration> {
      await adopt(engine, store, supplied);
      const resident = residentNames(engine);
      return {
        needs: engine
          .pickPartitions(player, action, selection, args, now)
          .filter((name) => !store.holds(name) && !resident.has(name)),
      };
    },

    async resolvePick(
      player: string,
      action: string,
      selection: string,
      args: Readonly<Record<string, unknown>>,
      stamp: WorldOfferStamp,
    ): Promise<WorldActionOffer["selections"][number]> {
      return engine.resolvePick(player, action, selection, args, stamp);
    },

    /**
     * WHAT A DRAFT WOULD COST (#248), on the same declare-then-read split every
     * other read path has: the parent supplies what the last round asked for,
     * and this answers what is still missing.
     */
    async declareQuote(
      player: string,
      action: string,
      args: Readonly<Record<string, unknown>>,
      now: number,
      supplied: Readonly<Record<string, StoredPartition>>,
    ): Promise<WorldDeclaration> {
      await adopt(engine, store, supplied);
      const resident = residentNames(engine);
      return {
        needs: engine
          .quotePartitions(player, action, args, now)
          .filter((name) => !store.holds(name) && !resident.has(name)),
      };
    },

    async resolveQuote(
      player: string,
      action: string,
      args: Readonly<Record<string, unknown>>,
      stamp: WorldOfferStamp,
    ): Promise<readonly string[] | null> {
      return engine.resolveQuote(player, action, args, stamp);
    },

    async createPartition(name: string): Promise<WorldCreatedPartition | undefined> {
      const partition = engine.createPartition(name);
      if (partition === undefined) return undefined;
      return { partition, nextElementId: engine.nextElementId() };
    },

    unseat(player: string): void {
      engine.unseat(player);
    },

    seat(player: string, seat: number): void {
      engine.seat(player, seat);
    },

    residency() {
      return engine.residency();
    },

    /**
     * Which partitions these players' views are about (#95).
     *
     * The read path's `declare`, and the same subtraction: what the parent must
     * SEND, not everything the views name -- so a second look at a world that
     * is already resident reads no storage at all.
     *
     * MANY PLAYERS, ONE ANSWER (#114). A notice reaches an event's whole
     * audience and every client answers with a view request, so the parent
     * batches them; a per-player call would put the O(watchers) round trips
     * back a layer down from where they were removed.
     */
    async declareViews(
      players: readonly string[],
      supplied: Readonly<Record<string, StoredPartition>>,
    ): Promise<WorldViewNeeds> {
      // The read path's half of #122's second round, and the same adoption: a
      // `view` that is about the room a player is standing in cannot know which
      // room that is until the index it named is in the tree.
      await adopt(engine, store, supplied);
      const resident = residentNames(engine);
      const needs = new Set<string>();
      const refused: Record<string, WorldViewRefusal> = {};
      for (const player of players) {
        // PER PLAYER, INSIDE ONE CALL (#310). `viewPartitions` runs the
        // bundle's own `world.view` for that seat and reads the seat off the
        // roster, so it throws for a seat the game cannot describe and for a
        // player the engine does not hold. Recorded and skipped, because the
        // union of everybody ELSE's declaration is still exactly right and the
        // parent still loads it in one round trip.
        //
        // The refusals are the LAST round's, and that is what the parent keeps:
        // a declaration is asked again once what it named is resident, so a
        // seat that threw reaching for an absent partition may well succeed on
        // the round after the one that loaded it.
        try {
          for (const name of engine.viewPartitions(player)) {
            if (!store.holds(name) && !resident.has(name)) needs.add(name);
          }
        } catch (error) {
          refused[player] = viewRefusalOf(error);
        }
      }
      return { needs: [...needs], refused };
    },

    async viewsFor(players: readonly string[]): Promise<WorldViews> {
      // NOTHING TO SUPPLY. Everything these views are about was adopted while
      // the declaration was settling (#122), so this projects and never fetches.
      const of: Record<string, number> = {};
      const refused: Record<string, WorldViewRefusal> = {};
      // THE WHOLE AUDIENCE IN ONE ASK (ShufflewickPub #408). This used to loop
      // over `viewFor`, which meant the engine serialized the resident tree in
      // full once per watcher and then redacted each copy for one seat -- and
      // only the redaction was ever about the seat. Handing the audience down
      // whole lets the engine spend the shared pass once; it still projects,
      // prunes and refuses per seat, so no view changes.
      //
      // ONE SEAT'S PROJECTION IS STILL ONE SEAT'S FATE (#310). A view can throw
      // for one player while every other view in the batch is perfectly
      // computable -- the observed case being a view that reaches a
      // deliberately absent partition after a wake. The engine hands back what
      // that seat threw, and TRANSLATING IT IS THIS LAYER'S JOB: the engine
      // speaks to no platform, so a refusal minted down there would be minted
      // twice.
      const audience = await engine.viewsFor(players);
      for (const seat of audience.seats) {
        if (seat.refused) refused[seat.player] = viewRefusalOf(seat.failure);
        else of[seat.player] = seat.at;
      }
      return { bodies: audience.bodies, of, refused };
    },

    async declareOffers(
      player: string,
      supplied: Readonly<Record<string, StoredPartition>>,
      now: number,
    ): Promise<WorldDeclaration> {
      // The offer path's half of the same adoption the write path makes: a
      // declaration reads through the ENGINE's live tree, and bytes sitting in
      // the store answer nothing.
      await adopt(engine, store, supplied);
      const resident = residentNames(engine);
      return {
        needs: engine
          .offerPartitions(player, now)
          .filter((name) => !store.holds(name) && !resident.has(name)),
      };
    },

    offersFor(player: string, stamp: WorldOfferStamp): Promise<readonly WorldActionOffer[]> {
      return engine.offersFor(player, stamp);
    },

    evict(names: readonly string[]): void {
      // BOTH HALVES ARE THE ENGINE'S NOW. It releases the live subtree and
      // tells its own `WorldPartitionSource` to stop claiming the name, because
      // eviction is no longer the only caller: #68's rollback drops a partition
      // too, and a paired operation with two callers is how the pairing comes
      // apart. Without the second half `declare` subtracts the partition from
      // what the parent must send, so the next command that needs it finds
      // nothing anywhere.
      engine.evict(names);
    },

    /** Run the command, against a world `declare` already finished assembling. */
    async apply(request: WorldApplyRequest): Promise<WorldCommandResult> {
      // `timing` decides which road, and it also decides the clock: a
      // scheduled event's `now` is its own `due`, which `onEvent` takes from
      // the timing it is already given. `arrivedAt` is the PLAYER command's
      // clock, stamped by the parent (#57).
      return request.timing === null
        ? engine.applyCommand(request.player as string, request.command, {
            now: request.arrivedAt,
            allowance: request.allowance,
            presence: request.presence,
            activity: request.activity,
            declaredActivity: request.declaredActivity,
          })
        : engine.onEvent(request.command, request.timing, {
            allowance: request.allowance,
            presence: request.presence,
            activity: request.activity,
            declaredActivity: request.declaredActivity,
          });
    },
  };
}

/** The parent's side of the boundary, as the little of it the driver needs. */
export interface WorldRunnerHandle {
  /**
   * The partitions a brand-new world starts with (#37 item 1).
   *
   * THE BUNDLE IS THE AUTHORITY, and it has to be: only the game knows what a
   * world contains before anybody has played it. The platform's alternative was
   * to invent a shape and make every game conform, which is the opposite of
   * what `WorldCommandTable` is for.
   *
   * Answers `name -> { parentId, json }`, which is exactly what
   * `DurableObjectPartitionStore.create` takes -- the parent writes them and
   * never looks inside.
   */
  genesis(): Promise<WorldGenesis>;
  /**
   * Serialize exactly the partitions the parent says are dirty (#37 item 4).
   *
   * The dirty set is the ENGINE's own answer, accumulated by the PARENT across
   * however many commands one checkpoint covers -- `WorldCommandResult.dirty`
   * is per command, and `BoardSmithWorldEngine` says outright that unioning
   * them is the caller's job. Nothing here decides what changed; the parent
   * hands back what it accumulated and gets bytes -- and the allocation stamp
   * those bytes were minted under (#224), which the host writes in the same
   * transaction.
   */
  serialize(dirty: readonly string[]): Promise<WorldSerialized>;

  /**
   * MIGRATE ONE PARTITION, from bytes to bytes (#200).
   *
   * Hands the partition's own element to the bundle's migration hook and
   * answers what it serializes to. Adoption is done here rather than by the
   * caller because a migration reads bytes the CALLER holds -- a world's
   * stored partitions -- rather than anything this runner already has resident.
   *
   * Nothing is written: the caller collects every answer and commits them
   * together, because a migration that landed halfway is a world whose rooms
   * disagree about which rules wrote them.
   */
  /**
   * A MIGRATION, WHOLE (ShufflewickPub #379).
   *
   * One call, replacing the per-root `migratePartition` and the trailing
   * `migrateCreate`, and the shape is the point: every stored root is adopted
   * BEFORE any hook runs, and nothing is serialized until every hook has
   * finished. So `migration.finalize` can derive one existing root's value from
   * another existing root's, in either direction, and the answer does not
   * depend on the order the host happened to list its keys in.
   *
   * `stored` is every partition the world holds, by name, read by the caller --
   * only the host has the store's whole key set. Nothing is written here: the
   * caller lands `partitions`, `created` and `nextElementId` in ONE transaction
   * with the queued events and the new state version, because a migration that
   * landed halfway is a world whose rooms disagree about which rules wrote them.
   */
  migrateAll(
    stored: Readonly<Record<string, StoredPartition>>,
    ctx: WorldMigrateContext,
  ): Promise<WorldMigrated>;

  /**
   * WHAT SHAPE IS THIS MIGRATION (ShufflewickPub #402, #449)?
   *
   * Asked BEFORE the host decides how to run the migration, and it answers all
   * three of the ways one can be run rather than the two a boolean could tell
   * apart: `"independent"` pages in one pass with nothing carried between
   * calls, `"survey"` pages in two (fold every root, then transform every root
   * against the completed digest, with the digest carried as bytes), and
   * `"whole-world"` needs every root resident in ONE call -- which is a limit
   * the host must state rather than discover at a deadline.
   */
  migrationShape(): WorldMigrationShape;


  /**
   * A PARTITION ROOT THE STORE HAS NEVER HELD, built on demand (#218).
   *
   * The host looks for a declared partition, finds no row, and asks here before
   * refusing: the bundle answers an element for a name it creates on first use,
   * and nothing for a name that is simply wrong. Idempotent -- a name already
   * resident is answered from residency rather than rebuilt -- so the host may
   * ask on every miss.
   *
   * The host owns the write, as it owns every other write.
   */
  /**
   * WHAT RE-ASKING ONE PICK STILL NEEDS RESIDENT (ShufflewickPub #378).
   *
   * `declare` for a single selection. A world's offer is enumerated with nothing
   * bound; a selection whose `multiSelect` or `choices` reads an earlier
   * selection's value cannot be answered that way, and the panel re-asks with
   * the args it has. Its rounds are declared with those args, so a round may
   * name a partition the empty-args offer could not, and the parent supplies it
   * the way it supplies every other declared read.
   */
  declarePick(
    player: string,
    action: string,
    selection: string,
    args: Readonly<Record<string, unknown>>,
    now: number,
    supplied: Readonly<Record<string, StoredPartition>>,
  ): Promise<WorldDeclaration>;

  /**
   * THAT PICK, RE-EVALUATED against the args bound so far (#378).
   *
   * Everything `declarePick` named is resident by the time this is called. It
   * is a READ: the same read-only facilities an offer runs under, no clock to
   * arm and nothing to checkpoint.
   */
  resolvePick(
    player: string,
    action: string,
    selection: string,
    args: Readonly<Record<string, unknown>>,
    stamp: WorldOfferStamp,
  ): Promise<WorldActionOffer["selections"][number]>;

  /**
   * WHAT QUOTING A DRAFT STILL NEEDS RESIDENT (#248).
   *
   * `declarePick` for the whole walk rather than one selection: a quote reads
   * what execute reads, so the round after the last selection counts too. The
   * parent supplies what it names, exactly as it supplies every other declared
   * read.
   */
  declareQuote(
    player: string,
    action: string,
    args: Readonly<Record<string, unknown>>,
    now: number,
    supplied: Readonly<Record<string, StoredPartition>>,
  ): Promise<WorldDeclaration>;

  /**
   * THAT DRAFT'S PRICE, from the game (#248).
   *
   * Everything `declareQuote` named is resident by the time this is called. It is
   * a READ -- the same read-only facilities an offer runs under -- and it is
   * advisory: the order that follows is validated against the world it finds.
   */
  resolveQuote(
    player: string,
    action: string,
    args: Readonly<Record<string, unknown>>,
    stamp: WorldOfferStamp,
  ): Promise<readonly string[] | null>;

  createPartition(name: string): Promise<WorldCreatedPartition | undefined>;
  /**
   * Admit a player to a world that is already running (#37 item 2).
   *
   * Separate from every other operation because it is the only one that
   * changes WHO the world is for rather than what it contains. A persistent
   * world's roster outlives no season boundary in particular: players join one
   * that is already running, and the engine cannot be rebuilt to admit them
   * without evicting everything resident in it.
   */
  seat(player: string, seat: number): void;
  /**
   * Retire a seat's holder, so the chair can be given to somebody else
   * (ShufflewickPub #399).
   *
   * `seat`'s inverse, and the other half of "a world's roster changes for as
   * long as the world lasts": before this the roster only grew, so a host that
   * wanted a departed player's chair back had to throw the whole isolate away
   * and rebuild it -- which on a platform that caps a world's lifetime isolates
   * turns ordinary churn into a world that stops working.
   *
   * It forgets a MAPPING and moves nothing in the world. What becomes of the
   * ground behind the chair is the game's, through `WorldDefinition.vacate`,
   * and the order of the two is the host's to keep.
   */
  unseat(player: string): void;
  /**
   * Which partitions are resident and how recently each was named (#43).
   *
   * The parent cannot answer this: residency is a property of the live tree in
   * the child, and the parent deliberately never parses a partition. So it asks
   * -- and then decides, because only the parent knows what is dirty.
   */
  residency(): readonly { readonly name: string; readonly lastUsed: number }[];
  /**
   * WHAT THESE PLAYERS' VIEWS ARE ABOUT, before any of them is computed (#95).
   *
   * Declare-then-read, which is `declare`/`apply` on the other half of the
   * protocol and for the same reason: the child cannot reach the parent's
   * storage, so it says what it needs and is told.
   *
   * A PLAYER WHOSE DECLARATION THROWS IS NAMED, NOT RAISED (#310). One asker's
   * failure may not decide the batch's, and the union the other players need is
   * unaffected by it.
   */
  declareViews(
    players: readonly string[],
    supplied: Readonly<Record<string, StoredPartition>>,
  ): Promise<WorldViewNeeds>;
  /**
   * THESE PLAYERS' VIEWS OF THE WORLD (#44, #114).
   *
   * Computed on demand and per player, which is the whole read-cost argument:
   * a view costs what that player can see rather than what the world contains.
   * It is what replaces the round architecture's per-round fan-out of
   * pre-computed views.
   *
   * A LIST RATHER THAN ONE PLAYER, because the read path's real unit is an
   * audience: one world-visible change makes every watcher ask at the same
   * instant, and answering them one call at a time serializes the whole
   * audience under the parent's world lock (#114). The partitions arrived
   * during `declareViews`, exactly as a command's arrive during `declare`.
   *
   * AND A LIST OF ANSWERS, NOT ONE ANSWER (#310). Each player gets a view or a
   * refusal of their own; a throw computing one seat's view is that seat's, and
   * raising it would refuse the whole audience for one unviewable watcher.
   */
  viewsFor(players: readonly string[]): Promise<WorldViews>;
  /** Release these partitions. Safe only immediately after a checkpoint. */
  evict(names: readonly string[]): void;
  /**
   * What this SEAT may do here, enumerated (#85, #91, #169).
   *
   * Applies nothing. It LOADS what each action's round-one declaration names,
   * which for every catalogue game is a subset of what that seat's view already
   * names -- so an offer over a seat that has just looked reads no storage.
   */
  offersFor(player: string, stamp: WorldOfferStamp): Promise<readonly WorldActionOffer[]>;
  /**
   * Which partitions an offer for this seat still needs (#169).
   *
   * `supplied` is what the last round asked for. Drive it with
   * `walkDeclaration`, exactly as a command's declaration is driven.
   */
  declareOffers(
    player: string,
    supplied: Readonly<Record<string, StoredPartition>>,
    now: number,
  ): Promise<WorldDeclaration>;
  /**
   * What this dispatch needs, and who is asking for it (#121, ShufflewickPub
   * #423).
   *
   * `player` is null for a scheduled event. It is here because the bundle's
   * declaration may name the ACTING SEAT's own partition, and the seat is a
   * fact only the engine's roster holds.
   *
   * `supplied` is WHAT THE LAST ROUND ASKED FOR (#122). The child adopts it
   * before answering, so a declaration that could only be made by reading the
   * world is made on the round after the one that loaded it. Empty on the
   * first round, which is every declaration a world without location state ever
   * makes.
   *
   * `declared` is the other half of the same idea, for the other kind of round:
   * every chair the parent has answered a point read for so far, in the order
   * it was asked. The child never remembers one between calls, because the
   * store the answers come out of is the parent's.
   */
  declare(
    command: WorldCommand,
    player: string | null,
    supplied: Readonly<Record<string, StoredPartition>>,
    now: number,
    declared: readonly DeclaredSeatActivityStamp[],
  ): Promise<WorldDispatchDeclaration>;
  apply(request: WorldApplyRequest): Promise<WorldCommandResult>;
}
