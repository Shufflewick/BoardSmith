// @vitest-environment jsdom
/**
 * DOM-leak test utility for hidden info (VIS-03).
 *
 * Renders a game's AutoUI headlessly as a given seat and fails when a hidden
 * element's identity (rank/suit/face-image, or any custom attribute) leaks
 * into the rendered markup.
 *
 * Forbidden markers are derived by diffing each element's FULL unfiltered
 * `el.toJSON()` identity against what actually SURVIVES into seat N's FINAL
 * per-seat tree (`game.toJSONForPlayer(seat)`, post-`playerView`,
 * game.ts:2671-2819) — never from a hardcoded field list ('rank'/'suit'/...)
 * and never by trusting the engine's own redaction allowlist
 * (`redactHiddenElementAttrs`'s `SAFE_LAYOUT_KEYS`) as ground truth. This
 * closes two blind spots:
 *   1. Unknown/custom per-game attribute names are covered (not just a fixed
 *      identity-field list).
 *   2. Content a game's `static playerView` hook strips AFTER the engine's
 *      own visibility filter is still treated as forbidden — the matcher
 *      never trusts `isVisibleTo` alone (see `visibility.ts`, VIS-01).
 *
 * @module
 */

import type { Component } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import type { default as AutoUIComponent } from '../ui/components/auto-ui/AutoUI.vue';
import type { GameElement as UIGameElement } from '../ui/components/auto-ui/index.js';
import type { ElementJSON } from '../engine/index.js';

/**
 * WHAT THIS GATE CAN BE AIMED AT: a table, or a persistent world.
 *
 * `createTestGame` and `createTestWorld` both answer it, and both are the real
 * thing rather than a stand-in -- a `TestGame`'s projection is the one the
 * snapshot runner sends a client, and a `TestWorld`'s is the one a world host
 * sends a browser, assembled by the host core itself (#262).
 *
 * The two members are the two halves of the diff this gate performs: what the
 * game or world HOLDS, against what this seat is actually SENT. Nothing here
 * names an identity field, which is what keeps the scan honest as a game's
 * state changes shape.
 */
export interface HiddenInfoSubject {
  /**
   * What this seat is sent -- the same payload a real client receives.
   *
   * `state` is the redacted per-seat tree and is what gets mounted. The other
   * two are the scaffold props a custom board declares; a table answers them
   * from its flow state and a world from whether the seat holds an offer it can
   * take, because a world has no turn.
   */
  getPlayerView(seat: number): SeatProjection | Promise<SeatProjection>;
  /**
   * EVERY ELEMENT THIS GAME OR WORLD HOLDS, UNREDACTED.
   *
   * The ground truth a seat's frame is diffed against. A table reads it off its
   * live tree; a world reads it out of its store, because a world is resident
   * one partition at a time and there is no moment at which an engine holds all
   * of it.
   */
  unredactedElements(): readonly ElementJSON[] | Promise<readonly ElementJSON[]>;
}

/** One seat's frame, in the shape both subjects answer. */
export interface SeatProjection {
  /** The redacted per-seat element tree. */
  readonly state: unknown;
  /** What this seat may do right now, by name or as offers. */
  readonly availableActions?: readonly (string | { name: string })[];
  /** Whether this seat can act at all. */
  readonly isMyTurn?: boolean;
}

/**
 * The shape `renderAsSeat`/`assertNoHiddenInfoLeak`'s `gameViewOverride` (and
 * the AutoUI `gameView` prop) accept — structurally identical to
 * `ElementJSON` (id/className/attributes/children/childCount/name, plus the
 * UI's own `__hidden` convenience flag). Exported so callers constructing a
 * deliberately-leaky override (e.g. `game.toJSON()`, or a mutated
 * `getPlayerView(seat).state`) have a name for the cast instead of reaching
 * for `any`.
 */
export type HiddenInfoGameView = UIGameElement;

// ---------------------------------------------------------------------------
// jsdom does not implement `window.matchMedia`. `useElementAnimation.ts` reads
// it at MODULE LOAD time (`prefersReducedMotion` top-level ref), and it is
// pulled in transitively by AutoRenderer's `useFlyingElements()` call — so
// mounting `AutoUI` for real (no stubs; we need the actual renderers to
// exercise the real leak surface) throws before this utility can render
// anything. This supplies the browser API jsdom omits (matching what a real
// browser provides) — it does not stub/alter any BoardSmith behavior.
//
// The polyfill MUST run before `AutoUI.vue`'s module graph is evaluated. A
// static `import AutoUI from '...'` at the top of this file would be hoisted
// and evaluated before ANY of this file's own code runs (ESM import
// ordering), which is too late. So `AutoUI` is loaded via a runtime dynamic
// `import()` (see `loadAutoUI`), deferring its module graph evaluation until
// after the polyfill is installed. (Rule 3: auto-fixed blocking issue.)
// ---------------------------------------------------------------------------
function ensureMatchMediaPolyfill(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia === 'function') return;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

let autoUIComponentPromise: Promise<typeof AutoUIComponent> | undefined;

/** Install the matchMedia polyfill, then dynamically import AutoUI (cached). */
function loadAutoUI(): Promise<typeof AutoUIComponent> {
  if (!autoUIComponentPromise) {
    ensureMatchMediaPolyfill();
    autoUIComponentPromise = import('../ui/components/auto-ui/AutoUI.vue').then(
      (mod) => mod.default,
    );
  }
  return autoUIComponentPromise;
}

let boardInteractionModulePromise:
  | Promise<typeof import('../ui/composables/useBoardInteraction.js')>
  | undefined;

/**
 * Dynamically import the board-interaction module (cached).
 *
 * Deferred for the same reason as `loadAutoUI`/`loadMount`: it pulls in Vue,
 * and a static import here would make every consumer of the
 * `boardsmith/testing` barrel resolve Vue whether or not it ever renders.
 */
