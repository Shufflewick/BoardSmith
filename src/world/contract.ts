/**
 * Issue #35 item 2: WHAT THE PLATFORM REQUIRES OF A WORLD ENGINE.
 *
 * The specification puts this work in this repo's tracker -- "BoardSmith is an
 * editable dependency of this repo, so this work belongs here" -- and it has
 * two halves that belong in different places. The IMPLEMENTATION is engine
 * work and lives in BoardSmith. The CONTRACT is the platform's requirement of
 * it, and it belongs at the boundary, which is here.
 *
 * Writing it down first is not ceremony. `WorldSession` is the only caller
 * this interface will ever have, and it exists already; an engine mode built
 * against a contract nobody wrote is an engine mode discovered to be the wrong
 * shape at integration time.
 *
 * ## The shape, and what each part is REPLACING
 *
 * #35 section 2 states the cost problem exactly: "Every action ships the ENTIRE
 * world into the stateless executor and back -- 1.86 MB in, 1.86 MB out, plus
 * a full re-serialisation. Cost scales with world size rather than with what
 * the action touched." Every member below exists to break that scaling:
 *
 *   `applyCommand` returns EVENTS AND A DIRTY SET, not a snapshot. That is the
 *     whole difference: an action ships ~100 bytes of command in and
 *     room-scoped events out, and the platform learns which subtrees changed
 *     instead of re-reading the world to find out.
 *   `viewFor` is PER PLAYER and computed from live objects, so a fan-out costs
 *     what a player can see rather than what the world contains.
 *   `serializePartitions` takes the dirty set, so a checkpoint writes what
 *     moved. A full re-serialisation per action is the 678ms this replaces.
 *
 * ## Two things it must NOT do, stated as part of the contract
 *
 * `no per-action snapshot` and `no actionHistory accumulation` are #35's words,
 * and both are load-bearing rather than tidiness. The snapshot model is what
 * makes cost O(world); `actionHistory` is issue #32's unbounded growth, which
 * the current engine only has bounded because the executor trims it on the way
 * out. A resident engine must not create the problem in the first place.
 *
 * The EXISTING snapshot model stays untouched for board games -- this is a
 * second mode beside it, never a replacement.
 *
 * ## WHAT BOARDSMITH ALREADY HAS, AND WHAT IT DOES NOT
 *
 * Surveyed 2026-08-25 against `~/BoardSmith/src/engine/utils/`, because "the
 * engine mode is weeks of work" is not a useful thing to hand somebody. Two of
 * the four members below are nearly free and two are the actual work:
 *
 *   `viewFor` -> `createPlayerView(game, player)` EXISTS
 *     (`engine/utils/snapshot.ts`). A resident `viewFor` is close to a direct
 *     call; the per-player fog-of-war logic is already written and tested.
 *     THAT SURVEY WAS HALF RIGHT, and #126 is the other half: the fog of war
 *     (`toJSONForPlayer`) is reusable and the rest of that projection is not.
 *     A table's view reports a TURN -- whose it is, which actions are open,
 *     why one is greyed -- and deciding that means evaluating every registered
 *     action against the whole tree, which a world does not have. See
 *     `viewFor` below.
 *   `onEvent` -> composes from the same action machinery `applyCommand` uses,
 *     so it costs whatever that costs and nothing extra.
 *
 *   `applyCommand`'s DIRTY SET has no primitive. `createSnapshot(game)` is
 *     whole-game by construction -- it is the O(world) cost this contract
 *     exists to replace -- and nothing today records WHICH subtrees a mutation
 *     touched. Producing one means instrumenting the element tree's mutation
 *     path, which is the engine's hot core.
 *   `serializePartitions` has no primitive either, for the same reason: there
 *     is no notion of a subtree boundary to serialize independently.
 *
 * So the shape of the remaining work is NOT a wrapper over existing calls. It
 * is dirty-tracking in the mutation path plus subtree serialisation, in the
 * code every published game executes -- which is why it wants a session that
 * begins by reading that element tree rather than one that ends by guessing at
 * it. The conformance suite (`games/test/world-engine-conformance.ts`) is what
 * says when the result is right, and it fails for the two implementations that
 * would satisfy these types while defeating the purpose.
 *
 * ## WHERE THE DIRTY SET COMES FROM -- DECIDED 2026-08-25
 *
 * ABSENT-UNTIL-LOADED HYDRATION. The platform loads the partitions a command
 * names before dispatching it; an unloaded partition is simply NOT IN THE TREE.
 * `dirty` is then "the partitions hydrated or move-touched since the last
 * checkpoint", which the platform already knows, plus two lines in the engine's
 * one reparent method.
 *
 * `serializePartitions` needs no new primitive at all: `GameElement.toJSON()`
 * already recurses over exactly one subtree, so a partition IS an element and
 * serialising the named ones is `toJSON()` on those roots.
 *
 * ### The write barrier is RETIRED, not deferred -- it is INCORRECT
 *
 * An earlier revision of this header recommended hydrate-on-touch first and
 * called a `defineProperty`/`Proxy` write barrier "correct and precise", to be
 * bought later as an optimisation. That was WRONG, and the error mattered:
 *
 * A barrier fires on `player.status = 'dormant'`. It NEVER fires on mutation
 * INSIDE an attribute value, and that is the dominant write style in the games
 * closest to world-shaped. In `sotf` -- the survival world being ported --
 * `upkeep.ts:487` writes `player.at[HEALTH] = health`, `:689` writes
 * `player.at[HUNGER] = ... - meal.hunger`, and `:493` writes
 * `game.deaths.push(...)`. Every one of those reads the attribute and mutates
 * THROUGH it; a setter on `at` or on `deaths` sees nothing.
 *
 * Catching them needs a DEEP proxy over every attribute value, and this engine
 * has an explicit principle against exactly that. `volatile-state.ts`: "We
 * never rewrite a designer-declared property into a Proxy at runtime -- doing
 * so would make a property's runtime identity (Array vs Proxy) and a
 * snapshot's shape depend on NODE_ENV".
 *
 * So the barrier is not an expensive precise option. It is a CHEAP IMPRECISE
 * one that silently drops a health change -- data loss wearing an
 * optimisation's name. Do not reach for it.
 *
 * AND #295 DID NOT REACH FOR IT EITHER, which is worth saying because the
 * problem it solved is the one a barrier is always proposed for. Deriving the
 * dirty set from the serialized form is complete, and it was also a pass over
 * the WHOLE RESIDENT SET on every command -- 11.5 ms of a 12.8 ms command at
 * 256 resident rooms of ~10 KB, against a 5 ms per-event budget. The fix is
 * not to see the write; it is to SCOPE THE COMPARISON to the partitions the
 * command could have written, which the engine knows because it owns every
 * door an element comes out of (`Game#takeTouchedPartitions`'s docblock lists
 * them). A deep mutation is still caught by the same comparison as before,
 * because the comparison is unchanged -- only the set it runs over is smaller.
 *
 * ### Why there is no hidden primitive to use instead
 *
 * Checked, because the command system looks like one. `command/types.ts`
 * describes an event-sourced log with a `SET_ATTRIBUTE` command, and
 * `Game.execute()` records each command with a pre-computed inverse. It is not
 * the mutation path: `game.ts:3532` states that direct tree mutations "are
 * recorded in neither commandHistory nor actionHistory", and the games mutate
 * by direct assignment throughout.
 *
 * Undo is not one either. `snapshot.ts`: "Each checkpoint is a full copy of the
 * element tree." An `ActionCheckpoint` carries a whole tree, the flow position,
 * the RNG state and a message watermark. Nothing anywhere records a per-write
 * delta.
 *
 * Diffing the world with `session/utils.ts:computeElementDiff` is the O(world)
 * re-read this contract exists to remove -- the 678 ms with a different name
 * on it. Recorded so it is not re-proposed.
 *
 * ### Why ABSENT and not STUBBED, which is the part that decides the design
 *
 * The obvious lazy tree -- children present but unhydrated, faulting in on
 * access -- does not work here, and the reason is measurable rather than
 * aesthetic. `GameElement.atId` is a full-tree DFS with NO ID INDEX
 * (`game-element.ts:310-317`), and every command path resolves ids through it;
 * the finders recurse `_t.children` eagerly too. So the FIRST `getElementById`
 * of any command would fault in the entire world, and laziness would buy
 * nothing.
 *
 * With absence instead, `atId`, `all()` and `toJSON` all cost O(loaded) with
 * ZERO changes to traversal. That is the whole trick: the expensive property of
 * the tree is left alone rather than fought.
 *
 * The price is a real semantic one and must be documented for authors: a global
 * query in world mode sees only RESIDENT elements. It is small in practice --
 * across `sotf` and `lanternfall` there are three `game.all(...)` calls in
 * rules code -- and world mode is new code written against the rule. Published
 * board games run the untouched snapshot mode and feel none of it.
 *
 * ### The two lines that are still engine work
 *
 * `moveToInternal` (`game-element.ts:488-498`) is "the one shared
 * implementation of physically re-parenting an element", used by
 * `Piece.putInto`/`remove`, `Space.reparent`/`remove` and the command
 * executor's MOVE/REMOVE. Both endpoints of a move must mark their partition
 * there, because a cross-partition move dirties a destination this command's
 * reads never hydrated -- the room a thrown object lands in.
 *
 * ### The overcount, and the optimisation that answers it
 *
 * A partition merely READ is reported dirty. The overcount is bounded by what
 * the command touched, so it is still O(room), and a resident DO amortises it:
 * an already-hydrated partition stays hydrated. If it ever matters, the fix is
 * PLATFORM-SIDE -- hash the serialized output and skip the storage write when
 * it is unchanged. That is the "later optimisation" slot the write barrier used
 * to occupy, and unlike the barrier it cannot be wrong.
 *
 * ### ELEMENT REFERENCES ARE POSITIONAL, AND ABSENCE BREAKS THEM
 *
 * Found while surveying the restore path, and it decides part of the design
 * rather than merely complicating it. An element attribute holding another
 * element does NOT serialize as that element's id. `serializeValue` emits
 * `{ __elementRef: value.branch() }` (`game-element.ts:1034`), and `branch()`
 * (`:275-287`) is a `/`-joined chain of `parent._t.children.indexOf(current)`
 * walked from the ROOT. `atBranch` (`:292-305`) indexes straight back down it.
 *
 * Every index in that path is a position among SIBLINGS THAT ARE PRESENT. Under
 * absent-until-loaded, an unloaded partition is not in the tree, so its former
 * siblings close ranks and every index after it shifts. A branch path recorded
 * against the full world therefore resolves, against a partial one, to a
 * DIFFERENT element -- or to `undefined` when it runs off the end. The failure
 * is silent in the first case, which is the dangerous one: a reference that
 * still points at something is not obviously broken.
 *
 * The engine already has the position-independent form and it is a one-word
 * difference: `{ __elementId: n }` (`game-element.ts:1156`), resolved through
 * `getElementById`. An id survives absence because it never described where the
 * element sat. World mode must serialize refs that way.
 *
 * This is not a reason to abandon absent-until-loaded. It is the price stated
 * plainly, next to the other one (a global query sees only resident elements),
 * so that `adoptSubtree` is written knowing it. Note the cost is real: id
 * resolution goes through `atId`'s un-indexed DFS, which is O(loaded) rather
 * than the branch path's O(depth). O(loaded) is the budget this whole mode is
 * written to, so it is affordable here and would not have been in a whole-world
 * tree -- which is the same reason absence works at all.
 *
 * ### ADOPTED IDS MUST ADVANCE THE SEQUENCE COUNTER
 *
 * `_ctx.sequence` is a bare counter, not a registry: `GameElement`'s
 * constructor takes `this._ctx.sequence++` (`:210-229`), and `fromJSON` then
 * OVERWRITES that with `json.id`. So grafting a subtree installs ids the
 * counter has never issued and does not know about. A later `create()` in the
 * same world mints an id that collides with an adopted element, and `atId`
 * returns whichever it reaches first.
 *
 * `adoptSubtree` must therefore raise `_ctx.sequence` to
 * `max(sequence, maxAdoptedId + 1)`. Whole-game restore never needed this
 * because it replaced the tree and the counter together.
 *
 * ### First implementation step
 *
 * In BoardSmith: `Game.adoptSubtree(parentId, json)` and
 * `Game.evictSubtree(id)`, grafting and removing one serialized subtree through
 * the existing element-restore path, plus the `moveToInternal` marking. Then a
 * `BoardSmithWorldEngine` here whose `applyCommand` is: ensure the named
 * partitions are loaded, run the action, answer `dirty` as loaded-or-touched.
 * The conformance suite's "a command that touches ONE thing does not dirty
 * everything" is the case that proves the model.
  */

