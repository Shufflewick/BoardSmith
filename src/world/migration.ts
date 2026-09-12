/**
 * MOVING A LIVE WORLD ONTO RULES THAT READ ITS STATE DIFFERENTLY (#200).
 *
 * `stateVersion` (#194) is the author's veto: bump it and a host refuses to
 * move a running world onto the new bundle, and that world plays its season out
 * on the rules it started under. That is the right answer for a change nobody
 * can reconcile -- but it was the ONLY answer, so an author whose new rules
 * could perfectly well read the old world's state had no way to say so, and a
 * season anybody was in was a season that could never gain a feature.
 *
 * A migration is that missing sentence. It is the author's, because only the
 * author knows what their stored bytes mean:
 *
 *   world: {
 *     stateVersion: 2,
 *     migration: {
 *       from: 1,
 *       partition: (element) => { element.plots ??= []; },
 *       event: (event) => ({ ...event.args, tier: event.args.tier ?? 1 }),
 *     },
 *   }
 *
 * ## What a migration is allowed to be
 *
 * ONE STEP, from one declared version to this bundle's. Not a chain: a world
 * two versions behind is refused by name rather than walked through migrations
 * that were each written against a world the author has not seen. An author who
 * wants the chain publishes the intermediate version and upgrades twice, which
 * is a thing they can see the result of.
 *
 * PER PARTITION AND PER QUEUED EVENT, because those are the only two things a
 * world durably holds that outlive its rules. `partition` is handed the element
 * a partition deserialized to and mutates it in place; `event` is handed a
 * queued event and answers its new arguments. Nothing else in a world survives
 * a bundle swap, so nothing else is offered.
 *
 * AND `create`, WHICH IS THE OTHER DIRECTION (#218). `partition` transforms a
 * root that exists; it cannot answer more roots than it was handed, and it has
 * nowhere to say what a new root hangs from. So a world that outgrew its
 * genesis -- twelve empires becoming five hundred, one shared timeline becoming
 * a region apiece -- had no expressible upgrade at all, because genesis runs
 * once and never again. `create` is that missing half: it is handed the game
 * and the names the world ALREADY holds, and answers the roots to add.
 *
 * ## What it is NOT allowed to be
 *
 * It is not a command. It runs with no player, no clock and no schedule: a
 * migration that could schedule would be arming timers against a world whose
 * own timers are mid-transformation, and one that could act would be a command
 * no seat sent. What it may do is read and rewrite the bytes it was handed.
 *
 * ## Atomicity, and where it actually lives
 *
 * A migration either lands whole or does not land at all -- the world stays on
 * its old rules, playable, and the failure is reported. THIS FILE cannot
 * enforce that: the write is the host's, and a laptop's SQLite transaction and
 * a Durable Object's chunked write are different machines. What lives here is
 * the CONTRACT and the DECISION -- what a migration may declare, and whether a
 * given world may cross a given version gap -- so that both hosts refuse and
 * accept the same worlds for the same stated reasons.
 */
import type { Game, GameElement } from "../engine/index.js";
import { worldRefusal, type WorldRefusal } from "./refusals.js";

/** What a queued event looks like to a migration: the verb, and the arguments
 *  frozen when it was scheduled. */
