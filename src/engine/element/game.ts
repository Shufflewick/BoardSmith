import { Space, type ElementEventHandler } from './space.js';
import { GameElement, hasZoneVisibility, isPlayerElement, readDynamicAttribute, registerElementClass, HIDDEN_PLACEHOLDER_ATTRIBUTE } from './game-element.js';
import { Piece } from './piece.js';
import { Card } from './card.js';
import { Hand } from './hand.js';
import { Deck } from './deck.js';
import { Die } from './die.js';
import { DicePool } from './dice-pool.js';
import { Grid, GridCell } from './grid.js';
import { HexGrid, HexCell } from './hex-grid.js';
import type { ElementAttributes, ElementContext, ElementClass, ElementJSON } from './types.js';

/**
 * Built-in element classes provided by the framework. These are implicitly
 * "registered" at construction so that polymorphic queries by a built-in base
 * class (e.g. `dicePool.all(Die)`, `hand.all(Card)`) — including the engine's
 * own internal queries — never trip the PIT-02 unregistered-class guard, which
 * exists only to catch UNREGISTERED CUSTOM element classes. A game that defines
 * `class IngredientDie extends Die` still registers its OWN subclass; it must
 * not be forced to register the framework's base class.
 */
const BUILTIN_ELEMENT_CLASSES: ReadonlyArray<ElementClass> = [
  GameElement, Space, Piece, Card, Hand, Deck, Die, DicePool,
  Grid, GridCell, HexGrid, HexCell,
];
import { Player } from '../player/player.js';
import type { GameCommand, CommandResult } from '../command/types.js';
import { executeCommand, undoCommand } from '../command/executor.js';
import { createInverseCommand } from '../command/inverse.js';
import { canPlayerSee, redactVisibilityForSeat } from '../command/visibility.js';
import type { ActionDefinition, ActionResult, SerializedAction, ActionTrace, ActionDebugInfo, PickDebugInfo, AnnotatedChoice } from '../action/types.js';
import { ActionExecutor } from '../action/action.js';
import type { FlowDefinition, FlowState, FlowPosition, FlowDebugInfo } from '../flow/types.js';
import type { TutorialDefinition, TutorialProgress } from '../tutorial/types.js';
import { getActionLevelDisabledReasons } from '../tutorial/gate.js';
import { availableActionsForSeat } from '../flow/index.js';
import { walkFlowNodes } from '../flow/walk-flow-nodes.js';
import { describeFlowPosition } from '../flow/describe-flow-position.js';
import { buildActionMetadata, buildPickMetadata } from './action-metadata.js';
import type { ActionMetadata, PickMetadata } from '../../session/types.js';
import { devWarn } from '../../utils/dev.js';
import { PlayerFacingError } from '../errors.js';

// ---------------------------------------------------------------------------
// INTRO-01 / INTRO-02 view types
// ---------------------------------------------------------------------------

/**
 * A ready-to-submit argument template for one action.
 * - Optional selections → `null`  (valid to omit)
 * - Required selections → `{ __required: true }`  (must be filled before submit)
 *
 * Design decision D-01: the sentinel object for required picks makes the
 * template self-describing — any tool inspecting it can identify unfilled
 * required slots without re-reading the PickMetadata array.
 */
export type ArgTemplate = Record<string, null | { __required: true }>;

/**
 * Schema view for a single legal action: static metadata + a D-01 arg template.
 * Plain JSON-serializable — safe to send over WebSocket / postMessage.
 */
export interface ActionSchemaView {
  name: string;
  prompt?: string;
  help?: string;
  /** Ordered list of static selection metadata (choices fetched on-demand) */
  selections: PickMetadata[];
  /**
   * Ready-to-submit argument template — one key per selection.
   * Placeholder values: null = optional, { __required: true } = required.
   */
  argTemplate: ArgTemplate;
}

/**
 * The full action space for one seat: every legal action with its schema.
 * Plain JSON-serializable.
 */
export interface ActionSpaceView {
  /** Only the actions this seat can legally execute right now */
  actions: ActionSchemaView[];
}

import { FlowEngine } from '../flow/engine.js';
import { canSeatAct } from '../flow/seat-activity.js';
import { checkForVolatileState } from './volatile-state.js';
import { PersistentMap } from './persistent-map.js';

/**
 * Default player color palette, used when a game doesn't pass `GameOptions.colors`.
 *
 * 16 colors, matching the platform's seat ceiling, so a game can declare any
 * supported player count without hand-supplying a palette. Seats are assigned in
 * order (seat 1 = index 0), and the first eight entries are unchanged from when
 * the palette stopped there — a game that already shipped keeps the colors its
 * players know.
 *
 * **Distinctness.** Measured, not eyeballed: pairwise CIEDE2000 (ΔE00) across all
 * 120 pairs. Normal vision min ΔE00 = 10.8, which is the pre-existing
 * `#f39c12`/`#e67e22` pair from the original eight — every pair involving a newly
 * added color is ≥ 12.4, so extending to 16 does not tighten the palette's
 * floor. Under simulated dichromacy the floors are lower (protanopia 4.7,
 * deuteranopia 3.7, tritanopia 0.0 for red-vs-pink), which is inherent to 16
 * categorical hues rather than to this particular choice — the original eight
 * already measured 8.9 / 6.1 / 2.7. Color is therefore never the sole carrier of
 * player identity: every entry also has a name in {@link DEFAULT_COLOR_LABELS},
 * surfaced as `player.colorLabel`.
 */
export const DEFAULT_COLOR_PALETTE: readonly string[] = [
  '#e74c3c',  // Red
  '#3498db',  // Blue
  '#27ae60',  // Green
  '#f39c12',  // Yellow
  '#9b59b6',  // Purple
  '#1abc9c',  // Teal
  '#e67e22',  // Orange
  '#2c3e50',  // Black (dark navy)
  '#e84393',  // Pink
  '#8bc34a',  // Lime
  '#4834d4',  // Indigo
  '#a0522d',  // Brown
  '#7f8c8d',  // Slate
  '#0e6655',  // Pine (dark teal)
  '#f1948a',  // Salmon
  '#85c1e9',  // Sky
] as const;

/**
 * Human-readable names for the default palette hexes.
 * Lets `player.colorLabel` resolve to a word (e.g. "Red") for player-facing
 * text — logs, narration — even when a game doesn't define a labeled palette.
 * Games with a custom labeled palette pass their own map via `GameOptions.colorLabels`.
 */
export const DEFAULT_COLOR_LABELS: Readonly<Record<string, string>> = {
  '#e74c3c': 'Red',
  '#3498db': 'Blue',
  '#27ae60': 'Green',
  '#f39c12': 'Yellow',
  '#9b59b6': 'Purple',
  '#1abc9c': 'Teal',
  '#e67e22': 'Orange',
  '#2c3e50': 'Black',
  '#e84393': 'Pink',
  '#8bc34a': 'Lime',
  '#4834d4': 'Indigo',
  '#a0522d': 'Brown',
  '#7f8c8d': 'Slate',
  '#0e6655': 'Pine',
  '#f1948a': 'Salmon',
  '#85c1e9': 'Sky',
};

/**
 * The one answer to "is this child a player?" — for a serialized child.
 *
 * The JSON counterpart of {@link isPlayerElement}. Note `$type` is serialized
 * INSIDE `attributes`, not at the top level of the child JSON.
 */
function isPlayerJSON(child: { attributes?: Record<string, unknown> }): boolean {
  return child.attributes?.$type === 'player';
}

/** Every element id carried by a serialized subtree, for `adoptSubtree`. */
function collectJsonIds(json: ElementJSON, into: number[]): void {
  into.push(json.id);
  if (json.children) {
    for (const child of json.children) collectJsonIds(child, into);
  }
}

/** Every element id currently in a live subtree, for `adoptSubtree`. */
function collectResidentIds(element: GameElement, into: Set<number>): void {
  into.add(element._t.id);
  for (const child of element._t.children) collectResidentIds(child, into);
}

/**
 * Options for creating a new game
 */
export type GameOptions = {
  /** Number of players */
  playerCount: number;
  /** Player names (optional) */
  playerNames?: string[];
  /** Random seed for deterministic gameplay */
  seed?: string;
  /** Available color palette for players (hex strings) */
  colors?: string[];
  /**
   * Human-readable name per hex (e.g. `{ '#e74c3c': 'Red' }`), used to set
   * `player.colorLabel` so player-facing text can say "Red" instead of a hex.
   * Defaults to {@link DEFAULT_COLOR_LABELS} for any hex not covered here.
   */
  colorLabels?: Record<string, string>;
  /** Whether players can change colors in lobby (default: true) */
  colorSelectionEnabled?: boolean;
  /**
   * Tutorial definition (static config, never serialized).
   *
   * Threaded un-serialized from `GameDefinition.tutorial` via
   * `GameSession.create()`. Mirrors how `bot` / `_actions` / flow definitions
   * live on the instance. Stored in `Game.tutorialDefinition` (listed in
   * `unserializableAttributes`).
   */
  tutorial?: TutorialDefinition;
  /**
   * Whether this session may consume randomness at all (host policy, never
   * serialized). Default: `'allowed'`.
   *
   * Threaded here from `GameRunnerOptions.randomness` /
   * `hostOptions.randomness` by `GameRunner`, and NOT declarable by a game:
   * it is a property of the session the host opened, so `GameRunner` writes it
   * onto the options it passes down on every construction path.
   *
   * It arrives through the CONSTRUCTOR rather than a method called afterwards
   * because a subclass constructor body runs after `Game`'s and real games draw
   * there — picking a dealer, deriving a map seed. Forbidding after
   * `new GameClass(...)` returned would let exactly those draws through.
   */
  randomness?: RandomnessPolicy;
  /**
   * Whether this game runs in WORLD MODE: the residency model where only named
   * partitions are resident and the engine reports which a move dirtied.
   * Default: `false` -- every published board game is a snapshot game.
   *
   * It arrives through the CONSTRUCTOR for the same reason `randomness` does,
   * and with a worse failure if it does not. A subclass constructor body runs
   * after `Game`'s and real games BUILD THERE -- a board, a deck, a map. In
   * snapshot mode an element reference serializes as a positional branch path,
   * which resolves to the WRONG element once a partition is not resident, so a
   * world switched on after `new GameClass(...)` returned has already built the
   * half of itself most likely to hold references.
   *
   * The two things it changes:
   *
   *   Element references serialize as `{ __elementId }` rather than a branch
   *   path, which is what makes a partition adoptable at all.
   *
   *   The colour palette CYCLES rather than capping the seat count. A table's
   *   palette is a legend a person reads; a world of hundreds renders no
   *   legend, and refusing to construct one would be the engine declining to
   *   run the mode it offers.
   *
   * There is deliberately no way back out, and no way in afterwards. A tree
   * that emitted id refs and then started emitting branch refs would carry both
   * formats, and the branch half would resolve against whatever happened to be
   * resident.
   */
  worldMode?: boolean;
};

/**
 * Whether a session may consume randomness at all.
 *
 * `'forbidden'` is the order-entry / intent-capture policy: every draw throws
 * {@link RandomnessForbiddenError}. Defined here, beside `GameOptions`, so the
 * engine, `boardsmith/runtime` and `boardsmith/session` all name one type.
 */
export type RandomnessPolicy = 'allowed' | 'forbidden';

/**
 * Game phase
 */
export type GamePhase = 'setup' | 'started' | 'finished';

/**
 * Animation event emitted during game execution.
 * These are UI hints, NOT state mutations. They flow through the session
 * layer to UI consumers who play them back asynchronously.
 */
export interface AnimationEvent {
  /** Unique ID for acknowledgment (monotonically increasing) */
  id: number;
  /** Event type (e.g., 'combat', 'score', 'cardFlip') */
  type: string;
  /** Event-specific data payload (must be JSON-serializable) */
  data: Record<string, unknown>;
  /**
   * Seats allowed to receive this event. Absent means everyone, exactly like
   * `MessageEntry.to` (#23).
   *
   * Enforced SERVER-SIDE, in `toJSONForPlayer` — a non-audience seat's payload
   * never carries the event at all. This is not a UI filter, and a client
   * cannot opt out of it.
   */
  to?: number[];
  /** Optional group ID for batching related events */
  group?: string;
}

/**
 * Function to transform game state for a specific player's view.
 * Runs AFTER zone-based visibility filtering.
 * Use for attribute-level filtering that zone visibility can't handle.
 *
 * @param state - The zone-filtered state
 * @param playerSeat - The player seat (null for spectators)
 * @param game - The game instance
 * @returns The transformed state
 */
export type PlayerViewFunction<G extends Game = Game> = (
  state: ElementJSON,
  playerSeat: number | null,
  game: G
) => ElementJSON;

/**
 * A seeded random function whose entire internal state is exposed so it can be
 * serialized and restored exactly. The mulberry32 generator's state is a single
 * 32-bit integer (`h`); `getState`/`setState` read and write it so a snapshot can
 * round-trip the RNG position without replaying the actions that advanced it.
 */
export interface SeededRandom {
  (): number;
  /** Read the generator's current internal state (the mulberry32 `h`). */
  getState(): number;
  /** Restore the generator's internal state to a previously captured value. */
  setState(state: number): void;
}

/**
 * Seeded random number generator (mulberry32). The returned function exposes its
 * single-integer state via `getState`/`setState` so it can be captured in a
 * snapshot and restored authoritatively (no action replay needed).
 */
function createSeededRandom(seed: string): SeededRandom {
  // Simple mulberry32 PRNG
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }

  const random = function () {
    h |= 0;
    h = h + 0x6D2B79F5 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  } as SeededRandom;

  random.getState = () => h;
  random.setState = (state: number) => {
    h = state | 0;
  };

  return random;
}

/**
 * Thrown by every random draw once {@link Game.forbidRandomness} has been
 * applied to a game — the host declared this session an INTENT-CAPTURE session
 * (`hostOptions.randomness: 'forbidden'`), which must consume no randomness at
 * all.
 *
 * Why the whole session, rather than a per-action rule: a player alone in a
 * private session can undo, reorder their actions, and redo to re-roll any draw
 * that has not been fenced — and can abandon the session entirely and start a
 * new one, which mints a new seed. Both channels close only if the session
 * never draws. A session that draws zero times is provably immune to both,
 * because the generator's state advances on draws and nothing else.
 */