import type { ScheduleAllowance, ScheduleRequest } from "./schedule-api.js";
// TYPE ONLY. A world's offer IS the table's action metadata (#169) -- one
// shape, so the shared action panel and board bridge read a world's answer
// with no translation -- and a type import keeps `boardsmith/world` free of a
// runtime dependency on the session layer.
import type { ActionMetadata } from "../session/types.js";


/**
 * WHAT ONE SEAT MAY DO HERE, ONE ACTION AT A TIME (#169).
 *
 * The world's answer to "what can I do?", and it is the TABLE'S OWN
 * `ActionMetadata` -- the same shape the shared action panel, the board bridge
 * and the drag-drop targets already consume, so a world's surface is the shell
 * rather than something written beside it.
 *
 * It replaces `WorldCommandOffer`, which was a parallel vocabulary invented
 * because a world's verbs were not Actions: it could say `tend` exists and that
 * it wants a holding, and the only holdings it could name were all five hundred
 * of them, because a bundle can state what a world CONTAINS and not what is
 * legal this instant. An enumerated offer answers the second question, which is
 * the one a player is actually asking.
 *
 * ITS CANDIDATES ARE ALREADY RESOLVED. A table fetches each pick's choices on
 * demand, because a table's protocol is step-wise; a world's is single-shot, so
 * an offer carries `selections[i].choices` / `.validElements` filled in. That is
 * affordable exactly because a world action may not declare a dependent
 * selection -- see `assertWorldAction` -- so no selection's candidates are a
 * function of another's value and the whole offer is one pass.
 */
