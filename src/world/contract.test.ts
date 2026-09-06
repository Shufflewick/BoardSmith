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
  WorldCommand,
  WorldCommandOffer,
  WorldCommandResult,
  WorldCommandStamp,
  WorldEngine,
  WorldEventStamp,
} from "./contract.js";

/** Two partitions, so "only what was asked for" is a distinguishable claim. */
const PARTITIONS = ["room:1", "room:2"] as const;

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
    if (player !== null && !this.seats.has(player)) {
      throw new Error(`"${player}" is not in this world.`);
    }
    return command.name === "touchAll" ? [...PARTITIONS] : [PARTITIONS[0]];
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

  commandOffers(): readonly WorldCommandOffer[] {
    // Sorted by name, which is the contract: a client renders the same list
    // twice. `touch` asks for the room it touches; `wait` asks for nothing,
    // which is a real shape and is declared as one (#91).
    return [
      {
        name: "touch",
        prompt: "Touch a room",
        args: [
          {
            name: "room",
            prompt: "Which room?",
            kind: "choice",
            choices: [
              { value: "room:1", label: "Room 1" },
              { value: "room:2", label: "Room 2" },
            ],
          },
        ],
      },
      { name: "wait", args: [] },
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