function loadBoardInteractionModule(): Promise<
  typeof import('../ui/composables/useBoardInteraction.js')
> {
  if (!boardInteractionModulePromise) {
    boardInteractionModulePromise = import('../ui/composables/useBoardInteraction.js');
  }
  return boardInteractionModulePromise;
}

// ---------------------------------------------------------------------------
// `@vue/test-utils` is a devDependency of BoardSmith itself — consuming
// projects (games, MERC) have no reason to install it unless they actually
// call `renderAsSeat`/`assertNoHiddenInfoLeak`. A static top-level
// `import { mount } from '@vue/test-utils'` would make Vite eagerly resolve
// that module for EVERY consumer of `boardsmith/testing`'s barrel — even one
// that only wants `createTestGame` — turning an opt-in DOM-leak utility into
// a hard, always-on dependency (Rule 1: auto-fixed bug, MERC re-vendor sweep
// caught this: MERC has no `@vue/test-utils` installed and its entire suite
// failed to even load). Deferred via runtime dynamic `import()`, mirroring
// `loadAutoUI`'s existing pattern, so the dependency is only resolved the
// first time this file's own mount-requiring functions actually run.
// ---------------------------------------------------------------------------
let mountFnPromise: Promise<typeof import('@vue/test-utils').mount> | undefined;

/** Dynamically import `@vue/test-utils`'s `mount` (cached) — see note above. */
function loadMount(): Promise<typeof import('@vue/test-utils').mount> {
  if (!mountFnPromise) {
    mountFnPromise = import('@vue/test-utils').then((mod) => mod.mount);
  }
  return mountFnPromise;
}

/**
 * What to render for a seat. `component` is the seam that lets this utility
 * check a game's OWN board instead of AutoUI — see {@link renderAsSeat}.
 */
/**
 * The instance type of the component `renderAsSeat` mounted.
 *
 * A game passing its own board gets a wrapper over THAT board -- so
 * `wrapper.props('actionController')` names a prop the board declares. Before
 * this the return type was hard-wired to AutoUI's instance no matter what was
 * mounted, which made every custom-board caller's `props()` call a type error
 * the moment its tests were type-checked (ShufflewickPub #260).
 */
type RenderedInstance<C> = C extends abstract new (...args: never[]) => infer I ? I : unknown;

export interface RenderAsSeatOptions<C extends Component = Component> {
  /**
   * TESTING-ONLY: render this view instead of the real per-seat view.
   *
   * Exists ONLY so `assertNoHiddenInfoLeak`'s own tests can prove the matcher
   * fails on a deliberately-injected leak (a leak-detector with no failing
   * case is unproven) — real callers should never pass it, since it renders
   * something other than what a real client would receive.
   */
  gameViewOverride?: UIGameElement | null;
  /**
   * The game's own root UI component. When omitted, AutoUI is rendered.
   *
   * A game with a custom board is exactly the case where a hidden-info leak
   * matters most, and AutoUI's markup says nothing about markup the game
   * wrote itself: a card AutoUI never renders can still be painted, face-up,
   * by a custom renderer. Pass the component a real client mounts (the one
   * `src/ui/uis.ts` registers) and the scan runs against that instead.
   */
  component?: C;
  /**
   * Props merged OVER the standard contract props this function supplies
   * (`gameView`, `playerSeat`, `isMyTurn`, `availableActions`,
   * `actionController`). Use it for props specific to your component.
   *
   * `gameView` is deliberately re-applied after this merge and cannot be
   * overridden here: rendering anything but the real per-seat view would make
   * a green result meaningless. Use `gameViewOverride` if you genuinely need
   * to (its own doc explains why you almost certainly do not).
   */
  componentProps?: Record<string, unknown>;
  /**
   * Values to `provide` to the mounted tree, merged OVER the defaults this
   * function supplies.
   *
   * A board is driven by two sibling injection APIs, not one: the action
   * controller arrives as a prop, but board interaction arrives through a
   * `provide` that `<GameShell>` makes. So this function stands in for the
   * shell and provides a real `createBoardInteraction()` under
   * `BOARD_INTERACTION_KEY` by default — a board that calls
   * `useBoardInteraction()` mounts here with no wiring from the caller, which
   * before this threw inside `setup()` and left the leak assertion reporting a
   * bare injection Error instead of a verdict (#260).
   *
   * Pass this only to supply something the default does not cover: an
   * interaction pre-loaded with valid targets so the board renders its
   * candidate state, or a provider your own board asks for.
   */
  provide?: Record<string | symbol, unknown>;
}

/**
 * Mount a game UI headlessly as `seat`, using the real per-seat wire view
 * (`testGame.getPlayerView(seat).state`) unless `gameViewOverride` is given.
 *
 * Renders AutoUI by default, or `options.component` when supplied — the
 * latter is how a game checks the surface its players actually look at.
 *
 * @param testGame - The TestGame wrapper
 * @param seat - The seat to render as
 * @param options - What to render (see {@link RenderAsSeatOptions})
 * @throws If called outside a jsdom test environment (WR-03) — this file's
 *   own `// @vitest-environment jsdom` pragma only applies to tests IN THIS
 *   FILE, not to a caller's test file.
 */
export async function renderAsSeat<C extends Component = typeof AutoUIComponent>(
  subject: HiddenInfoSubject,
  seat: number,
  options: RenderAsSeatOptions<C> = {},
): Promise<VueWrapper<RenderedInstance<C>>> {
  const { wrapper } = await mountForSeat(subject, seat, options);
  return wrapper;
}

/** A mounted board, and everything it has failed with so far. */
interface MountedForSeat<C extends Component> {
  readonly wrapper: VueWrapper<RenderedInstance<C>>;
  readonly raised: unknown[];
}