export class RandomnessForbiddenError extends PlayerFacingError {
  constructor() {
    super(
      'This session forbids randomness (order-entry mode): every random draw ' +
      "must happen in the round's resolution session. Replace this draw with " +
      'an order the resolver executes.',
    );
    this.name = 'RandomnessForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Per-player serialization helpers — module-private (not exported, not class
// methods).  Placed at module level so they are pure functions with no access
// to `this`, which keeps them trivially testable and avoids class coupling.
// ---------------------------------------------------------------------------

/**
 * Allowlist of pure layout/topology $-keys that are safe to broadcast to a
 * viewer who cannot see a hidden element's identity.  All other $-keys are
 * treated as potentially sensitive and dropped (fail-safe).
 *
 * Value-bearing keys ($image, $images) are handled separately inside
 * redactHiddenElementAttrs.
 *
 * Verified against src/engine/element/ on 2026-06-20: these are the
 * complete set of layout-descriptor $-keys declared across the engine.
 */
const SAFE_LAYOUT_KEYS = new Set([
  '$type', '$layout',
  '$direction', '$gap', '$overlap', '$fan', '$fanAngle', '$align',
  '$rowLabels', '$columnLabels', '$rowCoord', '$colCoord',
  '$hexOrientation', '$coordSystem', '$qCoord', '$rCoord', '$sCoord',
  '$hexSize',
]);

/**
 * Redact identity-bearing image refs from the attributes of an element that
 * the viewer is not permitted to fully see.  Returns a new object containing
 * only safe layout $-keys; the caller is responsible for injecting __hidden
 * and childCount (their shape contracts differ per branch).
 *
 * Rules:
 *   $image   → dropped unconditionally (single-sided — always identity-bearing)
 *   $images  → keep only { back } if present; omit $images entirely otherwise
 *   unknown $-keys → dropped (fail-safe)
 *   non-$ keys → dropped (callers seed __hidden/childCount themselves)
 *   SAFE_LAYOUT_KEYS → copied through as-is
 */
function redactHiddenElementAttrs(attrs: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (key === '$image') continue; // identity-bearing single-sided image — drop
    if (key === '$images') {
      const images = value as Record<string, unknown>;
      if (images?.back !== undefined) {
        safe.$images = { back: images.back };
      }
      // If no 'back' key, omit $images entirely (not even an empty object)
      continue;
    }
    if (SAFE_LAYOUT_KEYS.has(key)) {
      safe[key] = value;
    }
    // Unknown $-keys and all non-$ keys are dropped (fail-safe)
  }

  return safe;
}

/** One entry in a game's message log. `to` is the AUDIENCE — see `Game.messages`. */
export interface MessageEntry {
  text: string;
  data?: Record<string, unknown>;
  /** Seats allowed to receive this line. Absent means everyone. */
  to?: number[];
  /**
   * The game's own classification of this line, carried through to the client
   * so the log can render it distinctly (#21).
   *
   * Deliberately an OPEN string rather than a fixed union: the games that need
   * this have their own taxonomies, recorded as rules rather than decoration
   * (`notice` / `alert` / `event` / `advancement` / `shout` / `mail` ...), and
   * an engine-side list could only ever be a guess at them. `GameHistory`
   * renders it as a `log-type-<value>` class, styles a few well-known names,
   * and leaves the rest for a game's own CSS.
   *
   * Absent means unclassified — the log renders it in its default style.
   */
  type?: string;
}

/** Optional per-line settings for `Game.message` / `Game.messageTo`. */
export interface MessageOptions {
  /** The game's classification for this line — see `MessageEntry.type`. */
  type?: string;
}

/** One formatted log line as the client receives it. */
export interface FormattedMessage {
  text: string;
  /** Present only when the game classified the line — see `MessageEntry.type`. */
  type?: string;
}

/**
 * Game-level own properties that `Game` serializes ITSELF, rather than letting
 * `GameElement.toJSON()`'s generic attribute loop emit them.
 *
 * That loop writes every own enumerable property not listed in
 * `unserializableAttributes` into `attributes`. Each field below is handled
 * explicitly elsewhere, so without this strip the payload carried a SECOND copy
 * that no redaction pass ever touched:
 *
 * - `phase`, `settings` — hoisted to the top level of `toJSON()`. The duplicate
 *   was pure weight, paid in every broadcast and every retained checkpoint.
 * - `messages` — NOT in `toJSON()` at all; the log lives in
 *   `GameStateSnapshot.messageLog` (see `Game.messages`). The duplicate was an
 *   outright hidden-information leak (SEC-04): the redaction rebuilt one array
 *   while `attributes.messages` shipped the full log — every private line, tagged
 *   with the audience it was withheld from — to every seat and to the spectator,
 *   defeating `messageTo` inside its own payload.
 *
 * NOTE: deliberately NOT `unserializableAttributes`. That list means "never emitted
 * AND never loaded AND never ref-resolved", and it is read by
 * `GameElement.resolveElementReferences` as well as by `toJSON`. These fields ARE
 * loaded (`loadSerializedState` adopts them by reference) and DO need
 * ref-resolution — `settings` carries `persistentMap` payloads and element/player
 * refs, `messages` carries `data` payloads. Listing them as unserializable
 * de-aliases nothing and silently re-opens CR-02 (a restored game sharing its
 * `settings`/`messages` with the snapshot it restored from) and the F-01 MCTS
 * undo-soundness fix that depends on it.
 *
 * The restore paths skip these same keys in their attribute loops — see
 * `loadSerializedState` and `restoreDevState`, which both import this constant.
 */
export const GAME_SELF_SERIALIZED_FIELDS = ['phase', 'messages', 'settings'] as const;

/**
 * The own-field names of `game` that are currently bound to a
 * {@link PersistentMap}.
 *
 * A PersistentMap is a live view onto `game.settings[name]`, not a value of its
 * own. The data is therefore already serialized exactly once, with `settings`.
 * Emitting the FIELD as well wrote an empty object into the attribute bag (a
 * PersistentMap keeps its state in private fields, so it serializes as `{}`),
 * and every restore path then assigned that `{}` straight over the live map —
 * so the first call after a restore threw "<name>.get is not a function" (#139).
 *
 * Skipping the field on the way OUT and on the way BACK IN is what makes the
 * round-trip work: the constructor rebinds the field to a fresh PersistentMap,
 * and restoring `settings` refills it with the serialized contents. This is
 * also why these names must count as KNOWN to the redaction pass — a key the
 * payload does not carry is otherwise taken for a withheld attribute and
 * replaced with a throwing accessor.
 */
function persistentMapFields(game: Game): ReadonlySet<string> {
  const names = new Set<string>();
  for (const key of Object.keys(game)) {
    if (readDynamicAttribute(game, key) instanceof PersistentMap) {
      names.add(key);
    }
  }
  return names;
}

/**
 * Who may see each engine-owned field that reaches a serialized game ROOT.
 *
 * The root is visible to every seat, so the element-visibility pass never
 * touches its own attributes. Anything the ENGINE puts on `Game` (or inherits
 * onto it from `GameElement`/`Space`) therefore ships to every seat and to the
 * spectator by default, with nothing in the redaction path standing between it
 * and the wire. Two leaks came from exactly that, a week apart:
 *
 *   SEC-04  `messages`         — every seat received every private `messageTo` line.
 *   SEC-05  `tutorialProgress` — every seat received every other seat's progress.
 *
 * Neither was an author mistake; both were engine fields added without anyone
 * stating an audience. This map is where that decision is now recorded, and
 * `payload-duplication.test.ts` fails until a new field appears in it — so
 * "what may see this?" has to be answered when the field is added, not after it
 * has been shipping to everyone for a release.
 *
 *   'public'          — ships to everyone; identical for every seat. Choosing
 *                       this asserts the value holds NO per-seat data.
 *   'seat-scoped'     — ships, but `toJSONForPlayer` narrows it to the receiving
 *                       seat. Requires a companion assertion proving the
 *                       narrowing (see the SEC-05 block for the worked example);
 *                       the generic guard cannot synthesise per-seat data for an
 *                       arbitrary field.
 *   'self-serialized' — `Game` emits it outside the generic attribute bag, so
 *                       its audience is settled at that boundary instead. Must
 *                       also appear in {@link GAME_SELF_SERIALIZED_FIELDS}.
 */
export const GAME_ROOT_FIELD_AUDIENCE: Record<string, 'public' | 'seat-scoped' | 'self-serialized'> = {
  // --- inherited from GameElement / Space -------------------------------
  // Layout and identity fields. Undefined on a game root in practice, and
  // public wherever they are set: they describe where a thing is drawn, not
  // what anyone knows.
  name: 'public',
  player: 'public',
  row: 'public',
  column: 'public',
  $image: 'public',
  $images: 'public',
  $direction: 'public',
  $gap: 'public',
  $overlap: 'public',
  $fan: 'public',
  $fanAngle: 'public',
  $align: 'public',
  sealed: 'public',

  // --- Game's own -------------------------------------------------------
  phase: 'self-serialized',
  settings: 'self-serialized',
  messages: 'self-serialized',
  tutorialProgress: 'seat-scoped',
};

/** What the engine has decided about one of its own root fields. */
export type GameRootFieldAudience = (typeof GAME_ROOT_FIELD_AUDIENCE)[string];

/**
 * Is `key` a root field the ENGINE owns?
 *
 * This is the question a game asks while walking its own outgoing root
 * attribute bag in `static playerView` (#32): every key is either the game's,
 * which it must classify and redact itself, or the engine's, which it must pass
 * through untouched because the engine has already declared that field's
 * audience and narrows the seat-scoped ones inside `toJSONForPlayer`.
 *
 * Games used to hand-keep a mirror of this table, reconciled by hand on every
 * engine bump, because the constant was exported from its module but reached no
 * barrel. Deferring to the engine means a field the engine adds and classifies
 * is handled downstream automatically, rather than becoming a build break in
 * every project that redacts its root.
 *
 * Prefer this over reading {@link GAME_ROOT_FIELD_AUDIENCE} directly: it does
 * not commit a caller to the table's shape, so the engine stays free to
 * reclassify a field.
 */
export function isEngineRootField(key: string): boolean {
  return Object.hasOwn(GAME_ROOT_FIELD_AUDIENCE, key);
}

/**
 * What the engine has decided about `key`, or `undefined` when the field is not
 * the engine's — see {@link isEngineRootField}.
 */
export function engineRootFieldAudience(key: string): GameRootFieldAudience | undefined {
  return Object.hasOwn(GAME_ROOT_FIELD_AUDIENCE, key) ? GAME_ROOT_FIELD_AUDIENCE[key] : undefined;
}

/**
 * The Player subclass a game declared, recovered from the game type itself.
 *
 * A game already names its player once, in `class MyGame extends Game<MyGame,
 * MyPlayer>`. Every context the engine hands back then derives the player from
 * that single declaration rather than asking the author to repeat it as a second
 * type argument on `ActionContext`, `FlowContext` and every flow builder. So
 * `ctx.player` is `MyPlayer` in a game's own callbacks with nothing extra
 * written, and stays the base `Player` for a game that never named a subclass.
 *
 * The `IsAny` guard is load-bearing, not defensive. `Game`'s own parameters
 * default to `any` (`Game<G extends Game = any, P extends Player = any>`), so a
 * bare `Game` infers `P = any` -- and `ctx.player: any` would be strictly worse
 * than what this replaces: every misspelled field would compile. The guard turns
 * that case back into `Player`, which is what the base game actually has.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

export type PlayerOf<G extends Game> = G extends Game<any, infer P>
  ? IsAny<P> extends true
    ? Player
    : P
  : Player;

/**
 * Base Game class. The root of the element tree and container for all game state.
 *
 * Extend this class to create your game. The Game class serves as:
 * - **Element tree root**: All game elements (boards, cards, pieces) are children of Game
 * - **Action registry**: Define and register player actions via `registerActions()`
 * - **Flow controller**: Define game flow via `setFlow()` and `startFlow()`
 * - **Player manager**: Access players via `game.all(Player)` or helper methods
 * - **Message log**: Record game events via `message()`
 *
 * @example
 * ```typescript
 * class MyGame extends Game<MyGame, MyPlayer> {
 *   static PlayerClass = MyPlayer;  // Optional: custom Player type
 *
 *   board!: Board;
 *   deck!: Deck;
 *
 *   constructor(options: GameOptions) {
 *     super(options);
 *
 *     // Register element classes for serialization
 *     this.registerElements([Board, Deck, Card, Piece]);
 *
 *     // Create the game board and components
 *     this.board = this.create(Board, 'board');
 *     this.deck = this.create(Deck, 'deck');
 *
 *     // Create cards in the deck
 *     for (const cardData of CARD_DATA) {
 *       this.deck.create(Card, cardData.name, cardData);
 *     }
 *
 *     // Deal to players (element methods mutate the tree directly)
 *     for (const player of this.players) {
 *       for (let i = 0; i < 5; i++) {
 *         this.deck.first(Card)?.putInto(player.hand);
 *       }
 *     }
 *
 *     // Register player actions
 *     this.registerActions(
 *       Action.create('playCard')
 *         .chooseElement('card', { filter: c => c.parent === this.currentPlayer.hand })
 *         .execute(({ card }) => card.flip()),
 *       Action.create('endTurn')
 *         .execute(() => this.setCurrentPlayer(this.nextPlayer()!))
 *     );
 *
 *     // Define game flow
 *     this.setFlow(defineFlow({
 *       root: loop({
 *         while: () => !this.isFinished(),
 *         do: eachPlayer({
 *           do: actionStep({ actions: ['playCard', 'endTurn'] })
 *         })
 *       }),
 *       getWinners: () => [this.getHighestScoringPlayer()]
 *     }));
 *   }
 * }
 * ```
 *
 * @typeParam G - The concrete Game subclass type (for type-safe self-references)
 * @typeParam P - The Player subclass type used in this game
 */
export class Game<
  G extends Game = any,
  P extends Player = any
> extends Space<G, P> {
  /**
   * Optional function to transform state for each player's view.
   * Override in subclass for custom attribute-level filtering.
   */
  static playerView?: PlayerViewFunction;

  /**
   * Optional custom Player class to use when creating players.
   * Set this in subclasses that need custom Player types.
   * Using `any` to avoid TypeScript generic variance issues with subclass assignments.
   *
   * @example
   * ```typescript
   * class MyGame extends Game<MyGame, MyPlayer> {
   *   static PlayerClass = MyPlayer;
   * }
   * ```
   */
  static PlayerClass?: ElementClass<Player>;

  /** Container for removed elements */
  pile!: GameElement;

  /** Current game phase */
  phase: GamePhase = 'setup';

  /** Seeded random number generator */
  random: SeededRandom;

  /**
   * Message log.
   *
   * `to` is the message's AUDIENCE — the seats allowed to receive it. Absent
   * means everyone, which is what `message()` writes and what nearly every game
   * should be writing. Only `messageTo()` sets it. The audience is enforced
   * server-side, in `createSnapshot`'s `forSeat` path and `getFormattedMessages`,
   * so an unaddressed seat never receives the bytes; this array itself is the
   * unfiltered truth and must stay that way (undo restores from it, so a
   * filtered copy here would silently destroy other seats' history).
   *
   * NOT part of `toJSON()`. The log is a SNAPSHOT-level sibling
   * (`GameStateSnapshot.messageLog`), stored ONCE per snapshot, with each
   * retained checkpoint carrying only an `ActionCheckpoint.messageCount`
   * watermark into it. Inside the tree it was copied per retained checkpoint,
   * making persisted state `(checkpoints.max + 1) x (model + log)` — measured at
   * 95% of a narration-heavy game's bytes, and over a 2 MB host ceiling at four
   * seats. See `docs/state-size.md`.
   */
  messages: MessageEntry[] = [];

  /** Game settings */
  settings: Record<string, unknown> = {};

  /** Command history for event sourcing */
  commandHistory: GameCommand[] = [];

  /** Inverse command history for undo (parallel to commandHistory) */
  private _inverseHistory: (GameCommand | null)[] = [];

  /** Registered actions */
  private _actions: Map<string, ActionDefinition> = new Map();

  /** Action executor for validation and execution */
  private _actionExecutor!: ActionExecutor;

  /** Flow definition for this game */
  private _flowDefinition?: FlowDefinition<G>;

  /** Flow engine instance */
  private _flowEngine?: FlowEngine<G>;

  /** Debug registry for custom debug data (dev mode only) */
  private _debugRegistry: Map<string, () => unknown> = new Map();

  /** Persistent maps that survive HMR (synced to settings) */
  private _persistentMaps: Map<string, PersistentMap<string, unknown>> = new Map();

  /** Animation events buffer (for UI playback) */
  private _animationEvents: AnimationEvent[] = [];

  /** Animation event sequence counter (for unique IDs) */
  private _animationEventSeq: number = 0;
  /**
   * How many message-log entries have been evicted from the FRONT of the log
   * over this game's life (#25).
   *
   * This is what makes a checkpoint's watermark survive pruning without costing
   * a byte per entry. A checkpoint records the log's ABSOLUTE length at its
   * boundary — entries ever written, not entries currently held — and a restore
   * subtracts this offset to turn that back into a position in the log as it
   * stands now. One number per game, rather than an identity on every line, in
   * a system whose whole problem is that the log is the thing that grows.
   *
   * It only works because eviction is front-only by construction: see
   * `pruneMessages`, which has no way to remove from the middle.
   */
  private _messagesEvicted: number = 0;

  /** Original constructor options (for snapshot restoration) */
  private _constructorOptions: Record<string, unknown> = {};

  /**
   * Per-seat tutorial progress (serialized).
   *
   * PLAIN PUBLIC FIELD — required for `toJSON()` to include it via
   * `Object.keys(this)`. A `#private` field or getter would silently fail to
   * round-trip (RESEARCH Pitfall 1). Initialized to an empty Map so it is
   * present as an own-enumerable key even before any tutorial is started.
   *
   * Keys are seat numbers (1-indexed integers). `Map<number, …>` is chosen
   * over `Record<number, …>` so `serializeValue` encodes it as
   * `{ __map: [[1, …]] }` and `deserializeValue` restores numeric keys
   * intact — JSON object-key coercion would turn `1` into `"1"`.
   */
  tutorialProgress: Map<number, TutorialProgress> = new Map();

  /**
   * Tutorial definition (NOT serialized).
   *
   * Static config threaded from `GameDefinition.tutorial` via
   * `GameSession.create()` → `GameOptions.tutorial` → constructor. Listed in
   * `unserializableAttributes` so `toJSON()` / `loadSerializedState()` skip
   * it — the definition is re-supplied each time a runner is constructed,
   * mirroring how `_actions` and flow definitions live on the instance.
   */
  tutorialDefinition?: TutorialDefinition;

  static override unserializableAttributes = [
    ...Space.unserializableAttributes,
    'pile',
    'random',
    'commandHistory',
    '_actions',
    '_actionExecutor',
    '_flowDefinition',
    '_flowEngine',
    '_debugRegistry',
    '_constructorOptions',
    'tutorialDefinition',
  ];

  /**
   * Create a new game instance.
   *
   * @param options - Configuration for the new game
   * @param options.playerCount - Number of players (creates Player 1 through Player N)
   * @param options.playerNames - Optional custom names for players
   * @param options.seed - Optional random seed for deterministic gameplay (for replays/testing)
   *
   * @example
   * ```typescript
   * // Create a 4-player game
   * const game = new MyGame({ playerCount: 4 });
   *
   * // With custom names
   * const game = new MyGame({
   *   playerCount: 2,
   *   playerNames: ['Alice', 'Bob']
   * });
   *
   * // With seed for reproducible randomness
   * const game = new MyGame({
   *   playerCount: 4,
   *   seed: 'my-test-seed'
   * });
   * ```
   */
  constructor(options: GameOptions) {
    // Create seed for random
    const seed = options.seed ?? Math.random().toString(36).substring(2);
    const random = createSeededRandom(seed);

    // Initialize context with Map for class registry
    const ctx: Partial<ElementContext> = {
      sequence: 0,
      classRegistry: new Map(),
      random,
    };

    super(ctx);

    this.random = random;
    // LOAD-BEARING. `G` is the game's own concrete class (`class MyGame extends
    // Game<MyGame, MyPlayer>`), so at runtime `this` IS a `G` — but inside the base
    // class `G` is an unresolved type parameter and the F-bounded relationship
    // cannot be proven. Every element's `game` back-reference is typed `G` for the
    // game author's benefit, and this is the one place it is established.
    this.game = this as unknown as G;
    this._ctx.game = this;

    // Order-entry / intent-capture sessions consume no randomness at all, and
    // the engine enforces that rather than trusting the game not to draw: one
    // cosmetic shuffle silently reopens RNG scumming. Applied HERE, before any
    // subclass constructor body has run, so a draw is impossible from the
    // game's very first instruction — games routinely draw during construction
    // (dealer choice, map seed), and those draws are exactly the ones a
    // post-construction switch would miss.
    if (options.randomness === 'forbidden') this.forbidRandomness();

    // WORLD MODE, before any element exists. Applied here, beside `randomness`
    // and for the same recorded reason: a subclass constructor body runs after
    // this one and builds the game's furniture, and in snapshot mode every
    // element reference it writes serializes as a positional branch path.
    if (options.worldMode === true) this._ctx._worldMode = true;

    // Store all constructor options for snapshot restoration, EXCLUDING
    // tutorial and randomness. This enables MCTS clones and other restores to
    // receive full options.
    //
    // `tutorial` is intentionally excluded: it is static config (like _actions /
    // flow definitions) that must be re-supplied on restore from the session layer
    // (`GameSession.restore` → `GameRunnerOptions.gameOptions.tutorial`), NOT
    // serialized into the snapshot. Storing it here would silently embed it in
    // `snapshot.gameOptions` via `getConstructorOptions()` → `createSnapshot()`.
    // Functions in predicate-style gates would also fail JSON.stringify.
    //
    // `randomness` is excluded for the same reason and one more: it is the
    // HOST's per-session policy, re-supplied on every stateless op from
    // `hostOptions`. Persisting it into the snapshot would let a snapshot
    // carry a policy the host did not declare for the op being run.
    const { tutorial: _tutorialOption, randomness: _randomnessOption, ...restOptions } = options;
    this._constructorOptions = { ...restOptions, seed };

    // Wire tutorial definition (un-serialized static config, see tutorialDefinition JSDoc).
    // Listed in unserializableAttributes so toJSON/loadSerializedState skip it.
    if (_tutorialOption) {
      this.tutorialDefinition = _tutorialOption;
    }

    // Register built-in framework element classes. Seeding these means the
    // PIT-02 registration guard only ever flags a genuinely unregistered CUSTOM
    // class, and polymorphic base-class queries (dicePool.all(Die), hand.all(Card))
    // — including the engine's own internal ones — resolve without a game having
    // to register the framework's own classes.
    this._ctx._builtinSeededNames = new Set<string>();
    for (const cls of BUILTIN_ELEMENT_CLASSES) {
      this._ctx.classRegistry.set(cls.name, cls);
      this._ctx._builtinSeededNames.add(cls.name);
    }

    // Create removed elements pile
    this.pile = this.createElement(Space, '__pile__');
    this.pile._t.parent = undefined; // Remove from main tree

    // Store player config in settings for snapshot restoration
    this.settings.playerCount = options.playerCount;
    this.settings.playerNames = options.playerNames ?? Array.from(
      { length: options.playerCount },
      (_, i) => `Player ${i + 1}`
    );

    // Register Player class for serialization
    this._ctx.classRegistry.set('Player', Player);

    // Get the Player class to use (subclass may define a custom one)
    const PlayerClassToUse = (this.constructor as typeof Game).PlayerClass ?? Player;
    if (PlayerClassToUse !== Player) {
      // Register custom Player class for serialization
      this._ctx.classRegistry.set(PlayerClassToUse.name, PlayerClassToUse);
    }

    // Resolve color palette
    const colorPalette = options.colors ?? DEFAULT_COLOR_PALETTE;

    // Validate color count early (fail-fast). The message names the palette
    // that actually ran out, because the fix differs: a game that supplied its
    // own palette must lengthen it, whereas overrunning the default means asking
    // for more seats than any platform will host.
    //
    // NOT A CAP IN WORLD MODE. The palette is a legend -- sixteen colours a
    // person can tell apart when a table shows them side by side -- and a world
    // of hundreds shows no legend. Colour is never the sole carrier of player
    // identity here (every entry has a `colorLabel`), so seats past the end
    // wrap: two players in a large world sharing "Red" is a true fact about its
    // size rather than a loss. A game that supplied its OWN short palette meant
    // it, and cycling two colours over eight seats is two teams of four.
    if (!this.worldMode && options.playerCount > colorPalette.length) {
      throw new Error(
        options.colors
          ? `Cannot create ${options.playerCount} players: gameOptions.colors supplies only ${colorPalette.length} colors. ` +
            `Add ${options.playerCount - colorPalette.length} more, or drop gameOptions.colors to use the built-in ` +
            `${DEFAULT_COLOR_PALETTE.length}-color palette.`
          : `Cannot create ${options.playerCount} players: the default palette covers ${DEFAULT_COLOR_PALETTE.length} seats, ` +
            `which is the maximum any BoardSmith host supports. Reduce playerCount, or pass a longer gameOptions.colors ` +
            `array if you are running this game outside a host.`
      );
    }

    // Resolve color labels: game-supplied map wins, falling back to the default
    // palette names so a hex always has a chance of a human-readable name.
    const colorLabels = options.colorLabels;

    // Create players (1-indexed: Player 1 has seat 1)
    for (let i = 0; i < options.playerCount; i++) {
      const playerName = options.playerNames?.[i] ?? `Player ${i + 1}`;
      // Typed against the concrete `Player` first so a renamed `seat` fails
      // here, then bridged to the generic. `ElementAttributes<P>` is a mapped
      // type over an unresolved type parameter, so TypeScript cannot see that
      // `seat` survives it; the bridge is the limitation, not the shape.
      const playerAttributes: Partial<Pick<Player, 'seat'>> = { seat: i + 1 };
      // LOAD-BEARING BRIDGE (both casts). `PlayerClass` is declared as
      // `ElementClass<Player>` — the strongest type a base class can state, since
      // `Game`'s own `P` is not in scope on a static — so nothing here can prove
      // that this game's `PlayerClass` builds THIS game's `P`. The declaration is
      // what a game author writes (`static override PlayerClass = MyPlayer`), and
      // `Game<MyGame, MyPlayer>` is what they write one line above it; keeping the
      // two in step is not something the type system can check for them.
      // `ElementAttributes<P>` is a mapped type over an unresolved type parameter,
      // so `seat` surviving it is unprovable for the same reason — hence the
      // concrete `Player` typing on the line above, which does fail to compile if
      // `seat` is renamed.
      const player = this.create(
        PlayerClassToUse as ElementClass<P>,
        playerName,
        playerAttributes as ElementAttributes<P>,
      );
      // Auto-assign color from palette (seat 1 = index 0, seat 2 = index 1, etc.).
      // The modulo is a no-op outside world mode, where the check above has
      // already refused any seat the palette cannot reach.
      const hex = colorPalette[i % colorPalette.length];
      player.color = hex;
      // Human-readable name for the assigned color (e.g. "Red") for player-facing text.
      player.colorLabel = colorLabels?.[hex] ?? DEFAULT_COLOR_LABELS[hex];
      if (i === 0) player.setCurrent(true);
    }

    // Store color configuration for session layer access
    this.settings.colors = colorPalette;
    this.settings.colorSelectionEnabled = options.colorSelectionEnabled ?? true;

    // Initialize action executor
    this._actionExecutor = new ActionExecutor(this);

    // Schedule HMR warning check after subclass constructor completes
    // Uses queueMicrotask so it runs after the full constructor chain
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      queueMicrotask(() => {
        try {
          checkForVolatileState(this);
        } catch (e) {
          this._initError = e as Error;
        }
      });
    }
  }