export interface WorldActionOffer extends ActionMetadata {
  /**
   * Why this action is offered but cannot be taken right now.
   *
   * Absent when it can. A world uses the engine's own `.disabled()` channel
   * rather than a refusal thrown from inside the rules, so a neighbour at full
   * growth is greyed with a reason instead of accepting the click and refusing
   * it afterwards.
   */
  readonly disabled?: string;
}

/**
 * WHAT THE HOST KNOWS AT THE MOMENT IT ASKS FOR AN OFFER.
 *
 * The same two facts a command's stamp carries, and for the same reason: time
 * and presence live outside the world, so they arrive as arguments. An offer
 * needs them because a condition may legitimately ask whether a timer has come
 * due or whether anybody is watching, and a world that read a clock would
 * compute a different offer depending on how busy its host was.
 */
export interface WorldOfferStamp {
  readonly now: number;
  readonly presence: readonly number[];
}

/** A command as the platform hands it to the engine: opaque, ~100 bytes. */
export interface WorldCommand {
  readonly name: string;
  /** The game's own payload. The platform never parses inside it. */
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * Something that happened, addressed to the part of the world that can see it.
 *
 * `scope` is what makes a broadcast cost O(room) rather than O(world): the
 * platform routes on it and never reads `payload`. A game expresses
 * co-location by giving two players the same scope, which is the same shape
 * `session-chat.ts`'s channel policy already uses for chat.
 *
 * THIS IS WHAT A HANDLER EMITS. What the ENGINE answers is a `RoutedEvent`
 * below, which is the same event with its audience resolved -- see #58.
 */
// Not exported because nothing outside this file needs the name: an engine
// produces one and the platform's router consumes it, and both reach it
// through `WorldCommandResult`. THAT IS ALL THE NON-EXPORT DOES. It used to
// claim it stopped a third party constructing an event the engine never
// emitted, which it never did: `RoutedEvent` extends this and IS exported, and
// TypeScript is structural, so an object literal of the right shape is a
// `WorldEvent` whether or not the name is reachable. What actually keeps an
// invented event out of a world is that the router only ever reads the ones a
// dispatch returned.
interface WorldEvent {
  readonly scope: string;
  readonly payload: unknown;
  /**
   * THE SENTENCE THE GAME WROTE, IF IT WROTE ONE (#186).
   *
   * `payload` is the board's and is read by nothing between the rules and the
   * game's own UI, so it cannot be what the shared shell's log renders -- a log
   * built out of it would print JSON, which is the debug console #170 removed.
   * This is the line itself, in the shape `GameHistory` already takes, carried
   * beside the payload rather than dug out of it.
   *
   * ABSENT MEANS SILENCE. Most events say nothing: they tell a board that
   * something moved, and the log stays as it was.
   */
  readonly text?: string;
  /** The line's kind, verbatim to `GameHistory` -- presentation only, and no
   *  layer between the rules and the shell reads it as a rule. */
  readonly type?: string;
}

/**
 * WHAT A WORLD SAYS, AS A GAME WRITES IT (#186).
 *
 * A bare string is the whole of the common case, so it is the whole of what a
 * game has to write; the object form exists for the one extra thing a table's
 * log already carries. Exactly `GameHistory`'s own shape, because a world's log
 * and a table's are the same log with two transports.
 */
export type WorldNarrationLine = string | { readonly text: string; readonly type?: string };

/**
 * ONE EVENT WITH ITS AUDIENCE ALREADY WORKED OUT (#58).
 *
 * The scope was carried and never read until 2026-08-28: `notify` serialized
 * one frame and sent it to every attached socket, so a whisper reached the
 * whole world verbatim and one player's action in one room cost 499 sends at
 * `convex/limits.ts:WORLD_MAX_PLAYERS`. The platform's own contract test
 * asserted only that the field EXISTED, next to a comment claiming "the
 * platform routes on it".
 *
 * `seats` is the routing, and the ENGINE resolves it because only the engine
 * knows what a scope means. The platform's side is a membership test against
 * the seat behind each attached socket, which is what makes a broadcast cost
 * what the audience costs.
 *
 * A SEAT AND NOT A PLAYER ID. The engine holds the roster as seats -- a seat is
 * where a player's holdings are -- and the parent is the only side that knows
 * which account is sitting in one. Answering account ids would make the engine
 * the second holder of a fact the parent owns.
 */
export interface RoutedEvent extends WorldEvent {
  readonly seats: readonly number[];
}

/**
 * What one command did.
 *
 * `dirty` is the set of partition ids whose serialized form changed. It is the
 * ENGINE's answer and not the platform's guess, because only the engine knows
 * what a command touched -- and a platform that had to diff the world to find
 * out would be paying the O(world) cost this whole interface removes.
 *
 * An empty `dirty` with a non-empty `events` is legal and normal: a command
 * that only tells people something changed nothing durable.
 */
export interface WorldCommandResult {
  readonly events: readonly RoutedEvent[];
  readonly dirty: readonly string[];
  /**
   * WHAT THE COMMAND ASKED THE PLATFORM TO WAKE FOR (#37 item 3, #56).
   *
   * A REQUEST and never an insertion, which is section 7's rule as a property
   * of the type rather than a check somewhere: the queue is a key in the
   * PARENT's storage, and a command runs in the child isolate, so the only
   * thing a handler can do is ask. The parent stamps the owner from the acting
   * player, enforces the cap and inserts -- "the abusive path cannot reach the
   * queue rather than failing a check".
   *
   * This is the channel `ctx.schedule()` rides home on. Without it the eager
   * half of the timer primitive could not be requested by any game at all: the
   * policy existed, the queue existed, the drain existed, and there was no seam
   * between them and a bundle.
   *
   * Empty is the normal case, and an empty `schedules` with a full `dirty` is
   * exactly the LAZY half of the same primitive -- a `completesAt` timestamp
   * that costs no wake.
   */
  readonly schedules: readonly ScheduleRequest[];
  /**
   * `"completed"` when this command DECLARED THE SEASON OVER, absent otherwise.
   *
   * ONE VALUE, and the narrowness is the anti-abuse rule rather than an
   * unfinished union. Section 8: "only the game may declare a completion. A
   * publisher ending a world is a cancellation, recorded with no evidence
   * either way" -- because if ending a world counted as completing it, a
   * publisher could end seasons on demand to harvest verification.
   *
   * Every OTHER ending in `convex/worldParkPolicy.ts:WorldEnding` is the
   * platform's own answer about a world that stopped: refusal-parked,
   * cancelled. This channel carries the single ending the
   * platform cannot observe from outside, which is a game reaching its own
   * conclusion.
   */
  readonly ending?: "completed";
}

/**
 * THE TWO FACTS ABOUT A COMMAND THAT ONLY THE PLATFORM HAS.
 *
 * Both are handed down rather than read, and for the same reason in each case:
 * the engine runs untrusted game code in a child isolate with no bindings, so
 * anything it could read for itself is either wrong or forgeable.
 */
export interface WorldCommandStamp {
  /**
   * THE PLATFORM'S STAMPED ARRIVAL INSTANT (#57, #88).
   *
   * The engine hands it to the handler as `ctx.now`. `Date.now()` inside the
   * isolate is the EXECUTION instant, not the arrival one, and the two diverge
   * exactly when the world is busy; `args` is the client's own frame, and a
   * player who could name the time would finish every timer the moment they
   * started it. So the correct clock is the reachable one, and the incorrect
   * ones are unreachable.
   */
  readonly now: number;
  /**
   * WHAT THE QUEUE ALREADY HOLDS for the acting player, and for this world.
   *
   * What `ctx.schedule()` refuses against, so a cap is hit at the offending
   * line -- inside the handler, where the rollback then leaves the world
   * unchanged -- rather than after the command has already run. The PARENT
   * stays the authority: it re-plans the returned requests before it writes
   * one, because the child is game code and may not be believed about a quota.
   *
   * One object rather than a number per cap, because there are four of them
   * now (#105) and a stamp that grew a field each time would be four numbers a
   * caller could transpose with no type error anywhere.
   */
  readonly allowance: ScheduleAllowance;
  /**
   * WHICH SEATS ARE CONNECTED AT THIS INSTANT (#144).
   *
   * The platform's connection-presence fact, handed down for the reason `now`
   * is: socket state lives on the parent -- the engine runs in a child isolate
   * that can see no socket -- so anything the engine said about who is here
   * would be either wrong or forgeable. PER SEAT, never per connection: a
   * player with two tabs is present once, and the engine holds the roster as
   * seats for the same reason `RoutedEvent.seats` does.
   *
   * DERIVED PER COMMAND AND NEVER STORED, which is what makes it honest
   * across a hibernation: the parent reads its attached sockets at the moment
   * of the call, so a world woken hours after parking is handed whoever is
   * actually there -- usually nobody -- rather than a persisted claim from
   * before the park. It is also what keeps it bounded: O(attached sockets),
   * no history, no storage key.
   *
   * WHAT IT MEANS, EXACTLY: this seat holds at least one open socket right
   * now. The platform does NOT distinguish "left" from "dropped and about to
   * reconnect" -- a game that wants durable consequences of leaving models
   * them as explicit state changed by commands.
   */
  readonly presence: readonly number[];
}

/**
 * THE PLATFORM FACTS THAT RIDE A SCHEDULED EVENT (#144).
 *
 * `WorldCommandStamp`'s counterpart for the clock's road. There is no `now`
 * on it: a scheduled event's clock is its own `due`, which `onEvent`'s timing
 * already carries, and a second copy would be a second source of truth.
 */
export interface WorldEventStamp {
  /**
   * What the queue holds for the WORLD ITSELF, for the same reason a player's
   * command carries theirs. A due event's own schedules are charged to the
   * world under a reserved owner -- the one path that can grow a queue with
   * nobody to bill -- so it is capped like everybody else.
   */
  readonly allowance: ScheduleAllowance;
  /**
   * Which seats are connected as this event runs -- `WorldCommandStamp`'s
   * field, on the clock's road, so the 03:00 raid handler can ask whether the
   * defender is watching. Derived at the drain, so an event that ran while
   * the world was empty is handed an empty list rather than a memory.
   */
  readonly presence: readonly number[];
}

/**
 * ONE PARTITION AS THE CHECKPOINT STORE HOLDS IT.
 *
 * `json` IS OPAQUE ON PURPOSE (#218). It is whatever the engine's own
 * serializer produced, and nothing on the platform's side of this boundary
 * reads inside it: the store round-trips it through `JSON.stringify`, the
 * parent ships it to the child, and the engine is the only thing that knows
 * what shape it is. Typing it as one engine's element JSON here is what made
 * this contract depend on that engine -- an implementation narrows it for its
 * own use, and the platform stays unable to look.
 */
export interface StoredPartition {
  /**
   * The id of the element this subtree hangs from. It is the platform's job
   * to record it, because the parent is outside the subtree and so is not in
   * the serialized bytes.
   */
  readonly parentId: number;
  /** The subtree, exactly as the engine's `serializePartitions` wrote it. */
  readonly json: unknown;
}

/**
 * Where partitions are read from.
 *
 * Read-only, and asynchronous because production storage is. Writing is not
 * here: the platform writes what `serializePartitions` hands it, at a
 * checkpoint, and an engine that could write behind the platform's back would
 * make the checkpoint's dirty set a lie.
 */
export interface WorldPartitionStore {
  read(name: string): Promise<StoredPartition | undefined>;
}

/**
 * Where the ENGINE reads partitions from, which is one thing more than a store.
 *
 * `forget` is the other half of letting go of a partition, and it belongs to
 * whoever supplied the bytes: the engine releases the live subtree, and the
 * source stops claiming it can answer for the name. Without the pairing, the
 * child's `declare` would subtract an evicted partition from what the parent
 * must send, and the engine -- asked to adopt from a source whose bytes were
 * dropped at adoption time -- would have nothing to adopt. The partition is
 * then neither resident nor obtainable, which is a world that has silently
 * lost a room.
 *
 * It is on the ENGINE's source rather than on the runner because the engine is
 * the side that decides to let go: `evict` is one caller and the #68 rollback
 * is the other, and a second caller is exactly how a paired operation comes
 * apart.
 *
 * The PARENT's `DurableObjectPartitionStore` is deliberately not one of these.
 * It is durable: there is nothing for it to forget, and the engine never reads
 * through it -- the child's inlined source is what it is handed.
 */
export interface WorldPartitionSource extends WorldPartitionStore {
  forget(name: string): void;
}

/**
 * A resident world engine.
 *
 * LONG-LIVED. One instance per world per Durable Object lifetime, holding the
 * world as live JS objects. Every method is called many times against the same
 * instance, which is the property the entire cost argument depends on and the
 * one the stateless executor cannot provide.
 */
export interface WorldEngine {
  /**
   * Apply one player's command.
   *
   * MUST NOT produce a snapshot, and must not accumulate applied-action
   * history. Both are the O(world) costs this mode exists to remove.
   *
   * `arrivedAt` is THE PLATFORM'S STAMPED ARRIVAL INSTANT, and it is an
   * argument rather than something the engine reads because the engine must
   * not be able to read it (#57). #35 is explicit that arrival and activity
   * timestamps are the platform's: game code sees execution time, not arrival
   * time, and the two diverge exactly when the world is busy. Handing it down
   * is also what makes the CORRECT clock the reachable one -- before this, the
   * only clock a handler could see was whatever the client put in `args`, and
   * a player who names the time can backdate every timer they start.
   */
  applyCommand(
    player: string,
    command: WorldCommand,
    stamp: WorldCommandStamp,
  ): Promise<WorldCommandResult>;