/**
 * Let the mounted tree finish what it deferred, then raise anything it failed
 * with. A macrotask, because a board's deferred work is a promise chain and a
 * chain of any length has settled by the time one of those has run.
 */
async function raiseWhatTheBoardDeferred(raised: unknown[], seat: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const failures = raised.splice(0, raised.length);
  const first = failures[0];
  if (first === undefined) return;
  const detail = first instanceof Error ? first.message : String(first);
  const others = failures.length > 1 ? ` (and ${failures.length - 1} more after it)` : '';
  throw new Error(
    `The board rendered for seat ${seat} failed after it rendered${others}: ${detail}\n` +
      'It is raised here, as a failed assertion, because a failure that arrives after this ' +
      'assertion has resolved is reported as an unhandled rejection and leaves the run GREEN -- ' +
      'so the hidden-information scan would have reported a clean result having checked nothing. ' +
      "Fix the board's deferred work (an async lifecycle hook, a watcher, or a promise started " +
      'in setup()), then run this scan again.',
    { cause: first },
  );
}

/**
 * ONE MOUNT, PLUS WHATEVER IT RAISED AFTER IT RENDERED (#267).
 *
 * `mount()` returns as soon as the first paint is done, and a board's work is
 * not always finished by then: an async lifecycle hook, a watcher, or a promise
 * started in `setup()` all fail LATER. Vue routes those into the app's own
 * error handler, and with no handler installed they escape to the process as an
 * unhandled rejection -- which arrives after this gate's assertion has already
 * resolved. Vitest then attributes the failure to nothing and the test PASSES,
 * so a suite whose only hidden-information check is this gate goes green while
 * checking nothing. That is the defect in #267 and it is the reason this
 * function exists rather than `renderAsSeat` mounting directly.
 *
 * So the app collects instead of escaping, the mount is given a turn to finish
 * what it deferred, and anything collected is RAISED TO THE CALLER as a failed
 * assertion. `raised` stays live afterwards because a board can still fail
 * during unmount, which the scan checks after its own `finally`.
 */
async function mountForSeat<C extends Component = typeof AutoUIComponent>(
  subject: HiddenInfoSubject,
  seat: number,
  options: RenderAsSeatOptions<C> = {},
): Promise<MountedForSeat<C>> {
  if (typeof document === 'undefined') {
    throw new Error(
      'renderAsSeat/assertNoHiddenInfoLeak require a DOM environment. ' +
        'Add `// @vitest-environment jsdom` as the first line of this test file.',
    );
  }

  const mount = await loadMount();
  const component: Component = options.component ?? (await loadAutoUI());

  // AWAITED, because a world's projection is a read of its store: `viewsFor`
  // settles the bundle's own `world.view` declaration and hydrates whatever it
  // names before it can answer. A table's is already in memory and resolves at
  // once.
  const projection = await subject.getPlayerView(seat);
  const gameView =
    options.gameViewOverride !== undefined
      ? options.gameViewOverride
      : (projection.state as UIGameElement);

  // AutoUI takes only (gameView, playerSeat); a scaffolded custom board also
  // takes (isMyTurn, availableActions, actionController). Supplying the whole
  // contract means the common custom-UI case needs no `componentProps` at all
  // — but it is then FILTERED to what the component actually declares. An
  // undeclared prop would otherwise fall through to the root element as a
  // real DOM attribute, which both spams Vue warnings and adds attacker-free
  // surface strings this very scan would go on to inspect.
  const props: Record<string, unknown> = options.component
    ? {
        ...retainDeclaredProps(options.component, {
          ...buildCustomUIContractProps(projection, seat, gameView),
          ...options.componentProps,
        }),
        // Non-negotiable: the scan is only meaningful against the real
        // per-seat view, so this wins over any caller-supplied `gameView`.
        gameView,
      }
    : { gameView, playerSeat: seat };

  // The props are assembled at runtime (filtered to what the component declares),
  // so they cannot be checked against one component's prop type -- hence mount's
  // own generic pinned to the base `Component`. The wrapper is then re-stated as
  // being over the component that was passed, which is what the signature promises
  // and what a caller inspecting its own board's props needs.
  // GameShell provides board interaction; nothing does here, so this function
  // is the shell's stand-in. The default is the REAL interaction, not an inert
  // shape: a board reads it in setup() and again on every render, and half of
  // one would fail somewhere further in than the injection error it replaces.
  const { BOARD_INTERACTION_KEY, createBoardInteraction } = await loadBoardInteractionModule();
  const provide: Record<string | symbol, unknown> = {
    [BOARD_INTERACTION_KEY]: createBoardInteraction(),
    ...options.provide,
  };

  // COLLECTED, NEVER ESCAPED. See {@link raiseWhatTheBoardDeferred} -- this
  // handler is the whole of why a deferred failure can reach the caller at all.
  const raised: unknown[] = [];
  const wrapper = mount<Component>(component, {
    props,
    global: { provide, config: { errorHandler: (error: unknown) => raised.push(error) } },
  }) as VueWrapper<RenderedInstance<C>>;

  try {
    await raiseWhatTheBoardDeferred(raised, seat);
  } catch (failure) {
    wrapper.unmount();
    throw failure;
  }
  return { wrapper, raised };
}

/**
 * Drop any entry the component does not declare as a prop, so it cannot fall
 * through to the rendered root as a DOM attribute. When a component's props
 * cannot be introspected (no `props` option at all — a render function taking
 * only attrs), everything is kept: filtering to nothing would render a board
 * with no state, and a scan of an empty board proves nothing.
 */
function retainDeclaredProps(
  component: Component,
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  const declared = (component as { props?: string[] | Record<string, unknown> }).props;
  if (declared === undefined) return candidate;

  const names = new Set(Array.isArray(declared) ? declared : Object.keys(declared));
  if (names.size === 0) return candidate;

  return Object.fromEntries(Object.entries(candidate).filter(([key]) => names.has(key)));
}