export interface MigratableEvent {
  readonly action: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * THE BOUNDED FOLD A CROSS-ROOT MIGRATION DERIVES ITS FACTS WITH
 * (ShufflewickPub #449).
 *
 * `finalize` reads across roots by having every root RESIDENT at once, and a
 * host's call ceiling is a measured memory ceiling rather than a preference --
 * a 662-root, 4.5 MB world does not fit in one call and never will. So the one
 * migration shape #379 was opened for was the one shape a real world could not
 * run.
 *
 * The facts a cross-root migration needs are not the roots. They are what the
 * roots ADD UP TO: a total, a directory, a maximum coordinate, a reconciliation
 * of who paid for what. A survey says so. It folds the whole world into ONE
 * BOUNDED VALUE, a page at a time, BEFORE anything is written -- and then every
 * write is a pure function of (that root, the completed digest). Iteration
 * order cannot matter, because the fold finished before the first write, and
 * residency never exceeds one page.
 *
 * The digest is the author's own shape and the author's own ceiling. It crosses
 * calls as JSON, because a host persists it between wakes.
 */
export interface WorldMigrationSurvey<TDigest> {
  /** The digest before any root is folded in. Must be JSON-serializable. */
  initial(): TDigest;
  /**
   * FOLD ONE EXISTING ROOT INTO THE DIGEST.
   *
   * Called once per root, in pages, before any transform hook runs. The
   * element is READ-ONLY -- writing through it is a refusal, not a silent
   * no-op, because a survey that could write would be a half-migrated world
   * held across a host's wakes.
   *
   * Must be ORDER-INDEPENDENT: a host folds roots in whatever order it reads
   * them, across however many calls it takes, and the digest that comes out
   * has to be the same one either way.
   */
  root(digest: TDigest, element: GameElement, name: string): TDigest;
  /**
   * THE AUTHOR'S OWN CEILING ON THE SERIALIZED DIGEST, IN BYTES.
   *
   * Required. An accumulator with no stated bound is `finalize` wearing a
   * pageable migration's clothes: it grows with the world, and the migration
   * that was supposed to fit stops fitting on the world it was written for.
   * Say what "bounded" means for this digest and the host holds you to it.
   *
   * The HOST enforces its own ceiling as well, and a refusal says which of the
   * two it was.
   */
  readonly maxBytes: number;
}

/**
 * What the author declares to move a world one version forward.
 *
 * `TDigest` is the shape of this migration's own `survey` digest, inferred by
 * `worldMigration()`; a migration that declares no survey has none, and its
 * hooks are handed `undefined` where the digest would be.
 */
export interface WorldMigration<TDigest = unknown> {
  /**
   * THE STATE VERSION THIS MIGRATION READS.
   *
   * A world is migrated only when its own recorded version is exactly this.
   * Anything else is refused by name: a migration is written against a world
   * the author has seen, and running one against a world two versions back is
   * running it against a world nobody has.
   */
  readonly from: number;
  /**
   * ONE PARTITION, TRANSFORMED IN PLACE.
   *
   * Handed the element the partition's stored bytes deserialized to under the
   * NEW rules, and the name it lives under. Mutate it; the host writes it.
   *
   * Optional, because a version whose change is entirely in its queued events
   * is a real change and should not have to declare an empty function.
   */
  partition?(element: GameElement, ctx: WorldMigrationContext<TDigest>): void;
  /**
   * ONE QUEUED EVENT'S ARGUMENTS, ANSWERED FRESH.
   *
   * The arguments a scheduled event was frozen with are as opaque to a host as
   * a partition's bytes, and mean exactly as much to the new handler. Answer
   * what the new rules should see; answer the same object to leave it alone.
   */
  event?(event: MigratableEvent): Record<string, unknown>;
  /**
   * DURABLE PARTITION ROOTS THIS VERSION ADDS (#218).
   *
   * Genesis runs once, so a world that needs a root it did not start with has
   * only this. Build the elements on the game exactly as `world.genesis` does
   * and answer them as `name -> element`; the host records each as a new
   * partition, in the SAME write that lands the transformed ones.
   *
   * `ctx.existing` is every name the world already holds, so being idempotent
   * is a filter rather than a convention -- and a name that is already taken is
   * refused by name rather than silently overwriting a live partition.
   *
   * It may not REMOVE a root. A migration that could drop partitions would be
   * deleting a season's stored bytes on a hook whose failure mode is a typo,
   * and nothing gives them back.
   */
  create?(game: Game, ctx: WorldMigrationCreateContext<TDigest>): Record<string, GameElement>;
  /**
   * THE WHOLE WORLD, ONCE EVERY ROOT IS IN FRONT OF IT (ShufflewickPub #379).
   *
   * `partition` sees one root and `create` may only answer NEW names, so an
   * upgrade whose shape is "this existing root's new value comes from THAT
   * existing root" had nowhere to live. Writing it in `partition` meant hoping
   * the other root had already been transformed, which is a bet on whatever
   * order the store happened to list its keys in -- not a contract anybody can
   * write against.
   *
   * So this runs LAST, with every root resident and none of them serialized
   * yet: the ones the world already held, transformed by `partition`, and the
   * ones `create` has just built. Read any of them by name, write to any of
   * them, and the whole result lands in the one transaction the migration
   * already was. Order-independent by construction, because there is no order
   * left to depend on.
   *
   * It may not ADD roots -- that is `create`, and having one door for it is
   * what makes "a name that is already taken" refusable -- and it may not
   * remove one, for the reason `create` may not.
   */
  finalize?(game: Game, ctx: WorldMigrationFinalizeContext): void;
  /**
   * THE WHOLE WORLD, FOLDED INTO ONE BOUNDED VALUE FIRST (#449).
   *
   * The bounded half of `finalize`. Declaring it makes this migration PAGEABLE
   * in two passes -- survey every root, then transform every root against the
   * completed digest -- so a world far past any host's call ceiling can still
   * derive one root's value from another.
   *
   * MUTUALLY EXCLUSIVE WITH `finalize`, refused where it is declared: the two
   * are the same intent at different costs, and a migration that declares both
   * says nothing about which one a host should run.
   */
  readonly survey?: WorldMigrationSurvey<TDigest>;
}

/**
 * A MIGRATION, WITH ITS DIGEST TYPE INFERRED (ShufflewickPub #449).
 *
 * `world.migration` is declared beside every other world field, and a bundle's
 * definition cannot be generic without every reader of it becoming generic too
 * -- so the slot holds `WorldMigration<unknown>` and an object literal written
 * straight into it would hand every hook an `unknown` digest to cast.
 *
 * Write it through here instead and the digest type flows from `survey.initial`
 * into `partition` and `create` with nothing to annotate and nothing to cast:
 *
 *   migration: worldMigration({
 *     from: 1,
 *     survey: { initial: () => ({ total: 0 }), root: (d, e) => ..., maxBytes: 4096 },
 *     partition: (element, { digest }) => { element.share = digest.total; },
 *   })
 */
export function worldMigration<TDigest>(
  migration: WorldMigration<TDigest>,
): WorldMigration<TDigest> {
  return migration;
}

/** What the `finalize` hook is given: the whole world, by name (#379). */
export interface WorldMigrationFinalizeContext {
  /**
   * One root, live and mutable, by the name it is stored under.
   *
   * Every root this world holds is resident by the time `finalize` runs --
   * the ones it already had, and the ones `create` just built -- so this
   * always answers, and a name the world does not hold is a refusal rather
   * than an `undefined` for the hook to branch on.
   */
  readonly partition: (name: string) => GameElement;
  /** Every root this world holds, existing and newly created, sorted. */
  readonly names: readonly string[];
  /** The version being left, and the one being arrived at. */
  readonly from: number;
  readonly to: number;
}

/** What the `create` hook is told about the world it is adding roots to. */
export interface WorldMigrationCreateContext<TDigest = unknown> {
  /** Every partition name this world already holds, so idempotence is a filter. */
  readonly existing: readonly string[];
  /**
   * THE COMPLETED DIGEST (#449), when this migration declares a `survey`.
   *
   * Complete: every root the world holds was folded in before this ran, so a
   * root derived here is derived from the whole world rather than from
   * whatever happened to be resident. `undefined` for a migration that
   * declares no survey.
   */
  readonly digest: TDigest;
  /** The version being left, and the one being arrived at. */
  readonly from: number;
  readonly to: number;
}

/** What a migration is told about the thing it is transforming. */
export interface WorldMigrationContext<TDigest = unknown> {
  /** The partition's name, so one function can serve a world of many kinds. */
  readonly name: string;
  /**
   * THE COMPLETED DIGEST (#449), when this migration declares a `survey`.
   *
   * Every root was folded in before this root was transformed, so this root's
   * new value may be a function of any other root's persisted value and the
   * answer does not depend on which root a host reached first. `undefined` for
   * a migration that declares no survey.
   */
  readonly digest: TDigest;
  /** The version being left, and the one being arrived at. */
  readonly from: number;
  readonly to: number;
}

/** What a host should do with a world whose stored version and bundle differ. */
export type MigrationPlan =
  /** Nothing to do: the world already reads as this bundle reads. */
  | { readonly kind: "current" }
  /** Run this migration, then record the new version. */
  | { readonly kind: "migrate"; readonly migration: WorldMigration; readonly from: number; readonly to: number }
  /** The gap cannot be crossed, and the world stays exactly as it is. */
  | { readonly kind: "refuse"; readonly refusal: WorldRefusal };

/**
 * WHETHER THIS WORLD MAY RUN THESE RULES, decided the same way by every host.
 *
 * `stored` is the version the world was last written under -- absent means 0,
 * the same default `boardsmith build` writes down. `declared` is the bundle's.
 */
export function planMigration(args: {
  readonly stored: number;
  readonly declared: number;
  readonly migration: WorldMigration | undefined;
}): MigrationPlan {
  const { stored, declared, migration } = args;
  if (stored === declared) return { kind: "current" };
  if (declared < stored) {
    return {
      kind: "refuse",
      refusal: worldRefusal(
        "world-migration-unavailable",
        `This world was written under state version ${stored} and these rules declare ` +
          `${declared}, which is older. A world is never migrated backwards: the bytes it holds ` +
          "were written by rules that knew more about them than these do. Run the world on the " +
          "version it was left on, or publish a version that declares " +
          `${stored} or higher with a migration from it.`,
      ),
    };
  }
  if (migration === undefined) {
    return {
      kind: "refuse",
      refusal: worldRefusal(
        "world-migration-unavailable",
        `This world was written under state version ${stored} and these rules declare ` +
          `${declared}, so they read its stored state differently -- and they declare no ` +
          "migration from it. Either publish these rules with " +
          `\`world.migration: { from: ${stored}, ... }\`, which says how the old bytes become ` +
          "the new ones, or leave `stateVersion` where it was, which says the old bytes are " +
          "already right. The world was not changed.",
      ),
    };
  }
  if (migration.from !== stored) {
    return {
      kind: "refuse",
      refusal: worldRefusal(
        "world-migration-unavailable",
        `This world was written under state version ${stored}, and these rules declare a ` +
          `migration from ${migration.from}. A migration is one step, written against a world ` +
          "its author has seen -- running this one would be running it against a world nobody " +
          "has. Upgrade through the version it was written for, or declare a migration from " +
          `${stored}.`,
      ),
    };
  }
  return { kind: "migrate", migration, from: stored, to: declared };
}

/**
 * REFUSE A MIGRATION DECLARATION THAT IS NOT ONE, when the bundle is read.
 *
 * At the door rather than at the moment a world needs it: an author finds out
 * that their migration is unusable while they are writing it, not when somebody
 * else's season fails to move.
 */
export function assertWorldMigration(migration: unknown, stateVersion: number): void {
  const candidate = migration as Partial<WorldMigration>;
  if (!Number.isInteger(candidate.from) || (candidate.from as number) < 0) {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `world.migration` declares no usable `from`. It is the state version the " +
        "migration READS -- a whole number from 0 up -- and a world is migrated only when its " +
        "own recorded version is exactly that.",
    );
  }
  if ((candidate.from as number) >= stateVersion) {
    throw worldRefusal(
      "bundle-not-a-world",
      `This bundle declares \`world.stateVersion: ${stateVersion}\` and a migration from ` +
        `${String(candidate.from)}. A migration moves a world FORWARD, so it must read a version ` +
        "older than the one these rules declare. If the old bytes are already right, the answer " +
        "is to leave `stateVersion` alone rather than to migrate from it to itself.",
    );
  }
  if (candidate.partition !== undefined && typeof candidate.partition !== "function") {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `world.migration.partition` is not a function. It is handed one partition's " +
        "element and mutates it in place; leave it out entirely for a version whose change is " +
        "only in its queued events.",
    );
  }
  if (candidate.create !== undefined && typeof candidate.create !== "function") {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `world.migration.create` is not a function. It is handed the game and the " +
        "names the world already holds, and answers the NEW partition roots to add as " +
        "`name -> element`; leave it out for a version that adds none.",
    );
  }
  if (candidate.finalize !== undefined && typeof candidate.finalize !== "function") {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `world.migration.finalize` is not a function. It is handed the game and an " +
        "accessor for every root this world holds -- transformed and newly created alike -- and " +
        "may write across them; leave it out for a version whose roots do not read one another.",
    );
  }
  if (candidate.survey !== undefined && candidate.finalize !== undefined) throw surveyAndFinalize();
  assertSurvey(candidate.survey);
  if (candidate.event !== undefined && typeof candidate.event !== "function") {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `world.migration.event` is not a function. It is handed one queued event " +
        "and answers the arguments the new rules should see; leave it out to keep every queued " +
        "event's arguments as they are.",
    );
  }
}