  /**
   * Admit a player to a world that is ALREADY RUNNING.
   *
   * The one roster operation a world needs and a table does not. A table's
   * seats are settled before its first move; a world's roster changes for as
   * long as the world lasts, and the platform learns of a new player at the
   * moment they attach -- long after the engine was built.
   *
   * Re-seating a player in the seat they already hold is FREE, because that is
   * what a reconnect looks like from here. Moving a seated player to a
   * different seat is a refusal: a seat is where a player's holdings are.
   */
  seat(player: string, seat: number): void;

  /**
   * Which partitions are resident, and when each was last NAMED by a command.
   *
   * What `world-eviction.ts:planEviction` reads. `lastUsed` is a monotonic
   * counter rather than a clock, so two commands in the same millisecond are
   * still ordered and a world's eviction behaviour does not depend on how fast
   * the machine happened to be running.
   *
   * NAMED, not written: what predicts a partition being needed again is a
   * command asking for it, reads included. A write-ordered policy would keep a
   * room nobody has entered resident because somebody moved a chair in it.
   */
  residency(): readonly { readonly name: string; readonly lastUsed: number }[];

  /**
   * Release these partitions from memory.
   *
   * SAFE ONLY IMMEDIATELY AFTER A CHECKPOINT, and the caller owns that pairing:
   * a partition evicted while dirty is not spilled to storage, it is DELETED,
   * and the next command adopts the last checkpointed bytes so the world
   * silently rolls back. `planEviction` returns `blocked` precisely so a caller
   * can tell "nothing to evict" from "checkpoint first".
   *
   * A name this engine does not hold is a NO-OP rather than a refusal. The list
   * comes from a residency snapshot taken a moment earlier, and routine
   * housekeeping must not be able to park a world.
   */
  evict(names: readonly string[]): void;