  /**
   * Stored initialization error from checkForVolatileState (for testing).
   * @internal
   */
  _initError?: Error;

  /**
   * Wait for initialization to complete. Throws if there was an error during setup.
   * Useful for testing to catch async initialization errors.
   */
  async ready(): Promise<this> {
    // Let the microtask complete
    await Promise.resolve();
    if (this._initError) {
      throw this._initError;
    }
    return this;
  }

  // ============================================
  // Persistent State (HMR-safe)
  // ============================================

  /**
   * Create a persistent Map that survives HMR (Hot Module Replacement).
   *
   * Unlike regular Maps, PersistentMaps store their data in game.settings,
   * so they're preserved when game rules are hot-reloaded during development.
   *
   * @param name - Unique name for this map (used as key in game.settings)
   * @returns A Map-like object that persists through HMR
   *
   * @example
   * ```typescript
   * // In your game class
   * pendingLoot = this.persistentMap<string, LootOption[]>('pendingLoot');
   *
   * // Use like a normal Map
   * this.pendingLoot.set(sectorId, options);
   * const options = this.pendingLoot.get(sectorId);
   * ```
   *
   * Limitations:
   * - Keys must be serializable (strings, numbers)
   * - Values must be JSON-serializable (no element references)
   * - For element references, use element children instead
   */
  protected persistentMap<K extends string, V>(name: string): PersistentMap<K, V> {
    // Return existing map if already created (for idempotency)
    if (this._persistentMaps.has(name)) {
      return this._persistentMaps.get(name) as PersistentMap<K, V>;
    }

    const map = new PersistentMap<K, V>(this, name);
    this._persistentMaps.set(name, map as PersistentMap<string, unknown>);
    return map;
  }

  /**
   * Register element classes for serialization/deserialization.
   * Call this in your game constructor before creating elements.
   *
   * @example
   * ```typescript
   * constructor(options: MyGameOptions) {
   *   super(options);
   *   this.registerElements([Card, Hand, Deck, DiscardPile]);
   *   // ... create elements
   * }
   * ```
   */
  protected registerElements(
    classes: (new (...args: any[]) => GameElement)[]
  ): void {
    // Routed through the shared SPACE-04/D25 collision guard: an explicit
    // game registration still overrides a built-in default seed (see
    // BUILTIN_ELEMENT_CLASSES), but a DIFFERENT class colliding with an
    // already-registered CUSTOM name now throws instead of silently
    // clobbering it.
    for (const cls of classes) {
      registerElementClass(this._ctx, cls.name, cls as ElementClass);
    }
  }

  /**
   * Create an element without adding it to the tree (internal use)
   */
  protected createElement<T extends GameElement>(
    elementClass: ElementClass<T>,
    name: string
  ): T {
    const element = new elementClass(this._ctx);
    element.name = name;
    element.game = this;

    // Routed through the shared SPACE-04/D25 collision guard — see
    // `registerElementClass` (game-element.ts).
    registerElementClass(this._ctx, elementClass.name, elementClass as ElementClass);

    return element;
  }

  // ============================================
  // Element Lookup
  // ============================================

  /**
   * Find an element by its ID anywhere in the game tree
   */
  getElementById(id: number): GameElement | undefined {
    // Check main tree
    const found = this.atId(id);
    if (found) return found;

    // Check pile
    return this.pile.atId(id);
  }

  /**
   * Get an element class by name (for command execution)
   */
  getElementClass(className: string): ElementClass | undefined {
    return this._ctx.classRegistry.get(className);
  }

  // ============================================
  // World mode: partition residency (#35 item 2)
  // ============================================

  /**
   * Is this game in WORLD MODE?
   *
   * A world is too large to hold in memory at once, so the platform keeps only
   * the partitions a command names resident and every other partition is
   * ABSENT from the element tree — not stubbed, not lazy, absent. That leaves
   * `atId`, `all()` and `toJSON` costing O(resident) with no change to
   * traversal, and it is the whole point of the mode.
   *
   * Declared at construction ({@link GameOptions.worldMode}) and never after —
   * the reason is written out on the option itself, and it is that a subclass
   * constructor body builds the game's furniture before any post-construction
   * switch could run.
   *
   * Snapshot mode — every published board game — is untouched by all of this.
   */
  /** True when this game was constructed with `GameOptions.worldMode`. */
  get worldMode(): boolean {
    return this._ctx._worldMode === true;
  }

  /**
   * Declare a resident element a PARTITION ROOT: a subtree the platform loads,
   * checkpoints and evicts as one unit.
   *
   * The engine keeps no partition contents and no partition names — the
   * platform already knows what it hydrated. All the engine owes it is the
   * other half of the dirty set, the partitions a MOVE touched, which the
   * platform cannot see. Registering a root is what makes those moves
   * attributable.
   *
   * {@link adoptSubtree} calls this for every graft, so the explicit call is
   * for world genesis: the run that builds a world in memory before any of it
   * has been through storage.
   */
  definePartition(id: number): void {
    this._requireWorldMode('definePartition');
    const element = this.getElementById(id);
    if (!element) {
      throw new Error(
        `Cannot define partition ${id}: no element with that id is resident. ` +
          `Hydrate the partition (Game#adoptSubtree) before declaring it a partition root.`
      );
    }
    if (element === this) {
      throw new Error(
        `Cannot define the game root (id ${id}) as a partition: a partition is a subtree ` +
          `that can be evicted, and evicting the game would evict the world.`
      );
    }
    if (!this._ctx._partitionRoots) this._ctx._partitionRoots = new Set<number>();
    this._ctx._partitionRoots.add(id);
    this._baselinePartition(id);
  }

  /**
   * The partition roots CHANGED since the last {@link clearTouchedPartitions},
   * by either of the two ways a partition can change:
   *
   * - **A move.** `moveToInternal` marks BOTH endpoints, source and
   *   destination, because a cross-partition move dirties a destination the
   *   command's reads never hydrated. The move record is also the only carrier
   *   for a re-parented partition ROOT: a whole partition that changes parent
   *   keeps its own serialized bytes identical (a subtree does not serialize
   *   its parent), so the comparison below cannot see it.
   * - **An attribute change**, detected by comparing each resident partition's
   *   serialized form against the baseline captured at
   *   `definePartition`/`adoptSubtree`/`clearTouchedPartitions`. There is no
   *   write chokepoint to instrument instead: an attribute is a bare instance
   *   property, and its value can be mutated deeper still
   *   (`token.tags.push(...)`) with no assignment to the element at all. The
   *   serialized form is the one thing every persistable change must alter --
   *   a change it cannot see is a change no checkpoint could have carried.
   *
   * Combine it with the partitions the platform hydrated to get the
   * checkpoint's dirty set. Reading this serializes every resident partition
   * once, so read it at a checkpoint boundary, not in a loop.
   */
  get touchedPartitions(): ReadonlySet<number> {
    const touched = new Set(this._ctx._touchedPartitions);
    const baselines = this._ctx._partitionBaselines;
    if (baselines) {
      for (const [id, baseline] of baselines) {
        if (!touched.has(id) && this._partitionFingerprint(id) !== baseline) touched.add(id);
      }
    }
    return touched;
  }

  /**
   * Forget every touch and re-baseline every resident partition. Called by the
   * platform after a checkpoint, so what {@link touchedPartitions} reports next
   * belongs to the commands after this moment.
   */
  clearTouchedPartitions(): void {
    this._ctx._touchedPartitions = new Set<number>();
    const baselines = new Map<number, string>();
    for (const id of this._ctx._partitionRoots ?? []) {
      const fingerprint = this._partitionFingerprint(id);
      if (fingerprint !== undefined) baselines.set(id, fingerprint);
    }
    this._ctx._partitionBaselines = baselines;
  }

  /** One resident partition's serialized form, or undefined when not resident. */
  private _partitionFingerprint(id: number): string | undefined {
    const root = this.getElementById(id);
    if (!root) return undefined;
    return JSON.stringify(root.toJSON());
  }

  /** Capture one partition's baseline at the moment it becomes (or is declared) resident. */
  private _baselinePartition(id: number): void {
    if (!this._ctx._partitionBaselines) this._ctx._partitionBaselines = new Map<number, string>();
    const fingerprint = this._partitionFingerprint(id);
    if (fingerprint !== undefined) this._ctx._partitionBaselines.set(id, fingerprint);
  }

  /**
   * Graft one serialized subtree into the resident tree, under `parentId`.
   *
   * This is the same restore path a snapshot uses (`GameElement.fromJSON`),
   * pointed at a found parent instead of at the game root, so an adopted
   * element is indistinguishable from one that was never evicted.
   *
   * Two passes that bracket `loadSerializedState`'s rebuild are deliberately
   * NOT repeated here:
   *
   * - **Space `onEnter`/`onExit` re-binding.** `loadSerializedState` captures
   *   handlers off the constructor-built tree before discarding it, because
   *   that tree is the only place those closures exist. An adoption discards
   *   nothing: the subtree is new to this process and has no earlier
   *   incarnation to capture from, so there is nothing a re-bind pass could
   *   recover. The handlers of a grafted Space come from ITS OWN class
   *   constructor, which `fromJSON` runs — so in world mode a Space that needs
   *   `onEnter`/`onExit` must register them in its own constructor, never in
   *   the Game constructor. A Game-constructor handler for a partition that is
   *   not resident at construction time has nothing to attach to and is
   *   silent game-logic loss.
   * - **`resolveElementReferences(this)` over the whole game.** Run over the
   *   GRAFTED SUBTREE only. Whole-game resolution is the O(world) pass this
   *   mode exists to remove, and every attribute outside the graft already
   *   holds live objects. References pointing OUT of the graft into a
   *   partition that is not resident stay as `{ __elementId }` ref objects
   *   rather than becoming `undefined`, so they survive to the next
   *   checkpoint (see `GameElement.deserializeValue`).
   *
   * @returns the grafted subtree's root, now a partition root.
   */
  adoptSubtree(parentId: number, json: ElementJSON): GameElement {
    this._requireWorldMode('adoptSubtree');

    const parent = this.getElementById(parentId);
    if (!parent) {
      throw new Error(
        `Cannot adopt partition "${json.name ?? json.className}" under parent id ${parentId}: ` +
          `no element with that id is resident. Hydrate the parent's partition first — a graft ` +
          `needs its attachment point in the tree.`
      );
    }

    // Ids arriving from storage were minted by an earlier run of the id
    // counter, which is a bare `_ctx.sequence++` with no registry behind it.
    // Two consequences, and both are corruption:
    //   - a resident id repeated by the incoming subtree makes `atId` return
    //     whichever copy the DFS reaches first;
    //   - a counter left below the adopted ids makes the next `create()` mint
    //     one that collides.
    const adoptedIds: number[] = [];
    collectJsonIds(json, adoptedIds);

    const resident = new Set<number>();
    collectResidentIds(this, resident);
    collectResidentIds(this.pile, resident);
    const clash = adoptedIds.find((id) => resident.has(id));
    if (clash !== undefined) {
      throw new Error(
        `Cannot adopt partition "${json.name ?? json.className}": element id ${clash} is already ` +
          `resident in this game. A partition may only be adopted once — evict the resident copy ` +
          `(Game#evictSubtree) before adopting it again.`
      );
    }

    const maxAdoptedId = Math.max(...adoptedIds);
    if (this._ctx.sequence <= maxAdoptedId) {
      this._ctx.sequence = maxAdoptedId + 1;
    }

    const element = GameElement.fromJSON(json, this._ctx, this._ctx.classRegistry);
    element._t.parent = parent;
    element.game = this;
    parent._t.children.push(element);

    element.resolveElementReferences(this);

    if (!this._ctx._partitionRoots) this._ctx._partitionRoots = new Set<number>();
    this._ctx._partitionRoots.add(element._t.id);
    // Baselined from the GRAFTED tree, not from the incoming bytes: the two
    // can differ in key order, and a baseline that disagreed with the live
    // serialization would report a fresh adoption dirty before anything wrote.
    this._baselinePartition(element._t.id);

    return element;
  }

  /**
   * Detach a subtree from the resident tree.
   *
   * The subtree simply stops being in the tree, so nothing after this pays to
   * traverse it. Deliberately NOT routed through `moveToInternal`: eviction is
   * a residency change, not a game move, and firing a Space's `onExit` for it
   * would run game logic for an event that did not happen in the world.
   *
   * A move-touch already recorded against this partition is kept. The
   * partition was dirtied while it was resident; dropping the mark because it
   * left memory would lose a checkpoint.
   */
  evictSubtree(id: number): void {
    this._requireWorldMode('evictSubtree');

    if (id === this._t.id) {
      throw new Error(
        `Cannot evict the game root (id ${id}): it is the tree every partition hangs from. ` +
          `Evict the individual partitions instead.`
      );
    }

    const element = this.getElementById(id);
    if (!element) {
      throw new Error(
        `Cannot evict partition ${id}: no element with that id is resident. It was either never ` +
          `hydrated or has already been evicted.`
      );
    }

    const parent = element._t.parent;
    if (!parent) {
      throw new Error(
        `Cannot evict element ${id} ("${element.name ?? element.constructor.name}"): it has no ` +
          `parent, so it is not attached to the resident tree.`
      );
    }

    // A content change not yet checkpointed must not leave with the subtree:
    // promote it into the kept touch-marks before the baseline is dropped,
    // exactly as a move-touch is kept (see the docblock above).
    const baseline = this._ctx._partitionBaselines?.get(id);
    if (baseline !== undefined && this._partitionFingerprint(id) !== baseline) {
      if (!this._ctx._touchedPartitions) this._ctx._touchedPartitions = new Set<number>();
      this._ctx._touchedPartitions.add(id);
    }

    const index = parent._t.children.indexOf(element);
    parent._t.children.splice(index, 1);
    element._t.parent = undefined;

    this._ctx._partitionRoots?.delete(id);
    this._ctx._partitionBaselines?.delete(id);
  }

  /**
   * World-mode operations are refused in snapshot mode rather than quietly
   * working, because a subtree serialized outside world mode carries
   * positional branch refs and grafting it into a partial tree resolves them
   * to the wrong elements.
   */
  private _requireWorldMode(method: string): void {
    if (this._ctx._worldMode) return;
    throw new Error(
      `Game#${method}() is world mode only, and this game is in snapshot mode. ` +
        `Construct it with \`new GameClass({ ..., worldMode: true })\`: snapshot mode records ` +
        `element references as positional branch paths, which resolve to the wrong element ` +
        `once a partition is not resident. It is a construction option and not a switch ` +
        `because a subclass constructor builds the game's furniture before any switch could run.`
    );
  }

  // ============================================
  // Command Execution
  // ============================================

  /**
   * Execute a command and record it in history
   */
  execute(command: GameCommand): CommandResult {
    // Capture inverse BEFORE executing (needed for proper undo)
    const inverse = createInverseCommand(this, command);

    const result = executeCommand(this, command);
    if (result.success) {
      this.commandHistory.push(command);
      this._inverseHistory.push(inverse);
    }
    return result;
  }

  /**
   * Replay commands to rebuild state
   */
  replayCommands(commands: GameCommand[]): void {
    for (const command of commands) {
      const result = executeCommand(this, command);
      if (!result.success) {
        throw new Error(`Failed to replay command: ${result.error}`);
      }
      this.commandHistory.push(command);
      // Can't compute inverse during replay - set to null
      this._inverseHistory.push(null);
    }
  }

  /**
   * Undo the last command in history.
   * Returns false if history is empty or last command is not invertible.
   *
   * @internal Used by MCTS for efficient state rollback
   */
  undoLastCommand(): boolean {
    if (this.commandHistory.length === 0) return false;

    const lastInverse = this._inverseHistory[this._inverseHistory.length - 1];
    if (!lastInverse) {
      // Command not invertible
      return false;
    }

    const lastCommand = this.commandHistory[this.commandHistory.length - 1];
    const result = undoCommand(this, lastCommand, lastInverse);

    if (result.success) {
      this.commandHistory.pop();
      this._inverseHistory.pop();
    }

    return result.success;
  }

  /**
   * Undo multiple commands from history.
   * Stops and returns false if any command is not invertible.
   *
   * @internal Used by MCTS for efficient state rollback
   */
  undoCommands(count: number): boolean {
    for (let i = 0; i < count; i++) {
      if (!this.undoLastCommand()) return false;
    }
    return true;
  }

  // ============================================
  // Action System
  // ============================================

  /**
   * Register a single action definition.
   *
   * Prefer `registerActions()` for registering multiple actions at once.
   *
   * @param action - The action definition to register
   */
  registerAction(action: ActionDefinition): void {
    if (action.handlerless) {
      throw new Error(
        `Action '${action.name}' has no execute handler — end the chain with .execute(fn) before registering it. ` +
          `.build() alone produces a handler-less definition for inspection only; it must not be registered directly.`,
      );
    }
    this._actions.set(action.name, action);
  }

