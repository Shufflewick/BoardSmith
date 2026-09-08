/**
 * Engine-contract fingerprinting.
 *
 * The platform (ShufflewickPub) does not bundle BoardSmith with each game.
 * A published `rules.js` externalizes `boardsmith`, and the executor supplies
 * the engine at runtime from its own vendored copy. So a game's behaviour is
 * decided by the ENGINE THE PLATFORM VENDORED, not the one the game was built
 * against. That makes "has the engine changed in a way the platform must care
 * about?" a question someone has to answer on every BoardSmith change — and
 * answering it from memory is exactly how the `Deck` visibility default
 * silently stopped reporting draw-pile counts for months.
 *
 * This module answers it mechanically instead, with two fingerprints:
 *
 * - `surfaceHash` — the runtime export names of every entrypoint the platform
 *   can reach. Catches added, removed, or renamed API.
 * - `payloadHash` — a canonical per-player view rendered from a fixed fixture
 *   game. Catches SEMANTIC changes that leave the API identical but alter what
 *   the platform ships to clients (the `Deck` case: same exports, different
 *   payload).
 *
 * Neither is a guess about intent, and neither can be forgotten:
 * `engine-contract.test.ts` recomputes both on every test run and fails when
 * they drift from the committed contract.
 *
 * KNOWN LIMITS, stated so nobody over-trusts this:
 *
 * - `surfaceHash` sees runtime values only. `verbatimModuleSyntax` erases
 *   type-only exports, so a change to an exported TYPE (a new optional field on
 *   `PlayerStateView`, say) moves neither hash unless it also changes a real
 *   payload.
 * - The package `exports` map is not covered. Remapping `./session` in
 *   package.json is platform-visible and moves neither hash, because this
 *   module imports the entrypoint files directly.
 * - `payloadHash` covers what the fixture exercises. It is broad but it is not
 *   the whole engine, and the boundary is worth knowing precisely:
 *
 *   COVERED, TABLE SIDE: board serialization, every visibility mode the
 *   platform depends on, flow state, available actions, both sequential and
 *   simultaneous turns, and the serialized flow POSITION with its element
 *   bindings.
 *
 *   COVERED, WORLD SIDE -- BOTH HALVES OF WHAT A SEAT RECEIVES, and no more.
 *
 *   THE VIEW (#181): one seat's PROJECTED WORLD VIEW, from a multi-seat world
 *   with a declaration that names a subset of its partitions and one resident
 *   partition it does not name. So the view's two prunes are both
 *   fingerprinted -- unnamed resident partitions (#183) and the game root's
 *   roster (#181) -- along with the shape a player reference takes on the wire
 *   and the world envelope's own `{ player, state, phase }`.
 *
 *   THE OFFER (#187): the same seat's ENUMERATED VERBS, driven the way a host
 *   drives one -- `offerPartitions`, supply, ask again, `offersFor` -- so the
 *   declaration walk an offer performs is fingerprinted along with its answer.
 *   The fixture's four verbs are chosen to reach every decision `offerOf`
 *   makes: an action with no selection, one whose selection is a number (which
 *   can never be candidateless), one DISABLED whose every element candidate is
 *   greyed, and one ENABLED whose every element candidate is greyed. The last
 *   two are #187's two halves -- the first is offered with its reason and its
 *   greyed candidates, the second is still dropped -- and the hash therefore
 *   carries which verbs a seat is offered, each verb's prompt and disabled
 *   reason, and each candidate's id, display, refs and own greying.
 *
 *   Before #181 the fixture projected no world view, and before #187 no world
 *   offer. Each absence is how a change to what every seat in every world
 *   receives minted no revision.
 *
 *   NOT COVERED, WORLD SIDE: everything a world DOES rather than shows.
 *   Nothing here dispatches, so `applyCommand` and `onEvent` and everything
 *   downstream of them -- the dirty set, rollback, event routing by scope,
 *   scheduling and recurrence, keyed cancellation, refusals, and the bytes
 *   `serializePartitions` writes -- move neither hash. Nor does eviction, nor a
 *   seat taken or left. Those are not a guess: `WORLD_FIXTURE_COVERAGE` below
 *   states one of exactly two things about every verb of `WorldEngine`, and
 *   `engine-contract.test.ts` instruments the engine and proves both directions
 *   on every run. `WORLD_WIRE_FIXTURE` covers the world WIRE's shape, including
 *   an event's narration `text`/`type`, but it is a hand-written literal rather
 *   than something the engine produced.
 *
 * - The world fixture and its verbs are defined HERE rather than imported from
 *   `src/world/village.test-helper.ts` or from an example game, for the reason
 *   the table fixture is: a shared test helper is reshaped by whoever is
 *   writing tests and an example game by its designer, and this hash must move
 *   for engine reasons alone.
 *
 * WHAT REMAINS PROSE, AND CANNOT BE MADE TO FAIL. `WORLD_FIXTURE_COVERAGE`
 * decides "is this verb driven at all", which is the shape of all three misses
 * so far. It cannot decide "does the fixture's own world stand in the state
 * that reaches the branch you just changed" -- #187 needed a disabled action
 * whose every candidate was greyed before any hash could see it. That is what
 * the `assertCovers*` guards pin, one state at a time, and adding a state to
 * one of them is still a judgement nobody can automate.
 *
 * So: when you make a platform-visible change none of the fingerprints can see,
 * extend the fixture so it can, then record the revision.
 */

import { createHash } from 'node:crypto';
import type { WorldHostMessage, WorldUiMessage } from '../ui/world/worldProtocol.js';
import { WORLD_ENGINE_METHODS } from '../world/contract.js';
import type { WorldEngine } from '../world/contract.js';