/**
 * The standard props a scaffolded custom board declares, derived from the real
 * game state for `seat`. `actionController` is a render-only stand-in: this
 * utility mounts a component to inspect its MARKUP, never to drive an action
 * through it, so the controller only has to be shaped correctly enough for a
 * template to read. It deliberately does not send actions — a leak scan that
 * mutated the game would not be a scan.
 */
function buildCustomUIContractProps(
  projection: SeatProjection,
  seat: number,
  gameView: UIGameElement | null,
): Record<string, unknown> {
  const availableActions = (projection.availableActions ?? []).map((a) =>
    typeof a === 'string' ? a : a.name,
  );

  return {
    playerSeat: seat,
    isMyTurn: projection.isMyTurn ?? false,
    availableActions,
    actionController: inertActionController(availableActions),
    gameView,
  };
}

/**
 * A ref-SHAPED plain object. Deliberately not Vue's `ref()`: a static runtime
 * `import { ref } from 'vue'` in this module would make every consumer of the
 * `boardsmith/testing` barrel resolve Vue — the exact always-on-dependency
 * failure documented above for `@vue/test-utils`, which broke MERC's entire
 * suite. A template reading `.value` cannot tell the difference, and this
 * render is a one-shot snapshot with nothing to stay reactive to.
 */
function inertRef<T>(value: T): { value: T } {
  return { value };
}

/**
 * The `useActionController` members an inert stand-in has to carry, split by
 * what a template does with them.
 *
 * Hand-listing these is what let the stand-in drift behind the real composable
 * (#20): a board reading `showActionPanel` (may I offer controls right now?) or
 * `lastActionResult` (what did the last action resolve to?) threw during
 * `setup()`, before a node rendered, so the leak assertion never reached its own
 * logic and the failure was a bare TypeError inside the game's component.
 *
 * `dom-leak-shape.test.ts` asserts these against the real return type, so a
 * member added to the controller and forgotten here fails the library's own
 * suite rather than a game's.
 */
const INERT_REF_MEMBERS: Record<string, unknown> = {
  // State a template reads directly.
  currentAction: null,
  currentSelection: null,
  currentChoices: [],
  currentPick: null,
  currentArgs: {},
  selectedArgs: {},
  pendingArgs: {},
  isSelecting: false,
  isExecuting: false,
  isLoadingChoices: false,
  error: null,
  selectableElementIds: [],
  repeatingState: null,
  pendingFollowUp: false,
  pendingOnServer: false,
  actionCompletedTick: 0,
  multiSelectDraft: null,
  // The typed value and the open menu level (#235): a board may read either,
  // and an inert controller must answer both without one.
  currentPickDraft: null,
  actionMenuPath: [],
  actionSnapshot: null,
  validElements: [],
  // A computed gate a board consults before offering anything; it was missing.
  lastActionResult: null,
  animationsPending: false,
  // `false` rather than `true`: an inert controller must never invite a
  // submission it cannot carry out.
  showActionPanel: false,
  snapshotVersion: 0,
};

/** Members a template calls. Every one is a no-op that submits nothing. */
const INERT_METHOD_MEMBERS = [
  'startAction', 'cancelAction', 'selectChoice', 'selectElement',
  'execute', 'fill', 'start', 'skip', 'clear', 'cancel', 'undo',
  'toggleMultiSelect', 'confirmMultiSelect', 'isMultiSelectSelected',
  'getChoices', 'getCurrentChoices', 'getValidElements', 'getActionMetadata',
  'clearArgs', 'fetchChoicesForPick', 'getCollectedPick', 'getCollectedPicks',
  'setBeforeAutoExecute', 'setPickDraft',
] as const;

/**
 * A minimal, inert `useActionController`-shaped object. Every field is a plain
 * ref-shaped value or a no-op: enough for a template to render against,
 * incapable of submitting anything. Games needing a real controller can pass
 * one via `componentProps`.
 */
function inertActionController(availableActions: string[]): Record<string, unknown> {
  const controller: Record<string, unknown> = {
    availableActions: inertRef(availableActions),
  };
  for (const [name, value] of Object.entries(INERT_REF_MEMBERS)) {
    controller[name] = inertRef(value);
  }
  for (const name of INERT_METHOD_MEMBERS) {
    // Reads like the real thing to a template, resolves to nothing useful, and
    // never reaches a server. The few members whose real form returns a
    // collection return an empty one so a `.length`/`.map` in a template works.
    controller[name] = () => undefined;
  }
  controller.getChoices = () => [];
  controller.getCurrentChoices = () => [];
  controller.getValidElements = () => [];
  controller.getCollectedPicks = () => [];
  controller.isMultiSelectSelected = () => false;
  controller.setBeforeAutoExecute = () => () => undefined;
  return controller;
}

/** @internal exported for the library's own shape test — not public API. */
export const _inertActionControllerForTests = inertActionController;