  /**
   * Register multiple action definitions.
   *
   * Actions define what players can do during the game. Each action has a name,
   * optional selections (choices the player must make), and an effect.
   *
   * @param actions - Action definitions created with the `Action.create()` builder
   *
   * @example
   * ```typescript
   * // In your game's constructor, before startFlow()
   * this.registerActions(
   *   Action.create('drawCard')
   *     .execute((args, ctx) => this.deck.first(Card)?.putInto(ctx.player.hand)),
   *
   *   Action.create('playCard')
   *     .chooseElement('card', { filter: c => c.parent === this.currentPlayer.hand })
   *     .chooseElement('target', { filter: c => c instanceof Space })
   *     .execute(({ card, target }) => card.putInto(target)),
   *
   *   Action.create('endTurn')
   *     .execute(() => this.setCurrentPlayer(this.nextPlayer()!))
   * );
   * ```
   */
  registerActions(...actions: ActionDefinition[]): void {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  /**
   * Get an action definition by name
   */
  getAction(name: string): ActionDefinition | undefined {
    return this._actions.get(name);
  }

  /**
   * Get all registered action names
   */
  /**
   * Re-derive the awaiting set of the currently open `simultaneousActionStep`,
   * admitting seats that have become eligible since it opened (#28).
   *
   * Call this after something OTHER than a seat's own action changes what that
   * seat may legally do — a round boundary that gives an uninhabited seat a
   * character, a resource that arrives from elsewhere. Without it the seat keeps
   * the list it was frozen with at step entry and cannot act until the next
   * entry, even though the game considers it a full participant.
   *
   * The awaiting set can grow as well as shrink. A seat that already committed
   * this step is left alone. No-op when no simultaneous step is open.
   *
   * @param seat - Refresh only this seat (1-indexed). Omit for every seat.
   *
   * @example
   * ```typescript
   * // In the round-boundary execute() that materialises pending arrivals:
   * for (const seat of arriving) placeCharacter(game, seat);
   * game.refreshAwaitingActions();
   * ```
   */
  refreshAwaitingActions(seat?: number): void {
    this._flowEngine?.refreshAwaitingActions(seat);
  }

  getActionNames(): string[] {
    return [...this._actions.keys()];
  }

  /**
   * Get available actions for a player
   */
  getAvailableActions(player: P): ActionDefinition[] {
    const available: ActionDefinition[] = [];
    for (const action of this._actions.values()) {
      if (this._actionExecutor.isActionAvailable(action, player)) {
        available.push(action);
      }
    }
    return available;
  }

  /**
   * Get the reason each currently-available action is disabled for a seat.
   *
   * Returns a `Record<actionName, reason>` covering both sources of a
   * disabled action, in one place so the UI has a single channel to render:
   *   1. the action's own `.disabled(ctx)` rule, and
   *   2. the active tutorial step's gate.
   *
   * Returns `{}` when nothing is disabled (the overwhelmingly common case).
   *
   * Unlike `getAvailableActions` (which remains binary), a disabled action is
   * NOT removed from availability — it stays visible precisely so the UI can
   * grey it out and say why. That is the whole point: a vanished button
   * teaches the player nothing.
   *
   * The tutorial reason wins when both apply: a tutorial is a stronger, more
   * immediate instruction ("use Move for this step") than a standing rule.
   *
   * @param seat - The player seat number (1-indexed).
   */
  getDisabledActions(seat: number): Record<string, string> {
    const player = this.getPlayer(seat);
    if (!player) return {};

    const availableActions = this.getAvailableActions(player);
    const reasons: Record<string, string> = {};

    for (const action of availableActions) {
      const reason = this.getActionDisabledReason(action, player);
      if (reason) reasons[action.name] = reason;
    }

    // Tutorial gate reasons are layered on top (and win) — see JSDoc above.
    return {
      ...reasons,
      ...getActionLevelDisabledReasons(this, seat, availableActions.map(a => a.name)),
    };
  }

  /**
   * Evaluate a single action's own `.disabled(ctx)` rule.
   *
   * Returns the reason string when the action is disabled, or `null` when it
   * is not (or declares no rule). Evaluated with EMPTY args, matching
   * `condition`'s availability-time contract.
   *
   * Shared by `getDisabledActions` (projection) and `performAction`
   * (enforcement) so the button a player sees and the gate the server applies
   * can never disagree.
   */
  private getActionDisabledReason(action: ActionDefinition, player: P): string | null {
    if (!action.disabled) return null;
    const reason = action.disabled({ game: this, player, args: {} });
    return reason === false ? null : reason;
  }

  /**
   * Get the action executor (for advanced usage like building action metadata)
   */
  getActionExecutor(): ActionExecutor {
    return this._actionExecutor;
  }

  /**
   * Get the choices for a selection (for UI).
   * Returns AnnotatedChoice[] with each item annotated with disabled status.
   * Tutorial gate disabled reasons are included so the UI can surface them.
   */
  getSelectionChoices(
    actionName: string,
    selectionName: string,
    player: P,
    args: Record<string, unknown> = {}
  ): AnnotatedChoice<unknown>[] {
    const action = this._actions.get(actionName);
    if (!action) return [];

    const selection = action.selections.find(s => s.name === selectionName);
    if (!selection) return [];

    return this._actionExecutor.getChoices(selection, player, args, actionName);
  }

  // -------------------------------------------------------------------------
  // INTRO-01: getActionSpace — full legal action space for a seat
  // -------------------------------------------------------------------------

  /**
   * Return every action this seat can legally execute right now, each with its
   * static selection metadata and a D-01 `argTemplate`.
   *
   * Implementation order (locked — do NOT call evaluateCondition directly):
   *   1. availableActionsForSeat(this.getFlowState(), seat) → string[]
   *   2. resolve Player for seat; return { actions: [] } if absent
   *   3. buildActionMetadata(this, player, actionNames) → condition-checked metadata
   *   4. map each ActionMetadata → ActionSchemaView, deriving argTemplate per D-01
   *
   * The returned object is plain JSON-serializable (no element refs).
   *
   * @param seat - Player seat (1-indexed)
   */
  getActionSpace(seat: number): ActionSpaceView {
    const player = this.getPlayer(seat);
    if (!player) return { actions: [] };

    const actionNames = availableActionsForSeat(this.getFlowState(), seat);

    // buildActionMetadata handles condition re-checking internally — no parallel validator
    const metadata = buildActionMetadata(this, player, actionNames);

    const actions: ActionSchemaView[] = Object.values(metadata).map((m: ActionMetadata) => {
      const argTemplate: ArgTemplate = {};
      for (const sel of m.selections) {
        argTemplate[sel.name] = sel.optional ? null : { __required: true };
      }
      return {
        name: m.name,
        ...(m.prompt !== undefined && { prompt: m.prompt }),
        ...(m.help !== undefined && { help: m.help }),
        selections: m.selections,
        argTemplate,
      };
    });

    return { actions };
  }

  // -------------------------------------------------------------------------
  // INTRO-02: getActionSchema — single-action convenience method
  // -------------------------------------------------------------------------

  /**
   * Return the static `ActionMetadata` for one action name from this seat's
   * perspective, or `undefined` if the action is unknown or the seat has no
   * player.
   *
   * Unlike `getActionSpace`, this does NOT filter by availability — it returns
   * the schema even for actions whose condition is currently false. Use
   * `getActionSpace` when you need condition-checked actions only.
   *
   * Intentionally skips condition evaluation so callers can inspect registered
   * actions regardless of their current legality (e.g. for grayed-out UI,
   * tutorial overlays, or agent introspection of the full action space).
   *
   * @param actionName - Registered action name
   * @param seat - Player seat (1-indexed)
   */
  getActionSchema(actionName: string, seat: number): ActionMetadata | undefined {
    const player = this.getPlayer(seat);
    if (!player) return undefined;

    const actionDef = this._actions.get(actionName);
    if (!actionDef) return undefined;

    // Intentionally skip condition check — returns schema regardless of current
    // availability. Use getActionSpace() when you need condition-filtered actions.
    const selections = actionDef.selections.map(sel =>
      buildPickMetadata(this, player, sel)
    );
    return {
      name: actionName,
      prompt: actionDef.prompt,
      help: actionDef.help,
      selections,
    };
  }

  /**
   * Perform an action with the given arguments
   */
  performAction(
    actionName: string,
    player: P,
    args: Record<string, unknown>
  ): ActionResult {
    // Clear previous animation events -- new action starts a new batch
    this._animationEvents = [];

    const action = this._actions.get(actionName);
    if (!action) {
      return { success: false, error: `Unknown action: ${actionName}` };
    }

    // Enforce action-level disabling at execution, not just in the projection
    // layer: a greyed-out button must also be a closed door. Covers both the
    // action's own `.disabled()` rule and the tutorial gate — a bare
    // { action: 'move' } gate must prevent execution of 'pass'/'endTurn', not
    // just annotate them for the UI (HR-01). Both reuse the same evaluators the
    // projection consults (getActionDisabledReason / getActionLevelDisabledReasons),
    // so there is no parallel validator to drift.
    const disabledReason =
      getActionLevelDisabledReasons(this, player.seat, [actionName])[actionName]
      ?? this.getActionDisabledReason(action, player);
    if (disabledReason) {
      return {
        success: false,
        error: `Action '${actionName}' is disabled: ${disabledReason}`,
      };
    }

    return this._actionExecutor.executeAction(action, player, args);
  }

  /**
   * Perform an action from serialized form (for network play)
   */
  performSerializedAction(serialized: SerializedAction): ActionResult {
    const player = this.getPlayer(serialized.player);
    if (!player) {
      return { success: false, error: `Invalid player seat: ${serialized.player}. Expected 1 to ${this.players.length}.` };
    }

    return this.performAction(serialized.name, player as P, serialized.args);
  }

  // ============================================
  // Debug API
  // ============================================

  /**
   * Register a custom debug entry.
   * The provided function will be called when debug data is requested.
   * Use this to expose game-specific debug information in the debug panel.
   *
   * Debug payloads are dev-only: they are only broadcast to clients when the
   * session is created with `GameSessionOptions.debugEnabled: true` (default
   * `false`, SEC-04). Do NOT use `registerDebug` to expose hidden/secret game
   * state (a hand's contents, an opponent's hidden hand, deck order, etc) —
   * enabling `debugEnabled` on a live/production session would broadcast it
   * to every connected player and spectator. Prefer non-secret diagnostics
   * like element counts, tree shape, or public derived state.
   *
   * @example
   * ```typescript
   * // In game setup
   * this.registerDebug('Sector Stats', () =>
   *   this.all(Sector).map(s => ({
   *     name: s.sectorName,
   *     explored: s.explored,
   *     itemCount: s.stash.length
   *   }))
   * );
   * ```
   */
  registerDebug(name: string, fn: () => unknown): void {
    this._debugRegistry.set(name, fn);
  }

  /**
   * Get all custom debug data.
   * Calls each registered debug function and collects the results.
   */
  getCustomDebugData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (const [name, fn] of this._debugRegistry) {
      try {
        data[name] = fn();
      } catch (error) {
        data[name] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    return data;
  }

  /**
   * Get action availability traces for a player.
   * Returns detailed information about why each action is or isn't available.
   * Used by the debug interface to show action condition status.
   */
  getActionTraces(player: P): ActionTrace[] {
    const traces: ActionTrace[] = [];
    for (const action of this._actions.values()) {
      traces.push(this._actionExecutor.traceActionAvailability(action, player));
    }
    return traces;
  }

  /**
   * Debug why an action is or isn't available for a player.
   * Returns human-readable information explaining the availability status.
   *
   * This is the recommended method for debugging action availability issues.
   * It provides clear explanations rather than just raw trace data.
   *
   * @example
   * ```typescript
   * const debug = game.debugActionAvailability('equipItem', player);
   * console.log(debug.reason);
   * // "Selection 'equipment' has no valid choices"
   *
   * // For more detail:
   * for (const sel of debug.details.selections) {
   *   console.log(`${sel.name}: ${sel.choices} choices`);
   *   if (sel.note) console.log(`  └─ ${sel.note}`);
   * }
   * ```
   *
   * @param actionName - Name of the action to debug
   * @param player - Player to check availability for
   * @returns Human-readable debug information
   */
  debugActionAvailability(actionName: string, player: P): ActionDebugInfo {
    const action = this._actions.get(actionName);

    if (!action) {
      return {
        actionName,
        available: false,
        reason: `Action '${actionName}' does not exist`,
        details: {
          conditionPassed: false,
          conditionNote: `No action registered with name '${actionName}'. Check for typos or ensure the action is registered.`,
          selections: [],
        },
      };
    }

    const trace = this._actionExecutor.traceActionAvailability(action, player);
    return this._formatActionDebugInfo(trace);
  }

  /**
   * Debug all actions for a player.
   * Returns human-readable information for every registered action.
   *
   * @example
   * ```typescript
   * const allDebug = game.debugAllActions(player);
   * for (const debug of allDebug) {
   *   if (!debug.available) {
   *     console.log(`${debug.actionName}: ${debug.reason}`);
   *   }
   * }
   * ```
   */
  debugAllActions(player: P): ActionDebugInfo[] {
    return this.getActionTraces(player).map(trace => this._formatActionDebugInfo(trace));
  }

  /**
   * Debug element tree to diagnose element count issues.
   * Returns detailed information about the element tree structure.
   *
   * Use this when debugging issues like:
   * - Element count explosion (too many elements)
   * - Missing elements (elements not found)
   * - Tree corruption (circular references)
   *
   * @example
   * ```typescript
   * const treeInfo = game.debugElementTree();
   * console.log(treeInfo.summary);
   * // "Total: 205 elements in tree, 12 in pile, sequence at 217"
   *
   * console.log(treeInfo.byClass);
   * // { Equipment: 198, Sector: 5, Player: 2 }
   * ```
   */
  debugElementTree(): {
    /** Total elements in main game tree */
    totalInTree: number;
    /** Total elements in the pile (removed elements) */
    totalInPile: number;
    /** Element sequence counter (total elements ever created) */
    sequenceCounter: number;
    /** Element counts by class name */
    byClass: Record<string, number>;
    /** Max tree depth */
    maxDepth: number;
    /** Summary string */
    summary: string;
    /** Any integrity issues detected */
    issues: string[];
  } {
    const byClass: Record<string, number> = {};
    let maxDepth = 0;
    const issues: string[] = [];
    const seenIds = new Set<number>();
    const seenElements = new Set<GameElement>();

    const processElement = (el: GameElement, depth: number, expectedParent?: GameElement) => {
      // Check for circular reference (same element visited twice)
      if (seenElements.has(el)) {
        issues.push(`Circular reference detected: element ${el.name} (id: ${el.id}) visited twice`);
        return;
      }
      seenElements.add(el);

      // Check for duplicate IDs
      if (seenIds.has(el.id)) {
        issues.push(`Duplicate ID detected: ${el.id} (${el.name})`);
      }
      seenIds.add(el.id);

      // Check parent-child consistency
      if (expectedParent && el._t.parent !== expectedParent) {
        const actualParentName = el._t.parent?.name ?? el._t.parent?.constructor.name ?? 'undefined';
        const expectedParentName = expectedParent.name ?? expectedParent.constructor.name;
        issues.push(
          `Parent mismatch: ${el.name} (id: ${el.id}) is in ${expectedParentName}'s children ` +
          `but its _t.parent points to ${actualParentName} (id: ${el._t.parent?.id ?? 'none'})`
        );
      }

      // Count by class
      const className = el.constructor.name;
      byClass[className] = (byClass[className] || 0) + 1;

      // Track depth
      maxDepth = Math.max(maxDepth, depth);

      // Process children
      for (const child of el._t.children) {
        processElement(child, depth + 1, el);
      }
    };

    // Process main tree (starting from game's children, not game itself)
    for (const child of this._t.children) {
      processElement(child, 1, this);
    }

    const totalInTree = seenElements.size;

    // Reset for pile processing
    seenElements.clear();
    seenIds.clear();

    // Process pile
    for (const child of this.pile._t.children) {
      processElement(child, 1, this.pile);
    }

    const totalInPile = seenElements.size;
    const sequenceCounter = this._ctx.sequence;

    // Check if sequence is much higher than element count (suggests many deletions)
    if (sequenceCounter > totalInTree + totalInPile + 100) {
      issues.push(
        `Sequence counter (${sequenceCounter}) is much higher than total elements (${totalInTree + totalInPile}). ` +
        `This suggests many elements were created and removed, which is normal but could indicate unexpected element creation.`
      );
    }

    const summary = `Total: ${totalInTree} elements in tree, ${totalInPile} in pile, sequence at ${sequenceCounter}`;

    return {
      totalInTree,
      totalInPile,
      sequenceCounter,
      byClass,
      maxDepth,
      summary,
      issues,
    };
  }

  /**
   * Debug helper: Check if an element's parent-child relationships are consistent.
   * Use this to diagnose tree corruption issues.
   *
   * @example
   * ```typescript
   * const info = game.debugElement(suspiciousElement);
   * if (info.issues.length > 0) {
   *   console.error('Tree corruption:', info.issues);
   * }
   * ```
   *
   * @returns Object with validation results and any issues found
   */
  debugElement(element: GameElement): {
    id: number;
    name: string;
    parentId: number | undefined;
    parentName: string | undefined;
    childIds: number[];
    isInParentChildren: boolean;
    childrenPointToThis: boolean[];
    issues: string[];
  } {
    const issues: string[] = [];

    // Check if this element is in its parent's children
    const parent = element._t.parent;
    const isInParentChildren = parent
      ? parent._t.children.includes(element)
      : true; // No parent = OK

    if (parent && !isInParentChildren) {
      issues.push(
        `Element "${element.name}" (id: ${element.id}) has parent "${parent.name}" (id: ${parent.id}) ` +
        `but is NOT in parent's _t.children array`
      );
    }

    // Check if all children point back to this element
    const childrenPointToThis = element._t.children.map(child => child._t.parent === element);
    const wrongParentChildren = element._t.children.filter(child => child._t.parent !== element);
    for (const child of wrongParentChildren) {
      const actualParent = child._t.parent;
      issues.push(
        `Child "${child.name}" (id: ${child.id}) is in "${element.name}"'s children ` +
        `but _t.parent points to "${actualParent?.name}" (id: ${actualParent?.id ?? 'none'})`
      );
    }

    return {
      id: element.id,
      name: element.name ?? element.constructor.name,
      parentId: parent?.id,
      parentName: parent?.name ?? parent?.constructor.name,
      childIds: element._t.children.map(c => c.id),
      isInParentChildren,
      childrenPointToThis,
      issues,
    };
  }

  /**
   * Convert an ActionTrace to human-readable ActionDebugInfo
   */
  private _formatActionDebugInfo(trace: ActionTrace): ActionDebugInfo {
    const selections: PickDebugInfo[] = trace.selections.map(sel => {
      const passed = !!sel.optional || sel.choiceCount !== 0;
      let note: string | undefined;

      if (sel.choiceCount === -1) {
        note = 'Free input (text/number) - always available';
      } else if (sel.optional) {
        note = sel.choiceCount > 0
          ? `Optional with ${sel.choiceCount} choices`
          : 'Optional - can be skipped';
      } else if (sel.choiceCount === 0) {
        if (sel.dependentOn) {
          note = `Depends on '${sel.dependentOn}' - no valid combinations found`;
        } else if (sel.filterApplied) {
          note = 'Filter eliminated all choices';
        } else {
          note = 'No elements/choices available';
        }
      } else {
        note = `${sel.choiceCount} valid choice${sel.choiceCount === 1 ? '' : 's'}`;
      }

      return {
        name: sel.name,
        choices: sel.choiceCount,
        passed,
        note,
      };
    });

    // Determine the reason
    let reason: string;
    const conditionPassed = trace.conditionResult !== false;
    let conditionNote: string | undefined;

    if (trace.conditionError) {
      reason = `Condition threw an error: ${trace.conditionError}`;
      conditionNote = trace.conditionError;
    } else if (!conditionPassed) {
      // Build condition note from details if available
      if (trace.conditionDetails && trace.conditionDetails.length > 0) {
        const failedChecks = trace.conditionDetails.filter(d => !d.passed);
        if (failedChecks.length > 0) {
          conditionNote = failedChecks.map(d => `${d.label} = ${JSON.stringify(d.value)}`).join(', ');
          reason = `Condition failed: ${conditionNote}`;
        } else {
          reason = 'Condition returned false';
          conditionNote = 'Condition returned false (use object-based condition for details)';
        }
      } else {
        reason = 'Condition returned false';
        conditionNote = 'Condition returned false (use object-based condition for automatic tracing)';
      }
    } else if (!trace.available) {
      // Find the blocking selection
      const blockingSel = selections.find(s => !s.passed);
      if (blockingSel) {
        reason = `Selection '${blockingSel.name}' has no valid choices`;
        if (blockingSel.note) {
          reason += ` (${blockingSel.note})`;
        }
      } else {
        reason = 'No valid selection path found';
      }
    } else {
      // Action is available
      if (selections.length === 0) {
        reason = 'Action is available (no selections required)';
      } else {
        const firstSel = selections[0];
        reason = `Action is available with ${firstSel.choices} choice${firstSel.choices === 1 ? '' : 's'} for '${firstSel.name}'`;
      }
    }

    return {
      actionName: trace.actionName,
      available: trace.available,
      reason,
      details: {
        conditionPassed,
        conditionNote,
        selections,
      },
    };
  }

  // ============================================
  // Flow System
  // ============================================

  /**
   * Set the flow definition for this game.
   *
   * The flow defines the structure of your game: the order of turns,
   * phases, and when the game ends. Use the flow builder functions
   * (`defineFlow`, `loop`, `eachPlayer`, `actionStep`, etc.) to create
   * the flow definition.
   *
   * @param definition - Flow definition created with `defineFlow()`
   *
   * @example
   * ```typescript
   * // In your game's constructor
   * this.setFlow(defineFlow({
   *   root: loop({
   *     while: () => !this.isFinished(),
   *     do: eachPlayer({
   *       do: sequence(
   *         actionStep({ actions: ['draw'] }),
   *         actionStep({ actions: ['play', 'endTurn'] })
   *       )
   *     })
   *   }),
   *   isComplete: () => this.deck.isEmpty(),
   *   getWinners: () => [this.players.withHighestScore()]
   * }));
   * ```
   */
  setFlow(definition: FlowDefinition<G>): void {
    this._flowDefinition = definition;
  }

  /**
   * Get the flow definition
   */
  getFlow(): FlowDefinition<G> | undefined {
    return this._flowDefinition;
  }

  /**
   * PIT-03: Statically walk the flow-node tree and validate that every
   * action referenced by an `action-step` / `simultaneous-action-step` is
   * registered.
   *
   * Throws on any referenced-but-unregistered action (a typo'd action name
   * would otherwise only surface at runtime, and only when that specific
   * flow branch is reached). The reverse case — a registered action
   * referenced by no `action-step` — is a `devWarn`, not a throw, since
   * an action may be intentionally invoked outside the static flow tree
   * (e.g. from another action's `.execute()`, or a follow-up action).
   *
   * Blind spot (documented, not fixable by static analysis): when
   * `config.actions` is a function (e.g. `polyhedral-potions`'s dynamic
   * per-context action lists), the referenced names cannot be enumerated
   * without invoking the function — which may depend on runtime game
   * state that doesn't exist yet at `startFlow()` time. Function-valued
   * `actions` are skipped entirely by this static walk — and when any are
   * present, the unreachable-action warning pass is suppressed too, since
   * the referenced set is incomplete and warnings would be false positives.
   */
  #validateActionReachability(): void {
    if (!this._flowDefinition) return;

    const referencedNames = new Set<string>();
    /** First step that named each action, so an error can point at it. */
    const referencedBy = new Map<string, string>();
    let hasDynamicActionStep = false;

    for (const node of walkFlowNodes(this._flowDefinition.root)) {
      if (node.type !== 'action-step' && node.type !== 'simultaneous-action-step') {
        continue;
      }
      const { actions } = node.config;
      // Function-valued `actions` cannot be statically enumerated — skip.
      // (documented static-walk blind spot; see method doc comment above)
      if (typeof actions === 'function') {
        hasDynamicActionStep = true;
        continue;
      }
      const stepName = node.config.name ?? node.type;
      for (const name of actions) {
        referencedNames.add(name);
        if (!referencedBy.has(name)) referencedBy.set(name, stepName);
      }
    }

    for (const name of referencedNames) {
      if (!this.getAction(name)) {
        const registered = this.getActionNames();
        throw new Error(
          `Flow step '${referencedBy.get(name)}' references action '${name}' that is not registered.\n` +
          `  Registered actions: ${registered.length ? registered.join(', ') : '(none)'}\n` +
          `  Fix: call this.registerActions(Action.create('${name}')...) in your game's constructor ` +
          `before startFlow(), or correct the name in the actionStep(...) that references it.`
        );
      }
    }

    // Any function-valued `actions` makes `referencedNames` incomplete —
    // every registered action could be offered dynamically, so the
    // unreachable-action warning would be guesswork. Stay silent rather
    // than cry wolf.
    if (hasDynamicActionStep) return;

    for (const name of this.getActionNames()) {
      if (!referencedNames.has(name)) {
        devWarn(
          `unreachable-action:${name}`,
          `Action '${name}' is registered but referenced by no actionStep() in the flow. ` +
          `It will never be offered to a player unless invoked another way (e.g. as a follow-up action, ` +
          `or from another action's .execute()). If that's unintentional, add it to an actionStep(...), ` +
          `or remove the registration.`
        );
      }
    }
  }

  /**
   * Start the game flow
   */
  startFlow(): FlowState {
    if (!this._flowDefinition) {
      throw new Error('No flow definition set');
    }

    this.#validateActionReachability();

    // `this.game` rather than `this`: the engine is generic over the game type
    // the flow was WRITTEN against (`FlowDefinition<G>`), and inside the base
    // class `this` is the polymorphic `this` type, which TypeScript cannot
    // relate to `G`. `this.game` is the same object, already carried as `G` by
    // the one F-bounded self-bridge this class establishes (see its assignment).
    this._flowEngine = new FlowEngine(this.game, this._flowDefinition);

    // PIT-02: record every element class queried through the GameElement
    // finder methods (all/first/firstN/last/lastN/has) during this FIRST
    // traversal only, then diff against the class registry below. This
    // catches a class queried via e.g. `game.all(Foo)` but never registered
    // (typo / dead class reference) — which otherwise fails silently
    // because an unregistered-class query just returns an empty collection.
    // Scope boundary (documented limitation): only queries made through the
    // GameElement finder methods during this first traversal are checked.
    // Queries made directly on an ElementCollection (e.g.
    // `board.children.all(Foo)`, which has no `_ctx` linkage and cannot
    // call into the recording hook — see game-element.ts) and any
    // post-start / async queries are NOT covered. The try/finally
    // guarantees recording never leaks into normal play, even if start()
    // throws.
    this._ctx._pit02RecordingActive = true;
    this._ctx._pit02RecordedClasses = new Set();
    let state: FlowState;
    try {
      state = this._flowEngine.start();
    } finally {
      this._ctx._pit02RecordingActive = false;
    }

    for (const queriedClass of this._ctx._pit02RecordedClasses) {
      if (!this._ctx.classRegistry.has(queriedClass.name)) {
        throw new Error(
          `Element class '${queriedClass.name}' was queried (e.g. via game.all(${queriedClass.name})) ` +
          `but was never registered. Call this.registerElements([${queriedClass.name}]) in your game's ` +
          `constructor before startFlow(), or fix the typo if this was meant to reference a different class.`
        );
      }
    }

    // Update game phase based on flow state
    if (this.phase === 'setup') {
      this.phase = 'started';
    }
    // A flow can run to completion inside start() (a game whose whole result is
    // decided in setup, or a flow restored one step from its end). That is a
    // completion like any other, so it must publish winners the same way --
    // otherwise the session host reports `winners: []` and derives a false draw.
    this.#applyFlowCompletion(state);

    return state;
  }

  /**
   * Single place where a completed `FlowState` is reflected onto the game.
   * Every flow-advancing entry point (`startFlow`, `continueFlow`,
   * `continueFlowAfterPendingAction`) routes completion through here so a new
   * entry point cannot finish a game without publishing its winners.
   *
   * `settings.winners` is left untouched when the flow declared no winner, so a
   * game that ended by calling `this.finish([...])` itself keeps its own result.
   */
  #applyFlowCompletion(state: FlowState): void {
    if (!state.complete) return;
    this.phase = 'finished';
    const winners = this._flowEngine!.getWinners();
    if (winners.length > 0) {
      this.settings.winners = winners.map(p => p.seat);
    }
  }