/**
 * WHICH OF THE WORLD ENGINE'S PLATFORM-FACING VERBS THE PAYLOAD FIXTURE
 * ACTUALLY DRIVES — the KNOWN LIMITS above, made mechanical.
 *
 * The limits were true, complete and well written on all three occasions a
 * platform-visible world change shipped with no revision. Prose does not fail,
 * so this does instead: `true` is a CLAIM that the fixture calls the verb, and
 * `engine-contract.test.ts` proves every claim by instrumenting the engine's
 * prototype and re-running the fixture. A string is the reason it is out of
 * scope, and the test proves THAT too, by failing if the fixture calls it
 * anyway — a limit that quietly became untrue is as misleading as a claim that
 * quietly became false.
 *
 * The set of keys is not this file's to choose: `WORLD_ENGINE_METHODS` is
 * `keyof WorldEngine` as values, so a verb added to the platform's engine
 * interface arrives here as a missing key and stops the suite until somebody
 * decides which of the two things it is.
 *
 * WHAT THIS CANNOT CATCH: a change inside a verb the fixture DOES call, on a
 * path the fixture's own world never walks. #187 is that shape once `offersFor`
 * is covered — the fixture had to stand in the exact state (an action disabled
 * for the looker whose every candidate is greyed) before the hash could see it,
 * which is what `assertCoversWorldOffer` pins and what no table can decide for
 * you.
 */
export const WORLD_FIXTURE_COVERAGE: Record<(typeof WORLD_ENGINE_METHODS)[number], true | string> = {
  hydrate: true,
  offerPartitions: true,
  offersFor: true,
  residency: true,
  viewFor: true,
  viewPartitions: true,

  migratePartition: 'A world MOVING BETWEEN state versions (#200), which happens once, at '
    + 'startup, before any player is in it -- never on the path this fixture drives. What it '
    + 'produces is ordinary partition bytes: `serializePartitions` is what writes them, and that '
    + 'is fingerprinted.',

  createMigratedPartitions: 'The other half of a world MOVING BETWEEN state versions (#218), '
    + 'which happens once, at startup, before any player is in it. What it produces is an '
    + 'ordinary partition record, exactly as `genesis` does.',
  createPartition: 'A root built the first time a declaration reaches for a name the store has '
    + 'never held (#218). The fixture\'s world starts with every partition it names, so nothing '
    + 'here ever misses -- and what it produces is an ordinary partition record.',

  applyCommand: 'A world\'s write path. The fixture dispatches nothing, so the dirty set, '
    + 'rollback and the checkpoint bytes are unfingerprinted.',
  commandPartitions: 'The declaration walk a DISPATCH drives, and the fixture drives none. '
    + "The offer's own walk -- the same two-round shape -- is covered.",
  evict: 'Residency policy is the host\'s, not the world\'s. The fixture never drops a '
    + 'partition, so what eviction leaves behind is unfingerprinted.',
  onEvent: 'The clock\'s road: scheduling, recurrence, keyed cancellation and event routing '
    + 'by scope. Nothing here schedules and nothing here is due.',
  seat: 'Seats are handed to the constructor. Nobody sits down or stands up mid-fixture.',
  serializePartitions: 'What a checkpoint WRITES. Nothing here writes, so the stored form of '
    + 'a dirtied partition moves neither hash.',
};

/** The verbs above that the fixture claims to drive, in a fixed order. */
export const WORLD_VERBS_THE_FIXTURE_DRIVES: readonly (keyof WorldEngine)[] = WORLD_ENGINE_METHODS
  .filter((name) => WORLD_FIXTURE_COVERAGE[name] === true)
  .sort();

/**
 * The entrypoints the platform can reach, and why each one counts.
 *
 * Anything NOT in this list is invisible to the contract by design — the UI
 * package, the CLI, and the trainer ship inside a game's own bundle or run on
 * a developer's machine, so they cannot cause platform/game engine skew.
 *
 * ONE EXCEPTION, covered by `payloadHash` rather than here: the world wire
 * (`src/ui/world/worldProtocol.ts`). Its bundle half compiles into every
 * `world.html`, but its HOST half is hand-written in ShufflewickPub
 * (`app/components/WorldFrame.vue`) — so a wire change out of step with the
 * platform is exactly the skew this contract exists to catch, and it is all
 * types, which `surfaceHash` cannot see. `WORLD_WIRE_FIXTURE` below makes it
 * visible.
 */
export const PLATFORM_ENTRYPOINTS = [
  // Supplied to game rules at runtime by the executor's `sandboxedRequire`.
  { specifier: 'boardsmith', module: () => import('../engine/index.js') },
  { specifier: 'boardsmith/session', module: () => import('../session/index.js') },
  // Imported directly by the games worker to host a session.
  {
    specifier: 'boardsmith/session-host',
    module: () => import('../session/snapshot-session-host.js'),
  },
  // Imported directly by the games worker as its persistence validation core:
  // `games/src/persistence.ts` re-exports this entrypoint rather than restating
  // it, so a rename here silently removes the platform's commit validator.
  {
    specifier: 'boardsmith/persistence',
    module: () => import('../persistence/index.js'),
  },
  // Imported directly by the games worker as its world runner core (#165):
  // `games/src/world-*.ts` runs this entrypoint rather than its own copy, and a
  // launched world pins the revision that carries it. Absent from this list, a
  // build that adds or changes the world core mints no new revision, and the
  // platform vendors a world-carrying engine under the label of a world-less
  // archived one -- two different engines with one identity, which is the skew
  // the archive exists to prevent.
  {
    specifier: 'boardsmith/world',
    module: () => import('../world/index.js'),
  },
] as const;

/**
 * The world wire, one canonical message per shape, both directions.
 *
 * `satisfies` is the mechanism: each literal is checked against the protocol
 * type, so ADDING a required field to any message refuses to compile until the
 * fixture carries it — and the moment it does, `payloadHash` moves and
 * `boardsmith contract --update` is demanded. An optional field is the known
 * limit stated at the top of this file: extend this fixture by hand when you
 * add one.
 *
 * The values are arbitrary but fixed; only their shape and their canonical
 * serialization matter.
 */
