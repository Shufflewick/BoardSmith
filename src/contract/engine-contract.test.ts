/**
 * The gate that makes the engine contract impossible to forget.
 *
 * Everything else in this system is tooling someone has to remember to run.
 * This test runs on every `npm test`, so an engine change that alters the
 * platform-reachable surface or the player-view payload cannot reach a commit
 * without either updating the contract or deliberately deleting this test.
 */

import { describe, it, expect } from 'vitest';

import { ENGINE_CONTRACT } from './index.js';
import {
  computeFingerprints,
  computeFormatHash,
  computePayloadHash,
  PLATFORM_ENTRYPOINTS,
  WORLD_FIXTURE_COVERAGE,
  WORLD_VERBS_THE_FIXTURE_DRIVES,
} from './fingerprint.js';
import { Game, GameElement } from '../engine/index.js';
import { BoardSmithWorldEngine, WORLD_ENGINE_METHODS } from '../world/index.js';
import { SeededRandom } from '../utils/random.js';

const UPDATE_HINT = (dimension: string) =>
  `The engine's ${dimension} no longer matches src/contract/engine-contract.json.\n\n`
  + 'If that is intentional, record it so the platform learns about it:\n'
  + '  boardsmith contract --update --summary "<one sentence for the platform team>"\n\n'
  + 'ShufflewickPub runs a vendored copy of this engine, and published games run on '
  + 'THAT copy rather than the one they were built against. An unrecorded change ships '
  + 'silently and shows up as a game misbehaving in production.\n\n'
  + 'See docs/engine-contract.md.';

// Slow one-time setup lives here, where no test timeout applies (#354, #1194),
// every hash the tests below compare included (#1214, #1296). Each stand-in
// result is settled here and read inside its own test, so one that throws fails
// that test rather than the whole file.
const fingerprints = await computeFingerprints();
const fingerprintsAgain = await computeFingerprints();

type Settled<R> = { value: R } | { error: unknown };

/** `compute` run with `object`'s keys replaced by `standIns`, put back however it ends, and settled. */
async function withReplaced<O extends object, R>(
  object: O,
  standIns: Partial<O>,
  compute: () => Promise<R>,
): Promise<Settled<R>> {
  const originals = Object.keys(standIns).map((key) => [key, object[key as keyof O]] as const);
  Object.assign(object, standIns);
  try {
    return { value: await compute() };
  } catch (error) {
    return { error };
  } finally {
    for (const [key, original] of originals) object[key as keyof O] = original;
  }
}

/** A settled result's value, or its error thrown inside the test that reads it. */
function valueOf<R>(settled: Settled<R>): R {
  if ('error' in settled) throw settled.error;
  return settled.value;
}

/** The world verbs the payload fixture calls while it is computed. */
const drivenVerbs = new Set<string>();
const engineMethods = BoardSmithWorldEngine.prototype as unknown as Record<string, Function>;
const instrumented = await withReplaced(engineMethods, Object.fromEntries(WORLD_ENGINE_METHODS.map((name) => {
  const original = engineMethods[name]!;
  return [name, function instrumented(this: unknown, ...args: unknown[]) {
    drivenVerbs.add(name);
    return original.apply(this, args);
  }];
})), computePayloadHash);

const nextDraw = SeededRandom.prototype.next;
const payloadWithOtherDraws = await withReplaced(SeededRandom.prototype, { next: function shifted(this: SeededRandom) {
  return (nextDraw.call(this) + 0.5) % 1;
} }, computePayloadHash);

const storedState = SeededRandom.prototype.getState;
const payloadWithOtherStoredState = await withReplaced(SeededRandom.prototype, { getState: function renamed(this: SeededRandom) {
  return storedState.call(this).replace('chacha20:', 'other:');
} }, computePayloadHash);

// The r46 shape exactly: the bytes are unchanged and the READER stops
// accepting them. A raised floor is how that happened the first time.
const formatReadRefusal = await withReplaced(Game.prototype, { adoptSubtree: function refusing(this: Game) {
  throw new Error('element id 14 is already resident (simulated floor change)');
} as typeof Game.prototype.adoptSubtree }, computeFormatHash);