/**
 * REFUSE A `survey` BLOCK THAT IS NOT ONE (ShufflewickPub #449).
 *
 * At the door with every other declaration check, because every one of these
 * is a sentence the author can only get wrong while they are writing it.
 */
function surveyAndFinalize(): WorldRefusal {
  return worldRefusal(
    "bundle-not-a-world",
    "This bundle's `world.migration` declares BOTH `survey` and `finalize`, and a host cannot " +
      "know which one to run. They are the same intent at different costs: `survey` is the " +
      "bounded form -- it folds every root into one digest a page at a time, so the migration " +
      "runs on a world of any size -- and `finalize` is the whole-world form, which needs every " +
      "root resident in one call and is therefore capped by whatever a host can hold. Keep " +
      "`survey` unless the derivation genuinely cannot be expressed as a fold, and then keep " +
      "`finalize` alone.",
  );
}

function assertSurvey(survey: unknown): void {
  if (survey === undefined) return;
  if (typeof survey !== "object" || survey === null || Array.isArray(survey)) {
    throw worldRefusal(
      "bundle-not-a-world",
      `This bundle's \`world.migration.survey\` is not a survey block. It is ` +
        "`{ initial, root, maxBytes }`: `initial()` answers the digest before any root is folded " +
        "in, `root(digest, element, name)` folds ONE root into it, and `maxBytes` is your own " +
        "ceiling on the serialized digest. Leave it out for a migration whose roots do not read " +
        "one another.",
    );
  }
  const block = survey as Partial<WorldMigrationSurvey<unknown>>;
  if (typeof block.initial !== "function") {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `world.migration.survey.initial` is not a function. It takes nothing and " +
        "answers the digest before any root has been folded in -- `() => ({ total: 0 })` -- and " +
        "whatever it answers must survive JSON, because a host persists the digest between " +
        "wakes.",
    );
  }
  if (typeof block.root !== "function") {
    throw worldRefusal(
      "bundle-not-a-world",
      "This bundle's `world.migration.survey.root` is not a function. It is handed the digest so " +
        "far, ONE root's element and that root's name, and answers the digest with that root " +
        "folded in. The element is read-only, and the fold must be order-independent: a host " +
        "reaches the roots in whatever order it reads them.",
    );
  }
  if (!Number.isInteger(block.maxBytes) || (block.maxBytes as number) < 1) {
    throw worldRefusal(
      "bundle-not-a-world",
      `This bundle's \`world.migration.survey.maxBytes\` is ` +
        `${JSON.stringify(block.maxBytes)}, which is not a ceiling. It is a whole number of ` +
        "bytes, 1 or more: the largest the SERIALIZED digest may ever get. It is required " +
        "because an accumulator with no stated bound grows with the world, and the migration " +
        "that was supposed to fit stops fitting on the very world it was written for. The host " +
        "enforces its own ceiling as well, and a refusal says which of the two was hit.",
    );
  }
}