const WORLD_WIRE_FIXTURE = {
  world_state: {
    source: 'shufflewick-world',
    type: 'world_state',
    phase: 'watching',
    view: { player: 2, state: { id: 0, className: 'Game' }, phase: 'started' },
    seat: 2,
    actions: [
      {
        name: 'move',
        prompt: 'Walk somewhere',
        disabled: 'You are carrying too much',
        selections: [
          {
            name: 'to',
            type: 'element',
            prompt: 'Which way?',
            validElements: [
              {
                id: 7,
                display: 'The cellar',
                refs: [{ ref: { id: 7 }, role: 'highlight' }],
                disabled: 'The door is barred',
              },
            ],
          },
          { name: 'paces', type: 'number', prompt: 'How far?', min: 1, max: 9, integer: true },
          { name: 'note', type: 'text', prompt: 'Say why' },
        ],
      },
    ],
    notice: 'The fire is low.',
    worldName: 'Contract Fixture World',
    presence: [2, 5],
    // WHO THE SEATS ARE (#170). Host-composed and platform-only: BoardSmith
    // never derives a name, so this field exists precisely so ShufflewickPub can
    // fill it. In the fixture because the shared shell renders seat NUMBERS
    // without it, and a platform that does not know it may send names would
    // ship a world whose player list is a column of integers.
    players: [
      { seat: 2, name: 'Ivy', color: '#3aa06a' },
      { seat: 5, name: 'Rook' },
    ],
  },
  world_events: {
    source: 'shufflewick-world',
    type: 'world_events',
    events: [
      // WITH a sentence and WITHOUT, because the difference is the contract
      // (#170): `text` is the line the shared shell puts in its log, and an
      // event that carries none puts no line there rather than an invented one.
      // The platform relays both untouched and composes neither.
      {
        scope: 'room:cellar',
        payload: { said: 'the fire is low', by: 2 },
        text: 'Ivy says the fire is low.',
        type: 'speech',
      },
      { scope: 'world', payload: { dawn: true } },
    ],
  },
  world_response: {
    source: 'shufflewick-world',
    type: 'world_response',
    requestId: 'wc-1',
    ok: false,
    message: 'There is no door that way.',
  },
  world_command: {
    source: 'shufflewick-world-ui',
    type: 'world_command',
    requestId: 'wc-1',
    action: 'move',
    args: { to: 7 },
  },
  world_ready: {
    source: 'shufflewick-world-ui',
    type: 'world_ready',
  },
} satisfies {
  world_state: Extract<WorldHostMessage, { type: 'world_state' }>;
  world_events: Extract<WorldHostMessage, { type: 'world_events' }>;
  world_response: Extract<WorldHostMessage, { type: 'world_response' }>;
  world_command: Extract<WorldUiMessage, { type: 'world_command' }>;
  world_ready: Extract<WorldUiMessage, { type: 'world_ready' }>;
};

/**
 * Deterministically serialize a value with object keys sorted.
 *
 * Key ORDER is not part of the contract — a payload that gained no keys and
 * lost none has not changed for any consumer. Sorting keeps innocuous
 * reordering from raising a false alarm, which matters because a fingerprint
 * that cries wolf gets bumped without being read.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortDeep(source[key]);
  }
  return sorted;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * Describe one export for the surface hash.
 *
 * Top-level names alone are not the API games call. Rules call METHODS —
 * `deck.shuffle()`, `game.followUp()`, the whole element and action surface —
 * so renaming or removing a method while leaving the class exported would keep
 * a name-only hash still, let the change ship unrecorded, and let the upload
 * gate compare two equal revisions on a bundle that calls a method the vendored
 * engine no longer has. That is the exact failure the gate exists to prevent,
 * so prototype members are part of the surface.
 *
 * This is deliberately conservative: it includes members that are private by
 * convention, so an internal method rename also forces a revision bump. False
 * positives cost one `contract --update`; false negatives cost a production
 * bug nobody can trace.
 */
function describeExport(name: string, value: unknown): string {
  if (typeof value !== 'function' || value.prototype === undefined) return name;

  const members = Object.getOwnPropertyNames(value.prototype)
    .filter((member) => member !== 'constructor')
    .sort();

  return members.length > 0 ? `${name}{${members.join(',')}}` : name;
}

/**
 * Hash the runtime export surface of every platform-reachable entrypoint:
 * export names plus, for classes and functions, their prototype members.
 *
 * Shapes only, never implementations — a changed function body is a semantic
 * change, which is `payloadHash`'s job. Conflating the two would make this hash
 * move on every internal edit and stop meaning "the API changed".
 */
export async function computeSurfaceHash(): Promise<string> {
  const lines: string[] = [];

  for (const entry of PLATFORM_ENTRYPOINTS) {
    const module = (await entry.module()) as Record<string, unknown>;
    const described = Object.keys(module)
      .sort()
      .map((name) => describeExport(name, module[name]));
    lines.push(`${entry.specifier}: ${described.join(',')}`);
  }

  return sha256(lines.join('\n'));
}

/**
 * Fail loudly if the fixture stopped exercising the flow layer.
 *
 * This exists because the first version of this fixture silently did not. It
 * built a board, never started a flow, and produced views whose `flowState` was
 * `undefined` — so `payloadHash` covered visibility serialization only, while
 * claiming to cover the engine. Worse, the hash still MOVED whenever the board
 * changed, so it looked alive. An adversarial review caught it; a green test
 * suite did not.
 *
 * A fingerprint that silently narrows is more dangerous than no fingerprint,
 * because it converts "unverified" into "verified". So the fixture asserts what
 * it is supposed to be covering rather than trusting that it still does.
 */
