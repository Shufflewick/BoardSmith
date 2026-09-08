/**
 * EVERY WAY A WORLD CAN REFUSE, IN ONE TABLE.
 *
 * ONE VOCABULARY FOR EVERY HOST. A world runs on a laptop under
 * `boardsmith dev` and on a hosting platform's own infrastructure, and the two
 * keep different lifecycle policy -- one parks worlds and ends seasons, the
 * other closes when the terminal does. What they must not keep differently is
 * WHAT WENT WRONG AND WHOSE IT IS: a refusal whose meaning depended on which
 * host produced it would make a game's local behaviour a poor guide to its
 * published behaviour, which is the whole thing #164 exists to fix.
 *
 * ## Why a taxonomy, and why it is not decoration
 *
 * A host decides the CONSEQUENCE of a failure from its owner, and the split it
 * turns on is emphatic:
 *
 *   a GAME-CODE failure dead-letters the event and NEVER parks, because "one
 *     poison respawn timer must not kill a 500-player world";
 *   a PLATFORM refusal parks after two, because a deterministic refusal is
 *     issued identically next time and retrying spends a wake an hour forever.
 *
 * Nothing supplied that `owner`. Every refusal in the world modules was a bare
 * `new Error(...)` with a well-written sentence and no machine-readable
 * anything, so the one decision the split exists to drive could not be made
 * without parsing prose. That is what this file fixes: a refusal carries its
 * code and its owner, and the park ladder reads the owner rather than guessing.
 *
 * MISCLASSIFYING IS EXPENSIVE IN BOTH DIRECTIONS, which is why each entry
 * below states its reason rather than just its owner. Calling a game bug a
 * platform refusal lets one bad bundle park a live world; calling a platform
 * quota a game bug leaves the world burning a wake an hour against a refusal
 * that will never stop being issued.
 *
 * ## Four owners, and a host's ladder sees only two of them
 *
 * A park ladder only ever sees the two owners that can reach a checkpoint --
 * `game` and `platform`. This table has two more:
 *
 *   CALLER -- a refusal of one request that says NOTHING about the world's
 *     health. A client naming a command that does not exist, or a player who is
 *     not seated. It is answered to whoever asked and never reaches the ladder,
 *     so giving it "game" would be a lie that happens to behave correctly, and
 *     the next person to add a park rule would inherit the lie.
 *
 *   INFRASTRUCTURE -- a service the platform DEPENDS ON did not answer (#278).
 *     Not the game's, because the bundle's code never ran; not the platform's
 *     either, in the sense this table means by "platform", because that word
 *     names a DETERMINISTIC refusal the world's own state produces and this is
 *     the opposite -- an outage nobody's state caused and time alone repairs.
 *     Charging it as either is what #278 was: an R2 blip burnt a player's
 *     timer through its four attempts and dead-lettered it, and calling it
 *     "platform" instead would have ended a 500-player season after two wakes.
 *     It needs a ladder of its own, measured in TIME rather than in
 *     occurrences, because how often a world happens to wake says nothing about
 *     how long its bundle store has been unreachable. That ladder is the
 *     host's; the owner that tells it apart is here.
 *
 * A host whose ladder lives in a database it cannot import this file from
 * restates the two owners it needs and holds them equal with a test. There is
 * still one table, and it is this one.
 */

/**
 * Who is responsible for a refusal, which is what decides its consequence.
 *
 * The order is deliberate and is the escalation: a caller's mistake costs one
 * request, a game's costs one event, and the platform's costs the world.
 * `infrastructure` sits outside that escalation rather than at the end of it --
 * it costs NOTHING while it lasts, and only the world once it has lasted long
 * enough to stop being an outage.
 */
// Exported because a HOST's consequence policy is written over it: a park
// ladder, a dead-letter rule, a log filter. The vocabulary is the library's and
// the consequence is the host's.
export type WorldRefusalOwner = "caller" | "game" | "platform" | "infrastructure";

/**
 * Every refusal a world can issue, and who owns it.
 *
 * A frozen table rather than scattered string literals, so "what can go wrong
 * in a world?" is answerable by reading one screen -- and so a new refusal has
 * to be classified before it can be thrown at all.
 */