  /**
   * Resume flow after player action
   * @param actionName Action name to perform
   * @param args Action arguments
   * @param playerIndex Optional player index for simultaneous actions
   */
  continueFlow(actionName: string, args: Record<string, unknown>, playerIndex?: number): FlowState {
    if (!this._flowEngine) {
      throw new Error('Flow not started');
    }

    const state = this._flowEngine.resume(actionName, args, playerIndex);

    this.#applyFlowCompletion(state);

    return state;
  }

  /**
   * Continue flow after a pending action was executed externally.
   * Used when an action with repeating selections completes via the action executor.
   * @param result The result of the executed action
   */
  continueFlowAfterPendingAction(result: ActionResult): FlowState {
    if (!this._flowEngine) {
      throw new Error('Flow not started');
    }

    const state = this._flowEngine.resumeAfterExternalAction(result);

    this.#applyFlowCompletion(state);

    return state;
  }

  /**
   * Get current flow state
   */
  getFlowState(): FlowState | undefined {
    return this._flowEngine?.getState();
  }

  /**
   * The `ActionResult` the most recent action's `execute()` returned, verbatim
   * — including `data`, an action's private return value to the seat that took
   * it (BUG-017). Deliberately kept off `FlowState`, which fans out to every
   * seat; see `FlowEngine.getLastActionResult()` for the lifetime rules.
   */
  getLastActionResult(): ActionResult | undefined {
    return this._flowEngine?.getLastActionResult();
  }

  /**
   * Read the live `FlowEngine`'s monotonic count of completed IRREVERSIBLE
   * `execute()` nodes -- those declared `{ irreversible: true }` (UNDO-02,
   * 155-02). Ordinary bookkeeping `execute()` nodes never advance it. `0` when
   * there is no active flow engine yet (matches the counter's own starting
   * value). `GameRunner` is the only consumer -- it compares this against its
   * own last-seen value after every recorded action to detect an advance and
   * set/extend its durable `executeBarrierIndex`. This counter itself resets to
   * 0 on every flow engine rebuild (restore); it is NOT durable on its own.
   */
  getIrreversibleCommitCount(): number {
    return this._flowEngine?.irreversibleCommitCount ?? 0;
  }

  /**
   * Get a structured, human- and machine-readable description of "where in
   * the flow are we right now" — phase, step, raw path, and who's being
   * awaited. Mirrors the `debugActionAvailability()` facade pattern: gather
   * raw data (flow definition root + current position/state), then delegate
   * to a dedicated formatter (`describeFlowPosition()`).
   *
   * Never throws and never returns `undefined` — when there is no active
   * flow (no flow definition set, or the flow hasn't started/has no
   * position yet), returns a well-formed `FlowDebugInfo` whose `describe()`
   * states there is no active flow.
   *
   * @example
   * ```typescript
   * const info = game.getFlowDebugInfo();
   * console.log(info.describe());
   * // "phase *pegging* -> step *player-turn*, waiting on seat 2"
   * ```
   */
  getFlowDebugInfo(): FlowDebugInfo {
    const flowState = this.getFlowState();
    const root = this._flowDefinition?.root;

    if (!root || !flowState) {
      return {
        phase: undefined,
        step: undefined,
        path: [],
        awaiting: { currentPlayer: undefined, awaitingPlayers: undefined },
        describe: () => 'no active flow',
      };
    }

    return describeFlowPosition(root, flowState.position, flowState);
  }

  /**
   * Restore flow from serialized position.
   * Throws if the position is invalid (e.g., flow structure changed).
   */
  restoreFlow(position: FlowPosition): void {
    if (!this._flowDefinition) {
      throw new Error('No flow definition set');
    }

    this._flowEngine = new FlowEngine(this.game, this._flowDefinition);
    const result = this._flowEngine.tryRestore(position);

    if (!result.success) {
      throw new Error(
        `Flow position invalid: ${result.error}. ` +
        `Valid path prefix: [${result.validPath.join(', ')}]`
      );
    }
  }

  /**
   * Restore full flow state including awaiting state.
   * Used for HMR where we want to restore exactly where we were.
   * Throws if the position is invalid (e.g., flow structure changed).
   *
   * @param idRemap - CR-02 (159): optional `originalId -> syntheticId` map (produced
   *   by `toJSONForPlayer`) for callers restoring a REDACTED clone. Lets an
   *   element-typed flow variable that pointed at a now-anonymized hidden-zone
   *   child relink to its correct redacted placeholder instead of being left as a
   *   dead serialized marker. Absent for the default (un-redacted) restore path —
   *   behavior there is unchanged.
   */
  restoreFlowState(state: FlowState, idRemap?: Map<number, number>): void {
    if (!this._flowDefinition) {
      throw new Error('No flow definition set');
    }

    this._flowEngine = new FlowEngine(this.game, this._flowDefinition);
    const result = this._flowEngine.restoreFullState(state, idRemap);

    if (!result.success) {
      throw new Error(
        `Flow position invalid: ${result.error}. ` +
        `Valid path prefix: [${result.validPath.join(', ')}]`
      );
    }
  }

  /**
   * Read the seeded RNG's internal state so it can be captured in a snapshot.
   * The state is the mulberry32 generator's single integer; restoring it makes
   * the next `game.random()` draw identical to the live game's (see setRandomState).
   */
  getRandomState(): number {
    return this.random.getState();
  }

  /**
   * Restore the seeded RNG's internal state from a snapshot value. After this the
   * next `game.random()` draw matches where the live game left off, so a
   * state-authoritative restore needs no action replay to re-advance the RNG.
   */
  setRandomState(state: number): void {
    this.random.setState(state);
  }

  /**
   * Make every random draw on this game throw {@link RandomnessForbiddenError}.
   *
   * PRIVATE and called from this class's own constructor only, driven by
   * `GameOptions.randomness` — which `GameRunner` writes from the host's
   * `hostOptions.randomness` (an order-entry / intent-capture session). There is
   * no public switch on purpose: flipping randomness off partway through a
   * session leaves whatever was already drawn standing, and calling it after
   * `new GameClass(...)` returned misses every draw a subclass constructor
   * made. The constructor is the only moment at which "this session drew zero
   * times" is still provable.
   *
   * It is deliberately a hard failure rather than a lint or a convention: a
   * single cosmetic shuffle in an order-entry session silently reopens RNG
   * scumming, and the author must find out at development time.
   *
   * Both holders of the generator are swapped — `this.random` (what game code
   * calls) and `this._ctx.random` (what `Space.shuffle` and every other element
   * reads, since every element shares this one context object). Swapping only
   * one would leave a live draw path open, which is the exact failure this
   * exists to prevent.
   *
   * `getState`/`setState` keep delegating to the real generator, so snapshot
   * capture and checkpoint restore continue to work untouched — a forbidden
   * session must still round-trip its (never-advancing) RNG position.
   */
  private forbidRandomness(): void {
    const real = this.random;
    const forbidden = function (): number {
      throw new RandomnessForbiddenError();
    } as SeededRandom;
    forbidden.getState = () => real.getState();
    forbidden.setState = (state: number) => real.setState(state);

    this.random = forbidden;
    this._ctx.random = forbidden;
  }

  /**
   * Check if flow is awaiting player input
   */
  isAwaitingInput(): boolean {
    return this._flowEngine?.getState().awaitingInput ?? false;
  }

  /**
   * Get current player from flow (if awaiting input)
   */
  getCurrentFlowPlayer(): P | undefined {
    const state = this._flowEngine?.getState();
    if (state?.currentPlayer !== undefined) {
      return this.getPlayer(state.currentPlayer);
    }
    return undefined;
  }

  /**
   * Get available actions from flow (if awaiting input)
   */
  getFlowAvailableActions(): string[] {
    return this._flowEngine?.getState().availableActions ?? [];
  }

  /**
   * Get awaiting players for simultaneous actions
   * Returns undefined if not in a simultaneous action step
   */
  getAwaitingPlayers(): { playerIndex: number; availableActions: string[]; completed: boolean }[] | undefined {
    const state = this._flowEngine?.getState();
    return state?.awaitingPlayers;
  }

  /**
   * Check if a player can act (either as current player or in simultaneous action)
   */
  canPlayerAct(playerIndex: number): boolean {
    return canSeatAct(this._flowEngine?.getState(), playerIndex);
  }

  // ============================================
  // Player Helpers
  // ============================================
  //
  // Players are direct children of the Game in the element tree. These helper
  // methods provide convenient access to players without requiring manual tree
  // queries. For complex player queries, use `game.all(Player, ...)` directly:
  //
  //   // Find players with more than 10 gold
  //   const richPlayers = game.all(Player, p => p.gold > 10);
  //
  //   // Find the player with the most cards
  //   const leader = game.all(Player).maxBy(p => p.allMy(Card).length);
  //
  // **Custom Player types**: If you use a custom Player subclass, set
  // `static PlayerClass = MyPlayer` on your Game class:
  //
  //   class MyGame extends Game<MyGame, MyPlayer> {
  //     static PlayerClass = MyPlayer;
  //   }
  //
  // This ensures these helpers return your custom type with full type safety.
  //
  // **Anti-patterns to avoid:**
  //
  // 1. **Don't cache player references** - Player objects may be recreated during
  //    state restoration (undo, redo, bot simulation). Always query fresh:
  //      // WRONG: const player = game.getPlayer(1); ... later use player
  //      // RIGHT: always call game.getPlayer(1) when you need it
  //
  // 2. **Don't use fallbacks when player not found** - If getPlayer() returns
  //    undefined, that's a bug. Use getPlayerOrThrow() in actions where the
  //    player must exist, and fix the root cause rather than masking it.
  //
  // 3. **Don't duplicate player data** - Store data on the Player instance,
  //    not redundantly on owned elements. Query the player when you need data.
  //
  // @see {@link Player} for player-side methods like `allMy()`, `my()`
  // ============================================

  /**
   * Get all players in the game.
   *
   * Returns players in seat order (Player 1, Player 2, etc.).
   * This is the preferred way to iterate over all players.
   *
   * @example
   * ```typescript
   * // Deal to all players
   * for (const player of game.players) {
   *   for (let i = 0; i < 5; i++) {
   *     deck.first(Card)?.putInto(player.hand);
   *   }
   * }
   *
   * // Find richest player
   * const richest = game.players.reduce((max, p) =>
   *   p.gold > max.gold ? p : max
   * );
   * ```
   */
  get players(): P[] {
    return (this._t.children as GameElement[])
      .filter((el): el is P => isPlayerElement<P>(el))
      .sort((a, b) => a.seat - b.seat);
  }

  /**
   * Get the current player (the player whose turn it is).
   *
   * The current player is determined by the `_isCurrent` flag on Player instances,
   * managed via `setCurrentPlayer()` and the flow engine.
   *
   * @returns The current player, or `undefined` if no player is current
   *
   * @example
   * ```typescript
   * // In a flow action
   * const player = game.currentPlayer;
   * if (player) {
   *   player.gold += 10;
   * }
   *
   * // In an eachPlayer flow, currentPlayer is automatically set
   * eachPlayer({
   *   do: actionStep({
   *     actions: ['takeTurn'],
   *     // game.currentPlayer is the player whose turn it is
   *   })
   * })
   * ```
   *
   * @see {@link setCurrentPlayer} - Change the current player
   * @see {@link Player.isCurrent} - Check if a specific player is current
   */
  get currentPlayer(): P | undefined {
    // Structural, via the one shared answer to "is this child a player?" --
    // `instanceof` is unusable because bundling can create separate copies of
    // the class, and a numeric `seat` is not the answer either (a seat-tagged
    // board has one too).
    return this._t.children.find(
      (el): el is P => isPlayerElement<P>(el) && el.isCurrent()
    );
  }

  /**
   * Get the first player (seat 1).
   *
   * Shorthand for `game.getPlayer(1)`. Useful for first-player-related logic.
   *
   * @returns Player at seat 1, or `undefined` if no players
   *
   * @example
   * ```typescript
   * // Give first player advantage
   * if (player === game.firstPlayer) {
   *   player.gold += 5;
   * }
   *
   * // Start with first player
   * game.setCurrentPlayer(game.firstPlayer!);
   * ```
   *
   * @see {@link getPlayer} - Get player by any seat
   * @see {@link Player.isFirstPlayer} - Check if a player is first
   */
  get firstPlayer(): P | undefined {
    return this.getPlayer(1);
  }

  /**
   * Get a player by their seat (1-indexed).
   *
   * Seats are assigned at game creation and remain constant. Use seat
   * as a stable identifier for players across serialization/deserialization.
   *
   * @param seat - Player seat (1 = first player, 2 = second player, etc.)
   * @returns The player at that seat, or `undefined` if not found
   *
   * @example
   * ```typescript
   * // Get specific players
   * const player1 = game.getPlayer(1);
   * const player2 = game.getPlayer(2);
   *
   * // With custom Player type (type assertion needed for custom properties)
   * const player = game.getPlayer(1) as MyPlayer;
   * console.log(player.customProperty);
   * ```
   *
   * @see {@link getPlayerOrThrow} - Throws if player not found (use in actions)
   * @see {@link Player.seat} - The seat property on players
   */
  getPlayer(seat: number): P | undefined {
    // Same structural test as `currentPlayer` and `players` -- matching on a
    // numeric `seat` alone used to hand back any seat-tagged child, such as a
    // per-seat board.
    return this._t.children.find(
      (el): el is P => isPlayerElement<P>(el) && el.seat === seat
    );
  }

