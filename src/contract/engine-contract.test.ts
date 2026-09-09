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

const UPDATE_HINT = (dimension: string) =>
  `The engine's ${dimension} no longer matches src/contract/engine-contract.json.\n\n`
  + 'If that is intentional, record it so the platform learns about it:\n'
  + '  boardsmith contract --update --summary "<one sentence for the platform team>"\n\n'
  + 'ShufflewickPub runs a vendored copy of this engine, and published games run on '
  + 'THAT copy rather than the one they were built against. An unrecorded change ships '
  + 'silently and shows up as a game misbehaving in production.\n\n'
  + 'See docs/engine-contract.md.';

describe('engine contract', () => {
  it('matches the committed surface fingerprint', async () => {
    const { surfaceHash } = await computeFingerprints();
    expect(surfaceHash, UPDATE_HINT('exported API surface')).toBe(ENGINE_CONTRACT.surfaceHash);
  });

  it('matches the committed player-view payload fingerprint', async () => {
    const { payloadHash } = await computeFingerprints();
    expect(payloadHash, UPDATE_HINT('player-view payload')).toBe(ENGINE_CONTRACT.payloadHash);
  });

  it('matches the committed world serialization-format fingerprint', async () => {
    const { formatHash } = await computeFingerprints();
    expect(formatHash, UPDATE_HINT('world serialization format')).toBe(ENGINE_CONTRACT.formatHash);
  });

  it('is deterministic across runs', async () => {
    // A fingerprint that drifts on its own would be worse than none: it would
    // train everyone to re-run `contract:update` reflexively until the test
    // went green, which is indistinguishable from ignoring it.
    const first = await computeFingerprints();
    const second = await computeFingerprints();
    expect(second).toEqual(first);
  });

  it('covers exactly the entrypoints the platform can reach', async () => {
    // Guards against someone widening the executor's `sandboxedRequire` or the
    // games worker's imports without widening the contract — the fingerprint
    // would keep passing while no longer describing what the platform uses.
    expect(PLATFORM_ENTRYPOINTS.map((e) => e.specifier)).toEqual([
      'boardsmith',
      'boardsmith/session',
      'boardsmith/session-host',
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
      // the interface and not to that list fails to compile inside
      // `tsconfig.public.json`'s graph. This is the second half: it must also be
      // CLASSIFIED, and only a human can say which of the two it is.
      expect(
        Object.keys(WORLD_FIXTURE_COVERAGE).sort(),
        'A platform-facing world verb is unclassified. Add it to WORLD_FIXTURE_COVERAGE in '
        + 'src/contract/fingerprint.ts: `true` if the payload fixture drives it, or one '
        + 'sentence saying why it is out of scope.',
      ).toEqual([...WORLD_ENGINE_METHODS].sort());
    });

    it('drives exactly the world verbs it says it drives', async () => {
      const called = new Set<string>();
      const prototype = BoardSmithWorldEngine.prototype as unknown as Record<string, Function>;
      const originals = new Map<string, Function>();

      for (const name of WORLD_ENGINE_METHODS) {
        const original = prototype[name]!;
        originals.set(name, original);
        prototype[name] = function instrumented(this: unknown, ...args: unknown[]) {
          called.add(name);
          return original.apply(this, args);
        };
      }
      try {
        await computePayloadHash();
      } finally {
        for (const [name, original] of originals) prototype[name] = original;
      }

      expect(
        [...called].sort(),
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

  it('agrees with the head of its own history', async () => {
    const head = ENGINE_CONTRACT.history[ENGINE_CONTRACT.history.length - 1]!;
    expect({
      surfaceHash: head.surfaceHash,
      payloadHash: head.payloadHash,
      formatHash: head.formatHash,
      bundleProtocol: head.bundleProtocol,
    }).toEqual({
      surfaceHash: ENGINE_CONTRACT.surfaceHash,
      payloadHash: ENGINE_CONTRACT.payloadHash,
      formatHash: ENGINE_CONTRACT.formatHash,
      bundleProtocol: ENGINE_CONTRACT.bundleProtocol,
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
  describe('the world serialization format fingerprint', () => {
    it('refuses by name when the engine can no longer READ the committed corpus', async () => {
      const original = Game.prototype.adoptSubtree;
      // The r46 shape exactly: the bytes are unchanged and the READER stops
      // accepting them. A raised floor is how that happened the first time.
      Game.prototype.adoptSubtree = function refusing(this: Game, parentId: number, json: never) {
        throw new Error('element id 14 is already resident (simulated floor change)');
      } as typeof Game.prototype.adoptSubtree;
      try {
        await expect(computeFormatHash()).rejects.toThrow(
          /CAN NO LONGER READ THE COMMITTED WORLD FORMAT FIXTURE/,
        );
      } finally {
        Game.prototype.adoptSubtree = original;
      }
    });

    it('moves when the reader gives back something different', async () => {
      const before = await computeFormatHash();
      const original = GameElement.fromJSON;
      // A reader that stops restoring explicit visibility writes different
      // bytes on the way back out while writing identical bytes for anything it
      // created itself -- so only a ROUND TRIP over committed bytes can see it.
      // Visibility is the right field to drop precisely because it is NOT an
      // attribute: an attribute would be re-derived on the way out and the
      // read-side loss would be invisible again.
      (GameElement as { fromJSON: typeof GameElement.fromJSON }).fromJSON = function dropping(
        json: Parameters<typeof original>[0],
        ...rest: unknown[]
      ) {
        const { visibility: _dropped, ...withoutVisibility } = json as Record<string, unknown>;
        return (original as (...args: unknown[]) => unknown).call(
          GameElement,
          withoutVisibility,
          ...rest,
        ) as ReturnType<typeof original>;
      } as typeof GameElement.fromJSON;
      try {
        expect(await computeFormatHash()).not.toBe(before);
      } finally {
        (GameElement as { fromJSON: typeof GameElement.fromJSON }).fromJSON = original;
      }
    });

    it('stands still for a change that touches no stored byte', async () => {
      const before = await computeFormatHash();
      const prototype = BoardSmithWorldEngine.prototype as unknown as Record<string, unknown>;
      const offers = prototype.offersFor;
      const apply = prototype.applyCommand;
      // What a seat is OFFERED and what a command DOES are covered by
      // payloadHash and by nothing, respectively. Neither is a byte a partition
      // holds, and a format hash that moved for them would refuse runner swaps
      // that are perfectly safe -- which is the pin this whole mechanism exists
      // to loosen.
      prototype.offersFor = async () => [];
      prototype.applyCommand = async () => {
        throw new Error('not a stored byte');
      };
      try {
        expect(await computeFormatHash()).toBe(before);
      } finally {
        prototype.offersFor = offers;
        prototype.applyCommand = apply;
      }
    });
  });
});