export const WORLD_REFUSALS = {
  // ---- CALLER: one request refused; the world is fine ----
  "unknown-command": {
    owner: "caller",
    why: "a client named a command this world does not have; the world is unaffected",
  },
  "unknown-player": {
    owner: "caller",
    why: "a command named somebody this world does not seat; the world is unaffected",
  },
  "invalid-order": {
    owner: "caller",
    why: "#195: a command arrived with an order identity that is not one -- no id, an over-long id, or no mint instant. Every player command carries one, and it is what lets a repeat of an uncertain order be answered from its receipt instead of spending a second time, so a command that cannot be identified is refused at the door rather than run without the guarantee it was supposed to carry. The world is unaffected",
  },
  "order-outcome-unknown": {
    owner: "caller",
    why: "#195: a repeat arrived for an order minted before this world's receipt floor, so its receipt (if it ever had one) has been swept and nothing can say whether it committed. Refused rather than run, because running it is the second spend the order identity exists to prevent. CALLER-owned and not platform-owned: the world is healthy, one request cannot be answered, and a park ladder must not climb because a page came back from a fortnight offline",
  },
  "clock-only-command": {
    owner: "caller",
    why: "a player sent a verb the bundle built with `worldClockAction()` -- the clock's own, reached by a scheduled event and by nothing else. The world is unaffected: the refusal is issued before the handler is reached, and a client that never offered the command cannot have sent it by accident",
  },
  "world-full": {
    owner: "caller",
    why:
      "a seating would exceed the bundle's own maxPlayers (#150). The engine " +
      "holds exactly that many Game players, so a seat past it is a chair that " +
      "does not exist -- refused before anything is written, and CALLER-owned " +
      "because it says nothing about the world's health: the one request is what " +
      "gets refused. A host that admits players before seating them must count " +
      "the same LIFETIME seats this door counts -- a seat is assigned once and " +
      "never handed on -- or a joiner it admitted arrives at a chair that does " +
      "not exist. What is left after that is a host's stored player count " +
      "disagreeing with the compiled rules, whose remedy is a republish; " +
      "`definition.ts:assertSeatWithinWorld` carries the sentence that says so " +
      "to the player",
  },
  "rate-limited": {
    owner: "caller",
    why:
      "#267: this connection sent frames faster than the world accepts them, and " +
      "one frame was dropped rather than run. CALLER-owned and emphatically so: " +
      "a rate limit fires on WELL-FORMED traffic, which is exactly the traffic a " +
      "park ladder must never read as a world in trouble -- a world that parked " +
      "because somebody flooded it would hand every griefer a kill switch. The " +
      "world is untouched: the refusal is issued at the door, before the lock, " +
      "before the drain, and before anything is applied. `world-rate-limit.ts` " +
      "holds the allowances and the arithmetic that picked them",
  },
  "seat-conflict": {
    owner: "caller",
    why: "a seating named a player who already holds a DIFFERENT seat (#150). It used to share `unknown-player`'s code, which misread a conflict about somebody who IS in the world as 'not in this world'. A seat is where a player's holdings are, so the move is refused rather than handing them somebody else's -- and the world is unaffected",
  },

  // ---- GAME: the bundle's own doing; dead-letters, never parks ----
  "undeclared-partition": {
    owner: "game",
    why: "a handler read a partition its partitions() did not declare -- a bundle bug, and the same bundle will do it again next time",
  },
  "engine-not-world-mode": {
    owner: "game",
    why: "the bundle built its engine over a game that is not in world mode, so element references would resolve to the wrong element once a partition is not resident",
  },
  "schedule-cap": {
    owner: "game",
    why: "#35's single refusal: a player's unkeyed pending events hit the cap. The bundle chose to schedule them, and the refusal names three ways for it to stop",
  },
  "schedule-key-cap": {
    owner: "game",
    why: "#105: the owner is holding as many DISTINCT KEYED timers as this world allows one owner. The key comes from game code, so a bundle minting a key name per action grows the queue forever -- and the refusal names reusing a key first, because that is what a game at this cap is failing to do",
  },
  "schedule-batch-cap": {
    owner: "game",
    why: "#105: one command asked for more scheduled events than a command may ask for. It is the bundle's own loop, and the same loop runs again next time, so it dead-letters rather than parking a world",
  },
  "schedule-world-cap": {
    owner: "game",
    why: "#105: the world's whole queue is at its ceiling. GAME-owned despite being about the world, deliberately -- a queue only ever fills with events bundles asked for, and parking a live world over one bundle's filling is the failure the owner split exists to prevent",
  },
  "invalid-schedule-delay": {
    owner: "game",
    why: "a handler asked to schedule something at a negative or non-finite delay",
  },
  "invalid-schedule-interval": {
    owner: "game",
    why: "a handler asked for a recurrence with a non-positive or non-finite interval (#127) -- a wake that would re-arm instantly forever. It is the bundle's own doing and the same bundle will do it again, so it dead-letters rather than parking the world",
  },
  "invalid-schedule-command": {
    owner: "game",
    why: "a handler asked for a wake that runs nothing -- a schedule request that names no command (#89). It is the bundle's own doing and the same bundle will do it again, so it dead-letters rather than parking the world",
  },
  "invalid-schedule-cancel": {
    owner: "game",
    why: "a handler asked to cancel a timer without naming the key it was armed under (#177) -- a cancel is keyed the way arming is keyed, so a nameless one addresses nothing",
  },
  "bundle-not-a-world": {
    owner: "game",
    why: "a bundle reached a world isolate without `world.actions`, or asked to require a module the child does not have -- the manifest declared a world and the compiled rules do not implement one, which upload validation cannot see",
  },
  "world-migration-unavailable": {
    owner: "game",
    why: "#200: a world's recorded stateVersion and its offered bundle's differ, and no migration in that bundle can cross the gap -- none declared, one declared from a different version, or a bundle older than the world. GAME-owned because the declaration is the bundle's own and the same bundle offers the same gap next time; the world is not changed and plays on the rules it has, so nothing about it is unhealthy",
  },
  "invalid-world-action": {
    owner: "game",
    why: "a bundle registered a world action the platform cannot offer or cannot bound (#169) -- an unbounded `from`/`filter` element form, a candidate outside what the step declared, a selection past `budgets.ts:WorldBudgets.maxCandidatesPerSelection`, a seatless action that asks a question, or two declarations for one step. Every one of them would produce an offer whose size is a function of the RESIDENT tree rather than of the declaration, which is the O(world) read the partitioned model exists to delete -- so it is refused once when the world is built rather than on whichever player first asked what they could do here",
  },
  "not-in-a-world": {
    owner: "game",
    why: "an action built with `worldAction()` reached `ctx.world` while no world was running it (#169) -- registered on a table, or reached after the dispatch that bound its facilities finished. The bundle's own doing, and the same bundle does it again",
  },
  "unknown-scope": {
    owner: "game",
    why: "a handler addressed an event to a scope that is neither the reserved world scope nor a partition this world has loaded (#58). The platform routes on the scope, so an event nobody can be in reaches nobody -- refused rather than delivered silently to no one",
  },
  "child-timeout": {
    owner: "game",
    why: "the bundle's isolate did not answer one of the parent's calls inside its deadline (#107). A handler that never resolves burns no CPU, so no runtime limit fires and nothing throws -- and without a deadline the world chains every later frame, alarm and wake behind it forever while the Durable Object bills continuously. It is the bundle's own doing and the same bundle hangs the same way next time, so it dead-letters the event rather than parking a world 499 other players are in",
  },
  "invalid-partition-name": {
    owner: "game",
    why: "the bundle named a partition this store may not hold -- empty, over-long, illegal characters, or claimed for one player",
  },
  "declaration-unsettled": {
    owner: "game",
    why: "#122: a bundle's `world.view()` named a partition it had not seen on every round of declaration, so `declaration.ts`'s round ceiling stopped it. Two-phase declaration exists so a view can read an index and then name the room the index names; one that names something new every round is walking the world, which is the O(world) read the mechanism exists to prevent. A VIEW ONLY, since #169: an action's declaration is an ordered walk whose length is its own selection count, so it cannot fail this way and has no ceiling to trip. GAME-owned because the declaration is the bundle's own and the same bundle writes the same one next time",
  },
  "partition-too-large": {
    owner: "game",
    why: "a partition serialized to more than `budgets.ts:WorldBudgets.partitionMaxBytes` (#110). The budget is the platform's, drawn well below the SQLite value wall #74 measured, but what a partition CONTAINS is entirely the bundle's -- the same call `schedule-cap` makes about a platform cap a bundle's own choices ran into. Game-owned so one room that outgrew its budget cannot park a world 499 other players are in, and the refusal names the fix the author can actually apply: split the partition",
  },
  "declaration-write": {
    owner: "game",
    why: "#219: a command's `partitions()` or a bundle's `world.view()` tried to WRITE through the residency it was handed. A declaration runs before the platform has decided what the command may change -- before the rollback snapshot on the write path, and with no snapshot at all on the read path -- so nothing it writes can be checkpointed: it either rides a rollback the player was told discarded it, or is reverted at the next hibernation with nobody told. GAME-owned, like every other bundle mistake, and the refusal names run() as the place the write belongs",
  },
  "partition-missing": {
    owner: "game",
    why: "#134: a bundle named a partition this world's store does not have. Every one of its three raise sites addresses the game author -- \"Check the name, or create the partition before a command names it\" -- because the reachable producer is a `partitions()` or `world.view` declaration with a typo in it, the same species of bundle bug as `invalid-partition-name`, `undeclared-partition` and `unknown-scope`. It was PLATFORM-owned until #134, so two consecutive occurrences climbed the park ladder and ended a 500-player world's season over one misspelt room name. The platform's own bookkeeping breaking has its own codes -- `partition-not-resident`, `partition-vanished`, `checkpoint-unknown-partition` -- and those still park",
  },

  // ---- PLATFORM: a host's own bookkeeping broke; deterministic, so a host with a park ladder parks ----
  "partition-not-resident": {
    owner: "platform",
    why: "a partition was serialized or read without being adopted, which means the engine and the store disagree about what is loaded",
  },
  "allocation-undeclared": {
    owner: "platform",
    why: "ShufflewickPub #377: a host asked for a partition to be created on demand without handing over the world's durable id allocation stamp, so the engine's counter speaks only for the partitions it happens to hold. Minting from there is how a cold host built a new root on the identity of a stored root it had never loaded, and the world only found out at the later command that declared both -- an unplayable world, from a write that looked fine. PLATFORM-owned and deterministic: a host that does not persist `nextElementId` does not persist it on the next wake either, so parking is right and retrying is not",
  },
  "partition-vanished": {
    owner: "platform",
    why: "a partition was adopted and is no longer in the tree -- something evicted it behind the engine's back, and its changes since the last checkpoint are gone",
  },
  "child-generations-exhausted": {
    owner: "platform",
    why: "#116: this world has discarded `world-session.ts:WORLD_CHILD_GENERATION_CAP` child isolates, and `WorkerLoader` has no eviction call -- every one of them still holds a loaded engine and the spliced runner in the worker process. PLATFORM-owned even though a hanging bundle is what spends the allowance, and the distinction is the point: `child-timeout` blames the game and dead-letters one event, which is right, but the leak it leaves behind is the platform's problem and only the platform can stop paying for it. Deterministic -- a world at the cap is at the cap on every later wake -- so it is exactly what the ladder parks on",
  },
  "unknown-child-op": {
    owner: "platform",
    why: "#206: the parent asked the child isolate for an operation the child's protocol does not have -- a renamed op, or a new one deployed before the runner bundle was respliced. It used to fall through to the apply dispatch, which read `body.event.name` off a body with no event and threw an uncoded TypeError; `ownerOf` calls an uncoded throw the GAME's, so a disagreement between two PLATFORM halves dead-lettered events against whatever bundle happened to be loaded. Platform-owned and deterministic -- the same skew answers the same way on every wake -- so it is exactly what the ladder should park on rather than retry hourly",
  },
  "world-engine-unavailable": {
    owner: "platform",
    why:
      "#324: this world cannot be given the BoardSmith engine it launched on -- either the " +
      "revision it recorded is not one this deployment carries, or it launched before the " +
      "platform recorded a revision at all and nothing knows which engine serialized its " +
      "partitions. A world's durable bytes are the ENGINE's serialization " +
      "(`engine.ts` writes each partition with `toJSON()` and reads it back " +
      "through `adoptSubtree`), so the alternative to refusing is handing months-old bytes to a " +
      "different deserializer with nothing anywhere able to detect the corruption -- which is " +
      "what every re-vendor did to every live world at once before the engine was pinned. " +
      "PLATFORM-owned and deterministic: the bundle's code never runs, the same world answers " +
      "the same way on every later wake, and the archive is not something the world can repair, " +
      "so the ladder parks it rather than spending a wake an hour on it forever",
  },
  "checkpoint-unknown-partition": {
    owner: "platform",
    why: "a checkpoint named a partition the store never read or created, so it does not know where the subtree hangs and would graft it wrongly on the next wake",
  },

  // ---- INFRASTRUCTURE: costs nothing until it has lasted `WORLD_BUNDLE_OUTAGE_PARK_MS` ----
  "bundle-store-unavailable": {
    owner: "infrastructure",
    why:
      "#278: the bundle store did not answer when this world asked for its rules -- an R2 or " +
      "loader outage, raised BEFORE any of the bundle's code ran. It was uncoded until now, so " +
      "`ownerOf` called it the GAME's: an evicted world plus a throwing store spent the event's " +
      "whole attempt budget in four wakes, roughly two minutes on an occupied world at the " +
      "re-arm floor, and dead-lettered a timer the game had never been asked to run. A " +
      "recurrence lost its whole series that way, not one tick. It is deliberately NOT " +
      "platform-owned either: `bundle-not-a-world` and `child-generations-exhausted` are the " +
      "pre-handler refusals that ARE deterministic, and they must keep parking a world that " +
      "cannot advance, while this one repairs itself when somebody else's service comes back. " +
      "So it charges the event nothing, holds its place, and re-arms on the ordinary floor -- " +
      "and `outageParks` is the ceiling that still stops a world whose store never returns",
  },
} as const satisfies Record<string, { owner: WorldRefusalOwner; why: string }>;