function assertCoversFlowLayer(views: unknown[]): void {
  const missing: string[] = [];

  if (views.length === 0) missing.push('no player views at all');

  const states = views.map(
    (view) => (view as Record<string, unknown>).flowState as Record<string, unknown> | undefined,
  );

  if (states.some((state) => state === undefined)) missing.push('flowState');

  // The fixture opens on a SIMULTANEOUS step, where every seat is on the clock
  // at once. `createPlayerView` has to resolve that from the engine's
  // `awaitingPlayers` rather than `currentPlayer`, and when it failed to, this
  // platform shipped a game whose action bar was blank. So the fixture is only
  // doing its job if BOTH seats come back active with real actions offered.
  const active = states.filter(
    (state) => state?.isMyTurn === true && (state.availableActions as string[] | undefined)?.length,
  );
  if (active.length !== views.length) {
    missing.push(
      `simultaneous-turn resolution (${active.length}/${views.length} seats got isMyTurn + availableActions)`,
    );
  }

  if (missing.length === 0) return;

  throw new Error(
    `The engine-contract fixture is no longer exercising the flow layer (missing: ${missing.join(', ')}).\n`
    + 'payloadHash would still change and still look healthy while covering board '
    + 'serialization only — silently narrowing what the contract actually verifies.\n'
    + 'Fix the fixture in src/contract/fingerprint.ts rather than removing this check.',
  );
}

/**
 * Fail loudly if the fingerprinted flow position stopped carrying element
 * bindings.
 *
 * `payloadHash` covers what the fixture exercises, and a per-player view does
 * NOT include `position` at all (`createPlayerView` publishes only
 * `awaitingInput`/`isMyTurn`/`availableActions`), so before this the whole
 * serialize/relink layer BSMITH-04 is about was invisible to the contract: a
 * re-vendor that reverted `frameData` to a raw spread would move neither hash.
 *
 * Hashing the position closes that only while the position actually HOLDS a
 * live element on both sides. If a future flow edit stops producing one, the
 * hash keeps changing for other reasons and keeps looking healthy while
 * covering nothing — the same silent narrowing `assertCoversFlowLayer` exists
 * to prevent. So the fixture asserts what it claims to cover.
 *
 * Two failure shapes, both reported as themselves rather than as a hash move:
 * a position that no longer CLONES (a live element leaked through), and a
 * position that no longer CARRIES a marker (the fixture stopped covering the
 * path). Note that neither is fixable with `boardsmith contract --update` —
 * `--update` recomputes through this same function, so a regression cannot be
 * blessed away by recording it.
 *
 * What this catches: `getPosition` dropping the general serializer for
 * `variables` or for `frameData`. What it does NOT catch: a change confined to
 * a frame-data field this fixture never writes, or to `relinkFlowVariables`'s
 * resolution rules — both hashes see the SERIALIZED form only, because nothing
 * here restores. The restore half is covered by
 * `src/engine/flow/flow-state-clone.test.ts`, and 68-10 adds a
 * platform-side check against the VENDORED engine.
 */
function assertCoversElementBindings(position: unknown): void {
  assertPositionIsCloneable(position);
  assertPositionCarriesMarkers(position);
}

/**
 * The property itself: a serialized flow position crosses postMessage and the
 * executor RPC, so a live element left in one throws `DataCloneError` and kills
 * the broadcast for every seat.
 *
 * Checked here, and not left to the hash, because `canonicalize` walks the
 * value: a live element's parent back-references send `sortDeep` into infinite
 * recursion, and "RangeError: Maximum call stack size exceeded" names nothing a
 * reader could act on. This is the same regression, reported as itself.
 */
function assertPositionIsCloneable(position: unknown): void {
  try {
    structuredClone(position);
  } catch (cause) {
    throw new Error(
      "The engine-contract fixture's flow position is no longer structured-cloneable.\n"
      + 'A live GameElement/Player is reaching the serialized position, which in production '
      + 'throws DataCloneError out of the broadcast (BSMITH-04). `getPosition` must run BOTH '
      + '`variables` and every frame\'s `data` through `serializeFlowVariables`.\n'
      + 'See src/engine/flow/engine.ts getPosition, and '
      + 'src/engine/flow/flow-state-clone.test.ts for the general test.',
      { cause },
    );
  }
}

function assertPositionCarriesMarkers(position: unknown): void {
  const { variables, frameData } = (position ?? {}) as {
    variables?: Record<string, unknown>;
    frameData?: Record<string, Record<string, unknown>>;
  };

  const missing: string[] = [];
  if (!hasElementMarker(variables)) missing.push('position.variables');
  if (!hasElementMarker(frameData)) missing.push('position.frameData');
  if (missing.length === 0) return;

  throw new Error(
    `The engine-contract fixture is no longer binding a live element into ${missing.join(' or ')}.\n`
    + 'payloadHash would still change and still look healthy while no longer covering the '
    + 'flow-state serialize path (BSMITH-04) at all.\n'
    + 'Fix the fixture in src/contract/fingerprint.ts rather than removing this check.',
  );
}

/** True when `value` contains a serialized element marker anywhere inside. */
function hasElementMarker(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.__flowElementId === 'number') return true;
  return Object.values(record).some(hasElementMarker);
}

/**
 * The shape both world guards share: a TABLE of what must still be true, read
 * whole rather than reconstructed from a chain of ifs, and one error naming
 * every row that no longer holds.
 *
 * The message says what stopped being covered and what that costs, because a
 * guard whose failure reads as a hash mismatch is a guard somebody blesses with
 * `contract --update` -- which cannot work here anyway, since `--update`
 * recomputes through this same function.
 */
function assertCovers(
  what: string,
  covers: readonly (readonly [string, boolean])[],
  consequence: string,
): void {
  const missing = covers.filter(([, held]) => !held).map(([label]) => label);
  if (missing.length === 0) return;

  throw new Error(
    `The engine-contract fixture is no longer exercising ${what} (missing: ${missing.join(', ')}).\n`
    + `${consequence}\n`
    + 'Fix the fixture in src/contract/fingerprint.ts rather than removing this check.',
  );
}

/**
 * Fail loudly if the world fixture stopped exercising a world PROJECTION.
 *
 * The third instance of the same guard, and for the same reason as the first
 * two: a fixture that quietly narrows converts "unverified" into "verified",
 * and the hash goes on moving for other reasons while covering nothing. What
 * a world view costs is the whole argument for the partitioned model, so the
 * three things that make this projection a real one are asserted rather than
 * assumed.
 *
 * These are COVERAGE assertions and not correctness ones. Whether the prunes
 * are RIGHT is what `payloadHash` records; this only pins that they were asked.
 */
