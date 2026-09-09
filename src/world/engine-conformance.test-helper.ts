// THE EXECUTABLE DEFINITION OF "THE ENGINE MODE IS DONE" (#35 item 2).
//
// The implementation is BoardSmith's; this is the platform's requirement of
// it, and having it as a runnable suite is what lets the two be built
// independently and still meet. Point it at any candidate:
//
//   describe("boardsmith world mode", () =>
//     assertWorldEngineConformance(() => new BoardSmithWorldEngine(...)));
//
// It deliberately tests the COST PROPERTIES and not just the shape. An engine
// that serialized the whole world on every checkpoint, or returned every
// player the same view, would satisfy the TypeScript interface completely
// while defeating the entire reason the mode exists -- so the cases below
// measure that output shrinks with input, which a type cannot express.
import { expect, it } from "vitest";
import type { WorldEngine } from "./contract.js";

/** Build a fresh engine holding at least the two named players and two
 *  partitions. The suite supplies nothing: how a world is constructed is the
 *  engine's business. */
type WorldEngineFactory = () => Promise<WorldEngine> | WorldEngine;

/** A stamped arrival instant. Every command carries one -- the PLATFORM's own,
 *  never the caller's (#57) -- so the suite hands one down exactly as the
 *  parent does. */
const STAMP = {
  now: 1_700_000_000_000,
  allowance: { unkeyed: 0, keys: [], worldPending: 0 },
  // Nobody connected: the platform's presence stamp is derived from attached
  // sockets, and this suite attaches none (#144).
  presence: [],
  /** Nobody has acted here before, and this world began watching at `now`
   *  (#383). The cases that are ABOUT a watermark name their own. */
  activity: { seat: 1, at: null, since: 1_700_000_000_000 },
};

const CONFORMANCE_PLAYERS = ["player-a", "player-b"] as const;

/**
 * Assert one candidate meets the contract. Call inside a `describe`.
 */