// A reader that stops restoring explicit visibility writes different bytes on
// the way back out while writing identical bytes for anything it created
// itself -- so only a ROUND TRIP over committed bytes can see it. Visibility is
// the right field to drop precisely because it is NOT an attribute: an
// attribute would be re-derived on the way out and the read-side loss would be
// invisible again.
const fromJSON = GameElement.fromJSON;
const formatWithLossyReader = await withReplaced(GameElement as { fromJSON: typeof GameElement.fromJSON }, { fromJSON: function dropping(
  json: Parameters<typeof fromJSON>[0],
  ...rest: unknown[]
) {
  const { visibility: _dropped, ...withoutVisibility } = json as Record<string, unknown>;
  return (fromJSON as (...args: unknown[]) => unknown).call(GameElement, withoutVisibility, ...rest) as ReturnType<typeof fromJSON>;
} as typeof GameElement.fromJSON }, computeFormatHash);

// What a seat is OFFERED and what a command DOES are covered by payloadHash and
// by nothing, respectively. Neither is a byte a partition holds, and a format
// hash that moved for them would refuse runner swaps that are perfectly safe --
// which is the pin this whole mechanism exists to loosen.
const worldEngine = BoardSmithWorldEngine.prototype as unknown as Record<string, unknown>;
const formatWithOtherVerbs = await withReplaced(worldEngine, {
  offersFor: async () => [],
  applyCommand: async () => {
    throw new Error('not a stored byte');
  },
}, computeFormatHash);