function assertCoversWorldView(
  view: unknown,
  facts: {
    seats: number;
    residentNames: readonly string[];
    declaredNames: readonly string[];
    state: unknown;
  },
): void {
  const projected = (view ?? {}) as { player?: unknown; state?: { children?: unknown[] } };
  // A resident partition this seat's declaration does not name is the
  // busy-world state the #183 prune exists for; without one the fixture cannot
  // tell a pruned view from an unpruned one.
  const unnamedResident = facts.residentNames.filter(
    (name) => !facts.declaredNames.includes(name),
  );

  // A TABLE OF WHAT MUST STILL BE TRUE, rather than a chain of ifs: each row is
  // one thing this projection covers, and the reader sees the whole list at
  // once instead of reconstructing it from control flow.
  const covers: readonly (readonly [string, boolean])[] = [
    ['the world envelope (no `player`)', typeof projected.player === 'number'],
    ['a projected tree (the view has no children)', (projected.state?.children ?? []).length > 0],
    // A one-seat world cannot show whether the roster is projected or shipped
    // whole, which is the #181 regression this exists to catch.
    [`a multi-seat world (it has ${facts.seats})`, facts.seats >= 2],
    ['a resident partition the declaration does NOT name', unnamedResident.length > 0],
    // The roster question is only live while something in the view points at a
    // player: that reference is what makes dropping the others safe, and a
    // fixture that stopped holding one would fingerprint the prune without
    // fingerprinting the thing it must not break.
    ['a player reference inside a named partition', hasPlayerReference(facts.state)],
  ];

  assertCovers(
    'a world projection',
    covers,
    'payloadHash would still change and still look healthy while covering what every seat '
    + 'in every world receives not at all.',
  );
}

/** True when `value` contains a serialized player reference anywhere inside.
 *  A player-valued attribute serializes as `{ __playerRef, seat, color, name }`
 *  -- resolved by SEAT, which is why a pruned roster leaves nothing dangling. */
function hasPlayerReference(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.__playerRef === 'number') return true;
  return Object.values(record).some(hasPlayerReference);
}

/**
 * Fail loudly if the world fixture stopped exercising a seat's OFFER.
 *
 * The fourth instance of the same guard, and the third time the gap it closes
 * shipped unrecorded: `offersFor` has been a world's whole action surface since
 * #169 and no fingerprint reached it until #187, so an engine change that
 * decided which verbs every seat is offered moved neither hash.
 *
 * COVERAGE, NOT CORRECTNESS -- the same distinction `assertCoversWorldView`
 * draws. What is asserted is that the fixture's WORLD is still standing in the
 * four states that make an offer's decisions visible; WHICH verbs the engine
 * then offers is what `payloadHash` records. That split is deliberate: a
 * regression in the engine must move the hash and be minted, not trip a guard
 * that tells the reader to go fix the fixture.
 *
 * The four states, and why each is here:
 *
 *  - NO SELECTION AT ALL. The offer's floor. An action with nothing to ask can
 *    never be candidateless, so it is the control against which the other three
 *    are read.
 *  - A NUMBER. `candidateless` is defined over `validElements ?? choices`, so a
 *    number selection can never be one -- which is exactly why `kindle` sat
 *    correctly greyed in the field while `tend` vanished. Without a number in
 *    the fixture the two roads through `offerOf` are one road.
 *  - EVERY ELEMENT CANDIDATE GREYED, ON A DISABLED ACTION. BoardSmith #187: the
 *    verb is offered WITH its reason and its greyed candidates. This is the
 *    shape that shipped to `example-rts` unrecorded.
 *  - EVERY ELEMENT CANDIDATE GREYED, ON AN ENABLED ACTION. #187's other half,
 *    which the fix must not undo: a pick that opens on nothing is still
 *    dropped. Fingerprinted by its ABSENCE from the offer, which is a payload
 *    difference like any other.
 */
function assertCoversWorldOffer(facts: {
  selectionShapes: readonly (readonly string[])[];
  ownLandIsBare: boolean;
  everyNeighbourIsGreyed: boolean;
}): void {
  const shapes = facts.selectionShapes;

  const covers: readonly (readonly [string, boolean])[] = [
    ['an action with no selection at all', shapes.some((shape) => shape.length === 0)],
    ['an action whose selection is a number', shapes.some((shape) => shape.join() === 'number')],
    ['an action whose selection is an element', shapes.some((shape) => shape.join() === 'element')],
    // The two element verbs share one predicate with the actions themselves, so
    // this asks the world the same question `tend`'s and `raze`'s own
    // `disabled` callbacks ask it rather than restating their rule.
    ["the looker's own land bare, so the disabled reason is live", facts.ownLandIsBare],
    ['every neighbour at full growth, so every candidate is greyed', facts.everyNeighbourIsGreyed],
  ];

  assertCovers(
    'a world offer',
    covers,
    'payloadHash would still change and still look healthy while covering which verbs every '
    + 'seat in every world is offered not at all -- which is how BoardSmith #187 shipped with '
    + 'the contract still reading revision 41.',
  );
}