  /**
   * Apply one scheduled event that came due.
   *
   * Receives the event's SCHEDULED `due`, never the wall clock at execution --
   * `world-schedule.ts` computes it and the platform passes it through, so a
   * world that drained late produces the same state as one that drained on
   * time.
   *
   * `missedCount` is non-zero only for a COALESCED CATCH-UP, and it is how many
   * occurrences of a recurrence got no call of their own (#127). This call is
   * NOT one of them -- it is an occurrence that ran, carrying the ones that did
   * not -- so a handler integrates with `1 + timing.missedCount`. It is 0 on a
   * one-shot and on every real iteration, so a handler that ignores the field
   * is correct whenever nothing was missed.
   */
  onEvent(
    event: WorldCommand,
    timing: { readonly due: number; readonly missedCount: number },
    /** The platform facts this event runs under -- see `WorldEventStamp`. */
    stamp: WorldEventStamp,
  ): Promise<WorldCommandResult>;

  /**
   * WHICH PARTITIONS THIS PLAYER'S VIEW IS ABOUT (#95).
   *
   * The read path's half of `WorldCommandHandler.partitions(args)`, and the
   * reason it exists is that a world's partitions are ABSENT UNTIL LOADED: a
   * wake adopts the root and nothing else, and looking used to name nothing at
   * all. So the one case a visitor always hits first -- opening the page and
   * looking -- was exactly the case that loaded no world, and a settler saw an
   * empty object until they typed a command.
   *
   * IT LOADS NOTHING ITSELF, exactly as a command's `partitions` does not: the
   * platform reads this, loads what it names, and only then asks for the
   * projection. What it MAY read is what an earlier round of this same
   * declaration already loaded (#122) -- it is asked again with that resident,
   * so a view whose subject is decided by state can name an index and then name
   * the room the index points at. On the first round nothing is resident, which
   * is the state this was always answered in.
   *
   * Anything a game could only answer by looking at MORE than it declared is
   * `viewFor`'s business, not this one's.
   *
   * EMPTY IS A LEGAL ANSWER and means a view that needs nothing loaded -- a
   * world whose whole state lives on the root is a real world. What is NOT
   * legal is not having an answer: a game that never declared one and a game
   * that declared nothing would otherwise look identical from here, which is
   * how #95 stayed invisible for weeks.
   */
  viewPartitions(player: string): readonly string[];