describe('engine contract', () => {
  it('matches the committed surface fingerprint', () => {
    const { surfaceHash } = fingerprints;
    expect(surfaceHash, UPDATE_HINT('exported API surface')).toBe(ENGINE_CONTRACT.surfaceHash);
  });

  it('matches the committed player-view payload fingerprint', () => {
    const { payloadHash } = fingerprints;
    expect(payloadHash, UPDATE_HINT('player-view payload')).toBe(ENGINE_CONTRACT.payloadHash);
  });

  it('matches the committed world serialization-format fingerprint', () => {
    const { formatHash } = fingerprints;
    expect(formatHash, UPDATE_HINT('world serialization format')).toBe(ENGINE_CONTRACT.formatHash);
  });

  it('is deterministic across runs', () => {
    // A fingerprint that drifts on its own would be worse than none: it would
    // train everyone to re-run `contract:update` reflexively until the test
    // went green, which is indistinguishable from ignoring it.
    expect(fingerprintsAgain).toEqual(fingerprints);
  });

  it('covers exactly the entrypoints the platform can reach', async () => {
    // Guards against someone widening the executor's `sandboxedRequire` or the
    // games worker's imports without widening the contract — the fingerprint
    // would keep passing while no longer describing what the platform uses.
    expect(PLATFORM_ENTRYPOINTS.map((e) => e.specifier)).toEqual([
      'boardsmith',
      'boardsmith/session',
      'boardsmith/persistence',
      'boardsmith/world',
    ]);
  });

  it('records a usable summary for every revision', async () => {
    for (const entry of ENGINE_CONTRACT.history) {
      expect(entry.summary.length, `revision ${entry.revision} has no usable summary`)
        .toBeGreaterThan(20);
    }
  });

  it('has a monotonic, gap-free history ending at the current revision', async () => {
    const revisions = ENGINE_CONTRACT.history.map((entry) => entry.revision);
    expect(revisions).toEqual(revisions.map((_, index) => index + 1));
    expect(ENGINE_CONTRACT.revision).toBe(revisions[revisions.length - 1]);
  });

  // THE GAP ITSELF, MADE LOUD.
  //
  // Three platform-visible world changes have now shipped with no revision
  // minted, and none of them was a case of anybody ignoring the KNOWN LIMITS in
  // fingerprint.ts: the limits were accurate, and three careful people read
  // them and went on, because nothing failed. `viewFor` was unfingerprinted
  // from #165 to #181; `offersFor` from #169 to #187.
  //
  // What those three share is one shape -- a verb the PLATFORM calls that the
  // payload fixture never drives -- and that shape is decidable. So it is
  // decided here rather than described there.
  describe("the payload fixture's world coverage is measured, not claimed", () => {
    it('classifies every platform-facing world verb as covered or not', () => {
      // `WORLD_ENGINE_METHODS` is `keyof WorldEngine` as values; a verb added to
      // the interface and not to that list fails `boardsmith typecheck`.
      // This is the second half: it must also be
      // CLASSIFIED, and only a human can say which of the two it is.
      expect(
        Object.keys(WORLD_FIXTURE_COVERAGE).sort(),
        'A platform-facing world verb is unclassified. Add it to WORLD_FIXTURE_COVERAGE in '
        + 'src/contract/fingerprint.ts: `true` if the payload fixture drives it, or one '
        + 'sentence saying why it is out of scope.',
      ).toEqual([...WORLD_ENGINE_METHODS].sort());
    });

    it('drives exactly the world verbs it says it drives', () => {
      valueOf(instrumented);
      expect(
        [...drivenVerbs].sort(),
        'The payload fixture and WORLD_FIXTURE_COVERAGE disagree about what is fingerprinted.\n'
        + 'A verb marked `true` that was NOT called is a coverage claim that has quietly become '
        + 'false -- the fixture narrowed, and payloadHash goes on moving for other reasons while '
        + 'covering that verb not at all.\n'
        + 'A verb the fixture called that is marked with a reason is a stated limit that has '
        + 'quietly become untrue.\n'
        + 'Fix whichever half is wrong in src/contract/fingerprint.ts.',
      ).toEqual([...WORLD_VERBS_THE_FIXTURE_DRIVES]);
    });
  });

  it('carries no bundleProtocol: the revision is the one compatibility number (#524)', () => {
    expect(ENGINE_CONTRACT).not.toHaveProperty('bundleProtocol');
    for (const entry of ENGINE_CONTRACT.history) {
      expect(entry, `r${entry.revision}`).not.toHaveProperty('bundleProtocol');
    }
  });

  it('agrees with the head of its own history', async () => {
    const head = ENGINE_CONTRACT.history[ENGINE_CONTRACT.history.length - 1]!;
    expect({
      surfaceHash: head.surfaceHash,
      payloadHash: head.payloadHash,
      formatHash: head.formatHash,
    }).toEqual({
      surfaceHash: ENGINE_CONTRACT.surfaceHash,
      payloadHash: ENGINE_CONTRACT.payloadHash,
      formatHash: ENGINE_CONTRACT.formatHash,
    });
  });

  // WHAT `formatHash` IS FOR, PROVED IN BOTH DIRECTIONS.
  //
  // ShufflewickPub pins every live world to the exact engine revision it
  // launched on because it has no way to ask whether a newer engine can read
  // that world's bytes. This hash is that question, and it is only worth
  // anything if it moves for reader-side changes and stands still for changes
  // that touch no stored byte. Both halves are asserted here, because a hash
  // that only covered the WRITER would call the r46 id-floor change -- which
  // altered no byte and refused every older world -- a compatible one.
  // The platform stores `snapshot.randomState` with every game and restores it
  // on every load, so what the generator draws and how it writes its state are
  // part of what a stored game means (#483). Neither is a runtime export or
  // something a seat receives, so the payload fixture reads both explicitly.
  describe('the payload fingerprint covers the seeded generator', () => {
    it('moves when the generator draws a different sequence', () => {
      expect(valueOf(payloadWithOtherDraws)).not.toBe(fingerprints.payloadHash);
    });

    it('moves when the generator writes its stored state differently', () => {
      expect(valueOf(payloadWithOtherStoredState)).not.toBe(fingerprints.payloadHash);
    });
  });

  describe('the world serialization format fingerprint', () => {
    it('refuses by name when the engine can no longer READ the committed corpus', () => {
      expect(() => valueOf(formatReadRefusal)).toThrow(/CAN NO LONGER READ THE COMMITTED WORLD FORMAT FIXTURE/);
    });

    it('moves when the reader gives back something different', () => {
      expect(valueOf(formatWithLossyReader)).not.toBe(fingerprints.formatHash);
    });

    it('stands still for a change that touches no stored byte', () => {
      expect(valueOf(formatWithOtherVerbs)).toBe(fingerprints.formatHash);
    });
  });
});