/**
 * ONE SEAT'S VIEW OF A WORLD, AND ONE SEAT'S OFFER, which together are the
 * other backend's whole read path.
 *
 * A world is not a table with different storage: a table holds its tree
 * resident and ships a `PlayerState.view`, while a world keeps only named
 * partitions resident and answers `{ player, state, phase }` per seat, pruned
 * to what that seat's declaration named. `games/src/world-session.ts` calls
 * this path for every watcher of every world, so a change to what it produces
 * reaches every seat in production -- and until #181 no fingerprint could see
 * it.
 *
 * A VILLAGE, because the smallest world that makes the read cost measurable is
 * one where seats own land: five holdings, a shared commons, and each holding
 * naming its owner. Five seats rather than five hundred -- the fixture is a
 * fingerprint and not a benchmark, and the roster prune is as visible at five
 * as at five hundred.
 *
 * COLD, like the table fixture is booted through `GameRunner`: genesis runs on
 * one game and only its BYTES survive, and the engine under fingerprint adopts
 * them. A fixture that handed the engine live objects would fingerprint a path
 * no world takes after its first hour.
 *
 * THE VERBS ARE THIS FILE'S OWN, and small on purpose. They are here rather
 * than imported from `src/world/village.test-helper.ts` or from an example game
 * for the reason the table fixture gives: a shared helper is reshaped by
 * whoever is writing tests and an example game is reshaped by its designer,
 * either of which would move this hash for a reason that is not an engine
 * change. What they must be is exhaustive over the DECISIONS `offerOf` makes,
 * which `assertCoversWorldOffer` is what pins.
 */
async function computeWorldFixture(): Promise<{ view: unknown; offer: unknown }> {
  const engine = await import('../engine/index.js');
  const { BoardSmithWorldEngine, worldAction } = await import('../world/index.js');
  const { Game, Player, Space } = engine as any;

  const SEATS = 5;
  const COMMONS = 'commons';
  const LOOKER = 'p1';
  const LOOKER_SEAT = 1;
  const holdingPartition = (seat: number): string => `holding:${seat}`;

  // THE RING, so "a neighbouring holding" is two candidates and not the whole
  // village -- the distinction #169 exists for.
  const neighboursOf = (seat: number): number[] => [
    seat === 1 ? SEATS : seat - 1,
    seat === SEATS ? 1 : seat + 1,
  ];

  // GENESIS STANDS HOLDING N AT N, so seat one's own land is the only bare one
  // and both of its neighbours are at or above the cap. That single fact is
  // what puts the fixture in #187's exact field state: an action disabled for
  // the looker whose every candidate is also greyed. The two predicates below
  // are shared with `assertCoversWorldOffer`, so the guard asks the world the
  // same question the verbs do rather than restating their rule.
  const GROWTH_CAP = 2;
  const isBare = (holding: any): boolean => holding.standing < GROWTH_CAP;
  const isAtFullGrowth = (holding: any): boolean => holding.standing >= GROWTH_CAP;

  class WorldFixtureHolding extends Space<any> {
    seat = 0;
    standing = 0;
  }
  class WorldFixtureCommons extends Space<any> {
    embers = 0;
  }
  class WorldFixtureWorld extends Game<any, any> {
    constructor(options: any) {
      super(options);
      // Registered in the CLASS constructor: world mode has no handler re-bind
      // pass on adoption, so anything a grafted element needs must come from
      // its own class.
      this.registerElements([WorldFixtureHolding, WorldFixtureCommons]);
    }
  }

  const holdingOf = (game: any, seat: number): any => {
    const found = game.first(WorldFixtureHolding, `holding-${seat}`);
    if (!found) throw new Error(`the world fixture has no holding for seat ${seat}`);
    return found;
  };

  // FOUR VERBS, ONE FOR EACH DECISION `offerOf` MAKES. See
  // `assertCoversWorldOffer` for what each is standing in for.
  const look = worldAction<any>('look')
    .prompt('Look about you')
    .needs(({ player }: any) => [holdingPartition(player.seat)])
    // ROUND TWO READS WHAT ROUND ONE LOADED, THROUGH THE INDEXED ACCESSOR
    // (ShufflewickPub#374). Before this the fixture's two-round shape was two
    // rounds of ARITHMETIC -- `neighboursOf(player.seat)` needs nothing
    // resident -- so a declaration that reads state had no coverage here at
    // all, and `world` could be added to or removed from a needs context
    // without moving either hash. Now the second round's ANSWER depends on the
    // first round's partition, so the offer this fixture hashes does too.
    .needs(({ world, player }: any) =>
      isBare(world.partition(holdingPartition(player.seat))) ? [COMMONS] : [],
    )
    .execute((_args: unknown, ctx: any) => {
      ctx.world.emit(holdingPartition(ctx.player.seat), { looked: true });
    });

  const kindle = worldAction<any>('kindle')
    .prompt('Put logs on the common fire')
    .needs(() => [COMMONS])
    .enterNumber('logs', { prompt: 'How many?', min: 1, max: 9 })
    .execute((args: any, ctx: any) => {
      (ctx.world.partition(COMMONS) as any).embers += args.logs;
    });

  const neighbourPick = {
    prompt: "Whose land?",
    needs: ({ player }: any) => neighboursOf(player.seat).map(holdingPartition),
    elements: ({ game, player }: any) =>
      neighboursOf(player.seat).map((seat: number) => holdingOf(game, seat)),
    disabled: (holding: any) => (isAtFullGrowth(holding) ? 'Already at full growth' : false),
  };

  const tend = worldAction<any>('tend')
    .prompt("Put timber back on a neighbour's land")
    .needs(({ player }: any) => [holdingPartition(player.seat)])
    .disabled(({ game, player }: any) =>
      isBare(holdingOf(game, player.seat)) ? 'Your own land is bare' : false,
    )
    .chooseElement('neighbour', neighbourPick)
    .execute((args: any) => {
      args.neighbour.standing += 1;
    });

  const raze = worldAction<any>('raze')
    .prompt("Clear a neighbour's land")
    .needs(({ player }: any) => [holdingPartition(player.seat)])
    .chooseElement('neighbour', neighbourPick)
    .execute((args: any) => {
      args.neighbour.standing = 0;
    });

  const newWorld = (): any =>
    new WorldFixtureWorld({
      playerCount: SEATS,
      seed: 'engine-contract-world-fixture',
      worldMode: true,
    });

  // Genesis, kept as bytes only.
  const born = newWorld();
  const stored = new Map<string, { parentId: number; json: unknown }>();
  const commons = born.create(WorldFixtureCommons, 'commons', { embers: 3 });
  stored.set(COMMONS, { parentId: born.id, json: throughStorage(commons.toJSON()) });
  for (let seat = 1; seat <= SEATS; seat += 1) {
    const holding = born.create(WorldFixtureHolding, `holding-${seat}`, { seat, standing: seat });
    // THE REFERENCE THAT MAKES THE ROSTER PRUNE A REAL QUESTION (#181), and the
    // one example-rts writes: a holding names its owner.
    holding.player = born.players[seat - 1];
    stored.set(holdingPartition(seat), {
      parentId: born.id,
      json: throughStorage(holding.toJSON()),
    });
  }

  const seats = new Map<string, number>();
  for (let seat = 1; seat <= SEATS; seat += 1) seats.set(`p${seat}`, seat);

  const live = newWorld();
  const world = new BoardSmithWorldEngine({
    game: live,
    seats,
    store: {
      async read(name: string) {
        return stored.get(name);
      },
      forget() {},
    },
    actions: [look, kindle, tend, raze],
    // A SUBSET, which is the point: the commons and the looker's own land, and
    // never anybody else's.
    view: (seat: number) => [COMMONS, holdingPartition(seat)],
  });

  // THE BUSY-WORLD STATE. Another seat looked at their own land a moment ago,
  // so it is resident and seat one's declaration still does not name it. Before
  // #183 it rode along in seat one's view; the fixture is what keeps that from
  // coming back unrecorded.
  await world.hydrate([holdingPartition(4)]);

  const view = (await world.viewFor(LOOKER)) as { state?: unknown };
  assertCoversWorldView(view, {
    seats: live.players.length,
    residentNames: world.residency().map((partition: { name: string }) => partition.name),
    declaredNames: world.viewPartitions(LOOKER),
    state: view.state,
  });

  // THE OFFER, DRIVEN THE WAY A HOST DRIVES IT: ask what the offer still needs,
  // supply it, ask again. The engine names and the host reads, because a child
  // isolate has no storage binding -- so a fixture that called `offersFor`
  // against whatever happened to be resident would fingerprint a road no
  // platform travels, and would silently stop covering the neighbours' greying
  // the moment their partitions fell out of residency.
  // THE WALK ITSELF IS HASHED, not only its answer (ShufflewickPub#374). The
  // limits above have claimed since #187 that "the declaration walk an offer
  // performs is fingerprinted along with its answer", and only the answer was:
  // the rounds were asked, hydrated and thrown away. So a change to what a
  // declaration can READ moved neither hash as long as the verbs on offer came
  // out the same -- which is exactly how the needs context gained `world`
  // without the contract noticing. Recording each round makes the claim true.
  const rounds: (readonly string[])[] = [];
  for (;;) {
    const needs = world.offerPartitions(LOOKER);
    rounds.push(needs);
    if (needs.length === 0) break;
    await world.hydrate(needs);
  }
  const offer = await world.offersFor(LOOKER, OFFER_STAMP);

  // The guard below reads the neighbouring holdings directly, so it must not
  // depend on the offer having loaded them. An offer that stopped asking for
  // them is precisely the narrowing it is there to report, and it should say so
  // rather than die looking for an element that is no longer resident.
  await world.hydrate(neighboursOf(LOOKER_SEAT).map(holdingPartition));

  assertCoversWorldOffer({
    selectionShapes: [look, kindle, tend, raze].map((definition) =>
      definition.selections.map((selection) => selection.type),
    ),
    ownLandIsBare: isBare(holdingOf(live, LOOKER_SEAT)),
    everyNeighbourIsGreyed: neighboursOf(LOOKER_SEAT).every((seat) =>
      isAtFullGrowth(holdingOf(live, seat)),
    ),
  });

  return { view, rounds, offer };
}