/**
 * A predicate allowlist: returns `true` for a marker that is a known,
 * legitimate false positive (e.g. a visible turn counter that happens to
 * equal a hidden card's rank) and should NOT fail the assertion.
 *
 * A narrow predicate (scoped to specific marker values/attributes) cannot
 * silently mask a real leak the way a broad allowlist could — the allowlist
 * test in dom-leak.test.ts proves a real leak still fails when a legitimate
 * overlapping value is exempted.
 *
 * **Scope allowances to `elementId`, not just `attribute`.** An attribute-wide
 * exemption (e.g. `ctx.attribute === 'rank'`) allows that attribute for EVERY
 * element, including ones the predicate's author never reasoned about — a
 * future element with a same-named attribute would be silently exempted too.
 * Prefer proving redundancy per-element, using `ctx.elementId` to look up
 * something you already know is safe about THAT specific element:
 *
 * ```ts
 * // Build elementId -> compound-name map from the actual game state.
 * const cardNamesById = new Map<number, string>();
 * for (const card of testGame.game.all(Card)) {
 *   if (card.name) cardNamesById.set(card.id, card.name);
 * }
 *
 * const allow: HiddenInfoLeakAllowPredicate = (marker, ctx) => {
 *   if (ctx.attribute !== 'rank' && ctx.attribute !== 'suit') return false;
 *   // Only exempt THIS element's rank/suit, and only because its own
 *   // compound `name` (a superset) is proven to already cover it.
 *   const name = cardNamesById.get(ctx.elementId);
 *   return typeof name === 'string' && name.includes(marker);
 * };
 * ```
 *
 * This still cannot detect a leak of the bare rank/suit *without* the
 * compound name also leaking (structurally redundant fields are redundant by
 * definition) — pair a scoped allowlist like this with a dedicated
 * regression test that injects a bare-field-only leak (no `allow` predicate)
 * to prove that gap is covered too. See go-fish's
 * `tests/no-hidden-info-dom-leak.test.ts` for a worked example of both.
 */
export type HiddenInfoLeakAllowPredicate = (
  marker: string,
  context: { attribute?: string; elementId: number; elementLabel: string },
) => boolean;

export interface AssertNoHiddenInfoLeakOptions extends RenderAsSeatOptions {
  /** Caller-supplied allowlist predicate — see {@link HiddenInfoLeakAllowPredicate}. */
  allow?: HiddenInfoLeakAllowPredicate;
}

interface ForbiddenMarker {
  value: string;
  attribute?: string;
  elementId: number;
  elementLabel: string;
}

/** Depth-first index of an ElementJSON tree by node id (real ids AND synthetic negative ids). */
function indexNodesById(node: ElementJSON, into: Map<number, ElementJSON>): void {
  into.set(node.id, node);
  if (node.children) {
    for (const child of node.children) {
      indexNodesById(child, into);
    }
  }
}

/**
 * Coerce a primitive attribute value to its string identity form (rank/suit/etc.).
 *
 * Booleans are deliberately excluded: `true`/`false` are near-universal
 * substrings (e.g. `data-animatable="true"`, `aria-pressed="true"` appear on
 * essentially every interactive element), so treating a boolean attribute
 * (like `Card.faceUp`) as an identity candidate would false-positive on
 * almost any rendered page — the same class of problem as the short-numeric
 * collision risk this utility already scopes its DOM scan to avoid
 * (RESEARCH Pitfall 3), just guaranteed rather than merely likely.
 */
function stringifyScalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** Coerce a `$image`/`$images.<side>` value (string URL or sprite descriptor) to an identity string. */
function stringifyImageValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'sprite' in (value as Record<string, unknown>)) {
    const sprite = (value as { sprite?: unknown }).sprite;
    return typeof sprite === 'string' ? sprite : undefined;
  }
  return undefined;
}

/**
 * Extract identity candidate values from an element's FULL unfiltered
 * `toJSON()` output: `name` plus every non-`$`-prefixed attribute (game data
 * like rank/suit/etc.), plus `$image`/`$images.face` specifically (the
 * identity-bearing image refs). Other `$`-prefixed keys ($type, $layout,
 * $direction, ...) are structural/layout metadata shared by every element of
 * that shape, never per-element secret identity, so they are not candidates
 * (this is an independent judgment call, NOT a reliance on
 * `redactHiddenElementAttrs`'s allowlist as ground truth for what is caught).
 *
 * `$images.back` is deliberately excluded too: by design (and by every
 * renderer's own T-93-04 behavior) a card's back image is shown for EVERY
 * hidden card of that type regardless of identity — it is intentionally
 * NOT identity-bearing (the whole point of a card back is that it looks the
 * same face-down). Treating it as forbidden would false-positive on every
 * correctly-redacted hidden card whose anonymized placeholder legitimately
 * renders that same back image (see `redactHiddenElementAttrs`, which keeps
 * `$images.back` for exactly this reason).
 */
function extractIdentityCandidates(
  json: ElementJSON,
): Array<{ attribute?: string; value: string }> {
  const candidates: Array<{ attribute?: string; value: string }> = [];

  if (json.name) {
    candidates.push({ attribute: 'name', value: json.name });
  }

  for (const [key, value] of Object.entries(json.attributes ?? {})) {
    if (key === '$image') {
      const s = stringifyImageValue(value);
      if (s) candidates.push({ attribute: '$image', value: s });
      continue;
    }
    if (key === '$images') {
      const images = value as Record<string, unknown> | undefined;
      if (images && typeof images === 'object') {
        for (const [side, imgVal] of Object.entries(images)) {
          if (side === 'back') continue; // not identity-bearing — see doc comment above
          const s = stringifyImageValue(imgVal);
          if (s) candidates.push({ attribute: `$images.${side}`, value: s });
        }
      }
      continue;
    }
    if (key.startsWith('$')) continue; // structural/layout system metadata — not identity
    for (const s of identityStringsIn(value)) {
      candidates.push({ attribute: key, value: s });
    }
  }

  return candidates;
}

/** @internal exported for the library's own shape test — not public API. */
export const _identityCandidatesForTests = extractIdentityCandidates;

/**
 * Every identity-bearing string reachable inside an attribute value.
 *
 * A bare `stringifyScalar` returned `undefined` for anything that was not a
 * string or a number, so a game that packs private state into positional arrays
 * or nested objects contributed ZERO forbidden markers for those fields (#20) —
 * and the assertion then passed over an almost-empty marker set, which is worse
 * than no coverage because it reads as coverage.
 *
 * Booleans stay excluded at every depth for the same reason `stringifyScalar`
 * excluded them: "true" and "false" appear on almost any rendered page, so they
 * would false-positive rather than detect.
 *
 * So are serialized ELEMENT and PLAYER references. Their contents are ids and
 * seat numbers — public handles that the page is expected to render, and short
 * numerics besides, which is the collision class this utility already scopes
 * its DOM scan to avoid. A ref's identity, if it is secret, is the referenced
 * element's own to protect, and that element is walked in its own right.
 */