  /**
   * WHICH PARTITIONS THIS COMMAND IS ABOUT, BEFORE IT RUNS (#121).
   *
   * `viewPartitions`' counterpart on the write path, and it exists on the
   * engine for the reason that one does: the ROSTER is the engine's. The
   * declaration used to be read straight off the bundle's command table by
   * `world-runner.ts`, which had a command and no player -- and that is
   * precisely why no world command could name the acting player's own
   * partition. A per-player world had to make every settler pass their own
   * holding as an argument with exactly one legal answer, and nothing told them
   * what it was.
   *
   * `player` is null for a scheduled event, which is the clock acting rather
   * than a seat.
   *
   * IT LOADS NOTHING ITSELF, exactly as `viewPartitions` does not: the platform
   * reads this, loads what it names, and only then applies. What it MAY read is
   * what an earlier round of this same declaration already loaded (#122) -- see
   * `hydrate` below, and `world-declaration.ts` for why the loop exists and what
   * bounds it.
   */
  commandPartitions(player: string | null, command: WorldCommand): readonly string[];

  /**
   * ADOPT THESE PARTITIONS, SO THE NEXT DECLARATION CAN READ THEM (#122).
   *
   * The one operation two-phase declaration needs and nothing else provides.
   * `commandPartitions` and `viewPartitions` are answered against what is
   * RESIDENT, and until this there was no way to make anything resident except
   * by applying a command -- which is the thing the declaration is deciding
   * whether to do.
   *
   * It runs no game code and writes nothing. What it changes is what is loaded,
   * which is not a change to the world: a command refused after this has still
   * touched nothing, and a partition adopted for a declaration that came to
   * nothing is cold by `residency`'s own ordering and is the first thing
   * evicted.
   */
  hydrate(names: readonly string[]): Promise<void>;

