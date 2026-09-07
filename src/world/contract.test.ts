// The conformance suite, run against a REFERENCE engine.
//
// Without this the suite would be a wish: a set of assertions nobody had ever
// seen pass, which is indistinguishable from a set that cannot pass. The
// reference is the smallest thing that satisfies the contract honestly -- it
// really does track dirty partitions, really does give two players different
// views, and really does hold state across commands.
//
// It is NOT the engine mode and must never become it. #35 item 2's
// implementation is BoardSmith's, with partitioned subtree serialisation over
// a real element tree. This exists so that implementation has something to be
// checked against, and so the check itself is known to work.
import { describe } from "vitest";
import { assertWorldEngineConformance } from "./engine-conformance.test-helper.js";
import type {
  WorldActionOffer,
  WorldCommand,
  WorldCommandResult,
  WorldCommandStamp,
  WorldEngine,
  WorldEventStamp,
  WorldOfferStamp,
} from "./contract.js";

/** Two partitions, so "only what was asked for" is a distinguishable claim. */
const PARTITIONS = ["room:1", "room:2"] as const;

/** The verbs in this reference world the CLOCK may run, which is none of them:
 *  every one acts for a seat. A world with a seatless verb would name it here,
 *  and the real engine reads the same fact off `ActionDefinition.world.seatless`. */
const CLOCK_COMMANDS = new Set<string>();

class ReferenceWorldEngine implements WorldEngine {
  /** Live JS objects for the life of the instance -- the resident property. */
  private readonly touches = new Map<string, number>(
    PARTITIONS.map((id) => [id, 0]),
  );
  private readonly seen = new Map<string, number>();
  /** The roster the suite is promised: the two named players, seated. */
  private readonly seats = new Map<string, number>([
    ["player-a", 1],
    ["player-b", 2],
  ]);

  /** Adopted names, in the order a command last touched them. The reference
   *  world has no tree, so residency is exactly this set. */
  private readonly resident = new Map<string, number>();
  private useClock = 0;

  residency(): readonly { readonly name: string; readonly lastUsed: number }[] {
    return [...this.resident].map(([name, lastUsed]) => ({ name, lastUsed }));
  }

  evict(names: readonly string[]): void {
    // Silent on a name it does not hold, which is the contract: the list comes
    // from a snapshot the caller took a moment earlier.
    for (const name of names) this.resident.delete(name);
  }

  seat(player: string, seat: number): void {
    const held = this.seats.get(player);
    if (held !== undefined && held !== seat) {
      throw new Error(`${player} already plays seat ${held}.`);
    }
    this.seats.set(player, seat);
  }

  async applyCommand(
    player: string,
    command: WorldCommand,
    _stamp: WorldCommandStamp,
  ): Promise<WorldCommandResult> {
    // A stranger is refused rather than seated by acting. Admission and action
    // are different events, and an engine that conflated them would let any
    // command name its own player.
    if (!this.seats.has(player)) {
      throw new Error(`"${player}" is not in this world.`);
    }
    this.seen.set(player, (this.seen.get(player) ?? 0) + 1);
    const dirty =
      command.name === "touchAll" ? [...PARTITIONS] : [PARTITIONS[0]];
    this.useClock += 1;
    for (const id of dirty) {
      this.touches.set(id, (this.touches.get(id) ?? 0) + 1);
      this.resident.set(id, this.useClock);
    }
    return {
      events: [{ scope: dirty[0]!, payload: { by: player }, seats: [1] }],
      dirty,
      // A reference engine that never schedules anything is still obliged to
      // say so: the channel is part of the result, not an optional extra a
      // caller has to guess the absence of (#56).
      schedules: [],
    };
  }

  async onEvent(
    event: WorldCommand,
    timing: { due: number; missedCount: number },
    _stamp: WorldEventStamp,
  ): Promise<WorldCommandResult> {
    // Derived from `due` and never from a clock, which is the property the
    // conformance case checks by calling twice with the same due.
    return {
      events: [{ scope: "world", payload: { at: timing.due, folded: timing.missedCount }, seats: [1] }],
      dirty: [],
      schedules: [],
    };
  }