export type WorldRefusalCode = keyof typeof WORLD_REFUSALS;

/**
 * A refusal that says who owns it.
 *
 * An `Error` subclass rather than a returned result, because every site that
 * raises one is deep inside a command the caller cannot usefully continue --
 * and because the alternative, threading a result type through the engine, is
 * the change `world-engine.ts` deliberately did not make.
 */
export class WorldRefusal extends Error {
  readonly code: WorldRefusalCode;
  readonly owner: WorldRefusalOwner;

  constructor(code: WorldRefusalCode, message: string) {
    super(message);
    this.name = "WorldRefusal";
    this.code = code;
    this.owner = WORLD_REFUSALS[code].owner;
  }
}

/** Raise a classified refusal. The message is the human sentence; the code is
 *  what the park ladder and the operator's logs read. */
export function worldRefusal(code: WorldRefusalCode, message: string): WorldRefusal {
  return new WorldRefusal(code, message);
}

/**
 * Who owns this failure, for a caller that has caught something.
 *
 * An UNCLASSIFIED throw is `"game"`, and that default is the safe one rather
 * than the tidy one: an unexpected error from inside a command is most likely
 * the bundle's, and treating it as a platform refusal would let a game bug park
 * a live world after two occurrences. The cost of being wrong the other way is
 * one dead-lettered event, which quarantine already bounds.
 *
 * THE DEFAULT IS ONLY SAFE WHERE A COMMAND ACTUALLY RAN, which is what #278
 * cost the platform to learn. `#loadRulesJs` throws from OUTSIDE any command --
 * before the bundle has been fetched, let alone entered -- so its uncoded R2
 * failure arrived here and was called the game's, and a timer nobody's code had
 * touched spent its whole attempt budget on an outage. That site classifies its
 * own throw now (`bundle-store-unavailable`), which is the general remedy: a
 * failure raised where no bundle code is on the stack must name itself, because
 * this default cannot tell.
 */
export function ownerOf(error: unknown): WorldRefusalOwner {
  return error instanceof WorldRefusal ? error.owner : "game";
}

/**
 * WHAT THIS FILE DELIBERATELY DOES NOT CARRY: the park ladder.
 *
 * `failureParks`, `outageParks` and the two ceilings they read stayed with the
 * hosting platform (#165), and the split is the same one the owners above
 * describe. This table says WHO owns a refusal, which is a fact about the
 * refusal and the same on every host. What a host DOES about it -- park the
 * world, end the season, count it against a game's health -- is that host's
 * lifecycle policy: a laptop running `boardsmith dev` parks nothing, has no
 * hourly sweep to measure an outage against, and has no season to end.
 *
 * A host that wants a ladder reads `ownerOf` and decides. Two hosts that keep
 * different ladders over one vocabulary is the arrangement; two vocabularies
 * is what this file exists to prevent.
 */