export function assertWorldEngineConformance(makeEngine: WorldEngineFactory): void {
  const [alice, bob] = CONFORMANCE_PLAYERS;

  it("applyCommand reports what changed, not a snapshot", async () => {
    // The single most important property. Returning the world would put the
    // O(world) cost straight back, which is the thing #35 measured at 678ms.
    const engine = await makeEngine();
    const result = await engine.applyCommand(alice, { name: "touch", args: {} }, STAMP);

    expect(Array.isArray(result.events)).toBe(true);
    expect(Array.isArray(result.dirty)).toBe(true);
    // A dirty set is partition IDS, not partitions -- if it carried content it
    // would be a snapshot wearing a different name.
    for (const id of result.dirty) expect(typeof id).toBe("string");
  });

  it("a command that touches ONE thing does not dirty everything", async () => {
    // The scaling claim, measured. An engine that returned every partition
    // here would typecheck perfectly and cost O(world) per action.
    const engine = await makeEngine();
    const all = await engine.serializePartitions(
      (await engine.applyCommand(alice, { name: "touchAll", args: {} }, STAMP)).dirty,
    );
    const one = await engine.applyCommand(alice, { name: "touch", args: {} }, STAMP);

    expect(one.dirty.length).toBeLessThan(Math.max(Object.keys(all).length, 2));
  });

  it("serializePartitions returns ONLY what was asked for", async () => {
    // The checkpoint cost. An engine ignoring the argument would satisfy the
    // type and re-serialize the world on every checkpoint.
    const engine = await makeEngine();
    const { dirty } = await engine.applyCommand(alice, { name: "touch", args: {} }, STAMP);
    const written = await engine.serializePartitions(dirty);

    expect(Object.keys(written).sort()).toEqual([...dirty].sort());
  });

  it("serializing NOTHING writes nothing", async () => {
    // A command that changed no durable state must cost no checkpoint bytes --
    // the boundary case an engine that always serializes gets wrong.
    const engine = await makeEngine();
    expect(await engine.serializePartitions([])).toEqual({});
  });

  it("SAYS WHAT A VIEW IS ABOUT, WITHOUT LOADING ANYTHING (#95)", async () => {
    // The read path's `partitions()`, and the case that proves an engine has
    // one. A world's partitions are ABSENT UNTIL LOADED, so a view that named
    // nothing projected whatever a wake happened to have adopted -- the root --
    // and a player who had only looked saw an empty world until they acted.
    //
    // ANSWERED WITHOUT LOADING, which is what the platform depends on: it calls
    // this while the world is still absent, reads what it names out of storage
    // and only then asks for the projection. An engine that consulted its own
    // tree here would be answering in the one condition the question exists for.
    const engine = await makeEngine();
    const resident = engine.residency().map(({ name }) => name).sort();
    const named = engine.viewPartitions(alice);

    expect(Array.isArray(named)).toBe(true);
    // ASKING LOADED NOTHING. The residency is exactly what it was, which is the
    // half of the claim a type cannot make.
    expect(engine.residency().map(({ name }) => name).sort()).toEqual(resident);
    // The SAME answer twice: a declaration is a property of the seat, not of
    // whatever the world happened to be doing the first time it was asked.
    expect([...engine.viewPartitions(alice)]).toEqual([...named]);
  });

  it("SAYS WHAT A COMMAND IS ABOUT, ONE ROUND AT A TIME, FOR A PLAYER AND FOR THE CLOCK (#121, #169)", async () => {
    // The write path's half of the same declaration, and it takes the ACTING
    // PLAYER -- which is the whole of #121. Before it, `partitions` was
    // answered from the arguments alone, so no command could name "my own
    // holding" and a per-player world had to make every player pass their own
    // partition as an argument with exactly one legal answer.
    //
    // The seat is a fact the ENGINE already holds -- it owns the roster -- so
    // nothing about absent-until-loaded changes: this is still answered with no
    // partition loaded and no world to consult, which is the property asserted
    // below rather than assumed.
    //
    // SINCE #169 IT ANSWERS THE NEXT UNMET ROUND, not the whole declaration. A
    // world's verbs are Actions, and an action is a SEQUENCE, so its
    // declaration is an ordered walk -- round one, then each selection's own
    // round, then the execute round -- and a later round is allowed to read
    // what an earlier one loaded. The host therefore drives it as a loop: ask,
    // supply, ask again, ending when it answers nothing. That loop terminates
    // because the walk has one round per step and every round it names becomes
    // resident before it is asked again, which is what replaced the fixpoint's
    // ceiling on this road.
    const engine = await makeEngine();
    const resident = engine.residency().map(({ name }) => name).sort();
    const command = { name: "touch", args: {} };

    const named = engine.commandPartitions(alice, command, STAMP.now);
    expect(Array.isArray(named)).toBe(true);
    expect(engine.residency().map(({ name }) => name).sort()).toEqual(resident);

    // THE LOOP ENDS. Driven exactly as a host drives it -- and an engine that
    // kept naming a partition it had just been handed would hang here rather
    // than passing quietly, which is the property the ceiling used to buy.
    const walked = new Set<string>(named);
    for (let round = 0; ; round++) {
      const needs = engine.commandPartitions(alice, command, STAMP.now);
      if (needs.length === 0) break;
      expect(round, "a command's declaration walk did not end").toBeLessThan(16);
      for (const name of needs) walked.add(name);
      await engine.hydrate(needs);
    }

    // EVERYTHING IT NAMED IS WHAT THE COMMAND THEN DIRTIES. The platform loads
    // this set and no other, so a declaration narrower than the command's reach
    // is a partition the handler will find absent.
    const applied = await engine.applyCommand(alice, command, STAMP);
    for (const name of walked) expect(applied.dirty).toContain(name);

    // AND THE CLOCK IS NOT A CALLER FOR THIS ONE. `touch` acts for a seat, and
    // a scheduled event has no seat -- so `null` is refused here BY NAME rather
    // than reaching `player.seat` on nothing and answering with a TypeError out
    // of game code. The clock's own verbs are seatless, and `worldClockAction()` is
    // enforced on BOTH roads` below is where the pair is asserted.
    expect(() => engine.commandPartitions(null, command, STAMP.now)).toThrow(/no player/);
  });

  it("viewFor is PER PLAYER", async () => {
    // Fog of war is the default in a world. Two players receiving the same
    // object means the engine is handing out the world.
    const engine = await makeEngine();
    const seen = JSON.stringify(await engine.viewFor(alice));
    const other = JSON.stringify(await engine.viewFor(bob));

    expect(seen).not.toEqual(other);
  });

  it("viewsFor answers a whole audience what viewFor answers each of them (ShufflewickPub #408)", async () => {
    // The batch exists to spend the seat-INDEPENDENT half of a projection once
    // for a fan-out, and an engine that shared a seat-dependent half as well
    // would satisfy the type perfectly while showing one watcher another's
    // world. So the two roads are held against each other on the same world:
    // whatever an engine saves, the audience's answers are the answers asking
    // one at a time gives.
    const apart = await makeEngine();
    const one = JSON.stringify(await apart.viewFor(alice));
    const two = JSON.stringify(await apart.viewFor(bob));

    const together = await makeEngine();
    const audience = await together.viewsFor([alice, bob]);

    expect(audience.map((seat) => seat.player)).toEqual([alice, bob]);
    expect(audience.map((seat) => seat.refused)).toEqual([false, false]);
    expect(audience.map((seat) => JSON.stringify(seat.refused ? null : seat.view))).toEqual([
      one,
      two,
    ]);
  });

  it("viewsFor refuses the seat that cannot be described and answers the rest", async () => {
    // A view can throw for one player while every other view in the batch is
    // computable, so a batch that failed whole would make one absent partition
    // everybody's problem. The stranger is the reachable case: an engine seats
    // who it seats, and every one of them refuses a player it does not hold.
    const engine = await makeEngine();

    const audience = await engine.viewsFor([alice, "nobody-at-all"]);

    expect(audience.map((seat) => seat.player)).toEqual([alice, "nobody-at-all"]);
    expect(audience.map((seat) => seat.refused)).toEqual([false, true]);
  });

  it("OFFERS THIS SEAT'S ACTIONS, candidates and all, without applying anything (#85, #91, #169)", async () => {
    // The non-mutating half of the action protocol. Until it existed nothing
    // could present a world's action to a player who did not already know its
    // name, which is why a world's UI was a watching surface.
    //
    // IT ENUMERATES NOW, and that is what #169 changed. `commandOffers()`
    // answered from the bundle's own STATIC declaration and loaded nothing: it
    // could say `tend` exists and wants a holding, and the only holdings it
    // could name were all five hundred, because a bundle can state what a world
    // CONTAINS and not what is legal this instant. `offersFor` is per seat, per
    // instant, in the table's own `ActionMetadata`, with each selection's
    // candidates already resolved -- so the shared action panel and the board
    // bridge read a world's answer with no translation at all.
    //
    // AN OFFER LOADS WHAT IT MUST, so it is asynchronous and it is driven
    // through the same declare-then-supply loop a command is: `offerPartitions`
    // names the first unmet round of every action the seat could be given, the
    // host supplies it, and the loop ends when nothing is left.
    const engine = await makeEngine();
    const before = JSON.stringify(await engine.viewFor(alice));

    for (let round = 0; ; round++) {
      const needs = engine.offerPartitions(alice, STAMP.now);
      if (needs.length === 0) break;
      expect(round, "an offer's declaration walk did not end").toBeLessThan(16);
      await engine.hydrate(needs);
    }

    const offers = await engine.offersFor(alice, {
      now: STAMP.now,
      presence: [],
      activity: STAMP.activity,
      activity: STAMP.activity,
    });
    expect(offers.length).toBeGreaterThan(0);
    // SORTED BY NAME, so a client renders the same list twice: registration
    // order is an implementation detail of whichever list the bundle wrote.
    const names = offers.map((offer) => offer.name);
    expect([...names]).toEqual([...names].sort());

    let questionsAsked = 0;
    for (const offer of offers) {
      expect(offer.name).not.toBe("");
      expect(Array.isArray(offer.selections)).toBe(true);
      // A GREYED ACTION SAYS WHY. `disabled` is a REASON and never a boolean,
      // because an offered-but-untakeable button with no explanation is the
      // thing the channel exists to prevent -- the alternative being a world
      // that accepts the click and refuses it afterwards.
      if (offer.disabled !== undefined) expect(offer.disabled.length).toBeGreaterThan(0);

      for (const pick of offer.selections) {
        questionsAsked += 1;
        expect(pick.name).not.toBe("");
        expect(["choice", "element", "elements", "number", "text"]).toContain(pick.type);
        // THE CANDIDATES ARRIVE WITH THE OFFER. A table fetches a pick's
        // choices on demand because a table's protocol is step-wise; a world's
        // is single-shot, so an engine that answered a bare pick shape would
        // leave the platform with nothing to draw but the JSON box #91 removed.
        // It is affordable exactly because a world action may not declare a
        // dependent selection, so no selection's candidates are a function of
        // another's value.
        if (pick.type === "choice") {
          expect(Array.isArray(pick.choices)).toBe(true);
          expect(pick.choices!.length).toBeGreaterThan(0);
        }
        if (pick.type === "element" || pick.type === "elements") {
          expect(Array.isArray(pick.validElements)).toBe(true);
          expect(pick.validElements!.length).toBeGreaterThan(0);
        }
      }
    }
    // AND AT LEAST ONE OF THEM ASKS SOMETHING. Every assertion above is vacuous
    // for a world whose every verb is a bare button, so a candidate engine has
    // to offer one real question for this case to mean anything at all.
    expect(questionsAsked).toBeGreaterThan(0);

    // Asking is not acting.
    expect(JSON.stringify(await engine.viewFor(alice))).toEqual(before);
  });

  it("onEvent runs at its SCHEDULED due, not the wall clock", async () => {
    // A world that drained late must produce the same state as one that
    // drained on time -- the reason world-schedule.ts computes `due` and the
    // platform passes it through rather than the engine reading a clock.
    const engine = await makeEngine();
    const early = await engine.onEvent(
      { name: "tick", args: {} },
      { due: 1_000, missedCount: 0 },
      { allowance: { unkeyed: 0, keys: [], worldPending: 0 }, presence: [], activity: null },
    );
    const late = await engine.onEvent(
      { name: "tick", args: {} },
      { due: 1_000, missedCount: 0 },
      { allowance: { unkeyed: 0, keys: [], worldPending: 0 }, presence: [], activity: null },
    );

    expect(late.events).toEqual(early.events);
  });

  it("onEvent accepts a COALESCED catch-up rather than demanding a replay", async () => {
    // #35: "Catch-up integrates rather than replays." An engine that could
    // only be driven one occurrence at a time would force the platform to run
    // 72 iterations for three missed days.
    //
    // WHAT A CANDIDATE MUST SUPPLY (#210): a `tick` whose RESULT reflects the
    // timing it was handed. Without that this obligation has no observable at
    // all, and the case degenerates into asserting that a result carries an
    // events array -- which every engine satisfies, including one that drops
    // `missedCount` on the floor and demands exactly the replay this title
    // forbids. The two engines this suite runs against both answer `tick` with
    // its own `due` and `missedCount`, which is the cheapest honest way to
    // make the fold visible from outside.
    const eventStamp = {
      allowance: { unkeyed: 0, keys: [], worldPending: 0 },
      presence: [],
      activity: STAMP.activity,
    };
    // Two FRESH worlds, so the only difference between the two answers is the
    // catch-up itself and not the order the suite drove them in.
    const single = await (await makeEngine()).onEvent(
      { name: "tick", args: {} },
      { due: 5_000, missedCount: 0 },
      eventStamp,
    );
    const coalesced = await (await makeEngine()).onEvent(
      { name: "tick", args: {} },
      { due: 5_000, missedCount: 68 },
      eventStamp,
    );

    // THE FOLD REACHED THE HANDLER. Same event, same due, same fresh world:
    // the 68 missed occurrences are the one thing that differs, so an engine
    // whose answer is unchanged never saw them.
    expect(JSON.stringify(coalesced.events)).not.toEqual(
      JSON.stringify(single.events),
    );

    // AND IT WAS INTEGRATED IN ONE PASS. The catch-up costs O(1) in the number
    // of missed occurrences -- one call in, one occurrence's worth of output
    // back. An engine that looped internally would answer 69 events here,
    // which is the same 69 iterations moved one layer down and none of the
    // saving the mode exists for.
    expect(coalesced.events.length).toBe(single.events.length);
  });

  it("SEATS A PLAYER WHO ARRIVES AFTER THE WORLD IS RUNNING", async () => {
    // The one roster property a world needs and a table does not. A player who
    // joins in week three attaches to an engine resident since week one, and
    // rebuilding it to admit them would evict everything in it -- the exact
    // cost this mode exists to avoid.
    const engine = await makeEngine();
    const latecomer = "player-c";

    await expect(
      engine.applyCommand(latecomer, { name: "touch", args: {} }, STAMP),
    ).rejects.toThrow();

    engine.seat(latecomer, 3);
    const result = await engine.applyCommand(latecomer, { name: "touch", args: {} }, STAMP);
    expect(Array.isArray(result.dirty)).toBe(true);
  });

  it("re-seating a player in the seat they already hold is free; moving them is refused", async () => {
    // A reconnect looks exactly like a re-seat from here, so it must cost
    // nothing. A MOVE is a different event: a seat is where a player's
    // holdings are, and accepting one silently would hand somebody another
    // person's.
    const engine = await makeEngine();
    engine.seat("player-d", 4);
    expect(() => engine.seat("player-d", 4)).not.toThrow();
    expect(() => engine.seat("player-d", 5)).toThrow();
  });

  it("reports NO ending for a command that did not declare one", async () => {
    // Silence is the default, and it must be, because the platform settles a
    // season on the strength of this field. An engine that reported an ending
    // on every command would settle one per move.
    const engine = await makeEngine();
    const result = await engine.applyCommand(alice, { name: "touch", args: {} }, STAMP);
    expect(result.ending).toBeUndefined();
  });

  it("reports residency in a form eviction can order", async () => {
    // `planEviction` needs two things from every resident partition: its name,
    // and a comparable stamp for when it was last needed. A clock would not do
    // -- two commands in the same millisecond must still be ordered.
    const engine = await makeEngine();
    await engine.applyCommand(alice, { name: "touch", args: {} }, STAMP);

    const residency = engine.residency();
    expect(residency.length).toBeGreaterThan(0);
    for (const partition of residency) {
      expect(typeof partition.name).toBe("string");
      expect(typeof partition.lastUsed).toBe("number");
    }
  });

  it("evicts what it is asked to, and ignores what it does not hold", async () => {
    // Both halves matter. Releasing residency is the point; tolerating a name
    // it never had is what stops a routine housekeeping pass -- whose list came
    // from a snapshot taken a moment earlier -- from parking a world.
    const engine = await makeEngine();
    await engine.applyCommand(alice, { name: "touch", args: {} }, STAMP);

    const held = engine.residency().map((p) => p.name);
    engine.evict(held);
    expect(engine.residency().map((p) => p.name)).toEqual([]);

    expect(() => engine.evict(["nothing:here"])).not.toThrow();
  });

  it("holds state ACROSS commands -- it is a resident instance, not a function", async () => {
    // The property the stateless executor cannot provide, and the one the
    // whole architecture replacement is for.
    const engine = await makeEngine();
    const before = JSON.stringify(await engine.viewFor(alice));
    await engine.applyCommand(alice, { name: "touch", args: {} }, STAMP);
    const after = JSON.stringify(await engine.viewFor(alice));

    expect(after).not.toEqual(before);
  });
}