  /**
   * Get a player by seat, throwing an error if not found.
   *
   * Use this in action handlers and flow logic where a player MUST exist.
   * The error message includes diagnostic info to help debug the issue.
   *
   * **Prefer this over `getPlayer()` when the player must exist** - it fails
   * loudly rather than silently returning undefined.
   *
   * @param seat - Player seat (1-indexed)
   * @returns The player at that seat
   * @throws Error if no player exists at that seat
   *
   * @example
   * ```typescript
   * // In an action - player seat comes from serialized action
   * const targetPlayer = game.getPlayerOrThrow(targetSeat);
   * targetPlayer.health -= damage;
   *
   * // In flow logic
   * const player = game.getPlayerOrThrow(1);
   * player.setCurrent(true);
   * ```
   *
   * @see {@link getPlayer} - Returns undefined instead of throwing
   */
  getPlayerOrThrow(seat: number): P {
    const player = this.getPlayer(seat);
    if (!player) {
      throw new Error(
        `No player at seat ${seat}. ` +
        `This game has ${this.players.length} players.`
      );
    }
    return player;
  }

  /**
   * Set the current player (whose turn it is).
   *
   * Automatically clears the previous current player before setting the new one.
   * Accepts either a Player object or a seat number.
   *
   * @param playerOrSeat - Player object or seat number (1-indexed)
   * @throws Error if seat doesn't correspond to an existing player
   *
   * @example
   * ```typescript
   * // Set by player object
   * game.setCurrentPlayer(player);
   *
   * // Set by seat number
   * game.setCurrentPlayer(1);
   *
   * // Advance to next player in a turn-based game
   * game.setCurrentPlayer(game.nextPlayer()!);
   *
   * // In a manual turn flow
   * Action.create('endTurn')
   *   .execute(() => {
   *     const next = game.nextPlayer();
   *     if (next) game.setCurrentPlayer(next);
   *   })
   * ```
   *
   * @see {@link currentPlayer} - Get the current player
   * @see {@link nextPlayer} - Get the next player in turn order
   */
  setCurrentPlayer(playerOrPosition: P | number): void {
    // Clear previous current
    const prev = this.currentPlayer;
    if (prev) {
      prev.setCurrent(false);
    }

    // Set new current
    const player = typeof playerOrPosition === 'number'
      ? this.getPlayerOrThrow(playerOrPosition)
      : playerOrPosition;
    player.setCurrent(true);
  }

  /**
   * Get the next player after the current player (circular turn order).
   *
   * Returns the player with the next-highest seat, wrapping from the last
   * player back to player 1. Returns `undefined` if there's no current player.
   *
   * In a 4-player game: Player 1 → 2 → 3 → 4 → 1 → ...
   *
   * @returns The next player in turn order, or `undefined` if no current player
   *
   * @example
   * ```typescript
   * // End turn and advance to next player
   * Action.create('endTurn')
   *   .execute(() => {
   *     const next = game.nextPlayer();
   *     if (next) game.setCurrentPlayer(next);
   *   })
   *
   * // Check who's up next
   * const nextUp = game.nextPlayer();
   * game.message(`${nextUp?.name} is next`);
   * ```
   *
   * @see {@link nextAfter} - Get next player after any specific player
   * @see {@link previousPlayer} - Get previous player instead
   */
  nextPlayer(): P | undefined {
    const current = this.currentPlayer;
    if (!current) return undefined;

    const players = this.players;
    const idx = players.findIndex(p => p.seat === current.seat);
    const nextIdx = (idx + 1) % players.length;
    return players[nextIdx] as P | undefined;
  }

  /**
   * Get the previous player before the current player (circular turn order).
   *
   * Returns the player with the next-lowest seat, wrapping from player 1
   * back to the last player. Returns `undefined` if there's no current player.
   *
   * In a 4-player game: Player 1 → 4 → 3 → 2 → 1 → ...
   *
   * @returns The previous player in turn order, or `undefined` if no current player
   *
   * @example
   * ```typescript
   * // Go back to previous player (undo last turn change)
   * const prev = game.previousPlayer();
   * if (prev) game.setCurrentPlayer(prev);
   *
   * // Reverse turn order mechanic
   * Action.create('reverseOrder')
   *   .execute(() => {
   *     game.setCurrentPlayer(game.previousPlayer()!);
   *   })
   * ```
   *
   * @see {@link previousBefore} - Get previous player before any specific player
   * @see {@link nextPlayer} - Get next player instead
   */
  previousPlayer(): P | undefined {
    const current = this.currentPlayer;
    if (!current) return undefined;

    const players = this.players;
    const idx = players.findIndex(p => p.seat === current.seat);
    const prevIdx = (idx - 1 + players.length) % players.length;
    return players[prevIdx] as P | undefined;
  }

  /**
   * Get the next player after a specific player (circular turn order).
   *
   * Unlike `nextPlayer()`, this takes any player as input rather than using
   * the current player. Useful when you need to iterate through players or
   * find who comes after a non-current player.
   *
   * @param player - The reference player
   * @returns The next player after the given player, or `undefined` if player not found
   *
   * @example
   * ```typescript
   * // Find who's clockwise from a specific player
   * const leftNeighbor = game.nextAfter(player);
   *
   * // Pass cards to the left
   * for (const player of game.all(Player)) {
   *   const recipient = game.nextAfter(player);
   *   player.hand.first(Card)?.putInto(recipient.incoming);
   * }
   *
   * // Custom turn order starting from a specific player
   * let current = startingPlayer;
   * for (let i = 0; i < game.all(Player).length; i++) {
   *   doSomething(current);
   *   current = game.nextAfter(current)!;
   * }
   * ```
   *
   * @see {@link nextPlayer} - Uses current player as reference
   * @see {@link previousBefore} - Get player before any specific player
   */
  nextAfter(player: P): P | undefined {
    const players = this.players;
    const idx = players.findIndex(p => p.seat === player.seat);
    if (idx === -1) return undefined;
    const nextIdx = (idx + 1) % players.length;
    return players[nextIdx] as P | undefined;
  }

  /**
   * Get the previous player before a specific player (circular turn order).
   *
   * Unlike `previousPlayer()`, this takes any player as input rather than using
   * the current player. Useful for finding neighbors or reverse iteration.
   *
   * @param player - The reference player
   * @returns The previous player before the given player, or `undefined` if player not found
   *
   * @example
   * ```typescript
   * // Find who's counter-clockwise from a specific player
   * const rightNeighbor = game.previousBefore(player);
   *
   * // Pass cards to the right
   * for (const player of game.all(Player)) {
   *   const recipient = game.previousBefore(player);
   *   player.hand.first(Card)?.putInto(recipient.incoming);
   * }
   * ```
   *
   * @see {@link previousPlayer} - Uses current player as reference
   * @see {@link nextAfter} - Get player after any specific player
   */
  previousBefore(player: P): P | undefined {
    const players = this.players;
    const idx = players.findIndex(p => p.seat === player.seat);
    if (idx === -1) return undefined;
    const prevIdx = (idx - 1 + players.length) % players.length;
    return players[prevIdx] as P | undefined;
  }

  /**
   * Get all players other than the specified player.
   *
   * Useful for targeting opponents or excluding a player from a selection.
   *
   * @param player - The player to exclude
   * @returns Array of all other players
   *
   * @example
   * ```typescript
   * // Get all opponents
   * const opponents = game.others(currentPlayer);
   *
   * // Deal damage to all other players
   * for (const opponent of game.others(attacker)) {
   *   opponent.health -= 1;
   * }
   *
   * // Create choices for target selection (other players only)
   * Action.create('attack')
   *   .chooseFrom('target', {
   *     prompt: 'Choose target',
   *     choices: ctx => game.others(ctx.player).map(p => ({
   *       value: p.seat,
   *       display: p.name
   *     }))
   *   })
   * ```
   *
   * @see {@link playerChoices} - Build choice arrays for actions
   */
  others(player: P): P[] {
    return this.players.filter(p => p.seat !== player.seat);
  }

  /**
   * Get player choices formatted for use with `chooseFrom` selection.
   *
   * Returns an array of choice objects with player seat as `value` (stable
   * across serialization) and player name as `display`.
   *
   * @param options - Configuration options
   * @param options.excludeSelf - If true, excludes the current player from choices
   * @param options.filter - Optional predicate to filter which players appear
   * @param options.currentPlayer - The player making the choice (required if excludeSelf is true)
   * @returns Array of choice objects for use with `chooseFrom`
   *
   * @example
   * ```typescript
   * // Choose any other player as target
   * Action.create('attack')
   *   .chooseFrom('target', {
   *     prompt: 'Choose a player to attack',
   *     choices: ctx => game.playerChoices({
   *       excludeSelf: true,
   *       currentPlayer: ctx.player
   *     }),
   *   })
   *   .execute(({ target }) => {
   *     const targetPlayer = game.getPlayerOrThrow(target);
   *     targetPlayer.health -= 1;
   *   })
   *
   * // Choose from players meeting a condition
   * Action.create('heal')
   *   .chooseFrom('target', {
   *     prompt: 'Choose a wounded player',
   *     choices: ctx => game.playerChoices({
   *       filter: p => p.health < p.maxHealth
   *     }),
   *   })
   *
   * // Choose any player including self
   * Action.create('inspect')
   *   .chooseFrom('target', {
   *     prompt: 'Choose a player',
   *     choices: () => game.playerChoices(),
   *   })
   * ```
   *
   * @see {@link others} - Get array of other players directly
   * @see {@link getPlayerOrThrow} - Convert seat back to player
   */
  playerChoices(options: {
    excludeSelf?: boolean;
    filter?: (player: P) => boolean;
    currentPlayer?: Player;
  } = {}): { value: number; display: string }[] {
    let players = this.players;

    if (options.excludeSelf && options.currentPlayer) {
      players = players.filter(p => p.seat !== options.currentPlayer!.seat);
    }

    if (options.filter) {
      players = players.filter(options.filter);
    }

    return players.map(p => ({
      value: p.seat,
      display: p.name ?? `Player ${p.seat}`,
    }));
  }

  // ============================================
  // Game Lifecycle
  // ============================================

  /**
   * Start the game (called after setup).
   *
   * Transitions the game from 'setup' phase to 'started' phase.
   * Typically called automatically by the flow engine.
   *
   * @throws Error if the game has already started
   */
  start(): void {
    if (this.phase !== 'setup') {
      throw new Error('Game has already started');
    }
    this.phase = 'started';
  }

  /**
   * End the game with optional winners.
   *
   * Transitions the game to 'finished' phase. Once finished, no more
   * actions can be taken. Use `getWinners()` to retrieve the winners.
   *
   * @param winners - Optional array of winning players. If not provided,
   *                  use `getWinners()` to let the flow engine determine winners.
   *
   * @example
   * ```typescript
   * // End with a single winner
   * this.finish([player]);
   *
   * // End with multiple winners (tie)
   * this.finish([player1, player2]);
   *
   * // End without specifying winners (flow's getWinners will be used)
   * this.finish();
   * ```
   */
  finish(winners?: P[]): void {
    this.phase = 'finished';
    if (winners) {
      this.settings.winners = winners.map(p => p.seat);
    }
  }

  /**
   * Check if the game is finished.
   *
   * @returns `true` if the game phase is 'finished'
   *
   * @example
   * ```typescript
   * // In a flow condition
   * loop({
   *   while: () => !this.isFinished(),
   *   do: eachPlayer({ ... })
   * })
   * ```
   */
  isFinished(): boolean {
    return this.phase === 'finished';
  }

  /**
   * Get the winners of the game.
   *
   * @returns Array of winning players, or empty array if no winners set
   *
   * @example
   * ```typescript
   * if (game.isFinished()) {
   *   const winners = game.getWinners();
   *   if (winners.length === 1) {
   *     console.log(`${winners[0].name} wins!`);
   *   } else if (winners.length > 1) {
   *     console.log(`Tie between ${winners.map(p => p.name).join(' and ')}!`);
   *   }
   * }
   * ```
   */
  getWinners(): P[] {
    const winnerSeats = this.settings.winners as number[] | undefined;
    if (!winnerSeats) return [];
    return winnerSeats.map(seat => this.getPlayer(seat)).filter((p): p is P => p !== undefined);
  }

  /**
   * Get the original constructor options.
   * Used by snapshot/restore to preserve all options (including custom ones like playerConfigs).
   */
  getConstructorOptions(): Record<string, unknown> {
    return this._constructorOptions;
  }

  // ============================================
  // Player Context
  // ============================================

  /**
   * Set the current player context for "mine" queries
   * @param player - Player object or 1-indexed seat
   */
  setPlayerContext(player: P | number | undefined): void {
    if (player === undefined) {
      this._ctx.player = undefined;
    } else if (typeof player === 'number') {
      this._ctx.player = this.getPlayer(player);
    } else {
      this._ctx.player = player;
    }
  }

  /**
   * Get the current player context
   */
  getPlayerContext(): P | undefined {
    return this._ctx.player as P | undefined;
  }

  // ============================================
  // Messaging
  // ============================================

  /**
   * Add a message to the game log.
   *
   * Messages are stored and can be displayed in the UI to show game history.
   * Supports template substitution with `{{key}}` placeholders.
   *
   * @param text - Message text, optionally with `{{key}}` placeholders
   * @param data - Optional data for template substitution. GameElement and Player
   *               values are automatically converted to their display names.
   *
   * @example
   * ```typescript
   * // Simple message
   * this.message('Game started!');
   *
   * // With template substitution
   * this.message('{{player}} played {{card}}', {
   *   player: currentPlayer,
   *   card: playedCard
   * });
   *
   * // In an action
   * Action.create('attack')
   *   .chooseElement('target', { filter: t => t instanceof Piece })
   *   .execute(({ target }, ctx) => {
   *     target.remove();
   *     this.message('{{player}} destroyed {{target}}', {
   *       player: ctx.player,
   *       target
   *     });
   *   })
   * ```
   */
  message(text: string, data?: Record<string, unknown>, options?: MessageOptions): void {
    this.addMessageInternal(text, data, undefined, options?.type);
  }

  /**
   * Add a message that ONLY the given seats may receive.
   *
   * **Almost no game should use this.** `message()` is the log: a shared record
   * of what happened, which every player and spectator can read, and which is
   * what makes a game reviewable and its history meaningful. Reach for
   * `messageTo()` only when the game's rules make a fact genuinely private —
   * an RPG where a character perceives something the others do not, a hidden
   * -role game where a night action must not name its actor. If you are using
   * it to reduce clutter, or because a line "isn't relevant" to other seats,
   * use `message()`: irrelevant is not the same as secret, and a log that
   * omits public events is a log players cannot trust.
   *
   * The audience is enforced on the SERVER. An unaddressed seat never receives
   * the message in its state payload at all — this is not a UI filter, and
   * there is no client-side copy to inspect. Spectators (no seat) see only
   * unaddressed messages.
   *
   * The shell's log itself is always rendered and cannot be turned off; this
   * controls what goes INTO a given seat's copy of it.
   *
   * @param audience - Seat(s) allowed to see this message: a Player, a seat
   *                   number, or an array of either. An empty array addresses
   *                   no one and is refused.
   * @param text - Message text, optionally with `{{key}}` placeholders
   * @param data - Optional data for template substitution, same as `message()`
   *
   * @example
   * ```typescript
   * // Only this character hears it.
   * this.messageTo(ctx.player, 'You hear footsteps to the north.');
   *
   * // Two seats share a private exchange.
   * this.messageTo([thief, victim], '{{thief}} lifts your purse', { thief });
   *
   * // WRONG — this is public information, and every seat should have it.
   * this.messageTo(ctx.player, '{{p}} drew a card', { p: ctx.player });
   * ```
   */
  messageTo(
    audience: P | number | Array<P | number>,
    text: string,
    data?: Record<string, unknown>,
    options?: MessageOptions,
  ): void {
    // Fail loud rather than write a message nobody can ever read — see
    // `resolveAudience`, shared with `animateTo` so both channels agree.
    const seats = this.resolveAudience(audience, `messageTo("${text}")`);
    this.addMessageInternal(text, data, seats, options?.type);
  }

  /**
   * Internal method to add a message (called by command executor)
   */
  addMessageInternal(
    text: string,
    data?: Record<string, unknown>,
    to?: number[],
    type?: string,
  ): void {
    this.messages.push({
      text,
      data,
      ...(to ? { to } : {}),
      ...(type !== undefined ? { type } : {}),
    });
  }

  /**
   * Cap the message log by dropping its OLDEST entries.
   *
   * `docs/state-size.md` tells a game the log is uncapped and theirs to prune,
   * and a long-running game has to. This is the supported way (#25), and the
   * only safe one: each per-action checkpoint records the log's ABSOLUTE length
   * at its boundary, and the engine tracks how many entries have been evicted,
   * so a restore still names exactly the lines that existed at that boundary.
   *
   * Eviction is FRONT-ONLY, and that is deliberate rather than a limitation.
   * A checkpoint's watermark is a position in a chronological log; removing an
   * entry from the middle moves lines across boundaries that were recorded
   * before the removal, which is the corruption this exists to prevent. Keeping
   * "the most recent N" and "everything after the round that ended" are both
   * front evictions; "only the interesting lines" is not, and there is no way
   * to ask for it here.
   *
   * Splicing `game.messages` by hand is not equivalent and never was — it moves
   * entries past a boundary the checkpoint no longer describes.
   *
   * @param policy.keepLast - Keep the most recent N entries, dropping older ones.
   * @param policy.dropWhile - Drop entries from the front while this returns
   *   true. Stops at the first entry it declines, so what remains is always a
   *   suffix of the log.
   *
   * @example
   * ```typescript
   * // A flat cap, at a round boundary in the game's own upkeep:
   * game.pruneMessages({ keepLast: 400 });
   *
   * // Or by age, which is still a front eviction:
   * game.pruneMessages({ dropWhile: (entry) => entry.data?.round as number < currentRound - 2 });
   * ```
   */
  pruneMessages(policy: {
    keepLast?: number;
    dropWhile?: (entry: MessageEntry) => boolean;
  }): void {
    if (policy.keepLast !== undefined) {
      if (!Number.isInteger(policy.keepLast) || policy.keepLast < 0) {
        throw new Error(
          `pruneMessages: keepLast must be a non-negative integer, got ${JSON.stringify(policy.keepLast)}.`,
        );
      }
      if (this.messages.length > policy.keepLast) {
        this.#evictFront(this.messages.length - policy.keepLast);
      }
    }
    if (policy.dropWhile) {
      let drop = 0;
      while (drop < this.messages.length && policy.dropWhile(this.messages[drop])) drop++;
      this.#evictFront(drop);
    }
  }

