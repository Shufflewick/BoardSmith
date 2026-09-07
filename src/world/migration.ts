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
import type { GameElement } from "../engine/index.js";
import { worldRefusal, type WorldRefusal } from "./refusals.js";

/** What a queued event looks like to a migration: the verb, and the arguments
 *  frozen when it was scheduled. */
export interface MigratableEvent {
  readonly action: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** What the author declares to move a world one version forward. */
export interface WorldMigration {
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
  readonly partition?: (element: GameElement, ctx: WorldMigrationContext) => void;
  /**
   * ONE QUEUED EVENT'S ARGUMENTS, ANSWERED FRESH.
   *
   * The arguments a scheduled event was frozen with are as opaque to a host as
   * a partition's bytes, and mean exactly as much to the new handler. Answer
   * what the new rules should see; answer the same object to leave it alone.
   */
  readonly event?: (event: MigratableEvent) => Record<string, unknown>;
}

/** What a migration is told about the thing it is transforming. */
export interface WorldMigrationContext {
  /** The partition's name, so one function can serve a world of many kinds. */
  readonly name: string;
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
