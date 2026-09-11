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
 * - `formatHash` — a round trip over a COMMITTED CORPUS of world partition
 *   bytes. Catches changes to the stored form of a world, in either direction:
 *   what this engine writes, and what it can still read. It is the one
 *   fingerprint a LIVE WORLD's durability turns on, and the reason
 *   ShufflewickPub can move a world onto a newer runner at all
 *   (ShufflewickPub #390).
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
 *   and the world envelope's own `{ state, phase }` -- including that it
 *   carries no viewer, which is what lets one body answer a whole audience.
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
 *   scheduling and recurrence, keyed cancellation and refusals -- move neither
 *   hash. The BYTES `serializePartitions` writes are the exception, and they
 *   are not this fixture's to cover: `formatHash` is the third fingerprint and
 *   its only subject. Nor does eviction, nor a
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

import formatFixtureGolden from './format-fixture.json' with { type: 'json' };
import type { WorldHostMessage, WorldUiMessage } from '../ui/world/worldProtocol.js';
import { WORLD_ENGINE_METHODS } from '../world/contract.js';
import { WORLD_REFUSALS } from '../world/refusals.js';
import type { WorldEngine } from '../world/contract.js';
import type {
  WorldCreatedPartition,
  WorldGenesis,
  WorldMigrated,
  WorldMigrateContext,
  WorldSerialized,
} from '../world/runner.js';

/**
 * The committed corpus of world partition bytes. See `computeFormatHash`.
 */
const FORMAT_FIXTURE_GOLDEN = formatFixtureGolden as unknown as FormatFixture;

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
  // ShufflewickPub #399. Driven by `computeWorldDeclaration`, which seats two
  // players, retires one and hashes what the engine then answers about each --
  // so a rule dropped from `unseat` shows up as a moved payload rather than as
  // a claim nobody checked. It has to be DRIVEN rather than excused: what it
  // decides is who a world's next arrival may be, and a host that cannot retire
  // a seat has to throw its isolate away instead, which is a cost this engine
  // used to impose without recording that it did.
  unseat: true,
  offersFor: true,
  residency: true,
  viewFor: true,
  // ShufflewickPub #408. The verb a FAN-OUT travels: every notice a world sends
  // is answered through this, and the platform never asks for one view where it
  // can ask for the audience. It is driven with two lookers whose declarations
  // differ, and the hash carries both answers -- so an engine that started
  // sharing something a seat decides moves the payload rather than passing a
  // claim nobody checked. `viewFor` stays driven beside it because the two must
  // agree, and a fixture that only asked the batch could not notice them
  // parting.
  //
  // AND IT IS DRIVEN OVER A WORLD THAT DECLARES WHO MAY SEE WHAT (#414): the
  // commons holds a room granted to one looker and not the other, and a room
  // denied to one of them, so all three branches of the per-seat redaction are
  // in the payload. Before that the fixture's world declared no visibility
  // anywhere, and a change to how a grant is spelled on the wire moved neither
  // hash -- #411 rewrote the redaction and payloadHash did not notice.
  viewsFor: true,
  viewPartitions: true,

  migratePartition: 'A world MOVING BETWEEN state versions (#200), which happens once, at '
    + 'startup, before any player is in it -- never on the path this fixture drives. What it '
    + 'produces is ordinary partition bytes, whose STORED FORM is `formatHash`\'s subject; what '
    + 'this verb decides is which transformation runs, and that is unfingerprinted.',

  migrateBaseline: 'What a world MOVING BETWEEN state versions says once its bytes are in the '
    + "host's hands (ShufflewickPub #407): the roots it just serialized are what storage now "
    + 'holds, so nothing is outstanding on them. It happens once, at startup, before any player '
    + 'is in the world, and it produces NOTHING -- it moves the engine\'s own baselines, which '
    + 'no payload carries.',

  migrateFinalize: 'The last phase of a world MOVING BETWEEN state versions (ShufflewickPub '
    + '#379), which happens once, at startup, before any player is in it. It derives one root\'s '
    + 'value from another\'s, and like `migratePartition` its ANSWER is ordinary partition bytes '
    + 'while the deriving itself is unfingerprinted.',

  createMigratedPartitions: 'The other half of a world MOVING BETWEEN state versions (#218), '
    + 'which happens once, at startup, before any player is in it. What it produces is an '
    + 'ordinary partition record, exactly as `genesis` does.',
  createPartition: 'A root built the first time a declaration reaches for a name the store has '
    + 'never held (#218). The fixture\'s world starts with every partition it names, so nothing '
    + 'here ever misses -- and what it produces is an ordinary partition record.',

  pickPartitions: 'What re-asking ONE pick needs resident (ShufflewickPub #378). The fixture '
    + 'takes no action and walks no offer, so nothing here re-asks a pick. Its declaration is '
    + '`offerPartitions` for one selection, and that IS driven.',
  resolvePick: 'One selection, re-evaluated with the args a player has bound so far (#378). The '
    + 'fixture binds none -- it enumerates the offer and stops -- and what this produces is an '
    + 'ordinary `PickMetadata`, which the offer\'s own selections already fingerprint.',

  nextElementId: 'The world\'s durable id allocation stamp (ShufflewickPub #377), which a host '
    + 'reads after every write that could have minted an id. The fixture mints nothing -- it '
    + 'neither runs genesis nor creates a root -- so the number never moves here. What it '
    + 'reports is one integer, and the shape of it is covered by the surface fingerprint.',

  applyCommand: 'A world\'s write path. The fixture dispatches nothing, so the dirty set, '
    + 'rollback and the checkpoint bytes are unfingerprinted.',
  commandNeeds: 'The declaration walk a DISPATCH drives -- partitions, and the chairs a '
    + 'world-owned phase declares (ShufflewickPub #423) -- and the fixture drives none. '
    + "The offer's own walk, the same two-round shape, is covered; an offer belongs to a seat "
    + 'and a seated action may declare no chair at all, so there is nothing of #423 for the '
    + 'offer to carry.',
  evict: 'Residency policy is the host\'s, not the world\'s. The fixture never drops a '
    + 'partition, so what eviction leaves behind is unfingerprinted.',
  onEvent: 'The clock\'s road: scheduling, recurrence, keyed cancellation and event routing '
    + 'by scope. Nothing here schedules and nothing here is due.',
  seat: 'Seats are handed to the constructor, so nobody sits DOWN mid-fixture. Standing up is '
    + 'driven -- see `unseat` -- because a retirement has no constructor form: it is the one '
    + 'roster change a host makes to a world that is already built.',
  serializePartitions: 'What a checkpoint WRITES. Nothing in THIS fixture writes, so a '
    + 'dirtied partition\'s stored form moves neither of the two hashes this table is about. It '
    + 'is not unfingerprinted, though: `formatHash` drives it over a committed corpus, which is '
    + 'the whole of that hash (ShufflewickPub #390).',
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
    // WHICH COMMITTED STATE THIS PROJECTION IS OF (#244). In the fixture
    // because the whole safety of publishing the view before the offers rests
    // on the two frames naming the same number: a host that sent a state frame
    // without one would be sending an offer set nothing could be matched
    // against.
    revision: 41,
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
  world_offers: {
    source: 'shufflewick-world',
    type: 'world_offers',
    revision: 41,
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
  world_offers: Extract<WorldHostMessage, { type: 'world_offers' }>;
  world_events: Extract<WorldHostMessage, { type: 'world_events' }>;
  world_response: Extract<WorldHostMessage, { type: 'world_response' }>;
  world_command: Extract<WorldUiMessage, { type: 'world_command' }>;
  world_ready: Extract<WorldUiMessage, { type: 'world_ready' }>;
};

/**
 * WHAT A HOST MUST PERSIST, one canonical literal per shape (#224).
 *
 * The same known limit `WORLD_WIRE_FIXTURE` exists for, on the other side of
 * the world: these are the answers `runner.genesis`, `runner.serialize`,
 * `runner.createPartition` and `runner.migrateAll` hand a host, and they are
 * ALL TYPES, which `surfaceHash` cannot see. A field added to or removed from
 * any of them changes what ShufflewickPub and `boardsmith dev` must write in a
 * transaction, and before this fixture existed it moved neither hash.
 *
 * That is not hypothetical. #377 made the allocation stamp durable and named
 * three of the four roads that move it; #224 was the fourth -- an ordinary
 * command that creates an element -- and the shape change that closed it, a
 * checkpoint answering `{ partitions, nextElementId }` instead of bare bytes,
 * minted no revision here until this literal did it.
 *
 * `satisfies` is the mechanism, exactly as it is for the wire: adding a
 * required field refuses to compile until the fixture carries it, and the
 * moment it does, `payloadHash` moves and `boardsmith contract --update` is
 * demanded. The values are arbitrary but fixed; only their shape and their
 * canonical serialization matter.
 */
const WORLD_DURABILITY_FIXTURE = {
  genesis: {
    partitions: {
      world: { parentId: 0, json: { id: 1_000_000, className: 'World' } },
      'room:cellar': { parentId: 1_000_000, json: { id: 1_000_001, className: 'Room' } },
    },
    nextElementId: 1_000_002,
  },
  checkpoint: {
    partitions: { 'room:cellar': '{"id":1000001,"className":"Room"}' },
    nextElementId: 1_000_009,
  },
  created: {
    partition: { parentId: 1_000_000, json: { id: 1_000_009, className: 'Room' } },
    nextElementId: 1_000_010,
  },
  migrated: {
    partitions: { 'room:cellar': '{"id":1000001,"className":"Room"}' },
    created: { 'room:attic': { parentId: 1_000_000, json: { id: 1_000_010, className: 'Room' } } },
    nextElementId: 1_000_011,
  },
  // ONE MIGRATION CALL'S CONTEXT (ShufflewickPub #402). A page is a real
  // difference in what the platform sends and what comes back, and it is all
  // types -- `surfaceHash` cannot see one, exactly as it could not see #224's
  // checkpoint shape.
  migrateWhole: { from: 1, to: 2 },
  migratePage: { from: 1, to: 2, allNames: ["room:a", "room:b"], runCreate: true },
} satisfies {
  genesis: WorldGenesis;
  checkpoint: WorldSerialized;
  created: WorldCreatedPartition;
  migrated: WorldMigrated;
  migrateWhole: WorldMigrateContext;
  migratePage: WorldMigrateContext;
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

  // THE REFUSAL REGISTRY IS PART OF THE SURFACE (ShufflewickPub #382).
  //
  // `describeExport` opens classes and functions and stops at plain objects, so
  // `WORLD_REFUSALS` contributed its NAME and nothing else -- and a refusal code
  // is not an implementation detail. The platform's park ladder branches on the
  // code and on its owner: `platform` parks a world after two, `game`
  // dead-letters, `caller` does neither. So adding a code, removing one, or
  // moving one between owners changes what the platform DOES to a live world,
  // and until now it moved neither hash.
  //
  // Codes and owners only, never the `why` prose, which is written for people
  // and would make this hash move on every clarification.
  const refusals = Object.entries(WORLD_REFUSALS)
    .map(([code, entry]) => `${code}:${entry.owner}`)
    .sort();
  lines.push(`world-refusals: ${refusals.join(',')}`);

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
  const projected = (view ?? {}) as {
    player?: unknown;
    phase?: unknown;
    state?: { children?: unknown[] };
  };
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
    // THE ENVELOPE, AND WHAT IS NOT IN IT (ShufflewickPub #408). A view is what
    // the world looks like through one declaration; who is looking is a fact
    // about the attachment, which the platform answers on the frame that seats
    // you. The absence is asserted rather than assumed, because a `player` back
    // in here would silently make every body in a fan-out distinct again and
    // the hash would move without anybody reading why.
    ['a world envelope carrying `phase`', 'phase' in projected],
    ['a world envelope carrying NO viewer (`player` is back)', projected.player === undefined],
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
 * Fail loudly if the fixture's FAN-OUT stopped covering the per-seat redaction
 * (ShufflewickPub #414).
 *
 * The same guard as the two beside it, closing the same class of gap and for
 * the third time in this file's history. Until #414 the fixture's world
 * declared no element or zone visibility anywhere, so `redactVisibilityForSeat`
 * never ran over it and the redaction was a road nobody drove: #411 rewrote how
 * a grant is spelled on the wire and `payloadHash` did not move, and the
 * platform heard about the revision only because an unrelated rename moved the
 * SURFACE.
 *
 * WHAT CAN BE ASSERTED, AND WHAT CANNOT. A grant is deliberately spelled so
 * that a granted reader cannot tell a room it was let into from a room that was
 * public all along, so no guard can read "this reader was granted" back out of
 * the bytes. What it CAN read is that the redaction is load-bearing -- one
 * looker holds a room's contents and another does not -- and that no body names
 * a seat. Those two together fail the moment the fixture's world goes back to
 * declaring nothing.
 *
 * COVERAGE, NOT CORRECTNESS, like its neighbours: WHICH bytes each reader gets
 * is what `payloadHash` records.
 */
function assertCoversWorldRedaction(bodies: readonly unknown[]): void {
  const encoded = bodies.map((body) => JSON.stringify(body));
  const covers: readonly (readonly [string, boolean])[] = [
    [
      'a reader shown the contents of a room whose visibility is DECLARED',
      encoded.some((body) => body.includes('"well"')),
    ],
    [
      'a reader shown NOTHING of that same room',
      encoded.some((body) => !body.includes('"well"')),
    ],
    [
      'a redaction that names NO seat (a grant roster is on the wire)',
      encoded.every(
        (body) => !body.includes('addPlayers') && !body.includes('exceptPlayers'),
      ),
    ],
  ];

  assertCovers(
    "a world's per-seat redaction",
    covers,
    'payloadHash would still change and still look healthy while covering the visibility '
    + 'boundary every seat in every scoped world is held behind not at all.',
  );
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
 * The states, and why each is here. The first four are about what a pick
 * looks like; the last three are about where the panel puts the verb's button.
 *
 *  - NO SELECTION AT ALL. The offer's floor. An action with nothing to ask can
 *    never be candidateless, so it is the control against which the other three
 *    are read.
 *  - A MULTILINE TEXT FIELD (#229). The pick a host draws a box for rather than
 *    a line, and the flag that says so is an OPTIONAL FIELD on a text pick --
 *    which `verbatimModuleSyntax` erases along with the type declaring it. Only
 *    a fixture that produces one puts it in front of a hash.
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
 *  - A NESTED MENU GROUP, AN ORDER STANDING ALONE, AND NEITHER (#228). The
 *    action panel's hierarchy is metadata on the offer, and the fixture has to
 *    STAND IN each of its three states before the hash can see any of them: a
 *    two-level path, an order with no group, and the absence a game that
 *    declares no hierarchy sends. Absence counts because the wire distinguishes
 *    "no placement" from "a placement of nothing", and an engine that began
 *    emitting `group: []` would be flattening every world's panel.
 */
function assertCoversWorldOffer(facts: {
  selectionShapes: readonly (readonly string[])[];
  menuPlacements: readonly { group?: readonly string[]; order?: number }[];
  multilineTextIsOffered: boolean;
  ownLandIsBare: boolean;
  everyNeighbourIsGreyed: boolean;
}): void {
  const shapes = facts.selectionShapes;
  const placements = facts.menuPlacements;

  const covers: readonly (readonly [string, boolean])[] = [
    ['an action with no selection at all', shapes.some((shape) => shape.length === 0)],
    ['an action whose selection is a number', shapes.some((shape) => shape.join() === 'number')],
    ['an action whose selection is an element', shapes.some((shape) => shape.join() === 'element')],
    // #229. `multiline` is an optional field on a text pick, so nothing but a
    // text pick that sets it can put it in front of a fingerprint.
    ['an action whose selection is multiline text', facts.multilineTextIsOffered],
    // The action panel's hierarchy (#228). All three states, because all three
    // are bytes on the offer: a nested path, an order standing alone, and the
    // absence that a game declaring no hierarchy sends.
    [
      'an action placed in a nested menu group',
      placements.some((placement) => (placement.group?.length ?? 0) > 1),
    ],
    [
      'an action ordered but not grouped',
      placements.some((placement) => placement.order !== undefined && placement.group === undefined),
    ],
    [
      'an action with no menu placement at all',
      placements.some((placement) => placement.group === undefined && placement.order === undefined),
    ],
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
 * partitions resident and answers `{ state, phase }` per seat, pruned
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
/**
 * WHAT A HOST LEARNS FROM A BUNDLE BEFORE IT RUNS ANYTHING (ShufflewickPub #399).
 *
 * `createWorld`'s answer beside the runner: how many chairs this world has, and
 * which of its verbs gives a departed seat's ground back. Both are facts a host
 * must have BEFORE it can decide anything -- the first to refuse a seating
 * before it writes one, the second to know whether a chair can ever come back
 * at all and what to run when one is leaving.
 *
 * IT IS HERE FOR THE REASON `WORLD_DURABILITY_FIXTURE` IS. `world.vacate` is a
 * declaration: adding it changed what a host may read off a bundle and what it
 * may then do with a seat, and `verbatimModuleSyntax` erases a type, so it
 * moved neither hash on its own. That is the KNOWN LIMIT at the top of this
 * file, and the limit's own prescribed answer is to extend the fixture until
 * the change is visible rather than to accept an unrecorded one.
 *
 * The stakes moved with ShufflewickPub #390: a live world now derives its
 * runner as the newest archived revision declaring its serialization format,
 * with no per-world gate, so a platform-reachable surface that records no
 * revision is something a running world can be moved onto silently.
 *
 * ENGINE-PRODUCED rather than a literal, unlike the durability fixture: this
 * one CAN be produced, because `createWorld` is the call a host makes and its
 * answer canonicalizes. So the hash covers the validation too -- a rule dropped
 * from `worldVacateAction` lets a declaration through that this fixture would
 * then report differently.
 */
async function computeWorldDeclaration(): Promise<unknown> {
  const engine = await import('../engine/index.js');
  const { createWorld, worldAction } = await import('../world/index.js');
  const { Game, Space } = engine as any;

  class DeclarationHolding extends Space<any> {}
  class DeclarationWorld extends Game<any, any> {
    constructor(options: any) {
      super(options);
      this.registerElements([DeclarationHolding]);
    }
  }

  const abandon = worldAction<any>('abandon')
    .needs(({ player }: any) => [`holding:${player.seat}`])
    .execute((_args: any, ctx: any) => {
      ctx.world.partition(`holding:${ctx.player.seat}`);
    });

  const built = createWorld({
    definition: {
      // `as any` for the reason every other class in this file carries one: the
      // fixture's game is declared with `any` generics so it needs none of the
      // engine's own type plumbing, and its construct signature is then not the
      // nominal one `createWorld` names.
      gameClass: DeclarationWorld as any,
      world: {
        maxPlayers: 3,
        actions: [abandon],
        view: (seat: number) => [`holding:${seat}`],
        // DECLARED, so the field is exercised rather than merely typed. A world
        // that named nothing would hash the same as one built by an engine that
        // had never heard of the field.
        vacate: 'abandon',
      },
    },
    seed: 'engine-contract-declaration',
    // HANDED TO THE CONSTRUCTOR, as every other seat in this file is, so the
    // `seat` verb's stated limit stays true and only the retirement is driven.
    seats: new Map([['stays', 1], ['leaves', 2]]),
  });

  // AND THE OTHER HALF OF A WORLD'S ROSTER (#399): the chair a departure gives
  // back. Two seats, one retired, and what the engine answers about each
  // afterwards -- which is the only observable a retirement HAS, because it
  // moves nothing in the world and forgets a mapping.
  built.runner.unseat("leaves");
  const seatedAfterUnseat = {
    stays: await declarationRefusal(built, "stays"),
    leaves: await declarationRefusal(built, "leaves"),
    // IDEMPOTENT, so a host retrying a departure it may already have applied is
    // the ordinary case rather than a refusal.
    leavesAgain: (() => {
      built.runner.unseat("leaves");
      return "no refusal";
    })(),
  };

  return { seatCount: built.seatCount, vacate: built.vacate, seatedAfterUnseat };
}

/**
 * What this world says when asked what one player's command would need.
 *
 * The narrowest road that resolves a seat, so a retired holder answers
 * `unknown-player` and a seated one answers its declaration. The CODE is
 * hashed rather than the message: a sentence is prose and would move this hash
 * for a wording change, where the code is what a host branches on.
 */
async function declarationRefusal(built: any, player: string): Promise<string> {
  try {
    built.runner.commandNeeds(player, { name: "abandon", args: {} }, 0, []);
    return "declared";
  } catch (error: any) {
    return typeof error?.code === "string" ? error.code : "threw without a code";
  }
}

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
    // THE PROMPT READS THE ACTIVITY WATERMARK (ShufflewickPub #383), which is
    // what puts the field inside the payload hash. A stamp field is a TYPE, and
    // a type moves neither fingerprint on its own -- see the KNOWN LIMIT above
    // -- so a host that stopped sending `activity`, or an engine that stopped
    // deriving `inactiveSince` from it, would change what every world prompt
    // says with nothing to record it. Rendering it here is also the real use:
    // "you have been away N days" is a sentence an OFFER has to be able to make.
    .prompt(({ world }: any) =>
      world.activity === null
        ? 'Look about you'
        : `Look about you (away ${world.now - world.activity.inactiveSince}ms)`,
    )
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
    // AN ORDER WITHOUT A GROUP (#228), which is the placement a game declares
    // to promote a common verb without nesting anything.
    .order(10)
    .needs(() => [COMMONS])
    .enterNumber('logs', { prompt: 'How many?', min: 1, max: 9 })
    .execute((args: any, ctx: any) => {
      (ctx.world.partition(COMMONS) as any).embers += args.logs;
    });

  // A MULTILINE TEXT PICK, WHICH IS ONLY VISIBLE HERE (#229). `multiline` is an
  // optional field on a `text` pick's metadata, and `verbatimModuleSyntax`
  // erases the type that declares it -- so on its own it moved neither hash
  // while changing the control every host draws for a text selection. That is
  // the exact shape ShufflewickPub #414 recorded, and the answer is the same
  // one: put a field the platform can see into something the fixture actually
  // produces. A world is also where the long fields live, since an empire's
  // description outlives any one session.
  const post = worldAction<any>('post')
    .prompt('Leave word on the common notice board')
    .needs(() => [COMMONS])
    .enterText('notice', {
      prompt: 'What to post',
      minLength: 2,
      maxLength: 240,
      multiline: true,
    })
    .execute((args: any, ctx: any) => {
      (ctx.world.partition(COMMONS) as any).notice = args.notice;
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
    // A NESTED MENU PATH (#228). The action panel's hierarchy is metadata on
    // the offer, and a TYPE moves neither fingerprint on its own -- the KNOWN
    // LIMIT at the top of this file, and the lesson ShufflewickPub #414
    // recorded. So the fixture DECLARES a placement, two levels deep, and the
    // bytes a host relays carry it. An engine that stopped emitting `group`
    // would give every world a flat panel again, and this is what makes that
    // move the payload rather than pass unrecorded.
    //
    // ON `tend` RATHER THAN `raze`, because `raze` is deliberately absent from
    // this fixture's offer and a placement there would reach no wire.
    // `tend` is offered WITH its disabled reason, so the payload also carries
    // the combination a player actually meets: a greyed verb inside a group.
    .group('Land', 'Clearing')
    .order(30)
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

  // WHAT A SEAT MAY SEE, PUT WHERE THE FAN-OUT WILL HASH IT (ShufflewickPub
  // #414). Until this, the fixture's world declared no element or zone
  // visibility ANYWHERE, so `redactVisibilityForSeat` never ran over anything
  // in it and no `visibility`/`zoneVisibility` field reached a fingerprinted
  // view. #411 rewrote exactly those bytes -- what a scoped room says to a
  // granted seat and to a denied one -- and payloadHash did not move; the
  // platform was told only because an unrelated rename moved the SURFACE. A
  // redaction change on its own would have shipped silently to the vendored
  // clone, which is the one thing this file exists to prevent.
  //
  // TWO ROOMS ON THE COMMONS, because the redaction has three branches and the
  // commons is the partition BOTH lookers declare. The wellhouse is granted to
  // seat one and not to seat two; the noticeboard is denied to seat two and
  // left to its base mode for seat one. So one fan-out carries a granted
  // reader, an ungranted one and a denied one, and each is hashed as the bytes
  // that reader actually receives.
  const wellhouse = commons.create(WorldFixtureCommons, 'wellhouse', { embers: 1 });
  wellhouse.create(WorldFixtureHolding, 'well', { seat: 0, standing: 1 });
  wellhouse.contentsHidden();
  wellhouse.addZoneVisibleTo(LOOKER_SEAT);
  const noticeboard = commons.create(WorldFixtureCommons, 'noticeboard', { embers: 0 });
  noticeboard.create(WorldFixtureHolding, 'notice', { seat: 0, standing: 1 });
  noticeboard.hideContentsFrom(2);

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
    actions: [look, kindle, tend, raze, post],
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

  // THE FAN-OUT, DRIVEN THE WAY A NOTICE DRIVES IT (ShufflewickPub #408). Every
  // watcher a world-scoped change is addressed to is described in ONE call, so
  // this is the road a world actually spends its time on and the one whose
  // answer a platform reads. Two lookers whose declarations differ -- each
  // names the commons and their OWN land -- plus a stranger the world does not
  // seat, so the hash carries what a batch answers AND what it refuses. An
  // engine that started sharing something a seat decides moves this.
  //
  // A REFUSAL IS HASHED AS ITS SENTENCE, because the raw throw is what the
  // engine hands over -- the runner is what turns one into a platform refusal
  // -- and an Error object does not canonicalize.
  const told = await world.viewsFor([LOOKER, 'p2', 'nobody']);
  assertCoversWorldRedaction(told.bodies);
  const audience = {
    // EACH DISTINCT ANSWER ONCE, which is the thing a host reads as permission
    // to encode a fan-out once. The two lookers name different land, so this
    // fixture's audience is two bodies rather than one -- an engine that
    // collapsed them would be sharing across declarations and moves this.
    bodies: told.bodies,
    seats: told.seats.map((seat) =>
      seat.refused
        ? {
            player: seat.player,
            refused: true,
            message: seat.failure instanceof Error ? seat.failure.message : String(seat.failure),
          }
        : { player: seat.player, refused: false, at: seat.at },
    ),
  };

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
    // STAMPED WITH THE OFFER'S OWN INSTANT (#375), which is what `offersFor`
    // below is given: the walk and the answer must agree about what time it is.
    const needs = world.offerPartitions(LOOKER, OFFER_STAMP.now);
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
    selectionShapes: [look, kindle, tend, raze, post].map((definition) =>
      definition.selections.map((selection) => selection.type),
    ),
    // READ OFF THE OFFER RATHER THAN THE DECLARATION, because the declaration
    // is not what a host receives. A `multiline` that survived the builder and
    // was dropped by `buildPickMetadata` would leave this false while the
    // fixture looked complete.
    multilineTextIsOffered: offer.some((verb: { selections?: readonly unknown[] }) =>
      (verb.selections ?? []).some(
        (pick) => (pick as { type?: string; multiline?: boolean }).multiline === true,
      ),
    ),
    // OFF THE OFFER FOR #229's REASON, AND FOR A SHARPER ONE (#228). A
    // placement dropped by `offerOf` would leave the panel flat with the
    // declaration still reading correctly -- and reading the DECLARATIONS here
    // was worse than merely weaker: it counted `raze`, which this fixture
    // deliberately keeps OUT of the offer (its every candidate is greyed), so
    // a nested path declared there would have satisfied the guard while
    // reaching no wire at all.
    menuPlacements: offer.map((verb: { group?: readonly string[]; order?: number }) => ({
      group: verb.group,
      order: verb.order,
    })),
    ownLandIsBare: isBare(holdingOf(live, LOOKER_SEAT)),
    everyNeighbourIsGreyed: neighboursOf(LOOKER_SEAT).every((seat) =>
      isAtFullGrowth(holdingOf(live, seat)),
    ),
  });

  return { view, audience, rounds, offer };
}

/**
 * WHAT THE HOST KNOWS WHEN IT ASKS FOR AN OFFER, fixed.
 *
 * Time and presence live outside a world and arrive as arguments, precisely so
 * that a world computes the same offer however busy its host is. Fixed here for
 * the same reason the seed is: a fingerprint that read a clock would drift on
 * its own, and a fingerprint that drifts trains everyone to re-record it.
 */
const OFFER_STAMP = {
  now: 1_700_000_000_000,
  presence: [1] as readonly number[],
  // The watching seat's durable idleness (ShufflewickPub #383). Fixed here so
  // the fingerprint covers the field: a world's offer may render "you expire
  // in N days", and a host that stopped sending this would change what every
  // prompt says without changing any hash.
  activity: { seat: 1, at: 1_699_000_000_000, since: 1_600_000_000_000 },
};

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

  // Seven parts hashed together: the per-player payload the platform ships, the
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
  // without moving this hash. The seventh is WHAT A HOST LEARNS FROM THE
  // BUNDLE BEFORE IT RUNS ANYTHING (ShufflewickPub #399) — the chair count and
  // the vacate verb `createWorld` answers with — which is a declaration and so
  // was invisible here for the KNOWN LIMIT's reason until it was produced.
  const worldDeclaration = await computeWorldDeclaration();
  const {
    view: worldView,
    audience: worldAudience,
    rounds: worldRounds,
    offer: worldOffer,
  } = await computeWorldFixture();
  return sha256(
    canonicalize({
      views,
      flowPosition,
      worldWire: WORLD_WIRE_FIXTURE,
      // What a host must land in one transaction (#224). Types only, so
      // `surfaceHash` is blind to it and `payloadHash` is where it belongs.
      worldDurability: WORLD_DURABILITY_FIXTURE,
      worldView,
      // The FAN-OUT's answer (ShufflewickPub #408): what a whole audience is
      // told in one call, and which of them is refused.
      worldAudience,
      worldRounds,
      worldOffer,
      worldDeclaration,
    }),
  );
}

/**
 * THE STORED FORM OF A WORLD'S PARTITIONS (ShufflewickPub #390).
 *
 * `surfaceHash` and `payloadHash` answer "what can the platform CALL" and
 * "what does a seat RECEIVE". Neither answers the question a live world's
 * durability actually turns on: CAN THIS ENGINE READ THE BYTES THAT ENGINE
 * WROTE. So ShufflewickPub pinned each world to the exact engine revision it
 * launched on, for life, because the one property it needed to compare was the
 * one property nothing here measured -- and a pin over everything means no
 * engine fix ever reaches a live world, and the runner archive grows one engine
 * per revision with nothing ever retirable.
 *
 * `formatHash` is that missing measurement. Two revisions declaring the same
 * `formatHash` can be swapped under a live world; two that differ cannot.
 *
 * ## It is a ROUND TRIP over COMMITTED GOLDEN BYTES, not a hash of an output
 *
 * The obvious design -- serialize a fixture and hash the bytes -- covers only
 * the WRITER, and the one format break already in ShufflewickPub's archive was
 * reader-only. `WORLD_PARTITION_ID_FLOOR` entered `adoptSubtree` in r46: the
 * bytes an r44 world wrote are byte-identical to what r46 writes, and r46
 * refuses to adopt them anyway ("element id 14 is already resident"). A
 * writer-side hash calls those two revisions one format and licenses exactly
 * the swap that corrupts the world.
 *
 * So `format-fixture.json` is a COMMITTED CORPUS -- real bytes this engine
 * once produced, kept forever -- and the hash covers three answers about it:
 *
 * - `golden`: the corpus itself, so the thing being compared is fixed.
 * - `fresh`: what the engine WRITES today, from the same fixture world, through
 *   `WorldEngine.createPartition`.
 * - `alone` / `both`: what the engine WRITES AFTER READING the corpus back,
 *   once with only the ledger resident and once with the vault too. A reader
 *   that drops a field, decodes a Map differently, or resolves a reference it
 *   used to leave alone moves these even though `fresh` never stirs.
 *
 * A reader that REFUSES the corpus cannot produce a hash at all, and that is
 * the correct answer rather than a missing one: it is a deliberate format
 * break, it is stated by name, and it ends every world holding those bytes.
 *
 * ## The two-partition shape is the point
 *
 * `alone` hydrates the ledger WITHOUT the vault, so the ledger's reference into
 * the vault is a reference into a partition that is not resident. That
 * survives adoption as a bare `{ __elementId }` and must survive
 * re-serialization unchanged (`Game#adoptSubtree`, `GameElement.deserializeValue`).
 * A reader that resolved it to `undefined` would silently delete a live world's
 * cross-room links, and no single-partition fixture can see that.
 *
 * ## What is deliberately NOT in here
 *
 * The parent-to-child CHECKPOINT ANSWER SHAPE. That is host protocol, not
 * stored bytes: the platform's parent speaks to many child revisions at once
 * and changing that shape strands nothing durable. Folding it in would make
 * two revisions different FORMATS over a change that touched no stored byte,
 * which licenses refusing a swap that is perfectly safe. It stays in
 * `payloadHash`, where `WORLD_DURABILITY_FIXTURE` already holds it.
 *
 * Views, offers, the declaration walk, flow position, refusals, `applyCommand`,
 * `onEvent`, scheduling, budgets and the game ROOT's own `toJSON` fields are
 * all out for the same reason: none of them is a byte a partition holds. The
 * root is rebuilt by the bundle on every wake and is never a partition.
 */

/** The stored bytes of one partition, as `WorldPartitionStore` answers them. */
interface FormatFixturePartition {
  readonly parentId: number;
  readonly json: unknown;
}

/**
 * THE COMMITTED CORPUS: partitions this engine wrote once, kept forever.
 *
 * Regenerated only by `boardsmith contract --regenerate-format`, and only for
 * a deliberate format break -- regenerating it is what makes every world
 * holding the old bytes unreadable, so it is not a step in an ordinary
 * revision.
 */
interface FormatFixture {
  readonly nextElementId: number;
  readonly partitions: Readonly<Record<string, FormatFixturePartition>>;
}

const FORMAT_FIXTURE_SEATS = 3;
const FORMAT_FIXTURE_LEDGER = 'ledger';
const FORMAT_FIXTURE_VAULT = 'vault';

/** Vault first: the ledger holds a reference INTO it, so it has to exist. */
const FORMAT_FIXTURE_ORDER: readonly string[] = [FORMAT_FIXTURE_VAULT, FORMAT_FIXTURE_LEDGER];

/**
 * The fixture world, its classes, and the hook that builds its partitions.
 *
 * Defined here rather than borrowed from `src/world/village.test-helper.ts` or
 * from an example game, for the reason the other two fixtures give: a shared
 * helper is reshaped by whoever is writing tests and an example game by its
 * designer, and this hash must move for engine reasons alone.
 *
 * Every encoding `GameElement.serializeValue` has a branch for is present, and
 * `assertCoversFormat` proves it rather than trusting this comment.
 */
async function formatFixtureWorld(options: {
  nextElementId: number;
  store: { read(name: string): Promise<FormatFixturePartition | undefined>; forget(): void };
}): Promise<any> {
  const engineModule = await import('../engine/index.js');
  const { BoardSmithWorldEngine } = await import('../world/index.js');
  const { Game, Player, Space, Piece } = engineModule as any;

  class FormatFixturePlayer extends Player<any, any> {}

  class FormatFixtureCoin extends Piece<any> {
    denomination = 0;
  }

  class FormatFixtureChest extends Space<any> {
    sealed = false;
  }

  class FormatFixtureVault extends Space<any> {
    depth = 0;
  }

  class FormatFixtureLedger extends Space<any> {
    /** A player, which serializes as `__playerRef` rather than as an element. */
    owner: any = undefined;
    /** An element in ANOTHER partition, which is `__elementId` and stays one. */
    reserve: any = undefined;
    tallies: Map<string, number> = new Map();
    marks: Set<string> = new Set();
    terrain: Uint8Array = new Uint8Array();
    audit: unknown[] = [];
    header: Record<string, unknown> = {};
  }

  class FormatFixtureWorld extends Game<any, any> {
    static PlayerClass = FormatFixturePlayer;

    constructor(gameOptions: any) {
      super(gameOptions);
      // Registered in the CLASS constructor: world mode has no handler re-bind
      // pass on adoption, so anything a grafted element needs must come from
      // its own class.
      this.registerElements([
        FormatFixtureCoin,
        FormatFixtureChest,
        FormatFixtureVault,
        FormatFixtureLedger,
      ]);
    }
  }

  const game = new FormatFixtureWorld({
    playerCount: FORMAT_FIXTURE_SEATS,
    seed: 'engine-contract-format-fixture',
    worldMode: true,
  });

  const build = (built: any, name: string): any => {
    if (name === FORMAT_FIXTURE_VAULT) {
      const vault = built.create(FormatFixtureVault, 'vault', { depth: 2 });
      const strongbox = vault.create(FormatFixtureChest, 'strongbox', { sealed: true });
      // Zone visibility, which only `Space#toJSON` emits and only when explicit.
      strongbox.contentsHidden();
      const ingot = strongbox.create(FormatFixtureCoin, 'ingot', { denomination: 50 });
      // Explicit element visibility, which is a COPY in the bytes.
      ingot.showOnlyTo(1);
      return vault;
    }
    if (name === FORMAT_FIXTURE_LEDGER) {
      const ledger = built.create(FormatFixtureLedger, 'ledger');
      ledger.owner = built.players[0];
      ledger.reserve = built.first(FormatFixtureCoin, 'ingot');
      ledger.tallies = new Map([
        ['grain', 12],
        ['timber', 7],
      ]);
      ledger.marks = new Set(['sealed', 'audited']);
      ledger.terrain = new Uint8Array([0, 1, 2, 253, 254, 255]);
      ledger.audit = [1, 'two', null, true, [3, 4], { note: 'nested' }];
      ledger.header = { season: 3, deep: { deeper: [5, { deepest: true }] } };
      // Nesting, so a subtree is more than one level.
      const page = ledger.create(FormatFixtureChest, 'page-1', { sealed: false });
      page.create(FormatFixtureCoin, 'penny', { denomination: 1 });
      return ledger;
    }
    return undefined;
  };

  return new BoardSmithWorldEngine({
    game,
    seats: new Map<string, number>(
      Array.from({ length: FORMAT_FIXTURE_SEATS }, (_unused, index) => [
        `p${index + 1}`,
        index + 1,
      ]),
    ),
    store: options.store,
    actions: [],
    view: () => FORMAT_FIXTURE_ORDER,
    createPartition: build,
    nextElementId: options.nextElementId,
  });
}

/** A store that holds nothing, for the WRITE side, which reads no bytes. */
const EMPTY_FORMAT_STORE = {
  async read(): Promise<FormatFixturePartition | undefined> {
    return undefined;
  },
  forget(): void {},
};

/**
 * WRITE the fixture's partitions with today's engine, through the engine's own
 * creation path rather than by calling `toJSON` behind its back.
 *
 * The ids start at `WORLD_PARTITION_ID_FLOOR` because that is where a real
 * world's own elements start, and starting there makes the corpus independent
 * of how many seats the fixture's construction happened to spend.
 */
export async function buildFormatFixture(): Promise<FormatFixture> {
  const { WORLD_PARTITION_ID_FLOOR } = (await import('../engine/index.js')) as any;
  const engine = await formatFixtureWorld({
    nextElementId: WORLD_PARTITION_ID_FLOOR,
    store: EMPTY_FORMAT_STORE,
  });

  const partitions: Record<string, FormatFixturePartition> = {};
  for (const name of FORMAT_FIXTURE_ORDER) {
    const created = engine.createPartition(name) as FormatFixturePartition | undefined;
    if (created === undefined) {
      throw new Error(
        `The format fixture's builder answered nothing for partition "${name}". Every name in `
        + 'FORMAT_FIXTURE_ORDER must be built by the hook in formatFixtureWorld.',
      );
    }
    partitions[name] = { parentId: created.parentId, json: throughStorage(created.json) };
  }

  return { nextElementId: engine.nextElementId(), partitions };
}

/**
 * READ the committed corpus back and write it out again.
 *
 * `names` is which partitions are made resident, and that choice is the whole
 * reason this takes an argument: hydrating the ledger alone leaves its
 * reference into the vault pointing at an element no tree holds, which is the
 * state a real world spends most of its life in.
 */
async function reserializeFormatFixture(
  golden: FormatFixture,
  names: readonly string[],
): Promise<{ nextElementId: number; partitions: Record<string, unknown> }> {
  const engine = await formatFixtureWorld({
    nextElementId: golden.nextElementId,
    store: {
      async read(name: string) {
        return golden.partitions[name];
      },
      forget(): void {},
    },
  });

  await engine.hydrate(names);
  const written = (await engine.serializePartitions(names)) as Record<string, string>;
  const partitions: Record<string, unknown> = {};
  for (const name of names) partitions[name] = JSON.parse(written[name] as string);
  return { nextElementId: engine.nextElementId(), partitions };
}

/**
 * Fail loudly if the fixture stopped exercising an encoding a world's bytes use.
 *
 * The same guard the view and offer fixtures carry, for the same reason: a
 * fixture that quietly narrows turns "unverified" into "verified", and the hash
 * goes on moving for other reasons while covering the dropped encoding not at
 * all. Here that would license swapping the runner under a live world across a
 * change to whatever fell out.
 */
function assertCoversFormat(what: string, bytes: unknown): void {
  const text = JSON.stringify(bytes) ?? '';
  assertCovers(
    `${what} of a world's stored bytes`,
    [
      ['a player reference (__playerRef)', text.includes('"__playerRef"')],
      ['a cross-partition element reference (__elementId)', text.includes('"__elementId"')],
      ['a Map (__map)', text.includes('"__map"')],
      ['a Set (__set)', text.includes('"__set"')],
      ['a typed array (__typedArray)', text.includes('"__typedArray"')],
      ['explicit element visibility', text.includes('"visibility"')],
      ['explicit zone visibility', text.includes('"zoneVisibility"')],
      ['a named element', text.includes('"name"')],
      ['nested children', text.includes('"children"')],
      [
        "ids above the world's construction floor",
        /"id":\s*1\d{6}/.test(text),
      ],
    ],
    'formatHash would go on moving for other reasons while saying nothing about the encoding '
    + 'that fell out -- and two revisions that disagree about it would then be declared the same '
    + "format, which is a licence to swap the engine under a live world's bytes.",
  );
}

/**
 * The serialization format of a world's durable partitions, as one hash.
 *
 * See the block comment above `FormatFixturePartition` for what is in it and
 * what is deliberately not.
 */
export async function computeFormatHash(): Promise<string> {
  const golden = FORMAT_FIXTURE_GOLDEN;
  assertCoversFormat('the committed corpus', golden);

  const fresh = await buildFormatFixture();
  assertCoversFormat('what the engine writes today', fresh);

  const read = async (names: readonly string[]): Promise<unknown> => {
    try {
      return await reserializeFormatFixture(golden, names);
    } catch (error) {
      // A DELIBERATE FORMAT BREAK, SAID BY NAME. There is no hash to answer
      // here: the engine cannot read bytes of its own lineage, so every world
      // holding them is unreadable and no swap can be licensed. Regenerating
      // the corpus is the acknowledgement of that, not a way around it.
      throw new Error(
        'THIS ENGINE CAN NO LONGER READ THE COMMITTED WORLD FORMAT FIXTURE '
        + `(${names.join(', ')}): ${error instanceof Error ? error.message : String(error)}\n\n`
        + 'src/contract/format-fixture.json holds partition bytes this engine once wrote, and a '
        + 'reader that refuses them refuses every live world written under them. On '
        + 'ShufflewickPub that means those worlds end -- they cannot be migrated, because nothing '
        + 'can read them.\n\n'
        + 'If the break is deliberate and that cost is accepted:\n'
        + '  boardsmith contract --regenerate-format\n'
        + '  boardsmith contract --update --summary "<what stored bytes now look like>"\n\n'
        + 'If it is not, the reader change is a bug: fix it rather than the corpus.',
      );
    }
  };

  // The ledger alone, so its reference into the vault points at an element no
  // tree holds; then both, so the same reference resolves to a live element.
  // A reader that changed its mind about either moves this hash.
  const alone = await read([FORMAT_FIXTURE_LEDGER]);
  const both = await read(FORMAT_FIXTURE_ORDER);

  return sha256(canonicalize({ golden, fresh, alone, both }));
}

export interface ComputedFingerprints {
  surfaceHash: string;
  payloadHash: string;
  formatHash: string;
}

export async function computeFingerprints(): Promise<ComputedFingerprints> {
  return {
    surfaceHash: await computeSurfaceHash(),
    payloadHash: await computePayloadHash(),
    formatHash: await computeFormatHash(),
  };
}