function identityStringsIn(value: unknown, seen = new Set<unknown>()): string[] {
  const direct = stringifyScalar(value);
  if (direct !== undefined) return [direct];
  return nestedIdentityStrings(value, seen);
}

/**
 * The shortest numeric marker worth trusting from INSIDE a container.
 *
 * A container of small integers — a positional stat block, a per-skill array —
 * contributes markers like "3", and this utility's whole surface-scoping
 * discipline exists because a short numeric collides with the turn counters,
 * scores and indices any page is full of (RESEARCH Pitfall 3). A one- or
 * two-digit number reached by recursion is not evidence of anything: it says a
 * "3" is on screen, not that THIS "3" is.
 *
 * Strings are kept at any length — a species name or a card face is distinctive
 * in a way a digit is not — and a number that is an attribute's WHOLE value is
 * still a marker at any length, because that was already the contract and the
 * attribute name scopes it.
 */
const MIN_NESTED_NUMERIC_MARKER_DIGITS = 3;

/** {@link identityStringsIn}, for a value that is not itself a scalar. */
function nestedIdentityStrings(value: unknown, seen: Set<unknown>): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (isReferenceLike(value)) return [];
  // A game's state can hold a cycle (an element referencing its container);
  // walking one is not worth crashing the assertion that exists to protect it.
  if (seen.has(value)) return [];
  seen.add(value);

  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return entries.flatMap((entry) => {
    const scalar = stringifyScalar(entry);
    if (scalar === undefined) return nestedIdentityStrings(entry, seen);
    if (typeof entry === 'number' && scalar.replace('-', '').length < MIN_NESTED_NUMERIC_MARKER_DIGITS) {
      return [];
    }
    return [scalar];
  });
}

/**
 * A serialized element/player reference, or a live Player. Either way its
 * contents are public handles rather than identity — see `identityStringsIn`.
 */
function isReferenceLike(value: object): boolean {
  return (
    '__elementRef' in value ||
    '__elementId' in value ||
    '__playerRef' in value ||
    // A live Player object reachable off an attribute (e.g. `player`): its seat
    // and name are on screen by design.
    ('seat' in value && 'name' in value)
  );
}

/** Every attribute value (+ name) that survives on a FINAL tree node (excluding `__hidden`). */
function collectSurvivingValues(node: ElementJSON): Set<string> {
  const values = new Set<string>();
  if (node.name) values.add(node.name);

  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (key === '__hidden') continue;
    if (key === '$images' && value && typeof value === 'object') {
      for (const imgVal of Object.values(value as Record<string, unknown>)) {
        const s = stringifyImageValue(imgVal);
        if (s) values.add(s);
      }
      continue;
    }
    if (key === '$image') {
      const s = stringifyImageValue(value);
      if (s) values.add(s);
      continue;
    }
    // The SAME extraction the forbidden-marker walk uses. It has to be: a value
    // that survived redaction inside an array or a nested object would
    // otherwise be absent from this set and therefore read as forbidden, so
    // every game packing state positionally would fail on its own data (#20).
    for (const identity of identityStringsIn(value)) {
      values.add(identity);
    }
  }

  return values;
}

/** Result of {@link deriveLeakDetectionData}: forbidden markers plus, for every
 * VISIBLE element, the set of values that are that element's OWN legitimate
 * rendered identity (name/attributes it is actually allowed to show). */
interface LeakDetectionData {
  markers: ForbiddenMarker[];
  /** elementId -> the element's own surviving (legitimate) identity values. */
  ownValuesById: Map<number, Set<string>>;
}

/**
 * Derive the forbidden-marker set for `seat` (for every live element, compare
 * its FULL unfiltered identity against what survives into seat N's FINAL
 * per-seat tree — `game.toJSONForPlayer(seat)`, post-`playerView`) AND, for
 * every element that IS visible, its own surviving identity values.
 *
 * The `ownValuesById` map is what makes the D20/CR-01 exemption precise (see
 * {@link assertNoHiddenInfoLeak}): a surface attributed to an ancestor/owner
 * element can only be exempted from a marker check when the collision is
 * fully explained by THAT owner's own legitimate content — never merely
 * because the owner's id differs from the marker's element id.
 */
function deriveLeakDetectionData(
  unredacted: readonly ElementJSON[],
  finalTree: ElementJSON,
): LeakDetectionData {
  const nodesById = new Map<number, ElementJSON>();
  indexNodesById(finalTree, nodesById);

  const markers: ForbiddenMarker[] = [];
  const ownValuesById = new Map<number, Set<string>>();

  for (const unfiltered of unredacted) {
    const candidates = extractIdentityCandidates(unfiltered);
    if (candidates.length === 0) continue;

    const elementLabel = `${unfiltered.className}#${unfiltered.id}`;
    const node = nodesById.get(unfiltered.id);
    const elementHidden = !node || node.attributes?.__hidden === true;

    if (elementHidden) {
      // Absent from the final tree, or present only as a `__hidden` placeholder:
      // every identity candidate is forbidden.
      for (const c of candidates) {
        markers.push({
          value: c.value,
          attribute: c.attribute,
          elementId: unfiltered.id,
          elementLabel,
        });
      }
    } else {
      // Element is visible in the final tree — only candidates the final tree
      // did NOT preserve (stripped by redaction OR a `static playerView` hook)
      // are forbidden. The full surviving set is this element's OWN
      // legitimate identity, recorded for the surface-exemption check.
      const surviving = collectSurvivingValues(node);
      ownValuesById.set(unfiltered.id, surviving);
      for (const c of candidates) {
        if (!surviving.has(c.value)) {
          markers.push({
            value: c.value,
            attribute: c.attribute,
            elementId: unfiltered.id,
            elementLabel,
          });
        }
      }
    }
  }

  // Never treat an empty string as a marker — every value would trivially match.
  return { markers: markers.filter((m) => m.value.length > 0), ownValuesById };
}