/**
 * WHAT THE HOST KNOWS WHEN IT ASKS FOR AN OFFER, fixed.
 *
 * Time and presence live outside a world and arrive as arguments, precisely so
 * that a world computes the same offer however busy its host is. Fixed here for
 * the same reason the seed is: a fingerprint that read a clock would drift on
 * its own, and a fingerprint that drifts trains everyone to re-record it.
 */
const OFFER_STAMP = { now: 1_700_000_000_000, presence: [1] as readonly number[] };

/** A cold-storage round trip, which is what a world's engine is really fed. */
function throughStorage(json: unknown): unknown {
  return JSON.parse(JSON.stringify(json));
}

/**
 * Render the fixture game's per-player views and hash them.
 *
 * The fixture is defined here rather than borrowed from an example game on
 * purpose: an example game changes when its designer changes it, which would
 * move this hash for reasons that have nothing to do with the engine.
 *
 * It deliberately covers the visibility modes the platform actually depends on
 * — a default `Deck` (the §3b regression's exact shape), an owner-visible
 * hand, an explicitly count-only pile, and a fully hidden pile — so a change to
 * any default lands in the hash instead of in a bug report.
 */
export async function computePayloadHash(): Promise<string> {
  const engine = await import('../engine/index.js');
  const { GameRunner } = await import('../runtime/index.js');
  const {
    Game, Space, Piece, Player, Deck, Hand, Action,
    defineFlow, actionStep, simultaneousActionStep, sequence, eachPlayer,
  } = engine as any;

  class FixturePlayer extends Player<any, any> {
    hasBid = false;
  }

  class FixtureCard extends Piece<any> {
    suit!: string;
    rank!: string;
  }

  class FixtureGame extends Game<any, any> {
    static PlayerClass = FixturePlayer;

    constructor(options: any) {
      super(options);

      this.registerAction(
        Action.create('bid').execute((_args: unknown, ctx: any) => {
          ctx.player.hasBid = true;
          return { success: true };
        }),
      );
      this.registerAction(
        Action.create('draw').execute(() => ({ success: true })),
      );

      // BOTH turn shapes, because they serialize differently and the platform
      // reads both. A simultaneous step populates `flowState.awaitingPlayers`
      // and leaves `currentPlayer` undefined; a sequential step does the
      // reverse. The awaitingPlayers path is the one that produced the
      // blank-action-bar bug on this platform — a game's opening simultaneous
      // step reported zero available actions — so leaving it out of the
      // fingerprint would omit the single most expensive skew we have had.
      // The second step is an `eachPlayer` whose body carries a `player:`
      // override, because that combination is the only one that puts a live
      // `GameElement` into BOTH halves of a serialized flow position:
      //   - `eachPlayer` binds the current Player into `position.variables`;
      //   - the `player:` override makes the engine save the PREVIOUS current
      //     player into that action step's `frame.data`, which lands in
      //     `position.frameData`.
      // Both are serialized by `serializeFlowVariables` (BSMITH-04). If either
      // side regresses to a raw spread, the marker disappears from the
      // fingerprinted position and `payloadHash` moves — which is the whole
      // point of fingerprinting the position at all. The override deliberately
      // names a seat OTHER than eachPlayer's first, so the saved previous
      // player is a genuinely different element from the acting one.
      this.setFlow(
        defineFlow({
          root: sequence(
            simultaneousActionStep({
              actions: ['bid'],
              playerDone: (_ctx: unknown, p: any) => p.hasBid,
            }),
            eachPlayer({
              do: actionStep({
                actions: ['draw'],
                player: (ctx: any) => ctx.game.getPlayer(2),
              }),
            }),
          ),
        }),
      );
    }
  }

  // Booted through GameRunner rather than by constructing the Game directly,
  // because GameRunner.start() is what actually initialises the flow — and
  // because `runner.getAllPlayerViews()` is the exact call the ShufflewickPub
  // executor makes. Fingerprinting the executor's own code path is the point:
  // a view shape that only this fixture ever produces would prove nothing.
  const runner = new GameRunner({
    GameClass: FixtureGame,
    gameType: 'engine-contract-fixture',
    gameOptions: {
      playerCount: 2,
      playerNames: ['Alice', 'Bob'],
      seed: 'engine-contract-fixture',
    },
  }) as any;

  const game = runner.game as any;

  // A default Deck — no visibility call at all. This is the fixture's most
  // important element: it is the one whose payload changed when the `Deck`
  // default moved from `hidden` to `count-only`, and the reason a payload hash
  // exists at all.
  const drawPile = game.create(Deck, 'draw-pile');
  for (let i = 0; i < 8; i += 1) {
    drawPile.create(FixtureCard, `draw-${i}`, { suit: 'H', rank: String(i + 1) });
  }

  // An explicitly count-only pile and an explicitly hidden pile, so a change to
  // either visibility mode's serialization is caught even if the Deck default
  // is left alone.
  const discard = game.create(Space, 'discard');
  discard.contentsCountOnly();
  discard.create(FixtureCard, 'discard-0', { suit: 'S', rank: 'K' });

  const secretPile = game.create(Space, 'secret-pile');
  secretPile.contentsHidden();
  secretPile.create(FixtureCard, 'secret-0', { suit: 'D', rank: 'A' });

  // Owner-visible hands: the asymmetry between "my hand" and "their hand" is
  // the hidden-information guarantee the platform relies on most.
  for (const player of game.all(Player)) {
    const hand = game.create(Hand, `hand-${player.seat}`);
    hand.player = player;
    hand.contentsVisibleToOwner();
    for (let i = 0; i < 3; i += 1) {
      hand.create(FixtureCard, `hand-${player.seat}-${i}`, { suit: 'C', rank: String(i + 1) });
    }
  }

  // Start the flow so the views carry real flow state. Without this every view
  // reports `flowState: undefined` and the hash covers only board
  // serialization — which is exactly how the flow layer stayed invisible in the
  // first version of this fixture. `assertCoversFlowLayer` below makes that
  // mistake impossible to repeat silently.
  runner.start();

  const views = runner.getAllPlayerViews();
  assertCoversFlowLayer(views);

  // Views are captured at the SIMULTANEOUS step, where both seats are on the
  // clock — that is the coverage assertCoversFlowLayer pins, and advancing
  // first would quietly drop it. The flow POSITION is captured one step later,
  // because that is where the element bindings exist.
  for (const player of game.all(Player)) {
    const bid = runner.performAction('bid', player.seat, {});
    if (!bid.success) {
      throw new Error(
        `The engine-contract fixture could not advance past its simultaneous step `
        + `(seat ${player.seat}: ${bid.error ?? 'unknown error'}). The flow position below `
        + 'would then be fingerprinted at the wrong place. Fix the fixture.',
      );
    }
  }

  const flowPosition = game.getFlowState()?.position;
  assertCoversElementBindings(flowPosition);

  // Six parts hashed together: the per-player payload the platform ships, the
  // serialized flow position the platform STORES and restores (not reachable
  // from the views — createPlayerView omits `position` — so a
  // flow-serialization regression was previously invisible here), the world
  // wire the platform's host page speaks to a bundle's world UI, ONE SEAT'S
  // PROJECTED WORLD VIEW (#181), which is what every watcher of every world
  // receives, ONE SEAT'S OFFER (#187), which is which verbs that watcher is
  // given, and THE DECLARATION WALK THAT PRODUCED IT (ShufflewickPub#374) —
  // the rounds the host was asked for, in order. The walk was claimed as
  // covered from #187 onward and was not: only its answer was hashed, so a
  // change to what a declaration may READ was invisible here as long as the
  // verbs came out the same. That is how the needs context gained an accessor
  // without moving this hash.
  const {
    view: worldView,
    rounds: worldRounds,
    offer: worldOffer,
  } = await computeWorldFixture();
  return sha256(
    canonicalize({
      views,
      flowPosition,
      worldWire: WORLD_WIRE_FIXTURE,
      worldView,
      worldRounds,
      worldOffer,
    }),
  );
}

export interface ComputedFingerprints {
  surfaceHash: string;
  payloadHash: string;
}

export async function computeFingerprints(): Promise<ComputedFingerprints> {
  return {
    surfaceHash: await computeSurfaceHash(),
    payloadHash: await computePayloadHash(),
  };
}