  /** Drop `count` entries from the front, keeping the eviction offset in step. */
  #evictFront(count: number): void {
    if (count <= 0) return;
    this.messages = this.messages.slice(count);
    this._messagesEvicted += count;
  }

  /**
   * The log's ABSOLUTE length: entries ever written, including those since
   * evicted. This is the watermark a checkpoint records (#25).
   * @internal
   */
  get messageCount(): number {
    return this._messagesEvicted + this.messages.length;
  }

  /**
   * How many entries have been evicted from the front of the log. A restore
   * subtracts this from a checkpoint's watermark to locate the boundary in the
   * log as it stands now.
   * @internal
   */
  get messagesEvicted(): number {
    return this._messagesEvicted;
  }

    /**
   * Whether `seat` is allowed to receive `message`. A message with no audience
   * is public. `null`/undefined seat is a spectator, who sees only public ones.
   */
  private canSeeMessage(
    message: { to?: number[] },
    seat: number | null | undefined,
  ): boolean {
    if (!message.to) return true;
    if (seat === null || seat === undefined) return false;
    return message.to.includes(seat);
  }

  /**
   * Get formatted messages (with template substitution).
   *
   * @param seat - The seat receiving these messages. Messages addressed to
   *   other seats via `messageTo()` are withheld. Omitting it (or passing
   *   null) is the SPECTATOR view: public messages only. There is deliberately
   *   no "all messages" mode here — the unfiltered log is `this.messages`, and
   *   a caller that wants it should be explicit about reading the truth.
   */
  getFormattedMessages(seat?: number | null): string[] {
    return this.getFormattedMessageEntries(seat).map((m) => m.text);
  }

  /**
   * The same seat-filtered, template-substituted log as
   * {@link getFormattedMessages}, but keeping each line's `type` (#21).
   *
   * This is what `createPlayerView` puts on the wire, so a game's own
   * classification survives the trip to `GameHistory` instead of being
   * flattened away at the last hop.
   */
  getFormattedMessageEntries(seat?: number | null): FormattedMessage[] {
    return this.messages
      .filter((m) => this.canSeeMessage(m, seat))
      .map(({ text, data, type }) => {
        let processed = text;
        if (data) {
          for (const [key, value] of Object.entries(data)) {
            const replacement = value instanceof GameElement
              ? value.toString()
              : value instanceof Player
                ? (value.name ?? `Player ${value.seat}`)
                : String(value);
            processed = processed.replace(new RegExp(`{{${key}}}`, 'g'), replacement);
          }
        }
        return type === undefined ? { text: processed } : { text: processed, type };
      });
  }

  // ============================================
  // Animation Events
  // ============================================

  /**
   * Emit an animation event for UI playback.
   *
   * Animation events are pure data signals -- they do NOT capture mutations
   * or affect game state. The UI layer registers handlers to play them back.
   *
   * @param type - Event type identifier (e.g., 'combat', 'score-item')
   * @param data - Event-specific data payload (must be JSON-serializable)
   * @param callback - Optional callback to advance truth (convenience).
   *   Runs immediately as normal game code. Its mutations are NOT captured
   *   as event metadata -- they generate their own commands on the stack.
   *
   * @example
   * ```typescript
   * // Pure data event
   * game.animate('score', { player: player.name, points: 15 });
   *
   * // With truth-advancing callback
   * game.animate('combat', { attacker: a.id, defender: d.id, damage: 5 }, () => {
   *   defender.hp -= 5;
   *   if (defender.hp <= 0) defender.remove();
   * });
   * ```
   */
  animate(type: string, data: Record<string, unknown>, callback?: () => void): void {
    this.execute({ type: 'ANIMATE', eventType: type, data });
    if (callback) {
      callback();
    }
  }

  /**
   * Emit an animation event that ONLY the given seats may receive.
   *
   * The audience counterpart to {@link messageTo} (#23). `animate()` puts its
   * event in the game-wide buffer, which is serialized into EVERY seat's
   * payload until the dispatch that produced it drains — so a game whose every
   * line is per-seat private had no equivalent channel for animation, and the
   * only defence was keeping the payload deliberately uninformative.
   *
   * As with `messageTo`, the audience is enforced where the payload is built,
   * not in the UI: a non-audience seat's `toJSONForPlayer` carries no trace of
   * the event. The authoritative `toJSON()` keeps it, so it survives a restore
   * with its audience intact.
   *
   * @param audience - Seat(s) allowed to see this event: a Player, a seat
   *   number, or an array of either.
   * @param type - Event type identifier, same as `animate()`
   * @param data - Event-specific data payload (must be JSON-serializable)
   *
   * @example
   * ```typescript
   * // Only the two combatants see the exchange play out.
   * game.animateTo([attacker, defender], 'combat-exchange', { damage: 3 });
   * ```
   */
  animateTo(
    audience: P | number | Array<P | number>,
    type: string,
    data: Record<string, unknown>,
  ): void {
    const seats = this.resolveAudience(audience, `animateTo("${type}")`);
    this.execute({ type: 'ANIMATE', eventType: type, data, to: seats });
  }

  /**
   * Turn a Player/seat audience into a validated seat list.
   *
   * Shared by `messageTo` and `animateTo` so the two channels agree on what an
   * audience is and refuse the same things — an empty audience is always a bug
   * at the call site (a filter that matched nothing, an undefined player), and
   * silently dropping the emission would lose it with no signal anywhere.
   */
  private resolveAudience(
    audience: P | number | Array<P | number>,
    what: string,
  ): number[] {
    const list = Array.isArray(audience) ? audience : [audience];
    const seats = list.map((a) => (typeof a === 'number' ? a : a.seat));

    if (seats.length === 0) {
      throw new Error(
        `${what} was given an empty audience — no seat would ever receive it. ` +
          `Pass at least one player/seat, or use the public form if it is not private.`,
      );
    }
    for (const seat of seats) {
      if (!Number.isInteger(seat) || seat < 0) {
        throw new Error(
          `${what} received an invalid seat (${JSON.stringify(seat)}). ` +
            `Pass a Player or a non-negative seat number.`,
        );
      }
    }
    return seats;
  }

  /**
   * Push an animation event to the buffer.
   * @internal Called by command executor -- do not call directly from game code.
   */
  pushAnimationEvent(eventType: string, data: Record<string, unknown>, to?: number[]): void {
    this._animationEventSeq++;
    this._animationEvents.push({
      id: this._animationEventSeq,
      type: eventType,
      data,
      ...(to ? { to } : {}),
    });
  }

  /**
   * Get animation events that have not yet been acknowledged.
   *
   * UI consumers read this to get events to play back. Events remain in the
   * buffer until cleared at the start of the next `performAction()` call.
   *
   * @returns Array of pending animation events (copy - modifications don't affect buffer)
   */
  get pendingAnimationEvents(): AnimationEvent[] {
    return [...this._animationEvents];
  }


  // ============================================
  // Serialization
  // ============================================

  /**
   * Serialize the complete game state
   */
  override toJSON(): ElementJSON & {
    phase: GamePhase;
    isFinished: boolean;
    settings: Record<string, unknown>;
    animationEvents?: AnimationEvent[];
    animationEventSeq?: number;
    /** Message-log front-eviction offset (#25) — see Game#messagesEvicted. */
    messagesEvicted?: number;
  } {
    // CR-02: the top-level fields below MUST be copies, never live references.
    // `createActionCheckpoint`/`createSnapshot` store this result as-is, and
    // the live-session undo/rewind/time-travel paths never JSON-round-trip it.
    // Emitting `this.settings` by reference meant every retained checkpoint
    // shared ONE settings object with the live game: post-checkpoint mutations
    // retroactively corrupted checkpoints, and undo could never roll back
    // `actionTempState()`/`persistentMap()` state. `serializeValue` deep-copies
    // and also tags element/player references so they survive cold storage.
    //
    // The MESSAGE LOG is deliberately absent from this payload — it is a
    // snapshot-level sibling (`GameStateSnapshot.messageLog`), serialized once
    // per snapshot by `serializeMessageLog()`. Inside the tree it was copied
    // into every retained checkpoint, which is what put a narration-heavy game
    // over its host's state ceiling. See `Game.messages` / `docs/state-size.md`.
    //
    // Strip the self-serialized fields from the generic attribute bag first.
    // See GAME_SELF_SERIALIZED_FIELDS — without this the payload carries a
    // second, never-redacted copy of each.
    const base = super.toJSON();
    for (const key of GAME_SELF_SERIALIZED_FIELDS) {
      delete base.attributes[key];
    }
    // A persistentMap field is a live view onto `settings`, which is serialized
    // in full below. See persistentMapFields for why emitting it too broke
    // every restore path (#139).
    for (const key of persistentMapFields(this)) {
      delete base.attributes[key];
    }

    return {
      ...base,
      phase: this.phase,
      isFinished: this.isFinished(),
      settings: this.serializeValue(this.settings, 'settings') as Record<string, unknown>,
      // The seq must survive a snapshot round-trip on its OWN, independent of
      // whether the CURRENT buffer happens to be empty (the buffer clears at
      // the start of every performAction -- see `:1130`). Gating it on
      // buffer-non-emptiness would silently drop the counter back to
      // undefined the moment one action doesn't animate, and the next
      // `loadSerializedState` reconstruction (every op, in the stateless
      // executor) would then default it back to 0 -- reintroducing the exact
      // animation-id collision UNDO-04 exists to prevent, just via the
      // empty-buffer path instead of the undo path. Only include it once
      // `animate()` has ever actually run (avoid cluttering a snapshot that
      // never used animation events at all).
      ...(this._animationEventSeq > 0 && { animationEventSeq: this._animationEventSeq }),
      // How many log entries have been evicted (#25). Restored below so a
      // resumed game still resolves an old checkpoint's watermark correctly.
      // One number for the whole game, not a field on every line.
      ...(this._messagesEvicted > 0 && { messagesEvicted: this._messagesEvicted }),
      // Only include the events array if the buffer is non-empty (avoid
      // cluttering empty snapshots with an empty array).
      ...(this._animationEvents.length > 0 && {
        // Copy the buffer (same CR-02 aliasing concern: the live array is
        // mutated in place as later events are recorded).
        animationEvents: this._animationEvents.map((e) => ({ ...e })),
      }),
    };
  }

  /**
   * Serialize the message log for storage in `GameStateSnapshot.messageLog`.
   *
   * Separate from `toJSON()` on purpose: the log is stored ONCE per snapshot,
   * while the tree is copied into every retained checkpoint. Keeping the two
   * apart is what makes persisted state flat in the log's size instead of
   * multiplying it by `checkpoints.max`.
   *
   * Deep-copies and tags element/player refs inside each entry's `data`
   * (CR-02 — a snapshot must never alias the live array). The matching
   * rehydration happens in `loadSerializedState`, whose closing
   * `resolveElementReferences` pass walks `this.messages` like any other
   * own property.
   *
   * @param forSeat - Audience filter. Supply a seat to get only the lines that
   *   seat is allowed to see; `null` for the spectator view (public lines only).
   *   Omit for the unfiltered truth — the ONLY correct choice for a snapshot
   *   that will be persisted or restored, since a filtered copy silently
   *   destroys other seats' history.
   */
  serializeMessageLog(forSeat?: number | null): MessageEntry[] {
    const source = forSeat === undefined
      ? this.messages
      : this.messages.filter((m) => this.canSeeMessage(m, forSeat));
    return this.serializeValue(source, 'messages') as MessageEntry[];
  }

  /**
   * Get the game state from the perspective of a specific player
   * (hides elements that player shouldn't see based on zone visibility)
   * @param player - Player, player seat, or null for spectator view
   * @param idRemap - CR-02 (159): optional out-param. When supplied, populated with
   *   `originalId -> syntheticId` for every fungible hidden-zone child that gets an
   *   anonymized negative id (the `hidden`/`count-only`/`owner`-zone branches below).
   *   Lets a caller that also holds the ORIGINAL (un-redacted) flow state relink an
   *   element-typed flow variable pointing at a now-hidden element to its correct
   *   redacted placeholder instead of losing it — see `relinkFlowVariables` in
   *   `flow/engine.ts`. Individually-hidden single elements (the two branches above
   *   this comment) keep their real id already, so they need no remap entry.
   */
  toJSONForPlayer(player: P | number | null, idRemap?: Map<number, number>): ReturnType<Game['toJSON']> {
    const playerSeat = player === null ? null : (typeof player === 'number' ? player : player.seat);
    // For visibility checks, spectators use -1 (no special access)
    const visibilityPosition = playerSeat ?? -1;

    const filterElement = (json: ElementJSON, element: GameElement): ElementJSON | null => {
      const visibility = element.getEffectiveVisibility();

      // Handle count-only mode: show count but not contents
      // Preserve element name and safe $-prefixed system attributes (like $type) for AutoUI
      // rendering; redact identity-bearing image refs ($image, $images.face).
      if (visibility.mode === 'count-only' && !element.isVisibleTo(visibilityPosition)) {
        // Drop `name` — for a leaf element (e.g. a Card named "AS") the name is
        // identity-bearing. Seed __hidden so the SEC-02 regression guard
        // (collectAllHiddenAttrs) sweeps this surface too.
        return {
          className: json.className,
          id: json.id,
          attributes: { [HIDDEN_PLACEHOLDER_ATTRIBUTE]: true, ...redactHiddenElementAttrs(json.attributes ?? {}) },
          childCount: element._t.children.length,
        };
      }

      // Check if element is visible to this player
      if (!element.isVisibleTo(visibilityPosition)) {
        // Return a hidden placeholder.
        //
        // INTENTIONAL ASYMMETRY (WR-02, iteration 2): unlike the zone branches
        // below (count-only / hidden / owner-only), this branch keeps the real,
        // stable `json.id`. This branch handles a SINGLE element that is
        // individually hidden (e.g. a face-down card placed in an otherwise
        // VISIBLE parent via `hideFromAll()` / `showOnlyTo()`), not a fungible
        // child of a hidden collection.
        //
        // The FLIP animation layer (src/ui/composables/useFlyingElements.ts —
        // collectElements keys `elementLocations`/`result` by `id`, and
        // `defaultShouldFlip` correlates the hidden↔visible transition by
        // `element.id`) requires a STABLE handle to animate this element when it
        // flips face-up/face-down or moves while face-down. Anonymizing the id
        // here would make the hidden and revealed views look like two different
        // elements, degrading the flip into a disappear/reappear.
        //
        // The zone branches CAN anonymize because their children are fungible
        // and rendered as an undifferentiated stack — they are never animated
        // individually, and position-based anonymization is what defeats
        // shuffle/reveal correlation inside a hidden collection. A deliberately
        // placed standalone face-down element already sits in a visible parent,
        // so its position is observable by design; the only residual signal is
        // reveal-correlation of a card the viewer watched go face-down, which is
        // inherent to the game (true of physical play too), not a hidden-
        // collection leak. Accept decision: keep the stable id for animation.
        return {
          className: json.className,
          id: json.id, // intentional: stable id for FLIP (see comment above)
          // Preserve safe layout/back attributes ($type for AutoUI dispatch,
          // $images.back for the face-down card-back graphic) so this element
          // can render face-down on first paint, consistent with the zone
          // branches below. redactHiddenElementAttrs drops $image and narrows
          // $images to { back } only, so $images.face still never leaks.
          attributes: { [HIDDEN_PLACEHOLDER_ATTRIBUTE]: true, ...redactHiddenElementAttrs(json.attributes ?? {}) },
        };
      }

      // SEC-02 (F2): enforce `static visibleAttributes`. Public-by-default:
      // `visibleAttributes === undefined` means every attribute stays visible
      // (do not flip default semantics -- go-fish's `bookCount`-style custom
      // attributes must keep working with zero configuration). When declared,
      // a non-owner's view is redacted down to the whitelist. `Player` is a
      // special case (Pitfall 4): a top-level Player has no
      // `getEffectiveOwner()` (that only resolves via a `.player`
      // back-reference set on a CHILD element pointing at its owning Player),
      // so a plain owner check would wrongly hide a player's own restricted
      // attributes from themself. Spectators (`visibilityPosition === -1`)
      // are non-owners of everything, so they get the most restrictive view.
      //
      // CR-01 (iteration 2): this whitelist MUST run BEFORE the zone-visibility
      // branches below. Those branches early-return `{ ...ownJson, children }`
      // for the container itself -- if the whitelist ran after them (as it
      // originally did), a Space that declared `static visibleAttributes` AND
      // set zone visibility (the most security-conscious combination) would
      // leak every non-whitelisted container attribute to non-owners.
      const ElementClass = element.constructor as typeof GameElement;
      let ownJson = json;
      if (ElementClass.visibleAttributes !== undefined) {
        // WR-01: a player is not resolved by `instanceof Player` — bundlers
        // (esbuild) can create separate Player class copies, making instanceof
        // return false and redacting a player out of their OWN restricted
        // attributes (the exact Pitfall-4 failure this special case exists to
        // prevent). #149: nor by a numeric `seat`, which a per-seat board
        // carries too — that read the BOARD's seat as its owner, showing its
        // restricted attributes to whichever seat the board was numbered for
        // instead of to the seat that owns it. `isPlayerElement` is the one
        // structural answer, shared with `players`/`getPlayer`/`currentPlayer`.
        const isOwner = isPlayerElement(element)
          ? element.seat === visibilityPosition
          : element.getEffectiveOwner()?.seat === visibilityPosition;
        if (!isOwner) {
          const whitelist = new Set(ElementClass.visibleAttributes);
          // #148: on the game ROOT, the engine's own fields are not the game's
          // to withhold. Each already has a declared audience
          // (GAME_ROOT_FIELD_AUDIENCE) and the seat-scoped ones are narrowed
          // further down this method, so sweeping them off the wire with a
          // game's whitelist withholds no secret and instead breaks the seat's
          // own state (its `tutorialProgress` vanishing from its own view).
          const isRoot = element === this;
          const filteredAttrs: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(json.attributes ?? {})) {
            // `_isCurrent` is framework metadata (Player.toJSON), not a
            // developer-declared game attribute -- it must always survive
            // filtering regardless of the whitelist.
            if (whitelist.has(key) || key === '_isCurrent' || (isRoot && isEngineRootField(key))) {
              filteredAttrs[key] = value;
            }
          }
          // `redacted: true` (#19) marks WHY the missing attributes are
          // missing. Restoring this tree rebuilds a live game (the MCTS search
          // sandbox does exactly that), and without the marker every withheld
          // attribute came back as its class-field default — a specific false
          // fact the searcher then reasoned from. See `GameElement.fromJSON`.
          ownJson = { ...json, attributes: filteredAttrs, redacted: true };
        }
      }

      // F-09 (residual): redact grant rosters on the way OUT of the per-player
      // serializer. `Space.toJSON` emits the FULL `zoneVisibility` (and
      // `GameElement.toJSON` the full element `visibility`), including the
      // `addPlayers`/`exceptPlayers` lists naming EVERY seat that has been
      // granted or denied vision. Broadcasting that to all seats discloses
      // who-can-see-what — the same information-leak class F-09 addressed.
      // Collapse each emitted roster to the receiving seat's OWN grant/denial.
      //
      // This is safe for restore: the checkpoint/restore path serializes via
      // the full `toJSON()` (NOT this per-player path), so the complete roster
      // still round-trips there. The live `_zoneVisibility`, read via
      // `getZoneVisibility()` below for `canPlayerSee`, is likewise untouched —
      // redaction happens only on the copy placed in `ownJson`.
      // A shallow spread never mutates the source `json` (the shared,
      // full-fidelity object), so restore/checkpoint state is never corrupted.
      if (ownJson.zoneVisibility) {
        ownJson = {
          ...ownJson,
          zoneVisibility: redactVisibilityForSeat(ownJson.zoneVisibility, visibilityPosition),
        };
      }
      if (ownJson.visibility) {
        ownJson = {
          ...ownJson,
          visibility: redactVisibilityForSeat(ownJson.visibility, visibilityPosition),
        };
      }

      // Check zone visibility for children (if this is a Space)
      const zoneVisibility = hasZoneVisibility(element) ? element.getZoneVisibility() : undefined;

      // SPACE-03 / F-09: a per-seat visibility GRANT (`addZoneVisibleTo`, i.e.
      // `zoneVisibility.addPlayers`) must reveal the zone's real contents to the
      // granted seat even on a hidden/count-only/owner zone — `canPlayerSee`
      // already encodes exceptPlayers/addPlayers/mode precedence, so consult it
      // rather than branching on `mode` alone (which made `addZoneVisibleTo`
      // dead API on hidden zones and even hid contents from the granted seat).
      // When the seat CAN see, we fall through to normal child serialization
      // below (real children, each still subject to its own visibility).
      const zoneOwnerSeat = (element as GameElement).getEffectiveOwner?.()?.seat;
      const seatCanSeeZone = zoneVisibility
        ? canPlayerSee(zoneVisibility, visibilityPosition, zoneOwnerSeat)
        : true;

      // If zone has hidden or count-only visibility, handle children specially
      if (zoneVisibility && !seatCanSeeZone) {
        if (zoneVisibility.mode === 'hidden') {
          // D24/SPACE-03: true concealment. Unlike 'count-only' below, a
          // 'hidden' zone must not leak even its exact child count to a
          // non-owner -- no `children` key, no `childCount` key at all (not
          // `childCount: 0`, which would still distinguish empty from full).
          // No synthetic placeholders are built, so there is nothing to
          // register in `idRemap` either -- an element-typed flow variable
          // pointing into a 'hidden' zone has no redacted placeholder to
          // relink to (CR-02/159 only applies where placeholders exist).
          //
          // ownJson (not json) still carries the container's own attributes,
          // whitelist-redacted per CR-01 -- but ownJson.children is the RAW,
          // unfiltered child array (json.children), so it must be explicitly
          // destructured OUT here. Setting `children: undefined` is not
          // enough: the `in` operator (and Object.keys) still sees an
          // explicitly-undefined key, which the true-concealment contract
          // (no `children` key at all) forbids.
          const { children: _omittedRealChildren, ...concealedJson } = ownJson;
          return concealedJson;
        } else if (zoneVisibility.mode === 'count-only') {
          // Count-only mode: create anonymized placeholders for children.
          // This allows the UI to render the correct number and type of elements
          // without revealing their identity (no real IDs or names that could be used to cheat)
          const hiddenChildren: ElementJSON[] = [];
          if (json.children) {
            for (let i = 0; i < json.children.length; i++) {
              const childJson = json.children[i];
              // Redact identity-bearing image refs; keep only safe layout $-keys.
              // __hidden is seeded here (not in the helper) so the count-only
              // container branch keeps its distinct shape (no __hidden, has childCount).
              const syntheticId = -(element._t.id * 1000 + i);
              // CR-02 (159): record original -> synthetic id so an element-typed
              // flow variable pointing at this now-anonymized child can still be
              // relinked to its (redacted) placeholder on restore.
              const childElement = element._t.children[i];
              if (idRemap && childElement) {
                idRemap.set(childElement.id, syntheticId);
              }
              hiddenChildren.push({
                className: childJson.className,
                // Use negative index-based IDs to prevent correlation with real element IDs
                id: syntheticId,
                attributes: { [HIDDEN_PLACEHOLDER_ATTRIBUTE]: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) },
                // Don't include name - could reveal card identity
              });
            }
          }
          return {
            // ownJson (not json): the container's own attributes must stay
            // whitelist-redacted in this early return (CR-01).
            ...ownJson,
            children: hiddenChildren.length > 0 ? hiddenChildren : undefined,
            childCount: element._t.children.length,
          };
        } else if (zoneVisibility.mode === 'owner' && element.getEffectiveOwner()?.seat !== visibilityPosition) {
          // Owner-only zone and this player doesn't own it - show hidden placeholders
          // Preserve $-prefixed system attributes (like $type) for proper AutoUI rendering
          const hiddenChildren: ElementJSON[] = [];
          if (json.children) {
            for (let i = 0; i < json.children.length; i++) {
              const childJson = json.children[i];
              // Redact identity-bearing image refs; keep only safe layout $-keys.
              // Use negative index-based IDs to prevent correlation with real
              // element IDs (matches the hidden/count-only branch above). Leaking
              // the real, stable id lets a non-owner track a face-down card across
              // zones and reveals.
              const syntheticId = -(element._t.id * 1000 + i);
              // CR-02 (159): see remap comment in the hidden/count-only branch above.
              const childElement = element._t.children[i];
              if (idRemap && childElement) {
                idRemap.set(childElement.id, syntheticId);
              }
              hiddenChildren.push({
                className: childJson.className,
                id: syntheticId,
                attributes: { [HIDDEN_PLACEHOLDER_ATTRIBUTE]: true, ...redactHiddenElementAttrs(childJson.attributes ?? {}) },
                // Don't include name - could reveal card identity
              });
            }
          }
          return {
            // ownJson (not json): the container's own attributes must stay
            // whitelist-redacted in this early return (CR-01).
            ...ownJson,
            children: hiddenChildren.length > 0 ? hiddenChildren : undefined,
          };
        }
      }

      // Filter children normally
      const filteredChildren: ElementJSON[] = [];
      if (ownJson.children) {
        for (let i = 0; i < ownJson.children.length; i++) {
          const childJson = ownJson.children[i];
          const childElement = element._t.children[i];
          const filtered = filterElement(childJson, childElement);
          if (filtered) {
            filteredChildren.push(filtered);
          }
        }
      }

      return {
        ...ownJson,
        children: filteredChildren.length > 0 ? filteredChildren : undefined,
      };
    };

    const fullJson = this.toJSON();
    let filteredState = filterElement(fullJson, this) ?? fullJson;

    // Apply playerView transformation if defined
    const GameClass = this.constructor as typeof Game;
    if (GameClass.playerView) {
      filteredState = GameClass.playerView(filteredState, playerSeat, this);
    }

    // The game root is always visible to its own players, so `filterElement`
    // takes the recursive (spread) path and preserves the top-level game fields
    // (phase/isFinished/settings/animation*) that `toJSON()` adds — it only
    // strips CHILD elements. `filterElement`'s return is typed to the base
    // `ElementJSON`, so re-assert the enriched shape the root always carries
    // (this is what makes the redacted view a valid, restorable game state).
    //
    // The MESSAGE LOG is not here to redact: it is not part of `toJSON()` at
    // all. Its audience gate lives at the two boundaries that actually emit it
    // — `serializeMessageLog(forSeat)` for snapshots and `getFormattedMessages(seat)`
    // for player views. Do not reintroduce a `messages` field on this payload;
    // a per-seat tree is not the log's home, and the leak SEC-04 fixed came
    // from exactly that arrangement.
    // The eviction offset is engine bookkeeping for restores (#25): it has no
    // meaning to a client, and shipping it puts an ever-growing number in every
    // seat's payload for nothing. Dropped by REBUILDING the object rather than
    // by `delete`, which would move it into dictionary mode — this runs once
    // per seat per broadcast and once per MCTS playout, and a deoptimized shape
    // here is measurable in bot search time.
    const { messagesEvicted: _engineOnly, ...withoutEngineBookkeeping } =
      filteredState as ReturnType<Game['toJSON']> & { messagesEvicted?: number };
    const view = withoutEngineBookkeeping as ReturnType<Game['toJSON']>;

    // SEC-05: scope `tutorialProgress` to the receiving seat.
    //
    // It is an engine-owned `Map<seat, TutorialProgress>` and an ordinary own
    // property, so it rides in the generic attribute bag on the game ROOT —
    // which is visible to everyone, and therefore untouched by the element
    // visibility pass above. Unscoped, every seat and the spectator learned
    // which tutorial step each OTHER seat is on and whether they completed or
    // quit the tutorial. That is nobody else's business: it is a fact about a
    // person learning the game, not a fact about the game.
    //
    // A seat keeps its OWN entry so the redacted view stays self-consistent —
    // `isTutorialGateActive`/`getDisabledActions` evaluate the same way
    // against a restored per-seat clone as against the live game. The spectator
    // is nobody, so it gets nothing.
    //
    // Rebuilt by re-serializing a filtered Map from the live source rather than
    // by editing the tagged `{__map: [...]}` encoding in place — the redaction
    // must not have to know how `serializeValue` spells a Map.
    if (view.attributes.tutorialProgress !== undefined) {
      const own = playerSeat === null ? undefined : this.tutorialProgress.get(playerSeat);
      const scoped = own === undefined ? new Map() : new Map([[playerSeat, own]]);
      view.attributes = {
        ...view.attributes,
        tutorialProgress: this.serializeValue(scoped, 'tutorialProgress'),
      };
    }

    // #23: enforce `animateTo`'s audience here, the same boundary the message
    // log's is enforced at. The buffer is game-wide and rides in `toJSON()`, so
    // without this every seat's payload carried every seat's private events
    // until the dispatch that produced them drained. Ids are left untouched, so
    // a client's monotonic watermark still advances correctly across the gaps.

    if (view.animationEvents) {
      const visible = view.animationEvents.filter(
        (event) => !event.to || (playerSeat !== null && event.to.includes(playerSeat)),
      );
      if (visible.length === view.animationEvents.length) {
        // Nothing withheld — leave the array as it is.
      } else if (visible.length === 0) {
        delete view.animationEvents;
      } else {
        view.animationEvents = visible;
      }
    }

    return view;
  }

  /**
   * Load a serialized state payload (a `game.toJSON()` result) into THIS existing
   * game instance, replacing the element tree, phase, messages, settings and
   * animation buffer with the serialized values.
   *
   * The game's registered actions, flow definition and seeded RNG live on the
   * instance (not in the JSON) and are preserved. This is the authoritative way
   * to adopt a serialized tree without replaying history — used both by
   * `restoreGame()` and by state-authoritative snapshot restore, so that direct
   * tree mutations (e.g. `Piece.putInto` inside a completed pending action,
   * which are recorded in neither commandHistory nor actionHistory) survive a
   * snapshot round-trip.
   */
  loadSerializedState(
    json: ReturnType<Game['toJSON']>,
    options?: { animationSeqFloor?: number; messageLog?: MessageEntry[] }
  ): void {
    // Restore game-level state from JSON. `messages`/`settings` are adopted
    // here by reference but rebuilt into fresh objects (with element/player
    // refs and Map/Set shapes resolved) by `resolveElementReferences(this)`
    // at the end of this method — so a restored game never shares mutable
    // state with the snapshot it was restored from (CR-02: a retained
    // checkpoint may be restored again; live mutations must not reach it).
    this.phase = json.phase;
    this.settings = json.settings;

    // The message log does NOT ride in the tree (see `Game.messages`), so it is
    // supplied separately by whoever holds the enclosing snapshot. Assigned
    // UNCONDITIONALLY: a caller restoring a tree without a log gets an empty
    // log, deterministically, rather than silently keeping whatever this
    // instance happened to hold before — a stale log grafted onto a restored
    // tree is far worse than an honestly empty one, and reads as history
    // corruption rather than as a missing argument.
    this.messages = options?.messageLog ?? [];
    // Resume the eviction offset, so an old checkpoint's watermark still
    // resolves to the right boundary after a restore (#25).
    this._messagesEvicted = (json as { messagesEvicted?: number }).messagesEvicted ?? 0;

    // Restore animation events if present.
    //
    // `animationSeqFloor` distinguishes the two callers of this method
    // (UNDO-04): a FULL session restore (GameSession.restore -> fromSnapshot,
    // no floor) is correct to unconditionally ADOPT the persisted seq -- the
    // process is starting fresh, there is no live counter to protect. An
    // undo/rewind CHECKPOINT restore (GameRunner.fromCheckpoint) supplies a
    // floor derived from the enclosing LIVE snapshot: the checkpoint's own
    // seq is historical and may be behind the live counter, and letting it
    // overwrite the live counter backwards is exactly what makes the client's
    // monotonic watermark (`e.id > lastQueuedId`) silently drop every
    // replayed beat. When a floor is supplied, the seq never drops below it,
    // and the restored buffer is re-stamped with fresh ids above it so those
    // beats still animate instead of colliding with ids already delivered.
    // Do not "simplify" this back into a single unconditional adopt -- see
    // RESEARCH.md §C.
    const jsonWithEvents = json as { animationEvents?: AnimationEvent[]; animationEventSeq?: number };
    if (options?.animationSeqFloor !== undefined) {
      // Checkpoint/undo-rewind restore: never let the seq drop below the
      // live floor, whether or not this checkpoint happened to have a
      // non-empty buffer (toJSON omits both fields entirely when the buffer
      // was empty, so the floor must be applied unconditionally here -- not
      // only inside the `if (jsonWithEvents.animationEvents)` branch).
      this._animationEventSeq = Math.max(jsonWithEvents.animationEventSeq ?? 0, options.animationSeqFloor);
      if (jsonWithEvents.animationEvents) {
        // Copy the event objects too (CR-02): the snapshot may be restored
        // again. Re-stamp each restored event with a fresh id above the
        // floor, preserving relative order, so they are not filtered out by
        // a client watermark that has already advanced past their old ids.
        this._animationEvents = jsonWithEvents.animationEvents.map((e) => ({
          ...e,
          id: ++this._animationEventSeq,
        }));
      } else {
        this._animationEvents = [];
      }
    } else if (jsonWithEvents.animationEventSeq !== undefined || jsonWithEvents.animationEvents) {
      // Full restore (no floor supplied): unconditionally adopt the
      // persisted seq, unchanged from today's behavior. Checked on
      // `animationEventSeq` OR `animationEvents` (not `animationEvents`
      // alone) because toJSON now serializes the seq independently of
      // whether the buffer happens to be empty -- a restore must still
      // adopt a nonzero seq even when there is no buffer to go with it.
      // Copy the event objects too (CR-02): the snapshot may be restored again.
      this._animationEvents = jsonWithEvents.animationEvents
        ? jsonWithEvents.animationEvents.map((e) => ({ ...e }))
        : [];
      this._animationEventSeq = jsonWithEvents.animationEventSeq ?? 0;
    }

    // Capture Space onEnter/onExit handlers from the constructor-built tree
    // BEFORE it is discarded below (RST-01/F10). Handlers are live closures
    // registered in the game's constructor (e.g. `space.onEnter(fn)`) — they
    // are correctly excluded from serialization (closures cannot serialize),
    // but that also means the rebuilt tree below starts with zero handlers
    // unless we explicitly re-bind them here.
    //
    // F-03 (v4.8, SPACE-02): key handlers by the Space's STABLE ELEMENT ID, not
    // by tree position. A positional key (Space-sibling index + ancestor path)
    // is invalidated by the SPACE-02 mobility APIs: `reparent()`/`remove()`
    // change the moved Space's ancestor path AND every later sibling's index.
    // Capture runs on the freshly-constructed tree (constructor positions);
    // match runs on the rebuilt snapshot tree (post-mobility positions) — so a
    // reparented/removed Space (and its shifted siblings) got a divergent key
    // and its onEnter/onExit handlers were silently dropped across every restore
    // path (undo, action-reject rollback, reconnect, cold restore).
    //
    // The element `id` is assigned deterministically in constructor order and is
    // PRESERVED verbatim across serialize/restore, so a constructor-created
    // Space has the same id on the constructor tree and the rebuilt tree
    // regardless of any mobility that happened in between. Ids are globally
    // unique, so this also makes the WR-05 ambiguous-key case impossible.
    // (Handlers are constructor-registered closures; only constructor-created
    // Spaces ever have handlers to capture, and those are exactly the Spaces
    // whose ids round-trip.)
    const spaceHandlerKey = (space: Space): string => String(space.id);
    type CapturedHandlers = { enter: ElementEventHandler<GameElement>[]; exit: ElementEventHandler<GameElement>[] };
    const capturedHandlers = new Map<string, CapturedHandlers>();
    // WR-05: if two handler-bearing Spaces produce the SAME key, re-binding
    // is ambiguous. Fail loud and refuse to re-bind that key — never
    // silently wire both Spaces to one (last-captured) handler set.
    const ambiguousKeys = new Set<string>();
    for (const space of this.all(Space)) {
      const handlers = space._captureEventHandlers();
      if (handlers.enter.length > 0 || handlers.exit.length > 0) {
        const key = spaceHandlerKey(space);
        if (capturedHandlers.has(key)) {
          ambiguousKeys.add(key);
          devWarn(
            `ambiguous-event-handler-key:${key}`,
            `Two or more Spaces with onEnter/onExit handlers share the ambiguous ` +
            `identity "${key}" (same class, same name, indistinguishable ancestors). ` +
            `Handler re-binding across a snapshot restore cannot tell them apart, so ` +
            `their handlers were DROPPED rather than cross-wired — these Spaces will ` +
            `not fire onEnter/onExit after restore. Give each Space (or its non-Space ` +
            `ancestor) a unique name so its identity is unambiguous.`
          );
        }
        capturedHandlers.set(key, handlers);
      }
    }
    for (const key of ambiguousKeys) capturedHandlers.delete(key);

    // Clear existing children and rebuild the tree from JSON
    this._t.children = [];
    if (json.children) {
      for (const childJson of json.children) {
        const child = GameElement.fromJSON(childJson, this._ctx, this._ctx.classRegistry);
        child._t.parent = this;
        (child as GameElement).game = this;
        this._t.children.push(child);
      }
    }

    // Re-attach captured handlers to the rebuilt tree by matching identity
    // key (RST-01/F10). Any handler that cannot be matched is dropped LOUDLY
    // via devWarn — never silently, since a dropped handler is silent
    // game-logic loss (e.g. a scoring trigger that stops firing).
    if (capturedHandlers.size > 0) {
      const matchedKeys = new Set<string>();
      for (const space of this.all(Space)) {
        const key = spaceHandlerKey(space);
        const handlers = capturedHandlers.get(key);
        if (handlers) {
          // WR-05: if a SECOND restored Space matches an already-bound key
          // (structure changed between save and restore), re-binding it too
          // would cross-wire — warn and leave this one unbound.
          if (matchedKeys.has(key)) {
            devWarn(
              `ambiguous-event-handler-rebind:${key}`,
              `More than one restored Space matches the handler identity "${key}" — ` +
              `re-binding is ambiguous, so only the first match received the captured ` +
              `onEnter/onExit handlers. Give each Space (or its non-Space ancestor) a ` +
              `unique name so its identity is unambiguous.`
            );
            continue;
          }
          space._restoreEventHandlers(handlers);
          matchedKeys.add(key);
        }
      }
      for (const key of capturedHandlers.keys()) {
        if (!matchedKeys.has(key)) {
          devWarn(
            `unbound-event-handlers:${key}`,
            `Space "${key}" had onEnter/onExit handlers registered before a snapshot ` +
            `restore, but no matching Space was found in the restored tree (matched by ` +
            `class name + element name + Space-only tree position). These handlers were ` +
            `dropped, not silently carried over — AND if another Space of the same class ` +
            `and name now occupies this tree position, it may have absorbed these handlers ` +
            `instead of its own. This usually means the Space structure changed between ` +
            `save and restore (e.g. conditional Space creation in the constructor) — make ` +
            `sure Spaces with onEnter/onExit handlers are always created with stable names ` +
            `at the same structural position.`
          );
        }
      }
    }

    // Re-apply the game's OWN serialized attributes (e.g. convenience element
    // refs assigned in the constructor like `game.sector`/`game.held`). The
    // constructor set these to point at the now-discarded original elements;
    // overwriting them with the serialized refs lets resolveElementReferences
    // below re-point them at the freshly loaded tree. phase/messages/settings are
    // restored explicitly above, so skip them here.
    const unserializable = new Set(
      (this.constructor as typeof GameElement).unserializableAttributes
    );
    // persistentMap fields are handled by restoring `settings` above — the
    // constructor already rebound each one to a live PersistentMap over it —
    // so they are KNOWN, not withheld. Without this the redaction pass below
    // sees a field the payload does not carry, takes it for an attribute this
    // seat was denied, and replaces the live map with a throwing accessor
    // (#139).
    const handledKeys = new Set<string>([
      ...GAME_SELF_SERIALIZED_FIELDS,
      ...persistentMapFields(this),
    ]);
    for (const [key, value] of Object.entries(json.attributes)) {
      if (!unserializable.has(key) && !key.startsWith('_') && !handledKeys.has(key)) {
        Object.assign(this, { [key]: value });
      }
    }

    // #148: the ROOT is redacted on restore too.
    //
    // Every other element reaches the redaction path through
    // `GameElement.fromJSON`, but the root is rebuilt HERE — by this method,
    // into an instance whose constructor has already run. So a root field the
    // per-seat view withheld (`static visibleAttributes` on the Game class,
    // applied to the root by `toJSONForPlayer` exactly as it is to any other
    // element) kept whatever the constructor put there: the real seed, the
    // real deck order, a specific false fact a searcher then reasoned from.
    //
    // The engine's own root fields are never withheld here. Their audience is
    // settled by `GAME_ROOT_FIELD_AUDIENCE`, they are passed through the
    // whitelist on the way out, and `phase`/`settings`/`messages` are restored
    // above from their own top-level slots rather than from the attribute bag.
    if (json.redacted) {
      const whitelist = new Set(
        (this.constructor as typeof GameElement).visibleAttributes ?? []
      );
      GameElement._restoreRedaction(
        this,
        json,
        'game-root',
        (key) => whitelist.has(key) || isEngineRootField(key) || handledKeys.has(key),
      );
    }

    // Resolve element references in all restored elements
    // This converts { __elementRef: "path" } objects back to actual element references
    this.resolveElementReferences(this);
  }

  /**
   * Create a game from serialized JSON
   */
  static restoreGame<G extends Game>(
    json: ReturnType<G['toJSON']>,
    GameClass: new (options: GameOptions) => G,
    classRegistry: Map<string, ElementClass>
  ): G {
    // Count players from serialized children (players are part of the element
    // tree). Matched structurally via isPlayerJSON — matching the class name
    // 'Player' missed every game with a `static PlayerClass`, i.e. essentially
    // every real game, and yielded playerCount: 0.
    const playerChildren = json.children?.filter(isPlayerJSON) ?? [];
    if (playerChildren.length === 0) {
      throw new Error(
        `Cannot restore ${GameClass.name}: the serialized state contains no players. ` +
          `A game snapshot always carries its players as children of the game element, so this JSON is ` +
          `either not a game snapshot or was truncated before it was stored.`
      );
    }
    const playerCount = playerChildren.length;
    const playerNames = playerChildren.map(p => p.name as string);

    const game = new GameClass({
      playerCount,
      playerNames,
    });

    // Merge class registry
    for (const [name, cls] of classRegistry) {
      game._ctx.classRegistry.set(name, cls);
    }

    game.loadSerializedState(json as ReturnType<Game['toJSON']>);

    return game;
  }
}