  commandPartitions(player: string | null, command: WorldCommand): readonly string[] {
    // WHAT A COMMAND IS ABOUT (#121), answered from the acting seat and the
    // arguments -- never from the world, which is still absent when the
    // platform asks. `touchAll` is the case that names more than one; a
    // player's own room is the case that could not be expressed at all before
    // the seat reached this method.
    //
    // THE NEXT UNMET ROUND, NOT THE WHOLE DECLARATION (#169). The host drives
    // this as a loop -- ask, supply, ask again -- so an engine that kept
    // answering what it had just been handed would never let the loop end. The
    // reference world has one round and no steps, so subtracting what is
    // already resident is the whole of its walk.
    if (player !== null && !this.seats.has(player)) {
      throw new Error(`"${player}" is not in this world.`);
    }
    // AND THE CLOCK MAY NOT ISSUE A SEAT'S VERB (#169). Every verb this
    // reference world has acts for a seat, so a null player is refused by name
    // rather than reaching for a seat that does not exist. The real engine
    // refuses it on the same road, from `seatless`.
    if (player === null && !CLOCK_COMMANDS.has(command.name)) {
      throw new Error(
        `A scheduled event named "${command.name}", which acts for a player, and a due event has ` +
          "no player.",
      );
    }
    const about = command.name === "touchAll" ? [...PARTITIONS] : [PARTITIONS[0]];
    return about.filter((name) => !this.resident.has(name));
  }

  /**
   * The reference world has no tree, so there is no element to hand a
   * migration -- and a conformance engine is asked to have the METHOD, not to
   * have a world in it (#200).
   */
  migratePartition(): void {
    throw new Error("the reference world holds no elements to migrate");
  }

  async hydrate(names: readonly string[]): Promise<void> {
    // ADOPTION AND NOTHING ELSE (#122). The reference world has no tree, so
    // residency IS the resident set -- and a declaration asked a second time
    // has to be able to see what the first round loaded.
    this.useClock += 1;
    for (const name of names) this.resident.set(name, this.useClock);
  }

  viewPartitions(_player: string): readonly string[] {
    // WHAT A LOOK IS ABOUT (#95), answered from the declaration and not from
    // the world -- the platform reads this while the world is still absent, so
    // an engine that consulted its own state here would be answering the
    // question in the one condition it exists for.
    return [PARTITIONS[0]];
  }

  async viewFor(player: string): Promise<unknown> {
    // Per player, and it must genuinely differ -- a view keyed only on world
    // state would pass the type and fail the contract.
    return { you: player, acted: this.seen.get(player) ?? 0 };
  }

  offerPartitions(_player: string): readonly string[] {
    // NOTHING TO LOAD. The reference world holds counters rather than a tree,
    // so every candidate it can name is already in hand -- which is a real
    // shape and the one an engine has to answer honestly rather than by
    // returning something so the loop looks driven. An empty first answer ends
    // the host's walk immediately, exactly as a warm world's does.
    return [];
  }

  async offersFor(
    _player: string,
    _stamp: WorldOfferStamp,
  ): Promise<readonly WorldActionOffer[]> {
    // Sorted by name, which is the contract: a client renders the same list
    // twice. `touch` asks WHICH ROOM, with its candidates already resolved --
    // a table fetches a pick's choices on demand, a world's protocol is
    // single-shot, so the offer carries them. `wait` asks nothing, which is
    // also a real shape and is declared as one (#91).
    //
    // The shape is the TABLE'S OWN `ActionMetadata`, and that is the whole of
    // what #169 did to this method: a world's verbs are Actions, so there is no
    // second vocabulary here for the platform to translate.
    return [
      {
        name: "touch",
        prompt: "Touch a room",
        selections: [
          {
            name: "room",
            type: "choice",
            prompt: "Which room?",
            choices: [
              { value: "room:1", display: "Room 1" },
              { value: "room:2", display: "Room 2" },
            ],
          },
        ],
      },
      { name: "wait", selections: [] },
    ];
  }

  async serializePartitions(dirty: readonly string[]): Promise<Record<string, string>> {
    return Object.fromEntries(
      dirty.map((id) => [id, JSON.stringify({ touches: this.touches.get(id) ?? 0 })]),
    );
  }
}

describe("WorldEngine conformance — the reference engine", () => {
  assertWorldEngineConformance(() => new ReferenceWorldEngine());
});