/**
 * Text-bearing accessibility/metadata attributes scanned in addition to
 * `data-*`. BoardSmith's own `AutoUI` renderers actively write
 * element-derived identity (e.g. a card's `name`/notation) into exactly
 * these attributes — `CardRenderer.vue`'s `ariaLabel`/`displayLabel`
 * (aria-label/alt), `GridBoardRenderer.vue`'s cell `title`, and similar
 * `aria-label` bindings across `PieceRenderer.vue`/`DieRenderer.vue`/
 * `SpaceRenderer.vue`/`DeckRenderer.vue`/`HexBoardRenderer.vue`. A hidden
 * element's identity leaking through any of these would otherwise go
 * completely undetected (CR-01).
 */
const IDENTITY_BEARING_ATTRS = ['aria-label', 'alt', 'title', 'aria-description', 'aria-roledescription'];

/**
 * A DOM surface string plus the id of the element it is ATTRIBUTED to (the
 * nearest ancestor, inclusive, carrying `data-element-id` — the same anchor
 * `useElementAnimation` reads). `undefined` means the surface could not be
 * attributed to any specific element (no `data-element-id` ancestor at all)
 * and must be checked conservatively against every marker (D20).
 */
interface SurfaceString {
  value: string;
  ownerId?: number;
}

/**
 * Walk up from `el` (inclusive) to the nearest ancestor carrying
 * `data-element-id`, returning its numeric value. This is what makes a
 * scanned surface string attributable to a specific element (D20): every
 * `AutoUI` renderer (CardRenderer, PieceRenderer, DieRenderer,
 * SpaceRenderer, ...) stamps its element's own id onto `data-element-id`, so
 * a `data-*`/aria/img-src/style surface INSIDE that subtree belongs to that
 * element, not to a same-named sibling elsewhere in the tree.
 */
function findOwningElementId(el: Element): number | undefined {
  let current: Element | null = el;
  while (current) {
    const raw = current.getAttribute('data-element-id');
    if (raw !== null) {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) return parsed;
    }
    current = current.parentElement;
  }
  return undefined;
}

/**
 * Scan ONLY the surfaces a hidden identity value could realistically leak
 * through: `data-*` attribute values, `img[src]`, inline
 * `style="background-image: url(...)"` fragments (sprite-sheet rendering),
 * and the text-bearing accessibility/metadata attributes in
 * {@link IDENTITY_BEARING_ATTRS} (aria-label/alt/title/etc. — CR-01).
 *
 * Deliberately NOT a blind `wrapper.text()` substring search — a bare text
 * scan false-positives on short numeric ranks/suits colliding with visible
 * turn counters, scores, or player names (RESEARCH Pitfall 3).
 *
 * Each surface is attributed to its owning element id (D20 — see
 * {@link findOwningElementId}) so symmetric-deck siblings sharing an
 * identity `value` (e.g. two same-named cards) remain distinguishable by
 * WHICH element actually rendered the surface. The owner is only the
 * NEAREST ancestor carrying `data-element-id` — it may be a container that
 * merely happens to enclose the surface (e.g. an aggregating cell, or the
 * enclosing Space when nothing closer stamps its own id), not necessarily
 * the element whose identity the surface displays. See {@link
 * assertNoHiddenInfoLeak}'s exemption logic (CR-01) for how that distinction
 * is enforced.
 */
function collectScopedSurfaceStrings(wrapper: VueWrapper<unknown>): SurfaceString[] {
  const root = wrapper.element as HTMLElement;
  const surfaces: SurfaceString[] = [];

  const visit = (el: Element) => {
    const ownerId = findOwningElementId(el);
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) {
        surfaces.push({ value: attr.value, ownerId });
      }
    }
    for (const attrName of IDENTITY_BEARING_ATTRS) {
      const value = el.getAttribute(attrName);
      if (value) surfaces.push({ value, ownerId });
    }
    if (el.tagName === 'IMG') {
      const src = el.getAttribute('src');
      if (src) surfaces.push({ value: src, ownerId });
    }
    const style = el.getAttribute('style');
    if (style && style.includes('background-image')) {
      surfaces.push({ value: style, ownerId });
    }
  };

  visit(root);
  root.querySelectorAll('*').forEach(visit);

  return surfaces;
}