  /**
   * One player's view of the world.
   *
   * Per player and computed on demand, so a fan-out costs what each player can
   * see. Returning the whole world here would put the O(world) cost back in a
   * different place.
   *
   * Everything `viewPartitions` named for this player is RESIDENT by the time
   * this is called -- the platform loaded it -- so this projects rather than
   * fetches.
   *
   * AND IT MAY READ NOTHING ELSE (#126). What `viewPartitions` named is not
   * merely what is loaded, it is the whole of what this method is allowed to
   * look at: a resident world holds a deliberately partial tree, so anything
   * that walks past the named partitions is reaching for something that is
   * absent on purpose. That rules out the table's action space -- BoardSmith's
   * `createPlayerView` calls `getDisabledActions`, which evaluates every action
   * a bundle registered and the selection choices inside them -- and it was an
   * implementation of this method calling it that made the MUD example's world work
   * exactly once, in the instance where `world.genesis` happened to leave every
   * partition resident.
   *
   * A WORLD'S ACTIONS ARE `offersFor()`, which enumerates them under the
   * bounded contract `assertWorldAction` enforces. Its flow does not run. So
   * this returns STATE.
   */
  viewFor(player: string): Promise<unknown>;

  /**
   * WHAT THIS SEAT MAY DO HERE, ENUMERATED (#85, #91, #169).
   *
   * The NON-MUTATING half of the action protocol, and the reason a world had
   * none until #85: this interface had exactly one verb, `applyCommand`, so
   * nothing anywhere -- not the BoardSmith iframe, not a Shufflewick surface --
   * could present an action a player had not already been told the name of. A
   * world's UI was a watching surface because of this method's absence.
   *
   * It answered NAMES ONLY until #91 and then a static ARGUMENT DECLARATION,
   * which is why a 500-seat village put five hundred holdings on the wire for
   * every offer: the bundle could state what the world contains and not what
   * was legal this instant. Since #169 a world's verbs are Actions, so this
   * enumerates them FOR THIS SEAT -- the same question the shell asks a table,
   * answered by the same `getAvailableActions`, in the same `ActionMetadata`.
   *
   * PER SEAT, AND IT LOADS WHAT IT MUST. Enumeration walks each action's own
   * declaration and hydrates it, which for every catalogue game is a subset of
   * what that seat's `view` already names -- so in practice an offer costs
   * nothing beyond a look. Where it is not a subset, the author pays a
   * hydration per action per offer and should be told so; it is a fact about
   * the bundle's declaration and not about this method.
   *
   * SORTED BY NAME, so a client renders the same list twice and a test can
   * assert one.
   */
  offersFor(player: string, stamp: WorldOfferStamp): Promise<readonly WorldActionOffer[]>;

  /**
   * Which partitions an offer for this seat still needs, one round at a time.
   *
   * The read path's `commandPartitions`, and it exists because the engine names
   * and the HOST reads: a child isolate has no storage binding, so an offer's
   * declaration walk is driven from outside exactly as a command's is. Answer,
   * supply, ask again; the loop ends when this answers nothing, and it
   * terminates because every round it names becomes resident before it is asked
   * again.
   */
  offerPartitions(player: string): readonly string[];

  /**
   * Serialize exactly the named partitions.
   *
   * Called with a checkpoint's accumulated dirty set. An engine that serialized
   * everything regardless would satisfy the type and defeat the purpose, which
   * is why the conformance suite measures that the output shrinks with the
   * input rather than merely checking the shape.
   */
  serializePartitions(dirty: readonly string[]): Promise<Record<string, string>>;
}