/**
 * ONE QUEUED EVENT'S ARGUMENTS UNDER THE NEW RULES.
 *
 * Written here rather than at each host's call site so that "a migration that
 * declares no `event` leaves every queued event alone" is one fact rather than
 * two implementations of it.
 */
export function migratedArgs(
  migration: WorldMigration,
  event: MigratableEvent,
): Record<string, unknown> {
  if (migration.event === undefined) return { ...event.args };
  const answered = migration.event(event);
  if (typeof answered !== "object" || answered === null || Array.isArray(answered)) {
    throw worldRefusal(
      "world-migration-unavailable",
      `This world's migration answered ${JSON.stringify(answered)} for the queued "${event.action}" ` +
        "event's arguments. An event's arguments are an object of named values -- the same shape " +
        "the event was scheduled with -- and a host cannot store anything else. The world was " +
        "not changed.",
    );
  }
  return answered;
}

/**
 * WHAT THE `create` HOOK ANSWERED, OR A REFUSAL NAMING WHY IT IS NOT USABLE.
 *
 * Checked here rather than at each host's call site so that every host refuses
 * the same declarations for the same stated reasons -- and checked BEFORE
 * anything is written, so a migration that trips one of these leaves the world
 * exactly as it was, on its old rules, playable.
 */
export function assertCreatedRoots(
  built: unknown,
  existing: readonly string[],
): asserts built is Record<string, GameElement> {
  if (typeof built !== "object" || built === null || Array.isArray(built)) {
    throw worldRefusal(
      "world-migration-unavailable",
      `This world's migration answered ${JSON.stringify(built)} from \`create\`. It answers the new ` +
        "partition roots as an object of `name -> element` -- the same shape `world.genesis` " +
        "answers -- and `{}` for a version that adds none. The world was not changed.",
    );
  }
  const taken = new Set(existing);
  for (const [name, element] of Object.entries(built as Record<string, unknown>)) {
    if (name.length === 0) {
      throw worldRefusal(
        "world-migration-unavailable",
        "This world's migration answered a partition root with an empty name. A partition is " +
          "addressed by its name -- a command declares it, a view names it, the store keys it -- " +
          "so a nameless one could never be reached again. The world was not changed.",
      );
    }
    if (taken.has(name)) {
      throw worldRefusal(
        "world-migration-unavailable",
        `This world's migration tried to create a partition named "${name}", which this world ` +
          "already holds. Creating it would replace a live partition's stored bytes with a fresh " +
          "element, which is not a migration, it is a deletion. `ctx.existing` lists every name " +
          "the world holds, so filter against it. The world was not changed.",
      );
    }
    if (typeof element !== "object" || element === null) {
      throw worldRefusal(
        "world-migration-unavailable",
        `This world's migration answered ${JSON.stringify(element)} for the new partition ` +
          `"${name}". Each entry is the ELEMENT the hook created on the game, exactly as ` +
          "`world.genesis` answers them. The world was not changed.",
      );
    }
    taken.add(name);
  }
}