/**
 * Render `testGame` as `seat` (headlessly, via `renderAsSeat`) and throw if
 * any hidden element's identity leaks into the rendered markup.
 *
 * By default this renders AutoUI. **If your game ships a custom board, pass
 * `options.component`** — otherwise a green result says nothing about the
 * surface your players actually look at, which for a hidden-information game
 * is the only surface that matters:
 *
 * ```ts
 * import GameTable from '../src/ui/components/GameTable.vue';
 *
 * await assertNoHiddenInfoLeak(testGame, 1, { component: GameTable });
 * ```
 *
 * The standard scaffold props (`playerSeat`, `isMyTurn`, `availableActions`,
 * `actionController`) are supplied automatically from the real game state, so
 * most games need nothing else; add `options.componentProps` for props your
 * component declares beyond that contract.
 *
 * Forbidden markers are auto-derived from the difference between each
 * element's FULL unfiltered `toJSON()` identity and what survives into
 * seat N's FINAL per-seat tree — see {@link deriveForbiddenMarkers}. This
 * honors a game's `static playerView` hook (content the hook strips is
 * forbidden too) and never relies on a hardcoded identity-field list.
 *
 * KNOWN LIMITATION (WR-01): boolean-valued attributes are NEVER treated as
 * identity candidates (see {@link stringifyScalar}) — `true`/`false` collide
 * with near-universal DOM substrings (`data-animatable="true"`,
 * `aria-pressed="true"`, etc.), so including them would false-positive on
 * almost any rendered page. This is safe for boolean *state* flags like
 * `Card.faceUp`, but if your game's HIDDEN information is itself a boolean
 * (e.g. a secret "isSpy" role flag, a hidden coin-flip result), this
 * assertion will NEVER catch it leaking. Supplement with `assertHidden`/
 * `isElementVisible` checks (see `visibility.ts`) for boolean secrets.
 *
 * @param testGame - The TestGame wrapper
 * @param seat - The seat to check for leaks
 * @param options - Allowlist predicate + (test-only) render override
 * @throws If a forbidden marker appears in a scoped DOM surface (data-*
 *   attribute value, img[src], inline background-image style, or a
 *   text-bearing accessibility/metadata attribute — aria-label, alt, title,
 *   aria-description, aria-roledescription), naming the leaked marker, the
 *   owning element, the seat, and the DOM surface.
 * @throws If called outside a jsdom test environment (WR-03) — add
 *   `// @vitest-environment jsdom` as the first line of your test file.
 */
export async function assertNoHiddenInfoLeak(
  subject: HiddenInfoSubject,
  seat: number,
  options: AssertNoHiddenInfoLeakOptions = {},
): Promise<void> {
  // THE DIFF, AND BOTH HALVES OF IT COME FROM THE SUBJECT. What it holds
  // against what this seat is sent -- never a hand-written field list, and
  // never a second implementation of the projection (#262).
  const unredacted = await subject.unredactedElements();
  // A GATE WITH NOTHING ON THE OTHER SIDE OF THE DIFF CANNOT FAIL (#267). The
  // same rule as the allowlist check below, one step earlier: a subject holding
  // no elements makes every marker set empty, so the scan would report a clean
  // result for any board at all -- including one painting the whole world.
  if (unredacted.length === 0) {
    throw new Error(
      'assertNoHiddenInfoLeak: the subject holds no elements at all, so there is nothing for ' +
        `seat ${seat}'s frame to be diffed against and this assertion cannot fail. Build the ` +
        'subject with createTestGame (a table) or createTestWorld (a world, whose genesis must ' +
        'have run), and check that the one handed here is the one the test drove.',
    );
  }
  const { markers, ownValuesById } = deriveLeakDetectionData(
    unredacted,
    (await subject.getPlayerView(seat)).state as ElementJSON,
  );
  const { allow } = options;
  const activeMarkers = allow
    ? markers.filter(
        (m) =>
          !allow(m.value, {
            attribute: m.attribute,
            elementId: m.elementId,
            elementLabel: m.elementLabel,
          }),
      )
    : markers;

  // IN-01: a matcher that can't fail is worse than none. If there WERE
  // forbidden markers to check but the caller's allowlist predicate
  // suppressed every single one, the predicate is over-broad -- fail loud
  // rather than silently passing with zero real coverage.
  if (markers.length > 0 && activeMarkers.length === 0) {
    throw new Error(
      `assertNoHiddenInfoLeak: the \`allow\` predicate filtered out all ${markers.length} ` +
        `forbidden marker(s) for seat ${seat} -- the allowlist masked every marker, making ` +
        'this assertion a no-op. Scope the predicate to the exact elementId/attribute pair ' +
        'you intend to allowlist, not a condition broad enough to match every marker.',
    );
  }

  if (activeMarkers.length === 0) return;

  const { wrapper, raised } = await mountForSeat(subject, seat, {
    gameViewOverride: options.gameViewOverride,
    component: options.component,
    componentProps: options.componentProps,
  });
  try {
    const surfaces = collectScopedSurfaceStrings(wrapper);

    for (const marker of activeMarkers) {
      for (const surface of surfaces) {
        // D20/CR-01: a surface attributed to a DIFFERENT element than the
        // marker's owning element is exempted ONLY when that owner's OWN
        // legitimate rendered identity (ownValuesById) already explains the
        // collision — e.g. a same-named symmetric-deck sibling showing its
        // own name. It is NOT exempted merely because the ids differ: an
        // ancestor that AGGREGATES a hidden descendant's identity into its
        // own surface (HexBoardRenderer's cell aria-label/<title> folding in
        // occupant piece names — CR-01) is not explained by the owner's own
        // identity and must still be checked. Un-attributed surfaces (no
        // owning `data-element-id` found) are always checked against every
        // marker — never drop a possible leak just because it couldn't be
        // attributed.
        if (
          surface.ownerId !== undefined &&
          surface.ownerId !== marker.elementId &&
          ownValuesById.get(surface.ownerId)?.has(marker.value)
        ) {
          continue;
        }
        if (surface.value.includes(marker.value)) {
          throw new Error(
            `Hidden-info leak: "${marker.value}"` +
              `${marker.attribute ? ` (attribute "${marker.attribute}")` : ''} ` +
              `from ${marker.elementLabel} is visible in the DOM rendered for seat ${seat}. ` +
              `Leaked via surface: ${surface.value.slice(0, 200)}`,
          );
        }
      }
    }
  } finally {
    wrapper.unmount();
  }
  // A BOARD CAN STILL FAIL ON THE WAY OUT -- an unmounted watcher, a teardown
  // hook -- and that failure is as deferred as any other. Checked after the
  // scan rather than inside its `finally` so a real leak is still the error the
  // caller is told about.
  await raiseWhatTheBoardDeferred(raised, seat);
}
